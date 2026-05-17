const { Web3 } = require('web3');
const { txQueue } = require('../../config/redisClient'); 
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
        console.log(`[WebSocket] Sottoscrizione avviata con successo per sessione ${sessionId}`); // LOG 1

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

                    if (tx && tx.to && tx.from) {
                        // check dei filtri

                        console.log(`[Analisi] Controllando Tx: From ${tx.from} -> To ${tx.to}`);
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
                        //console.log(`[Match] La transazione da ${tx.to} a ${tx.from} ha fatto match`);
                        const adaptedPayload = adaptMempoolTx(tx);

                        // aggiungo la transazione in coda
                        await txQueue.add('simulate-tx', {
                                sessionId: sessionId,
                                hash: tx.hash,
                                payload: adaptedPayload
                            }, { 
                                removeOnComplete: true,
                                removeOnFail: false 
                            });

                        // invio la transazione al canale per trasmetterla dinamicamente al frontend
                        systemEvents.emit(`new-tx-${sessionId}`, tx);
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

async function stopMempoolListener(sessionId) {
    const session = activeSubscriptions.get(sessionId);
    if (session) {
        session.isCapturing = false;
        await session.subscription.unsubscribe();
        session.provider.disconnect();
        activeSubscriptions.delete(sessionId);
    }
}

module.exports = {
    startMempoolListener,
    stopMempoolListener
}
