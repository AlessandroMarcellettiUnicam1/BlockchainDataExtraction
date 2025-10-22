const mongoose = require('mongoose');

const inputSchema = new mongoose.Schema({
    inputName: {type: String},
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
    eventValues: {type: mongoose.Schema.Types.Mixed}
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
    ]
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
    contractName: {type: String},
    contractAddress: {type: String},
    abi: {type: String}
})
module.exports = {transactionSchema, extractionLogSchema,extractionAbiSchema};
