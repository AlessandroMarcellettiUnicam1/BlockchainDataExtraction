const http = require("http");
const https = require("https");
const { searchAbi } = require("../../query/query");
const axios = require("axios");
const { getContractTree } = require("../contractUtils/utils");
const { default: Web3 } = require("web3");
const { decodeInputs, decodeTransactionInputs } = require("../decodingUtils/utils");
const { saveAbi } = require("../../databaseStore");

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
    let web3 = new Web3(networkData.web3endpoint);
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

        storageVal = await getSimulatedTaceStorageFromErigon(
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

async function getSimulatedTaceStorageFromErigon(httpStream, networkData, functionName, mainContract, contractTree, web3) {

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

// Modified to return stream instead of writing to file
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

function decodeInput(tx,contractTree){
    if (tx.input == "0x") {
        tx.methodId = "Transfer";
    } else if (contractTree?.contractAbi && (typeof contractTree.contractAbi !== 'object' || Object.keys(contractTree.contractAbi).length > 0)) {
        decodeTransactionInputs(tx, contractTree.contractAbi);
    }
}

module.exports={
    processSimulation
}
