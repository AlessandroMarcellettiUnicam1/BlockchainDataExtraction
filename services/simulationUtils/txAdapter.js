function adaptMempoolTx(tx) {
    const result = {
        from: tx.from,
        to: tx.to,
        data: tx.data || tx.input || '0x',
    }

    if (tx.gas !== undefined) result.gas = toSafeHex(tx.gas);
    if (tx.value !== undefined) result.value = toSafeHex(tx.value);
    if (tx.nonce !== undefined) result.nonce = toSafeHex(tx.nonce);

    const type = tx.type !== undefined ? tx.type.toString() : '0';

    if (type === "0" || type === "0x0" || type === "0n") {
        // Transazione Legacy (Tipo 0)
        result.gasPrice = toSafeHex(tx.gasPrice);
    } 
    else if (type === "2" || type === "0x2" || type === "2n") {
        // Transazione EIP-1559 (Tipo 2)
        result.maxFeePerGas = toSafeHex(tx.maxFeePerGas);
        result.maxPriorityFeePerGas = toSafeHex(tx.maxPriorityFeePerGas);
    } 
    else {
        // fallback per altri tipi
        if (tx.gasPrice) result.gasPrice = toSafeHex(tx.gasPrice);
    }

    if (tx.accessList) result.accessList = tx.accessList;

    let block = "latest";
    if (tx.blockNumber) block = toSafeHex(tx.blockNumber);

    const configObject = {};
    if (tx.transactionIndex !== null && tx.transactionIndex !== undefined) {
        configObject.transactionIndex = toSafeHex(tx.transactionIndex);
    }

    return [result, block, configObject];
}


// helper per una conversione sicura in esadecimale dai dati in arrivo da Web3.js
function toSafeHex(value) {
    if (value === undefined || value === null)
        return undefined;

    if (typeof value === 'string' && value.startsWith('0x'))
        return value;

    return '0x' + BigInt(value).toString(16);
}

module.exports = {
    adaptMempoolTx
}
