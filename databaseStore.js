const Transaction = require('./schema/data.js');
function saveData(data) {

    const newTransaction = new Transaction(data)

    newTransaction.save()
        .then(() => {
            console.log('Transazione salvata con successo');
        })
        .catch(error => {
            console.error('Errore durante il salvataggio della transazione:', error);
        })
}

module.exports = {
    saveData
}