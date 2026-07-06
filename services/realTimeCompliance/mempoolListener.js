const { Web3 } = require('web3');
const { txQueue, baselineQueue } = require('../../config/redisClient'); 
const { adaptMempoolTx } = require('../simulationUtils/txAdapter');
const systemEvents = require('../../config/sse');

// mappa per memorizzare le sessioni attive
const activeSubscriptions = new Map();

async function startMempoolListener(sessionId, url, validAddress, addressFilters) {
    if (activeSubscriptions.has(sessionId)) {
        throw new Error("Listener già attivo per questa sessione");
    }

    const options = {
            reconnect: { auto: true, delay: 5000, maxAttempts: 10 }
        };
    const provider = new Web3.providers.WebsocketProvider(url, options);
    const web3 = new Web3(provider);

    const hashQueue = [];
    let isCapturing = true;
    let isProcessing = false;

    try {
        const subscription = await web3.eth.subscribe('newPendingTransactions');
        console.log(`[WebSocket Memoool] Sottoscrizione avviata con successo per sessione ${sessionId}`); // LOG 1

        activeSubscriptions.set(sessionId, { subscription, provider, isCapturing: true});

        subscription.on("data", (hash) => {
            const session = activeSubscriptions.get(sessionId);
            if (!session || !session.isCapturing) return;

            hashQueue.push(hash);
            if (!isProcessing) processQueue();
        });

        subscription.on("error", (error) => {
            console.error(`[Listener ${sessionId}] Errore di sottoscrizione:`, error);
        });

        // funzione helper per processare la coda di transazioni in arrivo (non ancora filtrate)
        async function processQueue() {
            isProcessing = true;

            while (activeSubscriptions.get(sessionId)?.isCapturing && hashQueue.length > 0) {
                const currentHash = hashQueue.shift();

                try {
                    const tx = await web3.eth.getTransaction(currentHash);
                    //console.log(tx);
                    
                    if (tx && tx.to && tx.from) {
                        // check dei filtri

                        // console.log(`[Analisi] Controllando Tx: From ${tx.from} -> To ${tx.to}`);
                        const toLower = tx.to.toLowerCase();
                        const fromLower = tx.from.toLowerCase();
                        const filterAddress = validAddress.toLowerCase();

                        // if (toLower === filterAddress || fromLower === filterAddress) {
                        //     console.log(`[DEBUG FILTRO] Trovato indirizzo! Mode: "${addressFilters}" | filterAddress: "${filterAddress}" | Tx To: "${toLower}" | Match To?: ${toLower === filterAddress}`);
                        // }

                        let match = false;
                        if (addressFilters === "from" && fromLower === filterAddress) match = true;
                        else if (addressFilters === "to" && toLower === filterAddress) match = true;
                        else if (addressFilters === "both" && (fromLower === filterAddress || toLower === filterAddress)) match = true;

                        if (match) {
                            console.log(`[Match] La transazione da ${tx.to} a ${tx.from} ha fatto match`);
                            const adaptedPayload = adaptMempoolTx(tx);
                            //console.log(adaptedPayload);

                            // aggiungo la transazione in coda
                            await txQueue.add('simulate-tx', {
                                    sessionId: sessionId,
                                    hash: tx.hash,
                                    payload: adaptedPayload
                                }, { 
                                    removeOnComplete: true,
                                    removeOnFail: false 
                                });
                        }
                    }
                }
                catch (err) {
                    // ignoro i get falliti silenziosamente per non bloccare troppo
                }
            } 
            isProcessing = false;
        }
    }
    catch (err) {
        throw new Error(`Inizializzazione listener fallita: ${err.message}`);    
    }
}

// funzione che ascolta il contratto per controllare se vengono minate nuove transazioni
async function startBaselineListener(sessionId, url, validAddress) {
    const options = { reconnect: { auto: true, delay: 5000, maxAttempts: 10 } };
    const provider = new Web3.providers.WebsocketProvider(url, options);
    const web3 = new Web3(provider);

    try {
        const subscription = await web3.eth.subscribe('newBlockHeaders'); // sottoscrizione apposita
        console.log(`[WebSocket Baseline] Sottoscrizione blocchi avviata per sessione ${sessionId}`);

        // salvo l'iscrizione
        activeSubscriptions.set(`${sessionId}_baseline`, { subscription, provider, isCapturing: true });

        subscription.on("data", async (blockHeader) => {
            const session = activeSubscriptions.get(`${sessionId}_baseline`);
            if (!session || !session.isCapturing) return;

            try {
                // prendo il blocco intero e cerco per il contratto che sto monitorando
                const block = await web3.eth.getBlock(blockHeader.number, true);

                let extraction = false;
                
                if (block && block.transactions) {
                    for (const tx of block.transactions) {
                        if (tx && tx.to && tx.from) {
                            const toLower = tx.to.toLowerCase();
                            const fromLower = tx.from.toLowerCase();
                            const filterAddress = validAddress.toLowerCase();

                            const match = (toLower === filterAddress || fromLower === filterAddress);

                            if (match) {
                                extraction = true;
                                break;
                            }
                        }
                    }
                }

                if (extraction) {
                    console.log(`[Baseline] Trovate tx rilevanti nel blocco ${block.number}. In coda per estrazione.`);  
                    
                    await baselineQueue.add('update-baseline-block', {
                        sessionId: sessionId,
                        payload: {
                            contract: validAddress,
                            blockNumber: Number(block.number)
                    }
                    }, {removeOnComplete: true });
                }
            } catch (err) {
                console.error(`[Baseline Error] Errore parsing blocco ${blockHeader.number}:`, err.message);
            }
        });

        subscription.on("error", (error) => {
            console.error(`[Listener Baseline ${sessionId}] Errore:`, error);
        });

    } catch (err) {
        throw new Error(`Inizializzazione baseline listener fallita: ${err.message}`);
    }
}

async function stopMempoolListener(sessionId) {
    const session = activeSubscriptions.get(sessionId);
    if (session) {
        session.isCapturing = false;
        await session.subscription.unsubscribe();
        session.provider.disconnect();
        activeSubscriptions.delete(sessionId);
    }

    const sessionBaseline = activeSubscriptions.get(`${sessionId}_baseline`);
    if (sessionBaseline) {
        sessionBaseline.isCapturing = false;
        await sessionBaseline.subscription.unsubscribe();
        sessionBaseline.provider.disconnect();
        activeSubscriptions.delete(`${sessionId}_baseline`);
    }

    // svuoto tutto quando si ferma
    await txQueue.drain(true);
    await baselineQueue.drain(true);
}

module.exports = {
    startMempoolListener,
    stopMempoolListener,
    startBaselineListener
}
