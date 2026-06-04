const { connectionOptions } = require("../../config/redisClient");
const { appendXes } = require('../simulationUtils/appendXes');
const { connectDB } = require('../../config/db');
const { Worker } = require('bullmq');
const { config } = require('dotenv');
require('dotenv').config();

console.log('[Baseline Worker] Worker inizializzato, in attesa di job in coda...');

(async () => {
    try {
        await connectDB(); 
        console.log(`[Baseline Worker] Connesso a MongoDB con successo.`);
    } catch (err) {
        console.error(`[Baseline Worker] Errore critico di connessione a MongoDB:`, err.message);
        process.exit(1);
    }
})();

const baselineWorker = new Worker('baseline-queue', async (job) => {
    /*
    1. estraggo i dati dalla coda (hash, contratto e blockNumber)
    2. creo i parmas da inserire in getAllTransactions(null, newParams, true)
    3. converto il log ottenuto tramite endopint di CoBlocklyBackend
    4. lo appendo tramite la funzione appendXes
    5. lo sovrascrivo in Redis
    */

}, {
    connection: connectionOptions,
    concurrency: 1 // impostazione per impedire race conditions su letture e scritture di Redis
});

baselineWorker.on('ready', () => {
    console.log(`[Baseline Worker] Connesso a Redis con successo. Worker operativo.`);
});

baselineWorker.on('completed', (job) => {
    console.log(`[Baseline Worker] Job ${job.id} completato con successo: ${job.returnvalue.hash}`);
});

baselineWorker.on('failed', (job, err) => {
    console.error(`[Baseline Worker] Job ${job.id} fallito: ${err.message}`);
});

module.exports = baselineWorker;