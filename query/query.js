const express = require('express');
const app = express();
const Transaction = require("../schema/data");

/*const saveTransaction = require("./saveTransactions")
app.get('/save', saveTransaction);
app.get('/api/fields', (req, res) => {
    function getAllFields(schema, prefix = '') {
        let fields = [];
        for (const path in schema.paths) {
            const fullPath = prefix ? `${prefix}.${path}` : path;
            if (schema.paths[path].instance === 'ObjectID' || !schema.paths[path].schema) {
                fields.push(fullPath);
            } else {
                const nestedFields = getAllFields(schema.paths[path].schema, fullPath);
                fields = fields.concat(nestedFields);
            }
        }
        return fields;
    }

    const fields = getAllFields(Transaction.schema);
    res.json(fields);
});

app.post('/api/all', (req, res) => {
    Transaction.find()
        .then(transactions => res.json(transactions))
        .catch(err => res.status(500).json({error: err.message}));
});*/

app.post('/api/query', (req, res) => {
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

    console.log(query)

    Transaction.find(query)
        .then(transactions => res.json(transactions))
        .catch(err => res.status(500).json({error: err.message}));
});

module.exports = app;