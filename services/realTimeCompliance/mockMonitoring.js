const { appendXes } = require('../simulationUtils/appendXes');
const { getAllTransactions } = require('../ExtractionModule/mainWithOption');
const { connectDB } = require('../../config/db');
const axios = require('axios');
const { performance } = require('perf_hooks');
const { saveBaselineWorkerMetrics, getSessionBaseLog, upsertSessionBaseLog, appendTimelineStep, upsertResolvedTraces, getBlacklistCaseIds, addToBlacklist } = require('../../databaseStore');
const { mockExtraction } = require('../ExtractionModule/simulationOrchestrator');

function formatErrorDetail(err) {
    if (!err) return 'Unknown error';
    if (err.response) {
        return JSON.stringify({
            status: err.response.status,
            statusText: err.response.statusText,
            data: err.response.data,
            code: err.code,
            message: err.message
        });
    }
    return err.stack || err.message || String(err);
}

function bytesToMb(bytes) {
    if (bytes < 0) return '?';
    return (bytes / 1024 / 1024).toFixed(2);
}

function estimateStringMapBytes(map) {
    let total = 0;
    for (const v of Object.values(map)) {
        total += Buffer.byteLength(typeof v === 'string' ? v : String(v), 'utf8');
    }
    return total;
}

/**
 * Esegue l'analisi storica su un range di blocchi.
 * @param {Object} params - L'oggetto contenente tutti i parametri dal frontend.
 */
async function runHistoricalCompliance(params) {
    const { 
        sessionId, 
        monitoredContracts, 
        mapping, 
        parsedRules, 
        logMapping, 
        fromBlock, 
        toBlock 
    } = params;

    console.log(`[Historical Processor] Avvio sessione ${sessionId} da blocco ${fromBlock} a ${toBlock}`);
    
    await connectDB("Mainnet");

    // Itera sequenzialmente blocco per blocco per simulare l'evoluzione temporale
    for (let currentBlock = fromBlock; currentBlock <= toBlock; currentBlock++) {
        console.log(`[Historical Processor] Analisi blocco ${currentBlock}...`);
        const tJobStart = performance.now();

        try {
            const baseXes = await getSessionBaseLog(sessionId);
            if (!baseXes) throw new Error("Log Base mancante in MongoDB.");

            const newParams = {
                contractAddressesFrom: monitoredContracts, 
                contractAddressesTo: monitoredContracts,
                fromBlock: currentBlock, // Passa il blocco corrente, non l'intero range
                toBlock: currentBlock, 
                network: "Mainnet",
                filters: { gasUsed: null, gasPrice: null, timestamp: null, senders: [], functions: [] },
                contractName: "",
                implementationContractAddress: "",
                smartContract: null,
                option: { default: 1, internalStorage: 1, internalTransaction: 0 } 
            };

            const tStartExtraction = performance.now();
            const extractedLogs = await getAllTransactions(null, newParams, true);
            //const extractedLogs = await mockExtraction(currentBlock, monitoredContracts);
            const extractionTime = parseFloat((performance.now() - tStartExtraction).toFixed(3));

            // Se non ci sono log, salta la validazione ma salva le metriche
            if (!extractedLogs || extractedLogs.length === 0) {
                console.log(`[Historical Processor] Blocco ${currentBlock} vuoto. Skippato.`);
                continue; 
            }

            const cleanExtractedLogs = extractedLogs.map(item => item.log ? item.log : item);
            const pythonPayload = {
                data: cleanExtractedLogs,
                case_col: mapping.case_col,
                activity_col: mapping.activity_col,
                time_col: mapping.time_col,
                xes_name: `hist_block_${currentBlock}`,
                extract_columns: false 
            };

            // 1. Conversione XES
            const tStartConversion = performance.now();
            const pythonResponse = await axios.post('http://coblockly-backend:8000/api/convertToXes', pythonPayload);
            const conversionTime = parseFloat((performance.now() - tStartConversion).toFixed(3));

            if (!pythonResponse.data.success) throw new Error("Errore conversione XES Python");

            // 2. Append Incrementale
            const tStartAppend = performance.now();
            const {updatedXes, miniXesToVerify} = appendXes(baseXes, pythonResponse.data.xes_string);
            const appendTime = parseFloat((performance.now() - tStartAppend).toFixed(3));

            console.log(`[DEBUG] Dimensione XES aggiornato: ${(updatedXes.length / 1024 / 1024).toFixed(2)} MB`);
            console.log(`[DEBUG] Dimensione miniXesToVerify: ${miniXesToVerify ? (Buffer.byteLength(miniXesToVerify, 'utf8') / 1024 / 1024).toFixed(2) : 0} MB`);

            if (!updatedXes || updatedXes.trim() === "") {
                console.error(`[Allarme] La funzione appendXes ha restituito un XML vuoto al blocco ${currentBlock}!`);
                break; // Ferma il loop prima di corrompere il Log Base
            }

            await upsertSessionBaseLog(sessionId, updatedXes, { modifiedXes: miniXesToVerify });

            // 3. Verifica Regole in Parallelo
            const tRuleCheckTotal = performance.now();
            if (!logMapping.gasLimit) logMapping.gasLimit = "gasLimit";

            console.log(`[Historical Processor] Avvio verifica di ${parsedRules.length} regole in parallelo (blocco ${currentBlock})`);

            const verificationPromises = parsedRules.map(async (ruleObj, index) => { 
                let ruleRedisTime = 0;
                const ruleIndex = index + 1;
                
                const tRedis1 = performance.now();
                const resolvedCasesIds = await getBlacklistCaseIds(sessionId, ruleIndex); 
                ruleRedisTime += (performance.now() - tRedis1);

                const rulePayload = {
                    xes_string: miniXesToVerify,
                    rule: typeof ruleObj.parsed === 'string' ? ruleObj.parsed : JSON.stringify(ruleObj.parsed),
                    mapping: logMapping,
                    resolved_cases: resolvedCasesIds 
                };
                
                const tStartSingleRule = performance.now();
                
                try {
                    const res = await axios.post('http://coblockly-backend:8000/api/verifyRuleLive', rulePayload);
                    const tEndSingleRule = performance.now();
                    
                    const newCompliant = res.data.compliant || [];
                    const newNoncompliant = res.data.noncompliant || [];
                    const newTempCompliant = res.data.tempCompliant || [];
                    const newTempNonCompliant = res.data.tempNonCompliant || [];
                    const newIgnored = res.data.ignored || [];

                    console.log(`[Processor] Regola ${ruleObj.id} (idx ${ruleIndex}) OK in ${(tEndSingleRule - tStartSingleRule).toFixed(1)}ms | C=${newCompliant.length} NC=${newNoncompliant.length} TC=${newTempCompliant.length} TNC=${newTempNonCompliant.length} IGN=${newIgnored.length}`);
                    
                    const cleanTraceMetrics = (res.data.trace_metrics || []).map(tm => ({
                        case_id: tm.case_id,
                        number_of_events: tm.number_of_events,
                        validation_time_ms: tm.validation_time_ms,
                        trace_status: tm.trace_status
                    }));

                    const updates = {};
                    const newBlacklistIds = []; 

                    const buildUpdate = (arr, statusName) => {
                        arr.forEach(trace => {
                            let id = typeof trace === 'string' ? trace : 
                                     Array.isArray(trace) && trace.length > 0 ? trace[0][mapping.case_col] : 
                                     trace[mapping.case_col];

                            if (id) {
                                updates[String(id)] = JSON.stringify({ status: statusName, trace });
                                if (statusName === 'compliant' || statusName === 'noncompliant') {
                                    newBlacklistIds.push(String(id));
                                }
                            } else {
                                console.warn(`[Processor] Regola ${ruleObj.id}: caseId non trovato (status=${statusName}, case_col="${mapping.case_col}")`);
                            }
                        });
                    };

                    buildUpdate(newCompliant, 'compliant');
                    buildUpdate(newNoncompliant, 'noncompliant');
                    buildUpdate(newTempCompliant, 'tempCompliant');
                    buildUpdate(newTempNonCompliant, 'tempNonCompliant');
                    buildUpdate(newIgnored, 'ignored');

                    console.log(`[Processor] Regola ${ruleObj.id}: upsertResolvedTraces cases=${Object.keys(updates).length} payload≈${bytesToMb(estimateStringMapBytes(updates))} MB blacklist+=${newBlacklistIds.length}`);

                    const tRedis2 = performance.now();
                    if (Object.keys(updates).length > 0) await upsertResolvedTraces(sessionId, ruleIndex, updates); 
                    if (newBlacklistIds.length > 0) await addToBlacklist(sessionId, ruleIndex, newBlacklistIds);
                    ruleRedisTime += (performance.now() - tRedis2);

                    return {
                        ruleText: ruleObj.text,
                        ruleIndex: ruleIndex,
                        executionTime: parseFloat((tEndSingleRule - tStartSingleRule).toFixed(3)),
                        ruleRedisTime: ruleRedisTime,
                        cleanTraceMetrics: cleanTraceMetrics, 
                        compliant: newCompliant,      
                        noncompliant: newNoncompliant,
                        tempCompliant: newTempCompliant, 
                        tempNonCompliant: newTempNonCompliant,
                        ignored: newIgnored
                    };
                } catch (err) {
                    const tEndSingleRule = performance.now();
                    console.error(`[Processor] Errore regola ${ruleObj.id} (idx ${ruleIndex}) dopo ${(tEndSingleRule - tStartSingleRule).toFixed(1)}ms:`, formatErrorDetail(err));
                    return {
                        ruleText: ruleObj.text,
                        ruleIndex: ruleIndex,
                        executionTime: parseFloat((tEndSingleRule - tStartSingleRule).toFixed(3)),
                        ruleRedisTime: ruleRedisTime,
                        cleanTraceMetrics: [],
                        error: true,
                        compliant: [],
                        noncompliant: [],
                        tempCompliant: [],
                        tempNonCompliant: [],
                        ignored: []
                    };
                }
            });

            const complianceResults = await Promise.all(verificationPromises);
            const ruleCheckTotalTime = parseFloat((performance.now() - tRuleCheckTotal).toFixed(3));
            const failedRules = complianceResults.filter(r => r.error);
            console.log(`[Historical Processor] Verifica regole completata in ${ruleCheckTotalTime}ms | ok=${complianceResults.length - failedRules.length} fail=${failedRules.length}`);

            let totalRedisVerificationTime = 0;
            const ruleMetricsMap = {};
            complianceResults.forEach(result => {
                totalRedisVerificationTime += (result.ruleRedisTime || 0);
                if (result.ruleIndex) ruleMetricsMap[`rule_${result.ruleIndex}_metrics`] = result.cleanTraceMetrics || [];
            });
            
            const finalComplianceResult = complianceResults.map(result => {
                const { cleanTraceMetrics, executionTime, ruleRedisTime, ...frontendPayload } = result;
                return frontendPayload;
            });

            // 4. Salvataggio Metriche e Timeline
            await saveBaselineWorkerMetrics({
                blockNumber: currentBlock,
                number_txs_extracted: extractedLogs.length,
                time_totalExtractionPhase: extractionTime,
                time_pythonConversion: conversionTime,
                time_xesAppend: appendTime,
                time_ruleVerification: ruleCheckTotalTime,
                time_redisVerificationQueries: parseFloat(totalRedisVerificationTime.toFixed(3)),
                rules_number: parsedRules.length,
                ...ruleMetricsMap,
                time_totalJob: parseFloat((performance.now() - tJobStart).toFixed(3))
            });

            const timelineSnapshot = {
                step: parsedRules.length > 0 ? "Processed" : "No rules",
                sourceType: 'HISTORICAL_UPDATE',
                sourceId: `Block_${currentBlock}`,
                blockNumber: currentBlock,
                ruleResults: finalComplianceResult
            };

            try {
                await appendTimelineStep(sessionId, timelineSnapshot);
            } catch (timelineErr) {
                console.error(`[Historical Processor] Errore appendTimelineStep blocco ${currentBlock}:`, formatErrorDetail(timelineErr));
                throw timelineErr;
            }

        } catch (err) {
            console.error(`[Historical Processor] Errore blocco ${currentBlock}:`, formatErrorDetail(err));
        }
    }
    
    console.log(`[Historical Processor] Analisi completata per sessione ${sessionId}`);
    return { success: true };
}

module.exports = { runHistoricalCompliance };