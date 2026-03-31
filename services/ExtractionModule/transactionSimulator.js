const https = require('https');
const http = require('http');
const JSONStream = require('JSONStream');
const { optimizedDecodeValues } = require('../optimizedDecodeValues');

function debugTraceCall(params, url) {
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

async function processSimulationStream(httpStream, web3,mainContract, contractTree, functionName) {
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

    // Parse the stream directly - no file I/O!
    const parser = JSONStream.parse("result.structLogs.*");
    httpStream.pipe(parser);

    let previousTrace = null;

    // Helper function to get or create index for a depth
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
        } 
        else if (trace.op === "STOP" || trace.op === "RETURN") {
            for (const slot in trace.storage) {
                mapForStorage[currentIndex].functionStorage[slot] = trace.storage[slot];
            }
            depthToIndexMap.delete(trace.depth);
        } 
        else if (trace.pc === (bufferPC + 1)) {
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
        }
        else if (trace.op === "SSTORE") {
            sstoreOptimization.push(trace.stack);
            sstoreBuffer.push(trace.stack[trace.stack.length - 1]);
            
            for (const slot in trace.storage) {
                mapForStorage[currentIndex].functionStorage[slot] = trace.storage[slot];
            }
        }
        else if (trace.op === "CALL" || trace.op === "DELEGATECALL" || trace.op === "STATICCALL") {
            const offsetBytes = trace.stack[trace.op === "CALL" ? trace.stack.length - 4 : trace.stack.length - 3];
            const lengthBytes = trace.stack[trace.op === "CALL" ? trace.stack.length - 5 : trace.stack.length - 4];
            
            // Costruzione stringa di profondità
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
            call.inputsCall = "0x" + stringMemory; // Aggiunto 0x per facilitare la decodifica successiva
            internalCalls.push(call);
        }
        else if (trace.op === "SLOAD") {
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
                        if (test > 0) test--;
                        else flag = true;
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
        
        let internalStorage = [];
        if (contractTree && contractTree.storageLayoutFlag) {
            internalStorage = await optimizedDecodeValues(
                sstoreObject, 
                contractTree.fullContractTree, 
                mapForStorage["1"].finalShaTraces, 
                mapForStorage["1"].functionStorage, 
                functionName, 
                mainContract, 
                web3, 
                contractTree.contractCompiled
            );
        }

        // Restituisce i dati grezzi necessari al passaggio successivo
        return {
            decodedStorage: internalStorage,
            rawInternalCalls: internalCalls,
            mapForStorage: mapForStorage
        };
    } 
    catch (err) {
        console.error("Storage processing error:", err);
        throw err;
    } 
}

function createShatrace(singleObject, sstoreBuffer, web3) {
    singleObject.finalShaTraces = singleObject.trackBuffer;
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
                    if (test > 0) test--;
                    else flag = true;
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
    singleObject.finalShaTraces = regroupShatrace(singleObject.finalShaTraces);
    delete singleObject.trackBuffer;
}

function regroupShatrace(finalShaTraces) {
    finalShaTraces = finalShaTraces.flat();
    return Array.from(
        new Map(finalShaTraces.map(item => [item.finalKey + item.hexStorageIndex, item])).values()
    );
}

module.exports = {
    debugTraceCall,
    makeRpcCallStreaming
};