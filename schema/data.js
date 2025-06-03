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

const internalTxSchema = new mongoose.Schema({
    callType: {type: String},
    to: {type: String},
    inputsCall: [
        {type: mongoose.Schema.Types.Mixed}
    ],
    inputs: [
        {type:mongoose.Schema.Types.Mixed}
    ]
}, { _id : false });

const eventSchema = new mongoose.Schema({
    eventName: {type: String},
    eventValues: {type: mongoose.Schema.Types.Mixed}
}, { _id : false });

const transactionSchema = new mongoose.Schema({
    functionName: {type: String},
    transactionHash: {type: String, unique: true},
    contractAddress: {type: String},
    sender: {type: String},
    gasUsed: {type: Number},
    blockNumber: {type: Number},
    timestamp: {type: Date},
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
