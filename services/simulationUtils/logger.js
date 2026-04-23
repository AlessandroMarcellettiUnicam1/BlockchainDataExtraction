const { AsyncLocalStorage } = require('async_hooks');

const logStorage = new AsyncLocalStorage();

function addSystemLog(msg, type = "info") {

    if (type === "error")
        console.error(msg);
    else
        console.log(msg);

    const currentSessionLogs = logStorage.getStore();

    if (currentSessionLogs) {
        currentSessionLogs.push(`${msg}`);
    }
}

module.exports = {
    logStorage,
    addSystemLog
}