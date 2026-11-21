const { redisClient, baselineQueue, baselineQueueEvents } = require("../../config/redisClient");
const systemEvents = require("../../config/sse");

const MAX_BLOCKS = 5000;

function parseBlockSelection(body) {
    const mode = body.blockMode;

    if (mode === "range") {
        const from = Number(body.fromBlock);
        const to = Number(body.toBlock);
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
            return { error: "Intervallo di blocchi non valido" };
        }
        const count = to - from + 1;
        if (count > MAX_BLOCKS) {
            return { error: `Troppi blocchi (max ${MAX_BLOCKS})` };
        }
        const blocks = [];
        for (let blockNumber = from; blockNumber <= to; blockNumber += 1) {
            blocks.push(blockNumber);
        }
        return { blocks };
    }

    if (mode === "set") {
        const source = Array.isArray(body.blocks) ? body.blocks : [];
        const parsed = source
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 0);
        const blocks = [...new Set(parsed)].sort((a, b) => a - b);
        if (blocks.length === 0) {
            return { error: "Insieme di blocchi vuoto o non valido" };
        }
        if (blocks.length > MAX_BLOCKS) {
            return { error: `Troppi blocchi (max ${MAX_BLOCKS})` };
        }
        return { blocks };
    }

    return { error: "blockMode deve essere 'range' o 'set'" };
}

async function startBlockCompliance(req, res) {
    try {
        const {
            sessionId,
            monitoredContracts,
            mapping,
            parsedRules,
            logMapping,
            traceProvider: requestedTraceProvider,
        } = req.body;

        if (!sessionId || !Array.isArray(monitoredContracts) || monitoredContracts.length === 0) {
            return res.status(400).json({ success: false, error: "Parametri mancanti" });
        }
        if (!Array.isArray(parsedRules) || parsedRules.length === 0) {
            return res.status(400).json({ success: false, error: "Definisci almeno una regola" });
        }

        const selection = parseBlockSelection(req.body);
        if (selection.error) {
            return res.status(400).json({ success: false, error: selection.error });
        }

        const traceProvider = requestedTraceProvider === "hardhat" ? "hardhat" : "erigon";

        await redisClient.set(
            `session:${sessionId}:config`,
            JSON.stringify({ mapping, parsedRules, logMapping, monitoredContracts, traceProvider })
        );

        await baselineQueue.addBulk(
            selection.blocks.map((blockNumber) => ({
                name: "update-baseline-block",
                data: {
                    sessionId,
                    payload: {
                        contract: monitoredContracts,
                        blockNumber,
                    },
                },
                opts: { removeOnComplete: true },
            }))
        );

        console.log(`[Block Compliance] Accodati ${selection.blocks.length} blocchi per la sessione ${sessionId}`);

        res.status(200).json({
            success: true,
            blockCount: selection.blocks.length,
        });
    } catch (err) {
        console.error("[Block Compliance] Errore avvio:", err);
        res.status(500).json({ success: false, error: "Errore interno" });
    }
}

function registerBlockComplianceRoutes(app) {
    app.post("/api/start-block-compliance", startBlockCompliance);

    baselineQueueEvents.on("failed", async ({ jobId, failedReason }) => {
        try {
            const job = await baselineQueue.getJob(jobId);
            const sessionId = job?.data?.sessionId;
            const blockNumber = job?.data?.payload?.blockNumber;
            if (!sessionId) return;

            systemEvents.emit(`new-tx-${sessionId}`, {
                type: "BLOCK_FAILED",
                sessionId,
                blockNumber,
                success: false,
                error: failedReason,
            });
        } catch (err) {
            console.error(`[Block Compliance] Errore inoltro job fallito ${jobId}:`, err.message);
        }
    });
}

module.exports = {
    registerBlockComplianceRoutes,
    parseBlockSelection,
    MAX_BLOCKS,
};
