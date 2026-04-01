const http = require("http");
const https = require("https");
const { searchAbi } = require("../../query/query");
const axios = require("axios");
const { getContractTree } = require("../contractUtils/utils");

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

async function createSimulatedTransactionLog(rcpparams, mainContract, contractTree, networkData)  {
    
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

module.exports={
    processSimulation
}
