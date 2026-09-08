const mongoose = require('mongoose');

const inputSchema = new mongoose.Schema({
    inputName: {type: mongoose.Schema.Types.Mixed},
    type: {type: mongoose.Schema.Types.Mixed},
    inputValue: {type: mongoose.Schema.Types.Mixed}
}, { _id : false });

const storageStateSchema = new mongoose.Schema({
    variableName: {type: String},
    type: {type: String},
    variableValue: {type: String},
    variableRawValue: {type: String}
}, { _id : false });

const eventSchema = new mongoose.Schema({
    eventName: {type: String},
    eventValues: {type: mongoose.Schema.Types.Mixed},
    eventFrom:{type:String}
}, { _id : false });

const internalTxSchema = new mongoose.Schema({
    callType: {type: String},
    callId:{type:String},
    to: {type: String},
    inputsCall: [
        {type: mongoose.Schema.Types.Mixed}
    ],
    inputs: [
        {type:mongoose.Schema.Types.Mixed}
    ],
    from: {type: String, required: false},
    gas: {type: Number, required: false},
    gasUsed: {type: Number, required: false},
    output: {type: String, required: false},
    value: {type: mongoose.Schema.Types.Mixed, required: false}, // Can be Number or String for big values
    type: {type: String, required: false}, // CALL, STATICCALL, DELEGATECALL, etc.
    depth: {type: Number, required: false},
    activity: {type: String, required: false},
    contractCalledName: {type: String, required: false},
    input: {type: String, required: false}, // Raw input data
    storageState:[
        storageStateSchema
    ],
    calls: [mongoose.Schema.Types.Mixed], // Nested calls
    events: [
        eventSchema
    ]
}, { _id : false });


const transactionSchema = new mongoose.Schema({
    functionName: {type: String},
    transactionHash: {type: String, unique: true},
    contractAddress: {type: String},
    sender: {type: String},
    gasUsed: {type: Number},
    blockNumber: {type: Number},
    timestamp: {type: Date},
    value:{type:Number},
    inputs: [
        inputSchema
    ],
    storageState: [
        storageStateSchema
    ],
    internalTxs: [
        internalTxSchema
    ],
    events: [
        eventSchema
    ],
    status: { type: String, default: "Success"}
}, { versionKey: false });

const filterExtractionSchema = new mongoose.Schema({
    gasUsed: {type: mongoose.Schema.Types.Mixed},
    gasPrice: {type: mongoose.Schema.Types.Mixed},
    timestamp: {type: mongoose.Schema.Types.Mixed},
    senders: {type: Array},
    functions: {type: Array}
}, { _id : false });

const extractionLogSchema = new mongoose.Schema({
    networkUsed: {type: String},
    contractAddress: {type: String},
    contractName: {type: String},
    fromBlock: {type: String},
    toBlock: {type: String},
    filters: {type: filterExtractionSchema},
    timestampLog: {type: String}
}, {versionKey: false});

const extractionAbiSchema = new mongoose.Schema({
    abi:{type:String},
    contractName:{type:String},
    proxy: {type: String},
    proxyImplementation:{type:String},
    contractAddress: {type: String},
    sourceCode:{type:String},
    compilerVersion:{type:String},
    fullContractTree: {type: mongoose.Schema.Types.Mixed},
    storageLayoutFlag: {type: Boolean},
    contractCompiled: {type: mongoose.Schema.Types.Mixed},
    compiledAt: {type: Date},
})

const extractionMetricsSchema = new mongoose.Schema({
    transactionHash: { type: String, required: true },
    blockNumber: { type: Number },

    time_totalTransactionExtraction: { type: Number },
    
    time_getContractCodeEtherscan: { type: Number },
    time_getCompiledData: { type: Number },
    time_getContractTreeTotal: { type: Number },

    time_traceFilter: { type: Number },
    time_processTraceBatch: { type: Number },
    time_getCode_onlypubliccontract: { type: Number },
    time_compile: { type: Number },
    time_debug_trace_trace: { type: Number },
    
    time_debugErigon: { type: Number },
    time_traceStorageErigon: { type: Number },
    time_getTraceStorageErigonTotal: { type: Number },
    time_parseTraceStreamErigon: { type: Number },
    time_debugStandard: { type: Number },
    time_traceStorageStandard: { type: Number },
    time_getEvents: { type: Number },

    time_processTraceErigon: { type: Number },
    time_optimizedDecodeValuesErigon: { type: Number },
    time_decodeInternalTransactionErigon: { type: Number },
    time_newDecodedInternalTransactioneErigon: { type: Number },
    time_assignStorageToTheInternalErigon: { type: Number },
    time_decodeInternalTxsStorageErigon: { type: Number },

    time_processTraceStandard: { type: Number },
    time_optimizedDecodeValuesStandard: { type: Number },
    time_decodeInternalTransactionStandard: { type: Number },
    time_newDecodedInternalTransactioneStandard: { type: Number },

    time_decodeStorage_public: { type: Number },
    time_getCode_allInternalContracts_decode: { type: Number },
    time_decodeStorage_internalTx: { type: Number },
    time_saveAbi: { type: Number },
    time_saveTransaction: { type: Number },
    time_workerTotal: { type: Number },
    number_internalTxs: { type: Number },
    number_internalTxsVisited: { type: Number },

    time_debugInternalCallTracer: { type: Number },
    time_connectDbInternal: { type: Number },
    time_decodeInternalRecursive: { type: Number },
    time_newDecodedInternalTransactionDetailed: { type: Number },
    time_searchAbiInternal: { type: Number },
    time_fetchAbiInternal: { type: Number },
    time_fetchAbiDelayInternal: { type: Number },
    time_decodeInputsInternal: { type: Number },
    time_4byteLookupInternal: { type: Number },
    time_getEventsInternal: { type: Number },

    timestamp: { type: Date, default: Date.now }
}, { versionKey: false });

const traceMetricSchema = new mongoose.Schema({
    case_id: { type: String },
    number_of_events: { type: Number },
    validation_time_ms: { type: Number },
    trace_status: { type: String }
}, { _id: false });

const baselineWorkerMetricsSchema = new mongoose.Schema({
    blockNumber: { type: Number, required: true },
    number_txs_extracted: { type: Number },
    
    time_totalExtractionPhase: { type: Number },
    time_pythonConversion: { type: Number },
    time_xesAppend: { type: Number },
    time_ruleVerification: { type: Number },
    time_redisVerificationQueries: { type: Number, required: false },
    rules_number: { type: Number },
    
    rule_1_metrics: [traceMetricSchema],
    rule_2_metrics: [traceMetricSchema],
    rule_3_metrics: [traceMetricSchema],
    rule_4_metrics: [traceMetricSchema],
    rule_5_metrics: [traceMetricSchema],
    rule_6_metrics: [traceMetricSchema],

    time_totalJob: { type: Number },
    timestamp: { type: Date, default: Date.now }
},{ versionKey: false, strict: false });

const singleTraceSchema = new mongoose.Schema({
    sessionId: { type: String, required: true }, 
    case_id: { type: String, required: true },
    trace_xml: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
}, { versionKey: false });

// Meta del base log (solo header XES + TTL). Le tracce stanno in SessionBaseTraces.
const sessionBaseLogMetaSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, unique: true, index: true },
    xesHeader: { type: String, required: true },
    expiresAt: { type: Date, required: false },
    updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });

sessionBaseLogMetaSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Traccia XES del base log, eventualmente spezzata in chunk
const sessionBaseTraceSchema = new mongoose.Schema({
    sessionId: { type: String, required: true },
    caseId: { type: String, required: true },
    chunkIndex: { type: Number, required: true, default: 0 },
    chunkTotal: { type: Number, required: true, default: 1 },
    payload: { type: String, required: true },
    updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });

sessionBaseTraceSchema.index({ sessionId: 1, caseId: 1, chunkIndex: 1 }, { unique: true });
sessionBaseTraceSchema.index({ sessionId: 1 });

// Metadati step timeline (senza tracce inline)
const sessionTimelineStepSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, index: true },
    stepIndex: { type: Number, required: true },
    step: { type: mongoose.Schema.Types.Mixed },
    sourceType: { type: String },
    sourceId: { type: String },
    blockNumber: { type: Number },
    ruleSummaries: [{
        ruleText: { type: String },
        ruleIndex: { type: Number },
        error: { type: Boolean, required: false },
        _id: false
    }],
    createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

sessionTimelineStepSchema.index({ sessionId: 1, stepIndex: 1 }, { unique: true });

// Tracce point-in-time dello step timeline (chunkabili)
const sessionTimelineTraceSchema = new mongoose.Schema({
    sessionId: { type: String, required: true },
    stepIndex: { type: Number, required: true },
    ruleIndex: { type: Number, required: true },
    caseId: { type: String, required: true },
    status: { type: String, required: true },
    payloadKind: { type: String, enum: ['string', 'json'], default: 'json' },
    chunkIndex: { type: Number, required: true, default: 0 },
    chunkTotal: { type: Number, required: true, default: 1 },
    payload: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

sessionTimelineTraceSchema.index(
    { sessionId: 1, stepIndex: 1, ruleIndex: 1, caseId: 1, chunkIndex: 1 },
    { unique: true }
);
sessionTimelineTraceSchema.index({ sessionId: 1, stepIndex: 1 });

// Resolved traces per regola (chunkabili)
const sessionResolvedTraceSchema = new mongoose.Schema({
    sessionId: { type: String, required: true },
    ruleIndex: { type: Number, required: true },
    caseId: { type: String, required: true },
    status: { type: String, required: true },
    payloadKind: { type: String, enum: ['string', 'json'], default: 'json' },
    chunkIndex: { type: Number, required: true, default: 0 },
    chunkTotal: { type: Number, required: true, default: 1 },
    payload: { type: String, required: true },
    updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });

sessionResolvedTraceSchema.index(
    { sessionId: 1, ruleIndex: 1, caseId: 1, chunkIndex: 1 },
    { unique: true }
);
sessionResolvedTraceSchema.index({ sessionId: 1, ruleIndex: 1, status: 1 });

const sessionRuleBlacklistSchema = new mongoose.Schema({
    sessionId: { type: String, required: true },
    ruleIndex: { type: Number, required: true },
    caseIds: { type: [String], default: [] },
    updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });

sessionRuleBlacklistSchema.index({ sessionId: 1, ruleIndex: 1 }, { unique: true });

module.exports = {
    transactionSchema, 
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
};
