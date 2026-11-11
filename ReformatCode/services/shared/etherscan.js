// Costanti e helper per le API di Etherscan/Polygonscan usate dalla catena di estrazione.

// Valore restituito da Etherscan nel campo ABI per i contratti non verificati.
const UNVERIFIED_CONTRACT_MESSAGE = "Contract source code not verified";

/**
 * URL dell'endpoint "getsourcecode" (stesso formato usato in tutto il progetto:
 * l'endpoint configurato in .env contiene già il "?" iniziale della query).
 * @param {string} endpoint
 * @param {string} address
 * @param {string} apiKey
 * @returns {string}
 */
function buildGetSourceCodeUrl(endpoint, address, apiKey) {
    return `${endpoint}&module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`;
}

/**
 * true se l'ABI è una stringa che segnala un contratto non verificato.
 * @param {*} abi
 * @returns {boolean}
 */
function isUnverifiedAbi(abi) {
    return typeof abi === "string" && abi.includes(UNVERIFIED_CONTRACT_MESSAGE);
}

module.exports = {
    UNVERIFIED_CONTRACT_MESSAGE,
    buildGetSourceCodeUrl,
    isUnverifiedAbi,
};
