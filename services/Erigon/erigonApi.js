
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

async function getTransactionReceipt(transactionHash,networkData){
    const body = {
    jsonrpc: "2.0",
    method: "eth_getTransactionReceipt",
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
 * Analizza il JSON delle trace e crea una mappa gerarchica
 * transazione padre -> tutte le sue chiamate interne
 */
async function buildTransactionHierarchy(contractAddressesFrom, contractAddressesTo, fromBlock, toBlock, networkData,timePerformance) {
    let traces;
    let currentFromBlock = fromBlock;
    const timeStartTraceFilter=Date.now();
    while(currentFromBlock <= toBlock){
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
            
            traces = response.data.result;
            // Find the block number of the last trace
            const lastTrace = traces[traces.length - 1];
            const lastBlockNumber = parseInt(lastTrace.blockNumber, 16);
            
            // If we've reached or passed the toBlock, we're done
            if (lastBlockNumber >= toBlock) {
                console.log(`Reached target block ${toBlock}. Ending stream.`);
                break;
            }
            
            // If we got fewer traces than expected, we're probably done
            if (traces.length < batchSize) {
                console.log(`Received ${traces.length} traces (less than batch size ${batchSize}). Ending stream.`);
                break;
            }
            
            // Move to the next block
            currentFromBlock = lastBlockNumber + 1;
        } catch(err){
            console.error("debugInteralTransaction error:", err.message);
            throw err;
        }
    }
    const timeEndTraceFilter=Date.now();
    timePerformance.time_traceFilter=timeEndTraceFilter-timeStartTraceFilter;
    const txMap = new Map();
    const timeStarteProcessBatch=Date.now();
    for (const trace of traces) {
        const txHash = trace.transactionHash;
        const publicTransaction = await getEventFromErigon(txHash, networkData);
        const timestamp = await getBlockFromErigon(trace.blockHash, networkData, true);
        let contractAddress=publicTransaction.to;
        if(!publicTransaction.to){
            let receipt=await getTransactionReceipt(txHash,networkData);
            contractAddress=receipt.contractAddress;
        }
        if (!txMap.has(txHash)) {
            txMap.set(txHash, {
                hash: txHash,
                from: publicTransaction.from,
                to: contractAddress ,
                value: publicTransaction.value,
                gasUsed: publicTransaction.gas,
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
    const timeEndProcessbatch=Date.now();
    timePerformance.time_processTraceBatch=timeEndProcessbatch-timeStarteProcessBatch;
    let txMapArr = Array.from(txMap.values());
    return txMapArr;
    
}

module.exports={
    assignEventToInternal,
    getEventFromErigon,
    debugTransactionErigonStreaming,
    buildTransactionHierarchy
}