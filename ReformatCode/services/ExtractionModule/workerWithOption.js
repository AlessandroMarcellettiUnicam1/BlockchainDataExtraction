// Processo figlio (fork da mainWithOption.js) che estrae una singola transazione:
// trace in streaming dal nodo, decodifica di input, storage, transazioni interne ed
// eventi, salvataggio in DB.
//
// Protocollo IPC: riceve { tx, mainContract, contractTree, contractAddress,
// smartContract, option, networkData, addressRange, returnInMemory } e risponde
// { status: "done", data, metrics } oppure { error }.
//
// NOTA: gli handler process.on(...) vengono installati anche quando il modulo è
// richiesto da un altro processo (es. simulationOrchestrator.js). Comportamento
// originale mantenuto (vedi CHANGELOG, punti dubbi).
const mongoose = require("mongoose");
require("dotenv").config();
const { Web3 } = require("web3");
const hre = require("hardhat");
const InputDataDecoder = require("ethereum-input-data-decoder");
// MIGRAZIONE: dentro services/ExtractionModule i tre percorsi diventano
// "../../config/db", "../../databaseStore" e "../../query/query"
const { connectDB } = require("../../../config/db");
const { saveTransaction, saveAbi } = require("../../../databaseStore");
const { searchAbi } = require("../../../query/query");
const { getContractTree } = require("../contractUtils/utils");
const { decodeInternalTransaction, newDecodedInternalTransaction } = require("../decodeInternalTransaction");
const { optimizedDecodeValues } = require("../optimizedDecodeValues");
const {
    decodeTransactionInputs,
    getEvents,
    iterateInternalForEvent,
    decodeInputs,
    getEventFromErigon,
    getEventsFromInternal,
    getEventFromHardHat,
} = require("../decodingUtils/utils");
const { makeRpcCallStreaming, debugTransactionErigonStreaming } = require("../shared/jsonRpc");
const { UNVERIFIED_CONTRACT_MESSAGE } = require("../shared/etherscan");
const { ensureHexPrefix } = require("../shared/hexUtils");
const {
    ERIGON_PARSER_OPTIONS,
    INPUT_STREAM_PARSER_OPTIONS,
    PUBLIC_CALL_INDEX,
    parseStructLogStream,
    appendStoredShaTraces,
    regroupShatrace,
    createShatrace,
    assignStorageToTheInternal,
} = require("./traceStorageParser");

const TRANSFER_INPUT = "0x";
const METHOD_SELECTOR_LENGTH = 10;
const METHOD_ID_REGEX = /^0x[0-9a-fA-F]{8}$/;
const DELEGATECALL = "DELEGATECALL";
const PROXY_FLAG = "1";
const EMPTY_ABI = "[]";
// Prefisso dell'indirizzo usato per comporre il nome della collection quando
// addressRange contiene più indirizzi.
const COLLECTION_PREFIX_LENGTH = 5;

// Metriche globali del worker (inviate al padre a fine elaborazione).
const timePerformance = {
    time_traceFilter: 0,
    time_processTraceBatch: 0,
    time_getCode_onlypubliccontract: 0,
    time_compile: 0,
    time_debug_trace_trace: 0,
    time_getTraceStorageErigonTotal: 0,
    time_parseTraceStreamErigon: 0,
    time_processTraceErigon: 0,
    time_decodeStorage_public: 0,
    time_optimizedDecodeValuesErigon: 0,
    time_decodeInternalTransactionErigon: 0,
    time_newDecodedInternalTransactioneErigon: 0,
    time_assignStorageToTheInternalErigon: 0,
    time_debug_trace_internal: 0,
    time_getCode_allInternalContracts_decode: 0,
    time_decodeStorage_internalTx: 0,
    time_saveAbi: 0,
    time_saveTransaction: 0,
    time_getEvents: 0,
    time_workerTotal: 0,
    number_internalTxs: 0,
};

/** Millisecondi trascorsi da start (performance.now), con 3 decimali. */
function elapsedMs(start) {
    return parseFloat((performance.now() - start).toFixed(3));
}

const isoNow = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Input della transazione pubblica
// ---------------------------------------------------------------------------

/**
 * true se l'ABI è utilizzabile (stringa non vuota/verificata, array o oggetto non vuoti).
 * @param {*} abi
 * @returns {boolean}
 */
function hasUsableAbi(abi) {
    if (!abi) return false;
    if (typeof abi === "string") {
        const trimmedAbi = abi.trim();
        return trimmedAbi !== "" && trimmedAbi !== EMPTY_ABI && !trimmedAbi.includes(UNVERIFIED_CONTRACT_MESSAGE);
    }
    return Array.isArray(abi) ? abi.length > 0 : Object.keys(abi).length > 0;
}

/**
 * Decodifica input e nome del metodo della transazione pubblica (muta tx).
 * Input "0x" = trasferimento (tx.methodId = "Transfer").
 * @param {Object} tx
 * @param {Object} contractTree
 */
function decodeInput(tx, contractTree) {
    if (tx.input == TRANSFER_INPUT) {
        tx.methodId = "Transfer";
        return;
    }
    tx.rawMethodId = tx.input?.slice(0, METHOD_SELECTOR_LENGTH);
    if (!hasUsableAbi(contractTree?.contractAbi)) return;
    try {
        decodeTransactionInputs(tx, contractTree.contractAbi);
    } catch (err) {
        console.log("Public transaction input decode failed, using method id fallback: " + err.message);
    }
}

// ---------------------------------------------------------------------------
// Trace e storage
// ---------------------------------------------------------------------------

/**
 * Sha trace della transazione pubblica (bucket 1) e poi di ogni bucket.
 * Restituisce le sha trace pubbliche raggruppate.
 */
function buildPublicShaTraces(mapForStorage, sstoreBuffer, web3, toHexIndex, stopOnMissingStorageIndex) {
    // Le sha trace aggiunte finiscono nello stesso array di trackBuffer del bucket 1
    // (alias voluto: vedi appendStoredShaTraces).
    const publicTrackBuffer = mapForStorage[PUBLIC_CALL_INDEX]?.trackBuffer || [];
    appendStoredShaTraces(publicTrackBuffer, sstoreBuffer, web3, toHexIndex, stopOnMissingStorageIndex);
    return publicTrackBuffer;
}

/**
 * Elabora lo stream della trace (option.internalTransaction == 1): storage della
 * transazione pubblica, transazioni interne (callTracer) e, se richiesto, storage
 * delle transazioni interne. Le metriche vanno in timePerformance.
 *
 * @returns {Promise<{decodedValues: Array, internalTxs: Array}>}
 */
async function getTraceStorageFromErigon(httpStream, networkData, functionName, transactionHash, mainContract, contractTree, smartContract, extractionOption, web3, blockNumber) {
    const timeTraceStorageStart = Date.now();
    const { state, done } = parseStructLogStream(httpStream, web3, ERIGON_PARSER_OPTIONS, (error) => {
        console.error("Error parsing stream:", error);
    });
    const { mapForStorage, sstoreBuffer, sstoreOptimization, internalCalls } = state;

    // NOTA: un errore dello stream esce da qui senza passare dal try/finally
    // sottostante (comportamento originale).
    const timeParseStreamStart = Date.now();
    await done;
    timePerformance.time_parseTraceStreamErigon += Date.now() - timeParseStreamStart;

    try {
        const timeProcessTraceStart = Date.now();
        buildPublicShaTraces(mapForStorage, sstoreBuffer, web3, ensureHexPrefix, false);
        for (const bucketIndex in mapForStorage) {
            createShatrace(mapForStorage[bucketIndex], sstoreBuffer, web3);
        }
        const sstoreObject = { sstoreOptimization, sstoreBuffer };
        timePerformance.time_processTraceErigon += Date.now() - timeProcessTraceStart;

        let internalStorage = [];
        const timeDecodePublicStorage = Date.now();
        if (extractionOption.internalStorage != 0) {
            const timeBeforeOptimizedDecode = Date.now();
            const publicBucket = mapForStorage[PUBLIC_CALL_INDEX];
            internalStorage = contractTree && contractTree.storageLayoutFlag
                ? await optimizedDecodeValues(sstoreObject, contractTree.fullContractTree, publicBucket.finalShaTraces, publicBucket.functionStorage, functionName, mainContract, web3, contractTree.contractCompiled)
                : [];
            timePerformance.time_optimizedDecodeValuesErigon += Date.now() - timeBeforeOptimizedDecode;
        }
        timePerformance.time_decodeStorage_public = Date.now() - timeDecodePublicStorage;

        let internalTxs = [];
        if (extractionOption.internalTransaction == 0) {
            const timeBeforeDecodeInternal = Date.now();
            internalTxs = await decodeInternalTransaction(internalCalls, smartContract, web3, networkData, transactionHash, blockNumber, timePerformance);
            timePerformance.time_decodeInternalTransactionErigon += Date.now() - timeBeforeDecodeInternal;
        } else if (extractionOption.internalTransaction == 1) {
            const timeBeforeLaunch = Date.now();
            internalTxs = await newDecodedInternalTransaction(transactionHash, smartContract, networkData, web3, blockNumber, timePerformance);
            timePerformance.time_newDecodedInternalTransactioneErigon += Date.now() - timeBeforeLaunch;
        }
        timePerformance.number_internalTxs = internalCalls.length;

        if (extractionOption.storageInternalTransactio == 1) {
            try {
                const timeBeforeAssignStorage = Date.now();
                assignStorageToTheInternal(internalTxs, mapForStorage);
                timePerformance.time_assignStorageToTheInternalErigon += Date.now() - timeBeforeAssignStorage;
            } catch (err) {
                console.log("error in assignStorageToTheInternal");
            }
            await decodeInteralTxsStorage(internalTxs, web3);
        }

        return {
            decodedValues: internalStorage,
            internalTxs,
        };
    } catch (err) {
        console.log("errore ", err);
        throw err;
    } finally {
        timePerformance.time_traceStorageErigon = (timePerformance.time_traceStorageErigon || 0) + (Date.now() - timeTraceStorageStart);
        if (global.gc) global.gc();
    }
}

/** Prefisso "0x" per concatenazione (variante del percorso standard). */
function concatHexPrefix(value) {
    return "0x" + value;
}

/**
 * Calcola le sha trace di ogni bucket su una copia (solo le voci con
 * hexStorageIndex), ignorando gli errori. I bucket originali non vengono modificati,
 * quindi il loro finalShaTraces resta undefined (comportamento originale).
 */
function createIsolatedShaTraces(mapForStorage, sstoreBuffer, web3) {
    for (const bucketIndex in mapForStorage) {
        const bucket = mapForStorage[bucketIndex];
        if (!bucket || !bucket.trackBuffer) continue;

        const validTrackBuffer = bucket.trackBuffer.filter((entry) => entry && entry.hexStorageIndex);
        if (validTrackBuffer.length === 0) continue;

        const bucketCopy = { ...bucket, trackBuffer: validTrackBuffer };
        try {
            createShatrace(bucketCopy, sstoreBuffer, web3);
        } catch (e) {
            console.warn(`[getTraceStorage] createShatrace ignorato per l'oggetto ${bucketIndex} a causa di dati non validi.`);
        }
    }
}

/**
 * Elabora lo stream della trace (option.internalTransaction != 1): storage della
 * transazione pubblica e transazioni interne lette dagli opcode CALL*.
 * Le metriche vanno in localMetrics.
 *
 * @returns {Promise<{decodedValues: Array, internalTxs: Array}>}
 */
async function getTraceStorageInputStream(httpStream, networkData, functionName, transactionHash, mainContract, contractTree, smartContract, extractionOption, web3, blockNumber, localMetrics = {}) {
    const { state, done } = parseStructLogStream(httpStream, web3, INPUT_STREAM_PARSER_OPTIONS);
    const { mapForStorage, sstoreBuffer, sstoreOptimization, internalCalls } = state;
    const tStartStream = performance.now();

    try {
        console.log(`[${isoNow()}, DEBUG-PARSER-PARTIAL-1] Avvio lettura stream di dati...`);
        await done;
        console.log(`[${isoNow()}, DEBUG-PARSER-PARTIAL-2] Fine lettura stream raggiunta.`);
        localMetrics.time_processTraceStandard = elapsedMs(tStartStream);

        console.log(`[${isoNow()}, DEBUG-PARSER-PARTIAL-3] Inizio calcolo SHA3 Traces (cicli while)...`);
        let finalShaTraces = buildPublicShaTraces(mapForStorage, sstoreBuffer, web3, concatHexPrefix, true);
        createIsolatedShaTraces(mapForStorage, sstoreBuffer, web3);
        const sstoreObject = { sstoreOptimization, sstoreBuffer };
        finalShaTraces = regroupShatrace(finalShaTraces);

        let internalStorage = [];
        console.log(`[${isoNow()}, DEBUG-PARSER-PARTIAL4] Inizio decodifica ottimizzata (optimizedDecodeValues) e chiamate interne...`);
        const publicBucket = mapForStorage[PUBLIC_CALL_INDEX];
        if (extractionOption.internalStorage != 0 && publicBucket) {
            const tODV = performance.now();
            internalStorage = contractTree && contractTree.storageLayoutFlag
                ? await optimizedDecodeValues(sstoreObject, contractTree.fullContractTree, publicBucket.finalShaTraces || finalShaTraces, publicBucket.functionStorage, functionName, mainContract, web3, contractTree.contractCompiled)
                : [];
            localMetrics.time_optimizedDecodeValuesStandard = elapsedMs(tODV);
        }

        const tDIT = performance.now();
        const internalTxs = await decodeInternalTransaction(internalCalls, smartContract, web3, networkData, transactionHash, blockNumber);
        localMetrics.time_decodeInternalTransactionErigon = elapsedMs(tDIT);

        console.log(`[${isoNow()}, DEBUG-PARSER-PARTIAL-5] Tutte le elaborazioni sincrone terminate, ritorno i dati.`);
        return {
            decodedValues: internalStorage,
            internalTxs,
        };
    } catch (err) {
        console.error("Errore durante l'elaborazione dello stream:", err);
        throw err;
    } finally {
        if (global.gc) global.gc();
    }
}

/**
 * Decodifica lo storage di ogni transazione interna (e delle sue figlie) usando
 * finalShaTraces/functionStorage assegnati da assignStorageToTheInternal.
 * @param {Array} internalTxs
 * @param {Object} web3
 */
async function decodeInteralTxsStorage(internalTxs, web3) {
    for (const txs of internalTxs) {
        const query = { contractAddress: txs.to.toLowerCase() };
        const timeBeforeGetAbi = Date.now();
        const queryResult = await searchAbi(query);
        const contractTree = await getContractTree(null, txs.to, null, null, queryResult, false);
        timePerformance.time_getCode_allInternalContracts_decode += Date.now() - timeBeforeGetAbi;

        const timeBeforeDecodeStorage = Date.now();
        let storageState = [];
        try {
            storageState = contractTree && contractTree.storageLayoutFlag
                ? await optimizedDecodeValues(null, contractTree.fullContractTree, txs.finalShaTraces, txs.functionStorage, txs.activity, txs.contractCalledName, web3, contractTree.contractCompiled)
                : [];
        } catch (err) {
            console.log("error in decoding stoarge internal ");
        }

        txs.storageState = storageState;
        delete txs["finalShaTraces"];
        delete txs["functionStorage"];
        timePerformance.time_decodeStorage_internalTx += Date.now() - timeBeforeDecodeStorage;

        if (txs.calls && txs.calls.length > 0) {
            await decodeInteralTxsStorage(txs.calls, web3);
        }
    }
}

// ---------------------------------------------------------------------------
// Log della transazione
// ---------------------------------------------------------------------------

// Varianti di estrazione della trace (scelte in base a option.internalTransaction).
const TRACE_MODES = {
    erigon: {
        logTag: "DEBUG-INTERNAL",
        debugMetric: "time_debugErigon",
        parseMetric: "time_traceStorageErigon",
        parse: getTraceStorageFromErigon,
    },
    standard: {
        logTag: "DEBUG-PARTIAL",
        debugMetric: "time_debugStandard",
        parseMetric: "time_traceStorageStandard",
        parse: getTraceStorageInputStream,
    },
};

function createLocalMetrics() {
    return {
        time_debugErigon: 0,
        time_traceStorageErigon: 0,
        time_debugStandard: 0,
        time_traceStorageStandard: 0,
        time_getEvents: 0,

        time_processTraceErigon: 0,
        time_optimizedDecodeValuesErigon: 0,
        time_decodeInternalTransactionErigon: 0,
        time_newDecodedInternalTransactioneErigon: 0,
        time_assignStorageToTheInternalErigon: 0,
        time_decodeInternalTxsStorageErigon: 0,

        time_processTraceStandard: 0,
        time_optimizedDecodeValuesStandard: 0,
    };
}

/** Converte tx.timestamp (hex o decimale) in tx.timeStamp (secondi). */
function normalizeTimestamp(tx, web3) {
    if (tx.timestamp && tx.timestamp.includes("0x")) {
        tx.timeStamp = web3.utils.hexToNumber(tx.timestamp);
    } else if (tx.timestamp) {
        tx.timeStamp = Number(tx.timestamp);
    }
}

function buildInitialTransactionLog(tx, web3) {
    return {
        functionName: tx.inputDecoded ? tx.inputDecoded.method : tx.methodId,
        transactionHash: tx.hash,
        blockNumber: parseInt(tx.blockNumber),
        contractAddress: tx.to,
        sender: tx.from,
        gasUsed: parseInt(tx.gasUsed),
        timestamp: tx.timeStamp
            ? new Date(tx.timeStamp * 1000).toISOString()
            : new Date().toISOString(),
        inputs: tx.inputDecoded ? decodeInputs(tx.inputDecoded, web3) : [],
        value: tx.value,
        storageState: [],
        internalTxs: [],
        events: [],
    };
}

/**
 * Scarica la trace in streaming e la elabora. Gli errori dello streaming vengono
 * propagati; quelli dell'elaborazione vengono solo loggati (risultato null).
 * @returns {Promise<{decodedValues, internalTxs}|null>}
 */
async function traceTransactionStorage(mode, tx, transactionLog, mainContract, contractTree, smartContract, option, networkData, web3, localMetrics) {
    const debugStart = performance.now();
    console.log(`[${isoNow()}, DEBUG-1] Inizio richiesta streaming al nodo per TX: ${tx.hash}`);
    const { stream } = await debugTransactionErigonStreaming(tx.hash, networkData.web3Endpoint);
    console.log(`[${isoNow()}, DEBUG-2] Stream ricevuto dal nodo per TX: ${tx.hash}`);
    localMetrics[mode.debugMetric] = elapsedMs(debugStart);

    try {
        const parseStart = performance.now();
        console.log(`[${isoNow()}, ${mode.logTag}-3] Inizio parsing dello stream (getTraceStorage...) per TX: ${tx.hash}`);
        const storageVal = await mode.parse(
            stream,
            networkData,
            tx.inputDecoded ? tx.inputDecoded.method : null,
            tx.hash,
            mainContract,
            contractTree,
            smartContract,
            option,
            web3,
            transactionLog.blockNumber,
            localMetrics,
        );
        console.log(`[${isoNow()}, ${mode.logTag}-4] Parsing stream completato con successo per TX: ${tx.hash}`);
        localMetrics[mode.parseMetric] = elapsedMs(parseStart);
        return storageVal;
    } catch (err) {
        console.log(err);
        return null;
    }
}

const sameAddress = (left, right) => left && right && left.toLowerCase() === right.toLowerCase();

/** ABI in DB utilizzabile (stringa non vuota e verificata). */
const isUsableAbiString = (abi) => typeof abi === "string" && abi !== EMPTY_ABI && !abi.includes(UNVERIFIED_CONTRACT_MESSAGE);

/** DELEGATECALL del proxy (tx.to) verso un'implementazione diversa. */
function findProxyDelegateCall(internalTxs, tx) {
    return internalTxs?.find((internalTx) =>
        (internalTx?.callType === DELEGATECALL || internalTx?.type === DELEGATECALL) &&
        internalTx?.to &&
        tx?.to &&
        (!internalTx.from || sameAddress(internalTx.from, tx.to)) &&
        !sameAddress(internalTx.to, tx.to)
    );
}

/**
 * Se il nome della funzione manca (o è solo il selettore) e la transazione passa da
 * un proxy, decodifica l'input con l'ABI dell'implementazione salvata in DB.
 */
async function decodeThroughProxyImplementation(transactionLog, tx, contractTree, storeAbi, web3, methodIdFallback) {
    const functionNameIsOnlyMethodId = typeof transactionLog.functionName === "string" && METHOD_ID_REGEX.test(transactionLog.functionName);
    const functionNameNeedsDecode = transactionLog.functionName == null || functionNameIsOnlyMethodId;
    const proxyDelegateCall = findProxyDelegateCall(transactionLog.internalTxs, tx);
    if (!functionNameNeedsDecode || !proxyDelegateCall) return;

    const query = { contractAddress: proxyDelegateCall.to.toLowerCase() };
    const response = await searchAbi(query);
    if (!isUsableAbiString(response?.abi)) return;

    if (contractTree) {
        storeAbi.proxy = PROXY_FLAG;
        storeAbi.proxyImplementation = query.contractAddress;
    }
    try {
        const decoder = new InputDataDecoder(response.abi);
        const tempResult = decoder.decodeData(tx.input);
        transactionLog.functionName = tempResult.method || methodIdFallback;
        if (transactionLog.inputs.length < 1) {
            transactionLog.inputs = tempResult.inputs.map((input, i) => ({
                inputName: tempResult.names[i],
                type: tempResult.types[i],
                inputValue: input._isBigNumber ? Number(web3.utils.hexToNumber(input._hex)) : input,
            }));
        }
    } catch (err) {
        console.log("Proxy implementation decode failed, using method id fallback: " + err.message);
    }
}

/**
 * Completa il log con storage e transazioni interne (option.default != 0), nome della
 * funzione via proxy e salvataggio dell'ABI.
 */
async function addTraceData(transactionLog, tx, mainContract, contractTree, smartContract, option, networkData, web3, localMetrics) {
    const mode = option.internalTransaction == 1 ? TRACE_MODES.erigon : TRACE_MODES.standard;
    const storageVal = await traceTransactionStorage(mode, tx, transactionLog, mainContract, contractTree, smartContract, option, networkData, web3, localMetrics);

    transactionLog.storageState = storageVal ? storageVal.decodedValues : [];
    transactionLog.internalTxs = storageVal ? storageVal.internalTxs : [];
    const storeAbi = {
        contractName: contractTree?.contractName,
        abi: contractTree?.contractAbi,
        proxy: contractTree?.proxy,
        proxyImplementation: "",
        contractAddress: tx?.to,
        sourceCode: contractTree?.sourceCode,
        // FIX-12: contractTree può essere null (è controllato con "?." nelle righe sopra
        // e con "if (contractTree)" sotto): l'accesso diretto lanciava TypeError.
        compilerVersion: contractTree?.compilerVersion || "unknown",
    };
    transactionLog.finalShaTraces = undefined;
    transactionLog.functionStorage = undefined;
    const methodIdFallback = tx.methodId || tx.rawMethodId || (tx.input && tx.input !== TRANSFER_INPUT ? tx.input.slice(0, METHOD_SELECTOR_LENGTH) : null);

    await decodeThroughProxyImplementation(transactionLog, tx, contractTree, storeAbi, web3, methodIdFallback);

    if ((transactionLog.functionName == null || METHOD_ID_REGEX.test(transactionLog.functionName)) && methodIdFallback) {
        transactionLog.functionName = methodIdFallback;
    }
    if (contractTree) {
        await saveAbi(storeAbi);
    }
}

/** Collection di destinazione: prefissi di addressRange, unico indirizzo o tx.to/tx.from. */
function resolveCollectionName(addressRange, tx) {
    if (addressRange && addressRange.length > 1) {
        return addressRange.map((address) => address.substring(0, COLLECTION_PREFIX_LENGTH).toLowerCase()).join("");
    }
    if (addressRange && addressRange.length == 1) {
        return addressRange[0].toLowerCase();
    }
    return tx.to != "" ? tx.to : tx.from;
}

/**
 * Costruisce, salva in DB e restituisce il log della transazione.
 * @returns {Promise<{log: Object, metrics: Object}>}
 */
async function createTransactionLog(tx, mainContract, contractTree, smartContract, contractAddress, option, networkData, addressRange) {
    const localMetrics = createLocalMetrics();
    const web3 = new Web3(networkData.web3Endpoint);
    normalizeTimestamp(tx, web3);
    const transactionLog = buildInitialTransactionLog(tx, web3);

    if (option.default != 0) {
        await addTraceData(transactionLog, tx, mainContract, contractTree, smartContract, option, networkData, web3, localMetrics);
    }

    const eventsStart = performance.now();
    console.log(`[${isoNow()}, DEBUG-5] Inizio recupero eventi (getEventForTransaction)...`);
    await getEventForTransaction(transactionLog, tx.hash, Number(tx.blockNumber), contractAddress, web3, contractTree, option, networkData);
    console.log(`[${isoNow()}, DEBUG-6] Eventi recuperati (getEventForTransaction)...`);
    localMetrics.time_getEvents = elapsedMs(eventsStart);

    await saveTransaction(transactionLog, resolveCollectionName(addressRange, tx));

    console.log(`[DEBUG-7] Ritorno del transaction log`);
    return { log: transactionLog, metrics: localMetrics };
}

// ---------------------------------------------------------------------------
// Eventi
// ---------------------------------------------------------------------------

/** Aggiunge gli eventi non ancora visti (per eventSignature). */
function appendUniqueEvents(targetEvents, events, seenEvent) {
    events.forEach((event) => {
        if (!seenEvent.has(event.eventSignature)) {
            targetEvents.push(event);
            seenEvent.add(event.eventSignature);
        }
    });
}

/** Segna come già visti gli eventi assegnati alle transazioni interne (ricorsivo). */
function searchEventInInternal(internals, seenEvent) {
    for (const internal of internals) {
        internal.events?.forEach((event) => {
            seenEvent.add(event.eventSignature);
        });
        if (internal.calls) {
            searchEventInInternal(internal.calls, seenEvent);
        }
    }
}

/** Evento della ricevuta che non è stato possibile decodificare. */
function buildUndecodedEvent(receiptLog) {
    return {
        eventName: "undefined",
        eventValues: receiptLog.topics,
        eventFrom: receiptLog.address.toLowerCase(),
    };
}

/**
 * Per ogni log della ricevuta non ancora visto (per logIndex) prova a decodificare
 * gli eventi del contratto emittente; se nessun evento nuovo viene aggiunto,
 * registra un evento "undefined" con i topic grezzi.
 *
 * @param {boolean} fallbackToSender se il contratto non restituisce eventi, prova con il mittente della transazione
 */
async function appendReceiptEvents(transactionLog, receiptLogs, seenEvent, blockNumber, networkData, web3, fallbackToSender) {
    for (const receiptLog of receiptLogs) {
        const logIndex = web3.utils.hexToNumber(receiptLog.logIndex).toString();
        if (seenEvent.has(logIndex)) continue;

        let decodedEvents = await getEventsFromInternal(transactionLog.transactionHash, blockNumber, receiptLog.address.toLowerCase(), networkData, web3);
        if (fallbackToSender && decodedEvents.length == 0) {
            decodedEvents = await getEventsFromInternal(transactionLog.transactionHash, blockNumber, transactionLog.sender, networkData, web3);
        }

        const eventsBefore = transactionLog.events.length;
        appendUniqueEvents(transactionLog.events, decodedEvents, seenEvent);
        if (transactionLog.events.length === eventsBefore) {
            transactionLog.events.push(buildUndecodedEvent(receiptLog));
            seenEvent.add(logIndex);
        }
    }
}

/**
 * Recupera e assegna a transactionLog.events gli eventi della transazione.
 *
 * @param {Object} transactionLog log da salvare (viene mutato)
 * @param {string} hash hash della transazione
 * @param {number} blockNumber
 * @param {string} contractAddress indirizzo del contratto analizzato
 * @param {Object} web3
 * @param {Object} contractTree contiene l'ABI del contratto
 * @param {Object} option opzioni di estrazione
 * @param {Object} networkData { apiKey, endpoint, networkName, web3Endpoint }
 */
async function getEventForTransaction(transactionLog, hash, blockNumber, contractAddress, web3, contractTree, option, networkData) {
    const seenEvent = new Set();

    if (option.default == 0) {
        // NOTA: Object.keys lancia se contractAbi è null/undefined (comportamento originale).
        if (contractTree && Object.keys(contractTree.contractAbi).length !== 0) {
            const publicEvents = await getEvents(hash, blockNumber, contractAddress, web3, contractTree.contractAbi, networkData);
            appendUniqueEvents(transactionLog.events, publicEvents, seenEvent);
        }
        if (option.internalTransaction == 1) {
            const receiptLogs = await getEventFromErigon(transactionLog.transactionHash, networkData);
            await appendReceiptEvents(transactionLog, receiptLogs, seenEvent, blockNumber, networkData, web3, false);
        } else {
            const receiptLogs = await getEventFromHardHat(transactionLog.transactionHash, networkData, hre, blockNumber);
            await appendReceiptEvents(transactionLog, receiptLogs, seenEvent, blockNumber, networkData, web3, true);
        }
        return;
    }

    // DUPLICATE_EVENTS == "false": gli eventi già assegnati alle transazioni interne
    // non vengono ripetuti tra gli eventi della transazione pubblica.
    const avoidDuplicatingInternalEvents = process.env.DUPLICATE_EVENTS == "false";
    if (transactionLog.internalTxs && avoidDuplicatingInternalEvents) {
        searchEventInInternal(transactionLog.internalTxs, seenEvent);
    }

    if (contractTree && contractTree.contractAbi && Object.keys(contractTree.contractAbi).length !== 0) {
        const publicEvents = await getEvents(hash, blockNumber, contractAddress, web3, contractTree.contractAbi, networkData);
        appendUniqueEvents(transactionLog.events, publicEvents, seenEvent);
    }

    if (!(transactionLog.internalTxs && transactionLog.internalTxs.length > 0)) return;

    const internalEvents = await iterateInternalForEvent(hash, blockNumber, transactionLog.internalTxs, option, networkData, web3);
    internalEvents.forEach((event) => {
        if (seenEvent.has(event.eventSignature)) return;
        if (!avoidDuplicatingInternalEvents) {
            transactionLog.events.push(event);
        }
        seenEvent.add(event.eventSignature);
    });

    const receiptLogs = option.internalTransaction == 1
        ? await getEventFromErigon(transactionLog.transactionHash, networkData)
        : await getEventFromHardHat(transactionLog.transactionHash, networkData, hre, blockNumber);
    if (receiptLogs.length > 0) {
        await appendReceiptEvents(transactionLog, receiptLogs, seenEvent, blockNumber, networkData, web3, false);
    }
}

// ---------------------------------------------------------------------------
// Ciclo di vita del worker
// ---------------------------------------------------------------------------

/**
 * Decodifica l'input e costruisce il log della transazione.
 * @returns {Promise<{log: Object, metrics: Object}>}
 */
async function processTransaction(tx, mainContract, contractTree, contractAddress, smartContract, option, networkData, addressRange) {
    const timeWorkerStart = Date.now();
    decodeInput(tx, contractTree);
    try {
        console.log(`Processing transaction: ${tx.hash}`);
        return await createTransactionLog(tx, mainContract, contractTree, smartContract, contractAddress, option, networkData, addressRange);
    } finally {
        timePerformance.time_workerTotal = Date.now() - timeWorkerStart;
        if (global.gc) global.gc();
    }
}

/** Ripulisce l'ambiente Hardhat dopo l'elaborazione. */
async function cleanupHardhat() {
    if (global.gc) global.gc();
    await hre.run("clean");
    await hre.network.provider.send("hardhat_reset");
    if (hre.network.provider.removeAllListeners) {
        hre.network.provider.removeAllListeners();
    }
    if (global.gc) global.gc();
}

process.on("message", async (data) => {
    const { tx, mainContract, contractTree, contractAddress, smartContract, option, networkData, addressRange, returnInMemory } = data;
    try {
        await connectDB(networkData.networkName);
        const extractedLog = await processTransaction(tx, mainContract, contractTree, contractAddress, smartContract, option, networkData, addressRange);
        await cleanupHardhat();

        // NOTA: process.exit subito dopo process.send può troncare messaggi IPC molto
        // grandi (vedi CHANGELOG, punti dubbi); comportamento originale mantenuto.
        process.send({
            status: "done",
            data: returnInMemory ? extractedLog : null,
            metrics: timePerformance,
        });
        process.exit(0);
    } catch (err) {
        console.error("Worker error:", err);
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
        process.send({ error: err.message });
        process.exit(1);
    }
});

process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception in worker:", err);
    process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection in worker at:", promise, "reason:", reason);
    process.exit(1);
});

module.exports = {
    makeRpcCallStreaming,
    decodeInput,
    regroupShatrace,
    createShatrace,
    assignStorageToTheInternal,
    decodeInteralTxsStorage,
};
