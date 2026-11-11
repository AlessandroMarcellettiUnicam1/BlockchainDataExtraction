// API verso il nodo (trace_filter, transazioni, blocchi, ricevute) usate per
// costruire l'elenco delle transazioni da estrarre a partire dagli indirizzi.
const axios = require("axios");
const { assignEventToInternal } = require("../decodingUtils/utils");
const { postJsonRpc, debugTransactionErigonStreaming } = require("../shared/jsonRpc");

// NOTA: questi due parametri sono fuori dall'oggetto filtro e quindi ignorati dal
// nodo; spostarli cambierebbe i risultati (after=1000 salta le prime 1000 trace).
// Mantenuti invariati (vedi CHANGELOG, punti dubbi).
const TRACE_FILTER_IGNORED_AFTER = 1000;
const TRACE_FILTER_IGNORED_COUNT = 100;
const HEX_RADIX = 16;

/**
 * Transazione (eth_getTransactionByHash).
 * NOTA: il nome è storico; l'export è mantenuto per compatibilità.
 * @param {string} transactionHash
 * @param {Object} networkData
 * @returns {Promise<Object>}
 */
async function getEventFromErigon(transactionHash, networkData) {
    return postJsonRpc(networkData.web3Endpoint, "eth_getTransactionByHash", [transactionHash]);
}

/** Ricevuta della transazione (eth_getTransactionReceipt). */
async function getTransactionReceipt(transactionHash, networkData) {
    return postJsonRpc(networkData.web3Endpoint, "eth_getTransactionReceipt", [transactionHash]);
}

/** Blocco per hash (eth_getBlockByHash). */
async function getBlockFromErigon(blockHash, networkData, fullTransactions) {
    return postJsonRpc(networkData.web3Endpoint, "eth_getBlockByHash", [blockHash, fullTransactions]);
}

/** "123" o 123 -> "0x7b" */
function toHexBlock(blockNumber) {
    return "0x" + parseInt(blockNumber).toString(HEX_RADIX);
}

/**
 * Una pagina di trace_filter.
 * @returns {Promise<Array>}
 */
async function fetchTracePage(networkData, contractAddressesFrom, contractAddressesTo, fromBlock, toBlock) {
    const payload = {
        jsonrpc: "2.0",
        method: "trace_filter",
        params: [{
            fromBlock: toHexBlock(fromBlock),
            toBlock: toHexBlock(toBlock),
            fromAddress: contractAddressesFrom,
            toAddress: contractAddressesTo,
        }],
        after: TRACE_FILTER_IGNORED_AFTER,
        count: TRACE_FILTER_IGNORED_COUNT,
        id: 1,
    };
    const response = await axios.post(networkData.web3Endpoint, payload, {
        headers: { "Content-Type": "application/json" },
    });
    return response.data.result || [];
}

/**
 * Tutte le trace tra fromBlock e toBlock che coinvolgono gli indirizzi indicati.
 * @returns {Promise<Array>}
 */
async function fetchAllTraces(contractAddressesFrom, contractAddressesTo, fromBlock, toBlock, networkData) {
    const traces = [];
    let currentFromBlock = fromBlock;
    // FIX-15: fromBlock/toBlock arrivano dal form come stringhe: il confronto
    // "<=" era lessicografico ("9000000" <= "10000000" è false) e l'estrazione
    // restituiva [] senza alcuna richiesta.
    while (Number(currentFromBlock) <= Number(toBlock)) {
        let page;
        try {
            // FIX-08: la richiesta usava sempre fromBlock invece di currentFromBlock
            // (stessa pagina all'infinito se l'ultima trace era prima di toBlock).
            page = await fetchTracePage(networkData, contractAddressesFrom, contractAddressesTo, currentFromBlock, toBlock);
        } catch (err) {
            console.error("debugInteralTransaction error:", err.message);
            throw err;
        }

        if (page.length === 0) {
            // FIX-08: una pagina vuota termina la paginazione senza scartare le trace
            // già lette (prima: log e "return []" a ogni pagina vuota).
            if (traces.length === 0) {
                console.log(`[Erigon API] Nessuna traccia disponibile (o blocco in fase di indicizzazione) per i blocchi ${fromBlock}-${toBlock}`);
            }
            break;
        }
        // FIX-08: le pagine vengono accumulate (prima ogni pagina sovrascriveva la precedente).
        for (const trace of page) {
            traces.push(trace);
        }

        // NOTA: trace_filter restituisce blockNumber in decimale (numero o stringa,
        // secondo la documentazione di Infura e Alchemy): parseInt(…, 16)
        // lo sovrastima e in pratica il ciclo termina dopo la prima pagina.
        // Mantenuto invariato (vedi CHANGELOG, punti dubbi).
        const lastBlockNumber = parseInt(page[page.length - 1].blockNumber, HEX_RADIX);
        if (lastBlockNumber >= toBlock) {
            console.log(`Reached target block ${toBlock}. Ending stream.`);
            break;
        }
        currentFromBlock = lastBlockNumber + 1;
    }
    return traces;
}

/**
 * Riepilogo della transazione pubblica a cui appartiene la trace.
 * @returns {Promise<{hash, from, to, value, gasUsed, input, blockNumber, timestamp}>}
 */
async function buildPublicTransaction(trace, networkData) {
    const txHash = trace.transactionHash;
    const publicTransaction = await getEventFromErigon(txHash, networkData);
    const block = await getBlockFromErigon(trace.blockHash, networkData, true);
    let contractAddress = publicTransaction.to;
    if (!publicTransaction.to) {
        // Creazione di contratto: l'indirizzo è nella ricevuta.
        const receipt = await getTransactionReceipt(txHash, networkData);
        contractAddress = receipt.contractAddress;
    }
    return {
        hash: txHash,
        from: publicTransaction.from,
        to: contractAddress,
        value: publicTransaction.value,
        gasUsed: publicTransaction.gas,
        input: publicTransaction.input,
        blockNumber: publicTransaction.blockNumber,
        timestamp: block.timestamp,
    };
}

/**
 * Elenco (senza duplicati) delle transazioni pubbliche che contengono chiamate
 * tra gli indirizzi indicati nel range di blocchi.
 *
 * @param {string[]} contractAddressesFrom
 * @param {string[]} contractAddressesTo
 * @param {number|string} fromBlock
 * @param {number|string} toBlock
 * @param {Object} networkData
 * @returns {Promise<Array<{hash, from, to, value, gasUsed, input, blockNumber, timestamp}>>}
 */
async function buildTransactionHierarchy(contractAddressesFrom, contractAddressesTo, fromBlock, toBlock, networkData) {
    const traces = await fetchAllTraces(contractAddressesFrom, contractAddressesTo, fromBlock, toBlock, networkData);

    const txMap = new Map();
    for (const trace of traces) {
        // Più trace della stessa transazione: le chiamate RPC servono solo la prima volta.
        if (txMap.has(trace.transactionHash)) continue;
        txMap.set(trace.transactionHash, await buildPublicTransaction(trace, networkData));
    }
    return Array.from(txMap.values());
}

module.exports = {
    assignEventToInternal,
    getEventFromErigon,
    debugTransactionErigonStreaming,
    buildTransactionHierarchy,
};
