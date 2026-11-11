// Punto d'ingresso dell'estrazione storica: costruisce l'elenco delle transazioni,
// recupera/compila il contratto e avvia un worker (processo figlio) per ogni transazione.
require("dotenv").config();
const axios = require("axios");
const hre = require("hardhat");
const path = require("path");
const { fork } = require("child_process");
// MIGRAZIONE: dentro services/ExtractionModule i tre percorsi diventano
// "../../query/query", "../../config/db" e "../../databaseStore"
const { searchTransaction, searchAbi } = require("../../../query/query");
const { connectDB } = require("../../../config/db");
const { saveExtractionMetrics, saveCompiledContractData } = require("../../../databaseStore");
const { getCompiledData, getContractCodeEtherscan } = require("../contractUtils/utils");
const { buildTransactionHierarchy } = require("../Erigon/erigonApi");
const { UNVERIFIED_CONTRACT_MESSAGE, buildGetSourceCodeUrl } = require("../shared/etherscan");
const {
    hasCachedCompiledData,
    buildContractTreeFromCache,
    attachContractMetadata,
} = require("../shared/contractTreeHelpers");

const WORKER_PATH = path.join(__dirname, "workerWithOption.js");
const WORKER_EXEC_ARGV = ["--max-old-space-size=4096", "--expose-gc"];
const ABI_PREVIEW_LENGTH = 80;
const EMPTY_ABI = "[]";

// Variabili d'ambiente per ogni network supportato.
const NETWORK_ENV = {
    Mainnet: { web3Endpoint: "WEB3_ALCHEMY_MAINNET_URL", apiKey: "API_KEY_ETHERSCAN", endpoint: "ETHERSCAN_MAINNET_ENDPOINT" },
    Sepolia: { web3Endpoint: "WEB3_ALCHEMY_SEPOLIA_URL", apiKey: "API_KEY_ETHERSCAN", endpoint: "ETHERSCAN_SEPOLIA_ENDPOINT" },
    Polygon: { web3Endpoint: "WEB3_ALCHEMY_POLYGON_URL", apiKey: "API_KEY_POLYGONSCAN", endpoint: "POLYGONSCAN_MAINNET_ENDPOINT" },
    Amoy: { web3Endpoint: "WEB3_ALCHEMY_AMOY_URL", apiKey: "API_KEY_POLYGONSCAN", endpoint: "POLYGONSCAN_TESTNET_ENDPOINT" },
};

/** Millisecondi trascorsi da start (performance.now), con 3 decimali. */
function elapsedMs(start) {
    return parseFloat((performance.now() - start).toFixed(3));
}

const isoNow = () => new Date().toISOString();

/**
 * networkData = { web3Endpoint, apiKey, endpoint, networkName } letto da .env.
 * @param {string} network "Mainnet" | "Sepolia" | "Polygon" | "Amoy"
 * @returns {Object}
 */
function buildNetworkData(network) {
    const networkData = {
        web3Endpoint: "",
        apiKey: "",
        endpoint: "",
        networkName: network,
    };
    if (Object.prototype.hasOwnProperty.call(NETWORK_ENV, network)) {
        const envNames = NETWORK_ENV[network];
        networkData.web3Endpoint = process.env[envNames.web3Endpoint];
        networkData.apiKey = process.env[envNames.apiKey];
        networkData.endpoint = process.env[envNames.endpoint];
    }
    return networkData;
}

/**
 * Estrae le transazioni richieste dal server.
 *
 * Due modalità:
 * - oldParams: tutte le transazioni del contratto (Etherscan txlist) in un range di blocchi;
 * - newParams (oldParams nullo): transazioni con chiamate tra gli indirizzi indicati (trace_filter).
 *
 * @param {Object|null} oldParams { network, contractAddress, implementationContractAddress, contractName, fromBlock, toBlock, filters, smartContract, option }
 * @param {Object|null} newParams { network, contractAddressesFrom, contractAddressesTo, implementationContractAddress, fromBlock, toBlock, filters, smartContract, option }
 * @param {boolean} [returnInMemory=false] se true restituisce i log estratti
 * @returns {Promise<Array>} i log estratti se returnInMemory, altrimenti []. Gli elementi sono
 *          { log, metrics } per le transazioni appena estratte e il documento del DB per quelle già presenti.
 * @throws l'errore originale (network non configurato, errori di DB, ...)
 */
async function getAllTransactions(oldParams, newParams, returnInMemory = false) {
    const network = (oldParams ? oldParams.network : null) || (newParams ? newParams.network : null);
    const networkData = buildNetworkData(network);
    try {
        if (!networkData.web3Endpoint || !networkData.apiKey) {
            throw new Error(`Variabili d'ambiente mancanti per il network ${network}. Controlla il file .env e i percorsi di dotenv.`);
        }

        await connectDB(networkData.networkName);
        const memoryLogs = (!oldParams && newParams)
            ? await extractFromAddressRange(newParams, networkData, returnInMemory)
            : await extractFromContract(oldParams, networkData, returnInMemory);

        console.log(`Extraction finished: ${memoryLogs}`);
        return returnInMemory ? memoryLogs : [];
    } catch (err) {
        console.error(err);
        throw err;
    } finally {
        await cleanupResources();
    }
}

/**
 * Documento ContractData dal DB oppure, se assente o non verificato, i metadati
 * scaricati da Etherscan.
 */
async function findContractData(targetAbiAddress, networkData) {
    const queryResult = await searchAbi({ contractAddress: targetAbiAddress });
    if (queryResult && !queryResult?.abi?.includes(UNVERIFIED_CONTRACT_MESSAGE)) {
        console.log("contract found in the db");
        return queryResult;
    }
    const response = await axios.get(buildGetSourceCodeUrl(networkData.endpoint, targetAbiAddress, networkData.apiKey));
    const etherscanResult = response.data.result[0];
    return {
        contractName: etherscanResult.ContractName,
        abi: etherscanResult.ABI,
        proxy: etherscanResult.Proxy,
        proxyImplementation: "",
        sourceCode: etherscanResult.SourceCode,
        contractAddress: targetAbiAddress,
        compilerVersion: etherscanResult.CompilerVersion,
    };
}

/** Modalità newParams: una transazione alla volta; gli errori saltano solo la transazione. */
async function extractFromAddressRange(newParams, networkData, returnInMemory) {
    console.log(`[${isoNow()}] Costruisco TransactionHierarchy`);
    const txHierarchy = await buildTransactionHierarchy(newParams.contractAddressesFrom, newParams.contractAddressesTo, newParams.fromBlock, newParams.toBlock, networkData);
    console.log(`[${isoNow()}] TransactionHierarchy Costruita`);

    let memoryLogs = [];
    for (const tx of txHierarchy) {
        try {
            const targetAbiAddress = newParams.implementationContractAddress
                ? newParams.implementationContractAddress.toLowerCase()
                : tx.to.toLowerCase();
            const queryResult = await findContractData(targetAbiAddress, networkData);
            const singleTxPerformance = {};
            const contractTree = await getContractTree(null, targetAbiAddress, networkData.endpoint, networkData.apiKey, queryResult, singleTxPerformance);
            // NOTA: il controllo dei duplicati usa la collection tx.to, mentre il worker
            // salva in contractAddressesTo (vedi CHANGELOG, punti dubbi).
            const storageData = await getStorageData([tx], queryResult.contractName, contractTree, tx.to, newParams.filters, newParams.smartContract, newParams.option, networkData, newParams.contractAddressesTo, returnInMemory, singleTxPerformance);
            console.log(`Storage Data: ${storageData}`);
            if (returnInMemory && storageData) memoryLogs = memoryLogs.concat(storageData);
        } catch (innerError) {
            // Un errore su una transazione (es. contratto non trovato) non interrompe l'estrazione.
            console.warn(`[Warning] Impossibile estrarre la TX ${tx.hash}: ${innerError.message}. Passo alla successiva.`);
        }
    }
    return memoryLogs;
}

/** Modalità oldParams: tutte le transazioni del contratto nel range di blocchi. */
async function extractFromContract(oldParams, networkData, returnInMemory) {
    const queryResult = await searchAbi({ contractAddress: oldParams.implementationContractAddress.toLowerCase() });
    const singleTxPerformance = {};
    // NOTA: con un file caricato smartContract è una stringa e la compilazione non
    // produce dati (vedi CHANGELOG, punti dubbi).
    const contractTree = await getContractTree(oldParams.smartContract, oldParams.implementationContractAddress, networkData.endpoint, networkData.apiKey, queryResult, singleTxPerformance);
    const transactionList = await getTransactionFromContract(networkData, oldParams.contractAddress, oldParams.fromBlock, oldParams.toBlock);

    const storageData = await getStorageData(transactionList, oldParams.contractName, contractTree, oldParams.contractAddress, oldParams.filters, oldParams.smartContract, oldParams.option, networkData, null, returnInMemory, singleTxPerformance);
    return (storageData && storageData.length > 0) ? storageData : [];
}

// ---------------------------------------------------------------------------
// Contract tree
// ---------------------------------------------------------------------------

/**
 * Contract tree minimo, senza dati compilati, usato quando il sorgente non è
 * recuperabile o non compila.
 * @param {Object} [queryResult={}]
 * @returns {Object}
 */
function createRawContractTreeFallback(queryResult = {}) {
    const abi = typeof queryResult?.abi === "string" && !queryResult.abi.includes(UNVERIFIED_CONTRACT_MESSAGE)
        ? queryResult.abi
        : EMPTY_ABI;
    return {
        fullContractTree: null,
        storageLayoutFlag: false,
        contractCompiled: null,
        contractAbi: abi,
        sourceCode: queryResult?.sourceCode || "",
        proxy: queryResult?.proxy || "",
        contractName: queryResult?.contractName || "",
        proxyImplementation: queryResult?.proxyImplementation || "",
        compilerVersion: queryResult?.compilerVersion || "",
    };
}

/** Dati diagnostici sul recupero del contratto (per i log di warning). */
function describeContractLookup(queryResult, endpoint, apiKey) {
    return {
        hasQueryResult: !!queryResult,
        queryResultContractAddress: queryResult?.contractAddress,
        queryResultContractName: queryResult?.contractName,
        queryResultAbiPreview: typeof queryResult?.abi === "string" ? queryResult.abi.slice(0, ABI_PREVIEW_LENGTH) : typeof queryResult?.abi,
        endpointDefined: !!endpoint,
        apiKeyDefined: !!apiKey,
    };
}

/**
 * Compila il sorgente e completa il contract tree con i metadati; in caso di errore
 * usa il fallback grezzo con i metadati disponibili.
 */
async function compileContractTree(contractsResult, impl_contract, queryResult, singleTxPerformance) {
    try {
        console.log(`[${isoNow()}, DEBUG-CONTRACT TREE] Inizio recupero CompiledData`);
        const tStartCompile = performance.now();
        let contractTree = await getCompiledData(contractsResult.contracts, contractsResult.contractName, contractsResult.compilerVersion);
        singleTxPerformance.time_getCompiledData = elapsedMs(tStartCompile);

        if (!contractTree) {
            contractTree = createRawContractTreeFallback(queryResult);
        }
        attachContractMetadata(contractTree, contractsResult);
        await saveCompiledContractData(impl_contract, contractTree);
        console.log(`[${isoNow()}, DEBUG-CONTRACT TREE] Fine recupero CompiledData e ContractTree completato`);
        return contractTree;
    } catch (err) {
        console.error("getCompiledData error: ", err);
        console.warn(`[${isoNow()}, DEBUG-CONTRACT TREE] Errore compilazione, continuo con fallback grezzo`, {
            impl_contract,
            errorMessage: err?.message,
        });
        const contractTree = createRawContractTreeFallback(queryResult);
        contractTree.contractAbi = contractsResult.contractAbi || contractTree.contractAbi;
        contractTree.sourceCode = contractsResult.sourceCode || contractTree.sourceCode;
        contractTree.proxy = contractsResult.proxy || contractTree.proxy;
        contractTree.contractName = contractsResult.contractName || contractTree.contractName;
        contractTree.compilerVersion = contractsResult.compilerVersion || contractTree.compilerVersion;
        singleTxPerformance.time_getCompiledData = 0;
        return contractTree;
    }
}

/**
 * Contract tree dell'implementazione con metriche dei tempi. A differenza di
 * contractUtils.getContractTree non lancia: in caso di errore restituisce il
 * fallback grezzo.
 *
 * @param {*} smartContract file caricato dall'utente
 * @param {string} impl_contract indirizzo dell'implementazione
 * @param {string} endpoint
 * @param {string} apiKey
 * @param {Object} [queryResult] documento ContractData in DB
 * @param {Object} [singleTxPerformance={}] metriche (vengono mutate)
 * @returns {Promise<Object|null>}
 */
async function getContractTree(smartContract, impl_contract, endpoint, apiKey, queryResult, singleTxPerformance = {}) {
    const tStartTotal = performance.now();
    let contractsResult = null;
    let contractTree = null;

    if (smartContract) {
        contractsResult = smartContract;
    } else {
        try {
            if (hasCachedCompiledData(queryResult)) {
                contractTree = buildContractTreeFromCache(queryResult);
                singleTxPerformance.time_getContractCodeEtherscan = 0;
                singleTxPerformance.time_getCompiledData = 0;
                singleTxPerformance.time_getContractTreeTotal = elapsedMs(tStartTotal);
                return contractTree;
            }

            console.log(`[${isoNow()}, DEBUG-CONTRACT TREE] Inizio recupero ContractCode`);
            const tStartEtherscan = performance.now();
            contractsResult = await getContractCodeEtherscan(impl_contract, endpoint, apiKey, queryResult);
            singleTxPerformance.time_getContractCodeEtherscan = elapsedMs(tStartEtherscan);

            if (!contractsResult) {
                console.warn(`[${isoNow()}, DEBUG-CONTRACT TREE] ContractCode non recuperato, uso fallback grezzo`, {
                    impl_contract,
                    ...describeContractLookup(queryResult, endpoint, apiKey),
                });
                contractTree = createRawContractTreeFallback(queryResult);
                singleTxPerformance.time_getCompiledData = 0;
                singleTxPerformance.time_getContractTreeTotal = elapsedMs(tStartTotal);
                return contractTree;
            }

            console.log(`[${isoNow()}, DEBUG-CONTRACT TREE] ContractCode recuperato`);
            console.log(`compilerVersion: ${contractsResult.compilerVersion}`);
        } catch (err) {
            console.error("getContractCodeEtherscan error: ", err);
            console.warn(`[${isoNow()}, DEBUG-CONTRACT TREE] Errore Etherscan/compilazione, continuo con fallback grezzo`, {
                impl_contract,
                errorMessage: err?.message,
                ...describeContractLookup(queryResult, endpoint, apiKey),
            });
            contractTree = createRawContractTreeFallback(queryResult);
            singleTxPerformance.time_getCompiledData = 0;
        }
    }

    if (contractsResult) {
        contractTree = await compileContractTree(contractsResult, impl_contract, queryResult, singleTxPerformance);
    }

    singleTxPerformance.time_getContractTreeTotal = elapsedMs(tStartTotal);
    return contractTree;
}

// ---------------------------------------------------------------------------
// Transazioni
// ---------------------------------------------------------------------------

/**
 * Tutte le transazioni del contratto tra fromBlock e toBlock (Etherscan txlist),
 * richiedendo pagine successive finché l'ultima transazione è prima di toBlock.
 * @returns {Promise<Array>}
 */
async function getTransactionFromContract(networkData, contractAddress, fromBlock, toBlock) {
    const response = await axios.get(
        `${networkData.endpoint}&module=account&action=txlist` +
        `&address=${contractAddress}&startblock=${fromBlock}&endblock=${toBlock}&sort=asc&apikey=${networkData.apiKey}`
    );
    // NOTA: se Etherscan restituisce un messaggio di errore, result è una stringa
    // (vedi CHANGELOG, punti dubbi).
    const contractTransactions = response.data?.result || [];
    if (contractTransactions.length === 0) {
        return [];
    }

    const lastBlock = parseInt(contractTransactions[contractTransactions.length - 1].blockNumber);
    if (!(lastBlock < toBlock)) {
        return contractTransactions;
    }
    const nextBatch = await getTransactionFromContract(networkData, contractAddress, lastBlock + 1, toBlock);
    return contractTransactions.concat(nextBatch);
}

/** Pulizia di Hardhat e garbage collection a fine estrazione (errori solo loggati). */
async function cleanupResources() {
    try {
        if (hre && hre.network && hre.network.provider) {
            await hre.run("clean");
            await hre.network.provider.send("hardhat_reset");
            if (hre.network.provider.removeAllListeners) {
                hre.network.provider.removeAllListeners();
            }
        }
        if (global.gc) {
            global.gc();
        }
    } catch (cleanupError) {
        console.error("Error during cleanup:", cleanupError);
    }
}

/**
 * Filtra le transazioni con i criteri dell'utente.
 *
 * @param {Array} contractTransactions
 * @param {Object} filters { gasUsed, gasPrice, timestamp, senders, functions }
 * @returns {Array}
 */
function applyFilters(contractTransactions, filters) {
    const { gasUsed, gasPrice, timestamp, senders, functions } = filters;
    const toUnixSeconds = (date) => Math.floor(new Date(date).getTime() / 1000);

    return contractTransactions.filter((tx) => {
        const matchesSender = !senders.length || senders.includes(tx.from.toLowerCase());
        const matchesFunction = !functions.length || functions.includes(tx.inputDecoded.method);
        const matchesGasUsed = !gasUsed || (tx.gasUsed >= gasUsed[0] && tx.gasUsed <= gasUsed[1]);
        const matchesGasPrice = !gasPrice || (tx.gasPrice >= gasPrice[0] && tx.gasPrice <= gasPrice[1]);
        const matchesTimestamp = !timestamp || (
            tx.timeStamp >= toUnixSeconds(timestamp[0]) &&
            tx.timeStamp <= toUnixSeconds(timestamp[1])
        );
        return matchesSender && matchesFunction && matchesGasUsed && matchesGasPrice && matchesTimestamp;
    });
}

/** Documento già salvato senza i campi interni di MongoDB. */
function toStoredTransactionData(searchResponse) {
    const { _id, __v, ...transactionData } = searchResponse[0]._doc || searchResponse[0];
    return transactionData;
}

/** Metriche del worker unite a quelle del contract tree. */
function buildCombinedMetrics(tx, singleTxPerformance, workerMetrics, timeWorker) {
    const totalTxTime = parseFloat(((singleTxPerformance.time_getContractTreeTotal || 0) + timeWorker).toFixed(3));
    return {
        transactionHash: tx.hash,
        blockNumber: parseInt(tx.blockNumber),
        time_totalTransactionExtraction: totalTxTime,
        ...singleTxPerformance,
        ...workerMetrics,
    };
}

/** Elabora una transazione: dal DB se già estratta, altrimenti con un worker. */
async function extractSingleTransaction(tx, mainContract, contractTree, contractAddress, smartContract, option, networkData, addressRange, returnInMemory, singleTxPerformance, extractedResults) {
    const query = {
        transactionHash: tx.hash.toLowerCase(),
        contractAddress: contractAddress.toLowerCase(),
    };
    const response = await searchTransaction(query, networkData.networkName);
    if (response) {
        console.log(`Transaction already processed: ${tx.hash}`);
        if (returnInMemory) {
            extractedResults.push(toStoredTransactionData(response));
        }
        return;
    }

    const tStartWorker = performance.now();
    const workerData = await runWorkerForTx(tx, mainContract, contractTree, contractAddress, smartContract, option, networkData, addressRange, returnInMemory);
    const timeWorker = elapsedMs(tStartWorker);
    if (workerData && workerData.metrics) {
        await saveExtractionMetrics(buildCombinedMetrics(tx, singleTxPerformance, workerData.metrics, timeWorker));
    }
    if (returnInMemory && workerData && workerData.data) {
        extractedResults.push(workerData.data);
    }
}

/**
 * Filtra le transazioni, salta quelle già presenti in DB ed estrae le altre con un
 * worker ciascuna (gli errori di una transazione vengono solo loggati).
 *
 * @returns {Promise<Array|undefined>} risultati se returnInMemory, altrimenti []; undefined in caso di errore
 */
async function getStorageData(contractTransactions, mainContract, contractTree, contractAddress, filters, smartContract, option, networkData, addressRange, returnInMemory = false, singleTxPerformance = {}) {
    const extractedResults = [];
    try {
        const transactionsFiltered = applyFilters(contractTransactions, filters);
        if (global.gc) global.gc();

        for (const tx of transactionsFiltered) {
            try {
                await extractSingleTransaction(tx, mainContract, contractTree, contractAddress, smartContract, option, networkData, addressRange, returnInMemory, singleTxPerformance, extractedResults);
            } catch (e) {
                console.log("errore nel worker", e);
            }
        }
        return returnInMemory ? extractedResults : [];
    } catch (err) {
        console.log(err);
        return;
    } finally {
        if (global.gc) global.gc();
        await hre.run("clean");
        if (hre.network.provider.removeAllListeners) {
            hre.network.provider.removeAllListeners();
        }
    }
}

/**
 * Avvia un worker per la transazione e ne attende il risultato.
 * @returns {Promise<{data, metrics}|undefined>}
 */
function runWorkerForTx(tx, mainContract, contractTree, contractAddress, smartContract, option, networkData, addressRange, returnInMemory = false) {
    return new Promise((resolve, reject) => {
        const worker = fork(WORKER_PATH, [], { execArgv: WORKER_EXEC_ARGV });

        worker.send({
            tx,
            mainContract,
            contractTree,
            contractAddress,
            smartContract,
            option,
            networkData,
            addressRange,
            returnInMemory,
        });

        worker.on("message", (msg) => {
            if (msg === "done") {
                resolve();
            } else if (msg && msg.status === "done") {
                resolve({ data: msg.data, metrics: msg.metrics });
            } else if (msg.error) {
                reject(new Error(msg.error));
            }
        });

        worker.on("exit", (code, signal) => {
            if (code !== 0) {
                reject(new Error(`Worker exited with code ${code} and signal ${signal}`));
            } else {
                resolve();
            }
        });

        worker.on("error", (err) => {
            reject(err);
        });
    });
}

module.exports = {
    getAllTransactions,
};
