const { isAxiosError } = require('axios');
const { Web3 } = require('web3');

async function getMempoolTxs(url, limit = 100) {
    return new Promise(async (resolve, reject) => {

        const options = {
            reconnect: { auto: true, delay: 5000, maxAttempts: 10 }
        };
        const web3 = new Web3(new Web3.providers.WebsocketProvider(url, options));
        
        const txs = [];
        const hashQueue = []; 
        
        let isCapturing = true;
        let isProcessing = false; 

        try {
            const subscription = await web3.eth.subscribe('newPendingTransactions');
            console.log(`Iniziata cattura sequenziale di ${limit} transazioni...`);

            // mettiamo tutti gli hash in coda
            subscription.on("data", (hash) => {
                if (!isCapturing) return;
                
                hashQueue.push(hash);
                
                if (!isProcessing) {
                    processQueue();
                }
            });

            subscription.on("error", (error) => {
                if (isCapturing) {
                    isCapturing = false;
                    reject(error);
                }
            });

            // funzione helper per svuotare la coda
            async function processQueue() {
                isProcessing = true;
                
                // finchè nella coda c'è qualcosa
                while (isCapturing && hashQueue.length > 0 && txs.length < limit) {
                    
                    // logica fifo
                    const currentHash = hashQueue.shift(); 
                    
                    try {
                        const tx = await web3.eth.getTransaction(currentHash);
                        
                        if (tx && tx.to) {
                            txs.push(tx);
                            
                            if (txs.length >= limit) {
                                isCapturing = false; 
                                await subscription.unsubscribe();
                                web3.currentProvider.disconnect(); 
                                console.log(`Cattura completata con successo: ${txs.length} tx sequenziali.`);
                                resolve(txs);
                                return; 
                            }
                        }
                    } catch (err) {
                        console.log('un get fallito')
                    }
                    
                    // await new Promise(r => setTimeout(r, 50));
                }
                
                // flag spenta in caso la coda si svuoti senza aver ancora raggiunto il limite
                isProcessing = false;
            }

        } catch (err) {
            reject(err);
        }
    });
}



module.exports = {
    getMempoolTxs
}

/*
async function (url, limit = 100) {
    return new Promise(async (resolve, reject) => {
        const web3 = new Web3(url);
        const txs = [];
        let isCapturing = true;
        
        // IL SEMAFORO: Tiene traccia di quante chiamate ad Alchemy sono in volo
        let activeRequests = 0; 
        const MAX_CONCURRENT_REQUESTS = 5; // Numero sicuro per il rate-limit gratuito

        try {
            // 1. Await pulito sulla creazione della sottoscrizione
            const subscription = await web3.eth.subscribe('newPendingTransactions');
            console.log('Sottoscrizione WebSocket iniziata');

            subscription.on("data", async (hash) => {
                // 2. Controllo Semaforo: Se stiamo già facendo 5 richieste, ignoriamo questo hash
                if (!isCapturing || activeRequests >= MAX_CONCURRENT_REQUESTS) return;

                activeRequests++; // Accendiamo il semaforo

                try {
                    const tx = await web3.eth.getTransaction(hash);
                    
                    // 3. Controllo di sicurezza: controlliamo di nuovo isCapturing 
                    // perché potrebbe essere cambiato mentre aspettavamo la risposta
                    if (tx && tx.to && isCapturing) {
                        txs.push(tx);

                        if (txs.length >= limit) {
                            isCapturing = false; // Blocca immediatamente l'ingresso di nuovi hash
                            
                            await subscription.unsubscribe();
                            web3.currentProvider.disconnect(); // Chiude il socket TCP
                            
                            console.log(`Cattura completata: ${txs.length} transazioni trovate.`);
                            resolve(txs);
                        }
                    }
                } catch (err) {
                    // Ignoriamo silenziamente le transazioni che falliscono o sono già state minate.
                } finally {
                    // 4. Spegniamo il semaforo per questo "slot", permettendo a un nuovo hash di essere elaborato
                    activeRequests--;
                }
            });

            subscription.on("error", (error) => {
                if (isCapturing) {
                    isCapturing = false;
                    reject(error);
                }
            });

        } catch (err) {
            reject(err);
        }
    });
}
*/