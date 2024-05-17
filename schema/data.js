const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    txHash: { type: String, required: true, unique: true },
    sender: { type: String, required: true },
    gasUsed: { type: String, required: true },
    activity: { type: String, required: true },
    timestamp: { type: Date, required: true },
    inputs: [{
        name: { type: String },
        type: { type: String },
        value: { type: mongoose.Schema.Types.Mixed } // Può essere di diversi tipi
    }],
    storageState: [{
        name: { type: String },
        type: { type: String },
        value: { type: mongoose.Schema.Types.Mixed } // Può essere di diversi tipi
    }],
    internalTxs: [{
        type: { type: String },
        to: { type: String }
        // Altri campi se necessario
    }],
    events: [{
        name: { type: String },
        values: mongoose.Schema.Types.Mixed // Può essere di diversi tipi
    }]
});

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;