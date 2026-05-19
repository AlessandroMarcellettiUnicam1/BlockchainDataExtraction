const { Worker } = require('bullmq');
const { connectionOptions } = require('../../config/redisClient');
const systemEvents = require('../../config/sse');
const { processSimulation } = require('../ExtractionModule/simulationOrchestrator');
const { connectDB } = require('../../config/db');
require('dotenv').config();

console.log('[Worker] Worker inizializzato, in attesa di transazioni in coda...');

(async () => {
    try {
        await connectDB(); 
        console.log(`[Worker] Connesso a MongoDB con successo.`);
    } catch (err) {
        console.error(`[Worker] Errore critico di connessione a MongoDB:`, err.message);
        process.exit(1);
    }
})();

const rtcWorker = new Worker('mempool-queue', async (job) => {
    const { sessionId, hash, payload } = job.data;

    console.log(`[Worker] Job ${job.id} ricevuto: Transazione ${hash} (Sessione: ${sessionId})`)

    try {
        const params = payload;
        const targetAddress = payload[0].to;

        const networkData = {
            web3Endpoint: process.env.WEB3_ALCHEMY_MAINNET_URL,
            apiKey: process.env.API_KEY_ETHERSCAN,
            endpoint: process.env.ETHERSCAN_MAINNET_ENDPOINT,
            networkName: "Mainnet"
        };

        console.log(`[Worker] Avvio simulazione per ${hash} verso il target ${targetAddress}...`);

        const simulationResult = await processSimulation(params, targetAddress, networkData, hash);

        console.log(`[Worker] Simulazione completata per ${hash}. Emetto i risultati al frontend...`);

        // systemEvents.emit(`new-tx-${sessionId}`, {
        //     type: 'SIMULATION_RESULT',
        //     hash: hash,
        //     target: targetAddress,
        //     simulationData: simulationResult.data 
        // });

        return { 
            success: true, 
            sessionId: sessionId, 
            hash: hash,
            target: targetAddress,
            simulationData: simulationResult.data
        };

        return { success: true, hash};

    } catch (err) {
        console.error(`[Worker] Errore durante la simulazione per ${hash}:`, err.message);
        throw err;
    }

}, {connection: connectionOptions});

rtcWorker.on('ready', () => {
    console.log(`[Worker] Connesso a Redis con successo. Worker operativo.`);
});

rtcWorker.on('completed', (job) => {
    console.log(`[Worker] Job completato con successo: ${job.returnvalue.hash}`);
});

rtcWorker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job.id} fallito: ${err.message}`);
});

module.exports = rtcWorker;