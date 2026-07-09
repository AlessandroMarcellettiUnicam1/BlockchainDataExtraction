const { connectionOptions, redisClient } = require("../../config/redisClient");
const { appendXes } = require('../simulationUtils/appendXes');
const { getAllTransactions } = require('../ExtractionModule/mainWithOption')
const { mockExtraction } = require('../ExtractionModule/simulationOrchestrator')
const { connectDB } = require('../../config/db');
const { Worker } = require('bullmq');
const { config } = require('dotenv');
require('dotenv').config();
const axios = require('axios');
const { performance } = require('perf_hooks');
const { logMetrics } = require('../simulationUtils/performanceMetrics');
const {saveBaselineWorkerMetrics} = require('../../databaseStore');

console.log('[Baseline Worker] Worker inizializzato, in attesa di job in coda...');

(async () => {
    try {
        await connectDB(); 
        console.log(`[Baseline Worker] Connesso a MongoDB con successo.`);
    } catch (err) {
        console.error(`[Baseline Worker] Errore critico di connessione a MongoDB:`, err.message);
        process.exit(1);
    }
})();

const baselineWorker = new Worker('baseline-queue', async (job) => {
    /*
    1. estraggo i dati dalla coda (hash, contratto e blockNumber)
    2. creo i parmas da inserire in getAllTransactions(null, newParams, true)
    3. converto il log ottenuto tramite endopint di CoBlocklyBackend
    4. lo appendo tramite la funzione appendXes
    5. lo sovrascrivo in Redis
    */

    const { sessionId, payload } = job.data;

    console.log(`[Baseline Worker] Job ${job.id} ricevuto: inizio l'estrazione per il blocco ${payload.blockNumber} (Sessione: ${sessionId})`);
    const tJobStart = performance.now();

    try {
        const mockBlockNumber = payload.blockNumber - 1000000;

        const newParams = {
            contractAddressesFrom: [payload.contract], 
            contractAddressesTo: [payload.contract],
            fromBlock: mockBlockNumber,
            toBlock: mockBlockNumber, 
            network: "Mainnet",
            filters: {
                gasUsed: null,
                gasPrice: null,
                timestamp: null,
                senders: [],
                functions: []
            },
            contractName: "",
            implementationContractAddress: "",
            smartContract: null,
            option: { default: 1, internalStorage: 1, internalTransaction: 0 } 
        };

        const tStartExtraction = performance.now();
        const extractedLogs = await getAllTransactions(null, newParams, true);
        //const extractedLogs = await mockExtraction( payload.blockNumber, payload.contract);
        const extractionTime = parseFloat((performance.now() - tStartExtraction).toFixed(3));

        if (!extractedLogs || extractedLogs.length === 0) {
            console.warn(`[Baseline Worker] Nessun log estratto per il blocco ${mockBlockNumber}. Il blocco potrebbe essere vuoto o non indicizzato. Ignoro il job.`);
            
            await saveBaselineWorkerMetrics({
                jobId: job.id, 
                blockNumber: mockBlockNumber,
                time_totalExtractionPhase: extractionTime,
                time_totalJob: parseFloat((performance.now() - tJobStart).toFixed(3)),
                status: 'No_Logs_Extracted'
            });
            
            return { 
                success: false,
                sessionId: sessionId , 
                blockNumber: mockBlockNumber 
            };
        }

        console.log(`[Baseline Worker] Estratte ${extractedLogs.length} transazioni dal blocco ${mockBlockNumber}.`);

        // recupero dati da redis
        const configData = await redisClient.get(`session:${sessionId}:config`);
        const baseXes = await redisClient.get(`session:${sessionId}:xes`);

        if (!configData || !baseXes) {
            throw new Error("Configurazione o Log Base mancanti in Redis. Impossibile aggiornare lo storico.");
        }

        const { mapping, parsedRule, logMapping, enableMempool } = JSON.parse(configData);

        const pythonPayload = {
            data: extractedLogs,
            case_col: mapping.case_col,
            activity_col: mapping.activity_col,
            time_col: mapping.time_col,
            xes_name: `baseline_block_${mockBlockNumber}`,
            extract_columns: false 
        };

        console.log(`[Baseline Worker] Invio dati del blocco ${mockBlockNumber} a Python per conversione XES...`);
        const tStartConversion = performance.now();
        const pythonResponse = await axios.post('http://coblockly-backend:8000/api/convertToXes', pythonPayload);
        const conversionTime = parseFloat((performance.now() - tStartConversion).toFixed(3));

        if (!pythonResponse.data.success) {
            throw new Error(pythonResponse.data.error || "Errore durante la conversione XES in Python");
        }

        const blockXes = pythonResponse.data.xes_string;

        console.log(`[Baseline Worker] Eseguo l'append della transazione al Log Base storico...`);
        const tStartAppend = performance.now();
        const {updatedXes, miniXesToVerify} = appendXes(baseXes, blockXes);
        const appendTime = parseFloat((performance.now() - tStartAppend).toFixed(3));

        if (!miniXesToVerify) {
             throw new Error("Errore durante l'isolamento della traccia XES modificata.");
        }

        await redisClient.set(`session:${sessionId}:xes`, updatedXes);
        console.log(`[Baseline Worker] Log Base aggiornato e consolidato su Redis per sessione ${sessionId}.`);

        let complianceResult = null;
        console.log(`[Baseline Worker] Mempool disabilitata. Controllo compliance per il blocco ${mockBlockNumber}...`);
        const rulePayload = {
            xes_string: miniXesToVerify,
            rule: typeof parsedRule === 'string' ? parsedRule : JSON.stringify(parsedRule),
            mapping: logMapping
        };
            
        const tRuleCheckTime = performance.now();
        const ruleResponse = await axios.post('http://coblockly-backend:8000/api/verifyRuleLive', rulePayload);
        const ruleCheckTime = parseFloat((performance.now() - tRuleCheckTime).toFixed(3));
        complianceResult = ruleResponse.data;

        await saveBaselineWorkerMetrics({
            jobId: job.id, 
            blockNumber: mockBlockNumber,
            time_totalExtractionPhase: extractionTime,
            time_pythonConversion: conversionTime,
            time_xesAppend: appendTime,
            time_ruleVerification: ruleCheckTime,
            time_totalJob: parseFloat((performance.now() - tJobStart).toFixed(3)),
            status: 'Success'
        });

        return { 
            success: true, 
            sessionId: sessionId, 
            blockNumber: mockBlockNumber,
            complianceResult: complianceResult
        };
    }
    catch (err) {
        console.error(`[Baseline Worker] Errore durante l'elaborazione di ${mockBlockNumber}:`, err.message);
        await saveBaselineWorkerMetrics({
            jobId: job.id, 
            blockNumber: mockBlockNumber,
            time_totalJob: parseFloat((performance.now() - tJobStart).toFixed(3)),
            status: 'Failed'
        });
        throw err;
    }
}, {
    connection: connectionOptions,
    concurrency: 1 // impostazione per impedire race conditions su letture e scritture di Redis
});

baselineWorker.on('ready', () => {
    console.log(`[Baseline Worker] Connesso a Redis con successo. Worker operativo.`);
});

baselineWorker.on('completed', (job) => {
    if (job.returnvalue.success) {
        console.log(`[Baseline Worker] Job ${job.id} completato con successo: blocco ${job.returnvalue.blockNumber}`);
    } else {
        console.log(`[Baseline Worker] Job ${job.id} scartato: Nessun log estratto per il blocco ${job.returnvalue.blockNumber}.`);
    }
});

baselineWorker.on('failed', (job, err) => {
    console.error(`[Baseline Worker] Job ${job.id} fallito: ${err.message}`);
});

module.exports = baselineWorker;