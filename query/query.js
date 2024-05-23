const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const app = express();
const saveTransaction = require("./saveTransaction");
const Transaction = require("../schema/data");

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'query')));

app.get('/save', saveTransaction);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'query.html'));
});

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

app.post('/api/find', (req, res) => {
    const id = req.body.id;
    //console.log(id);

    Transaction.findById(id)
        .then(transaction => {
            if (!transaction) {
                return res.status(404).json({ message: 'Transazione non trovata' });
            }
            res.json(transaction);
        })
        .catch(err => res.status(400).json({ message: err.message }));
});

module.exports = app;