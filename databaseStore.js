const {getModelByContractAddress} = require('./query/saveTransactions');

function saveData(data, contractAddress) {

    const DynamicModel = getModelByContractAddress(contractAddress);

    const newTransaction = new DynamicModel(data);
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