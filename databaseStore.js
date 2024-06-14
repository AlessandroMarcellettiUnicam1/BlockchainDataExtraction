const {connectDB} = require("./config/db");
const mongoose = require("mongoose");
const {extractionLogSchema} = require("./schema/data");
const {getModelByContractAddress} = require('./query/query');

async function saveTransaction(data, contractAddress) {
    try {
        const TransactionModel = getModelByContractAddress(contractAddress);
        const newTransaction = new TransactionModel(data);
        await newTransaction.save()
        console.log('Transaction logs successfully saved');
    } catch (err) {
        console.error('Error saving data: ', err);
    }
}

async function saveExtractionLog(userLog) {
    try {
        await connectDB(process.env.LOG_DB_NAME);
        const ExtractionLog = mongoose.model('ExtractionLog', extractionLogSchema, 'ExtractionLog');
        const newExtractionLog = new ExtractionLog(userLog);
        await newExtractionLog.save();
        console.log('Extraction log successfully saved');
    } catch (err) {
        console.error('Extraction log storing error: ', err);
    }
}

module.exports = {
    saveTransaction,
    saveExtractionLog
}