const http = require("http");
const https = require("https");
const { searchAbi } = require("../../query/query");
const axios = require("axios");
const { getContractTree } = require("../contractUtils/utils");
const { default: Web3, net } = require("web3");
const { decodeInputs, decodeTransactionInputs } = require("../decodingUtils/utils");
const { saveAbi } = require("../../databaseStore");
const JSONStream = require("JSONStream");
const { optimizedDecodeValues } = require("../optimizedDecodeValues");
const { handleAbiFetch, handleAbiFromDb, decodeInternalRecursive } = require("../decodeInternalTransaction");
const { connectDB } = require("../../config/db");
const { decodeInput, regroupShatrace, createShatrace, assignStorageToTheInternal } = require("./workerWithOption");

// BiIng seralization
BigInt.prototype.toJSON = function() {
    return this.toString();
};

async function processSimulation(params, targetAddress, networkData) {
    try {
        let queryResult;
        let contractTree = null;

        if (targetAddress && targetAddress !== "0x" && targetAddress !== "") {
            const query = { contractAddress: targetAddress.toLowerCase() };
            let dbResponse = await searchAbi(query);

            if (!dbResponse || dbResponse?.abi?.includes("Contract source code not verified")) {
                const urlSeparator = networkData.endpoint.includes('?') ? '&' : '?';
                
                const axiosResponse = await axios.get(
                    `${networkData.endpoint}${urlSeparator}module=contract&action=getsourcecode&address=${targetAddress}&apikey=${networkData.apiKey}`
                );
                
                const axiosResult = axiosResponse.data.result[0];

                queryResult = {
                    contractName: axiosResult.ContractName,
                    abi: axiosResult.ABI,
                    proxy: axiosResult.Proxy,
                    proxyImplementation: '',
                    sourceCode: axiosResult.SourceCode,
                    contractAddress: targetAddress,
                    compilerVersion: axiosResult.CompilerVersion,
                };
            }
            else {
                queryResult = dbResponse;
            }

            contractTree = await getContractTree(
                null,
                targetAddress,
                networkData.endpoint,
                networkData.apiKey,
                queryResult
            );
        } 
        else {
            queryResult = { contractName: "Contract Creation", abi: [], proxy: "0" };
        }

        const txObject = params[0];
        txObject.input = txObject.data || txObject.input;

        decodeInput(txObject, contractTree);

        const simulationResult = await createSimulatedTransactionLog(
                params,
                queryResult.contractName,
                contractTree,
                networkData
            );

        return simulationResult;
    }
    catch (err) {
        console.error("Errore in processSimulation:", err);
        throw err;
    }
}

async function createSimulatedTransactionLog(rpcParams, mainContract, contractTree, networkData)  {
    let web3 = new Web3(networkData.web3Endpoint);
    const txObject = rpcParams[0];
    const blockRef = rpcParams[1];
    let resolvedBlockNumber = blockRef;

    try {
        const blockInfo = await web3.eth.getBlock(blockRef);

        if (blockInfo && blockInfo.number !== undefined && blockInfo.number !== null) {
            resolvedBlockNumber = Number(blockInfo.number);
        } else if (typeof blockRef === 'string' && blockRef.startsWith("0x")) {
            resolvedBlockNumber = web3.utils.hexToNumber(blockRef);
        }
    }
    catch (err) {
        if (typeof blockRef === 'string' && blockRef.startsWith("0x")) {
            resolvedBlockNumber = web3.utils.hexToNumber(blockRef);
        }
    }

    let transactionLog = {
        functionName: txObject.inputDecoded ? txObject.inputDecoded.method : null,
        transactionHash: "SIMULATED_TX",
        blockNumber: resolvedBlockNumber,
        contractAddress: txObject.to ? txObject.to : "Contract Creation (Deployment)",
        sender: txObject.from ? txObject.from : "0x0000000000000000000000000000000000000000",
        gasUsed: 0,
        timestamp: new Date().toISOString(),
        inputs: txObject.inputDecoded ? decodeInputs(txObject.inputDecoded, web3) : [],
        value: txObject.value || "0x0",
        storageState: [],
        internalTxs: [],
        events: []
    }

    let storageVal = null;

    try {
        const { stream, requiredTime } = await debugTraceCallErigonStreaming(rpcParams, networkData.web3Endpoint);

        storageVal = await getSimulatedTraceStorageFromErigon(
            stream, 
            networkData,
            transactionLog.functionName,
            mainContract,
            contractTree,
            web3,
            rpcParams
        );

        transactionLog.storageState = storageVal ? storageVal.decodedValues:[];
        transactionLog.internalTxs = storageVal ? storageVal.internalTxs:[];
        transactionLog.gasUsed = storageVal ? storageVal.gasUsed : 0;

        let storeAbi = {
            contractName: contractTree?.contractName || "",
            abi: contractTree?.contractAbi || "",
            proxy: contractTree?.proxy || "0",
            proxyImplementation: '',
            contractAddress: txObject.to,
            sourceCode: contractTree?.sourceCode || "",
            compilerVersion: contractTree?.compilerVersion || ""
        };

        if (!transactionLog.functionName && transactionLog.internalTxs && transactionLog.internalTxs.length > 0) {
            if (transactionLog.internalTxs[0].type == "DELEGATECALL") {
                const addressTo = transactionLog.internalTxs[0].to;
                const query = { contractAddress: addressTo.toLowerCase() };
                const response = await searchAbi(query);

                if (response) {
                    storeAbi.proxy = '1';
                    storeAbi.proxyImplementation = query.contractAddress;

                    decodeTransactionInputs(txObject, response.abi, web3);

                    if (txObject.inputDecoded) {
                        transactionLog.functionName = txObject.inputDecoded.method;
                        // decodifica completa migliorata
                        transactionLog.inputs = decodeInputs(txObject.inputDecoded, web3);
                    }
                }
            }   
        }

        if (contractTree && storeAbi.proxyImplementation !== '') {
            await saveAbi(storeAbi);
        }
    }
    catch (err) {
        console.error("Errore durante il salvataggio del log: ", err);
        throw err; 
    }
    finally {
        if (storageVal) {
            storageVal.decodedValues = null;
            storageVal.internalTxs = null;
            storageVal = null
        }
    }
    return transactionLog;
}

async function getSimulatedTraceStorageFromErigon(httpStream, networkData, functionName, mainContract, contractTree, web3, rpcParams) {
    let functionStorage = {};
    let mapForStorage = {};
    let depthToIndexMap = new Map();
    let nextIndex = 1;
    let index = 0;
    let trackBuffer = [];
    let bufferPC = -10;
    let sstoreBuffer = [];
    let sstoreOptimization = [];
    let internalCalls = [];
    let keccakBeforeAdd = {};
    let finalShaTraces = [];
    let previousTrace = null;
    
    const parser = JSONStream.parse("result.structLogs.*");
    const gasParser = JSONStream.parse("result.gas"); // parser per il gas
    let capturedGas = 0;
    httpStream.pipe(parser);
    httpStream.pipe(gasParser);

    // parsing per ottenere il gas
    gasParser.on("data", (gasValue) => {
        try {
            if (gasValue !== undefined && gasValue !== null) {
                // se il nodo manda una stringa esadecimale (es: "0x12a5")
                if (typeof gasValue === 'string' && gasValue.startsWith('0x')) {
                    capturedGas = web3.utils.hexToNumber(gasValue);
                } 
                // se il nodo manda una stringa numerica o è già un numero
                else {
                    capturedGas = Number(gasValue);
                }
            }
        } catch (e) {
            console.error("errore di conversione del gas:", e);
        }
    });

    gasParser.on("error", (err) => {
        console.error("errore interno al parser del gas:", err);
    });

    function getOrCreateIndexForDepth(depth) {
        if (!depthToIndexMap.has(depth)) {
            const newIndex = nextIndex++;
            depthToIndexMap.set(depth, newIndex);
            mapForStorage[newIndex] = {
                trackBuffer: [],
                functionStorage: {}
            };
        }
        return depthToIndexMap.get(depth);
    }

    await new Promise((resolve, reject) => {
        parser.on("data", (trace) => {
            if (trace.stack && trace.stack.length > 0) {
                let tempArray = [];
                trace.stack.forEach((element) => {
                    element = element.slice(2, element.length);
                    element = web3.utils.padLeft(element, 64);
                    tempArray.push(element);
                });
                trace.stack = tempArray;
            }
            if (previousTrace) {
                processTrace(previousTrace, trace);
            }

            previousTrace = trace;
        });

        parser.on("end", () => {
            if (previousTrace) {
                processTrace(previousTrace, null);
            }
            resolve();
        });

        parser.on("error", (error) => {
            console.error("Error parsing stream:", error);
            reject(error);
        });
    });

    function processTrace(trace, nextTrace) {
        const currentIndex = getOrCreateIndexForDepth(trace.depth);

        if (trace.op === "REVERT") {
            console.log("LA TRANSAZIONE HA FATTO REVERT!");
        }
        
        if (trace.op === "KECCAK256") {
            bufferPC = trace.pc;
            const stackLength = trace.stack.length;
            const memoryLocation = trace.stack[stackLength - 1];
            let numberLocation = web3.utils.hexToNumber("0x" + memoryLocation) / 32;
            let storageIndexLocation = numberLocation + 1;
            const hexKey = trace.memory[numberLocation];
            const hexStorageIndex = trace.memory[storageIndexLocation];
            
            mapForStorage[currentIndex].trackBuffer[index] = { hexKey, hexStorageIndex };
            
        } else if (trace.op === "STOP" || trace.op === "RETURN") {
            for (const slot in trace.storage) {
                mapForStorage[currentIndex].functionStorage[slot] = trace.storage[slot];
            }
            depthToIndexMap.delete(trace.depth);
            
        } else if (trace.pc === (bufferPC + 1)) {
            bufferPC = -10;
            mapForStorage[currentIndex].trackBuffer[index].finalKey = trace.stack[trace.stack.length - 1];
            keccakBeforeAdd = mapForStorage[currentIndex].trackBuffer[index];
            index++;
            
            if (trace.op === "ADD" && 
                (trace.stack[trace.stack.length - 1] === keccakBeforeAdd.finalKey ||
                 trace.stack[trace.stack.length - 2] === keccakBeforeAdd.finalKey) &&
                keccakBeforeAdd.hexStorageIndex === "0000000000000000000000000000000000000000000000000000000000000000") {
                
                const keyBuff = mapForStorage[currentIndex].trackBuffer[index - 1].hexKey;
                const slotBuff = mapForStorage[currentIndex].trackBuffer[index - 1].hexStorageIndex;
                mapForStorage[currentIndex].trackBuffer[index - 1].hexKey = slotBuff;
                mapForStorage[currentIndex].trackBuffer[index - 1].hexStorageIndex = keyBuff;
                
                if (nextTrace && nextTrace.stack && nextTrace.stack.length > 0) {
                    mapForStorage[currentIndex].trackBuffer[index - 1].finalKey = nextTrace.stack[nextTrace.stack.length - 1];
                }
                mapForStorage[currentIndex].trackBuffer[index - 1].indexSum = trace.stack[trace.stack.length - 2];
            }
            
        } else if (trace.op === "SSTORE") {
            sstoreOptimization.push(trace.stack);
            sstoreBuffer.push(trace.stack[trace.stack.length - 1]);
            
            for (const slot in trace.storage) {
                mapForStorage[currentIndex].functionStorage[slot] = trace.storage[slot];
            }
            
        } else if (trace.op === "CALL" || trace.op === "DELEGATECALL" || trace.op === "STATICCALL") {
            const offsetBytes = trace.stack[trace.op === "CALL" ? trace.stack.length - 4 : trace.stack.length - 3];
            const lengthBytes = trace.stack[trace.op === "CALL" ? trace.stack.length - 5 : trace.stack.length - 4];
            let stringDepthConstruction = "";
            for (let i = 0; i < trace.depth - 1; i++) {
                stringDepthConstruction += "_1";
            }
            let call = {
                callId: "0_1" + stringDepthConstruction,
                callType: trace.op,
                depth: trace.depth,
                gas: web3.utils.hexToNumber("0x" + trace.stack[trace.stack.length - 1]),
                to: "0x" + trace.stack[trace.stack.length - 2].slice(-40),
                inputsCall: ""
            };
            
            getOrCreateIndexForDepth(trace.depth + 1);
            
            let stringMemory = trace.memory.join("");
            stringMemory = stringMemory.slice(
                web3.utils.hexToNumber("0x" + offsetBytes) * 2,
                web3.utils.hexToNumber("0x" + offsetBytes) * 2 + web3.utils.hexToNumber("0x" + lengthBytes) * 2
            );
            call.inputsCall = stringMemory;
            internalCalls.push(call);
            
        } else if (trace.op === "SLOAD") {
            for (const slot in trace.storage) {
                mapForStorage[currentIndex].functionStorage[slot] = trace.storage[slot];
            }
        }
    }

    try {
        finalShaTraces = trackBuffer;
        console.log("Raw Storage Keys catturate:", sstoreBuffer.length);

        for (let i = 0; i < trackBuffer.length; i++) {
            if (sstoreBuffer.includes(trackBuffer[i].finalKey)) {
                const trace = {
                    finalKey: trackBuffer[i].finalKey,
                    hexKey: trackBuffer[i].hexKey,
                    indexSum: trackBuffer[i].indexSum,
                    hexStorageIndex: trackBuffer[i].hexStorageIndex
                };

                let flag = false;
                let test = i;

                while (flag === false) {
                    if (!(web3.utils.hexToNumber("0x" + trackBuffer[test].hexStorageIndex) < 300)) {
                        if (test > 0) {
                            test--;
                        } else {
                            flag = true;
                        }
                    } else {
                        trace.hexStorageIndex = trackBuffer[test].hexStorageIndex;
                        flag = true;
                        finalShaTraces.push(trace);
                    }
                }
                finalShaTraces.push(trace);
                sstoreBuffer.splice(sstoreBuffer.indexOf(trackBuffer[i].finalKey), 1);
            }
        }

        for (const singleObject in mapForStorage) {
            createShatrace(mapForStorage[singleObject], sstoreBuffer, web3);
        }

        let sstoreObject = { sstoreOptimization, sstoreBuffer };
        finalShaTraces = regroupShatrace(finalShaTraces);

        const rootShaTraces = mapForStorage["1"] ? mapForStorage["1"].finalShaTraces : [];
        const rootFunctionStorage = mapForStorage["1"] ? mapForStorage["1"].functionStorage : {};

        let internalStorage = contractTree && contractTree.storageLayoutFlag
            ? await optimizedDecodeValues(sstoreObject, contractTree.fullContractTree, rootShaTraces, rootFunctionStorage, functionName, mainContract, web3, contractTree.contractCompiled)
            : [];
        
        let internalTxs = [];
        if (rpcParams) {
            internalTxs = await decodeSimulatedInternalTransaction(rpcParams, null, networkData, web3);
            if (internalTxs && internalTxs.length > 0) {
                assignStorageToTheInternal(internalTxs, mapForStorage);
                await decodeInteralTxsStorage(internalTxs, web3, networkData); // added network data
            }
        }

        let result = {
            decodedValues: internalStorage,
            internalTxs: internalTxs,
            gasUsed: capturedGas
        };
        sstoreObject = null;
        return result;
    }
    catch (err) {
        console.log("errore ", err);
        throw err;
    }
    finally {
        functionStorage = null;
        trackBuffer.length = 0;
        trackBuffer = null;
        sstoreBuffer.length = 0;
        sstoreBuffer = null;
        sstoreOptimization.length = 0;
        sstoreOptimization = null;
        finalShaTraces.length = 0;
        finalShaTraces = null;
        if (global.gc) global.gc();
    }
    
}

function debugTraceCallErigonStreaming(params, url) {
    return new Promise((resolve, reject) => {
        const start = new Date();

        makeRpcCallStreaming(url, 'debug_traceCall', params)
            .then(stream => {
                const end = new Date();
                const requiredTime = parseFloat(((end - start) / 1000).toFixed(2));
                resolve({ requiredTime, stream });
            })
            .catch(reject);
    });
}

// funzione semplificata senza recupero degli eventi
async function decodeSimulatedInternalTransaction(params, smartContract, networkData, web3) {
    const internalCalls = await debugTraceCallInternal(params, networkData.web3Endpoint);

    if (!smartContract && internalCalls) {
        let seenEvent = new Set();
        await connectDB(networkData.networkName);
        await decodeInternalRecursive(internalCalls, smartContract, networkData, web3, 0, "0", null, null, seenEvent, true);
    } else {
        console.log("smart contract uploaded manually");
    }

    return internalCalls;
}

async function debugTraceCallInternal(params, web3Endpoint) {
    try {
        const payload = {
            jsonrpc: "2.0",
            method: "debug_traceCall",
            params: [
                params[0],
                params[1], 
                { tracer: "callTracer" } // Forziamo il tracer
            ],
            id: 1
        };
            
        const response = await axios.post(web3Endpoint, payload, {
            headers: { "Content-Type": "application/json" }
        });

        // STAMPA DI DEBUG: Vediamo cosa risponde VERAMENTE il nodo
        console.log("=== RISPOSTA CALL TRACER ===");
        if (response.data.error) {
            console.error("ERRORE RPC DAL NODO:", response.data.error);
            return [];
        } else if (response.data.result) {
            // Stampiamo un'anteprima del risultato per controllare se c'è l'array 'calls'
            console.log("Result type:", response.data.result.type, "| Revert?", response.data.result.error || "No");
            console.log("Numero di chiamate interne trovate:", response.data.result.calls ? response.data.result.calls.length : 0);
        }
            
        return response.data.result && response.data.result.calls ? response.data.result.calls : [];
    } 
    catch (err) {
        console.error("debugInternalTransaction error:", err.message);
        throw err;
    }
}


function makeRpcCallStreaming(url, method, params) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const client = isHttps ? https : http;

        const payload = JSON.stringify({
            jsonrpc: '2.0',
            method: method,
            params: params,
            id: 1
        });

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 300000 
        };

        const req = client.request(options, (res) => {
            const contentType = res.headers['content-type'] || '';

            if (res.statusCode !== 200 || !contentType.includes('application/json')) {
                let errorData = '';
                res.on('data', chunk => errorData += chunk);
                res.on('end', () => {
                    reject(new Error(`Errore dal nodo (Status ${res.statusCode}): ${errorData.substring(0, 300)}`));
                });
                return;
            }

            resolve(res);
        });

        req.on('error', (err) => {
            reject(new Error(`Richiesta fallita a livello di rete: ${err.message}`));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Timeout dal nodo RPC.'));
        });

        req.write(payload);
        req.end();
    });
}

async function decodeInteralTxsStorage(internalTxs, web3, networkData){
    for(let txs of internalTxs){
        const query = { contractAddress: txs.to.toLowerCase() };
        let queryResult = await searchAbi(query);
        // changed nulls variables with networkData endpoint and apyKey
    let contractTree = await getContractTree(null, txs.to, networkData.endpoint, networkData.apiKey, queryResult);        let storageState = contractTree && contractTree.storageLayoutFlag 
                ? await optimizedDecodeValues(null, contractTree.fullContractTree, txs.finalShaTraces, txs.functionStorage, txs.activity, txs.contractCalledName, web3, contractTree.contractCompiled)
                : [];
        txs.storageState=storageState;
        if(txs.calls && txs.calls.length>0){
            await decodeInteralTxsStorage(txs.calls,web3, networkData);
        }
    }
}

// < -- FUNZIONI COPIATE DAL WORKER -- > 
// function decodeInput(tx,contractTree) {
//     if (tx.input == "0x") {
//         tx.methodId = "Transfer";
//     } else if (contractTree?.contractAbi && (typeof contractTree.contractAbi !== 'object' || Object.keys(contractTree.contractAbi).length > 0)) {
//         decodeTransactionInputs(tx, contractTree.contractAbi);
//     }
// }

// function regroupShatrace(finalShaTraces) {
//     finalShaTraces=finalShaTraces.flat();
//     return Array.from(
//         new Map(finalShaTraces.map(item => [item.finalKey + item.hexStorageIndex, item])).values()
//       );
// }

// function createShatrace(singleObject,sstoreBuffer,web3) {
//     singleObject.finalShaTraces=singleObject.trackBuffer;

//     for (let i = 0; i < singleObject.trackBuffer.length; i++) {
//         if (singleObject.trackBuffer[i] && sstoreBuffer.includes(singleObject.trackBuffer[i].finalKey)) {
//             const trace = {
//                 finalKey: singleObject.trackBuffer[i].finalKey,
//                 hexKey: singleObject.trackBuffer[i].hexKey,
//                 indexSum: singleObject.trackBuffer[i].indexSum,
//                 hexStorageIndex: singleObject.trackBuffer[i].hexStorageIndex
//             };

//             let flag = false;
//             let test = i;

//             while (flag === false) {
//                 if (!(web3.utils.hexToNumber("0x" + singleObject.trackBuffer[test].hexStorageIndex) < 300)) {
//                     if (test > 0) {
//                         test--;
//                     } else {
//                         flag = true;
//                     }
//                 } else {
//                     trace.hexStorageIndex = singleObject.trackBuffer[test].hexStorageIndex;
//                     flag = true;
//                     singleObject.finalShaTraces.push(trace);
//                 }
//             }
//             singleObject.finalShaTraces.push(trace);
//             sstoreBuffer.splice(sstoreBuffer.indexOf(singleObject.trackBuffer[i].finalKey), 1);
//         }
//     }
//     singleObject.finalShaTraces = regroupShatrace(singleObject.finalShaTraces)
//     delete singleObject.trackBuffer;
// } 

// function assignStorageToTheInternal(internalTxs,mapForStorage,index=2) {
//     for(let txs of internalTxs){
//         txs.finalShaTraces=mapForStorage[index].finalShaTraces;
//         txs.functionStorage=mapForStorage[index].functionStorage;
//         index++;
//         if(txs.calls && txs.calls.length>0){
//             assignStorageToTheInternal(txs.calls,mapForStorage,index);
//         }
//     }
// }

module.exports={
    processSimulation
}
