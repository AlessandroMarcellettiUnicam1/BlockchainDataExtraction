const {connectDB} = require("./config/db");
const mongoose = require("mongoose");
const {extractionLogSchema,extractionAbiSchema} = require("./schema/data");
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
        throw new Error(err.message)
    }
}
async function saveAbi(storeAbi) {
    try {
        await connectDB(process.env.LOG_DB_NAME);
        const ExtractionAbi = mongoose.model('ExtractionAbi', extractionAbiSchema, 'ExtractionAbi');
        const newExtractionLog = new ExtractionAbi(storeAbi);
        await newExtractionLog.save();
        console.log('Extraction log successfully saved');
    } catch (err) {
        console.error('Error saving data: ', err);
    }
}
module.exports = {
    saveTransaction,
    saveExtractionLog,
    saveAbi
}