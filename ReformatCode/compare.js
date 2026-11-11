#!/usr/bin/env node
/*
 * compare.js — confronta il codice originale (services/) con quello refattorizzato
 * (ReformatCode/services/) sugli stessi input.
 *
 * - Nessun file originale viene modificato. Il codice viene caricato esplicitamente
 *   da entrambe le cartelle; per accedere alle funzioni interne (non esportate) dei
 *   worker il sorgente viene compilato in memoria aggiungendo un export di test.
 * - Rete, DB, Hardhat, solc e fork sono sostituiti da stub deterministici: il test
 *   NON copre il comportamento reale di nodo, Etherscan e MongoDB.
 * - web3, JSONStream ed ethereum-input-data-decoder sono quelli reali.
 *
 * Uso (dalla root del repo):
 *   node ReformatCode/compare.js                 # se node_modules è installato
 *   NODE_PATH=/percorso/node_modules node ReformatCode/compare.js
 *
 * Esito: per ogni caso "IDENTICO" (output uguali), "FIX-xx" (differenza attesa,
 * verificata) oppure "FALLITO". Exit code 1 se almeno un caso fallisce.
 */
"use strict";

const Module = require("module");
const path = require("path");
const fs = require("fs");
const { EventEmitter } = require("events");
const { Readable } = require("stream");

const ROOT = path.resolve(__dirname, "..");
// COMPARE_OLD_DIR: cartella alternativa del codice originale (es. un "git worktree"
// del commit di partenza, utile dopo la migrazione in place).
const OLD = process.env.COMPARE_OLD_DIR ? path.resolve(process.env.COMPARE_OLD_DIR) : path.join(ROOT, "services");
// COMPARE_NEW_DIR: cartella alternativa del nuovo codice (es. la versione "refactor
// puro" con i blocchi pre-fix di MIGRAZIONE.md applicati).
const NEW = process.env.COMPARE_NEW_DIR ? path.resolve(process.env.COMPARE_NEW_DIR) : path.join(__dirname, "services");
// COMPARE_FIXES: elenco dei fix applicati nel nuovo codice, es. "FIX-01,FIX-05".
//   - non impostato: tutti i fix sono attesi (stato di ReformatCode/);
//   - vuoto (COMPARE_FIXES=""): refactor puro, tutti i casi devono essere identici.
// COMPARE_PURE=1 equivale a COMPARE_FIXES="".
const APPLIED_FIXES = process.env.COMPARE_PURE === "1"
    ? new Set()
    : (process.env.COMPARE_FIXES === undefined ? null : new Set(process.env.COMPARE_FIXES.split(",").map((s) => s.trim()).filter(Boolean)));
// FIX-10 non ha un blocco pre-fix (fa parte della sostituzione di erigonApi.js, M-12):
// è accettato sia identico sia corretto.
const FIXES_WITHOUT_PREFIX = new Set(["FIX-10"]);

// ---------------------------------------------------------------------------
// Stub
// ---------------------------------------------------------------------------

const calls = { saveAbi: [], saveTransaction: [], saveCompiledContractData: [], saveExtractionMetrics: [], connectDB: [], forkPayloads: [] };
function resetCalls() {
    for (const key of Object.keys(calls)) calls[key] = [];
}

const stubState = {
    searchAbi: async () => null,
    searchTransaction: async () => null,
    axiosGet: async (url) => { throw new Error("axios.get non previsto: " + url); },
    axiosPost: async (url, payload) => { throw new Error("axios.post non previsto: " + JSON.stringify(payload)); },
    rpc: async (method) => { throw new Error("fetch RPC non previsto: " + method); },
    hardhatReceiptLogs: [],
    compiledOutput: null,
    workerReply: null,
};

const axiosStub = {
    get: (...args) => stubState.axiosGet(...args),
    post: (...args) => stubState.axiosPost(...args),
};
const hardhatStub = {
    changeNetwork: async () => {},
    run: async () => {},
    network: {
        provider: {
            send: async (method) => (method === "eth_getTransactionReceipt" ? { logs: stubState.hardhatReceiptLogs } : null),
            removeAllListeners: () => {},
        },
    },
};
const mongooseStub = { connection: { readyState: 0 }, disconnect: async () => {} };
const solcStub = {
    loadRemoteVersion: (version, cb) => cb(null, { compile: () => stubState.compiledOutput }),
};
const dotenvStub = { config: () => ({}) };
// saveAbi crea "new Model(storeAbi)": mongoose ordina i campi secondo lo schema,
// quindi l'ordine delle chiavi del documento non è significativo e viene normalizzato.
const sortKeys = (doc) => Object.fromEntries(Object.keys(doc).sort().map((k) => [k, doc[k]]));
const databaseStoreStub = {
    saveAbi: async (doc) => { calls.saveAbi.push(clone(sortKeys(doc))); },
    saveTransaction: async (log, collection) => { calls.saveTransaction.push({ log: clone(log), collection }); },
    saveCompiledContractData: async (address, tree) => { calls.saveCompiledContractData.push({ address, tree: clone(tree) }); },
    saveExtractionMetrics: async (metrics) => { calls.saveExtractionMetrics.push(clone(metrics)); },
    saveExtractionLog: async () => {},
};
const queryStub = {
    searchAbi: (...args) => stubState.searchAbi(...args),
    searchTransaction: (...args) => stubState.searchTransaction(...args),
};
const dbStub = { connectDB: async (network) => { calls.connectDB.push(network); } };

// child_process.fork finto: solcWorker restituisce stubState.compiledOutput,
// workerWithOption risponde con stubState.workerReply.
const childProcessStub = {
    fork: (workerPath) => {
        const worker = new EventEmitter();
        worker.send = (payload) => {
            calls.forkPayloads.push({ worker: path.basename(workerPath), payload: clone(payload) });
            setImmediate(() => {
                if (path.basename(workerPath) === "solcWorker.js") {
                    worker.emit("message", { output: stubState.compiledOutput });
                } else {
                    worker.emit("message", stubState.workerReply(payload));
                }
                worker.emit("exit", 0, null);
            });
        };
        return worker;
    },
    execFile: () => {},
};

// Moduli di infrastruttura riconosciuti dallo specificatore del require
// ("../../databaseStore", "../../../query/query", "../config/db", ...).
const infraStubs = [
    [/(^|\/)databaseStore(\.js)?$/, databaseStoreStub],
    [/(^|\/)query\/query(\.js)?$/, queryStub],
    [/(^|\/)config\/db(\.js)?$/, dbStub],
];
const packageStubs = {
    axios: axiosStub,
    hardhat: hardhatStub,
    mongoose: mongooseStub,
    solc: solcStub,
    dotenv: dotenvStub,
    child_process: childProcessStub,
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(packageStubs, request)) {
        return packageStubs[request];
    }
    if (request.startsWith(".")) {
        const infra = infraStubs.find(([pattern]) => pattern.test(request));
        if (infra) return infra[1];
    }
    return originalLoad.apply(this, arguments);
};

global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const result = await stubState.rpc(body.method, body.params);
    return { ok: true, status: 200, json: async () => ({ result }) };
};

// Le attese (5 s prima di Etherscan, retry, ecc.) vengono azzerate.
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, ms >= 1000 ? 0 : ms, ...args);

// I log del codice testato vengono nascosti (impostare COMPARE_VERBOSE=1 per vederli).
const realConsole = { log: console.log, warn: console.warn, error: console.error };
function muteConsole() {
    if (process.env.COMPARE_VERBOSE) return;
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
}
function unmuteConsole() {
    Object.assign(console, realConsole);
}

// ---------------------------------------------------------------------------
// Caricamento dei moduli
// ---------------------------------------------------------------------------

const { Web3 } = require("web3");
const web3 = new Web3();

function load(base, relative) {
    return require(path.join(base, relative));
}

/** Compila il file in memoria esportando anche le funzioni interne indicate. */
function loadWithInternals(file, names) {
    const source = fs.readFileSync(file, "utf8") + `\nmodule.exports.__internals = { ${names.join(", ")} };\n`;
    const mod = new Module(file, module);
    mod.filename = file;
    mod.paths = Module._nodeModulePaths(path.dirname(file));
    mod._compile(source, file);
    return mod.exports;
}

function loadWorker(base) {
    const exported = loadWithInternals(path.join(base, "ExtractionModule", "workerWithOption.js"), [
        "getTraceStorageFromErigon",
        "getTraceStorageInputStream",
        "getEventForTransaction",
        "createTransactionLog",
    ]);
    // Gli handler IPC/di errore del worker non devono restare attivi nel processo di test.
    process.removeAllListeners("message");
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("unhandledRejection");
    return exported;
}

const mods = {};
for (const [label, base] of [["old", OLD], ["new", NEW]]) {
    mods[label] = {
        solc: load(base, "solcVersionManager.js"),
        contractUtils: load(base, "contractUtils/utils.js"),
        decodingUtils: load(base, "decodingUtils/utils.js"),
        decodeInternal: load(base, "decodeInternalTransaction.js"),
        odv: load(base, "optimizedDecodeValues.js"),
        erigon: load(base, "Erigon/erigonApi.js"),
        worker: loadWorker(base),
        main: load(base, "ExtractionModule/mainWithOption.js"),
    };
}

// ---------------------------------------------------------------------------
// Utilità di confronto
// ---------------------------------------------------------------------------

function clone(value) {
    return value === undefined ? undefined : JSON.parse(stableStringify(value));
}

function stableStringify(value) {
    return JSON.stringify(value, (key, v) => (typeof v === "bigint" ? `${v.toString()}n` : v));
}

// Le metriche temporali cambiano a ogni esecuzione: si confrontano solo le chiavi.
const TIMING_KEY = /^time_/;
function stripTimings(value) {
    if (Array.isArray(value)) return value.map(stripTimings);
    if (value && typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = TIMING_KEY.test(k) && typeof v === "number" ? "<time>" : stripTimings(v);
        }
        return out;
    }
    return value;
}

async function run(fn) {
    resetCalls();
    muteConsole();
    try {
        const value = await fn();
        return { ok: true, value: JSON.parse(stableStringify(stripTimings(value)) ?? "null"), calls: stripTimings(clone(calls)) };
    } catch (error) {
        return { ok: false, error: `${error && error.constructor && error.constructor.name}: ${error && error.message}`, calls: stripTimings(clone(calls)) };
    } finally {
        unmuteConsole();
    }
}

const results = [];
function record(name, status, detail) {
    results.push({ name, status, detail });
    const mark = status === "FALLITO" ? "✗" : "✓";
    realConsole.log(`${mark} [${status}] ${name}${detail ? " — " + detail : ""}`);
}

/** Esegue lo stesso scenario su vecchio e nuovo codice e richiede output identici. */
async function same(name, scenario) {
    const oldResult = await run(() => scenario(mods.old));
    const newResult = await run(() => scenario(mods.new));
    const a = stableStringify(oldResult);
    const b = stableStringify(newResult);
    if (a === b) {
        record(name, "IDENTICO", oldResult.ok ? "" : `entrambi lanciano ${oldResult.error}`);
    } else {
        record(name, "FALLITO", `\n    vecchio: ${a.slice(0, 1500)}\n    nuovo:   ${b.slice(0, 1500)}`);
    }
}

/**
 * Scenario che attiva un FIX: il vecchio codice deve comportarsi in modo diverso e
 * il nuovo deve soddisfare check(newResult, oldResult).
 */
async function fixed(fixId, name, scenario, check) {
    const fixExpected = APPLIED_FIXES === null || APPLIED_FIXES.has(fixId);
    if (!fixExpected && !FIXES_WITHOUT_PREFIX.has(fixId)) {
        return same(`${name} [${fixId} non applicato]`, scenario);
    }
    const oldResult = await run(() => scenario(mods.old));
    const newResult = await run(() => scenario(mods.new));
    const differs = stableStringify(oldResult) !== stableStringify(newResult);
    if (!differs && FIXES_WITHOUT_PREFIX.has(fixId)) {
        record(`${name} [${fixId} non ancora applicato]`, "IDENTICO", "");
        return;
    }
    let reason = null;
    try {
        reason = check(newResult, oldResult);
    } catch (e) {
        reason = "check lanciato: " + e.message;
    }
    if (differs && reason === true) {
        const oldDescription = oldResult.ok ? "vecchio: output diverso" : `vecchio: ${oldResult.error}`;
        record(name, fixId, oldDescription);
    } else {
        record(name, "FALLITO", `${fixId} non verificato (${differs ? reason : "nessuna differenza"})\n    vecchio: ${stableStringify(oldResult).slice(0, 1200)}\n    nuovo:   ${stableStringify(newResult).slice(0, 1200)}`);
    }
}

// ---------------------------------------------------------------------------
// Fixture comuni
// ---------------------------------------------------------------------------

const pad = (hex) => web3.utils.padLeft(String(hex).replace(/^0x/, ""), 64);
const padNum = (n) => pad(BigInt(n).toString(16));
const keccakNo0x = (hex) => web3.utils.keccak256("0x" + hex).slice(2);
const addSlot = (hex, n) => pad((BigInt("0x" + hex) + BigInt(n)).toString(16));

const ADDRESS_A = "1111111111111111111111111111111111111111";
const ADDRESS_B = "2222222222222222222222222222222222222222";
const TOKEN = "0x" + "3".repeat(40);
const PROXY = "0x" + "4".repeat(40);
const IMPLEMENTATION = "0x" + "5".repeat(40);
const UNVERIFIED = "0x" + "6".repeat(40);
const UNKNOWN = "0x" + "7".repeat(40);
const TX_HASH = "0x" + "ab".repeat(32);

const ERC20_ABI = [
    { type: "function", name: "transfer", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
    { type: "function", name: "setPair", inputs: [{ name: "pair", type: "tuple", components: [{ name: "a", type: "address" }, { name: "b", type: "uint256" }] }], outputs: [] },
    { type: "event", name: "Transfer", anonymous: false, inputs: [{ name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "value", type: "uint256", indexed: false }] },
];
const ERC20_ABI_STRING = JSON.stringify(ERC20_ABI);
const TRANSFER_INPUT = "0xa9059cbb" + pad(ADDRESS_B) + padNum(1000);
const TRANSFER_TOPIC = web3.utils.sha3("Transfer(address,address,uint256)");

const NETWORK = { web3Endpoint: "http://node.invalid", apiKey: "KEY", endpoint: "https://etherscan.invalid/api?chainid=1", networkName: "Mainnet" };

function transferLog(address, logIndex, amount) {
    return { address, topics: [TRANSFER_TOPIC, "0x" + pad(ADDRESS_A), "0x" + pad(ADDRESS_B)], data: "0x" + padNum(amount), logIndex: "0x" + logIndex.toString(16) };
}

function etherscanResult({ abi, proxy = "0", name = "C", implementation = "" }) {
    return { data: { status: "1", message: "OK", result: [{ ABI: abi, Proxy: proxy, ContractName: name, SourceCode: "src", CompilerVersion: "v0.8.26", Implementation: implementation }] } };
}

// Layout di storage del contratto di test (formato solc).
// Gli slot degli array dinamici sono scelti in base al primo carattere di keccak(slot)
// per isolare FIX-02 (hash che inizia con "0") dagli altri casi.
function firstSlot(from, predicate) {
    for (let s = from; s < 300; s++) {
        if (predicate(keccakNo0x(padNum(s)))) return s;
    }
    throw new Error("slot non trovato");
}
const SLOT_DYN_UINT_ZERO_HASH = firstSlot(20, (h) => h.startsWith("0"));
const SLOT_DYN_UINT = firstSlot(SLOT_DYN_UINT_ZERO_HASH + 1, (h) => !h.startsWith("0") && !h.startsWith("f"));
const SLOT_STRING_ZERO_HASH = firstSlot(SLOT_DYN_UINT + 1, (h) => h.startsWith("0") && !h.slice(0, 63).endsWith("f"));
const SLOT_DYN_STRUCT = firstSlot(SLOT_STRING_ZERO_HASH + 1, (h) => !h.startsWith("0") && !h.startsWith("f"));

const STRUCT_TYPE = "t_struct(Item)20_storage";
const STORAGE = [
    { label: "total", type: "t_uint256", slot: "0", offset: 0 },
    { label: "owner", type: "t_address", slot: "1", offset: 0 },
    { label: "paused", type: "t_bool", slot: "1", offset: 20 },
    { label: "status", type: "t_enum(Status)10", slot: "2", offset: 0 },
    { label: "balances", type: "t_mapping(t_address,t_uint256)", slot: "3", offset: 0 },
    { label: "items", type: `t_mapping(t_uint256,${STRUCT_TYPE})`, slot: "4", offset: 0 },
    { label: "hashMap", type: "t_mapping(t_uint256,t_array(t_bytes32)2_storage)", slot: "5", offset: 0 },
    { label: "addrs", type: "t_array(t_address)dyn_storage", slot: "6", offset: 0 },
    { label: "small", type: "t_uint128", slot: "7", offset: 0 },
    { label: "big", type: "t_uint128", slot: "7", offset: 16 },
    { label: "valuesZeroHash", type: "t_array(t_uint256)dyn_storage", slot: String(SLOT_DYN_UINT_ZERO_HASH), offset: 0 },
    { label: "values", type: "t_array(t_uint256)dyn_storage", slot: String(SLOT_DYN_UINT), offset: 0 },
    { label: "name", type: "t_string_storage", slot: String(SLOT_STRING_ZERO_HASH), offset: 0 },
    { label: "list", type: `t_array(${STRUCT_TYPE})dyn_storage`, slot: String(SLOT_DYN_STRUCT), offset: 0 },
    { label: "last", type: "t_uint256", slot: "299", offset: 0 },
];
const COMPILED = JSON.stringify({
    contracts: {
        contract0: {
            Test: {
                storageLayout: {
                    storage: STORAGE,
                    types: {
                        [STRUCT_TYPE]: { members: [{ label: "a", type: "t_uint256", slot: "0", offset: 0 }, { label: "b", type: "t_address", slot: "1", offset: 0 }] },
                    },
                },
            },
        },
    },
});
const CONTRACT_TREE = { 1: { name: "Test", storage: STORAGE.map((v) => ({ name: v.label, type: v.type, slot: v.slot, offset: v.offset })) } };

function decodeStorage(m, shaTraces, functionStorage) {
    return m.odv.optimizedDecodeValues(null, CONTRACT_TREE, shaTraces, functionStorage, "fn", "Test", web3, COMPILED);
}

function mappingTrace(keyHex, slot) {
    return { hexKey: pad(keyHex), hexStorageIndex: padNum(slot), finalKey: keccakNo0x(pad(keyHex) + padNum(slot)) };
}

const findVar = (result, name) => (result.value || []).find((v) => v.variableName === name);

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

async function testSolcVersionManager() {
    const releases = { "0.8.26": "soljson-v0.8.26+commit.8a97fa7a.js", "0.8.25": "soljson-v0.8.25.js", "0.7.6": "soljson-v0.7.6.js", "0.6.12": "soljson-v0.6.12.js" };
    stubState.axiosGet = async () => ({ data: { releases } });
    for (const source of ["pragma solidity ^0.8.0;", "pragma solidity >=0.7.0;", "pragma solidity =0.7.6;", "pragma solidity <0.8.0;", "pragma solidity ^0.6.0; pragma solidity >0.6.1;", "contract X {}"]) {
        await same(`solcVersionManager.detectVersion(${JSON.stringify(source)})`, (m) => m.solc.detectVersion(source));
    }
    stubState.axiosGet = async () => { throw new Error("offline"); };
    await same("solcVersionManager.detectVersion senza rete (5 tentativi)", (m) => m.solc.detectVersion("pragma solidity ^0.8.0;"));
    await same("solcVersionManager.getRemoteVersion", async (m) => typeof (await m.solc.getRemoteVersion("v0.8.26")).compile);
}

async function testContractUtils() {
    stubState.axiosGet = async (url) => {
        if (url.includes("soliditylang")) return { data: { releases: { "0.8.26": "soljson-v0.8.26.js" } } };
        if (url.includes(ADDRESS_A)) return { data: { result: [{ SourceCode: "{{\"sources\":{\"node_modules/lib/A.sol\":{\"content\":\"contract A{}\"},\"B.sol\":{\"content\":\"contract B{}\"}}}}", ABI: "[]", CompilerVersion: "v0.8.26", Proxy: "0", ContractName: "B" }] } };
        if (url.includes(ADDRESS_B)) return { data: { result: [{ SourceCode: "", ABI: "Contract source code not verified" }] } };
        return { data: { result: [] } };
    };
    const verified = { abi: "[]", compilerVersion: "v0.8.26", sourceCode: "{\"sources\":{\"X.sol\":{\"content\":\"contract X{}\"}}}", proxy: "0", contractName: "X" };
    const contractsToList = (r) => (r ? { ...r, contracts: Object.keys(r.contracts).map((k) => [k, r.contracts[k]]) } : r);
    await same("contractUtils.getContractCodeEtherscan da DB (standard-json)", async (m) => contractsToList(await m.contractUtils.getContractCodeEtherscan("0x1", "e", "k", verified)));
    await same("contractUtils.getContractCodeEtherscan da DB (sorgente singolo)", async (m) => contractsToList(await m.contractUtils.getContractCodeEtherscan("0x1", "e", "k", { ...verified, sourceCode: "contract Y{}" })));
    await same("contractUtils.getContractCodeEtherscan da Etherscan ({{...}})", async (m) => contractsToList(await m.contractUtils.getContractCodeEtherscan(ADDRESS_A, "e", "k", null)));
    await same("contractUtils.getContractCodeEtherscan non verificato", (m) => m.contractUtils.getContractCodeEtherscan(ADDRESS_B, "e", "k", null));
    await same("contractUtils.getContractCodeEtherscan firstExtraction=false", (m) => m.contractUtils.getContractCodeEtherscan(ADDRESS_A, "e", "k", null, false));
    await same("contractUtils.getContractCodeEtherscan sourceCode mancante", (m) => m.contractUtils.getContractCodeEtherscan("0x1", "e", "k", { ...verified, sourceCode: undefined }));

    stubState.compiledOutput = JSON.stringify({
        sources: {
            "A.sol": { ast: { nodes: [{ nodeType: "PragmaDirective" }, { nodeType: "ContractDefinition", id: 10, name: "Base", linearizedBaseContracts: [10], nodes: [{ nodeType: "FunctionDefinition", name: "foo", body: {}, implemented: true }, { nodeType: "FunctionDefinition", name: "abs", implemented: false }] }] } },
            "B.sol": { ast: { nodes: [{ nodeType: "ContractDefinition", id: 20, name: "Test", linearizedBaseContracts: [20, 10], nodes: [{ nodeType: "FunctionDefinition", name: "bar", body: {}, implemented: true }, { nodeType: "VariableDeclaration", name: "x" }] }] } },
            "C.sol": {},
        },
        contracts: {
            "A.sol": { Base: { storageLayout: { storage: [] } }, Other: { storageLayout: { storage: [{ label: "o", type: "t_uint8", slot: "0", offset: 0 }] } } },
            "B.sol": { Test: { storageLayout: { storage: [{ label: "x", type: "t_uint256", slot: "0", offset: 0 }] } }, Second: { storageLayout: { storage: [{ label: "y", type: "t_uint256", slot: "0", offset: 0 }] } } },
        },
    });
    const sources = [];
    sources["A.sol"] = { nameId: "contract0", content: "pragma solidity ^0.8.0; contract Base{}" };
    sources["B.sol"] = { nameId: "contract1", content: "pragma solidity ^0.8.0; contract Test{}" };
    await same("contractUtils.getCompiledData (fork solc simulato)", (m) => m.contractUtils.getCompiledData(sources, "Test", "v0.8.26"));
    await same("contractUtils.getCompiledData sorgente stringa", (m) => m.contractUtils.getCompiledData("pragma solidity ^0.8.0; contract Test{}", "Test", "v0.8.26"));
    await same("contractUtils.getCompiledData senza sorgenti", (m) => m.contractUtils.getCompiledData(undefined, undefined, undefined));

    const cached = { fullContractTree: { a: 1 }, contractCompiled: "{}", storageLayoutFlag: true, abi: "[]", sourceCode: "s", proxy: "0", contractName: "N", compilerVersion: "v" };
    await same("contractUtils.getContractTree da cache", (m) => m.contractUtils.getContractTree(null, "0x1", "e", "k", cached));
    await same("contractUtils.getContractTree file caricato", (m) => m.contractUtils.getContractTree("source", "0x1", "e", "k", null));
    await same("contractUtils.getContractTree compila e salva", (m) => m.contractUtils.getContractTree(null, ADDRESS_A, "e", "k", null));
    await same("contractUtils.getContractTree non verificato", (m) => m.contractUtils.getContractTree(null, ADDRESS_B, "e", "k", null));
}

async function testDecodingUtils() {
    const InputDataDecoder = require("ethereum-input-data-decoder");
    const decoded = new InputDataDecoder(ERC20_ABI).decodeData(TRANSFER_INPUT);
    const tupleDecoded = new InputDataDecoder(ERC20_ABI).decodeData(web3.eth.abi.encodeFunctionCall(ERC20_ABI[1], [{ a: "0x" + ADDRESS_A, b: 5 }]));
    await same("decodingUtils.decodeInputs", (m) => m.decodingUtils.decodeInputs(decoded, web3));
    await same("decodingUtils.decodeInputs (tupla)", (m) => m.decodingUtils.decodeInputs(tupleDecoded, web3));
    await same("decodingUtils.decodeTransactionInputs", (m) => { const tx = { input: TRANSFER_INPUT }; m.decodingUtils.decodeTransactionInputs(tx, ERC20_ABI_STRING); return tx; });
    await same("decodingUtils.decodeTransactionInputs ABI non valida", (m) => { const tx = { input: TRANSFER_INPUT }; m.decodingUtils.decodeTransactionInputs(tx, "not json"); return tx; });

    const receiptLogs = [transferLog(TOKEN, 0, 10), transferLog(TOKEN, 1, 20), transferLog(PROXY, 2, 30), { address: UNKNOWN, topics: ["0x01"], data: "0x", logIndex: "0x3" }];
    stubState.rpc = async (method) => (method === "eth_getTransactionReceipt" ? { logs: receiptLogs } : null);
    await same("decodingUtils.getEvents (ricevuta)", (m) => m.decodingUtils.getEvents(TX_HASH, 1, TOKEN, web3, ERC20_ABI_STRING, NETWORK));
    await same("decodingUtils.getEvents ABI non verificata", (m) => m.decodingUtils.getEvents(TX_HASH, 1, TOKEN, web3, "Contract source code not verified", NETWORK));
    await same("decodingUtils.getEventFromErigon", (m) => m.decodingUtils.getEventFromErigon(TX_HASH, NETWORK));
    stubState.hardhatReceiptLogs = receiptLogs;
    await same("decodingUtils.getEventFromHardHat", (m) => m.decodingUtils.getEventFromHardHat(TX_HASH, NETWORK, null, 1));

    stubState.searchAbi = async ({ contractAddress }) => {
        if (contractAddress === TOKEN) return { abi: ERC20_ABI_STRING, proxy: "0" };
        if (contractAddress === PROXY) return { abi: "[]", proxy: "1", proxyImplementation: "" };
        if (contractAddress === IMPLEMENTATION) return null;
        return null;
    };
    stubState.axiosGet = async (url) => {
        if (url.includes(PROXY)) return etherscanResult({ abi: "[]", proxy: "1", implementation: IMPLEMENTATION });
        if (url.includes(IMPLEMENTATION)) return etherscanResult({ abi: ERC20_ABI_STRING });
        return { data: { status: "0", message: "NOTOK", result: "Invalid" } };
    };
    await same("decodingUtils.getEventsFromInternal (contratto)", (m) => m.decodingUtils.getEventsFromInternal(TX_HASH, 1, TOKEN, NETWORK, web3));
    await same("decodingUtils.getEventsFromInternal (proxy -> implementazione)", (m) => m.decodingUtils.getEventsFromInternal(TX_HASH, 1, PROXY, NETWORK, web3));
    await same("decodingUtils.getEventsFromInternal (sconosciuto, NOTOK)", (m) => m.decodingUtils.getEventsFromInternal(TX_HASH, 1, UNKNOWN, NETWORK, web3));
    await same("decodingUtils.getEventsFromInternal (indirizzo vuoto)", (m) => m.decodingUtils.getEventsFromInternal(TX_HASH, 1, undefined, NETWORK, web3));
    const internalTree = [{ to: TOKEN, from: PROXY, calls: [{ to: UNKNOWN, from: TOKEN }, { to: PROXY, from: TOKEN }] }, { to: UNKNOWN, from: TOKEN }];
    await same("decodingUtils.iterateInternalForEvent internalTransaction=1", (m) => m.decodingUtils.iterateInternalForEvent(TX_HASH, 1, internalTree, { internalTransaction: 1 }, NETWORK, web3));
    await same("decodingUtils.iterateInternalForEvent internalTransaction=0", (m) => m.decodingUtils.iterateInternalForEvent(TX_HASH, 1, internalTree, { internalTransaction: 0 }, NETWORK, web3));
    await same("decodingUtils.safeCheck / checkIfEventIsAlreadyStored", (m) => [
        m.decodingUtils.safeCheck([{ a: 1, b: { c: [1, 2] } }], { a: 1, b: { c: [1, 2] } }),
        m.decodingUtils.safeCheck([{ a: 1 }], { a: 2 }),
        m.decodingUtils.checkIfEventIsAlreadyStored([], { a: 1 }),
    ]);
}

function internalCallFixtures() {
    return [
        { to: TOKEN, from: PROXY, gas: 50000, gasUsed: "0x5208", inputsCall: TRANSFER_INPUT.slice(2), value: "0x0" },
        { to: UNVERIFIED, from: TOKEN, gas: 1, inputsCall: "deadbeef" + pad("1"), value: "0x0" },
        { to: PROXY, from: TOKEN, gas: 1, inputsCall: TRANSFER_INPUT.slice(2), possibleImplementation: { type: "DELEGATECALL", from: PROXY, input: TRANSFER_INPUT, to: IMPLEMENTATION } },
        { to: UNKNOWN, from: TOKEN, gas: 1, input: "0x" },
        { to: "0x" + "8".repeat(40), from: TOKEN, gas: 1, inputsCall: "00000000" + pad("2") },
    ];
}

function decodeInternalStubs({ notOkFirst = false } = {}) {
    let notOkCount = 0;
    stubState.searchAbi = async ({ contractAddress }) => {
        if (contractAddress === TOKEN) return { abi: ERC20_ABI_STRING, proxy: "0", proxyImplementation: "", contractName: "Token" };
        if (contractAddress === UNVERIFIED) return { abi: "Contract source code not verified", proxy: "0" };
        if (contractAddress === "0x" + "9".repeat(40)) return { abi: "[]", proxy: "1", proxyImplementation: IMPLEMENTATION.toUpperCase(), contractName: "P" };
        if (contractAddress === IMPLEMENTATION) return { abi: ERC20_ABI_STRING, contractName: "Impl" };
        if (contractAddress === "0x" + "a".repeat(40)) return { abi: "[]", proxy: "0", contractName: "Empty" };
        return null;
    };
    stubState.axiosGet = async (url) => {
        if (url.includes("4byte")) {
            if (url.includes("0xa9059cbb")) return { data: { results: [{ text_signature: "transferFrom(address,address,uint256)" }, { text_signature: "transfer(address,uint256)" }] } };
            if (url.includes("0xdeadbeef")) return { data: { results: [{ text_signature: "noArgs()" }] } };
            return { data: { results: [] } };
        }
        if (url.includes(PROXY)) return etherscanResult({ abi: "[]", proxy: "1", name: "Proxy" });
        if (url.includes(IMPLEMENTATION)) return etherscanResult({ abi: ERC20_ABI_STRING, name: "Impl" });
        if (url.includes("0x" + "b".repeat(40))) return etherscanResult({ abi: "Contract source code not verified", proxy: "1", name: "UnverifiedProxy" });
        if (notOkFirst && notOkCount++ === 0) return { data: { status: "0", message: "NOTOK", result: "rate limit" } };
        return etherscanResult({ abi: "Contract source code not verified", name: "" });
    };
    stubState.rpc = async (method) => (method === "eth_getTransactionReceipt" ? { logs: [transferLog(TOKEN, 0, 10), transferLog(IMPLEMENTATION, 1, 5)] } : null);
}

async function testDecodeInternalTransaction() {
    decodeInternalStubs();
    await same("decodeInternalTransaction (DB, non verificato, proxy da Etherscan, transfer, 0x00000000)", async (m) => {
        const metrics = {};
        const internals = internalCallFixtures();
        const result = await m.decodeInternal.decodeInternalTransaction(internals, null, web3, NETWORK, TX_HASH, 1, metrics);
        return { result, metricKeys: Object.keys(metrics).sort() };
    });
    await same("decodeInternalTransaction con smartContract caricato", (m) => m.decodeInternal.decodeInternalTransaction(internalCallFixtures(), "file", web3, NETWORK, TX_HASH, 1, {}));
    await same("handleAbiFromDb (proxy con implementazione in DB)", async (m) => {
        const element = { to: "0x" + "9".repeat(40), inputsCall: TRANSFER_INPUT.slice(2), gas: 1 };
        await m.decodeInternal.handleAbiFromDb(element, await stubState.searchAbi({ contractAddress: "0x" + "9".repeat(40) }), web3, {});
        return element;
    });
    await same("handleAbiFetch (proxy senza DELEGATECALL)", async (m) => {
        const element = { to: PROXY, inputsCall: TRANSFER_INPUT.slice(2), gas: 1 };
        await m.decodeInternal.handleAbiFetch(element, PROXY, "k", NETWORK.endpoint, web3, {});
        return element;
    });

    const tree = () => [
        { type: "CALL", from: PROXY, to: TOKEN, gas: "0x10", gasUsed: "0x8", value: "0x1", input: TRANSFER_INPUT, calls: [
            { type: "DELEGATECALL", from: TOKEN, to: "0x" + "9".repeat(40), gas: "0x4", gasUsed: "0x2", input: TRANSFER_INPUT },
            { type: "CALL", from: TOKEN, to: UNKNOWN, gas: "0x4", gasUsed: "0x2", input: "0x" },
        ] },
        { type: "CALL", from: PROXY, to: PROXY, gas: "0x10", gasUsed: "0x8", input: TRANSFER_INPUT, calls: [
            { type: "DELEGATECALL", from: PROXY, to: IMPLEMENTATION, gas: "0x4", gasUsed: "0x2", input: TRANSFER_INPUT },
        ] },
        { type: "STATICCALL", from: PROXY, to: "0x" + "a".repeat(40), gas: "0x10", gasUsed: "0x8", input: "0xdeadbeef" },
        { type: "CALL", from: PROXY, to: UNVERIFIED, gas: "0x10", gasUsed: "0x8", input: "0xdeadbeef" },
    ];
    for (const simulation of [false, true]) {
        await same(`decodeInternalRecursive simulation=${simulation}`, async (m) => {
            const metrics = {};
            const calls = tree();
            await m.decodeInternal.decodeInternalRecursive(calls, null, NETWORK, web3, 0, "0", TX_HASH, 1, new Set(), simulation, metrics);
            return { calls, metricKeys: Object.keys(metrics).sort() };
        });
    }
    decodeInternalStubs({ notOkFirst: true });
    await same("decodeInternalRecursive con retry Etherscan (NOTOK poi OK)", async (m) => {
        const calls = [{ type: "CALL", from: PROXY, to: UNKNOWN, gas: "0x10", gasUsed: "0x8", input: "0xdeadbeef" }];
        await m.decodeInternal.decodeInternalRecursive(calls, null, NETWORK, web3, 0, "0", TX_HASH, 1, new Set(), false, {});
        return calls;
    });
    decodeInternalStubs();
    stubState.axiosPost = async () => ({ data: { result: { calls: tree() } } });
    await same("newDecodedInternalTransaction", (m) => m.decodeInternal.newDecodedInternalTransaction(TX_HASH, null, NETWORK, web3, 1, {}));
    stubState.axiosPost = async () => ({ data: { result: {} } });
    await same("newDecodedInternalTransaction senza chiamate interne", (m) => m.decodeInternal.newDecodedInternalTransaction(TX_HASH, null, NETWORK, web3, 1, {}));

    await fixed("FIX-09", "decodeInputs con gas mancante (ToNumber non definita)", async (m) => {
        const element = { to: TOKEN, from: PROXY, inputsCall: TRANSFER_INPUT.slice(2) };
        await m.decodeInternal.decodeInternalTransaction([element], null, web3, NETWORK, TX_HASH, 1, {});
        return element;
    }, (n, o) => (!o.ok && /ReferenceError: ToNumber/.test(o.error) && n.ok && n.value.activity === "transfer" ? true : "atteso ReferenceError nel vecchio e activity=transfer nel nuovo"));

    await fixed("FIX-11", "handleAbiFetchErigon: proxy non verificato senza metriche", async (m) => {
        const metrics = {};
        const calls = [{ type: "CALL", from: PROXY, to: "0x" + "b".repeat(40), gas: "0x10", gasUsed: "0x8", input: "0xdeadbeef" }];
        await m.decodeInternal.decodeInternalRecursive(calls, null, NETWORK, web3, 0, "0", TX_HASH, 1, new Set(), true, metrics);
        return { calls, metricKeys: Object.keys(metrics).sort() };
    }, (n, o) => (n.value.metricKeys.includes("time_4byteLookupInternal") && !o.value.metricKeys.includes("time_4byteLookupInternal")
        && stableStringify(n.value.calls) === stableStringify(o.value.calls) ? true : "attesa solo la metrica time_4byteLookupInternal in più"));
}

async function testOptimizedDecodeValues() {
    const identicalStorage = {
        [padNum(0)]: padNum(66),
        [padNum(299)]: padNum(7),
    };
    const mapping = mappingTrace(ADDRESS_A, 3);
    identicalStorage[mapping.finalKey] = padNum(100);
    const itemTrace = mappingTrace(padNum(7), 4);
    identicalStorage[itemTrace.finalKey] = padNum(5);
    identicalStorage[addSlot(itemTrace.finalKey, 1)] = pad(ADDRESS_B);
    const valuesKey = keccakNo0x(padNum(SLOT_DYN_UINT));
    identicalStorage[padNum(SLOT_DYN_UINT)] = padNum(2);
    identicalStorage[valuesKey] = padNum(11);
    identicalStorage[addSlot(valuesKey, 1)] = padNum(22);
    const valuesTrace = { hexKey: padNum(0), hexStorageIndex: padNum(SLOT_DYN_UINT), finalKey: valuesKey };

    await same("optimizedDecodeValues: uint, mapping, mapping->struct, uint256[] (nessun FIX coinvolto)", (m) => decodeStorage(m, [mapping, itemTrace, valuesTrace], identicalStorage));
    await same("optimizedDecodeValues: input vuoti", (m) => decodeStorage(m, [], {}));
    await same("optimizedDecodeValues: shaTraces/functionStorage non validi", (m) => decodeStorage(m, "x", null));
    await same("optimizedDecodeValues: slot non mappato oltre 9999999", (m) => decodeStorage(m, [], { [keccakNo0x(padNum(1))]: padNum(1) }));

    await fixed("FIX-05", "optimizedDecodeValues: enum", (m) => decodeStorage(m, [], { [padNum(2)]: padNum(1) }),
        (n, o) => (findVar(n, "status")?.variableValue === 1 && !findVar(o, "status") ? true : "atteso status=1 solo nel nuovo"));

    const packedOwner = "0".repeat(22) + "01" + ADDRESS_A;
    await fixed("FIX-13", "optimizedDecodeValues: address+bool nello stesso slot (con FIX-06)", (m) => decodeStorage(m, [], { [padNum(1)]: packedOwner }),
        (n, o) => (findVar(n, "owner")?.variableValue === "0x" + ADDRESS_A && findVar(n, "paused")?.variableValue === true && !findVar(o, "paused") ? true : "atteso owner e paused=true"));
    const packedUint = padNum(9).slice(32) + padNum(4).slice(32);
    await fixed("FIX-13", "optimizedDecodeValues: due uint128 nello stesso slot (con FIX-06)", (m) => decodeStorage(m, [], { [padNum(7)]: packedUint }),
        (n, o) => (findVar(n, "small")?.variableValue === 4 && findVar(n, "big")?.variableValue === 9 && findVar(o, "small")?.variableValue !== 4 ? true : "atteso small=4, big=9"));

    const zeroValuesKey = keccakNo0x(padNum(SLOT_DYN_UINT_ZERO_HASH));
    const zeroHashStorage = { [padNum(SLOT_DYN_UINT_ZERO_HASH)]: padNum(2), [zeroValuesKey]: padNum(11), [addSlot(zeroValuesKey, 1)]: padNum(22) };
    await fixed("FIX-02", "optimizedDecodeValues: uint256[] con keccak(slot) che inizia con 0", (m) => decodeStorage(m, [{ hexKey: padNum(0), hexStorageIndex: padNum(SLOT_DYN_UINT_ZERO_HASH), finalKey: zeroValuesKey }], zeroHashStorage),
        (n, o) => (findVar(n, "valuesZeroHash_0")?.variableValue === 11 && findVar(n, "valuesZeroHash_1")?.variableValue === 22 && !findVar(o, "valuesZeroHash_0") ? true : "attesi 11 e 22"));

    const text = "Hello world, this string is longer than 31 bytes!";
    const textHex = Buffer.from(text).toString("hex");
    const stringKey = keccakNo0x(padNum(SLOT_STRING_ZERO_HASH));
    const longStringStorage = {
        [padNum(SLOT_STRING_ZERO_HASH)]: padNum(text.length * 2 + 1),
        [addSlot(stringKey, 0)]: textHex.slice(0, 64),
        [addSlot(stringKey, 1)]: textHex.slice(64).padEnd(64, "0"),
    };
    await fixed("FIX-02", "optimizedDecodeValues: stringa lunga con keccak(slot) che inizia con 0", (m) => decodeStorage(m, [{ hexKey: padNum(0), hexStorageIndex: padNum(SLOT_STRING_ZERO_HASH), finalKey: addSlot(stringKey, 0) }], longStringStorage),
        (n, o) => (findVar(n, "name")?.variableValue === text && findVar(o, "name")?.variableValue !== text ? true : "attesa la stringa completa"));

    const indexSumStorage = { [padNum(SLOT_DYN_UINT)]: padNum(20), [addSlot(valuesKey, 16)]: padNum(777) };
    await fixed("FIX-03", "optimizedDecodeValues: uint256[] con indexSum 0x10 (BigInt decimale)", (m) => decodeStorage(m, [{ hexKey: padNum(0), hexStorageIndex: padNum(SLOT_DYN_UINT), finalKey: addSlot(valuesKey, 16), indexSum: padNum(16) }], indexSumStorage),
        (n, o) => (findVar(n, "values_0")?.variableValue === 777 && !findVar(o, "values_0") ? true : "atteso values_0=777"));

    const listKey = keccakNo0x(padNum(SLOT_DYN_STRUCT));
    const listStorage = { [padNum(SLOT_DYN_STRUCT)]: padNum(3), [addSlot(listKey, 4)]: padNum(8), [addSlot(listKey, 5)]: pad(ADDRESS_A) };
    await fixed("FIX-03", "optimizedDecodeValues: struct[] con indexSum (hexToNumber senza 0x)", (m) => decodeStorage(m, [{ hexKey: padNum(0), hexStorageIndex: padNum(SLOT_DYN_STRUCT), finalKey: addSlot(listKey, 4), indexSum: padNum(4) }], listStorage),
        // NOTA: le struct non compaiono comunque nell'output (vedi CHANGELOG, punti dubbi):
        // si verifica solo che la decodifica non fallisca più.
        (n, o) => (!o.ok && /hex/.test(o.error) && n.ok ? true : "atteso errore hex nel vecchio e nessun errore nel nuovo"));

    await fixed("FIX-04", "optimizedDecodeValues: address[] dinamico (readComplexData undefined)", (m) => decodeStorage(m, [{ hexKey: padNum(0), hexStorageIndex: padNum(6), finalKey: keccakNo0x(padNum(6)) }], { [padNum(6)]: padNum(1), [padNum(0)]: padNum(66) }),
        (n, o) => (!o.ok && /TypeError/.test(o.error) && findVar(n, "total")?.variableValue === 66 ? true : "atteso TypeError nel vecchio e total=66 nel nuovo"));

    const hashTrace = mappingTrace(padNum(1), 5);
    await fixed("FIX-14", "optimizedDecodeValues: mapping -> bytes32[2] (readBytesArray non definita)", (m) => decodeStorage(m, [hashTrace], { [hashTrace.finalKey]: padNum(1), [padNum(0)]: padNum(66) }),
        (n, o) => (!o.ok && /ReferenceError: readBytesArray/.test(o.error) && findVar(n, "total")?.variableValue === 66 ? true : "atteso ReferenceError nel vecchio e total=66 nel nuovo"));
}

// structLogs sintetici: transazione pubblica (profondità 1) che scrive balances[A]
// e chiama un contratto (profondità 2) che scrive balances[B].
function buildStructLogs({ internalWritesMapping, prefixedStack }) {
    const word = (hex) => (prefixedStack ? "0x" + BigInt("0x" + hex).toString(16) : pad(hex));
    const keyA = keccakNo0x(pad(ADDRESS_A) + padNum(3));
    const keyB = keccakNo0x(pad(ADDRESS_B) + padNum(3));
    const callInput = TRANSFER_INPUT.slice(2);
    const callMemory = [callInput.slice(0, 64), callInput.slice(64, 128), callInput.slice(128).padEnd(64, "0")];
    const logs = [
        { pc: 0, op: "PUSH1", depth: 1, stack: [] },
        { pc: 1, op: "KECCAK256", depth: 1, stack: [word("40"), word("0")], memory: [pad(ADDRESS_A), padNum(3)] },
        { pc: 2, op: "SWAP1", depth: 1, stack: [word(keyA)] },
        { pc: 3, op: "SLOAD", depth: 1, stack: [word(keyA)], storage: { [keyA]: padNum(0) } },
        { pc: 4, op: "SSTORE", depth: 1, stack: [word("64"), word(keyA)], storage: { ["0x" + keyA]: "0x" + padNum(100) } },
        { pc: 5, op: "CALL", depth: 1, stack: [word("0"), word("0"), word("44"), word("0"), word("0"), word(TOKEN.slice(2)), word("5208")], memory: callMemory },
        { pc: 0, op: "PUSH1", depth: 2, stack: [] },
    ];
    if (internalWritesMapping) {
        logs.push(
            { pc: 1, op: "KECCAK256", depth: 2, stack: [word("40"), word("0")], memory: [pad(ADDRESS_B), padNum(3)] },
            { pc: 2, op: "DUP1", depth: 2, stack: [word(keyB)] },
            { pc: 3, op: "SSTORE", depth: 2, stack: [word("5"), word(keyB)], storage: { [keyB]: padNum(5) } },
        );
    }
    logs.push(
        { pc: 9, op: "STOP", depth: 2, stack: [], storage: internalWritesMapping ? { [keyB]: padNum(5) } : {} },
        { pc: 6, op: "POP", depth: 1, stack: [word("1")] },
        { pc: 7, op: "STOP", depth: 1, stack: [], storage: { [keyA]: padNum(100) } },
    );
    return logs;
}

/** L'originale createTransactionLog ha un parametro in più (extractionType, mai valorizzato). */
function extraLogArgs(m) {
    return m.worker.__internals.createTransactionLog.length === 9 ? [undefined] : [];
}

function streamOf(structLogs) {
    return Readable.from([JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structLogs } })]);
}

const TREE_FOR_PARSER = { fullContractTree: CONTRACT_TREE, storageLayoutFlag: true, contractCompiled: COMPILED, contractAbi: ERC20_ABI_STRING, contractName: "Test", sourceCode: "s", proxy: "0", compilerVersion: "v" };

function parserStubs() {
    decodeInternalStubs();
    stubState.axiosPost = async () => ({ data: { result: { calls: [{ type: "CALL", from: PROXY, to: TOKEN, gas: "0x10", gasUsed: "0x8", input: TRANSFER_INPUT, value: "0x0" }] } } });
}

async function testTraceParsers() {
    parserStubs();
    for (const prefixedStack of [false, true]) {
        const label = prefixedStack ? "stack con 0x" : "stack senza 0x";
        await same(`worker.getTraceStorageFromErigon (${label})`, (m) => m.worker.__internals.getTraceStorageFromErigon(
            streamOf(buildStructLogs({ internalWritesMapping: false, prefixedStack })), NETWORK, "transfer", TX_HASH, "Test", TREE_FOR_PARSER, null,
            { default: 1, internalStorage: 1, internalTransaction: 1, storageInternalTransactio: 1 }, web3, 1));
        await same(`worker.getTraceStorageInputStream (${label})`, async (m) => {
            const localMetrics = {};
            const result = await m.worker.__internals.getTraceStorageInputStream(
                streamOf(buildStructLogs({ internalWritesMapping: true, prefixedStack })), NETWORK, "transfer", TX_HASH, "Test", TREE_FOR_PARSER, null,
                { default: 1, internalStorage: 1, internalTransaction: 0 }, web3, 1, localMetrics);
            return { result, metricKeys: Object.keys(localMetrics).sort() };
        });
    }
    await same("worker.getTraceStorageFromErigon senza storageInternalTransactio", (m) => m.worker.__internals.getTraceStorageFromErigon(
        streamOf(buildStructLogs({ internalWritesMapping: false, prefixedStack: false })), NETWORK, "transfer", TX_HASH, "Test", TREE_FOR_PARSER, null,
        { default: 1, internalStorage: 1, internalTransaction: 1, storageInternalTransactio: 0 }, web3, 1));
    await same("worker.getTraceStorageInputStream JSON non valido", (m) => m.worker.__internals.getTraceStorageInputStream(
        Readable.from(["{\"result\":{\"structLogs\":[{\"op\":"]), NETWORK, "f", TX_HASH, "Test", TREE_FOR_PARSER, null, { internalStorage: 1 }, web3, 1, {}));

    await fixed("FIX-01", "worker.getTraceStorageFromErigon: SSTORE su mapping in una chiamata interna", (m) => m.worker.__internals.getTraceStorageFromErigon(
        streamOf(buildStructLogs({ internalWritesMapping: true, prefixedStack: false })), NETWORK, "transfer", TX_HASH, "Test", TREE_FOR_PARSER, null,
        { default: 1, internalStorage: 1, internalTransaction: 1, storageInternalTransactio: 1 }, web3, 1),
    (n, o) => (!o.ok && /hex/.test(o.error) && n.ok && n.value.decodedValues.length > 0 && n.value.internalTxs.length === 1 ? true : "atteso errore nel vecchio e storage/internalTxs nel nuovo"));

    const bucket = () => ({ trackBuffer: [{ hexKey: pad(ADDRESS_A), hexStorageIndex: padNum(3), finalKey: "k1" }, { hexKey: pad(ADDRESS_B), hexStorageIndex: padNum(500), finalKey: "k2" }], functionStorage: {} });
    await same("worker.createShatrace senza SSTORE corrispondenti", (m) => { const b = bucket(); const s = ["zz"]; m.worker.createShatrace(b, s, web3); return { b, s }; });
    await fixed("FIX-01", "worker.createShatrace con SSTORE corrispondente", (m) => { const b = bucket(); const s = ["k2", "k1"]; m.worker.createShatrace(b, s, web3); return { b, s }; },
        (n, o) => (!o.ok && n.ok && n.value.s.length === 0 && n.value.b.finalShaTraces.length === 3 ? true : "atteso errore nel vecchio e sstoreBuffer consumato nel nuovo"));
    await same("worker.regroupShatrace", (m) => m.worker.regroupShatrace([[{ finalKey: "a", hexStorageIndex: "1", x: 1 }], { finalKey: "a", hexStorageIndex: "1", x: 2 }, { finalKey: "b", hexStorageIndex: "1" }]));

    const storageMap = () => ({ 2: { finalShaTraces: ["A"], functionStorage: { a: 1 } }, 3: { finalShaTraces: ["A1"], functionStorage: { a1: 1 } }, 4: { finalShaTraces: ["B"], functionStorage: { b: 1 } } });
    await same("worker.assignStorageToTheInternal albero piatto", (m) => { const t = [{ id: "A" }, { id: "B" }]; m.worker.assignStorageToTheInternal(t, storageMap()); return t; });
    await fixed("FIX-07", "worker.assignStorageToTheInternal [A{A1}, B]", (m) => { const t = [{ id: "A", calls: [{ id: "A1" }] }, { id: "B" }]; m.worker.assignStorageToTheInternal(t, storageMap()); return t; },
        (n, o) => (n.value[1].finalShaTraces[0] === "B" && o.value[1].finalShaTraces[0] === "A1" ? true : "atteso bucket 4 per B"));

    for (const [label, tx] of [["transfer", { input: "0x" }], ["ABI valida", { input: TRANSFER_INPUT }], ["ABI non valida", { input: "0x12345678" }], ["input mancante", {}]]) {
        await same(`worker.decodeInput (${label})`, (m) => { const t = { ...tx }; m.worker.decodeInput(t, { contractAbi: ERC20_ABI_STRING }); return t; });
    }
    await same("worker.decodeInput ABI non verificata", (m) => { const t = { input: TRANSFER_INPUT }; m.worker.decodeInput(t, { contractAbi: "Contract source code not verified" }); return t; });
}

async function testEventsAndTransactionLog() {
    decodeInternalStubs();
    stubState.hardhatReceiptLogs = [transferLog(TOKEN, 0, 10), transferLog(UNKNOWN, 1, 3)];
    const internalTxs = () => [{ to: TOKEN, from: PROXY, events: [{ eventSignature: "0" }], calls: [{ to: UNKNOWN, from: TOKEN }] }];
    for (const duplicate of ["false", "true"]) {
        for (const option of [{ default: 1, internalTransaction: 1 }, { default: 1, internalTransaction: 0 }, { default: 0, internalTransaction: 1 }, { default: 0, internalTransaction: 0 }]) {
            await same(`worker.getEventForTransaction DUPLICATE_EVENTS=${duplicate} option=${JSON.stringify(option)}`, async (m) => {
                process.env.DUPLICATE_EVENTS = duplicate;
                const log = { transactionHash: TX_HASH, sender: PROXY, events: [], internalTxs: internalTxs() };
                await m.worker.__internals.getEventForTransaction(log, TX_HASH, 1, TOKEN, web3, { contractAbi: ERC20_ABI_STRING }, option, NETWORK);
                return log;
            });
        }
    }
    delete process.env.DUPLICATE_EVENTS;

    parserStubs();
    const httpModule = require("http");
    const realRequest = httpModule.request;
    httpModule.request = (options, callback) => {
        const req = new EventEmitter();
        req.write = () => {};
        req.end = () => setImmediate(() => callback(streamOf(buildStructLogs({ internalWritesMapping: false, prefixedStack: false }))));
        req.destroy = () => {};
        return req;
    };
    try {
        const baseTx = { hash: TX_HASH, blockNumber: "1", to: TOKEN, from: PROXY, gasUsed: "21000", value: "0", input: TRANSFER_INPUT, timestamp: "0x5f5e100" };
        for (const option of [{ default: 1, internalStorage: 1, internalTransaction: 1, storageInternalTransactio: 1 }, { default: 1, internalStorage: 1, internalTransaction: 0 }, { default: 0, internalTransaction: 0 }]) {
            for (const addressRange of [null, [TOKEN], [TOKEN, PROXY]]) {
                await same(`worker.createTransactionLog option=${JSON.stringify(option)} addressRange=${addressRange ? addressRange.length : "null"}`, (m) => {
                    const tx = { ...baseTx };
                    m.worker.decodeInput(tx, TREE_FOR_PARSER);
                    return m.worker.__internals.createTransactionLog(tx, "Test", TREE_FOR_PARSER, null, ...extraLogArgs(m), TOKEN, option, NETWORK, addressRange);
                });
            }
        }
        await same("worker.createTransactionLog via proxy (functionName dal selettore)", (m) => {
            stubState.axiosPost = async () => ({ data: { result: { calls: [{ type: "DELEGATECALL", from: TOKEN, to: IMPLEMENTATION, gas: "0x10", gasUsed: "0x8", input: TRANSFER_INPUT }] } } });
            const tx = { ...baseTx, input: TRANSFER_INPUT };
            m.worker.decodeInput(tx, { contractAbi: "[]" });
            return m.worker.__internals.createTransactionLog(tx, "Test", { ...TREE_FOR_PARSER, contractAbi: "[]" }, null, ...extraLogArgs(m), TOKEN, { default: 1, internalStorage: 1, internalTransaction: 1 }, NETWORK, null);
        });
        await fixed("FIX-12", "worker.createTransactionLog con contractTree null", (m) => {
            parserStubs();
            const tx = { ...baseTx };
            return m.worker.__internals.createTransactionLog(tx, "Test", null, null, ...extraLogArgs(m), TOKEN, { default: 1, internalStorage: 1, internalTransaction: 0 }, NETWORK, null);
        }, (n, o) => (!o.ok && /compilerVersion/.test(o.error) && n.ok ? true : "atteso TypeError nel vecchio"));
    } finally {
        httpModule.request = realRequest;
    }
}

async function testErigonApi() {
    let traceRequests = [];
    const tracePages = (pages) => {
        traceRequests = [];
        stubState.axiosPost = async (url, payload) => {
            traceRequests.push(payload.params[0].fromBlock);
            if (traceRequests.length > 5) throw new Error("ciclo infinito interrotto dal test");
            return { data: { result: pages[traceRequests.length - 1] || [] } };
        };
    };
    stubState.rpc = async (method, params) => {
        if (method === "eth_getTransactionByHash") return { from: PROXY, to: params[0].endsWith("02") ? null : TOKEN, value: "0x0", gas: "0x5208", input: "0x", blockNumber: "0x10" };
        if (method === "eth_getBlockByHash") return { timestamp: "0x5f5e100" };
        if (method === "eth_getTransactionReceipt") return { contractAddress: UNKNOWN, logs: [] };
        return null;
    };
    const trace = (hash, blockNumber) => ({ transactionHash: hash, blockHash: "0xbb", blockNumber });
    const page = [trace("0x01", 100), trace("0x01", 100), trace("0x02", 105)];
    const scenario = (pages, from, to) => async (m) => {
        tracePages(pages);
        const result = await m.erigon.buildTransactionHierarchy([PROXY], [TOKEN], from, to, NETWORK);
        return { result, requests: traceRequests };
    };
    await same("erigonApi.buildTransactionHierarchy blockNumber numerico (una pagina)", scenario([page], 100, 200));
    await same("erigonApi.buildTransactionHierarchy nessuna trace", scenario([[]], 100, 200));
    await same("erigonApi.buildTransactionHierarchy ultima trace oltre toBlock", scenario([[trace("0x03", "0xc8")]], 100, 150));
    await same("erigonApi.getEventFromErigon", (m) => m.erigon.getEventFromErigon("0x01", NETWORK));
    await fixed("FIX-08", "erigonApi.buildTransactionHierarchy blockNumber esadecimale prima di toBlock", scenario([[trace("0x01", "0x64")], [trace("0x02", "0x96")], []], 100, 200),
        // Vecchio: ripete sempre fromBlock (0x64), sovrascrive le pagine e con la pagina
        // vuota finale restituisce []. Con un nodo reale la stessa richiesta si ripete all'infinito.
        (n, o) => (o.ok && o.value.result.length === 0 && o.value.requests.every((r) => r === "0x64")
            && n.ok && n.value.result.length === 2 && stableStringify(n.value.requests) === stableStringify(["0x64", "0x65", "0x97"])
            ? true : "attese nel nuovo 3 richieste da blocchi crescenti e 2 transazioni"));
    const pageAroundTenMillion = [trace("0x01", 10000000), trace("0x01", 10000000), trace("0x02", 10000005)];
    await fixed("FIX-15", "erigonApi.buildTransactionHierarchy fromBlock/toBlock stringhe con cifre diverse", scenario([pageAroundTenMillion], "9999990", "10000010"),
        (n, o) => (o.ok && o.value.result.length === 0 && o.value.requests.length === 0 && n.value.result.length === 2 ? true : "atteso [] senza richieste nel vecchio"));

    const httpModule = require("http");
    const realRequest = httpModule.request;
    httpModule.request = (options, callback) => {
        const req = new EventEmitter();
        req.write = () => {};
        req.end = () => setImmediate(() => callback(streamOf([])));
        req.destroy = () => {};
        return req;
    };
    try {
        await fixed("FIX-10", "erigonApi.debugTransactionErigonStreaming (http/https non importati)", async (m) => {
            const { stream, requiredTime } = await m.erigon.debugTransactionErigonStreaming(TX_HASH, NETWORK.web3Endpoint);
            return { isStream: typeof stream.pipe === "function", requiredTimeType: typeof requiredTime };
        }, (n, o) => (!o.ok && /ReferenceError: https? is not defined/.test(o.error) && n.ok && n.value.isStream ? true : "atteso ReferenceError nel vecchio"));
    } finally {
        httpModule.request = realRequest;
    }
}

async function testMain() {
    const cached = { fullContractTree: CONTRACT_TREE, contractCompiled: COMPILED, storageLayoutFlag: true, abi: ERC20_ABI_STRING, sourceCode: "s", proxy: "0", contractName: "Test", compilerVersion: "v" };
    const env = { WEB3_ALCHEMY_MAINNET_URL: "http://node.invalid", API_KEY_ETHERSCAN: "KEY", ETHERSCAN_MAINNET_ENDPOINT: "https://etherscan.invalid/api?chainid=1" };
    Object.assign(process.env, env);
    const filters = { gasUsed: null, gasPrice: null, timestamp: null, senders: [], functions: [] };
    const option = { default: 1, internalStorage: 1, internalTransaction: 1, storageInternalTransactio: 0 };
    const txs = [
        { hash: "0x01", blockNumber: "100", from: PROXY, to: TOKEN, gasUsed: "1", input: "0x" },
        { hash: "0x02", blockNumber: "150", from: PROXY, to: TOKEN, gasUsed: "1", input: "0x" },
    ];
    const setStubs = ({ searchAbiResult }) => {
        stubState.searchAbi = async () => searchAbiResult;
        stubState.searchTransaction = async ({ transactionHash }) => (transactionHash === "0x01" ? [{ _doc: { _id: "x", __v: 0, transactionHash: "0x01", stored: true } }] : null);
        stubState.workerReply = (payload) => ({ status: "done", data: { log: { transactionHash: payload.tx.hash }, metrics: {} }, metrics: { time_workerTotal: 1, number_internalTxs: 0 } });
        stubState.axiosGet = async (url) => {
            if (url.includes("txlist")) return { data: { result: txs } };
            if (url.includes("getsourcecode")) return etherscanResult({ abi: ERC20_ABI_STRING, name: "Fetched" });
            if (url.includes("soliditylang")) return { data: { releases: { "0.8.26": "x" } } };
            throw new Error("url " + url);
        };
        stubState.axiosPost = async () => ({ data: { result: [{ transactionHash: "0x02", blockHash: "0xbb", blockNumber: 150 }] } });
        stubState.rpc = async (method) => (method === "eth_getTransactionByHash" ? { from: PROXY, to: TOKEN, value: "0x0", gas: "0x1", input: "0x", blockNumber: "0x96" } : { timestamp: "0x1" });
    };
    const oldParams = { network: "Mainnet", contractAddress: TOKEN, implementationContractAddress: TOKEN.toUpperCase(), contractName: "Test", fromBlock: 100, toBlock: 150, filters, smartContract: null, option };
    const newParams = { network: "Mainnet", contractAddressesFrom: [PROXY], contractAddressesTo: [TOKEN], fromBlock: 100, toBlock: 150, filters, smartContract: null, option };

    setStubs({ searchAbiResult: cached });
    await same("main.getAllTransactions oldParams, contratto in cache, returnInMemory", (m) => m.main.getAllTransactions(oldParams, null, true));
    await same("main.getAllTransactions oldParams, returnInMemory=false", (m) => m.main.getAllTransactions(oldParams, null, false));
    await same("main.getAllTransactions newParams", (m) => m.main.getAllTransactions(null, newParams, true));
    setStubs({ searchAbiResult: null });
    stubState.compiledOutput = JSON.stringify({ sources: {}, contracts: { "X.sol": { Test: { storageLayout: { storage: [{ label: "x", type: "t_uint256", slot: "0", offset: 0 }] } } } } });
    await same("main.getAllTransactions newParams, contratto da Etherscan e compilazione", (m) => m.main.getAllTransactions(null, newParams, true));
    await same("main.getAllTransactions oldParams, contratto non in DB", (m) => m.main.getAllTransactions(oldParams, null, true));
    await same("main.getAllTransactions network sconosciuto", (m) => m.main.getAllTransactions({ ...oldParams, network: "Nope" }, null, true));
    await same("main.getAllTransactions file caricato (stringa)", (m) => m.main.getAllTransactions({ ...oldParams, smartContract: "contract X {}" }, null, true));
    stubState.workerReply = () => ({ error: "boom" });
    setStubs({ searchAbiResult: cached });
    stubState.workerReply = () => ({ error: "boom" });
    await same("main.getAllTransactions worker in errore", (m) => m.main.getAllTransactions(oldParams, null, true));
}

(async () => {
    realConsole.log(`Confronto services/ (originale) vs ReformatCode/services/ (refactor)\n`);
    const groups = [testSolcVersionManager, testContractUtils, testDecodingUtils, testDecodeInternalTransaction, testOptimizedDecodeValues, testTraceParsers, testEventsAndTransactionLog, testErigonApi, testMain];
    for (const group of groups) {
        realConsole.log(`\n== ${group.name} ==`);
        try {
            await group();
        } catch (e) {
            record(group.name, "FALLITO", "errore del test: " + (e && e.stack));
        }
    }
    const failed = results.filter((r) => r.status === "FALLITO").length;
    const fixes = results.filter((r) => r.status.startsWith("FIX-")).length;
    const identical = results.filter((r) => r.status === "IDENTICO").length;
    realConsole.log(`\nTotale: ${results.length} casi — ${identical} identici, ${fixes} differenze attese (FIX), ${failed} falliti`);
    process.exit(failed > 0 ? 1 : 0);
})();
