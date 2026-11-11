// Helper esadecimali condivisi dalla catena di estrazione.
// Sostituiscono le copie identiche presenti in optimizedDecodeValues.js,
// decodeInternalTransaction.js e ExtractionModule/workerWithOption.js.

const HEX_PREFIX = "0x";

/**
 * Restituisce il valore come stringa con prefisso "0x".
 * null/undefined diventano "0x" (comportamento delle copie originali).
 * @param {*} value
 * @returns {string}
 */
function ensureHexPrefix(value) {
    const stringValue = String(value ?? "");
    return stringValue.startsWith(HEX_PREFIX) ? stringValue : HEX_PREFIX + stringValue;
}

/**
 * Restituisce il valore come stringa senza prefisso "0x".
 * null/undefined diventano "".
 * @param {*} value
 * @returns {string}
 */
function stripHexPrefix(value) {
    if (value === undefined || value === null) return "";
    const stringValue = String(value);
    return stringValue.startsWith(HEX_PREFIX) ? stringValue.slice(HEX_PREFIX.length) : stringValue;
}

module.exports = {
    HEX_PREFIX,
    ensureHexPrefix,
    stripHexPrefix,
};
