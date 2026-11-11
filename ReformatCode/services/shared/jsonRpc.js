// Chiamate JSON-RPC verso il nodo (Alchemy/Erigon): richieste semplici via fetch e
// richieste in streaming (debug_traceTransaction) via http/https.
// Unifica le copie presenti in Erigon/erigonApi.js, decodingUtils/utils.js e
// ExtractionModule/workerWithOption.js.
const https = require("https");
const http = require("http");

const JSON_RPC_VERSION = "2.0";
const JSON_RPC_ID = 1;
const STREAMING_REQUEST_TIMEOUT_MS = 300000;
const HTTPS_DEFAULT_PORT = 443;
const HTTP_DEFAULT_PORT = 80;
// Messaggio di log storico usato da tutte le copie originali (anche per metodi
// diversi da eth_getTransactionReceipt): mantenuto per non cambiare i log.
const FETCH_ERROR_LOG_MESSAGE = "Error fetching transaction receipt:";

/**
 * Costruisce il body di una richiesta JSON-RPC.
 * @param {string} method
 * @param {Array} params
 * @returns {{jsonrpc: string, method: string, params: Array, id: number}}
 */
function buildJsonRpcBody(method, params) {
    return {
        jsonrpc: JSON_RPC_VERSION,
        method,
        params,
        id: JSON_RPC_ID,
    };
}

/**
 * Esegue una chiamata JSON-RPC con fetch e restituisce `result`.
 * In caso di errore (HTTP non ok, rete, JSON non valido o errore di mapResult)
 * scrive il log storico e rilancia l'errore.
 *
 * @param {string} endpoint URL del nodo
 * @param {string} method metodo JSON-RPC
 * @param {Array} params parametri
 * @param {(result: *) => *} [mapResult] trasformazione applicata a `result` (dentro il try)
 * @returns {Promise<*>}
 */
async function postJsonRpc(endpoint, method, params, mapResult = (result) => result) {
    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildJsonRpcBody(method, params)),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();
        return mapResult(data.result);
    } catch (err) {
        console.error(FETCH_ERROR_LOG_MESSAGE, err);
        throw err;
    }
}

/**
 * Esegue una chiamata JSON-RPC e restituisce direttamente lo stream della risposta
 * (necessario per tracce troppo grandi da tenere in memoria).
 *
 * @param {string} url URL del nodo
 * @param {string} method metodo JSON-RPC
 * @param {Array} params parametri
 * @returns {Promise<import("http").IncomingMessage>} stream della risposta HTTP
 */
function makeRpcCallStreaming(url, method, params) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === "https:";
        const client = isHttps ? https : http;
        const payload = JSON.stringify(buildJsonRpcBody(method, params));

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? HTTPS_DEFAULT_PORT : HTTP_DEFAULT_PORT),
            path: urlObj.pathname,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
            },
            timeout: STREAMING_REQUEST_TIMEOUT_MS,
        };

        const req = client.request(options, (res) => {
            resolve(res);
        });

        req.on("error", (err) => {
            reject(new Error(`Request failed: ${err.message}`));
        });

        req.on("timeout", () => {
            req.destroy();
            reject(new Error("Request timeout"));
        });

        req.write(payload);
        req.end();
    });
}

/**
 * Avvia debug_traceTransaction in streaming.
 * @param {string} transactionHash
 * @param {string} erigonUrl URL del nodo
 * @returns {Promise<{requiredTime: number, stream: import("http").IncomingMessage}>}
 *          requiredTime in secondi (2 decimali) fino alla ricezione degli header
 */
async function debugTransactionErigonStreaming(transactionHash, erigonUrl) {
    const start = new Date();
    const stream = await makeRpcCallStreaming(erigonUrl, "debug_traceTransaction", [transactionHash]);
    const requiredTime = parseFloat(((new Date() - start) / 1000).toFixed(2));
    return { requiredTime, stream };
}

module.exports = {
    postJsonRpc,
    makeRpcCallStreaming,
    debugTransactionErigonStreaming,
};
