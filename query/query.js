const express = require('express');
const app = express();
const Transaction = require("../schema/data");

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
});

app.post('/api/query', (req, res) => {
    const query = req.body;
    //console.log(query);
    Transaction.find(query)
        .then(transactions => res.json(transactions))
        .catch(err => res.status(500).json({error: err.message}));
});

//TODO: interfaccia con React, filtri con range, bottone download per transazioni

module.exports = app;