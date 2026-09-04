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
const {saveBaselineWorkerMetrics} = require('../../databaseStore');

console.log('[Baseline Worker] Worker inizializzato, in attesa di job in coda...');

(async () => {
    try {
        await connectDB("Mainnet"); 
        console.log(`[Baseline Worker] Connesso a MongoDB con successo.`);
    } catch (err) {
        console.error(`[Baseline Worker] Errore critico di connessione a MongoDB:`, err.message);
        process.exit(1);
    }
})();

const baselineWorker = new Worker('baseline-queue', async (job) => {

    const { sessionId, payload } = job.data;

    console.log(`[Baseline Worker] Job ${job.id} ricevuto: inizio l'estrazione per il blocco ${payload.blockNumber} (Sessione: ${sessionId})`);
    const tJobStart = performance.now();

    try {
        // const mockBlockNumber = payload.blockNumber;

        const configData = await redisClient.get(`session:${sessionId}:config`);
        const baseXes = await redisClient.get(`session:${sessionId}:xes`);

        if (!configData || !baseXes) {
            throw new Error("Configurazione o Log Base mancanti in Redis. Impossibile aggiornare lo storico.");
        }

        const { mapping, parsedRules, logMapping, monitoredContracts } = JSON.parse(configData);

        const newParams = {
            contractAddressesFrom: payload.contract, 
            contractAddressesTo: payload.contract,
            fromBlock: payload.blockNumber,
            toBlock: payload.blockNumber, 
            network: "Mainnet",
            filters: {
                gasUsed: null,
                gasPrice: null,
                timestamp: null,
                senders: [],
                functions: []
            },
            contractName: "",
            implementationContractAddress: "", //impl address da aggiungere in caso
            smartContract: null,
            option: { default: 1, internalStorage: 1, internalTransaction: 0 } 
        };

        const tStartExtraction = performance.now();
        const extractedLogs = await getAllTransactions(null, newParams, true);
        //const extractedLogs = await mockExtraction( payload.blockNumber, payload.contract);
        const extractionTime = parseFloat((performance.now() - tStartExtraction).toFixed(3));

        if (!extractedLogs || extractedLogs.length === 0) {
            console.warn(`[Baseline Worker] Nessun log estratto per il blocco ${payload.blockNumber}. Il blocco potrebbe essere vuoto o non indicizzato. Ignoro il job.`);
            
            await saveBaselineWorkerMetrics({
                jobId: job.id, 
                blockNumber: payload.blockNumber,
                time_totalExtractionPhase: extractionTime,
                time_totalJob: parseFloat((performance.now() - tJobStart).toFixed(3)),
                status: 'No_Logs_Extracted'
            });
            
            return { 
                success: false,
                sessionId: sessionId , 
                blockNumber: payload.blockNumber 
            };
        }

        console.log(`[Baseline Worker] Estratte ${extractedLogs.length} transazioni dal blocco ${payload.blockNumber}.`);
        console.log(`[DEBUG Struttura] Esempio di transazione:`, JSON.stringify(extractedLogs[0]).substring(0, 300));
        
        const cleanExtractedLogs = extractedLogs.map(item => item.log ? item.log : item);

        const pythonPayload = {
            data: cleanExtractedLogs,
            case_col: mapping.case_col,
            activity_col: mapping.activity_col,
            time_col: mapping.time_col,
            xes_name: `baseline_block_${payload.blockNumber}`,
            extract_columns: false 
        };

        console.log(`[Baseline Worker] Invio dati del blocco ${payload.blockNumber} a Python per conversione XES...`);
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
        console.log(`[Baseline Worker] Log Base aggiornato per sessione ${sessionId}.`);

        let complianceResults = null;
        console.log(`[Baseline Worker] Mempool disabilitata. Controllo compliance per il blocco ${payload.blockNumber}...`);
        
        const tRuleCheckTotal = performance.now();
        if (!logMapping.gasLimit) {
            logMapping.gasLimit = "gasLimit";
        }
        
        const verificationPromises = parsedRules.map(async (ruleObj, index) => { 
            let ruleRedisTime = 0;
            const ruleIndex = index + 1;
            const redisKey = `session:${sessionId}:rule:${ruleIndex}:resolved_traces`;
            const blacklistKey = `session:${sessionId}:rule:${ruleIndex}:blacklist`;
            
            // Lettura istantanea solo degli ID, zero overhead CPU
            const tRedis1 = performance.now();
            const resolvedCasesIds = await redisClient.smembers(blacklistKey); 
            ruleRedisTime += (performance.now() - tRedis1);
            const rulePayload = {
                xes_string: miniXesToVerify,
                rule: typeof ruleObj.parsed === 'string' ? ruleObj.parsed : JSON.stringify(ruleObj.parsed),
                mapping: logMapping,
                resolved_cases: resolvedCasesIds 
            };
            
            const tStartSingleRule = performance.now();
            
            return axios.post('http://coblockly-backend:8000/api/verifyRuleLive', rulePayload)
                .then(async res => { 
                    const tEndSingleRule = performance.now();
                    
                    // 1. Dati PURI restituiti da Python (Le novità del blocco corrente)
                    const newCompliant = res.data.compliant || [];
                    const newNoncompliant = res.data.noncompliant || [];
                    const newTempCompliant = res.data.tempCompliant || [];
                    const newTempNonCompliant = res.data.tempNonCompliant || [];
                    const newIgnored = res.data.ignored || [];
                    
                    const rawTraceMetrics = res.data.trace_metrics || [];

                    // 2. Pulizia metriche per MongoDB (Rimuovo l'intera traccia pesante)
                    const cleanTraceMetrics = rawTraceMetrics.map(tm => ({
                        case_id: tm.case_id,
                        number_of_events: tm.number_of_events,
                        validation_time_ms: tm.validation_time_ms,
                        trace_status: tm.trace_status
                    }));

                    // 3. Aggiornamento stato definitivo in Redis (BLACKLIST)
                    const updates = {};
                    const newBlacklistIds = []; // Array per i nuovi ID risolti

                    const buildUpdate = (arr, statusName) => {
                        arr.forEach(trace => {
                            let id = null;
                            if (typeof trace === 'string') {
                                id = trace;
                            } else if (Array.isArray(trace) && trace.length > 0) {
                                id = trace[0][mapping.case_col];
                            } else if (typeof trace === 'object') {
                                id = trace[mapping.case_col];
                            }

                            if (id) {
                                const strId = String(id);
                                updates[strId] = JSON.stringify({ status: statusName, trace });
                                
                                // Se lo stato è definitivo, lo aggiungiamo all'array da inviare al Set
                                if (statusName === 'compliant' || statusName === 'noncompliant') {
                                    newBlacklistIds.push(strId);
                                }
                            } else {
                                console.warn(`[Worker] Impossibile trovare il Case ID con la colonna "${mapping.case_col}"`);
                            }
                        });
                    };

                    buildUpdate(newCompliant, 'compliant');
                    buildUpdate(newNoncompliant, 'noncompliant');
                    buildUpdate(newTempCompliant, 'tempCompliant');
                    buildUpdate(newTempNonCompliant, 'tempNonCompliant');
                    buildUpdate(newIgnored, 'ignored');

                    // L'hset sovrascrive lo stato precedente della traccia aggiornandolo all'ultimo noto
                    const tRedis2 = performance.now();
                    if (Object.keys(updates).length > 0) {
                        await redisClient.hset(redisKey, updates); 
                    }
                    if (newBlacklistIds.length > 0) {
                        await redisClient.sadd(blacklistKey, newBlacklistIds);
                    }
                    ruleRedisTime += (performance.now() - tRedis2);

                    // 4. Costruzione Payload PER IL FRONTEND
                    // Inviamo solo le tracce valutate in questo specifico step.
                    return {
                        ruleText: ruleObj.text,
                        ruleIndex: ruleIndex,
                        executionTime: parseFloat((tEndSingleRule - tStartSingleRule).toFixed(3)),
                        ruleRedisTime: ruleRedisTime, // <-- Passa il dato fuori dalla Promise
                        
                        // Per il salvataggio su MongoDB (invisibile al frontend, gestito sotto)
                        cleanTraceMetrics: cleanTraceMetrics, 
                        
                        // Payload live per il frontend (solo novità)
                        compliant: newCompliant,      
                        noncompliant: newNoncompliant,
                        tempCompliant: newTempCompliant, 
                        tempNonCompliant: newTempNonCompliant,
                        ignored: newIgnored
                    };
                })
                .catch(err => {
                    const tEndSingleRule = performance.now();
                    const pythonError = err.response ? JSON.stringify(err.response.data) : err.message;
                    console.error(`[Baseline Worker] Errore verifica regola ${ruleObj.id}:`, pythonError);
                    return {
                        ruleText: ruleObj.text,
                        ruleIndex: ruleIndex,
                        executionTime: parseFloat((tEndSingleRule - tStartSingleRule).toFixed(3)),
                        ruleRedisTime: ruleRedisTime,
                        cleanTraceMetrics: [],
                        error: true,
                        compliant: [], noncompliant: [], tempCompliant: [], tempNonCompliant: [], ignored: []
                    };
                });
        });

        // 6 regole in parallelo
        complianceResults = await Promise.all(verificationPromises);
        
        const ruleCheckTotalTime = parseFloat((performance.now() - tRuleCheckTotal).toFixed(3));

        let totalRedisVerificationTime = 0;

        // Mappatura dinamica delle metriche nelle colonne hardcoded
        const ruleMetricsMap = {};
        complianceResults.forEach(result => {
            totalRedisVerificationTime += (result.ruleRedisTime || 0); // Somma i tempi
            
            if (result.ruleIndex >= 1 && result.ruleIndex <= 6) {
                ruleMetricsMap[`rule_${result.ruleIndex}_metrics`] = result.cleanTraceMetrics || [];
            }
        });
        
        const finalComplianceResult = complianceResults.map(result => {
            const { cleanTraceMetrics, executionTime, ruleRedisTime, ...frontendPayload } = result;
            return frontendPayload;
        });

        // Salvataggio nel DB
        await saveBaselineWorkerMetrics({
            blockNumber: payload.blockNumber,
            number_txs_extracted: extractedLogs.length,
            time_totalExtractionPhase: extractionTime,
            time_pythonConversion: conversionTime,
            time_xesAppend: appendTime,
            time_ruleVerification: ruleCheckTotalTime,
            time_redisVerificationQueries: parseFloat(totalRedisVerificationTime.toFixed(3)),
            rules_number: parsedRules.length,
            ...ruleMetricsMap, // Espande: rule_1_metrics: [...], rule_2_metrics: [...], ecc.
            time_totalJob: parseFloat((performance.now() - tJobStart).toFixed(3))
        });


        const timelineSnapshot = {
            step: parsedRules.length > 0 ? "Processed" : "No rules",
            sourceType: 'BASELINE_UPDATE',
            sourceId: `Block_${payload.blockNumber}`,
            blockNumber: payload.blockNumber,
            ruleResults: finalComplianceResult
        };

        // 2. Lo accodo nella List di Redis (l'indice partirà da 0)
        await redisClient.rpush(`session:${sessionId}:timeline`, JSON.stringify(timelineSnapshot));

        return { 
            success: true, 
            sessionId: sessionId, 
            blockNumber: payload.blockNumber,
            complianceResult: finalComplianceResult
        };
    }
    catch (err) {
        console.error(`[Baseline Worker] Errore durante l'elaborazione di ${payload.blockNumber}:`, err.message);
        await saveBaselineWorkerMetrics({
            jobId: job.id, 
            blockNumber: payload.blockNumber,
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