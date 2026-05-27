const { Worker } = require('bullmq');
const { connectionOptions, redisClient } = require('../../config/redisClient');
const systemEvents = require('../../config/sse');
const { processSimulation, mockProcessSimulation } = require('../ExtractionModule/simulationOrchestrator');
const { connectDB } = require('../../config/db');
const axios = require('axios');
const { config } = require('dotenv');
const { net } = require('web3');
const { network } = require('hardhat');
require('dotenv').config();

console.log('[Worker] Worker inizializzato, in attesa di transazioni in coda...');

(async () => {
    try {
        await connectDB(); 
        console.log(`[Worker] Connesso a MongoDB con successo.`);
    } catch (err) {
        console.error(`[Worker] Errore critico di connessione a MongoDB:`, err.message);
        process.exit(1);
    }
})();

const rtcWorker = new Worker('mempool-queue', async (job) => {
    const { sessionId, hash, payload } = job.data;

    // simulazione di tre secondi di elaborazione per la simulazione mock
    // await new Promise(resolve => setTimeout(resolve, 3000));

    console.log(`[Worker] Job ${job.id} ricevuto: Transazione ${hash} (Sessione: ${sessionId})`)

    try {
        const params = payload;
        const targetAddress = payload[0].to;

        const networkData = {
            web3Endpoint: process.env.WEB3_ALCHEMY_MAINNET_URL,
            apiKey: process.env.API_KEY_ETHERSCAN,
            endpoint: process.env.ETHERSCAN_MAINNET_ENDPOINT,
            networkName: "Mainnet"
        };

        console.log(`[Worker] Avvio simulazione per ${hash} verso il target ${targetAddress}...`);
        const simulationResult = await processSimulation(params, targetAddress, networkData, hash);
        // const simulationResult = await mockProcessSimulation(params, targetAddress, networkData, hash);
        console.log(`[Worker] Simulazione completata per ${hash}.`);

        if (simulationResult.data.status === "Success") {
            // recupero il mapping e lo xes base da Redis
            const configData = await redisClient.get(`session:${sessionId}:config`);
            const baseXes = await redisClient.get(`session:${sessionId}:xes`);

            if (!configData || !baseXes) {
                throw new Error("Configurazione o Log Base mancanti in Redis");
            }

            const { mapping, parsedRule, logMapping } = JSON.parse(configData);

            const pythonPayload = {
                data: [simulationResult.data],
                case_col: mapping.case_col,
                activity_col: mapping.activity_col,
                time_col: mapping.time_col,
                xes_name: `live_tx_${hash}`,
                extract_columns: false 
            };

            console.log(`[Worker] Invio transazione ${hash} a Python per conversione XES...`);
            const pythonResponse = await axios.post('http://coblockly-backend:8000/api/convertToXes', pythonPayload);

            if (!pythonResponse.data.success) {
                throw new Error(pythonResponse.data.error || "Errore sconosciuto in Python");
            }

            const singleTxXes = pythonResponse.data.xes_string;

            console.log(`[Worker] Eseguo l'append della transazione al Log Base...`);
            const updatedBaseXes = appendXes(baseXes, singleTxXes);

            await redisClient.setex(`session:${sessionId}:xes`, 7200, updatedBaseXes);
            console.log(`[Worker] XES Base aggiornato su Redis per sessione ${sessionId}.`);

            const rulePayload = {
                xes_string: updatedBaseXes,
                rule: typeof parsedRule === 'string' ? parsedRule : JSON.stringify(parsedRule),
                mapping: logMapping
            }

            const ruleResponse = await axios.post('http://coblockly-backend:8000/api/verifyRuleLive', rulePayload);
            console.log(`[Worker] Regola verificata per la transazione ${hash} nella sessione ${sessionId}.`);

            return { 
                success: true, 
                sessionId: sessionId, 
                hash: hash,
                complianceResult: ruleResponse.data
            };
        } else {
            console.log(`[Worker] Transazione ${hash} ignorata (Status Blockchain: ${simulationResult.data.status}).`);
            return {
                success: true,
                sessionId: sessionId,
                hash: hash,
                complianceResult: {
                    compliant: [],
                    noncompliant: [],
                    ignored: [simulationResult.data]
                }
            };
        }
        
    } catch (err) {
        console.error(`[Worker] Errore durante la simulazione per ${hash}:`, err.message);
        throw err;
    }

}, {connection: connectionOptions});

function appendXes(baseXes, newXes) {
    // estraggo il bloggo trace e event dallo xes appena convertito
    const traceStart = newXes.indexOf('<trace>');
    const traceEnd = newXes.indexOf('</trace>') + 8;
    const newTraceBlock = newXes.substring(traceStart, traceEnd);

    const eventStart = newXes.indexOf('<event>');
    const eventEnd = newXes.indexOf('</event>') + 8;
    const newEventBlock = newXes.substring(eventStart, eventEnd);

    // estraggo 
    const caseIdRegex = /<string key="concept:name" value="([^"]+)"\/>/;
    const caseMatch = newTraceBlock.match(caseIdRegex);
    const caseId = caseMatch ? caseMatch[1] : null;

    if (caseId) {
        const caseIdentifier = `<string key="concept:name" value="${caseId}"/>`;
        const identifierIndex = baseXes.indexOf(caseIdentifier);

        // se il caseId si trova già nel log base
        if (identifierIndex !== -1) {
            const nextTraceClose = baseXes.indexOf('</trace>', identifierIndex);

            if (nextTraceClose !== -1) {
                const before = baseXes.substring(0, nextTraceClose);
                const after = baseXes.substring(nextTraceClose);
                return before + newEventBlock + '\n' + after;
            }
        }
        // non trovo il caseId, faccio l'append alla fine del log base
        else {
            const logCloseIndex = baseXes.lastIndexOf('</log>');
            
            if (logCloseIndex !== -1) {
                const before = baseXes.substring(0, logCloseIndex);
                const after = baseXes.substring(logCloseIndex);
                return before + newTraceBlock + '\n' + after;
            }
        }
    } else {
        console.warn("[Worker] Anomalìa XES: Nessun Case ID trovato nel nuovo evento. Append ignorato.");
    }

    return baseXes;
}

rtcWorker.on('ready', () => {
    console.log(`[Worker] Connesso a Redis con successo. Worker operativo.`);
});

rtcWorker.on('completed', (job) => {
    console.log(`[Worker] Job completato con successo: ${job.returnvalue.hash}`);
});

rtcWorker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job.id} fallito: ${err.message}`);
});

module.exports = rtcWorker;