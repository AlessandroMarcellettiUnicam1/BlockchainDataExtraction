const fs = require('fs');
const Transaction = require("../schema/data");

function save() {
    fs.readFile('query/exampleTransaction.json', 'utf8', (err, data) => {
        if (err) {
            console.error('Errore nella lettura del file:', err);
            return;
        }

        try {
            const transactions = JSON.parse(data);

            Transaction.insertMany(transactions)
                .then(savedTransactions => {
                    console.log('Transazioni salvate con successo nel database:', savedTransactions);
                })
                .catch(err => {
                    console.error('Errore nel salvataggio delle transazioni nel database:', err);
                });
        } catch (parseError) {
            console.error('Errore nell\'analisi del file JSON:', parseError);
        }
    });
}

module.exports = save;