const mongoose = require('mongoose');
const connectDB = require('../config/db');
const transactionSchema = require("../schema/data");

async function searchTransaction(query) {
    const {gasUsedFrom, gasUsedTo, blockNumberFrom, blockNumberTo, timestampFrom, timestampTo} = query;

    if (gasUsedFrom || gasUsedTo) {
        query.gasUsed = {};
        if (gasUsedFrom) query.gasUsed.$gte = gasUsedFrom;
        if (gasUsedTo) query.gasUsed.$lte = gasUsedTo;
    }

    if (blockNumberFrom || blockNumberTo) {
        query.blockNumber = {};
        if (blockNumberFrom) query.blockNumber.$gte = Number(blockNumberFrom);
        if (blockNumberTo) query.blockNumber.$lte = Number(blockNumberTo);
    }

    if (timestampFrom || timestampTo) {
        query.timestamp = {};
        if (timestampFrom) query.timestamp.$gte = new Date(timestampFrom);
        if (timestampTo) query.timestamp.$lte = new Date(timestampTo);
    }

    let network = query.network;
    delete query.network;

    console.log("Query received -> ", query);

    try {
        await connectDB(network)
            .then(res => console.log('Connected to MongoDB - ' + network))
            .catch(err => console.error(err));

        const collections = await mongoose.connection.db.listCollections().toArray();

        let results = [];

        for (let collectionsDB of collections) {
            const collection = mongoose.connection.db.collection(collectionsDB.name);
            const transactions = await collection.find(query).toArray();
            results = results.concat(transactions);
        }

        console.log("Results found length-> ", results.length);

        if (results.length > 0)
            return results;
        return null;
    } catch (err) {
        console.error('Error during query execution:', err);
        throw err;
    }
}

function getModelByContractAddress(contractAddress) {
    return mongoose.model(contractAddress, transactionSchema, contractAddress);
}

//cambiato nome alle collections
//query su più collection
//bug fix delle query dei campi annidati
//gestione dell'estrazione nel caso di txHash già presenti del database
//creare un db per ogni network
//generalizzare metodo estrazione query
//tradurre tutto in inglese

module.exports = {getModelByContractAddress, searchTransaction};
