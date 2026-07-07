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
const { logMetrics } = require('../simulationUtils/performanceMetrics')

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

        const timePerformance = {
            time_getContractCodeEtherscan: [],
			time_getCompiledData: [],
			time_getContractTreeTotal: [],

            time_debugErigon: [],
            time_traceStorageErigon: [],
            time_debugStandard: [],
            time_traceStorageStandard: [],
            time_getEvents: [],

            time_processTraceErigon: [],
            time_optimizedDecodeValuesErigon: [],
            time_decodeInternalTransactionErigon: [],
            time_newDecodedInternalTransactioneErigon: [],
            time_assignStorageToTheInternalErigon: [],
            time_decodeInternalTxsStorageErigon: [],

            time_processTraceStandard: [],
            time_optimizedDecodeValuesStandard: [],
        };

        const tStartExtraction = performance.now();
        const extractedLogs = await getAllTransactions(null, newParams, true, timePerformance);
        //const extractedLogs = await mockExtraction( payload.blockNumber, payload.contract);
        const tEndExtraction = performance.now();

        if (!extractedLogs || extractedLogs.length === 0) {
            console.warn(`[Baseline Worker] Nessun log estratto per il blocco ${mockBlockNumber}. Il blocco potrebbe essere vuoto o non indicizzato. Ignoro il job.`);
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
        const pythonResponse = await axios.post('http://coblockly-backend:8000/api/convertToXes', pythonPayload);

        if (!pythonResponse.data.success) {
            throw new Error(pythonResponse.data.error || "Errore durante la conversione XES in Python");
        }

        const blockXes = pythonResponse.data.xes_string;

        console.log(`[Baseline Worker] Eseguo l'append della transazione al Log Base storico...`);
        const {updatedXes, miniXesToVerify} = appendXes(baseXes, blockXes);

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
            
        const ruleResponse = await axios.post('http://coblockly-backend:8000/api/verifyRuleLive', rulePayload);
        complianceResult = ruleResponse.data;

        const formattedPerformance = {};
        for (const [key, value] of Object.entries(timePerformance)) {
            if (Array.isArray(value)) {
                formattedPerformance[key] = value.join('|'); 
            } else {
                formattedPerformance[key] = value;
            }
        }

        logMetrics('baseline_metrics.csv', {
            timestamp: new Date().toISOString(),
            block: mockBlockNumber,
            extraction_time_ms: (tEndExtraction - tStartExtraction).toFixed(3),
            extracted_tx: extractedLogs.length,
            ...formattedPerformance // espansione delle metriceh csv
        }).catch(err => console.error("Errore scrittura metriche:", err));

        return { 
            success: true, 
            sessionId: sessionId, 
            blockNumber: mockBlockNumber,
            complianceResult: complianceResult
        };
    }
    catch (err) {
        console.error(`[Baseline Worker] Errore durante l'elaborazione di ${mockBlockNumber}:`, err.message);
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