const { getRemoteVersion } = require("../solcVersionManager");

process.on("message", async (data) => {
    const { input, compilerVersion } = data;
    try {
        const solcSnapshot = await getRemoteVersion(compilerVersion);
        const output = solcSnapshot.compile(JSON.stringify(input));

        process.send({ output });
        process.exit(0);
    } catch (err) {
        process.send({ error: "Compilation error: " + err.message });
        process.exit(1);
    }
});

process.on("uncaughtException", (err) => {
    process.send({ error: "Uncaught Exception in worker: " + err.message });
    process.exit(1);
});

process.on("unhandledRejection", (reason) => {
    process.send({ error: "Unhandled Rejection in worker: " + String(reason) });
    process.exit(1);
});