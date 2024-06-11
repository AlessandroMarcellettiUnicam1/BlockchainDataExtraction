const express = require('express');
const app = express();
const mongoose = require('mongoose');

const { save } = require("./saveTransactions");
app.get('/save', (req, res) => {
    try {
        save();
        res.send('Salvataggio completato');
    } catch (err) {
        console.error('Errore durante il salvataggio delle transazioni:', err);
    }
});

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
        if (blockNumberFrom) query.blockNumber.$gte = Number(blockNumberFrom);
        if (blockNumberTo) query.blockNumber.$lte = Number(blockNumberTo);
    }

    if (timestampFrom || timestampTo) {
        query.timestamp = {};
        if (timestampFrom) query.timestamp.$gte = new Date(timestampFrom);
        if (timestampTo) query.timestamp.$lte = new Date(timestampTo);
    }

    console.log(query);

    try {
        const collections = await mongoose.connection.db.listCollections().toArray();

        let results = [];

        for (let collectionsDB of collections) {
            const collection = mongoose.connection.db.collection(collectionsDB.name);
            const transactions = await collection.find(query).toArray();
            results = results.concat(transactions);
        }

        res.json(results);
    } catch (err) {
        console.error('Errore durante l\'esecuzione della query:', err);
        res.status(500).json({error: err.message});
    }
});

//cambiato nome alle collections
//query su più collection
//bug fix delle query dei campi annidati
//gestione dell'estrazione nel caso di txHash già presenti del database

//TODO: creare un db per ogni network, backlog per ogni query creata

module.exports = app;
