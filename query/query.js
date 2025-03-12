const mongoose = require('mongoose');
const {connectDB} = require("../config/db");
const {
    transactionSchema,
} = require("../schema/data");


async function searchTransaction(query) {
    const {gasUsedFrom, gasUsedTo, blockNumberFrom, blockNumberTo, timestampFrom, timestampTo} = query;

    if (gasUsedFrom || gasUsedTo) {
        query.gasUsed = {};
        if (gasUsedFrom) query.gasUsed.$gte = Number(gasUsedFrom);
        if (gasUsedTo) query.gasUsed.$lte = Number(gasUsedTo);
        delete query.gasUsedFrom;
        delete query.gasUsedTo;
    }

    if (blockNumberFrom || blockNumberTo) {
        query.blockNumber = {};
        if (blockNumberFrom) query.blockNumber.$gte = Number(blockNumberFrom);
        if (blockNumberTo) query.blockNumber.$lte = Number(blockNumberTo);
        delete query.blockNumberFrom
        delete query.blockNumberTo
    }

    if (timestampFrom || timestampTo) {
        query.timestamp = {};
        if (timestampFrom) query.timestamp.$gte = new Date(timestampFrom);
        if (timestampTo) query.timestamp.$lte = new Date(timestampTo);
        delete query.timestampFrom
        delete query.timestampTo;
    }
    console.log("Query received -> ", query);

    try {
        let results = [];

        if (query.contractAddress) {
            const collection = mongoose.connection.db.collection(query.contractAddress);
            const transactions = await collection.find(query).toArray();
            results = results.concat(transactions);
        } else {
            const collections = await mongoose.connection.db.listCollections().toArray();
            for (let collectionsDB of collections) {
                const collection = mongoose.connection.db.collection(collectionsDB.name);
                const transactions = await collection.find(query).toArray();
                results = results.concat(transactions);
            }
        }

        if (results.length > 0)
            return results;
        return null;
    } catch (err) {
        console.error('Error during query execution:', err);
        throw new Error(err.message);
    }
}

function getModelByContractAddress(contractAddress) {
    return mongoose.model(contractAddress, transactionSchema, contractAddress);
}
async function searchAbi(query) { 
    const { contractAddress } = query;
    
    if (!contractAddress) {
        throw new Error("Contract address is required.");
    }

    try {
        const collection = mongoose.connection.db.collection('ExtractionAbi'); 
        const result = await collection.find(query).toArray();
        if(result.length>0){
            return result[0];
        }
        return null;

    } catch (error) {
        console.error("Error fetching ABI:", error);
        throw new Error(error.message);
    }
    
}
module.exports = {getModelByContractAddress, searchTransaction,searchAbi};
