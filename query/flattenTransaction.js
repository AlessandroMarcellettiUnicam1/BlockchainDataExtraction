export async function getAllTransactions(transactions) {
    if(transactions.length===0){
        return [];
    }
    let result = [];
    let i = 0;
    for(const transaction of transactions) {
        result = result.concat(transaction);
        result = result.concat(await flattenInternalTransactions(transaction.internalTxs,
                                                                    transaction.timestamp,
                                                                    transaction.transactionHash,
                                                                    transaction.blockNumber,
                                                               [i]));
        i++;
    }
    return result;
}

async function flattenInternalTransactions(transactions,timestamp,txHash,blockNumber,path){
    if(!Array.isArray(transactions) || transactions.length===0){
        return [];
    }
    let i = 0;
    let result = [];
    result = result.concat(transactions);
    for(const transaction of transactions) {
        transaction.timestamp = timestamp;
        transaction.transactionHash = `${txHash}-${path.concat(i).join("-")}`;
        transaction.blockNumber = blockNumber;
        result = result.concat(await flattenInternalTransactions(transaction.calls,timestamp,txHash,blockNumber,path));
        i++;
    }

    return result.map(item=>changeKey(item,"to","contractAddress")).
                    map(item=>changeKey(item,"from","sender"));

}

function changeKey(obj, oldKey, newKey){
    if(obj.hasOwnProperty(oldKey)){
        obj[newKey] = obj[oldKey];
        delete obj[oldKey];
    }
    return obj;
}