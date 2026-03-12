const { getRemoteVersion } = require("../solcVersionManager");

process.on("message", async (data) => {
    const { input, compilerVersion } = data;
    try {
        const solcSnapshot = await getRemoteVersion(compilerVersion);
        const output = solcSnapshot.compile(JSON.stringify(input));
        process.send({ output });
        // Force exit after a short delay to allow message to be sent
        setTimeout(() => {
            process.exit(0);
        }, 100);
    } catch (err) {
        process.send({ error: "Compilation error: " + err.message });
        setTimeout(() => {
            process.exit(1);
        }, 100);
    }
});

process.on("uncaughtException", (err) => {
    process.send({ error: "Uncaught Exception in worker: " + err.message });
    setTimeout(() => {
        process.exit(1);
    }, 100);
});

process.on("unhandledRejection", (reason) => {
    process.send({ error: "Unhandled Rejection in worker: " + String(reason) });
    setTimeout(() => {
        process.exit(1);
    }, 100);
});

//Timeout to kill the worker to avoid the hanging problem 
const TIMEOUT_MS = 120000; 
setTimeout(() => {
    console.error("Worker timeout - forcing exit");
    process.exit(1);
}, TIMEOUT_MS);