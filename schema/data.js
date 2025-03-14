const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    transactionHash: {type: String, unique: true},
    contractAddress: {type: String},
    sender: {type: String},
    gasUsed: {type: Number},
    activity: {type: String},
    blockNumber: {type: Number},
    timestamp: {type: Date},
    inputs: [{
        inputId: {type: String},
        inputName: {type: String},
        type: {type: mongoose.Schema.Types.Mixed},
        inputValue: {type: mongoose.Schema.Types.Mixed}
    }],
    storageState: [{
        variableId: {type: String},
        variableName: {type: String},
        type: {type: String},
        variableValue: {type: String},
        variableRawValue: {type: String}
    }],
    internalTxs: [{
        callId: {type: String},
        callType: {type: String},
        to: {type: String},
        inputsCall: [
            {type: mongoose.Schema.Types.Mixed}
        ]
    }],
    events: [{
        eventId: {type: String},
        eventName: {type: String},
        eventValues: {type: mongoose.Schema.Types.Mixed}
    }]
});

const filterExtractionSchema = new mongoose.Schema({
    gasUsed: {type: mongoose.Schema.Types.Mixed},
    gasPrice: {type: mongoose.Schema.Types.Mixed},
    timestamp: {type: mongoose.Schema.Types.Mixed},
    senders: {type: Array},
    functions: {type: Array}
})

const extractionLogSchema = new mongoose.Schema({
    networkUsed: {type: String},
    contractAddress: {type: String},
    contractName: {type: String},
    fromBlock: {type: String},
    toBlock: {type: String},
    filters: {type: filterExtractionSchema},
    timestampLog: {type: String}
})

const extractionAbiSchema = new mongoose.Schema({
    contractName: {type: String},
    contractAddress: {type: String},
    abi: {type: String}
})
module.exports = {transactionSchema, extractionLogSchema,extractionAbiSchema};