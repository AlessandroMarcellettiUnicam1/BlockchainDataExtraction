const { Worker } = require('bullmq');
const { connectionOptions } = require('../../config/redisClient');
const systemEvents = require('../../config/sse');
const { processSimulation } = require('../ExtractionModule/simulationOrchestrator');
const { connectDB } = require('../../config/db');
const axios = require('axios');
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

        /*
        1. prendo il mapping da redis

        2. faccio la chiamata API allo script python, in cui gli passo simulationResult, il mapping e false 
            per non estrarre le colonne (che posso anche non mettere perchè di default è false)

        3. mi recupero lo XES base da Redis
        
        4. chiamo la funzione per fare l'append

        5. aggiorno lo xes base su Redis
        */


        // systemEvents.emit(`new-tx-${sessionId}`, {
        //     type: 'SIMULATION_RESULT',
        //     hash: hash,
        //     target: targetAddress,
        //     simulationData: simulationResult.data 
        // });

        // return { 
        //     success: true, 
        //     sessionId: sessionId, 
        //     hash: hash,
        //     target: targetAddress,
        //     simulationData: simulationResult.data
        // };

    } catch (err) {
        console.error(`[Worker] Errore durante la simulazione per ${hash}:`, err.message);
        throw err;
    }

}, {connection: connectionOptions});

function appendXes(baseXes, newXes) {
    // estraggo il bloggo trace e event dallo xes appena convertito
    const traceStart = newXes.indexOf('<trace>');
    const traceEnd = newXes.indexOf('</trace>') + 8;
    const newTraceBlock = newXes.substring(traceStart, traceEnd);

    const eventStart = newXes.indexOf('<event>');
    const eventEnd = newXes.indexOf('</event>') + 8;
    const newEventBlock = newXes.substring(eventStart, eventEnd);

    // estraggo 
    const caseIdRegex = /<string key="concept:name" value="([^"]+)"\/>/;
    const caseMatch = newTraceBlock.match(caseIdRegex);
    const caseId = caseMatch ? caseMatch[1] : null;

    if (caseId) {
        const caseIdentifier = `<string key="concept:name" value="${caseId}"/>`;
        const identifierIndex = baseXes.indexOf(caseIdentifier);

        // se il caseId si trova già nel log base
        if (identifierIndex !== -1) {
            const nextTraceClose = baseXes.indexOf('</trace>', identifierIndex);

            if (nextTraceClose !== -1) {
                const before = baseXes.substring(0, nextTraceClose);
                const after = baseXes.substring(nextTraceClose);
                return before + newEventBlock + '\n' + after;
            }
        }
        // non trovo il caseId, faccio l'append alla fine del log base
        else {
            const logCloseIndex = baseXes.lastIndexOf('</log>');
            
            if (logCloseIndex !== -1) {
                const before = baseXes.substring(0, logCloseIndex);
                const after = baseXes.substring(logCloseIndex);
                return before + newTraceBlock + '\n' + after;
            }
        }
    } else {
        console.warn("[Worker] Anomalìa XES: Nessun Case ID trovato nel nuovo evento. Append ignorato.");
    }

    return baseXes;
}

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