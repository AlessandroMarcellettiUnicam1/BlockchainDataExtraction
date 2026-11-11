// Decodifica dei valori di storage modificati da una transazione, a partire dal
// layout di storage del contratto (solc) e dalle "sha trace" (KECCAK256 usati per
// calcolare gli slot di mapping, array dinamici e stringhe lunghe).
const { ensureHexPrefix } = require("./shared/hexUtils");

// Uno slot di storage è una parola da 32 byte = 64 caratteri esadecimali.
const SLOT_HEX_LENGTH = 64;
// Gli slot "base" di mapping/array dinamici sono considerati solo sotto questa soglia.
const MAX_COMPLEX_BASE_SLOT = 300;
// Oltre questa soglia uno slot (o una lunghezza) è considerato una chiave keccak.
const MAX_DIRECT_SLOT_NUMBER = 9999999;

// Stato del modulo impostato a ogni chiamata di optimizedDecodeValues (la
// decodifica è interamente sincrona, quindi non ci sono interferenze tra chiamate).
let web3;
let mainContractName;
// Output JSON (stringa) di solc.
let contractCompiledJson;

/**
 * Decodifica i valori dello storage letti/scritti dalla transazione.
 *
 * @param {Object} sstore non usato, mantenuto per compatibilità della firma
 * @param {Object} contractTree albero dei contratti con le variabili di storage
 * @param {Array} shaTraces sha trace {hexKey, hexStorageIndex, finalKey, indexSum}
 * @param {Object} functionStorage slot (64 hex senza 0x) -> valore
 * @param {string} functionName non usato nella decodifica, mantenuto per compatibilità
 * @param {string} mainContract nome del contratto principale
 * @param {Object} web3Variable istanza web3
 * @param {string} contractCompiledPassed output JSON di solc
 * @returns {Promise<Array<{variableName, variableRawValue, variableValue, type, ...}>>}
 */
async function optimizedDecodeValues(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract, web3Variable, contractCompiledPassed) {
    const safeShaTraces = Array.isArray(shaTraces) ? shaTraces : [];
    const safeFunctionStorage = (functionStorage && typeof functionStorage === "object") ? functionStorage : {};

    web3 = web3Variable;
    contractCompiledJson = contractCompiledPassed;
    mainContractName = mainContract;

    const hasStorageKeys = Object.keys(safeFunctionStorage).length > 0;
    const hasTraces = safeShaTraces.length > 0;
    if (!hasStorageKeys && !hasTraces) {
        return [];
    }

    const processedKeys = new Set();
    const preprocessed = [];
    decodeComplexData(safeShaTraces, contractTree, safeFunctionStorage, mainContract, processedKeys, preprocessed);
    const decoded = decodingSimpleStorage(mainContract, safeFunctionStorage, processedKeys, contractTree, preprocessed);
    if (!decoded || !Array.isArray(decoded)) return [];

    return formatDecodedVariables(decoded);
}

// ---------------------------------------------------------------------------
// Formattazione dell'output
// ---------------------------------------------------------------------------

/** Rinomina i campi interni nel formato salvato in DB. */
function toOutputVariable(variable) {
    const { name, value, decodedValue, slot, offset, contentSlot, ...rest } = variable;
    return {
        ...rest,
        variableName: name,
        variableRawValue: value,
        variableValue: decodedValue,
    };
}

/** Un valore decodificato array diventa una voce per elemento ("<nome>_<i>"). */
function expandArrayValues(variable) {
    if (!Array.isArray(variable.variableValue)) {
        return variable;
    }
    return variable.variableValue.map((value, i) => ({
        ...variable,
        variableName: `${variable.variableName}_${i}`,
        variableRawValue: Array.isArray(variable.variableRawValue) ? variable.variableRawValue[i] : variable.variableRawValue,
        variableValue: value,
    }));
}

function formatDecodedVariables(decoded) {
    const outputVariables = decoded
        .filter((item) => item !== undefined)
        .map(toOutputVariable)
        .flatMap(expandArrayValues)
        .filter((variable) => variable.variableRawValue !== undefined && variable.variableValue !== undefined);
    return removeDuplicate(removeStructFormOutput(outputVariables));
}

/** Rimuove le voci con stessi type, nome, valore grezzo e valore decodificato. */
function removeDuplicate(result) {
    const seen = new Set();
    return result.filter((element) => {
        const key = element.type + element.variableName + element.variableRawValue + element.variableValue;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** Sostituisce ogni struct con le voci dei suoi membri. */
function removeStructFormOutput(result) {
    const outputResult = [];
    for (const element of result) {
        if (element.type.includes("struct")) {
            extractElementFromStruct(element, outputResult);
        } else {
            outputResult.push(element);
        }
    }
    return outputResult;
}

function extractElementFromStruct(element, outputResult) {
    for (const member of element.element) {
        if (member.type.includes("struct")) {
            extractElementFromStruct(member, outputResult);
        } else if (member.type.includes("array") && Array.isArray(member.decodedValue)) {
            const name = element.name ? element.name : "";
            for (const arrayElement of member.decodedValue) {
                outputResult.push({
                    type: member.type,
                    variableName: name + "_" + member.label,
                    variableRawValue: member.contentSlot,
                    variableValue: arrayElement,
                });
            }
        } else {
            const name = member.name ? member.name : "";
            outputResult.push({
                type: element.type + "_" + member.type,
                variableName: name + "_" + member.label,
                variableRawValue: member.contentSlot,
                variableValue: member.decodedValue,
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Helper sugli slot
// ---------------------------------------------------------------------------

/** Numero di slot -> chiave dello storage (64 hex senza 0x). */
function toSlotKey(slotNumber) {
    return web3.utils.padLeft(web3.utils.numberToHex(slotNumber).slice(2), SLOT_HEX_LENGTH);
}

/** Chiave dello slot (base + index), es. i blocchi consecutivi di una stringa lunga. */
function consecutiveSlotKey(baseSlotHex, index) {
    const slotNumber = web3.utils.hexToNumber(ensureHexPrefix(baseSlotHex)) + BigInt(index);
    // FIX-02: numberToHex elimina gli zeri iniziali, mentre le chiavi di
    // functionStorage hanno sempre 64 caratteri: senza padding la lettura fallisce
    // quando l'hash inizia con "0".
    return web3.utils.padLeft(web3.utils.numberToHex(slotNumber).substring(2), SLOT_HEX_LENGTH);
}

/** Chiave dello slot (base + indexSum) di un elemento di array dinamico. */
function slotKeyWithIndexSum(baseSlotHex, indexSum) {
    // FIX-03: hexToNumber lancia senza prefisso 0x (lo slot base può arrivare
    // senza prefisso) e BigInt() legge una stringa senza 0x come decimale
    // (o lancia se contiene a-f): indexSum è una parola dello stack.
    const slotNumber = web3.utils.hexToNumber(ensureHexPrefix(baseSlotHex)) + BigInt(ensureHexPrefix(indexSum));
    // FIX-02: padding a 64 caratteri (vedi consecutiveSlotKey).
    return web3.utils.padLeft(web3.utils.numberToHex(slotNumber).slice(2), SLOT_HEX_LENGTH);
}

/** keccak256(chiave || slot) di una sha trace, senza 0x: slot del valore di un mapping. */
function keccakOfShaTrace(shaTrace) {
    return web3.utils.keccak256("0x" + shaTrace.hexKey + shaTrace.hexStorageIndex).slice(2);
}

/**
 * Divide uno slot in elementi impacchettati, partendo dai byte meno significativi.
 * @returns {string[]} elementi con padding a 64 caratteri
 */
function extractPackedElements(slotValue, charsForElement, elementCount) {
    const elements = [];
    for (let i = 0; i < elementCount; i++) {
        const end = SLOT_HEX_LENGTH - i * charsForElement;
        const start = end - charsForElement;
        elements.push(web3.utils.padLeft(slotValue.slice(start, end), SLOT_HEX_LENGTH));
    }
    return elements;
}

// ---------------------------------------------------------------------------
// Dati complessi (mapping, array dinamici, stringhe lunghe, struct)
// ---------------------------------------------------------------------------

/** Aggiunge il risultato di readComplexData all'elenco da decodificare. */
function appendPreprocessed(preprocessed, result) {
    // FIX-04: readComplexData restituisce undefined per i tipi non gestiti
    // (es. array statici di tipi complessi, array dinamici di address):
    // "result.length" lanciava TypeError e si perdeva la decodifica dell'intera transazione.
    if (result === undefined) return;
    if (result.length != undefined) {
        result.forEach((element) => preprocessed.push(element));
    } else {
        preprocessed.push(result);
    }
}

function decodeComplexData(shaTraces, contractTree, functionStorage, mainContract, processedKeys, preprocessed) {
    for (const shaTrace of shaTraces) {
        if (!shaTrace.hexStorageIndex) continue;

        const slotNumber = web3.utils.hexToNumber(ensureHexPrefix(shaTrace.hexStorageIndex));
        const isUnprocessedBaseSlot = slotNumber < MAX_COMPLEX_BASE_SLOT && !processedKeys.has(shaTrace.finalKey);
        if (!isUnprocessedBaseSlot) {
            processedKeys.add(shaTrace.finalKey);
            continue;
        }

        const variable = getContractVariable(slotNumber, contractTree, mainContract)[0];
        if (!variable) continue;

        // processedKeys viene aggiornato anche dentro readComplexData con tutte le
        // chiavi lette (es. i blocchi di una stringa lunga).
        const result = readComplexData(variable, shaTrace, functionStorage, processedKeys, shaTraces);
        appendPreprocessed(preprocessed, result);
        processedKeys.add(shaTrace.finalKey);
        processedKeys.add(shaTrace.hexStorageIndex);
    }
}

/**
 * Legge un dato complesso in base al tipo della variabile.
 * @returns {Object|undefined} la variabile con value valorizzato (undefined per i tipi non gestiti)
 */
function readComplexData(variable, shaTrace, functionStorage, processedKeys, allShaTraces) {
    const variableType = variable.type.split("(")[0];
    if (variableType.includes("struct")) {
        return readStructFromComplexData(variable, shaTrace, functionStorage, processedKeys, allShaTraces);
    }
    if (variableType.includes("mapping")) {
        return readMapping(variable, shaTrace, functionStorage, processedKeys, allShaTraces);
    }
    if (variableType.includes("array")) {
        return readArray(variable, shaTrace, functionStorage, processedKeys, allShaTraces);
    }
    if (variableType.includes("string")) {
        return readString(variable, shaTrace, functionStorage, processedKeys);
    }
    variable.value = functionStorage[variable.contentSlot];
    return variable;
}

/**
 * Segue la catena di sha trace a partire dallo slot della variabile (mapping annidati)
 * e legge il valore finale.
 */
function extractComplexKey(variable, functionStorage, allShaTraces) {
    for (let i = 0; i < allShaTraces.length; i++) {
        if (allShaTraces[i].hexStorageIndex === variable.contentSlot) {
            variable.contentSlot = keccakOfShaTrace(allShaTraces[i]);
            // NOTA: dopo i++ la scansione riparte dall'indice 1, non da 0
            // (comportamento originale mantenuto, vedi CHANGELOG, punti dubbi).
            i = 0;
        }
    }
    if (functionStorage[variable.contentSlot]) {
        variable.value = functionStorage[variable.contentSlot];
    }
    return variable;
}

/** Legge i membri di una struct (in un mapping o da uno slot keccak). */
function readStructFromComplexData(variable, shaTrace, functionStorage, processedKeys, allShaTraces) {
    const members = getStructMembersByVariable(variable, contractCompiledJson);
    variable.element = [];
    members.forEach((member) => {
        const contentSlotNumber = web3.utils.hexToNumber(ensureHexPrefix(variable.contentSlot));
        // NOTA: per contentSlot tra 9999999 e 2^53 hexToNumber restituisce un number
        // e la somma con BigInt lancia (vedi CHANGELOG, punti dubbi).
        const memberSlot = contentSlotNumber > MAX_DIRECT_SLOT_NUMBER
            ? BigInt(member.slot) + contentSlotNumber
            : BigInt(member.slot) + BigInt(variable.slot);
        member.slot = memberSlot;
        member.contentSlot = toSlotKey(memberSlot);
        processedKeys.add(member.contentSlot);
        const decodedMember = readComplexData(member, shaTrace, functionStorage, processedKeys, allShaTraces);
        // FIX-04: un membro di tipo non gestito (undefined) faceva fallire readStruct
        // e removeStructFormOutput (TypeError su undefined.value / undefined.type).
        if (decodedMember !== undefined) variable.element.push(decodedMember);
    });
    return variable;
}

/** Valore di un mapping: calcola lo slot dalla chiave e legge il tipo del valore. */
function readMapping(variable, shaTrace, functionStorage, processedKeys, allShaTraces) {
    // "t_mapping(K,V)" -> "V"
    variable.type = variable.type.replace("t_mapping(", "");
    variable.type = variable.type.slice(0, -1);
    variable.type = removeFirstTypeComponent(variable.type);

    if (variable.type.includes("t_mapping")) {
        return readComplexData(variable, shaTrace, functionStorage, processedKeys, allShaTraces);
    }
    if (variable.type.includes(",")) {
        variable.type = removeFirstTypeComponent(variable.type);
    }
    if (variable.type.includes("array") || variable.type.includes("string")) {
        variable.contentSlot = keccakOfShaTrace(shaTrace);
        return readComplexData(variable, shaTrace, functionStorage, processedKeys, allShaTraces);
    }

    extractComplexKey(variable, functionStorage, allShaTraces);
    if (variable.type.includes("struct")) {
        return readComplexData(variable, shaTrace, functionStorage, processedKeys, allShaTraces);
    }
    return variable;
}

/** "A,B,C" -> "B,C" (stessa semantica di replace(split(",")[0] + ",", "")). */
function removeFirstTypeComponent(type) {
    return type.replace(type.split(",")[0] + ",", "");
}

/**
 * Legge una stringa: se è "lunga" concatena i blocchi a partire da
 * keccak256(slot), altrimenti usa direttamente il valore dello slot.
 *
 * @param {boolean} isArrayElement true per gli elementi di string[] (non verifica che
 *        lo slot della lunghezza esista e, se la stringa è corta, sovrascrive sempre value)
 */
function readStringFromSlots(variable, shaTrace, functionStorage, processedKeys, isArrayElement) {
    const lengthWord = functionStorage[variable.contentSlot];
    const isLongString = functionStorage[shaTrace.finalKey] !== web3.utils.padLeft("0", SLOT_HEX_LENGTH) &&
        (isArrayElement || lengthWord) &&
        web3.utils.hexToNumber(ensureHexPrefix(lengthWord)) < MAX_DIRECT_SLOT_NUMBER;

    if (!isLongString) {
        if (isArrayElement || lengthWord) {
            variable.value = lengthWord;
        }
        return variable;
    }

    // NOTA: la lunghezza è il valore grezzo dello slot (2*len+1 per le stringhe lunghe):
    // il numero di blocchi può superare quello reale (vedi CHANGELOG, punti dubbi).
    const stringLength = web3.utils.hexToNumber(ensureHexPrefix(lengthWord));
    const slotsUsed = Math.ceil(stringLength / SLOT_HEX_LENGTH);
    const firstDataSlot = web3.utils.keccak256(ensureHexPrefix(variable.contentSlot)).slice(2);
    let concatenatedBlocks = "";
    for (let i = 0; i < slotsUsed; i++) {
        const slotKey = consecutiveSlotKey(firstDataSlot, i);
        processedKeys.add(slotKey);
        concatenatedBlocks = concatenatedBlocks + functionStorage[slotKey];
    }
    variable.value = concatenatedBlocks;
    return variable;
}

function readString(variable, shaTrace, functionStorage, processedKeys) {
    return readStringFromSlots(variable, shaTrace, functionStorage, processedKeys, false);
}

function readStringArray(variable, shaTrace, functionStorage, processedKeys) {
    return readStringFromSlots(variable, shaTrace, functionStorage, processedKeys, true);
}

/** Legge un array in base al tipo degli elementi e al fatto che sia dinamico. */
function readArray(variable, shaTrace, functionStorage, processedKeys, allShaTraces) {
    variable.arrayLength = functionStorage[variable.contentSlot];
    const isDynamic = variable.type.includes("dyn");
    if (variable.type.includes("uint")) {
        return isDynamic
            ? readUintArrayDynamic(variable, shaTrace, functionStorage, processedKeys)
            : readUintArray(variable);
    }
    if (variable.type.includes("bytes")) {
        return isDynamic
            ? readBytesArrayDynamic(variable, shaTrace, functionStorage, processedKeys)
            : readBytesArray(variable);
    }
    return isDynamic
        ? readArrayComplexDyn(variable, shaTrace, functionStorage, processedKeys, allShaTraces)
        : readArrayComplexStatic();
}

/** Array statici di tipi complessi: non gestiti (restituisce undefined). */
function readArrayComplexStatic() {
    console.log("readArrayComplexStatic");
}

/** Array dinamico di stringhe o struct (altri tipi: undefined). */
function readArrayComplexDyn(variable, shaTrace, functionStorage, processedKeys, allShaTraces) {
    // "t_array(T)dyn_storage" -> "T"
    variable.type = variable.type.split("t_array(")[1];
    variable.type = variable.type.split(")dyn_storage")[0];

    if (variable.type.includes("string")) {
        variable.contentSlot = shaTrace.finalKey;
        return readStringArray(variable, shaTrace, functionStorage, processedKeys);
    }
    if (!variable.type.includes("struct")) {
        return undefined;
    }

    const firstElementSlot = web3.utils.keccak256(ensureHexPrefix(variable.contentSlot)).slice(2);
    if (shaTrace.indexSum === undefined) {
        processedKeys.add(firstElementSlot);
        variable.contentSlot = firstElementSlot;
        return readStructFromDynamicArray(variable, shaTrace, functionStorage, processedKeys, allShaTraces);
    }

    const elementSlot = slotKeyWithIndexSum(firstElementSlot, shaTrace.indexSum);
    processedKeys.add(elementSlot);
    variable.contentSlot = elementSlot;
    variable.slot = web3.utils.numberToHex("0x" + elementSlot);
    return readComplexData(variable, shaTrace, functionStorage, processedKeys, allShaTraces);
}

/**
 * Struct dentro un array dinamico: nello storage c'è solo l'ultimo elemento
 * modificato, quindi lo slot è keccak(slot) + (lunghezza - 1) * numero di membri + slot del membro.
 */
function readStructFromDynamicArray(variable, shaTrace, functionStorage, processedKeys, allShaTraces) {
    const members = getStructMembersByVariable(variable, contractCompiledJson);
    variable.element = [];
    members.forEach((member) => {
        let memberSlot;
        if (web3.utils.hexToNumber(ensureHexPrefix(variable.contentSlot)) > MAX_DIRECT_SLOT_NUMBER) {
            const lastElementOffset = (web3.utils.hexToNumber(ensureHexPrefix(variable.arrayLength)) - 1) * members.length;
            memberSlot = (BigInt(member.slot) + BigInt(lastElementOffset)) + web3.utils.hexToNumber(ensureHexPrefix(variable.contentSlot));
        }
        member.slot = memberSlot;
        member.contentSlot = toSlotKey(memberSlot);
        processedKeys.add(member.contentSlot);
        const decodedMember = readComplexData(member, shaTrace, functionStorage, processedKeys, allShaTraces);
        // FIX-04: vedi readStructFromComplexData.
        if (decodedMember !== undefined) variable.element.push(decodedMember);
    });
    return variable;
}

/** Array dinamico di bytes: bytes32 legge un elemento, gli altri sono impacchettati. */
function readBytesArrayDynamic(variable, shaTrace, functionStorage, processedKeys) {
    if (!variable.type.includes("32")) {
        return decodeOptimizeDynamicArray(variable, functionStorage);
    }
    const keyOfSlot = web3.utils.keccak256(ensureHexPrefix(variable.contentSlot));
    variable.value = [];
    if (shaTrace.indexSum == undefined) {
        processedKeys.add(keyOfSlot);
        variable.value.push(functionStorage[keyOfSlot.slice(2)]);
    } else {
        const elementSlot = slotKeyWithIndexSum(keyOfSlot, shaTrace.indexSum);
        processedKeys.add(elementSlot);
        variable.value.push(functionStorage[elementSlot]);
    }
    return variable;
}

/** Array dinamico di uint: uint256 legge gli elementi, gli altri sono impacchettati. */
function readUintArrayDynamic(variable, shaTrace, functionStorage, processedKeys) {
    if (!variable.type.includes("256")) {
        return decodeOptimizeDynamicArray(variable, functionStorage);
    }
    if (!functionStorage[variable.contentSlot]) {
        return variable;
    }

    const keyOfSlot = web3.utils.keccak256(ensureHexPrefix(variable.contentSlot));
    variable.value = [];
    if (shaTrace.indexSum != undefined) {
        const elementSlot = slotKeyWithIndexSum(keyOfSlot, shaTrace.indexSum);
        processedKeys.add(elementSlot);
        variable.value.push(functionStorage[elementSlot]);
        return variable;
    }

    const arrayLength = web3.utils.hexToNumber(ensureHexPrefix(variable.arrayLength));
    if (arrayLength > 0) {
        for (let i = 0; i < arrayLength; i++) {
            const elementSlot = consecutiveSlotKey(keyOfSlot, i);
            processedKeys.add(elementSlot);
            variable.value.push(functionStorage[elementSlot]);
        }
    } else {
        processedKeys.add(keyOfSlot);
        variable.value.push(functionStorage[keyOfSlot.slice(2)]);
    }
    return variable;
}

/** Array dinamico di uintN/bytesN impacchettati nel primo slot dei dati. */
function decodeOptimizeDynamicArray(variable, functionStorage) {
    if (variable.type.includes("uint")) {
        const typeSize = parseInt(variable.type.split(")")[0].split("uint")[1]);
        return splitPackedDynamicArray(variable, functionStorage, typeSize / 4);
    }
    if (variable.type.includes("bytes")) {
        const typeSize = parseInt(variable.type.split(")")[0].split("bytes")[1]);
        return splitPackedDynamicArray(variable, functionStorage, typeSize * 2);
    }
    return undefined;
}

function splitPackedDynamicArray(variable, functionStorage, charsForElement) {
    const firstDataSlot = web3.utils.keccak256(ensureHexPrefix(variable.contentSlot)).slice(2);
    const packedValue = functionStorage[firstDataSlot];
    variable.value = packedValue;
    const arrayLength = web3.utils.hexToNumber(ensureHexPrefix(functionStorage[variable.contentSlot]));
    variable.value = extractPackedElements(packedValue, charsForElement, arrayLength);
    return variable;
}

/** Array statici di uint: non gestiti (value undefined, escluso dall'output). */
function readUintArray(variable) {
    variable.value = undefined;
    return variable;
}

/**
 * Array statici di bytes: non gestiti, come readUintArray.
 * FIX-14: la funzione era chiamata da readArray ma non era definita
 * (ReferenceError che faceva perdere la decodifica dell'intera transazione).
 */
function readBytesArray(variable) {
    variable.value = undefined;
    return variable;
}

// ---------------------------------------------------------------------------
// Variabili semplici e decodifica dei valori
// ---------------------------------------------------------------------------

function decodingSimpleStorage(mainContract, functionStorage, processedKeys, contractTree, preprocessed) {
    const mainContractCompiled = getMainContractCompiled(mainContract);
    for (const storageKey in functionStorage) {
        if (processedKeys.has(storageKey)) continue;

        const slotNumber = web3.utils.hexToNumber(ensureHexPrefix(storageKey));
        if (!(slotNumber < MAX_DIRECT_SLOT_NUMBER)) continue;

        const variablesInSlot = getContractVariable(slotNumber, contractTree, mainContract);
        const isPackedSlot = variablesInSlot.length > 1;
        const variables = isPackedSlot
            ? newReadVarFormOffset(variablesInSlot, functionStorage)
            : [variablesInSlot[0]];
        for (const variable of variables) {
            if (!variable) continue;
            // FIX-13: per gli slot con più variabili impacchettate newReadVarFormOffset
            // calcola il valore di ciascuna, che veniva poi sovrascritto con lo slot intero
            // (valori errati o scartati per tutte le variabili tranne quella a offset 0).
            if (!isPackedSlot) {
                variable.value = functionStorage[variable.contentSlot];
            }
            preprocessed.push(variable);
        }
    }
    return preprocessed.map((element) => decodeValue(element, functionStorage, mainContractCompiled));
}

/** Decodifica il valore di una variabile (primitiva o parziale: array/struct/enum). */
function decodeValue(variable, functionStorage, mainContractCompiled) {
    if (!variable.type.includes("(") || variable.type.includes("t_contract")) {
        variable.decodedValue = decodePrimitive(variable);
        return variable;
    }
    return decodePartialPrimitive(variable, functionStorage, mainContractCompiled);
}

/** uint (Number), bool, bytes, address, enum, string; altri tipi: valore grezzo. */
function decodePrimitive(variable) {
    const type = variable.type;
    try {
        if (!variable.value) {
            return undefined;
        }
        const value = variable.value;
        if (type.includes("uint")) {
            return Number(web3.utils.hexToNumber(ensureHexPrefix(value)));
        } else if (type.includes("bool")) {
            return web3.eth.abi.decodeParameter("bool", ensureHexPrefix(value));
        } else if (type.includes("bytes")) {
            return "0x" + value;
        } else if (type.includes("address")) {
            return "0x" + value.slice(-40);
        } else if (type.includes("enum")) {
            return decodeEnumValue(value);
        } else if (type.includes("string")) {
            return web3.utils.hexToAscii(ensureHexPrefix(value)).replace(/\0/g, "");
        }
        return value;
    } catch (err) {
        console.log("error in the extraction of the value");
        return undefined;
    }
}

function decodeEnumValue(value) {
    return Number(web3.eth.abi.decodeParameter("uint256", ensureHexPrefix(value)));
}

function decodePartialPrimitive(variable, functionStorage, mainContractCompiled) {
    const type = variable.type.split("(")[0];
    if (type.includes("enum")) {
        // FIX-05: restituiva il Number invece della variabile, quindi tutti gli enum
        // (tipo "t_enum(X)id", sempre con parentesi) sparivano dall'output.
        variable.decodedValue = decodeEnumValue(variable.value);
        return variable;
    } else if (type.includes("array")) {
        return decodeArray(variable);
    } else if (type.includes("struct")) {
        return readStruct(variable, functionStorage, mainContractCompiled);
    }
}

function readStruct(variable, functionStorage, mainContractCompiled) {
    if (variable.element) {
        variable.element.forEach((member) => {
            if (member.value || member.type.includes("(")) {
                decodeValue(member, functionStorage, mainContractCompiled);
            }
        });
        return variable;
    }

    const members = getStructMembersByVariable(variable, mainContractCompiled);
    variable.element = [];
    members.forEach((member) => {
        // NOTA: Number + hexToNumber (bigint per slot grandi) può lanciare (vedi CHANGELOG).
        const memberSlot = Number(member.slot) + web3.utils.hexToNumber(ensureHexPrefix(variable.contentSlot));
        member.slot = memberSlot;
        member.contentSlot = toSlotKey(memberSlot);
        if (functionStorage[member.contentSlot]) {
            member.value = functionStorage[member.contentSlot];
            variable.element.push(member);
        }
    });
    return decodeValue(variable, functionStorage, mainContractCompiled);
}

function decodeArray(variable) {
    const isDynamic = variable.type.includes("dyn");
    if (variable.type.includes("uint")) {
        return isDynamic ? decodeUintArrayDynamic(variable) : decodeUintArray(variable);
    }
    if (variable.type.includes("bytes")) {
        return isDynamic ? decodeBytesArrayDynamic(variable) : decodeBytesArray(variable);
    }
    return decodeOtherTypeArray(variable);
}

function decodeOtherTypeArray(variable) {
    // NOTA: controllo invertito (gli array hanno length), mantenuto (vedi CHANGELOG).
    if (variable.value.length !== undefined) {
        variable.decodedValue = decodePrimitive(variable);
        return variable;
    }
    variable.decodedValue = [];
    variable.value.forEach((element) => {
        variable.decodedValue.push(decodePrimitive({ type: variable.type, value: element }));
    });
    return variable;
}

function decodeBytesArrayDynamic(variable) {
    variable.decodedValue = [];
    variable.value.forEach((element) => {
        variable.decodedValue.push(decodePrimitive({ type: variable.type, value: element }));
    });
    return variable;
}

function decodeBytesArray(variable) {
    if (variable.type.includes("32")) {
        variable.decodedValue = "0x" + variable.value;
        return variable;
    }
    const typeSize = parseInt(variable.type.split(")")[0].split("bytes")[1]);
    const arrayLength = parseInt(variable.type.split(")")[1].split("_storage")[0]);
    variable.decodedValue = [];
    variable.decodedValue = extractPackedElements(variable.value, typeSize * 2, arrayLength).map((element) => "0x" + element);
    return variable;
}

function decodeUintArray(variable) {
    if (variable.type.includes("256")) {
        if (variable.value == undefined) {
            return variable;
        }
        variable.decodedValue = web3.utils.hexToNumber(ensureHexPrefix(variable.value));
        return variable;
    }
    const typeSize = parseInt(variable.type.split(")")[0].split("uint")[1]);
    const arrayLength = parseInt(variable.type.split(")")[1].split("_storage")[0]);
    variable.decodedValue = [];
    variable.decodedValue = extractPackedElements(variable.value, typeSize / 4, arrayLength)
        .map((element) => web3.utils.hexToNumber(ensureHexPrefix(element)));
    return variable;
}

function decodeUintArrayDynamic(variable) {
    variable.decodedValue = [];
    if (!Array.isArray(variable.value)) {
        variable.decodedValue = decodePrimitive({ type: variable.type, value: variable.value });
        return variable;
    }
    variable.value.forEach((element) => {
        if (element) {
            variable.decodedValue.push(decodePrimitive({ type: variable.type, value: element }));
        }
    });
    return variable;
}

// ---------------------------------------------------------------------------
// Layout di storage
// ---------------------------------------------------------------------------

/** Variabile del layout con contentSlot calcolato dal numero di slot indicato. */
function buildStorageVariable(storageVariable, contentSlotNumber) {
    return {
        name: storageVariable.name,
        type: storageVariable.type,
        slot: storageVariable.slot,
        offset: storageVariable.offset,
        contentSlot: toSlotKey(contentSlotNumber),
    };
}

/**
 * Variabili del contratto principale associate allo slot indicato:
 * - quelle che iniziano esattamente in quello slot;
 * - quella che "copre" lo slot (inizia prima e la successiva inizia dopo);
 * - se nessuna, l'ultima variabile del layout (con contentSlot = slot richiesto).
 */
function getContractVariable(slotIndex, contractTree, mainContract) {
    const contractVariables = [];
    for (const contractId in contractTree) {
        const contract = contractTree[contractId];
        if (contract.name !== mainContract || !contract.storage) continue;

        const storage = contract.storage;
        for (let i = 0; i < storage.length; i++) {
            const current = storage[i];
            const isLast = i === storage.length - 1;
            if (Number(current.slot) === Number(slotIndex)) {
                contractVariables.push(buildStorageVariable(current, Number(current.slot)));
            } else if (!isLast) {
                const coversSlot = Number(current.slot) <= Number(slotIndex) && Number(storage[i + 1].slot) > Number(slotIndex);
                if (coversSlot) {
                    contractVariables.push(buildStorageVariable(current, Number(current.slot)));
                }
            } else if (contractVariables.length == 0) {
                contractVariables.push(buildStorageVariable(current, slotIndex));
            }
        }
    }
    return contractVariables;
}

/** Chiave del tipo struct: per "t_mapping(K,S)" restituisce "S". */
function getStructTypeKey(variableType) {
    if (!variableType.includes("mapping")) {
        return variableType;
    }
    const valueType = variableType.split(",")[1];
    return valueType.substring(0, valueType.length - 1);
}

/**
 * Membri (dal layout di solc) della struct della variabile.
 * NOTA: getMainContractCompiled ri-parsa l'output di solc a ogni chiamata, quindi i
 * membri restituiti sono oggetti nuovi che i chiamanti possono mutare.
 */
function getStructMembersByVariable(variable, mainContractCompiled) {
    const storageLayout = mainContractCompiled.storageLayout === undefined
        ? getMainContractCompiled(mainContractName).storageLayout.storage
        : mainContractCompiled.storageLayout.storage;
    const variableName = variable.name ? variable.name : variable.label;

    let members = [];
    let storageTypes;
    storageLayout.forEach((item) => {
        if (item.label !== variableName && item.type !== variable.type) return;

        const structTypeKey = getStructTypeKey(variable.type);
        storageTypes = storageTypes || getMainContractCompiled(mainContractName).storageLayout.types;
        if (storageTypes != null && Object.prototype.hasOwnProperty.call(storageTypes, structTypeKey)) {
            members = storageTypes[structTypeKey].members;
        }
    });
    return members;
}

/** Output di solc del contratto principale (nuovo oggetto a ogni chiamata). */
function getMainContractCompiled(mainContract) {
    const compiled = JSON.parse(contractCompiledJson);
    for (const sourceName in compiled.contracts) {
        const firstContractName = Object.keys(compiled.contracts[sourceName])[0];
        if (firstContractName === mainContract) {
            return compiled.contracts[sourceName][firstContractName];
        }
    }
    const entries = Object.entries(compiled.contracts["contract0"]);
    const found = entries.find(([key]) => key === mainContract);
    return found ? found[1] : null;
}

/**
 * Calcola il valore di ciascuna variabile impacchettata nello stesso slot
 * (offset in byte dalla parte meno significativa).
 */
function newReadVarFormOffset(variables, functionStorage) {
    for (let i = 0; i < variables.length; i++) {
        const current = variables[i];
        const next = variables[i + 1];
        const slotValue = functionStorage[current.contentSlot];
        current.value = "";

        // Gli offset sono in byte: *2 per passare a caratteri esadecimali.
        const end = SLOT_HEX_LENGTH - current.offset * 2;
        let start;
        if (next === undefined) {
            // FIX-06: l'ultima variabile usava slice(offset*2, 64-offset*2), che per
            // offset >= 16 restituisce "" (es. bool dopo un address) e altrimenti può
            // troncare la variabile: il valore va da 0 a 64-offset*2.
            start = 0;
        } else if (current.type.includes("uint") && !current.type.includes("256")) {
            const typeSize = current.type.split("uint")[1].split(")")[0];
            start = end - typeSize / 4;
        } else if (current.type.includes("bytes") && !current.type.includes("32")) {
            const typeSize = current.type.split("bytes")[1].split(")")[0];
            start = end - typeSize * 2;
        } else {
            start = SLOT_HEX_LENGTH - next.offset * 2;
        }
        current.value = web3.utils.padLeft(slotValue.slice(start, end), SLOT_HEX_LENGTH);
    }
    return variables;
}

module.exports = { optimizedDecodeValues };
