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
const { handleAbiFetch, handleAbiFromDb } = require("../decodeInternalTransaction");

async function processSimulation(params, targetAddress, networkData) {
    try {
        let queryResult;

        const query = { contractAddress: targetAddress.toLowerCase() };
        let dbResponse = await searchAbi(query);

        if (!dbResponse || dbResponse?.abi?.includes("Contract source code not verified")) {
            const axiosResponse = await axios.get(
                `${networkData.endpoint}?module=contract&action=getsourcecode&address=${targetAddress}&apikey=${networkData.apiKey}`);
            
            const axiosResult = axiosResponse.data.result[0];

            if (!axiosResult.ABI || axiosResult.ABI === "Contract source code not verified") {
                    throw new Error("Impossibile recuperare l'ABI: Contratto non verificato su Etherscan.");
            }

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

        const contractTree = await getContractTree(
            null,
            targetAddress,
            networkData.endpoint,
            networkData.apiKey,
            queryResult
        );

        const txObject = rcpParams[0];
        txObject.input = txObject.data || txObject.input;

        decodeInput(txObject, contractTree);

        const simulationResult = await createSimulatedTransactionLog(
                rpcParams,
                queryResult.contractName,
                contractTree,
                networkData
            );

        return simulationResult;
    }
    catch (err) {
        console.error("Errore in processSimulation:", error);
        throw error;
    }
}

async function createSimulatedTransactionLog(rcpParams, mainContract, contractTree, networkData)  {
    let web3 = new Web3(networkData.web3Endpoint);
    const txObject = rcpParams[0];
    const blockRef = rcpParams[1];

    let transactionLog = {
        functionName: null,
        transactionHash: "SIMULATED_TX",
        blockNumber: (typeof blockRef === 'string' && blockRef.startsWith("0x")) ? web3.utils.hexToNumber(blockRef) : blockRef,
        contractAddress: txObject.to,
        sender: txObject.from,
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
        const { stream, requiredTime } = debugTraceCallErigonStreaming(rcpParams, networkData.web3Endpoint);

        storageVal = await getSimulatedTraceStorageFromErigon(
            stream, 
            networkData,
            transactionLog.functionName,
            mainContract,
            contractTree,
            web3
        );

        transactionLog.storageState = storageVal ? storageVal.decodedValues:[];
        transactionLog.internalTxs = storageVal ? storageVal.internalTxs:[];

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
        console.err("Errore durante il salvataggio del log: ", err);
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

async function getSimulatedTraceStorageFromErigon(httpStream, networkData, functionName, mainContract, contractTree, web3) {
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
    httpStream.pipe(parser);

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

        let internalStorage = contractTree && contractTree.storageLayoutFlag
            ? await optimizedDecodeValues(sstoreObject, contractTree.fullContractTree, mapForStorage["1"].finalShaTraces, mapForStorage["1"].functionStorage, functionName, mainContract, web3, contractTree.contractCompiled)
            : [];
        
        let internalTxs = [];
        if (internalCalls.length > 0) {
            internalTxs = await decodeSimulatedInternalTransaction(internalCalls, web3, networkData);
            assignStorageToTheInternal(internalTxs, mapForStorage);
            await decodeInteralTxsStorage(internalTxs, web3);
        }

        let result = {
            decodedValues: internalStorage,
            internalTxs: internalTxs
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
async function decodeSimulatedInternalTransaction(internalCalls, web3, networkData) {
    for (const element of internalCalls) {
        element.events = []; // Impostiamo a vuoto staticamente
        const addressTo = element.to;
        const query = { contractAddress: addressTo.toLowerCase() };
        
        const response = await searchAbi(query);
        
        if (!response) {
            // Usa le tue utility per scaricare l'ABI se non esiste
            await handleAbiFetch(element, addressTo, networkData.apiKey, networkData.endpoint, web3);
        } else {
            // Usa l'ABI locale per tradurre il payload
            await handleAbiFromDb(element, response, web3);
        }
    }
    return internalCalls;
}

// < -- FUNZIONI COPIATE DAL WORKER, ANDRANNO POI SPOSTATE IN UN FILE DI UTILS -- > 
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
            // Return the response stream directly
            resolve(res);
        });

        req.on('error', (err) => {
            reject(new Error(`Request failed: ${err.message}`));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.write(payload);
        req.end();
    });
}

function decodeInput(tx,contractTree) {
    if (tx.input == "0x") {
        tx.methodId = "Transfer";
    } else if (contractTree?.contractAbi && (typeof contractTree.contractAbi !== 'object' || Object.keys(contractTree.contractAbi).length > 0)) {
        decodeTransactionInputs(tx, contractTree.contractAbi);
    }
}

function regroupShatrace(finalShaTraces) {
    finalShaTraces=finalShaTraces.flat();
    return Array.from(
        new Map(finalShaTraces.map(item => [item.finalKey + item.hexStorageIndex, item])).values()
      );
}

function createShatrace(singleObject,sstoreBuffer,web3) {
    singleObject.finalShaTraces=singleObject.trackBuffer;

    for (let i = 0; i < singleObject.trackBuffer.length; i++) {
        if (singleObject.trackBuffer[i] && sstoreBuffer.includes(singleObject.trackBuffer[i].finalKey)) {
            const trace = {
                finalKey: singleObject.trackBuffer[i].finalKey,
                hexKey: singleObject.trackBuffer[i].hexKey,
                indexSum: singleObject.trackBuffer[i].indexSum,
                hexStorageIndex: singleObject.trackBuffer[i].hexStorageIndex
            };

            let flag = false;
            let test = i;

            while (flag === false) {
                if (!(web3.utils.hexToNumber("0x" + singleObject.trackBuffer[test].hexStorageIndex) < 300)) {
                    if (test > 0) {
                        test--;
                    } else {
                        flag = true;
                    }
                } else {
                    trace.hexStorageIndex = singleObject.trackBuffer[test].hexStorageIndex;
                    flag = true;
                    singleObject.finalShaTraces.push(trace);
                }
            }
            singleObject.finalShaTraces.push(trace);
            sstoreBuffer.splice(sstoreBuffer.indexOf(singleObject.trackBuffer[i].finalKey), 1);
        }
    }
    singleObject.finalShaTraces=regroupShatrace(singleObject.finalShaTraces)
    delete singleObject.trackBuffer;
} 

function assignStorageToTheInternal(internalTxs,mapForStorage,index=2) {
    for(let txs of internalTxs){
        txs.finalShaTraces=mapForStorage[index].finalShaTraces;
        txs.functionStorage=mapForStorage[index].functionStorage;
        index++;
        if(txs.calls && txs.calls.length>0){
            assignStorageToTheInternal(txs.calls,mapForStorage,index);
        }
    }
}

async function decodeInteralTxsStorage(internalTxs,web3){
    for(let txs of internalTxs){
        const query = { contractAddress: txs.to.toLowerCase() };
        let queryResult = await searchAbi(query);
        let contractTree = await getContractTree(null, txs.to, null, null, queryResult);
        let storageState = contractTree && contractTree.storageLayoutFlag 
                ? await optimizedDecodeValues(null, contractTree.fullContractTree, txs.finalShaTraces, txs.functionStorage, txs.activity, txs.contractCalledName, web3, contractTree.contractCompiled)
                : [];
        txs.storageState=storageState;
        if(txs.calls && txs.calls.length>0){
            await decodeInteralTxsStorage(txs.calls,web3)
        }
    }
}

module.exports={
    processSimulation
}
