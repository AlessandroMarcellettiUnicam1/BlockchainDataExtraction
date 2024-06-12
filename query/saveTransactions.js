const fs = require('fs');
const mongoose = require('mongoose');
const {transactionSchema, extractionLogSchema} = require("../schema/data");

function getModelByContractAddress(contractAddress) {
    return mongoose.model(contractAddress, transactionSchema, contractAddress);
}

function save() {
    fs.readFile('query/exampleTransaction.json', 'utf8', (err, data) => {
        if (err) {
            console.error('Errore nella lettura del file:', err);
            return;
        }

        try {
            const transactions = JSON.parse(data);

            transactions.forEach(transaction => {
                const contractAddress = transaction.contractAddress;
                const DynamicModel = getModelByContractAddress(contractAddress);

                const newTransaction = new DynamicModel(transaction);
                newTransaction.save()
                    .then(savedTransaction => {
                        console.log(`Transazione salvata con successo nella collezione ${contractAddress}:`, savedTransaction);
                    })
                    .catch(err => {
                        console.error(`Errore nel salvataggio della transazione nella collezione ${contractAddress}:`, err);
                    });
            });
        } catch (parseError) {
            console.error('Errore nell\'analisi del file JSON:', parseError);
        }
    });
}

module.exports = {save, getModelByContractAddress};