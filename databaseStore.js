const {getModelByContractAddress} = require('./query/query');

function saveData(data, contractAddress) {

    const DynamicModel = getModelByContractAddress(contractAddress);

    const newTransaction = new DynamicModel(data);
    newTransaction.save()
        .then(() => {
            console.log('Transaction saved successfully');
        })
        .catch(error => {
            console.error('Error during saving transaction:', error);
        })
}

module.exports = {
    saveData
}