const { Web3 } = require('web3');
const { txQueue } = require('./config/redisClient.js'); 
const { adaptMempoolTx } = require('../simulationUtils/txAdapter');
const { act } = require('react');

// mappa per memorizzare le sessioni attive
const activeSubscriptions = new Map();

async function startMempoolListener(sessionId, url, validAddress, addressFilters) {
    if (activeSubscriptions.has(sessionId)) {
        throw new Error("Listener già attivo per questa sessione");
    }

    const options = {
            reconnect: { auto: true, delay: 5000, maxAttempts: 10 }
        };
    const provider = new Web3.providers.WebsocketProvider(rpcUrl, options);
    const web3 = new Web3(provider);

    const hashQueue = [];
    let isCapturing = true;
    let isProcessing = false;

    try {
        const subscription = await web3.eth.subscribe('newPendingTransactions');

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
                        const toLower = tx.to.toLowerCase();
                        const fromLower = tx.from.toLowerCase();
                        const filterAddress = validAddress.toLowerCase();

                        let match = false;
                        if (addressFilters === "from" && fromLower === filterAddress) match = true;
                        else if (addressFilters === "to" && toLower === filterAddress) match = true;
                        else if (addressFilters === "both" && (fromLower === filterAddress || toLower === filterAddress)) match = true;
                    }

                    if (match) {
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
                    }
                }
                catch (err) {
                    // ignoro i get falliti silenziosamente per non bloccare troppo
                }
            } 
            isProcessing = false;
        }
    }
    catch {
        throw new Error(`Inizializzazione listener fallita: ${err.message}`);    
    }
}
