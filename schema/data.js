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
})

const extractionMetricsSchema = new mongoose.Schema({
    transactionHash: { type: String, required: true },
    blockNumber: { type: Number },
    
    time_getContractCodeEtherscan: { type: Number },
    time_getCompiledData: { type: Number },
    time_getContractTreeTotal: { type: Number },
    
    time_debugErigon: { type: Number },
    time_traceStorageErigon: { type: Number },
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

    timestamp: { type: Date, default: Date.now }
}, { versionKey: false });

const baselineWorkerMetricsSchema = new mongoose.Schema({
    jobId: { type: String, required: true },
    blockNumber: { type: Number, required: true },
    
    time_totalExtractionPhase: { type: Number },
    time_pythonConversion: { type: Number },
    time_xesAppend: { type: Number },
    time_ruleVerification: { type: Number },
    time_totalJob: { type: Number },
    
    status: { type: String, enum: ['Success', 'No_Logs_Extracted', 'Failed'], default: 'Success' },
    timestamp: { type: Date, default: Date.now }
}, { versionKey: false });


module.exports = {
    transactionSchema, 
    extractionLogSchema,
    extractionAbiSchema, 
    extractionMetricsSchema,
    baselineWorkerMetricsSchema
};
