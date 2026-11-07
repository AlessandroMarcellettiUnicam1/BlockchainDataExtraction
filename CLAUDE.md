# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Node.js/Express backend (CommonJS) for blockchain process mining. It extracts smart-contract transactions (with internal calls, decoded inputs, events and storage state), stores them in MongoDB, and exports them as process-mining logs (CSV, OCEL, XES). It also simulates pending mempool transactions and checks compliance in real time. The React frontend lives in a separate repo (`BlockchainProcessMining_frontend`), which expects to sit next to this repo under the name `BlockchainProcessMining_backend` (see README).

Code comments and log messages are mostly in Italian.

## Commands

- `npm install`
- `npm run dev`: runs `server.js` with nodemon on port 8000 (hardcoded)
- `npm start`: runs `node --expose-gc ./server.js` (the `--expose-gc` flag matters, because extraction code calls `global.gc()`)
- `npm run ganache`: local mainnet fork at block 16924888 (legacy)
- Docker: `Dockerfile` (node:22-alpine, exposes 8000, runs `npm start`)
- BullMQ workers are **not** started by the server. Run them as separate processes when using the mempool or compliance features:
  - `node services/realTimeCompliance/mempoolWorker.js`
  - `node services/realTimeCompliance/baselineWorker.js`

There is no test suite and no linter. `npm test` is a placeholder. To check a change, use the ad-hoc endpoints `POST /api/test-extraction` and `POST /api/test-append-xes` in `server.js`.

## Environment (`.env`, loaded via dotenv)

- `MONGODB_URL`, `LOG_DB_NAME`
- Per network: `WEB3_ALCHEMY_{MAINNET,SEPOLIA,POLYGON,AMOY}_URL`, `API_KEY_ETHERSCAN` / `API_KEY_POLYGONSCAN`, `ETHERSCAN_{MAINNET,SEPOLIA}_ENDPOINT`, `POLYGONSCAN_{MAINNET,TESTNET}_ENDPOINT`
- `WS_ALCHEMY_MAINNET_URL` (websocket feed for the mempool listener)
- `REDIS_HOST` / `REDIS_PORT` (defaults: 127.0.0.1:6379)
- `DUPLICATE_EVENTS` (optional)

`localEnv` is a committed template of env var names.

## Architecture

**Entry point:** `server.js` holds every Express route in one file. It handles uploads (multer), export formats (`/csv-download`, `/ocel-download`, `/xes-translator`, ...), queries over stored data (`/api/data/*`), and the simulation and compliance endpoints. There are no separate router modules.

**Network → database mapping:** the network name (`"Mainnet" | "Sepolia" | "Polygon" | "Amoy"`) is threaded through as `networkData = { web3Endpoint, apiKey, endpoint, networkName }`. `config/db.js` `connectDB(network)` disconnects and reconnects mongoose to `${MONGODB_URL}/${network}_DB`. As a result:
- there is a single global connection, and switching networks affects everything in the process
- callers must pass a network name

Mongoose schemas are in `schema/data.js`. All persistence helpers (extraction logs, ABIs, compiled contracts, metrics, compliance session state, XES traces) are in `databaseStore.js`. Collections are often per-contract; see `getModelByContractAddress` in `query/query.js`.

**Historical extraction pipeline** (`POST /submit` → `services/ExtractionModule/mainWithOption.js` `getAllTransactions`):
1. Fetch the contract source from Etherscan or Polygonscan, or take an uploaded file, then compile it with `solc` (`services/contractUtils`, `solcVersionManager.js`, child process `solcWorker.js`) to get the ABI and storage layout.
2. For each transaction, `fork()` a child process running `workerWithOption.js` (4 GB heap). The worker:
   - calls `hre.changeNetwork(network, blockNumber)`, a custom extension in `hardhat.config.js` that repoints the Hardhat fork
   - runs `debug_traceTransaction` (or uses the Erigon streaming RPC in `services/Erigon/erigonApi.js`)
   - decodes inputs, internal calls (`decodeInternalTransaction.js`), events and storage values (`optimizedDecodeValues.js`)
3. The `option` object decides which parts get extracted. Results are saved to MongoDB, or returned in memory when `returnInMemory` is set.

**Process-mining mapping:** `ocelMapping/` (event types, object types and relationships for OCEL), `query/` (filtering and flattening of stored transactions), `jsonQuery/` (JSONPath queries).

**Simulation and real-time compliance** (Redis + BullMQ, queues defined in `config/redisClient.js`):
- `simulationOrchestrator.js` `processSimulation` runs `debug_traceCall` on unmined transactions and decodes them the same way as the historical pipeline. `mempoolSimulator.js` fetches and simulates pending transactions.
- `realTimeCompliance/mempoolListener.js` subscribes to `newPendingTransactions` over websocket, filters by address, and pushes jobs onto `mempool-queue`.
- `mempoolWorker.js` / `baselineWorker.js` consume `mempool-queue` / `baseline-queue`. They call an external Python service at `http://coblockly-backend:8000/api/convertToXes` and `/api/verifyRuleLive` (a hardcoded Docker hostname), then append to the session XES (`simulationUtils/appendXes.js`, `xesStorageUtils.js`).
- Progress reaches the frontend over SSE (`GET /api/stream-mempool/:sessionId`). `config/sse.js` is an in-process EventEmitter, and the server also listens to BullMQ `QueueEvents`.
- `mockMonitoring.js` `runHistoricalCompliance` replays historical data through the same compliance flow.

**Legacy and leftover files:** `index.js` and `internal.js` are earlier versions of the extractor (listed in `.gitignore` but still tracked). Root files such as `prova12`, `sourceCode`, `solcOutput`, `testContract.json`, plus the `outputLogs/` and `temporaryTrials/` folders, are sample or debug artifacts. None of these are on the live code path.
