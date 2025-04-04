const {connectDB} = require("./config/db");
const mongoose = require("mongoose");
const {extractionLogSchema,extractionAbiSchema} = require("./schema/data");
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
    let query = {
        contractName: storeAbi.contractName,
        contractAddress: storeAbi.contractAddress.toLowerCase()
    };
    const response = await searchAbi(query);
    if(response){
        return;
    }else{
        try {
            const ExtractionAbi = mongoose.model('ExtractionAbi', extractionAbiSchema, 'ExtractionAbi');
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
module.exports = {
    saveTransaction,
    saveExtractionLog,
    saveAbi
}