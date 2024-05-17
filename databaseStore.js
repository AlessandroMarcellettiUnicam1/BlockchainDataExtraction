const Transaction = require('./schema/data.js');
function saveData(data) {

    const newTransaction = new Transaction(data)

    newTransaction.save()
        .then(transaction => {
            console.log('Transazione salvata con successo:', transaction);
        })
        .catch(error => {
            console.error('Errore durante il salvataggio della transazione:', error);
        })
}

module.exports = {
    saveData
}