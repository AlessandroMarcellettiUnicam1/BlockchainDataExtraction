// Decodifica degli input delle transazioni pubbliche e recupero/decodifica degli eventi.
const InputDataDecoder = require("ethereum-input-data-decoder");
const axios = require("axios");
const hre = require("hardhat");
// MIGRAZIONE: dentro services/decodingUtils i due percorsi diventano
// "../../query/query" e "../../databaseStore"
const { searchAbi } = require("../../../query/query");
const { saveAbi } = require("../../../databaseStore");
const { buildGetSourceCodeUrl, isUnverifiedAbi } = require("../shared/etherscan");
const { postJsonRpc } = require("../shared/jsonRpc");

const PROXY_FLAG = "1";
const EMPTY_ABI = "[]";
const ETHERSCAN_ERROR_MESSAGE = "NOTOK";
// Chiave aggiunta da web3 ai risultati di decodeLog/returnValues.
const WEB3_LENGTH_KEY = "__length__";

/**
 * Decodifica l'input di una transazione con l'ABI del contratto e lo salva in tx.inputDecoded.
 * @param {Object} tx transazione (viene mutata)
 * @param {string|Array} contractAbi
 * @param {*} [web3] non usato, mantenuto per compatibilità della firma
 */
function decodeTransactionInputs(tx, contractAbi, web3) {
    const decoder = new InputDataDecoder(contractAbi);
    tx.inputDecoded = decoder.decodeData(tx.input);
}

/**
 * Converte l'ABI in array; null se assente, vuota, non verificata o non parsabile.
 * @param {string|Array} abi
 * @returns {Array|null}
 */
function parseAbiSafely(abi) {
    if (!abi || abi === EMPTY_ABI || isUnverifiedAbi(abi)) return null;
    if (Array.isArray(abi)) return abi;
    try {
        return JSON.parse(abi);
    } catch (err) {
        console.log("ABI parse failed for event decoding: " + err.message);
        return null;
    }
}

/**
 * Tiene solo i parametri nominati dell'evento e converte i bigint in Number.
 * NOTA: la conversione Number() perde precisione oltre 2^53 (vedi CHANGELOG, punti dubbi).
 * @param {Object} values
 * @returns {Object}
 */
function normalizeEventValues(values) {
    return Object.fromEntries(
        Object.entries(values || {})
            .filter(([key]) => key !== WEB3_LENGTH_KEY && Number.isNaN(Number(key)))
            .map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value])
    );
}

/**
 * keccak256 della firma dell'evento (topic0).
 * @returns {string}
 */
function getEventSignature(web3, eventAbi) {
    const signature = `${eventAbi.name}(${eventAbi.inputs.map((input) => input.type).join(",")})`;
    return web3.utils.sha3(signature);
}

function hasUsableAbiForEvents(abi) {
    return !!parseAbiSafely(abi);
}

/**
 * Indirizzo di implementazione di un proxy (minuscolo), "" se assente.
 * @param {Object} contractData
 * @returns {string}
 */
function getProxyImplementationAddress(contractData) {
    return (
        contractData?.proxyImplementation ||
        contractData?.Implementation ||
        contractData?.implementation ||
        ""
    ).toLowerCase();
}

/**
 * Decodifica i log della ricevuta emessi da contractAddress usando l'ABI indicata.
 * @returns {Promise<Array<{eventName, eventValues, eventFrom, eventSignature}>>}
 */
async function decodeReceiptEventsForAddress(transactionHash, contractAddress, abi, networkData, web3) {
    const targetAbi = parseAbiSafely(abi);
    if (!targetAbi) return [];

    const receiptLogs = await getEventFromErigon(transactionHash, networkData);
    const eventByTopic = new Map(
        targetAbi
            .filter((item) => item.type === "event" && !item.anonymous)
            .map((eventAbi) => [getEventSignature(web3, eventAbi), eventAbi])
    );
    const normalizedAddress = contractAddress.toLowerCase();
    const decodedEvents = [];

    for (const log of receiptLogs || []) {
        if (log.address?.toLowerCase() !== normalizedAddress) continue;
        const eventAbi = eventByTopic.get(log.topics?.[0]);
        if (!eventAbi) continue;
        try {
            const decoded = web3.eth.abi.decodeLog(eventAbi.inputs, log.data || "0x", log.topics.slice(1));
            decodedEvents.push({
                eventName: eventAbi.name,
                eventValues: normalizeEventValues(decoded),
                eventFrom: normalizedAddress,
                eventSignature: web3.utils.hexToNumber(log.logIndex).toString(),
            });
        } catch (err) {
            console.log("Receipt event decode failed: " + err.message);
        }
    }

    return decodedEvents;
}

/**
 * Eventi emessi da contractAddress nella transazione: prima dalla ricevuta (se c'è
 * un endpoint), altrimenti con getPastEvents sul blocco.
 *
 * @param {string} transactionHash
 * @param {number} block numero di blocco
 * @param {string} contractAddress
 * @param {Object} web3
 * @param {string|Array} contractAbi
 * @param {Object} networkData
 * @returns {Promise<Array<{eventName, eventValues, eventFrom, eventSignature}>>}
 */
async function getEvents(transactionHash, block, contractAddress, web3, contractAbi, networkData) {
    if (networkData?.web3Endpoint) {
        const decodedReceiptEvents = await decodeReceiptEventsForAddress(transactionHash, contractAddress, contractAbi, networkData, web3);
        if (decodedReceiptEvents.length > 0) return decodedReceiptEvents;
    }

    const parsedAbi = parseAbiSafely(contractAbi);
    if (!parsedAbi) return [];

    const contract = new web3.eth.Contract(parsedAbi, contractAddress);
    const pastEvents = await contract.getPastEvents("allEvents", { fromBlock: block, toBlock: block });
    return pastEvents
        .filter((element) => transactionHash == element.transactionHash && element.event)
        .map((element) => ({
            eventName: element.event,
            eventValues: normalizeEventValues(element.returnValues),
            eventFrom: contractAddress.toLowerCase(),
            eventSignature: element.logIndex.toString(),
        }));
}

/**
 * Log della ricevuta della transazione (eth_getTransactionReceipt) letti dal nodo.
 * @param {string} transactionHash
 * @param {Object} networkData
 * @returns {Promise<Array>}
 */
async function getEventFromErigon(transactionHash, networkData) {
    return postJsonRpc(networkData.web3Endpoint, "eth_getTransactionReceipt", [transactionHash], (result) => result.logs);
}

/**
 * Log della ricevuta letti tramite il fork Hardhat al blocco indicato.
 * @param {string} transactionHash
 * @param {Object} networkData
 * @param {*} hardhat non usato, mantenuto per compatibilità della firma
 * @param {number} blockNumber
 * @returns {Promise<Array>}
 */
async function getEventFromHardHat(transactionHash, networkData, hardhat, blockNumber) {
    await hre.changeNetwork(networkData.networkName, blockNumber);
    const receipt = await hre.network.provider.send("eth_getTransactionReceipt", [transactionHash]);
    return receipt.logs;
}

/**
 * Decodifica gli eventi emessi da un contratto (interno) della transazione.
 * Se il contratto è un proxy usa, quando disponibile, l'ABI dell'implementazione.
 *
 * @param {string} transactionHash
 * @param {number} block
 * @param {string} contractAddress
 * @param {Object} networkData
 * @param {Object} web3
 * @returns {Promise<Array>}
 */
async function getEventsFromInternal(transactionHash, block, contractAddress, networkData, web3) {
    if (!contractAddress) return [];
    const normalizedAddress = contractAddress.toLowerCase();
    let proxyInfo = await searchAbi({ contractAddress: normalizedAddress });
    if (!proxyInfo) {
        proxyInfo = await handleAbiFetch(normalizedAddress, networkData.apiKey, networkData.endpoint);
    }

    let targetAbi = proxyInfo?.abi;
    let implementationAddress = getProxyImplementationAddress(proxyInfo);
    const isProxy = proxyInfo?.proxy === PROXY_FLAG;

    if (isProxy && !implementationAddress) {
        const refreshedProxyInfo = await handleAbiFetch(normalizedAddress, networkData.apiKey, networkData.endpoint);
        implementationAddress = getProxyImplementationAddress(refreshedProxyInfo);
        targetAbi = refreshedProxyInfo?.abi || targetAbi;
    }

    if (isProxy && implementationAddress) {
        let implInfo = await searchAbi({ contractAddress: implementationAddress });
        if (!implInfo || !hasUsableAbiForEvents(implInfo.abi)) {
            implInfo = await handleAbiFetch(implementationAddress, networkData.apiKey, networkData.endpoint);
        }
        if (hasUsableAbiForEvents(implInfo?.abi)) {
            targetAbi = implInfo.abi;
        }
    }

    return await decodeReceiptEventsForAddress(transactionHash, normalizedAddress, targetAbi, networkData, web3);
}

/**
 * Scarica ABI e metadati da Etherscan e li salva in DB se la risposta non è un errore.
 * @param {string} addressTo
 * @param {string} apiKey
 * @param {string} endpoint
 * @returns {Promise<Object>} documento ContractData
 */
async function handleAbiFetch(addressTo, apiKey, endpoint) {
    const callForAbi = await axios.get(buildGetSourceCodeUrl(endpoint, addressTo, apiKey));
    const result = callForAbi.data.result?.[0] || {};
    const storeAbi = {
        contractName: result.ContractName,
        abi: result.ABI,
        proxy: result.Proxy,
        proxyImplementation: result.Implementation || "",
        contractAddress: addressTo.toLowerCase(),
        compilerVersion: result.CompilerVersion,
        sourceCode: result.SourceCode,
    };
    if (!callForAbi.data.message.includes(ETHERSCAN_ERROR_MESSAGE)) {
        await saveAbi(storeAbi);
    }
    return storeAbi;
}

/**
 * Eventi emessi dai contratti delle transazioni interne.
 * - option.internalTransaction == 1: visita ricorsiva dell'albero delle chiamate;
 * - altrimenti: solo il primo livello, usando l'indirizzo "to".
 *
 * @param {string} transactionHash
 * @param {number} block
 * @param {Array} internalTxs
 * @param {Object} option
 * @param {Object} networkData
 * @param {Object} web3
 * @returns {Promise<Array>}
 */
async function iterateInternalForEvent(transactionHash, block, internalTxs, option, networkData, web3) {
    const eventArray = [];
    if (option.internalTransaction == 1) {
        await assignEventToInternal(transactionHash, block, internalTxs, networkData, web3, eventArray);
        return eventArray;
    }

    for (const element of internalTxs) {
        const resultEvents = await getEventsFromInternal(transactionHash, block, element["to"], networkData, web3);
        for (const event of resultEvents) {
            eventArray.push(event);
        }
    }
    return eventArray;
}

/**
 * Visita ricorsivamente l'albero delle chiamate interne e accumula in resultEvents
 * gli eventi di ogni contratto ("to", oppure "from" se "to" non ne restituisce).
 *
 * @param {string} transactionHash
 * @param {number} block
 * @param {Array} internalTxs
 * @param {Object} networkData
 * @param {Object} web3
 * @param {Array} resultEvents array di output (viene mutato)
 */
async function assignEventToInternal(transactionHash, block, internalTxs, networkData, web3, resultEvents) {
    for (const transaction of internalTxs) {
        let eventFromInternalContract = await getEventsFromInternal(transactionHash, block, transaction.to, networkData, web3);
        if (eventFromInternalContract.length == 0) {
            eventFromInternalContract = await getEventsFromInternal(transactionHash, block, transaction.from, networkData, web3);
        }
        for (const event of eventFromInternalContract) {
            resultEvents.push(event);
        }
        if (transaction.calls) {
            await assignEventToInternal(transactionHash, block, transaction.calls, networkData, web3, resultEvents);
        }
    }
}

/**
 * Come checkIfEventIsAlreadyStored, ma restituisce false se il confronto lancia.
 * (Esportata ma non usata nel workspace: mantenuta per compatibilità.)
 */
function safeCheck(arr, ev) {
    try {
        return checkIfEventIsAlreadyStored(arr, ev);
    } catch {
        console.log("Event to large to check ");
        return false;
    }
}

/**
 * true se events contiene un elemento strutturalmente uguale a eventToCheck.
 * (Esportata ma non usata nel workspace: mantenuta per compatibilità.)
 */
function checkIfEventIsAlreadyStored(events, eventToCheck) {
    return events.some((el) => deepEqual(el, eventToCheck));
}

function deepEqual(a, b, seen = new WeakMap()) {
    if (a === b) return true;
    if (typeof a !== "object" || typeof b !== "object" || a == null || b == null) return false;

    if (seen.has(a)) return seen.get(a) === b;
    seen.set(a, b);

    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
        if (!deepEqual(a[key], b[key], seen)) return false;
    }
    return true;
}

/**
 * Converte gli input decodificati da InputDataDecoder nel formato salvato in DB.
 *
 * @param {Object} inputDecoded risultato di decoder.decodeData (inputs, names, types)
 * @param {Object} web3
 * @returns {Array<{inputName, type, inputValue}>}
 */
function decodeInputs(inputDecoded, web3) {
    return inputDecoded.inputs.map((input, i) => {
        const type = inputDecoded.types[i];
        const inputName = Array.isArray(inputDecoded.names[i]) ? inputDecoded.names[i].toString() : inputDecoded.names[i];
        if (Array.isArray(input)) {
            // Tupla: il tipo del singolo campo è preso da types[i].split(",") (vedi CHANGELOG, punti dubbi).
            const tupleValues = input.map((val, z) => decodeInput(type.split(",")[z] || type, val, web3));
            return { inputName, type, inputValue: tupleValues.toString() };
        }
        return { inputName, type, inputValue: decodeInput(type, input, web3) };
    });
}

/**
 * Converte il valore di un singolo input. Solo uint256 viene trasformato in Number
 * (con perdita di precisione oltre 2^53, vedi CHANGELOG); gli altri tipi sono restituiti invariati.
 * @param {string} type
 * @param {*} value
 * @param {Object} web3
 * @returns {*}
 */
function decodeInput(type, value, web3) {
    if (value == null) return value;
    if (type !== "uint256") return value;

    try {
        if (value._hex) {
            return Number(web3.utils.hexToNumber(value._hex));
        }
        if (typeof value === "string" && value.startsWith("0x")) {
            return Number(web3.utils.hexToNumber(value));
        }
        return Number(value);
    } catch (e) {
        console.warn(`[decodeInput] Fallita decodifica uint256 per il valore:`, value);
        return 0; // Fallback per non far crashare l'estrattore
    }
}

module.exports = {
    decodeTransactionInputs,
    getEvents,
    iterateInternalForEvent,
    decodeInputs,
    checkIfEventIsAlreadyStored,
    safeCheck,
    getEventFromErigon,
    getEventFromHardHat,
    getEventsFromInternal,
    // Nuovo export (additivo): usato da Erigon/erigonApi.js al posto della sua copia identica.
    assignEventToInternal,
};
