// Gestione delle versioni del compilatore Solidity:
// rilevamento della versione da pragma e caricamento remoto di solc.
const axios = require("axios");
const solc = require("solc");
const https = require("https");

const SOLC_RELEASES_URL = "https://binaries.soliditylang.org/bin/list.json";
const RELEASES_FETCH_ATTEMPTS = 5;
const RELEASES_RETRY_DELAY_MS = 3000;
const RELEASES_REQUEST_TIMEOUT_MS = 15000;

// Tutte le occorrenze di "pragma solidity" con operatore (=, <, <=, >, >=, ^).
const PRAGMA_SINGLE_REGEX = /pragma\s+solidity\s*([<>]?=?|\^)\s*(\d+\.\d+\.\d+)/g;
// Range ">x.x.x <y.y.y". NOTA: la classe "[[>]=?]*" è malformata ma viene
// mantenuta invariata (vedi CHANGELOG, punti dubbi): il risultato di
// detectVersion non è usato dalla pipeline.
const PRAGMA_RANGE_REGEX = /pragma\s+solidity\s*[[>]=?]*\s\d+\.\d+\.\d+\s*([<]=?)\s*(\d+\.\d+\.\d+)/g;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * "0.8.26" -> [0, 8, 26]
 * @param {string} versionString
 * @returns {number[]}
 */
function parseVersion(versionString) {
    return versionString.split(".").map((part) => parseInt(part));
}

/**
 * Confronta due versioni già convertite con parseVersion.
 * @returns {number} 0 se uguali, >0 se v1 > v2, <0 se v1 < v2
 */
function compareVersions(v1, v2) {
    if (v1.length !== v2.length) return v1.length - v2.length;
    let difference = 0;
    for (let i = 0; i < v1.length && difference === 0; i++) {
        difference = v1[i] - v2[i];
    }
    return difference;
}

/**
 * Scarica la lista delle release di solc (con retry).
 * @returns {Promise<{stringVersion: Object, numberVersion: string[]}>}
 */
async function getAllSolidityVersions() {
    // NOTA: rejectUnauthorized:false disattiva la verifica TLS; mantenuto
    // invariato (vedi CHANGELOG, punti dubbi).
    const httpsAgent = new https.Agent({
        keepAlive: true,
        rejectUnauthorized: false,
    });

    for (let remainingAttempts = RELEASES_FETCH_ATTEMPTS; remainingAttempts > 0; remainingAttempts--) {
        try {
            const response = await axios.get(SOLC_RELEASES_URL, {
                httpsAgent,
                timeout: RELEASES_REQUEST_TIMEOUT_MS,
                headers: { Connection: "keep-alive" },
            });
            return {
                stringVersion: response.data.releases,
                numberVersion: Object.keys(response.data.releases),
            };
        } catch (error) {
            console.error(`[Rete] Connessione a SolidityLang fallita. Ritento in ${RELEASES_RETRY_DELAY_MS / 1000}s... (Tentativi rimasti: ${remainingAttempts - 1})`);
            if (remainingAttempts - 1 === 0) {
                throw new Error(`Impossibile contattare binaries.soliditylang.org: ${error.message}`);
            }
            await sleep(RELEASES_RETRY_DELAY_MS);
        }
    }
}

/**
 * Carica da remoto lo snapshot di solc per la versione indicata.
 * @param {string} version es. "v0.8.26+commit.8a97fa7a"
 * @returns {Promise<Object>} snapshot solc con metodo compile()
 */
function getRemoteVersion(version) {
    return new Promise((resolve, reject) => {
        solc.loadRemoteVersion(version, (err, solcSnapshot) => {
            if (err) {
                console.error(err);
                reject(err);
                return;
            }
            resolve(solcSnapshot);
        });
    });
}

/**
 * Verifica che una versione candidata rispetti un singolo vincolo pragma.
 * @param {number[]} version
 * @param {string} sign operatore del pragma
 * @param {number[]} constraint versione del pragma
 * @returns {boolean}
 */
function satisfiesConstraint(version, sign, constraint) {
    const comparison = compareVersions(version, constraint);
    switch (sign) {
        case "=": return comparison === 0;
        case ">": return comparison > 0;
        case ">=": return comparison >= 0;
        case "<": return comparison < 0;
        case "<=": return comparison <= 0;
        case "^": return comparison >= 0 && version[version.length - 2] <= constraint[constraint.length - 2];
        default: return true;
    }
}

/**
 * Trova la versione più alta di solc compatibile con i pragma del sorgente.
 * @param {string} contractSource sorgente Solidity
 * @returns {Promise<string|undefined>} nome del file della release (es. "soljson-v0.8.26+commit.8a97fa7a.js")
 */
async function detectVersion(contractSource) {
    const matches = [
        ...contractSource.matchAll(PRAGMA_SINGLE_REGEX),
        ...contractSource.matchAll(PRAGMA_RANGE_REGEX),
    ];
    const constraints = matches.map((match) => ({ sign: match[1], version: parseVersion(match[2]) }));

    let highestVersion = null;
    const availableVersions = await getAllSolidityVersions();
    for (const versionString of availableVersions.numberVersion) {
        const version = parseVersion(versionString);
        const isHigher = highestVersion == null || compareVersions(parseVersion(highestVersion), version) < 0;
        if (!isHigher) continue;

        const isValid = constraints.every((constraint) => satisfiesConstraint(version, constraint.sign, constraint.version));
        if (isValid) highestVersion = versionString;
    }

    return availableVersions.stringVersion[highestVersion];
}

module.exports = {
    detectVersion,
    getRemoteVersion,
};
