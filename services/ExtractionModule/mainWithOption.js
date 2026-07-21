const {Web3} = require('web3');

const fs = require('fs');
const axios = require("axios");
let contractAbi = {};
const { getCompiledData, getContractCodeEtherscan } = require ('../contractUtils/utils')
const hre = require("hardhat");

const {searchTransaction,searchAbi}= require("../../query/query")
const { saveExtractionLog} = require("../../databaseStore");
const {connectDB} = require("../../config/db");
const mongoose = require("mongoose");
require('dotenv').config();
const v8 = require('v8');
const path = require('path');
const { fork } = require("child_process");

const {ethers} = require("hardhat");
const {buildTransactionHierarchy} = require("../Erigon/erigonApi");
const { convertProcessSignalToExitCode } = require('util');
const { saveExtractionMetrics, saveCompiledContractData } = require('../../databaseStore');

/**
 * Method called by the server to extract the transactions
 *
 * @param mainContract - contract name
 * @param contractAddress - the contract address to be analyzed
 * @param fromBlock - the starting block number
 * @param toBlock - the ending block number
 * @param network - the network where the contract is deployed
 * @param filters - the filters to be applied to the transactions
 * @param smartContract - the smart contract uploaded file
 * @param option - is a object that contains different field to allow different type of extraction
 * @returns {Promise<*|*[]>} - the blockchain log with the extracted data
 */

async function getAllTransactions(oldParams, newParams, returnInMemory = false) {
    const network = (oldParams ? oldParams.network : null) || (newParams ? newParams.network : null);
    let networkData={
        web3Endpoint:"",
        apiKey:"",
        endpoint:"",
        networkName:network
    };
    try{
        switch (network) {
        case "Mainnet":
                networkData.web3Endpoint = process.env.WEB3_ALCHEMY_MAINNET_URL
                networkData.apiKey = process.env.API_KEY_ETHERSCAN
                networkData.endpoint = process.env.ETHERSCAN_MAINNET_ENDPOINT
            break
        case "Sepolia":
            networkData.web3Endpoint = process.env.WEB3_ALCHEMY_SEPOLIA_URL
            networkData.apiKey = process.env.API_KEY_ETHERSCAN
            networkData.endpoint = process.env.ETHERSCAN_SEPOLIA_ENDPOINT
            break
        case "Polygon":
            networkData.web3Endpoint = process.env.WEB3_ALCHEMY_POLYGON_URL
            networkData.apiKey = process.env.API_KEY_POLYGONSCAN
            networkData.endpoint = process.env.POLYGONSCAN_MAINNET_ENDPOINT
            break
        case "Amoy":
            networkData.web3Endpoint = process.env.WEB3_ALCHEMY_AMOY_URL
            networkData.apiKey = process.env.API_KEY_POLYGONSCAN
            networkData.endpoint = process.env.POLYGONSCAN_TESTNET_ENDPOINT
            break
        default:

        }

        if (!networkData.web3Endpoint || !networkData.apiKey) {
            throw new Error(`Variabili d'ambiente mancanti per il network ${network}. Controlla il file .env e i percorsi di dotenv.`);
        }
        //contractAddress = proxy address in which storage and txs are made
        //mainContract = implementationContract name
       /* const userLog = {
            networkUsed: networkData.networkName,
            proxyContract: contractAddress,
            implementationContract: impl_contract,
            contractName: mainContract,
            fromBlock,
            toBlock,
            filters: {
                ...Object.keys(filters).reduce((obj, key) => {
                    obj[key] = filters[key]
                    return obj
                }, {})
            },
            timestampLog: new Date().toISOString()
        }
        
        
        await saveExtractionLog(userLog,networkData.networkName)*/
        let contractTree;
        let memoryLogs = [];

        await connectDB(networkData.networkName);
        if(!oldParams && newParams){
                console.log(`[${new Date().toISOString()}] Costruisco TransactionHierarchy`);
                const txHierarchy = await buildTransactionHierarchy(newParams.contractAddressesFrom, newParams.contractAddressesTo, newParams.fromBlock, newParams.toBlock, networkData);
                console.log(`[${new Date().toISOString()}] TransactionHierarchy Costruita`);
                for(let tx of txHierarchy){
                    try {
                        const targetAbiAddress = newParams.implementationContractAddress ? 
                                                 newParams.implementationContractAddress.toLowerCase() : 
                                                 tx.to.toLowerCase();
                        const query = { contractAddress: targetAbiAddress };
                        let queryResult = await searchAbi(query);
                        if (!queryResult || queryResult?.abi?.includes("Contract source code not verified")) {
                            const anotherCallForAbi = await axios.get(
                                `${networkData.endpoint}&module=contract&action=getsourcecode&address=${targetAbiAddress}&apikey=${networkData.apiKey}`
                            );
                            queryResult = {
                                contractName: anotherCallForAbi.data.result[0].ContractName,
                                abi: anotherCallForAbi.data.result[0].ABI,
                                proxy: anotherCallForAbi.data.result[0].Proxy,
                                proxyImplementation: '',
                                sourceCode: anotherCallForAbi.data.result[0].SourceCode,
                                contractAddress: targetAbiAddress,
                                compilerVersion: anotherCallForAbi.data.result[0].CompilerVersion,

                            }
                        } else {
                            console.log("contract found in the db");
                        }
                        const singleTxPerformance = {};
                        contractTree = await getContractTree(null, targetAbiAddress, networkData.endpoint, networkData.apiKey, queryResult, singleTxPerformance);
                        let temp = [tx];
                        let storageData = await getStorageData(temp, queryResult.contractName, contractTree, tx.to, newParams.filters, newParams.smartContract, newParams.option, networkData, newParams.contractAddressesTo, returnInMemory, singleTxPerformance);

                        if (returnInMemory && storageData) memoryLogs = memoryLogs.concat(storageData);
                    }
                    catch (innerError) {
                    // Se l'errore è "No contract found", viene catturato qui!
                    // Stampiamo un avviso giallo, ma il programma NON crasha.
                    console.warn(`[Warning] Impossibile estrarre la TX ${tx.hash}: ${innerError.message}. Passo alla successiva.`);
                    
                    continue; 
                }
            }
        } else {
            const query = { contractAddress: oldParams.implementationContractAddress.toLowerCase() };
            let queryResult = await searchAbi(query);
            const singleTxPerformance = {};
            contractTree = await getContractTree(oldParams.smartContract, oldParams.implementationContractAddress, networkData.endpoint, networkData.apiKey, queryResult, singleTxPerformance);
            const transactionList = await getTransactionFromContract(networkData, oldParams.contractAddress, oldParams.fromBlock, oldParams.toBlock);
            
            let storageData = await getStorageData(transactionList, oldParams.contractName, contractTree, oldParams.contractAddress, oldParams.filters, oldParams.smartContract, oldParams.option, networkData,null, returnInMemory, singleTxPerformance);
            
            if (storageData && storageData.length > 0) {
                memoryLogs = storageData;
            }
        }
                
        console.log("Extraction finished");
        return returnInMemory ? memoryLogs : [];
       
        // await removeCollectionFromDB(networkName).then(removeAddressCollection(contractAddress,process.env.LOG_DB_NAME));
        // return result;
        //changed contratAddress to impl since it contains the storage to evaluate
        // return await getStorageData(contractTransactions, mainContract, contractTree, impl_contract, filters,smartContract);
        // let csvRow = []
        // csvRow.push({
        //     transactionHash: null,
        //     debugTime: null,
        //     decodeTime: null,
        //     totalTime: parseFloat((traceTime + decodeTime).toFixed(2))
        // })
        // stringify(csvRow, (err, output) => {
        //     fs.appendFileSync('csvLogs.csv', output)
        // })
    } catch (err) {
        console.error(err)
        throw err;
    }finally{
        await cleanupResources();
    }
}

/**
 * 
 * @param {*} smartContract 
 * @param {*} impl_contract 
 * @param {*} endpoint 
 * @param {*} apiKey 
 * @param {*} mainContract 
 * @returns 
 */
async function getContractTree(smartContract,impl_contract,endpoint,apiKey,queryResult, singleTxPerformance = {}){

    const tStartTotal = performance.now();
    let contractsResult = null
    // if the contract is uploaded by the user then the contract is compiled
    let contractTree = null;
    if (smartContract) {
        contractsResult = smartContract
    } else {
        //implementation contract address
        try {   
                if (queryResult?.fullContractTree && queryResult?.contractCompiled) {
                    contractTree = {
                        fullContractTree: queryResult.fullContractTree,
                        storageLayoutFlag: queryResult.storageLayoutFlag,
                        contractCompiled: queryResult.contractCompiled,
                        contractAbi: queryResult.abi,
                        sourceCode: queryResult.sourceCode,
                        proxy: queryResult.proxy,
                        contractName: queryResult.contractName,
                        proxyImplementation: queryResult.proxyImplementation || '',
                        compilerVersion: queryResult.compilerVersion
                    };
                    singleTxPerformance.time_getContractCodeEtherscan = 0;
                    singleTxPerformance.time_getCompiledData = 0;
                    const tEndTotalCached = performance.now() - tStartTotal;
                    singleTxPerformance.time_getContractTreeTotal = parseFloat(tEndTotalCached.toFixed(3));
                    return contractTree;
                }

                console.log(`[${new Date().toISOString()}, DEBUG-CONTRACT TREE] Inizio recupero ContractCode`);

                const tStartEtherscan = performance.now();
                contractsResult = await getContractCodeEtherscan(impl_contract, endpoint, apiKey,queryResult);
                const tEndEtherscan = performance.now() - tStartEtherscan;
                singleTxPerformance.time_getContractCodeEtherscan = parseFloat(tEndEtherscan.toFixed(3));

                if (!contractsResult) {
                    console.warn(`[${new Date().toISOString()}, DEBUG-CONTRACT TREE] ContractCode non recuperato, uso fallback grezzo`, {
                        impl_contract,
                        hasQueryResult: !!queryResult,
                        queryResultContractAddress: queryResult?.contractAddress,
                        queryResultContractName: queryResult?.contractName,
                        queryResultAbiPreview: typeof queryResult?.abi === 'string' ? queryResult.abi.slice(0, 80) : typeof queryResult?.abi,
                        endpointDefined: !!endpoint,
                        apiKeyDefined: !!apiKey
                    });
                    contractTree = {
                        fullContractTree: null,
                        storageLayoutFlag: false,
                        contractCompiled: null,
                        contractAbi: queryResult?.abi && !queryResult.abi.includes("Contract source code not verified") ? queryResult.abi : "[]",
                        sourceCode: queryResult?.sourceCode || '',
                        proxy: queryResult?.proxy || '',
                        contractName: queryResult?.contractName || '',
                        proxyImplementation: queryResult?.proxyImplementation || '',
                        compilerVersion: queryResult?.compilerVersion || ''
                    };
                    const tEndTotalFallback = performance.now() - tStartTotal;
                    singleTxPerformance.time_getCompiledData = 0;
                    singleTxPerformance.time_getContractTreeTotal = parseFloat(tEndTotalFallback.toFixed(3));
                    return contractTree;
                }

                console.log(`[${new Date().toISOString()}, DEBUG-CONTRACT TREE] ContractCode recuperato`);
                console.log(`compilerVersion: ${contractsResult.compilerVersion}`);
            if (contractsResult) {
                console.log(`[${new Date().toISOString()}, DEBUG-CONTRACT TREE] Inizio recupero CompiledData`);

                const tStartCompile = performance.now();
                contractTree = await getCompiledData(contractsResult.contracts, contractsResult.contractName, contractsResult.compilerVersion);
                const tEndCompile = performance.now() - tStartCompile;
                singleTxPerformance.time_getCompiledData = parseFloat(tEndCompile.toFixed(3));

                //If contractTree is null is because It can't compile the code but the rest of the data are valid
                contractTree.contractAbi=contractsResult.contractAbi;
                contractTree.sourceCode=contractsResult.sourceCode;
                contractTree.proxy=contractsResult.proxy;
                contractTree.contractName=contractsResult.contractName;
                contractTree.proxyImplementation='';
                contractTree.compilerVersion=contractsResult.compilerVersion;
                await saveCompiledContractData(impl_contract, contractTree);
                console.log(`[${new Date().toISOString()}, DEBUG-CONTRACT TREE] Fine recupero CompiledData e ContractTree completato`);
            }
        } catch (err) {
            console.error('getContractCodeEtherscan error: ', err);
            
            throw new Error(err.message)
        }
    }
    const tEndTotal = performance.now() - tStartTotal;
    singleTxPerformance.time_getContractTreeTotal = parseFloat(tEndTotal.toFixed(3));
    //console.log("CONTRACT-Tree: \n\n full contract tree" + contractTree + "\n\n contract compiled:" + contractCompiled);
    contractsResult = null
    //console.log("\n\n\n\n contract tree (inner): " + contractTree.contractCompiled + "abcdefg\n\n\n\n");
    return contractTree;
}

/**
 * Recursive function to get all the trasaction in a block range
 * @param {*} networkData 
 * @param {*} contractAddress 
 * @param {*} fromBlock 
 * @param {*} toBlock 
 * @returns 
 */
async function getTransactionFromContract(networkData, contractAddress, fromBlock, toBlock) {
    // Make the API request
    const response = await axios.get(
        `${networkData.endpoint}&module=account&action=txlist` +
        `&address=${contractAddress}&startblock=${fromBlock}&endblock=${toBlock}&sort=asc&apikey=${networkData.apiKey}`
    );

    // Extract result array
    let contractTransactions = response.data?.result || [];

    // If no transactions, just return empty array
    if (contractTransactions.length === 0) {
        return [];
    }

    // Find the last transaction’s block number
    const lastBlock = parseInt(contractTransactions[contractTransactions.length - 1].blockNumber);

    // If we haven’t reached the toBlock yet, keep fetching
    if (lastBlock < toBlock) {
        const nextBatch = await getTransactionFromContract(
            networkData,
            contractAddress,
            lastBlock + 1, // <-- move startBlock forward
            toBlock
        );
        contractTransactions = contractTransactions.concat(nextBatch);
    }

    return contractTransactions;
}


async function cleanupResources() {
    try {
        // Close database connections
        // if (mongoose.connection.readyState !== 0) {
        //     await mongoose.disconnect();
        // }
        
        // Clean up web3 instance

        // Clean up hardhat
        if (hre && hre.network && hre.network.provider) {
            await hre.run("clean");
            await hre.network.provider.send("hardhat_reset");
            if (hre.network.provider.removeAllListeners) {
                hre.network.provider.removeAllListeners();
            }
        }

        // Force garbage collection
        if (global.gc) {
            global.gc();
        }
    } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError);
    }
}
module.exports = {
    getAllTransactions,
};
//CakeOFT
//PixesFarmsLand
//AdidasOriginals
//getAllTransactions("CakeOFT");

/**
 * Filters contract transactions based on user-defined criteria.
 *
 * @param {Array} contractTransactions - List of contract transactions.
 * @param {Object} filters - Filters to apply (gasUsed, gasPrice, timestamp, senders, functions).
 * @returns {Array} - Filtered transactions.
 */
function applyFilters(contractTransactions, filters) {
    const { gasUsed, gasPrice, timestamp, senders, functions } = filters;

    return contractTransactions.filter(tx => {
        const matchesSender = !senders.length || senders.includes(tx.from.toLowerCase());
        const matchesFunction = !functions.length || functions.includes(tx.inputDecoded.method);
        const matchesGasUsed = !gasUsed || (tx.gasUsed >= gasUsed[0] && tx.gasUsed <= gasUsed[1]);
        const matchesGasPrice = !gasPrice || (tx.gasPrice >= gasPrice[0] && tx.gasPrice <= gasPrice[1]);
        const matchesTimestamp = !timestamp || (
            tx.timeStamp >= Math.floor(new Date(timestamp[0]).getTime() / 1000) &&
            tx.timeStamp <= Math.floor(new Date(timestamp[1]).getTime() / 1000)
        );

        return matchesSender && matchesFunction && matchesGasUsed && matchesGasPrice && matchesTimestamp;
    });
}

/**
 * Method used to compute the extraction phase, starting from the transactions extracted from Etherscan API.
 * The transactions are filtered using the filters provided by the user, then a search is carried out in the database
 * to avoid processing them again. If the transaction is not found in the database, it is debugged to proceed with storage decoding.
 *
 * @param {*} contractTransactions : list of transaction to extract
 * @param {*} mainContract : main contract to use to decode 
 * @param {*} contractTree 
 * @param {*} contractAddress 
 * @param {*} filters 
 * @param {*} smartContract 
 * @param {*} option 
 * @param {*} networkData 
 * @returns 
 */
async function getStorageData(contractTransactions, mainContract, contractTree, contractAddress, filters, smartContract,option,networkData,addressRange,returnInMemory = false, singleTxPerformance = {}) {
    let transactionsFiltered=null;
    let extractedResults = [];
    try{
    // Apply filters to transactions
        transactionsFiltered = applyFilters(contractTransactions, filters);
        contractTransactions=null;
        if (global.gc) global.gc();
        // Establish database connection
       
        for(const tx of transactionsFiltered){
            try {
                const query = {
                    transactionHash: tx.hash.toLowerCase(),
                    contractAddress: contractAddress.toLowerCase()
                };
                const response = await searchTransaction(query, networkData.networkName);
                if (response) {
                    console.log(`Transaction already processed: ${tx.hash}`);
                    if (returnInMemory) {
                        const { _id, __v, ...transactionData } = response[0]._doc || response[0];
                        extractedResults.push(transactionData);
                    }
                } else {
                    const tStartWorker = performance.now();
                    const workerData = await runWorkerForTx(tx, mainContract, contractTree, contractAddress, smartContract, option, networkData, addressRange, returnInMemory);
                    const timeWorker = parseFloat((performance.now() - tStartWorker).toFixed(3));
                    // salvo metriche 
                    if (workerData && workerData.metrics) {

                        const totalTxTime = parseFloat(((singleTxPerformance.time_getContractTreeTotal || 0) + timeWorker).toFixed(3));

                        const combinedMetrics = {
                            transactionHash: tx.hash,
                            blockNumber: parseInt(tx.blockNumber),
                            time_totalTransactionExtraction: totalTxTime,
                            ...singleTxPerformance, 
                            ...workerData.metrics   
                        };

                        await saveExtractionMetrics(combinedMetrics);
                    }

                    if (returnInMemory && workerData && workerData.data) {
                        extractedResults.push(workerData.data);
                    }
                }

            }catch (e){
                console.log("errore nel worker",e)
            }
        }
       
        return returnInMemory ? extractedResults : [];
    } catch(err){
        console.log(err)
        return;
    } finally{
        if (transactionsFiltered) {
            transactionsFiltered.length = 0;
            transactionsFiltered = null;
        }
        if (global.gc) global.gc();
        await hre.run("clean");
        if (hre.network.provider.removeAllListeners) {
            hre.network.provider.removeAllListeners();
        }

    }
}

function runWorkerForTx(tx, mainContract, contractTree, contractAddress, smartContract, option, networkData,addressRange,returnInMemory = false) {
    const workerPath = path.join(__dirname, 'workerWithOption.js');
    
    return new Promise((resolve, reject) => {
        const worker = fork(workerPath, [], {
            execArgv: ['--max-old-space-size=4096', '--expose-gc']
        });

        // Send data to the worker
        worker.send({
            tx,
            mainContract,
            contractTree,
            contractAddress,
            smartContract,
            option,
            networkData,
            addressRange,
            returnInMemory
        });

        // Listen for messages
        worker.on("message", (msg) => {
            if (msg === "done") {
                resolve(); 
            } else if (msg && msg.status === "done") {
                resolve({ data: msg.data, metrics: msg.metrics });
            } else if (msg.error) {
                reject(new Error(msg.error));
            }
        });

        // Handle worker exit
        worker.on("exit", (code, signal) => {
            if (code !== 0) {
                reject(new Error(`Worker exited with code ${code} and signal ${signal}`));
            } else {
                resolve();
            }
        });

        // Handle worker error
        worker.on("error", (err) => {
            reject(err);
        });
    });
}


// 0xa939a421a423fc2beb109f09f34d3fe96b3bb4bffaacd8203cc60e3d052efea3

//ultima transazione
// 0x8848f14a738c0f2bb87247e6796e1950068c14791f9b436b1b9d31c6747e695e
