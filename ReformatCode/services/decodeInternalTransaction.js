// Decodifica delle transazioni interne: ABI da DB o da Etherscan, fallback su
// 4byte.directory, eventi emessi da ogni contratto chiamato.
const axios = require("axios");
// MIGRAZIONE: dentro services/ i tre percorsi diventano
// "../query/query", "../databaseStore" e "../config/db"
const { searchAbi } = require("../../query/query");
const { saveAbi } = require("../../databaseStore");
const { connectDB } = require("../../config/db");
const { getEventsFromInternal } = require("./decodingUtils/utils");
const InputDataDecoder = require("ethereum-input-data-decoder");
const { HEX_PREFIX, ensureHexPrefix } = require("./shared/hexUtils");
const { UNVERIFIED_CONTRACT_MESSAGE, buildGetSourceCodeUrl } = require("./shared/etherscan");

// Attesa prima di ogni chiamata a Etherscan (rate limit).
const ABI_FETCH_DELAY_MS = 5000;
const FOUR_BYTE_SIGNATURES_URL = "https://www.4byte.directory/api/v1/signatures/?hex_signature=";
// "0x" + 4 byte di selettore.
const METHOD_SELECTOR_LENGTH = 10;
const ZERO_METHOD_SELECTOR = "0x00000000";
const EMPTY_INPUT = "0x";
const EMPTY_ABI = "[]";
const PROXY_FLAG = "1";
const ETHERSCAN_ERROR_MESSAGE = "NOTOK";
const DELEGATECALL = "DELEGATECALL";
const ROOT_CALL_ID = "0";
const ROOT_DEPTH = 0;

const METRIC = {
    FOUR_BYTE_LOOKUP: "time_4byteLookupInternal",
    SEARCH_ABI: "time_searchAbiInternal",
    DECODE_INPUTS: "time_decodeInputsInternal",
    FETCH_ABI: "time_fetchAbiInternal",
    FETCH_ABI_DELAY: "time_fetchAbiDelayInternal",
    GET_EVENTS: "time_getEventsInternal",
    INTERNAL_TXS_VISITED: "number_internalTxsVisited",
    DECODE_RECURSIVE: "time_decodeInternalRecursive",
    CALL_TRACER: "time_debugInternalCallTracer",
    CONNECT_DB: "time_connectDbInternal",
    NEW_DECODED_DETAILED: "time_newDecodedInternalTransactionDetailed",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Metriche
// ---------------------------------------------------------------------------

function addMetric(metrics, key, value) {
    if (!metrics) return;
    metrics[key] = (metrics[key] || 0) + value;
}

/**
 * Esegue fn e somma la durata (ms) alla metrica indicata. Se fn lancia,
 * la metrica non viene aggiornata (come nel codice originale).
 */
async function measureAsync(metrics, key, fn) {
    const start = Date.now();
    const result = await fn();
    addMetric(metrics, key, Date.now() - start);
    return result;
}

// ---------------------------------------------------------------------------
// Helper sugli input
// ---------------------------------------------------------------------------

/**
 * L'ABI (stringa) non segnala un contratto non verificato.
 * Lancia TypeError se abi non è una stringa, come le espressioni originali.
 */
function isVerifiedAbi(abi) {
    return !abi.includes(UNVERIFIED_CONTRACT_MESSAGE);
}

/** Aggiunge "0x" a inputsCall quando input non è valorizzato. */
function normalizeInputsCallPrefix(element) {
    if (!element.input && element.inputsCall) {
        element.inputsCall = ensureHexPrefix(element.inputsCall);
    }
}

/** Input grezzo della chiamata: input se presente, altrimenti inputsCall. */
function getRawInput(element) {
    return element.input ? element.input : element.inputsCall;
}

// ---------------------------------------------------------------------------
// Decodifica degli input
// ---------------------------------------------------------------------------

/**
 * Contratto non verificato: imposta activity a "transfer" (input vuoto), al nome
 * trovato su 4byte.directory oppure al selettore del metodo.
 */
async function handleUnverifiedContract(element, web3, metrics) {
    if (!element.input) {
        const inputsCall = element.inputsCall;
        element.input = inputsCall.slice(0, 2) == HEX_PREFIX ? inputsCall : ensureHexPrefix(inputsCall);
    }

    if (element.input === EMPTY_INPUT) {
        element.activity = "transfer";
        element.value = element.value || EMPTY_INPUT;
    } else {
        await tryMethodSignature(element, web3, metrics);
        if (!element.activity) {
            element.activity = element.input?.slice(0, METHOD_SELECTOR_LENGTH) || element.inputsCall?.slice(0, METHOD_SELECTOR_LENGTH);
        }
    }

    delete element.input;
}

/**
 * Prova a decodificare i parametri con una firma testuale ("transfer(address,uint256)").
 * @returns {boolean} true se la decodifica è riuscita (element.inputs impostato)
 */
function tryDecodeWithTextSignature(element, valueTypes, rawInput, web3) {
    try {
        const decodedParams = [];
        if (valueTypes.length > 0) {
            const valueDecoded = web3.eth.abi.decodeParameters(valueTypes, rawInput.slice(METHOD_SELECTOR_LENGTH));
            for (let i = 0; i < valueTypes.length; i++) {
                decodedParams.push({
                    value: valueDecoded[i],
                    name: valueTypes[i],
                    type: valueTypes[i],
                });
            }
        }
        element.inputs = decodedParams;
        return true;
    } catch (err) {
        // Probabile collisione di selettore: si prova la firma successiva.
        return false;
    }
}

/**
 * Cerca il selettore su 4byte.directory e decodifica i parametri con la prima
 * firma compatibile. Imposta element.activity ed element.inputs.
 * @returns {Promise<boolean>}
 */
async function tryMethodSignature(element, web3, metrics) {
    const rawInput = element.input || element.inputsCall;
    if (!rawInput || rawInput === EMPTY_INPUT) {
        return false;
    }

    const methodSignature = rawInput.slice(0, METHOD_SELECTOR_LENGTH);
    if (methodSignature === ZERO_METHOD_SELECTOR) {
        element.activity = "Transfer*";
        element.inputs = rawInput;
        return false;
    }

    try {
        const response = await measureAsync(metrics, METRIC.FOUR_BYTE_LOOKUP, () => axios.get(FOUR_BYTE_SIGNATURES_URL + methodSignature));
        const results = response.data.results;
        if (!results || results.length === 0) return false;

        // In caso di collisione si provano tutte le firme finché una decodifica.
        for (const result of results) {
            const [activity, paramsString] = result.text_signature.split("(");
            element.activity = activity;
            const rawParams = paramsString.slice(0, -1);
            const valueTypes = rawParams ? rawParams.split(",") : [];
            if (tryDecodeWithTextSignature(element, valueTypes, rawInput, web3)) {
                return true;
            }
        }

        // Firme trovate ma nessuna decodifica riuscita.
        if (!element.inputs || element.inputs.length === 0) {
            element.inputs = rawInput;
            return true;
        }
    } catch (err) {
        console.error(`Error fetching method signature for ${methodSignature}:`, err.message);
    }
    return false;
}

/**
 * Decodifica l'input della chiamata interna con l'ABI e converte gas/gasUsed.
 * Imposta element.activity, element.contractCalledName ed element.inputs.
 */
function decodeInputs(element, abi, web3, contractName) {
    const decoder = new InputDataDecoder(abi);
    const tempResult = decoder.decodeData(getRawInput(element));

    // FIX-09: la funzione "ToNumber" non esiste (ReferenceError quando gas non è
    // numerico, es. undefined). Si usa la stessa conversione già applicata a gasUsed.
    if (element.gas && isNaN(Number(element.gas))) {
        element.gas = web3.utils.hexToNumber(element.gas);
    }
    if (element.gasUsed && isNaN(Number(element.gasUsed))) {
        element.gasUsed = web3.utils.hexToNumber(element.gasUsed);
    }

    element.activity = tempResult.method;
    element.contractCalledName = contractName;
    element.inputs = tempResult.inputs.map((input, i) => ({
        name: tempResult.names[i],
        type: tempResult.types[i],
        value: input._isBigNumber ? Number(web3.utils.hexToNumber(input._hex)) : input,
    }));
}

/** decodeInputs con misura del tempo nella metrica time_decodeInputsInternal. */
function decodeInputsMeasured(element, abi, web3, contractName, metrics) {
    const start = Date.now();
    decodeInputs(element, abi, web3, contractName);
    addMetric(metrics, METRIC.DECODE_INPUTS, Date.now() - start);
}

/**
 * Decodifica con un'ABI scaricata da Etherscan. Se non si ottiene activity si
 * ricorre a 4byte; altrimenti viene eseguito onDecoded (se fornito).
 */
async function decodeWithFetchedAbi(element, abi, contractName, web3, metrics, onDecoded) {
    decodeInputsMeasured(element, abi, web3, contractName, metrics);
    if (element.activity == null) {
        await tryMethodSignature(element, web3, metrics);
    } else if (onDecoded) {
        await onDecoded();
    }
}

/** Dopo la decodifica: 4byte se manca activity, poi fallback "non verificato". */
async function completeActivityWithFallbacks(element, web3, metrics) {
    if (!element.activity) {
        await tryMethodSignature(element, web3, metrics);
    }
    if (!element.activity) {
        await handleUnverifiedContract(element, web3, metrics);
    }
}

// ---------------------------------------------------------------------------
// ABI già presente in DB
// ---------------------------------------------------------------------------

/**
 * Decodifica con l'ABI dell'implementazione del proxy letta dal DB.
 * @returns {Promise<boolean>} true se l'implementazione era in DB e verificata
 */
async function decodeWithStoredImplementation(element, response, web3, metrics) {
    const query = { contractAddress: response.proxyImplementation.toLowerCase() };
    const implementation = await measureAsync(metrics, METRIC.SEARCH_ABI, () => searchAbi(query));
    if (!implementation || !isVerifiedAbi(implementation.abi)) {
        return false;
    }
    decodeInputsMeasured(element, JSON.parse(implementation.abi), web3, implementation.contractName, metrics);
    if (!element.activity) {
        await tryMethodSignature(element, web3, metrics);
    }
    return true;
}

/**
 * Decodifica una chiamata interna usando il documento ContractData trovato in DB.
 *
 * @param {Object} element chiamata interna (viene mutata)
 * @param {Object} response documento ContractData
 * @param {Object} web3
 * @param {Object} [metrics]
 */
async function handleAbiFromDb(element, response, web3, metrics) {
    normalizeInputsCallPrefix(element);
    if (!isVerifiedAbi(response.abi)) {
        await handleUnverifiedContract(element, web3, metrics);
        return;
    }
    if (response.proxy == PROXY_FLAG && response.proxyImplementation != "") {
        await decodeWithStoredImplementation(element, response, web3, metrics);
        return;
    }
    decodeInputsMeasured(element, JSON.parse(response.abi), web3, response.contractName, metrics);
    await completeActivityWithFallbacks(element, web3, metrics);
}

/** Variante di handleAbiFromDb usata da decodeInternalRecursive (callTracer). */
async function handleAbiFromDbErigon(element, response, web3, metrics) {
    if (!isVerifiedAbi(response.abi)) {
        await handleUnverifiedContract(element, web3, metrics);
        return;
    }
    if (response.proxy === PROXY_FLAG && response.proxyImplementation != "") {
        const decoded = await decodeWithStoredImplementation(element, response, web3, metrics);
        if (!decoded) {
            await tryMethodSignature(element, web3, metrics);
        }
        return;
    }
    const abiFromDb = JSON.parse(response.abi);
    if (response.abi != EMPTY_ABI) {
        decodeInputsMeasured(element, abiFromDb, web3, response.contractName, metrics);
    }
    await completeActivityWithFallbacks(element, web3, metrics);
}

// ---------------------------------------------------------------------------
// ABI da Etherscan
// ---------------------------------------------------------------------------

// Differenze tra le due varianti originali (handleAbiFetch / handleAbiFetchErigon).
const STANDARD_FETCH_VARIANT = {
    // Chiamata DELEGATECALL candidata come implementazione del proxy.
    getNextElement: (element) => element.possibleImplementation,
    // Nel contratto "regolare" un'ABI "[]" viene comunque passata al decoder.
    skipEmptyAbi: false,
    // Se l'ABI non è decodificabile si usa sempre handleUnverifiedContract.
    unverifiedOnlyWithoutActivity: false,
};
const ERIGON_FETCH_VARIANT = {
    getNextElement: (element) => element.calls?.[0],
    skipEmptyAbi: true,
    unverifiedOnlyWithoutActivity: true,
};

/** Chiamata getsourcecode con misura del tempo. */
function fetchSourceCode(endpoint, address, apiKey, metrics) {
    return measureAsync(metrics, METRIC.FETCH_ABI, () => axios.get(buildGetSourceCodeUrl(endpoint, address, apiKey)));
}

/** Documento ContractData da salvare a partire dal risultato di Etherscan. */
function buildStoreAbi(etherscanResult, contractAddress) {
    return {
        contractName: etherscanResult.ContractName,
        abi: etherscanResult.ABI,
        proxy: etherscanResult.Proxy,
        proxyImplementation: "",
        sourceCode: etherscanResult.SourceCode,
        contractAddress,
        compilerVersion: etherscanResult.CompilerVersion,
    };
}

/** La chiamata successiva è la DELEGATECALL del proxy verso l'implementazione con lo stesso input. */
function isDelegateCallToImplementation(nextElement, element) {
    return Boolean(
        nextElement &&
        nextElement.type === DELEGATECALL &&
        nextElement.from === element.to &&
        nextElement.input === getRawInput(element)
    );
}

/**
 * Contratto proxy: decodifica con l'ABI dell'implementazione (se la chiamata
 * successiva è la DELEGATECALL corrispondente) oppure con l'ABI del proxy.
 */
async function decodeProxyCall(element, etherscanResult, storeAbi, apiKey, endpoint, web3, metrics, variant) {
    const nextElement = variant.getNextElement(element);
    if (isDelegateCallToImplementation(nextElement, element)) {
        const implementationCall = await fetchSourceCode(endpoint, nextElement.to, apiKey, metrics);
        const implementationResult = implementationCall.data.result[0];
        const implementationAbi = buildStoreAbi(implementationResult, nextElement.to);

        if (isVerifiedAbi(implementationResult.ABI)) {
            await decodeWithFetchedAbi(element, implementationResult.ABI, implementationResult.ContractName, web3, metrics, async () => {
                storeAbi.proxyImplementation = nextElement.to;
                await saveAbi(implementationAbi);
            });
        } else {
            await handleUnverifiedContract(element, web3, metrics);
        }
        return;
    }

    if (isVerifiedAbi(etherscanResult.ABI)) {
        await decodeWithFetchedAbi(element, etherscanResult.ABI, etherscanResult.ContractName, web3, metrics);
    } else {
        // FIX-11: la variante Erigon non passava "metrics", perdendo le metriche di 4byte.
        await handleUnverifiedContract(element, web3, metrics);
    }
}

/** Contratto non proxy: decodifica con la sua ABI e la salva se la decodifica riesce. */
async function decodeRegularCall(element, etherscanResult, storeAbi, web3, metrics, variant) {
    const canDecode = (!variant.skipEmptyAbi || storeAbi.abi != EMPTY_ABI) && isVerifiedAbi(etherscanResult.ABI);
    if (canDecode) {
        await decodeWithFetchedAbi(element, etherscanResult.ABI, etherscanResult.ContractName, web3, metrics, () => saveAbi(storeAbi));
        return;
    }
    if (!variant.unverifiedOnlyWithoutActivity || !element.activity) {
        await handleUnverifiedContract(element, web3, metrics);
    }
}

/**
 * Gestisce una risposta getsourcecode.
 * @returns {Promise<boolean>} false solo se la risposta è un errore ("NOTOK") di un contratto non proxy
 */
async function processFetchedAbi(element, callForAbi, addressTo, apiKey, endpoint, web3, metrics, variant) {
    const etherscanResult = callForAbi.data.result[0];
    const storeAbi = buildStoreAbi(etherscanResult, addressTo);

    if (etherscanResult.Proxy === PROXY_FLAG) {
        await decodeProxyCall(element, etherscanResult, storeAbi, apiKey, endpoint, web3, metrics, variant);
        await saveAbi(storeAbi);
        return true;
    }
    if (callForAbi.data.message.includes(ETHERSCAN_ERROR_MESSAGE)) {
        return false;
    }
    await decodeRegularCall(element, etherscanResult, storeAbi, web3, metrics, variant);
    return true;
}

/**
 * Scarica l'ABI da Etherscan (un solo tentativo, dopo ABI_FETCH_DELAY_MS) e
 * decodifica la chiamata interna. Gli errori vengono solo loggati.
 *
 * @param {Object} element chiamata interna (viene mutata)
 * @param {string} addressTo
 * @param {string} apiKey
 * @param {string} endpoint
 * @param {Object} web3
 * @param {Object} [metrics]
 */
async function handleAbiFetch(element, addressTo, apiKey, endpoint, web3, metrics) {
    normalizeInputsCallPrefix(element);
    await sleep(ABI_FETCH_DELAY_MS);

    try {
        const callForAbi = await fetchSourceCode(endpoint, addressTo, apiKey, metrics);
        await processFetchedAbi(element, callForAbi, addressTo, apiKey, endpoint, web3, metrics, STANDARD_FETCH_VARIANT);
    } catch (err) {
        console.log("handleAbiFetch error for address", addressTo, ":", err.message);
    }
}

/**
 * Variante usata da decodeInternalRecursive: ritenta finché Etherscan non
 * risponde senza errore (NOTA: senza limite di tentativi, vedi CHANGELOG) e
 * non intercetta le eccezioni.
 */
async function handleAbiFetchErigon(element, addressTo, apiKey, endpoint, web3, metrics) {
    let handled = false;
    while (!handled) {
        await measureAsync(metrics, METRIC.FETCH_ABI_DELAY, () => sleep(ABI_FETCH_DELAY_MS));
        const callForAbi = await fetchSourceCode(endpoint, addressTo, apiKey, metrics);
        handled = await processFetchedAbi(element, callForAbi, addressTo, apiKey, endpoint, web3, metrics, ERIGON_FETCH_VARIANT);
    }
}

// ---------------------------------------------------------------------------
// Visita delle chiamate interne
// ---------------------------------------------------------------------------

/** Aggiunge a element.events gli eventi non ancora visti (per eventSignature). */
function appendUniqueEvents(element, events, seenEvent) {
    for (const event of events) {
        if (!seenEvent.has(event.eventSignature)) {
            element.events.push(event);
            seenEvent.add(event.eventSignature);
        }
    }
}

/**
 * Decodifica una lista piatta di chiamate interne (estratte dagli structLogs).
 *
 * @param {Array} internalCalls chiamate interne (vengono mutate)
 * @param {*} smartContract file caricato dall'utente (se valorizzato non decodifica)
 * @param {Object} web3
 * @param {Object} networkData
 * @param {string} transactionHash
 * @param {number} blockNumber
 * @param {Object} [metrics]
 * @returns {Promise<Array>} le stesse internalCalls
 */
async function decodeInternalTransaction(internalCalls, smartContract, web3, networkData, transactionHash, blockNumber, metrics) {
    if (smartContract) {
        console.log("smart contract uploaded manually");
        return internalCalls;
    }

    const seenEvent = new Set();
    await connectDB(networkData.networkName);
    for (const element of internalCalls) {
        element.events = [];
        const addressTo = element.to;
        const query = { contractAddress: addressTo.toLowerCase() };
        const response = await measureAsync(metrics, METRIC.SEARCH_ABI, () => searchAbi(query));
        if (!response) {
            await handleAbiFetch(element, addressTo, networkData.apiKey, networkData.endpoint, web3, metrics);
        } else {
            await handleAbiFromDb(element, response, web3, metrics);
        }
        const events = await measureAsync(metrics, METRIC.GET_EVENTS, () =>
            getEventsFromInternal(transactionHash, blockNumber, addressTo, networkData, web3));
        appendUniqueEvents(element, events, seenEvent);
    }
    return internalCalls;
}

/** Eventi del contratto "to" della chiamata, oppure di "from" se "to" non ne ha. */
async function getEventsForInternalCall(element, addressTo, transactionHash, blockNumber, networkData, web3) {
    const events = await getEventsFromInternal(transactionHash, blockNumber, addressTo, networkData, web3);
    if (events.length == 0) {
        return getEventsFromInternal(transactionHash, blockNumber, element.from, networkData, web3);
    }
    return events;
}

/** Dopo la decodifica: tiene inputsCall solo se non ci sono input decodificati. */
function cleanupInputFields(element) {
    if (element.inputs && element.inputs.length > 0) {
        delete element.inputsCall;
    } else {
        element.inputsCall = element.input;
    }
    delete element.input;
}

/**
 * Decodifica ricorsivamente l'albero di chiamate restituito dal callTracer.
 * Assegna a ogni chiamata callId ("<padre>_<n>") e depth.
 *
 * @param {Array} internalCalls chiamate (vengono mutate)
 * @param {*} smartContract
 * @param {Object} networkData
 * @param {Object} web3
 * @param {number} depth profondità corrente
 * @param {string} callId id della chiamata padre
 * @param {string} transactionHash
 * @param {number} blockNumber
 * @param {Set} seenEvent eventSignature già assegnate
 * @param {boolean} [simulation=false] se true non recupera gli eventi
 * @param {Object} [metrics]
 */
async function decodeInternalRecursive(internalCalls, smartContract, networkData, web3, depth, callId, transactionHash, blockNumber, seenEvent, simulation = false, metrics) {
    const timeRecursiveStart = Date.now();
    let childIndex = 1;

    for (const element of internalCalls) {
        addMetric(metrics, METRIC.INTERNAL_TXS_VISITED, 1);
        element.events = [];
        const addressTo = element.to;
        const query = { contractAddress: addressTo.toLowerCase() };

        element.callId = callId + "_" + childIndex;
        element.depth = depth;
        element.gas = web3.utils.hexToNumber(element.gas);
        element.gasUsed = web3.utils.hexToNumber(element.gasUsed);
        element.value = element.value ? web3.utils.hexToNumber(element.value) : 0;
        childIndex++;

        const response = await measureAsync(metrics, METRIC.SEARCH_ABI, () => searchAbi(query));
        if (!response) {
            await handleAbiFetchErigon(element, addressTo, networkData.apiKey, networkData.endpoint, web3, metrics);
        } else {
            await handleAbiFromDbErigon(element, response, web3, metrics);
        }

        if (!simulation) {
            const events = await measureAsync(metrics, METRIC.GET_EVENTS, () =>
                getEventsForInternalCall(element, addressTo, transactionHash, blockNumber, networkData, web3));
            appendUniqueEvents(element, events, seenEvent);
        }
        cleanupInputFields(element);

        if (element.calls && element.calls.length > 0) {
            await decodeInternalRecursive(element.calls, smartContract, networkData, web3, depth + 1, element.callId, transactionHash, blockNumber, seenEvent, simulation, metrics);
        }
    }
    addMetric(metrics, METRIC.DECODE_RECURSIVE, Date.now() - timeRecursiveStart);
}

/**
 * Albero delle chiamate interne con debug_traceTransaction + callTracer.
 * @returns {Promise<Array|undefined>} result.calls
 */
async function debugInternalTransaction(transactionHash, web3Endpoint, metrics) {
    try {
        const payload = {
            jsonrpc: "2.0",
            method: "debug_traceTransaction",
            params: [transactionHash, { tracer: "callTracer" }],
            id: 1,
        };
        const response = await measureAsync(metrics, METRIC.CALL_TRACER, () =>
            axios.post(web3Endpoint, payload, { headers: { "Content-Type": "application/json" } }));
        return response.data.result.calls;
    } catch (err) {
        console.error("debugInternalTransaction error:", err.message);
        throw err;
    }
}

/**
 * Estrae (callTracer) e decodifica le transazioni interne della transazione.
 *
 * @param {string} transactionHash
 * @param {*} smartContract file caricato dall'utente (se valorizzato non decodifica)
 * @param {Object} networkData
 * @param {Object} web3
 * @param {number} blockNumber
 * @param {Object} [metrics]
 * @returns {Promise<Array|undefined>} albero delle chiamate interne decodificate
 */
async function newDecodedInternalTransaction(transactionHash, smartContract, networkData, web3, blockNumber, metrics) {
    const timeNewDecodedStart = Date.now();
    const internalCalls = await debugInternalTransaction(transactionHash, networkData.web3Endpoint, metrics);

    if (!smartContract && internalCalls) {
        const seenEvent = new Set();
        await measureAsync(metrics, METRIC.CONNECT_DB, () => connectDB(networkData.networkName));
        await decodeInternalRecursive(internalCalls, smartContract, networkData, web3, ROOT_DEPTH, ROOT_CALL_ID, transactionHash, blockNumber, seenEvent, false, metrics);
    } else {
        console.log("smart contract uploaded manually");
    }
    addMetric(metrics, METRIC.NEW_DECODED_DETAILED, Date.now() - timeNewDecodedStart);
    return internalCalls;
}

module.exports = {
    decodeInternalTransaction,
    newDecodedInternalTransaction,
    handleAbiFetch,
    decodeInternalRecursive,
    handleAbiFromDb,
};
