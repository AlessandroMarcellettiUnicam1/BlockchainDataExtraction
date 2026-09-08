const {connectDB} = require("./config/db");
const mongoose = require("mongoose");
const {
    extractionLogSchema,
    extractionAbiSchema,
    extractionMetricsSchema,
    baselineWorkerMetricsSchema,
    singleTraceSchema,
    sessionBaseLogMetaSchema,
    sessionBaseTraceSchema,
    sessionTimelineStepSchema,
    sessionTimelineTraceSchema,
    sessionResolvedTraceSchema,
    sessionRuleBlacklistSchema
} = require("./schema/data");
const {getModelByContractAddress} = require('./query/query');
const {searchAbi} =require("./query/query");
const {
    splitIntoChunks,
    joinChunkPayloads,
    serializeForStorage,
    deserializeFromStorage,
    extractXesHeader,
    extractXesTraces,
    buildXesFromParts,
    extractCaseIdFromComplianceTrace,
    STATUS_BUCKETS
} = require('./services/simulationUtils/xesStorageUtils');

async function saveTransaction(data, contractAddress) {
    try {
        const TransactionModel = getModelByContractAddress(contractAddress);
        
        const newTransaction = new TransactionModel(data);
        await newTransaction.save()

    } catch (err) {
        console.error('Error saving data: ', err);
    }
}
async function saveExtractionLog(userLog) {
    try {
        const ExtractionLog = mongoose.model('ExtractionLog', extractionLogSchema, 'ExtractionLog');
        const newExtractionLog = new ExtractionLog(userLog);
        await newExtractionLog.save();

    } catch (err) {
        console.error('Extraction log storing error: ', err);
        throw new Error(err.message)
    }
}
async function saveAbi(storeAbi) {
    if (Array.isArray(storeAbi.abi)) {
        storeAbi.abi = JSON.stringify(storeAbi.abi);
    }
    let query = {
        contractName: storeAbi.contractName,
        contractAddress: storeAbi.contractAddress.toLowerCase()
    };
    const response = await searchAbi(query);
    if(response){
        return;
    }else{
        try {
            const ExtractionAbi = mongoose.model('ContractData', extractionAbiSchema, 'ContractData');
            const newExtractionAbi = new ExtractionAbi(storeAbi);
            await newExtractionAbi.save();

        } catch (err) {
            if (err.code === 11000) {
            console.log('Duplicate ABI detected');
            } else {
            console.error('Error saving data: ', err);
            }
        }
    }
}

async function saveCompiledContractData(contractAddress, contractTree) {
    if (!contractAddress || !contractTree) return;

    try {
        const collection = mongoose.connection.db.collection("ContractData");
        await collection.updateOne(
            { contractAddress: contractAddress.toLowerCase() },
            {
                $set: {
                    abi: contractTree.contractAbi,
                    contractName: contractTree.contractName,
                    proxy: contractTree.proxy,
                    proxyImplementation: contractTree.proxyImplementation || '',
                    contractAddress: contractAddress.toLowerCase(),
                    sourceCode: contractTree.sourceCode,
                    compilerVersion: contractTree.compilerVersion,
                    fullContractTree: contractTree.fullContractTree,
                    storageLayoutFlag: contractTree.storageLayoutFlag,
                    contractCompiled: contractTree.contractCompiled,
                    compiledAt: new Date()
                }
            },
            { upsert: true }
        );
    } catch (err) {
        console.error(`[ContractData DB Error] Errore salvataggio dati compilati per ${contractAddress}: `, err);
    }
}

async function saveExtractionMetrics(metricsData) {
    try {
        const ExtractionMetrics = mongoose.models.ExtractionMetrics || 
                                 mongoose.model('ExtractionMetrics', extractionMetricsSchema, 'ExtractionMetrics');
        await new ExtractionMetrics(metricsData).save();
    } catch (err) {
        console.error(`[Metrics DB Error] Errore salvataggio metriche per ${metricsData.transactionHash}: `, err);
    }
}

// 3. Funzione per la metrica del Worker
async function saveBaselineWorkerMetrics(jobData) {
    try {
        const BaselineWorkerMetrics = mongoose.models.BaselineWorkerMetrics || 
                                     mongoose.model('BaselineWorkerMetrics', baselineWorkerMetricsSchema, 'BaselineWorkerMetrics');
        await new BaselineWorkerMetrics(jobData).save();
    } catch (err) {
        console.error(`[Metrics DB Error] Errore salvataggio metriche Job ${jobData.jobId}: `, err);
    }
}

async function saveIndividualTraces(tracesArray) {
    try {
        const SingleTraceModel = mongoose.models.SingleTrace || 
                                 mongoose.model('SingleTrace', singleTraceSchema, 'SingleTraces');
        
        if (tracesArray && tracesArray.length > 0) {
            // insertMany è molto più performante per salvare grandi array rispetto al .save() in un ciclo for
            await SingleTraceModel.insertMany(tracesArray);
            console.log(`[DB] Salvate ${tracesArray.length} tracce individuali con successo in 'SingleTraces'.`);
        }
    } catch (err) {
        console.error(`[DB Error] Errore salvataggio tracce individuali: `, err);
    }
}

function getSessionBaseLogMetaModel() {
    return mongoose.models.SessionBaseLogMeta ||
           mongoose.model('SessionBaseLogMeta', sessionBaseLogMetaSchema, 'SessionBaseLogMeta');
}

function getSessionBaseTraceModel() {
    return mongoose.models.SessionBaseTrace ||
           mongoose.model('SessionBaseTrace', sessionBaseTraceSchema, 'SessionBaseTraces');
}

async function readChunkedCasePayload(chunkDocs) {
    if (!chunkDocs || chunkDocs.length === 0) return null;
    const kind = chunkDocs[0].payloadKind || 'json';
    const body = joinChunkPayloads(chunkDocs);
    return deserializeFromStorage(kind, body);
}

async function groupChunksByKey(docs, keyFn) {
    const map = new Map();
    for (const doc of docs) {
        const key = keyFn(doc);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(doc);
    }
    return map;
}

/**
 * Salva il base log spezzato per caseId (+ meta header).
 * Firma compatibile: upsertSessionBaseLog(sessionId, xesString, ttlSeconds?)
 * oppure upsertSessionBaseLog(sessionId, xesString, { ttlSeconds, modifiedXes })
 * - senza modifiedXes: replace completo (generate-base-xes)
 * - con modifiedXes: aggiorna solo le tracce toccate da appendXes (stessa logica, meno I/O)
 */
async function upsertSessionBaseLog(sessionId, xesString, ttlSecondsOrOpts = 259200) {
    if (!xesString) return;

    let ttlSeconds = 259200;
    let modifiedXes = null;
    if (typeof ttlSecondsOrOpts === 'object' && ttlSecondsOrOpts !== null) {
        ttlSeconds = ttlSecondsOrOpts.ttlSeconds ?? 259200;
        modifiedXes = ttlSecondsOrOpts.modifiedXes || null;
    } else if (typeof ttlSecondsOrOpts === 'number') {
        ttlSeconds = ttlSecondsOrOpts;
    }

    const SessionBaseLogMeta = getSessionBaseLogMetaModel();
    const SessionBaseTrace = getSessionBaseTraceModel();

    const xesHeader = extractXesHeader(xesString);
    const expiresAt = ttlSeconds
        ? new Date(Date.now() + ttlSeconds * 1000)
        : undefined;

    await SessionBaseLogMeta.findOneAndUpdate(
        { sessionId },
        {
            sessionId,
            xesHeader,
            updatedAt: new Date(),
            ...(expiresAt ? { expiresAt } : {})
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const traces = extractXesTraces(modifiedXes || xesString);

    if (!modifiedXes) {
        await SessionBaseTrace.deleteMany({ sessionId });
    } else {
        const caseIds = traces.map((t) => String(t.caseId));
        if (caseIds.length > 0) {
            await SessionBaseTrace.deleteMany({ sessionId, caseId: { $in: caseIds } });
        }
    }

    const docs = [];
    for (const { caseId, traceXml } of traces) {
        const chunks = splitIntoChunks(traceXml);
        for (const c of chunks) {
            docs.push({
                sessionId,
                caseId: String(caseId),
                chunkIndex: c.chunkIndex,
                chunkTotal: c.chunkTotal,
                payload: c.payload,
                updatedAt: new Date()
            });
        }
    }

    if (docs.length > 0) {
        await SessionBaseTrace.insertMany(docs);
    }
}

/**
 * Ricostruisce la stessa stringa XES che i worker si aspettano per appendXes.
 */
async function getSessionBaseLog(sessionId) {
    const SessionBaseLogMeta = getSessionBaseLogMetaModel();
    const SessionBaseTrace = getSessionBaseTraceModel();

    const meta = await SessionBaseLogMeta.findOne({ sessionId }).lean();
    if (!meta) return null;

    const chunkDocs = await SessionBaseTrace.find({ sessionId }).lean();
    const byCase = await groupChunksByKey(chunkDocs, (d) => d.caseId);

    const traceXmlList = [];
    for (const [, chunks] of byCase) {
        traceXmlList.push(joinChunkPayloads(chunks));
    }

    return buildXesFromParts(meta.xesHeader, traceXmlList);
}

async function deleteSessionBaseLog(sessionId) {
    const SessionBaseLogMeta = getSessionBaseLogMetaModel();
    const SessionBaseTrace = getSessionBaseTraceModel();
    await Promise.all([
        SessionBaseLogMeta.deleteOne({ sessionId }),
        SessionBaseTrace.deleteMany({ sessionId })
    ]);
}

function getSessionTimelineStepModel() {
    return mongoose.models.SessionTimelineStep ||
           mongoose.model('SessionTimelineStep', sessionTimelineStepSchema, 'SessionTimelineSteps');
}

function getSessionTimelineTraceModel() {
    return mongoose.models.SessionTimelineTrace ||
           mongoose.model('SessionTimelineTrace', sessionTimelineTraceSchema, 'SessionTimelineTraces');
}

/**
 * Salva meta step + tracce point-in-time separate (stesso snapshot logico di prima).
 */
async function appendTimelineStep(sessionId, snapshot) {
    const SessionTimelineStep = getSessionTimelineStepModel();
    const SessionTimelineTrace = getSessionTimelineTraceModel();

    const stepIndex = await SessionTimelineStep.countDocuments({ sessionId });
    const ruleResults = Array.isArray(snapshot.ruleResults) ? snapshot.ruleResults : [];

    const ruleSummaries = ruleResults.map((r) => ({
        ruleText: r.ruleText,
        ruleIndex: r.ruleIndex,
        ...(r.error ? { error: true } : {})
    }));

    await SessionTimelineStep.create({
        sessionId,
        stepIndex,
        step: snapshot.step,
        sourceType: snapshot.sourceType,
        sourceId: snapshot.sourceId,
        blockNumber: snapshot.blockNumber,
        ruleSummaries,
        createdAt: new Date()
    });

    const traceDocs = [];
    for (const ruleResult of ruleResults) {
        const ruleIndex = ruleResult.ruleIndex;
        for (const status of STATUS_BUCKETS) {
            const arr = ruleResult[status] || [];
            for (let i = 0; i < arr.length; i++) {
                const trace = arr[i];
                let caseId = extractCaseIdFromComplianceTrace(trace);
                if (!caseId) caseId = `unknown_${ruleIndex}_${status}_${i}`;

                const { kind, body } = serializeForStorage(trace);
                const chunks = splitIntoChunks(body);
                for (const c of chunks) {
                    traceDocs.push({
                        sessionId,
                        stepIndex,
                        ruleIndex,
                        caseId: String(caseId),
                        status,
                        payloadKind: kind,
                        chunkIndex: c.chunkIndex,
                        chunkTotal: c.chunkTotal,
                        payload: c.payload,
                        createdAt: new Date()
                    });
                }
            }
        }
    }

    if (traceDocs.length > 0) {
        await SessionTimelineTrace.insertMany(traceDocs);
    }

    return stepIndex;
}

/**
 * Ricostruisce lo stesso oggetto snapshot usato dal frontend.
 */
async function getTimelineStep(sessionId, stepIndex) {
    const SessionTimelineStep = getSessionTimelineStepModel();
    const SessionTimelineTrace = getSessionTimelineTraceModel();
    const idx = parseInt(stepIndex, 10);

    const meta = await SessionTimelineStep.findOne({ sessionId, stepIndex: idx }).lean();
    if (!meta) return null;

    const chunkDocs = await SessionTimelineTrace.find({ sessionId, stepIndex: idx }).lean();
    const byCaseRule = await groupChunksByKey(
        chunkDocs,
        (d) => `${d.ruleIndex}::${d.status}::${d.caseId}`
    );

    const tracesByRule = new Map();
    for (const [, chunks] of byCaseRule) {
        const sample = chunks[0];
        const trace = await readChunkedCasePayload(chunks);
        if (!tracesByRule.has(sample.ruleIndex)) {
            tracesByRule.set(sample.ruleIndex, {
                compliant: [],
                noncompliant: [],
                tempCompliant: [],
                tempNonCompliant: [],
                ignored: []
            });
        }
        const buckets = tracesByRule.get(sample.ruleIndex);
        if (buckets[sample.status]) {
            buckets[sample.status].push(trace);
        }
    }

    const ruleResults = (meta.ruleSummaries || []).map((summary) => {
        const buckets = tracesByRule.get(summary.ruleIndex) || {
            compliant: [],
            noncompliant: [],
            tempCompliant: [],
            tempNonCompliant: [],
            ignored: []
        };
        const result = {
            ruleText: summary.ruleText,
            ruleIndex: summary.ruleIndex,
            compliant: buckets.compliant,
            noncompliant: buckets.noncompliant,
            tempCompliant: buckets.tempCompliant,
            tempNonCompliant: buckets.tempNonCompliant,
            ignored: buckets.ignored
        };
        if (summary.error) result.error = true;
        return result;
    });

    return {
        step: meta.step,
        sourceType: meta.sourceType,
        sourceId: meta.sourceId,
        blockNumber: meta.blockNumber,
        ruleResults
    };
}

function getSessionResolvedTraceModel() {
    return mongoose.models.SessionResolvedTrace ||
           mongoose.model('SessionResolvedTrace', sessionResolvedTraceSchema, 'SessionResolvedTraces');
}

async function upsertResolvedTraces(sessionId, ruleIndex, updates) {
    if (!updates || Object.keys(updates).length === 0) return;

    const SessionResolvedTrace = getSessionResolvedTraceModel();
    const caseIds = Object.keys(updates).map(String);

    await SessionResolvedTrace.deleteMany({
        sessionId,
        ruleIndex,
        caseId: { $in: caseIds }
    });

    const docs = [];
    for (const [caseId, valString] of Object.entries(updates)) {
        const parsed = typeof valString === 'string' ? JSON.parse(valString) : valString;
        const { kind, body } = serializeForStorage(parsed.trace);
        const chunks = splitIntoChunks(body);
        for (const c of chunks) {
            docs.push({
                sessionId,
                ruleIndex,
                caseId: String(caseId),
                status: parsed.status,
                payloadKind: kind,
                chunkIndex: c.chunkIndex,
                chunkTotal: c.chunkTotal,
                payload: c.payload,
                updatedAt: new Date()
            });
        }
    }

    if (docs.length > 0) {
        await SessionResolvedTrace.insertMany(docs);
    }
}

async function getResolvedTraces(sessionId, ruleIndex, status) {
    const SessionResolvedTrace = getSessionResolvedTraceModel();
    const query = {
        sessionId,
        ruleIndex: parseInt(ruleIndex, 10)
    };
    if (status) {
        query.status = status;
    }

    const chunkDocs = await SessionResolvedTrace.find(query).lean();
    const byCase = await groupChunksByKey(chunkDocs, (d) => d.caseId);

    const traces = [];
    for (const [caseId, chunks] of byCase) {
        const trace = await readChunkedCasePayload(chunks);
        traces.push({
            caseId,
            status: chunks[0].status,
            trace
        });
    }
    return traces;
}

function getSessionRuleBlacklistModel() {
    return mongoose.models.SessionRuleBlacklist ||
           mongoose.model('SessionRuleBlacklist', sessionRuleBlacklistSchema, 'SessionRuleBlacklists');
}

async function getBlacklistCaseIds(sessionId, ruleIndex) {
    const SessionRuleBlacklist = getSessionRuleBlacklistModel();
    const doc = await SessionRuleBlacklist.findOne({
        sessionId,
        ruleIndex: parseInt(ruleIndex, 10)
    }).lean();
    return doc && Array.isArray(doc.caseIds) ? doc.caseIds : [];
}

async function addToBlacklist(sessionId, ruleIndex, caseIds) {
    if (!caseIds || caseIds.length === 0) return;

    const SessionRuleBlacklist = getSessionRuleBlacklistModel();
    await SessionRuleBlacklist.updateOne(
        { sessionId, ruleIndex: parseInt(ruleIndex, 10) },
        {
            $addToSet: { caseIds: { $each: caseIds.map(String) } },
            $set: { updatedAt: new Date() },
            $setOnInsert: { sessionId, ruleIndex: parseInt(ruleIndex, 10) }
        },
        { upsert: true }
    );
}

async function deleteSessionComplianceState(sessionId) {
    const SessionBaseLogMeta = getSessionBaseLogMetaModel();
    const SessionBaseTrace = getSessionBaseTraceModel();
    const SessionTimelineStep = getSessionTimelineStepModel();
    const SessionTimelineTrace = getSessionTimelineTraceModel();
    const SessionResolvedTrace = getSessionResolvedTraceModel();
    const SessionRuleBlacklist = getSessionRuleBlacklistModel();

    await Promise.all([
        SessionBaseLogMeta.deleteOne({ sessionId }),
        SessionBaseTrace.deleteMany({ sessionId }),
        SessionTimelineStep.deleteMany({ sessionId }),
        SessionTimelineTrace.deleteMany({ sessionId }),
        SessionResolvedTrace.deleteMany({ sessionId }),
        SessionRuleBlacklist.deleteMany({ sessionId })
    ]);
}

module.exports = {
    saveTransaction,
    saveExtractionLog,
    saveAbi,
    saveCompiledContractData,
    saveExtractionMetrics,
    saveBaselineWorkerMetrics,
    saveIndividualTraces,
    upsertSessionBaseLog,
    getSessionBaseLog,
    deleteSessionBaseLog,
    appendTimelineStep,
    getTimelineStep,
    upsertResolvedTraces,
    getResolvedTraces,
    getBlacklistCaseIds,
    addToBlacklist,
    deleteSessionComplianceState
}
