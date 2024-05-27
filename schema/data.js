const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    txHash: { type: String, required: true, unique: true },
    contractAddress: { type: String, required: true },
    sender: { type: String, required: true },
    gasUsed: { type: String, required: true },
    activity: { type: String, required: true },
    blockNumber: {type: Number, required: true },
    timestamp: { type: Date, required: true },
    inputs: [{
        inputId: {type: String },
        inputName: { type: String },
        type: { type: mongoose.Schema.Types.Mixed },
        inputValue: { type: mongoose.Schema.Types.Mixed }
    }],
    storageState: [{
        variableId: {type: String },
        variableName: { type: String },
        type: { type: String },
        variableValue: { type: String },
        variableRawValue: { type: String }
    }],
    internalTxs: [{
        callId: { type: String },
        callType: { type: String },
        to: { type: String },
        inputsCall: [
            { type: mongoose.Schema.Types.Mixed }
        ]
    }],
    events: [{
        eventId: { type: String },
        eventName: { type: String },
        eventValues: { type: mongoose.Schema.Types.Mixed }
    }]
});

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;