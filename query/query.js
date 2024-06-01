const express = require('express');
const app = express();
const mongoose = require('mongoose');
const Transaction = require("../schema/data");

const saveTransaction = require("./saveTransactions");
app.get('/save', saveTransaction);

app.post('/api/query', async (req, res) => {
    const {gasUsedFrom, gasUsedTo, blockNumberFrom, blockNumberTo, timestampFrom, timestampTo, ...rest} = req.body;

    const query = {...rest};

    if (gasUsedFrom || gasUsedTo) {
        query.gasUsed = {};
        if (gasUsedFrom) query.gasUsed.$gte = gasUsedFrom;
        if (gasUsedTo) query.gasUsed.$lte = gasUsedTo;
    }

    if (blockNumberFrom || blockNumberTo) {
        query.blockNumber = {};
        if (blockNumberFrom) query.blockNumber.$gte = blockNumberFrom;
        if (blockNumberTo) query.blockNumber.$lte = blockNumberTo;
    }

    if (timestampFrom || timestampTo) {
        query.timestamp = {};
        if (timestampFrom) query.timestamp.$gte = new Date(timestampFrom);
        if (timestampTo) query.timestamp.$lte = new Date(timestampTo);
    }

    try {
        const collections = await mongoose.connection.db.listCollections().toArray();

        let results = [];

        for (let collectionsDB of collections) {
            const collection = mongoose.connection.db.collection(collectionsDB.name);
            const transactions = await collection.find(query).toArray();
            results = results.concat(transactions);
        }

        console.log(collections)
        console.log(results)

        res.json(results);
    } catch (err) {
        console.error('Errore durante l\'esecuzione della query:', err);
        res.status(500).json({error: err.message});
    }
});

//TODO: cambiare nome alle collections
//TODO: query su più collection
//TODO: bug fix delle query dei campi annidati

//TODO: gestire l'estrazione nel caso di txHash già presenti del database

module.exports = app;
