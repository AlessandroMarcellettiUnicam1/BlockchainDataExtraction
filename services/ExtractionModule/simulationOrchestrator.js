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
const { addSystemLog, logStorage } = require("../simulationUtils/logger");



// BiIng seralization
BigInt.prototype.toJSON = function() {
    return this.toString();
};

async function processSimulation(params, targetAddress, networkData, hash = null) {
    const sessionLogs = [];

    return logStorage.run(sessionLogs, async () => { 
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
                networkData,
                hash
            );

            return {
                data: simulationResult,
                logs: sessionLogs
            };
        }
        catch (err) {
            addSystemLog(`[Errore di Sistema] Fallimento critico durante l'orchestrazione della simulazione: ${err.message}`, "error");
            err.logs = sessionLogs;
            throw err;
        }
    });
}

async function createSimulatedTransactionLog(rpcParams, mainContract, contractTree, networkData, hash = null)  {
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
        transactionHash: hash,
        blockNumber: resolvedBlockNumber,
        contractAddress: txObject.to ? txObject.to : "Contract Creation (Deployment)",
        sender: txObject.from ? txObject.from : "0x0000000000000000000000000000000000000000",
        gasUsed: 0,
        timestamp: new Date().toISOString(),
        inputs: txObject.inputDecoded ? decodeInputs(txObject.inputDecoded, web3) : [],
        value: txObject.value || "0x0",
        storageState: [],
        internalTxs: [],
        events: [],
        status: "Success"
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
        // const rawEventsList = storageVal ? storageVal.rawEvents : [];

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
            // ricerca approfondita del DELEGATECALL, che non cerca solo nel primo spazio
            const firstDelegateCall = transactionLog.internalTxs.find(tx => tx.type === "DELEGATECALL");

            if (firstDelegateCall) {
                const addressTo = firstDelegateCall.to;
                
                const query = { contractAddress: addressTo.toLowerCase() };
                const response = await searchAbi(query);

                if (response) {
                    storeAbi.proxy = '1';
                    storeAbi.proxyImplementation = query.contractAddress;
                    decodeTransactionInputs(txObject, response.abi, web3);

                    if (txObject.inputDecoded) {
                        transactionLog.functionName = txObject.inputDecoded.method;
                        transactionLog.inputs = decodeInputs(txObject.inputDecoded, web3);
                    }
                }
            }   
        }

        if (contractTree && storeAbi.proxyImplementation !== '') {
            await saveAbi(storeAbi);
        }

        if (storageVal && storageVal.status) {
            transactionLog.status = storageVal.status;
        } else {
            // Cerca errori nelle transazioni interne
            const findDeepError = (calls) => {
                if (!calls || calls.length === 0) return null;
                for (let call of calls) {
                    if (call.error) return call.error;
                    const deep = findDeepError(call.calls);
                    if (deep) return deep;
                }
                return null;
            };

            const deepErr = findDeepError(transactionLog.internalTxs);
            if (deepErr) {
                const errStr = deepErr.toLowerCase();
                if (errStr.includes("out of gas")) transactionLog.status = "Out of Gas";
                else if (errStr.includes("invalid opcode")) transactionLog.status = "Invalid Opcode";
                else if (errStr.includes("bad jump destination")) transactionLog.status = "Bad Jump Destination";
                else transactionLog.status = "Reverted";
            }
        }
    }
    catch (err) {
        addSystemLog(`[Errore di Sistema] Errore durante il salvataggio del log: ${err.message}`, 'error');
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
    let rawEvents = [];
    
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
            addSystemLog("[Parser] Avviso: Fallimento durante la formattazione dei dati sul gas consumato", 'error');
        }
    });

    gasParser.on("error", (err) => {
        addSystemLog(`[Parser] Errore di decodifica JSON dal flusso del nodo RPC: ${err.message}`, 'error');
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
            addSystemLog(`[Nodo RPC] Errore durante il parsing dello stream del log: ${error.message}`, 'error');
            reject(error);
        });
    });

    function processTrace(trace, nextTrace) {
        const currentIndex = getOrCreateIndexForDepth(trace.depth);

        // if (trace.op === "REVERT") {
        //     console.log("[EVM] Transazione interrotta (REVERT). Condizione logica non soddisfatta.");
        // }
        
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

        if (!mapForStorage["1"]) {
            addSystemLog("[Estrazione] Traccia EVM vuota. ", "warn");
            
            let finalStatus = "RPC Rejected"; // fallback di base
            let internalTxs = [];
            if (rpcParams) {
                try {
                    // chiamata per estrarre l'errore
                    const diagnosis = await decodeSimulatedInternalTransaction(rpcParams, null, networkData, web3);
                    internalTxs = diagnosis.calls || [];

                    if (diagnosis.isRpcError) {
                        finalStatus = "RPC Rejected";
                    } else if (diagnosis.isEvmError) {
                        const errStr = (diagnosis.errorMessage || "").toLowerCase();
                        if (errStr.includes("revert")) finalStatus = "Reverted";
                        else if (errStr.includes("out of gas")) finalStatus = "Out of Gas";
                        else if (errStr.includes("invalid opcode")) finalStatus = "Invalid Opcode";
                        else if (errStr.includes("bad jump destination")) finalStatus = "Bad Jump Destination";
                        else finalStatus = "Reverted"; // revert generico
                    } else {
                        finalStatus = "Success"; // Nessun errore, es. trasferimento ETH base
                    }
                } 
                catch (e) {
                    addSystemLog(`[Estrazione] Impossibile recuperare i dettagli del Revert: ${e.message}`, "warn");
                }
            }

            return {
                decodedValues: [],
                internalTxs: internalTxs,
                gasUsed: capturedGas,
                status: finalStatus
            };
        }

        finalShaTraces = trackBuffer;
        addSystemLog(`[Estrazione] Individuate ${sstoreBuffer.length} istruzioni di scrittura (SSTORE)`);

        for (let i = 0; i < trackBuffer.length; i++) {
            // controllo di sicurezza
            if (!trackBuffer[i] || !trackBuffer[i].finalKey) continue;

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
                    // se entriamo in una casella vuota, vai alla precedente
                    if (!trackBuffer[test] || !trackBuffer[test].hexStorageIndex) {
                        if (test > 0) {
                            test--;
                            continue; // salta il resto e ricomincia
                        } else {
                            flag = true;
                            continue;
                        }
                    }

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
                // controllo per non pushare due volte la stessa traccia
                if (!finalShaTraces.find(t => t.finalKey === trace.finalKey)) {
                     finalShaTraces.push(trace);
                }
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

        let internalStorage = [];
        if (contractTree && contractTree.storageLayoutFlag) {
            // caso 1 con decodifica avanzata
            internalStorage = await optimizedDecodeValues(sstoreObject, contractTree.fullContractTree, rootShaTraces, rootFunctionStorage, functionName, mainContract, web3, contractTree.contractCompiled);
        } 
        else if (rootShaTraces && rootShaTraces.length > 0) {
            // caso 2 con il fallback in cui è fallita la compilazione, cattura delle modifiche grezze
            addSystemLog(`[Avviso] Storage Layout non disponibile. Generazione Raw Storage fallback.`);
    
            internalStorage = rootShaTraces.map(trace => {
                let decSlot = "Unknown";
                
                if (trace && trace.hexStorageIndex && trace.hexStorageIndex !== "undefined") {
                    try {
                        decSlot = web3.utils.hexToNumberString("0x" + trace.hexStorageIndex);
                    } catch (e) {
                        // Salta silenziosamente l'errore di validazione per questo singolo slot
                    }
                }
                
                const finalKey = trace?.finalKey || "0";
        
                return {
                    variableName: `Raw_Slot_[${decSlot}]`,
                    variableRawValue: "0x" + finalKey,
                    variableValue: "0x" + finalKey,
                    slot: trace?.hexStorageIndex || "Unknown"
                };
            });
        }
        
        let internalTxs = [];
        // let rootStatusOverride = undefined; // variabile per salvare l'errore
        // if (rpcParams) {
        //     const diagnosis = await decodeSimulatedInternalTransaction(rpcParams, null, networkData, web3);
            
        //     internalTxs = diagnosis.calls || []; 

        //     // controllo se la transazione radice ha fatto revert a metà
        //     if (diagnosis.isEvmError) {
        //         const errStr = (diagnosis.errorMessage || "").toLowerCase();
        //         if (errStr.includes("out of gas")) rootStatusOverride = "Out of Gas";
        //         else if (errStr.includes("invalid opcode")) rootStatusOverride = "Invalid Opcode";
        //         else if (errStr.includes("bad jump destination")) rootStatusOverride = "Bad Jump Destination";
        //         else rootStatusOverride = "Reverted";
        //     }

        //     if (internalTxs && internalTxs.length > 0) {
        //         assignStorageToTheInternal(internalTxs, mapForStorage);
        //         await decodeInteralTxsStorage(internalTxs, web3, networkData); 
        //     }
        // }

        let result = {
            decodedValues: internalStorage,
            internalTxs: internalTxs,
            gasUsed: capturedGas
        };

        // if (rootStatusOverride) {
        //     result.status = rootStatusOverride;
        // }
        
        sstoreObject = null;
        return result;
    }
    catch (err) {
        addSystemLog(`[Estrazione] Errore durante la ricostruzione dei layout di memoria: ${err.message}`, 'error');
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
    const diagnosis = await debugTraceCallInternal(params, networkData.web3Endpoint);

    const internalCalls = diagnosis.calls || [];

    if (!smartContract && internalCalls) {
        let seenEvent = new Set();
        await connectDB(networkData.networkName);
        await decodeInternalRecursive(internalCalls, smartContract, networkData, web3, 0, "0", null, null, seenEvent, true);
    } else {
        addSystemLog("[Analisi] Esecuzione isolata. Interazione interna omessa o contratto pre-caricato.");
    }

    return diagnosis;
}

async function debugTraceCallInternal(params, web3Endpoint) {
    try {
        const payload = {
            jsonrpc: "2.0",
            method: "debug_traceCall",
            params: [
                params[0],
                params[1], 
                { tracer: "callTracer" } // tracer forzato
            ],
            id: 1
        };
            
        const response = await axios.post(web3Endpoint, payload, {
            headers: { "Content-Type": "application/json" }
        });

        let diagnosis = {
            isRpcError: false,
            isEvmError: false,
            errorMessage: null,
            calls: []
        }

        if (response.data.error) {
            diagnosis.isRpcError = true;
            diagnosis.errorMessage = response.data.error.message;
            addSystemLog(`[Nodo RPC] Rifiuto: ${response.data.error.message}`, 'error');
        } else if (response.data.result) {
            if (response.data.result.error) {
                diagnosis.isEvmError = true;
                diagnosis.errorMessage = response.data.result.revertReason || response.data.result.error;
                addSystemLog(`[EVM] Errore: ${diagnosis.errorMessage}`, 'warn');
            }
            diagnosis.calls = response.data.result.calls || [];
        }
            
        return diagnosis;
    } 
    catch (err) {
        addSystemLog(`[Nodo RPC] Fallimento dell'API debug_traceCall: ${err.message}`, 'error');
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
        let contractTree = await getContractTree(null, txs.to, networkData.endpoint, networkData.apiKey, queryResult);        
        let storageState = contractTree && contractTree.storageLayoutFlag 
                ? await optimizedDecodeValues(null, contractTree.fullContractTree, txs.finalShaTraces, txs.functionStorage, txs.activity, txs.contractCalledName, web3, contractTree.contractCompiled)
                : [];
        txs.storageState=storageState;
        if(txs.calls && txs.calls.length>0){
            await decodeInteralTxsStorage(txs.calls,web3, networkData);
        }
    }
}

async function mockProcessSimulation(params, targetAddress, networkData, hash = null) {
    const sessionLogs = [];
    
    try {
        const txObject = params[0];
        txObject.input = txObject.data || txObject.input;
        const blockRef = params[1];
        let web3 = new Web3(networkData.web3Endpoint);
        
        let queryResult;
        let contractTree = null;

        if (targetAddress && targetAddress !== "0x" && targetAddress !== "") {
            const query = { contractAddress: targetAddress.toLowerCase() };
            queryResult = await searchAbi(query);
            
            if (queryResult && !queryResult?.abi?.includes("Contract source code not verified")) {
                contractTree = await getContractTree(
                    null,
                    targetAddress,
                    networkData.endpoint,
                    networkData.apiKey,
                    queryResult
                );
            }
        }

        decodeInput(txObject, contractTree);

        let resolvedBlockNumber = 0;
        if (typeof blockRef === 'number') {
            resolvedBlockNumber = blockRef;
        } else if (typeof blockRef === 'string') {
            resolvedBlockNumber = blockRef.startsWith("0x") ? web3.utils.hexToNumber(blockRef) : parseInt(blockRef) || 0;
        }

        const transactionLog = {
            functionName: txObject.inputDecoded ? txObject.inputDecoded.method : null,
            transactionHash: hash || txObject.hash,
            blockNumber: resolvedBlockNumber,
            contractAddress: txObject.to ? txObject.to : "Contract Creation (Deployment)",
            sender: txObject.from ? txObject.from : "0x0000000000000000000000000000000000000000",
            gasUsed: 0, 
            timestamp: new Date().toISOString(),
            inputs: txObject.inputDecoded ? decodeInputs(txObject.inputDecoded, web3) : [],
            value: txObject.value || "0x0",
            storageState: [],
            internalTxs: [],
            events: [],
            status: "Mock"
        };

        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 9000) + 1000));

        return {
            data: transactionLog,
            logs: sessionLogs
        };
        
    } catch (err) {
        console.error(`[Mock Simulation] Errore durante il processo mock: ${err.message}`);
        
        return {
            data: {
                functionName: null,
                transactionHash: hash,
                blockNumber: 0,
                contractAddress: targetAddress,
                sender: params[0]?.from || "Unknown",
                gasUsed: 0,
                timestamp: new Date().toISOString(),
                inputs: [],
                value: params[0]?.value || "0x0",
                storageState: [],
                internalTxs: [],
                events: [],
                status: "System error"
            },
            logs: sessionLogs
        };
    }
}

async function mockExtraction(blockNumber, contract) {
    // Liste di dati fittizi per la randomizzazione
    const functionNames = ["transfer", "approve", "swap", "deposit", "withdraw", "mint", "burn"];
    const ethValues = ["0x0", "0x0", "0x0", "0x0", "0x38d7ea4c68000", "0xde0b6b3a7640000", "0x1bc16d674ec80000"]; // 0x0 prevalente
    
    // Helper per la randomizzazione
    const getRandomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const getRandomHex = (size) => [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    const generateRandomAddress = () => "0x" + getRandomHex(40);
    const generateRandomHash = () => "0x" + getRandomHex(64);
    const getRandomGas = () => Math.floor(Math.random() * (500000 - 21000 + 1)) + 21000;

    // Genero un numero casuale di transazioni per questo blocco (da 1 a 5)
    const txCount = Math.floor(Math.random() * 5) + 1;
    const mockLogs = [];

    for (let i = 0; i < txCount; i++) {
        const funcName = getRandomItem(functionNames);
        
        // Generazione input dinamici base per rendere il log XES più realistico
        let mockInputs = [];
        if (funcName === "transfer" || funcName === "approve") {
            mockInputs = [
                { inputName: "_to", type: "address", inputValue: generateRandomAddress() },
                { inputName: "_value", type: "uint256", inputValue: (Math.floor(Math.random() * 10000) * 1e18).toString() }
            ];
        }

        const transactionLog = {
            functionName: funcName,
            transactionHash: generateRandomHash(),
            blockNumber: parseInt(blockNumber),
            contractAddress: contract.toLowerCase(), // Il contratto monitorato è sempre il target (To)
            sender: generateRandomAddress(),         // Indirizzo generato casualmente (From)
            gasUsed: getRandomGas(),
            timestamp: new Date().toISOString(),
            inputs: mockInputs,
            value: getRandomItem(ethValues),
            
            // Campi pesanti lasciati vuoti per la simulazione rapida
            storageState: [], 
            internalTxs: [],  
            events: [],
            
            status: "Success"
        };

        mockLogs.push(transactionLog);
    }

    // Ritardo artificiale casuale tra 5000ms (5s) e 15000ms (15s)
    await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 10000) + 5000));

    return mockLogs;
}

module.exports = { mockExtraction };

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
    processSimulation,
    mockProcessSimulation,
    makeRpcCallStreaming,
    mockExtraction
}