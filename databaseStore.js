const {connectDB} = require("./config/db");
const mongoose = require("mongoose");
const {
    extractionLogSchema,
    extractionAbiSchema,
    extractionMetricsSchema,
    baselineWorkerMetricsSchema,
    singleTraceSchema,
    sessionBaseLogSchema,
    sessionTimelineStepSchema,
    sessionResolvedTraceSchema,
    sessionRuleBlacklistSchema
} = require("./schema/data");
const {getModelByContractAddress} = require('./query/query');
const {searchAbi} =require("./query/query");

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

function getSessionBaseLogModel() {
    return mongoose.models.SessionBaseLog ||
           mongoose.model('SessionBaseLog', sessionBaseLogSchema, 'SessionBaseLogs');
}

async function upsertSessionBaseLog(sessionId, xesString, ttlSeconds = 259200) {
    const SessionBaseLog = getSessionBaseLogModel();
    const expiresAt = ttlSeconds
        ? new Date(Date.now() + ttlSeconds * 1000)
        : undefined;

    await SessionBaseLog.findOneAndUpdate(
        { sessionId },
        {
            sessionId,
            xes: xesString,
            updatedAt: new Date(),
            ...(expiresAt ? { expiresAt } : {})
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
}

async function getSessionBaseLog(sessionId) {
    const SessionBaseLog = getSessionBaseLogModel();
    const doc = await SessionBaseLog.findOne({ sessionId }).lean();
    return doc ? doc.xes : null;
}

async function deleteSessionBaseLog(sessionId) {
    const SessionBaseLog = getSessionBaseLogModel();
    await SessionBaseLog.deleteOne({ sessionId });
}

function getSessionTimelineStepModel() {
    return mongoose.models.SessionTimelineStep ||
           mongoose.model('SessionTimelineStep', sessionTimelineStepSchema, 'SessionTimelineSteps');
}

async function appendTimelineStep(sessionId, snapshot) {
    const SessionTimelineStep = getSessionTimelineStepModel();
    const stepIndex = await SessionTimelineStep.countDocuments({ sessionId });
    await SessionTimelineStep.create({
        sessionId,
        stepIndex,
        snapshot,
        createdAt: new Date()
    });
    return stepIndex;
}

async function getTimelineStep(sessionId, stepIndex) {
    const SessionTimelineStep = getSessionTimelineStepModel();
    const doc = await SessionTimelineStep.findOne({
        sessionId,
        stepIndex: parseInt(stepIndex, 10)
    }).lean();
    return doc ? doc.snapshot : null;
}

function getSessionResolvedTraceModel() {
    return mongoose.models.SessionResolvedTrace ||
           mongoose.model('SessionResolvedTrace', sessionResolvedTraceSchema, 'SessionResolvedTraces');
}

async function upsertResolvedTraces(sessionId, ruleIndex, updates) {
    if (!updates || Object.keys(updates).length === 0) return;

    const SessionResolvedTrace = getSessionResolvedTraceModel();
    const ops = [];

    for (const [caseId, valString] of Object.entries(updates)) {
        const parsed = typeof valString === 'string' ? JSON.parse(valString) : valString;
        ops.push({
            updateOne: {
                filter: { sessionId, ruleIndex, caseId: String(caseId) },
                update: {
                    $set: {
                        sessionId,
                        ruleIndex,
                        caseId: String(caseId),
                        status: parsed.status,
                        trace: parsed.trace,
                        updatedAt: new Date()
                    }
                },
                upsert: true
            }
        });
    }

    if (ops.length > 0) {
        await SessionResolvedTrace.bulkWrite(ops);
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

    const docs = await SessionResolvedTrace.find(query).lean();
    return docs.map(doc => ({
        caseId: doc.caseId,
        status: doc.status,
        trace: doc.trace
    }));
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
    const SessionBaseLog = getSessionBaseLogModel();
    const SessionTimelineStep = getSessionTimelineStepModel();
    const SessionResolvedTrace = getSessionResolvedTraceModel();
    const SessionRuleBlacklist = getSessionRuleBlacklistModel();

    await Promise.all([
        SessionBaseLog.deleteOne({ sessionId }),
        SessionTimelineStep.deleteMany({ sessionId }),
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
