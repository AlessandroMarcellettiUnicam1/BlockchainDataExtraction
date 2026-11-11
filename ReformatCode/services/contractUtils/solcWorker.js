// Processo figlio che compila un input standard-json con una versione remota di solc.
// Protocollo: riceve { input, compilerVersion }, risponde { output } oppure { error }.
const { getRemoteVersion } = require("../solcVersionManager");

// Ritardo prima di uscire, per dare tempo al messaggio IPC di essere consegnato.
const EXIT_DELAY_MS = 100;
// Timeout di sicurezza per evitare worker appesi.
const WORKER_TIMEOUT_MS = 120000;

/**
 * Invia un messaggio al processo padre e termina dopo EXIT_DELAY_MS.
 * @param {Object} message
 * @param {number} exitCode
 */
function replyAndExit(message, exitCode) {
    process.send(message);
    setTimeout(() => {
        process.exit(exitCode);
    }, EXIT_DELAY_MS);
}

process.on("message", async ({ input, compilerVersion }) => {
    try {
        const solcSnapshot = await getRemoteVersion(compilerVersion);
        const output = solcSnapshot.compile(JSON.stringify(input));
        replyAndExit({ output }, 0);
    } catch (err) {
        replyAndExit({ error: "Compilation error: " + err.message }, 1);
    }
});

process.on("uncaughtException", (err) => {
    replyAndExit({ error: "Uncaught Exception in worker: " + err.message }, 1);
});

process.on("unhandledRejection", (reason) => {
    replyAndExit({ error: "Unhandled Rejection in worker: " + String(reason) }, 1);
});

setTimeout(() => {
    console.error("Worker timeout - forcing exit");
    process.exit(1);
}, WORKER_TIMEOUT_MS);
