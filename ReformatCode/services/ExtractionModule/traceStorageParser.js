// Parsing in streaming degli structLogs di debug_traceTransaction e costruzione
// delle "sha trace" (KECCAK256 usati come chiavi di storage).
//
// Unifica i due parser quasi identici di workerWithOption.js
// (getTraceStorageFromErigon e getTraceStorageInputStream): le differenze tra i
// due sono esplicitate in ERIGON_PARSER_OPTIONS e INPUT_STREAM_PARSER_OPTIONS.
const JSONStream = require("JSONStream");
const { ensureHexPrefix, stripHexPrefix } = require("../shared/hexUtils");

const STRUCT_LOGS_PATH = "result.structLogs.*";
const WORD_HEX_LENGTH = 64;
const WORD_BYTES = 32;
const ADDRESS_HEX_LENGTH = 40;
// Le sha trace con slot base sotto questa soglia sono quelle delle variabili di stato.
const MAX_COMPLEX_BASE_SLOT = 300;
const ZERO_WORD = "0".repeat(WORD_HEX_LENGTH);
// Valore di bufferPC quando non c'è un KECCAK256 in attesa del risultato.
const NO_PENDING_KECCAK_PC = -10;
// La transazione pubblica è sempre associata all'indice 1 di mapForStorage.
const PUBLIC_CALL_INDEX = "1";
// Indice di mapForStorage della prima chiamata interna.
const FIRST_INTERNAL_CALL_INDEX = 2;

/**
 * Opzioni del parser usato quando option.internalTransaction == 1.
 */
const ERIGON_PARSER_OPTIONS = Object.freeze({
    // KECCAK256: registra la sha trace solo se trace.memory è presente.
    requireMemoryForKeccak: true,
    // Storage di STOP/RETURN/SSTORE/SLOAD normalizzato (chiavi e valori senza 0x).
    normalizeStorage: true,
    // Una profondità si chiude su STOP e anche su RETURN.
    closeDepthOnReturn: true,
    // Opcode di chiamata considerati.
    callOpcodes: Object.freeze(["CALL", "DELEGATECALL", "STATICCALL"]),
    // Opcode con argomento "value" (offset e lunghezza dell'input spostati di una posizione).
    valueCallOpcodes: Object.freeze(["CALL"]),
    // La chiamata interna è registrata solo se trace.memory è presente.
    requireMemoryForCall: true,
    // Le parole di memoria vengono unite togliendo l'eventuale "0x".
    stripMemoryWordPrefix: true,
    // Salva l'indirizzo chiamato in mapForStorage[indice].contractAddress.
    recordCalledContract: true,
});

/**
 * Opzioni del parser usato quando option.internalTransaction != 1.
 */
const INPUT_STREAM_PARSER_OPTIONS = Object.freeze({
    requireMemoryForKeccak: false,
    normalizeStorage: false,
    closeDepthOnReturn: false,
    callOpcodes: Object.freeze(["CALL", "DELEGATECALL", "STATICCALL", "CALLCODE"]),
    valueCallOpcodes: Object.freeze(["CALL", "CALLCODE"]),
    requireMemoryForCall: false,
    stripMemoryWordPrefix: false,
    recordCalledContract: false,
});

/**
 * Normalizza la mappa storage di uno structLog: chiavi e valori senza "0x".
 * @param {Object|undefined} rawStorage
 * @returns {Object}
 */
function normalizeStorageEntries(rawStorage) {
    const normalized = {};
    for (const slot in rawStorage) {
        const cleanSlot = slot.startsWith("0x") ? slot.slice(2) : slot;
        let value = rawStorage[slot];
        if (typeof value === "string" && value.startsWith("0x")) {
            value = value.slice(2);
        }
        normalized[cleanSlot] = value;
    }
    return normalized;
}

/** Unisce le parole di memoria togliendo l'eventuale "0x" da ciascuna. */
function joinMemoryWords(memory) {
    return Array.isArray(memory) ? memory.map(stripHexPrefix).join("") : "";
}

/** Parola dello stack -> 64 caratteri esadecimali senza "0x". */
function normalizeStackWord(web3, word) {
    return web3.utils.padLeft(stripHexPrefix(word), WORD_HEX_LENGTH);
}

/** Valore in cima allo stack (offset 0) o sotto (offset 1, 2, ...). */
function stackItem(trace, offsetFromTop) {
    return trace.stack[trace.stack.length - 1 - offsetFromTop];
}

/**
 * Crea lo stato del parser e la funzione che elabora ogni structLog.
 *
 * Stato:
 * - mapForStorage: indice chiamata -> { trackBuffer, functionStorage, contractAddress? }
 *   (indice 1 = transazione pubblica, poi un indice per ogni nuova profondità)
 * - sstoreBuffer: chiavi scritte da SSTORE (cima dello stack)
 * - sstoreOptimization: stack completi degli SSTORE
 * - internalCalls: chiamate interne lette dagli opcode CALL*
 */
function createStructLogProcessor(web3, options) {
    const state = {
        mapForStorage: {},
        sstoreBuffer: [],
        sstoreOptimization: [],
        internalCalls: [],
    };
    const depthToIndexMap = new Map();
    let nextIndex = 1;
    // pc dell'ultimo KECCAK256: l'opcode successivo contiene il risultato in cima allo stack.
    let bufferPC = NO_PENDING_KECCAK_PC;

    function getOrCreateIndexForDepth(depth) {
        if (!depthToIndexMap.has(depth)) {
            const newIndex = nextIndex++;
            depthToIndexMap.set(depth, newIndex);
            state.mapForStorage[newIndex] = {
                trackBuffer: [],
                functionStorage: {},
            };
        }
        return depthToIndexMap.get(depth);
    }

    function mergeStorage(bucket, rawStorage) {
        if (options.normalizeStorage) {
            Object.assign(bucket.functionStorage, normalizeStorageEntries(rawStorage));
            return;
        }
        for (const slot in rawStorage) {
            bucket.functionStorage[slot] = rawStorage[slot];
        }
    }

    function handleKeccak(trace, bucket) {
        bufferPC = trace.pc;
        const memoryWordIndex = web3.utils.hexToNumber(ensureHexPrefix(stackItem(trace, 0))) / WORD_BYTES;
        if (options.requireMemoryForKeccak && !trace.memory) return;
        const memory = trace.memory || [];
        bucket.trackBuffer.push({
            hexKey: memory[memoryWordIndex],
            hexStorageIndex: memory[memoryWordIndex + 1],
        });
    }

    /**
     * Opcode successivo a un KECCAK256: ne registra il risultato (finalKey).
     * Per gli array dinamici (KECCAK256 seguito da ADD con slot 0) scambia chiave e
     * slot e salva in indexSum l'indice sommato.
     */
    function handleKeccakResult(trace, nextTrace, bucket) {
        bufferPC = NO_PENDING_KECCAK_PC;
        const lastIdx = bucket.trackBuffer.length - 1;
        if (lastIdx < 0) return;

        const entry = bucket.trackBuffer[lastIdx];
        entry.finalKey = stackItem(trace, 0);
        const isArrayIndexAddition = trace.op === "ADD" &&
            (stackItem(trace, 0) === entry.finalKey || stackItem(trace, 1) === entry.finalKey) &&
            entry.hexStorageIndex === ZERO_WORD;
        if (!isArrayIndexAddition) return;

        const keyBuff = entry.hexKey;
        entry.hexKey = entry.hexStorageIndex;
        entry.hexStorageIndex = keyBuff;
        if (nextTrace && nextTrace.stack && nextTrace.stack.length > 0) {
            entry.finalKey = stackItem(nextTrace, 0);
        }
        entry.indexSum = stackItem(trace, 1);
    }

    function handleCall(trace, currentIndex) {
        const hasValueArgument = options.valueCallOpcodes.includes(trace.op);
        const inputOffset = stackItem(trace, hasValueArgument ? 3 : 2);
        const inputLength = stackItem(trace, hasValueArgument ? 4 : 3);
        const call = {
            callId: "0_1" + "_1".repeat(Math.max(trace.depth - 1, 0)),
            callType: trace.op,
            depth: trace.depth,
            gas: web3.utils.hexToNumber(ensureHexPrefix(stackItem(trace, 0))),
            to: ensureHexPrefix(stripHexPrefix(stackItem(trace, 1)).slice(-ADDRESS_HEX_LENGTH)),
            inputsCall: "",
        };

        // Prepara il bucket della profondità successiva.
        getOrCreateIndexForDepth(trace.depth + 1);
        if (options.recordCalledContract) {
            state.mapForStorage[currentIndex].contractAddress = call.to;
        }
        if (options.requireMemoryForCall && !trace.memory) return;

        const memoryHex = options.stripMemoryWordPrefix ? joinMemoryWords(trace.memory) : (trace.memory || []).join("");
        if (memoryHex.length > 0) {
            const start = web3.utils.hexToNumber(ensureHexPrefix(inputOffset)) * 2;
            const length = web3.utils.hexToNumber(ensureHexPrefix(inputLength)) * 2;
            call.inputsCall = memoryHex.slice(start, start + length);
        }
        state.internalCalls.push(call);
    }

    /**
     * Elabora uno structLog. nextTrace è lo structLog successivo (null per l'ultimo).
     * NOTA: l'ordine dei rami è significativo (es. l'opcode subito dopo un
     * KECCAK256 viene trattato solo come "risultato del KECCAK256").
     */
    function processTrace(trace, nextTrace) {
        const currentIndex = getOrCreateIndexForDepth(trace.depth);
        const bucket = state.mapForStorage[currentIndex];

        if (trace.op === "KECCAK256") {
            handleKeccak(trace, bucket);
        } else if (trace.op === "STOP" || trace.op === "RETURN") {
            mergeStorage(bucket, trace.storage);
            if (trace.op === "STOP" || options.closeDepthOnReturn) {
                depthToIndexMap.delete(trace.depth);
            }
        } else if (trace.pc === bufferPC + 1) {
            handleKeccakResult(trace, nextTrace, bucket);
        } else if (trace.op === "SSTORE") {
            state.sstoreOptimization.push(trace.stack);
            state.sstoreBuffer.push(stackItem(trace, 0));
            mergeStorage(bucket, trace.storage);
        } else if (options.callOpcodes.includes(trace.op)) {
            handleCall(trace, currentIndex);
        } else if (trace.op === "SLOAD") {
            mergeStorage(bucket, trace.storage);
        }
    }

    return { state, processTrace };
}

/**
 * Legge in streaming gli structLogs e restituisce lo stato del parser.
 * Ogni structLog viene elaborato quando arriva il successivo (serve per i KECCAK256).
 *
 * @param {import("stream").Readable} httpStream risposta di debug_traceTransaction
 * @param {Object} web3
 * @param {Object} options ERIGON_PARSER_OPTIONS o INPUT_STREAM_PARSER_OPTIONS
 * @param {(error: Error) => void} [onParseError] chiamata prima di rifiutare la promise
 * @returns {{ state: Object, done: Promise<void> }} lo stato e la promise di fine stream
 */
function parseStructLogStream(httpStream, web3, options, onParseError) {
    const { state, processTrace } = createStructLogProcessor(web3, options);
    const parser = JSONStream.parse(STRUCT_LOGS_PATH);
    httpStream.pipe(parser);

    const done = new Promise((resolve, reject) => {
        let previousTrace = null;
        parser.on("data", (trace) => {
            if (trace.stack && trace.stack.length > 0) {
                trace.stack = trace.stack.map((word) => normalizeStackWord(web3, word));
            }
            if (previousTrace) {
                processTrace(previousTrace, trace);
            }
            previousTrace = trace;
        });

        parser.on("end", () => {
            if (previousTrace) {
                processTrace(previousTrace, null);
            }
            resolve();
        });

        parser.on("error", (error) => {
            if (onParseError) onParseError(error);
            reject(error);
        });
    });

    return { state, done };
}

/**
 * Per ogni sha trace il cui risultato è stato scritto da un SSTORE, aggiunge in coda
 * una sha trace con lo slot base della variabile (cercato all'indietro fino a uno
 * slot < 300) e consuma la chiave da sstoreBuffer.
 *
 * ATTENZIONE: le nuove sha trace vengono aggiunte in coda allo STESSO array che si
 * sta scorrendo (comportamento originale: gestisce più SSTORE sulla stessa chiave).
 *
 * @param {Array} trackBuffer sha trace (viene esteso)
 * @param {string[]} sstoreBuffer chiavi scritte da SSTORE (viene consumato)
 * @param {Object} web3
 * @param {(value: string) => string} toHexIndex conversione di hexStorageIndex per hexToNumber
 * @param {boolean} stopOnMissingStorageIndex interrompe la ricerca se hexStorageIndex manca
 */
function appendStoredShaTraces(trackBuffer, sstoreBuffer, web3, toHexIndex, stopOnMissingStorageIndex) {
    for (let i = 0; i < trackBuffer.length; i++) {
        const entry = trackBuffer[i];
        if (!(entry && sstoreBuffer.includes(entry.finalKey))) continue;

        const trace = {
            finalKey: entry.finalKey,
            hexKey: entry.hexKey,
            indexSum: entry.indexSum,
            hexStorageIndex: entry.hexStorageIndex,
        };

        for (let candidate = i; ;) {
            const storageIndex = trackBuffer[candidate].hexStorageIndex;
            if (stopOnMissingStorageIndex && !storageIndex) break;

            if (web3.utils.hexToNumber(toHexIndex(storageIndex)) < MAX_COMPLEX_BASE_SLOT) {
                trace.hexStorageIndex = storageIndex;
                trackBuffer.push(trace);
                break;
            }
            if (candidate === 0) break;
            candidate--;
        }
        trackBuffer.push(trace);
        sstoreBuffer.splice(sstoreBuffer.indexOf(entry.finalKey), 1);
    }
}

/**
 * Elimina le sha trace duplicate (stessa finalKey e hexStorageIndex; vince l'ultima).
 * @param {Array} finalShaTraces
 * @returns {Array}
 */
function regroupShatrace(finalShaTraces) {
    const flattened = finalShaTraces.flat();
    return Array.from(
        new Map(flattened.map((item) => [item.finalKey + item.hexStorageIndex, item])).values()
    );
}

/**
 * Calcola le sha trace di un bucket di mapForStorage: imposta finalShaTraces ed
 * elimina trackBuffer.
 * @param {{trackBuffer: Array, finalShaTraces?: Array}} singleObject
 * @param {string[]} sstoreBuffer
 * @param {Object} web3
 */
function createShatrace(singleObject, sstoreBuffer, web3) {
    singleObject.finalShaTraces = singleObject.trackBuffer;
    // FIX-01: hexStorageIndex è una parola di memoria senza "0x": hexToNumber
    // lanciava e (nel percorso Erigon) si perdevano storage e transazioni interne.
    appendStoredShaTraces(singleObject.finalShaTraces, sstoreBuffer, web3, ensureHexPrefix, false);
    singleObject.finalShaTraces = regroupShatrace(singleObject.finalShaTraces);
    delete singleObject.trackBuffer;
}

/**
 * Assegna a ogni transazione interna (visita in pre-ordine dell'albero) storage e
 * sha trace del bucket di mapForStorage corrispondente (a partire dall'indice 2).
 *
 * @param {Array} internalTxs albero delle chiamate interne (viene mutato)
 * @param {Object} mapForStorage
 * @param {number} [index=2]
 * @returns {number} indice del prossimo bucket non assegnato
 */
function assignStorageToTheInternal(internalTxs, mapForStorage, index = FIRST_INTERNAL_CALL_INDEX) {
    for (const txs of internalTxs) {
        txs.finalShaTraces = mapForStorage[index]?.finalShaTraces || [];
        txs.functionStorage = mapForStorage[index]?.functionStorage || {};
        index++;
        if (txs.calls && txs.calls.length > 0) {
            // FIX-07: l'indice era passato per valore e non tornava indietro: dopo
            // una chiamata con figli, la successiva riceveva il bucket del primo figlio.
            index = assignStorageToTheInternal(txs.calls, mapForStorage, index);
        }
    }
    return index;
}

module.exports = {
    ERIGON_PARSER_OPTIONS,
    INPUT_STREAM_PARSER_OPTIONS,
    PUBLIC_CALL_INDEX,
    normalizeStorageEntries,
    joinMemoryWords,
    parseStructLogStream,
    appendStoredShaTraces,
    regroupShatrace,
    createShatrace,
    assignStorageToTheInternal,
};
