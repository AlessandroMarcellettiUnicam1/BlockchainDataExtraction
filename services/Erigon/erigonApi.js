
const {newDecodedInternalTransaction,decodeInternalTransaction}=require("../decodeInternalTransaction")
const {getEventsFromInternal}=require("../decodingUtils/utils")
const {optimizedDecodeValues}=require("../optimizedDecodeValues")
const JSONStream = require("JSONStream");
const axios = require("axios");

/**
 * Function used to get all the logs from a specific transaction
 * @param {*} transactionHash 
 * @param {*} networkData 
 * @returns 
 */
async function getEventFromErigon(transactionHash,networkData){
    const body = {
    jsonrpc: "2.0",
    method: "eth_getTransactionByHash",
    params: [transactionHash],
    id: 1
  };
  try {
    const response = await fetch(networkData.web3Endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    return data.result; 
  } catch (err) {
    console.error("Error fetching transaction receipt:", err);
    throw err;
  }
}

/**
 * Function used to get all the logs from a specific transaction
 * @param {*} transactionHash 
 * @param {*} networkData 
 * @returns 
 */
async function getBlockFromErigon(transactionHash,networkData,fullTrace){
    const body = {
    jsonrpc: "2.0",
    method: "eth_getBlockByHash",
    params: [transactionHash,fullTrace],
    id: 1
  };
  try {
    const response = await fetch(networkData.web3Endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    return data.result; 
  } catch (err) {
    console.error("Error fetching transaction receipt:", err);
    throw err;
  }
}

/**
 * Function used to get the list of evend emmite by the internal transaction specific for the internal extracted with erigon
 * @param {*} transactionHash 
 * @param {*} block 
 * @param {*} internalTxs 
 * @param {*} networkData 
 * @param {*} web3 
 * @param {*} resultEvents 
 */
async function assignEventToInternal(transactionHash, block, internalTxs, networkData, web3, resultEvents) {
    for (const transaction of internalTxs) {
        let eventFromInternalContract = await getEventsFromInternal(transactionHash, block, transaction.to, networkData, web3);
        if (eventFromInternalContract.length == 0) {
            eventFromInternalContract = await getEventsFromInternal(transactionHash, block, transaction.from, networkData, web3);
        }
        eventFromInternalContract.forEach((event)=>{
            resultEvents.push(event)
        })
        if (transaction.calls) {
            await assignEventToInternal(transactionHash, block, transaction.calls, networkData, web3, resultEvents);
        }
    }
}

/**
 * 
 * @param {*} transactionHash 
 * @param {*} erigonUrl 
 * @returns 
 */
function debugTransactionErigonStreaming(transactionHash,erigonUrl ) {
    return new Promise((resolve, reject) => {
        const start = new Date();
        
        makeRpcCallStreaming(erigonUrl, 'debug_traceTransaction', [transactionHash])
            .then(stream => {
                const end = new Date();
                const requiredTime = parseFloat(((end - start) / 1000).toFixed(2));
                resolve({ requiredTime, stream });
            })
            .catch(reject);
    });
}

/**
 * Function to get the trace using Erigon node
 * @param {*} url 
 * @param {*} method 
 * @param {*} params 
 * @returns 
 */
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

/**
 * Function that use the stream data reader to process the traces
 * @param {*} httpStream 
 * @param {*} networkData 
 * @param {*} functionName 
 * @param {*} transactionHash 
 * @param {*} mainContract 
 * @param {*} contractTree 
 * @param {*} smartContract 
 * @param {*} extractionOption 
 * @param {*} web3 
 * @returns 
 */
async function getTraceStorageFromErigon(httpStream, networkData,functionName,transactionHash,mainContract,contractTree,smartContract,extractionOption,web3) {
    let functionStorage = {};
    let index = 0;
    let trackBuffer = [];
    let bufferPC = -10;
    let sstoreBuffer = [];
    let sstoreOptimization = [];
    let internalCalls = [];
    let keccakBeforeAdd = {};
    let finalShaTraces = [];
    // Parse the stream directly - no file I/O!
    const parser = JSONStream.parse("result.structLogs.*");
    httpStream.pipe(parser);
    
    let previousTrace = null;

    await new Promise((resolve, reject) => {
        parser.on("data", (trace) => {
            // Normalize stack first
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
        if (trace.op === "KECCAK256") {
            bufferPC = trace.pc;
            const stackLength = trace.stack.length;
            const memoryLocation = trace.stack[stackLength - 1];
            let numberLocation = web3.utils.hexToNumber("0x" + memoryLocation) / 32;
            let storageIndexLocation = numberLocation + 1;
            const hexKey = trace.memory[numberLocation];
            const hexStorageIndex = trace.memory[storageIndexLocation];
            trackBuffer[index] = { hexKey, hexStorageIndex };
            
        } else if (trace.op === "STOP") {
            for (const slot in trace.storage) {
                functionStorage[slot] = trace.storage[slot];
            }
            
        } else if (trace.pc === (bufferPC + 1)) {
            keccakBeforeAdd = trackBuffer[index];
            bufferPC = -10;
            trackBuffer[index].finalKey = trace.stack[trace.stack.length - 1];
            keccakBeforeAdd = trackBuffer[index];
            index++;
            
            if (trace.op === "ADD" && 
                (trace.stack[trace.stack.length - 1] === keccakBeforeAdd.finalKey ||
                 trace.stack[trace.stack.length - 2] === keccakBeforeAdd.finalKey) &&
                keccakBeforeAdd.hexStorageIndex === "0000000000000000000000000000000000000000000000000000000000000000") {
                
                const keyBuff = trackBuffer[index - 1].hexKey;
                const slotBuff = trackBuffer[index - 1].hexStorageIndex;
                trackBuffer[index - 1].hexKey = slotBuff;
                trackBuffer[index - 1].hexStorageIndex = keyBuff;
                
                if (nextTrace && nextTrace.stack && nextTrace.stack.length > 0) {
                    trackBuffer[index - 1].finalKey = nextTrace.stack[nextTrace.stack.length - 1];
                }
                trackBuffer[index - 1].indexSum = trace.stack[trace.stack.length - 2];
            }
            
        } else if (trace.op === "SSTORE") {
            sstoreOptimization.push(trace.stack);
            sstoreBuffer.push(trace.stack[trace.stack.length - 1]);
            //I'm interested in the main contract storage so the depth is 1
            if(trace.depth==1){
                for(const slot in trace.storage){
                    functionStorage[slot]=trace.storage[slot]
                }
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
            let stringMemory = trace.memory.join("");
            stringMemory = stringMemory.slice(
                web3.utils.hexToNumber("0x" + offsetBytes) * 2,
                web3.utils.hexToNumber("0x" + offsetBytes) * 2 + web3.utils.hexToNumber("0x" + lengthBytes) * 2
            );
            call.inputsCall = stringMemory;
            internalCalls.push(call);
        }else if(trace.op=="SLOAD"){
            if(trace.depth==1){
                for(const slot in trace.storage){
                    functionStorage[slot]=trace.storage[slot]
                }
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

        let sstoreObject = { sstoreOptimization, sstoreBuffer };
        finalShaTraces = regroupShatrace(finalShaTraces);
        let internalStorage = [];
        
        if (extractionOption.internalStorage != 0) {
            internalStorage = contractTree && contractTree.storageLayoutFlag 
                ? await optimizedDecodeValues(sstoreObject, contractTree.fullContractTree, finalShaTraces, functionStorage, functionName, mainContract, web3, contractTree.contractCompiled)
                : [];
        }
        
        let internalTxs = [];
        if (extractionOption.internalTransaction == 0) {
            internalTxs = await decodeInternalTransaction(internalCalls, smartContract, web3, networkData);
        } else if (extractionOption.internalTransaction == 1) {
            internalTxs = await newDecodedInternalTransaction(transactionHash, smartContract, networkData, web3);
        }
        
        let result = {
            decodedValues: internalStorage,
            internalTxs: internalTxs
        };
        sstoreObject = null;
        return result;
        
    } catch (err) {
        console.log("errore ", err);
        throw err;
        
    } finally {
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
function regroupShatrace(finalShaTraces){
    return Array.from(
        new Map(finalShaTraces.map(item => [item.finalKey + item.hexStorageIndex, item])).values()
      );
}

/**
 * Analizza il JSON delle trace e crea una mappa gerarchica
 * transazione padre -> tutte le sue chiamate interne
 */
async function buildTransactionHierarchy(contractAddressesFrom, contractAddressesTo, fromBlock, toBlock, networkData) {
    let traces;
    try{
        const rpcUrl = networkData.web3Endpoint;
        const payload = {
            jsonrpc: "2.0",
            method: "trace_filter",
            params: [{
                fromBlock: "0x" + parseInt(fromBlock).toString(16),
                toBlock: "0x" + parseInt(toBlock).toString(16),
                fromAddress: contractAddressesFrom,
                toAddress: contractAddressesTo
            }
            ],
            after: 1000,
            count: 100,
            id: 1
        };
         const response = await axios.post(rpcUrl, payload, {
            headers: { "Content-Type": "application/json" }
        });
        console.log(response.data);
        traces = response.data.result;
    } catch(err){
        console.error("debugInteralTransaction error:", err.message);
        throw err;
    }
    const txMap = new Map();
    
    for (const trace of traces) {
        const txHash = trace.transactionHash;
        const publicTransaction = await getEventFromErigon(txHash, networkData);
        const timestamp = await getBlockFromErigon(txHash, networkData, true);

        if (!txMap.has(txHash)) {
            txMap.set(txHash, {
                hash: txHash,
                from: publicTransaction.from,
                to: publicTransaction.to,
                value: publicTransaction.value,
                gasUsed: publicTransaction.gasUsed,
                input: publicTransaction.input,
                blockNumber: publicTransaction.blockNumber,
                timestamp: timestamp.timestamp
            });
        }

        // const txData = txMap.get(txHash);
        // const isMainCall = !trace.traceAddress || trace.traceAddress.length === 0;

       /* if (isMainCall) {
            txData.parentCall = {
                from: trace.action?.from,
                to: trace.action?.to,
                value: trace.action?.value,
                gas: trace.action?.gas,
                input: trace.action?.input,
                callType: trace.action?.callType || trace.type,
                gasUsed: trace.result?.gasUsed,
                output: trace.result?.output
            };
        } else {
            txData.internalCalls.push({
                from: trace.action?.from,
                to: trace.action?.to,
                value: trace.action?.value,
                gas: trace.action?.gas,
                input: trace.action?.input,
                callType: trace.action?.callType || trace.type,
                traceAddress: trace.traceAddress,
                depth: trace.traceAddress.length,
                gasUsed: trace.result?.gasUsed,
                output: trace.result?.output,
                subtraces: trace.subtraces
            });
        }*/
    }

    let txMapArr = Array.from(txMap.values());
    console.log(txMapArr);
    return txMapArr;
    
}

module.exports={
    assignEventToInternal,
    getEventFromErigon,
    debugTransactionErigonStreaming,
    getTraceStorageFromErigon,
    buildTransactionHierarchy
}