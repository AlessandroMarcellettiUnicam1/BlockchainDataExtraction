const { Worker } = require('bullmq');
const { connectionOptions, redisClient } = require('../../config/redisClient');
const systemEvents = require('../../config/sse');
const { processSimulation, mockProcessSimulation } = require('../ExtractionModule/simulationOrchestrator');
const { connectDB } = require('../../config/db');
const axios = require('axios');
const { config } = require('dotenv');
require('dotenv').config();
const { appendXes } = require('../simulationUtils/appendXes')
const { performance } = require('perf_hooks');
const { logMetrics } = require('../simulationUtils/performanceMetrics')

console.log('[Worker] Worker inizializzato, in attesa di transazioni in coda...');

(async () => {
    try {
        await connectDB(); 
        console.log(`[Mempool Worker] Connesso a MongoDB con successo.`);
    } catch (err) {
        console.error(`[Mempool Worker] Errore critico di connessione a MongoDB:`, err.message);
        process.exit(1);
    }
})();

const mempoolWorker = new Worker('mempool-queue', async (job) => {
    const { sessionId, hash, payload } = job.data;

    console.log(`[Mempool Worker] Job ${job.id} ricevuto: Transazione ${hash} (Sessione: ${sessionId})`)

    const tStartGlobal = performance.now();

    try {
        const params = payload;
        const targetAddress = payload[0].to;

        const networkData = {
            web3Endpoint: process.env.WEB3_ALCHEMY_MAINNET_URL,
            apiKey: process.env.API_KEY_ETHERSCAN,
            endpoint: process.env.ETHERSCAN_MAINNET_ENDPOINT,
            networkName: "Mainnet"
        };

        console.log(`[Mempool Worker] Avvio simulazione per ${hash} verso il target ${targetAddress}...`);
        const tStartSim = performance.now();
        const simulationResult = await processSimulation(params, targetAddress, networkData, hash);
        //const simulationResult = await mockProcessSimulation(params, targetAddress, networkData, hash);
        const tEndSim = performance.now();
        console.log(`[Mempool Worker] Simulazione completata per ${hash}.`);

        if (simulationResult.data.status !== "System error") {
            // recupero il mapping e lo xes base da Redis
            const configData = await redisClient.get(`session:${sessionId}:config`);
            const baseXes = await redisClient.get(`session:${sessionId}:xes`);

            if (!configData || !baseXes) {
                throw new Error("Configurazione o Log Base mancanti in Redis");
            }

            const { mapping, parsedRule, logMapping } = JSON.parse(configData);

            const pythonPayload = {
                data: [simulationResult.data],
                case_col: mapping.case_col,
                activity_col: mapping.activity_col,
                time_col: mapping.time_col,
                xes_name: `live_tx_${hash}`,
                extract_columns: false 
            };

            console.log(`[Mempool Worker] Invio transazione ${hash} a Python per conversione XES...`);
            const tStartConversion = performance.now();
            const pythonResponse = await axios.post('http://coblockly-backend:8000/api/convertToXes', pythonPayload);
            const tEndConversion = performance.now();

            if (!pythonResponse.data.success) {
                throw new Error(pythonResponse.data.error || "Errore sconosciuto in Python");
            }

            const singleTxXes = pythonResponse.data.xes_string;

            console.log(`[Mempool Worker] Eseguo l'append della transazione al Log Base...`);
            const tStartAppend = performance.now();
            const { updatedXes, miniXesToVerify } = appendXes(baseXes, singleTxXes);
            const tEndAppend = performance.now();

            //await redisClient.setex(`session:${sessionId}:xes`, 7200, tempXes);
            //console.log(`[Worker] XES Base aggiornato su Redis per sessione ${sessionId}.`);

            const rulePayload = {
                xes_string: miniXesToVerify,
                rule: typeof parsedRule === 'string' ? parsedRule : JSON.stringify(parsedRule),
                mapping: logMapping
            }

            const tStartRuleCheck = performance.now();
            const ruleResponse = await axios.post('http://coblockly-backend:8000/api/verifyRuleLive', rulePayload);
            const tEndRuleCheck = performance.now();
            console.log(`[Mempool Worker] Regola verificata per la transazione ${hash} nella sessione ${sessionId}.`);

            const tEndGlobal = performance.now();

            logMetrics('mempool_metrics.csv', {
                timestamp: new Date().toISOString(),
                hash: hash,
                sim_time_ms: (tEndSim - tStartSim).toFixed(3),
                conversion_time_ms: (tEndConversion - tStartConversion).toFixed(3),
                append_time_ms: (tEndAppend - tStartAppend).toFixed(3),
                rule_time_ms: (tEndRuleCheck - tStartRuleCheck).toFixed(3),
                total_time_ms: (tEndGlobal - tStartGlobal).toFixed(3)
            }).catch(err => console.error("Errore scrittura metriche:", err));

            return { 
                success: true, 
                sessionId: sessionId, 
                hash: hash,
                complianceResult: ruleResponse.data
            };
        } else {
            console.log(`[Mempool Worker] Transazione ${hash} ignorata (Status Blockchain: ${simulationResult.data.status}).`);
            return {
                success: true,
                sessionId: sessionId,
                hash: hash,
                complianceResult: {
                    compliant: [],
                    noncompliant: [],
                    ignored: [simulationResult.data]
                }
            };
        }
    } catch (err) {
        console.error(`[Mempool Worker] Errore durante la simulazione per ${hash}:`, err.message);
        throw err;
    }

}, {connection: connectionOptions});

mempoolWorker.on('ready', () => {
    console.log(`[Mempool Worker] Connesso a Redis con successo. Worker operativo.`);
});

mempoolWorker.on('completed', (job) => {
    console.log(`[Mempool Worker] Job ${job.id} completato con successo: ${job.returnvalue.hash}`);
});

mempoolWorker.on('failed', (job, err) => {
    console.error(`[Mempool Worker] Job ${job.id} fallito: ${err.message}`);
});

module.exports = mempoolWorker;