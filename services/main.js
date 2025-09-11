const {Web3} = require('web3');
const InputDataDecoder = require('ethereum-input-data-decoder');
const fs = require('fs');
const axios = require("axios");
const {stringify} = require("csv-stringify")
//let contractAbi = fs.readFileSync('abiEtherscan.json', 'utf8');
let contractAbi = {};
// const { newDecodeValues } = require('./newDecodedValue');
// const { optimizedDecodeValues }= require('./reformatting')
// const { optimizedDecodeValues }= require('./reformatting')
const { decodeInternalTransaction } = require('./decodeInternalTransaction');
const { optimizedDecodeValues }= require('./newReformattigCode')
// const { getTraceStorage } = require('./getTraceStorage');

//const contractAddress = '0x152649eA73beAb28c5b49B26eb48f7EAD6d4c898'cake;
//const contractAddress = '0x5C1A0CC6DAdf4d0fB31425461df35Ba80fCBc110';
//const contractAddress = '0xc9EEf4c46ABcb11002c9bB8A47445C96CDBcAffb';
//const cotractAddressAdidas = 0x28472a58A490c5e09A238847F66A68a47cC76f0f
const hre = require("hardhat");
const {saveTransaction, saveExtractionLog} = require("../databaseStore");
const {getRemoteVersion, detectVersion} = require("./solcVersionManager");
const {searchTransaction} = require("../query/query")
const {connectDB} = require("../config/db");
const mongoose = require("mongoose");
require('dotenv').config();
const v8 = require('v8');
const path = require('path');
const { fork } = require("child_process");

const {ethers} = require("hardhat");

let networkName = ""
let web3 = null
let web3Endpoint = ""
let apiKey = ""
let endpoint = ""

let _contractAddress = ""

let contractCompiled = null


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
 * @returns {Promise<*|*[]>} - the blockchain log with the extracted data
 */

async function getAllTransactions(mainContract, contractAddress, impl_contract, fromBlock, toBlock, network, filters, smartContract,extractionType) {
    _contractAddress = contractAddress
    networkName = network;
    try{
        switch (network) {
        case "Mainnet":
            web3Endpoint = process.env.WEB3_ALCHEMY_MAINNET_URL
            apiKey = process.env.API_KEY_ETHERSCAN
            endpoint = process.env.ETHERSCAN_MAINNET_ENDPOINT
            break
        case "Sepolia":
            web3Endpoint = process.env.WEB3_ALCHEMY_SEPOLIA_URL
            apiKey = process.env.API_KEY_ETHERSCAN
            endpoint = process.env.ETHERSCAN_SEPOLIA_ENDPOINT
            break
        case "Polygon":
            web3Endpoint = process.env.WEB3_ALCHEMY_POLYGON_URL
            apiKey = process.env.API_KEY_POLYGONSCAN
            endpoint = process.env.POLYGONSCAN_MAINNET_ENDPOINT
            break
        case "Amoy":
            web3Endpoint = process.env.WEB3_ALCHEMY_AMOY_URL
            apiKey = process.env.API_KEY_POLYGONSCAN
            endpoint = process.env.POLYGONSCAN_TESTNET_ENDPOINT
            break
        default:

        }

        web3 = new Web3(web3Endpoint)
        //contractAddress = proxy address in which storage and txs are made
        let data = await axios.get(endpoint + `?module=account&action=txlist&address=${contractAddress}&startblock=${fromBlock}&endblock=${toBlock}&sort=asc&apikey=${apiKey}`)
        const contractTransactions = await data.data.result
        data=null;
        // returns all contracts linked to te contract sent in input from etherscan
        let contracts = null
        // if the contract is uploaded by the user then the contract is compiled
        if (smartContract) {
            contracts = smartContract
        } else {
            //implementation contract address
            contracts = await getContractCodeEtherscan(impl_contract);
        }
        //mainContract = implementationContract name
        const contractTree = await getCompiledData(contracts, mainContract);
        contracts=null;
        const userLog = {
            networkUsed: networkName,
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
       
        // setInterval(() => {
        // const stats = v8.getHeapStatistics();
        // const used = process.memoryUsage();

        // console.log("===== Memory Usage =====");
        // console.log("V8 Heap Used:", (stats.used_heap_size / 1024 / 1024).toFixed(2), "MB");
        // console.log("V8 Heap Limit:", (stats.heap_size_limit / 1024 / 1024).toFixed(2), "MB");
        // console.log("JS Heap Used:", (used.heapUsed / 1024 / 1024).toFixed(2), "MB");
        // console.log("JS Heap Total:", (used.heapTotal / 1024 / 1024).toFixed(2), "MB");
        // console.log("External (Buffers/native):", (used.external / 1024 / 1024).toFixed(2), "MB");
        // console.log("RSS (Total Process):", (used.rss / 1024 / 1024).toFixed(2), "MB");
        // console.log("========================");
        // }, 60000);
        
       
        await connectDB(networkName);
        await saveExtractionLog(userLog,networkName)
        // let txFromDb=[];
        // for(const tx of contractTransactions){
        //     const query = {
        //         transactionHash: tx.hash.toLowerCase(),
        //         contractAddress: contractAddress.toLowerCase()
        //     };
        //     const response = await searchTransaction(query, networkName);
        //         if (response) {
        //             console.log(`Transaction already processed: ${tx.hash}`);
        //             const { _id, __v, ...transactionData } = response[0];
        //             txFromDb.push(transactionData);
        //         }
        // }
        // if(txFromDb.length>0){
        //     await mongoose.disconnect();
        //     return txFromDb;
        // }
        const result = await getStorageData(contractTransactions, mainContract, contractTree, contractAddress, filters, smartContract,extractionType);
        await mongoose.disconnect();

       
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
        contractCompiled=null;
        return result;
    } catch (err) {
        console.error(err)
        return err;
    }finally{
        await cleanupResources();
    }
}
async function cleanupResources() {
    try {
        // Close database connections
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
        
        // Clean up web3 instance
        web3 = null;

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
    processTransaction
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
 * This method involves the debugging of the transaction to extract the storage state.
 * The debugging is handled by the Hardhat environment configured in the file "hardhat.config.js"
 *
 * @param transactionHash - the transaction hash to be debugged
 * @param blockNumber - the block number where the transaction is stored
 * @returns {Promise<{requiredTime: number, response: any}>} - the response of the debugged transaction and the required time to debug it
 */
async function debugTransaction(transactionHash, blockNumber) {
    let response = null;
    try {
        // await hre.run('clean');
        await hre.changeNetwork(networkName, blockNumber)
        const start = new Date()
        
        response = await hre.network.provider.send("debug_traceTransaction", [
            transactionHash
        ]);

        
    
        // fs.writeFileSync("./temporaryTrials/trace.json", JSON.stringify(response));
        // const internalCalls = response.structLogs
        // .filter(log => log.op === "CALL" || log.op === "DELEGATECALL" || log.op === "STATICCALL");

        // const indiceTemp=response.structLogs.indexOf(internalCalls[0]);

        const end = new Date()
        const requiredTime = parseFloat(((end - start) / 1000).toFixed(2))
        return {response, requiredTime}
    } catch (err) {
        console.error(err)
        throw new Error(err.message)
    }finally{
         // No hardhat_reset here anymore

        if (global.gc) global.gc();
    }
}

/**
 * Method used to compute the extraction phase, starting from the transactions extracted from Etherscan API.
 * The transactions are filtered using the filters provided by the user, then a search is carried out in the database
 * to avoid processing them again. If the transaction is not found in the database, it is debugged to proceed with storage decoding.
 *
 * @param {Array} contractTransactions - Transactions extracted using Etherscan API.
 * @param {string} mainContract - The main contract to decode.
 * @param {Object} contractTree - The contract tree derived before decoding the storage.
 * @param {string} contractAddress - The contract address used to search the transactions in the database and save new ones.
 * @param {Object} filters - Filters to be applied to the transactions.
 * @param {Object} smartContract - The smart contract uploaded file.
 * @returns {Promise<Array>} - The blockchain log with the extracted data.
 */
async function getStorageData(contractTransactions, mainContract, contractTree, contractAddress, filters, smartContract,extractionType) {
    let transactionsFiltered=null;
    // Decode input data for all transactions
   
    try{
    // Apply filters to transactions
        transactionsFiltered = applyFilters(contractTransactions, filters);
        contractTransactions=null;

        if (global.gc) global.gc();
        // Establish database connection
       
       
        for(const tx of transactionsFiltered){
            await runWorkerForTx(tx, mainContract, contractTree, contractAddress, smartContract,extractionType);
        }
        console.log("Extraction finished");
        return [];
    }catch(err){
        console.log(err)
        return;
    }finally{
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
function runWorkerForTx(tx, mainContract, contractTree, contractAddress, smartContract,extractionType) {
    const workerPath = path.join(__dirname, 'worker.js');
    return new Promise((resolve, reject) => {
        const worker = fork(workerPath, [], {
            // Increase memory limit for worker
            execArgv: ['--max-old-space-size=1024', '--expose-gc']
        });

        // Set timeout for worker (optional)
        const timeout = setTimeout(() => {
            worker.kill('SIGKILL');
            reject(new Error('Worker timeout'));
        }, 300000); // 5 minutes timeout

        worker.send({
            tx,
            mainContract,
            contractTree,
            contractAddress,
            smartContract,
            extractionType,
            network: networkName,
            contractAbiData: contractAbi,
            contractCompiledData: contractCompiled
        });

        worker.on("message", (msg) => {
            clearTimeout(timeout);
            if (msg === "done") {
                resolve();
            } else if (msg.error) {
                reject(new Error(msg.error));
            }
        });

        worker.on("exit", (code, signal) => {
            clearTimeout(timeout);
            if (code !== 0 && signal !== 'SIGKILL') {
                reject(new Error(`Worker exited with code ${code} and signal ${signal}`));
            } else if (code === 0) {
                resolve();
            }
        });

        worker.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}
async function processTransactionSafe(tx, mainContract, contractTree, contractAddress, smartContract) {
    try {
        await processTransaction(tx, mainContract, contractTree, contractAddress, smartContract);
    } catch (err) {
        console.error(`Error processing transaction ${tx.hash}:`, err);
    } finally {
        // Clear transaction reference
        tx = null;

        if (global.gc) global.gc();
    }
}
/**
 * Decodes the input data of all transactions using the contract ABI.
 *
 * @param {Array} contractTransactions - List of contract transactions.
 */
function decodeTransactionInputs(tx) {
    let decoder=null;
    try{
        decoder = new InputDataDecoder(contractAbi);
        tx.inputDecoded = decoder.decodeData(tx.input);
    }finally{
        decoder=null;
    }
}

/**
 * Processes a single transaction to extract storage data.
 *
 * @param {Object} tx - The transaction object.
 * @param {string} mainContract - The main contract to decode.
 * @param {Object} contractTree - The contract tree for decoding.
 * @param {string} contractAddress - The contract address.
 * @param {Object} smartContract - The smart contract uploaded file.
 * @param {number} partialInt - The current transaction index.
 * @returns {Promise<Object|null>} - The processed transaction log or null if already processed.
 */
async function processTransaction(tx, mainContract, contractTree, contractAddress, smartContract) {
    const query = {
        transactionHash: tx.hash.toLowerCase(),
        contractAddress: contractAddress.toLowerCase()
    };

    const response = await searchTransaction(query, networkName);
    if (response) {
        const { _id, __v, ...transactionData } = response[0];
        return transactionData;
    }
    
    decodeTransactionInputs(tx);
    let debugResult=null;
    let pastEvents=null;
    try{
        debugResult = await debugTransaction(tx.hash, tx.blockNumber);
        pastEvents = await getEvents(tx.hash, Number(tx.blockNumber), contractAddress);
    
        await createTransactionLog(tx, debugResult, pastEvents, mainContract, contractTree, smartContract);

        return [];
        
    }finally{
         // Aggressive cleanup of heavy objects
        if (debugResult) {
            if (debugResult.response && debugResult.response.structLogs) {
                debugResult.response.structLogs = null;
            }
            debugResult.response = null;
            debugResult = null;
        }
        
        if (pastEvents) {
            pastEvents.length = 0;
            pastEvents = null;
        }
        if (global.gc) global.gc();
    }
}

/**
 * Creates a transaction log by decoding inputs, storage state, and events.
 *
 * @param {Object} tx - The transaction object.
 * @param {Object} debugResult - The debugged transaction result.
 * @param {Array} pastEvents - The events emitted by the transaction.
 * @param {string} mainContract - The main contract to decode.
 * @param {Object} contractTree - The contract tree for decoding.
 * @param {Object} smartContract - The smart contract uploaded file.
 * @returns {Promise<Object>} - The transaction log.
 */
async function createTransactionLog(tx, debugResult, pastEvents, mainContract, contractTree, smartContract) {

    let transactionLog = {
        functionName: tx.inputDecoded.method,
        transactionHash: tx.hash,
        blockNumber: parseInt(tx.blockNumber),
        contractAddress: tx.to,
        sender: tx.from,
        gasUsed: parseInt(tx.gasUsed),
        timestamp: new Date(tx.timeStamp * 1000).toISOString(),
        inputs: decodeInputs(tx.inputDecoded),
        storageState: [],
        internalTxs: [],
        events: pastEvents
    };
    let storageVal=null;
    try{
        storageVal = await getTraceStorage(debugResult.response, tx.blockNumber, tx.inputDecoded.method, tx.hash, mainContract, contractTree, smartContract);
        transactionLog.storageState = storageVal.decodedValues;
        transactionLog.internalTxs = storageVal.internalTxs;
        await saveTransaction(transactionLog, tx.to);

    }finally{
        if (storageVal) {
            storageVal.decodedValues = null;
            storageVal.internalTxs = null;
            storageVal = null;
        }
        transactionLog=null;
    }



    return ;
}

/**
 * Decodes transaction inputs into a structured format.
 *
 * @param {Object} inputDecoded - The decoded input data.
 * @returns {Array} - The decoded inputs.
 */
function decodeInputs(inputDecoded) {
    return inputDecoded.inputs.map((input, i) => {
        const inputName = Array.isArray(inputDecoded.names[i]) ? inputDecoded.names[i].toString() : inputDecoded.names[i];
        if (Array.isArray(input)) {
            const bufferTuple = input.map((val, z) => decodeInput(inputDecoded.types[i].split(",")[z] || inputDecoded.types[i], val));
            return { inputName, type: inputDecoded.types[i], inputValue: bufferTuple.toString() };
        } else {
            return { inputName, type: inputDecoded.types[i], inputValue: decodeInput(inputDecoded.types[i], input) };
        }
    });
}

function decodeInput(type, value) {
    if (type === 'uint256') {
        return Number(web3.utils.hexToNumber(value._hex));
    } else if (type === 'string') {
        // return web3.utils.hexToAscii(value);
        return value;
    } else if (type && type.includes("byte")) {
        return value;
        //return JSON.stringify(web3.utils.hexToBytes(value)).replace("\"", "");
    } else if (type && type.includes("address")) {
        return value;
    } else {
        return value;
    }
}

/**
 *
 * @param traceDebugged - the debugged transaction with its opcodes
 * @param blockNumber - the block number where the transaction is stored
 * @param functionName - the function name of the invoked method, useful to decode the storage state
 * @param transactionHash - the transaction hash used only to identify the internal transactions
 * @param mainContract - the main contract to decode, used to identify the contract variables
 * @param contractTree - the contract tree used to identify the contract variables with the 'mainContract'
 * @returns {Promise<{decodedValues: (*&{variableValue: string|string|*})[], internalCalls: *[]}>} - the decoded values of the storage state and the internal calls
 */
async function getTraceStorage(traceDebugged, blockNumber, functionName, transactionHash, mainContract, contractTree,smartContract) {

    
    //used to store the storage changed by the function. Used to compare the generated keys
    let functionStorage = {};
    //used to store all the keys potentially related to a dynamic structure
    let index = 0;
    let trackBuffer = [];
    let bufferPC = -10;
    let sstoreBuffer = [];
    let sstoreOptimization = []
    let internalCalls = [];
    let keccakBeforeAdd = {};
    let finalShaTraces = [];

    try{

        if (traceDebugged.structLogs) {
            for (const trace of traceDebugged.structLogs) {
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
                    if (trace.op === "ADD" && (trace.stack[trace.stack.length - 1] === keccakBeforeAdd.finalKey ||
                            trace.stack[trace.stack.length - 2] === keccakBeforeAdd.finalKey) &&
                        keccakBeforeAdd.hexStorageIndex === "0000000000000000000000000000000000000000000000000000000000000000") {
                        const keyBuff = trackBuffer[index - 1].hexKey;
                        const slotBuff = trackBuffer[index - 1].hexStorageIndex;
                        trackBuffer[index - 1].hexKey = slotBuff;
                        trackBuffer[index - 1].hexStorageIndex = keyBuff;
                        const nextTrace = traceDebugged.structLogs[traceDebugged.structLogs.indexOf(trace) + 1];
                        if (nextTrace) {
                            trackBuffer[index - 1].finalKey = nextTrace.stack[nextTrace.stack.length - 1];
                        }
                        trackBuffer[index - 1].indexSum = trace.stack[trace.stack.length - 2];
                    }
                } else if (trace.op === "SSTORE") {
                    sstoreOptimization.push(trace.stack);
                    sstoreBuffer.push(trace.stack[trace.stack.length - 1]);
                } else if (trace.op === "CALL" || trace.op === "DELEGATECALL" || trace.op === "STATICCALL") {
                    const offsetBytes = trace.stack[trace.op === "CALL" ? trace.stack.length - 4 : trace.stack.length - 3];
                    const lengthBytes = trace.stack[trace.op === "CALL" ? trace.stack.length - 5 : trace.stack.length - 4];
                    let stringDepthConstruction = "";
                    for (let i = 0; i < trace.depth - 1; i++) {
                        stringDepthConstruction += "_1";
                    }
                    let call = {
                        callId: "call_0" + stringDepthConstruction,
                        callType: trace.op,
                        callDepth: trace.depth,
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
                }
            }
        }
        
    
    
        
        finalShaTraces=trackBuffer
        // console.log('SSTOREBUFER',sstoreBuffer);
        // console.log('TRACK BUFFER', trackBuffer);
        // console.log('Track buffer length', trackBuffer.length);
        for (let i = 0; i < trackBuffer.length; i++) {
            // console.log("---sto iterando con indice i ---", i)
            // console.log('trackBuffer[i].finalKey', trackBuffer[i].finalKey)
            //check if the SHA3 key is contained in a SSTORE
            if (sstoreBuffer.includes(trackBuffer[i].finalKey)) {
                // console.log("---sstore contiene finalKey---")
                //create a final trace for that key
                const trace = {
                    finalKey: trackBuffer[i].finalKey,
                    hexKey: trackBuffer[i].hexKey,
                    indexSum:trackBuffer[i].indexSum,
                    hexStorageIndex:trackBuffer[i].hexStorageIndex
                }
                // console.log(trace)
                let flag = false;
                let test = i;
                // console.log("testtttttttt", test);
                //Iterate previous SHA3 looking for a simple integer slot index
                while (flag === false) {
                    //TODO non capisco questo controllo perché torna indietro anche se sono
                    //con l'indice 0
                    // console.log("---sono nel while cercando cose---")
                    //if the storage key is not a standard number then check for the previous one
                    if (!(web3.utils.hexToNumber("0x" + trackBuffer[test].hexStorageIndex) < 300)) {
                        if(test > 0){
                            test--;
                        }else{
                            flag=true;
                        }
                        // console.log("non ho trovato uno slot semplice e vado indietro")
                    } else {
                        //if the storage location is a simple one then save it in the final trace with the correct key
    
                        trace.hexStorageIndex = trackBuffer[test].hexStorageIndex;
                        flag = true;
                        finalShaTraces.push(trace);
                    }
                }
                finalShaTraces.push(trace);
                sstoreBuffer.splice(sstoreBuffer.indexOf(trackBuffer[i].finalKey), 1);
            }
    
        }
    
    
       
        traceDebugged.structLogs.length=0;
        let sstoreObject = {sstoreOptimization, sstoreBuffer}
        finalShaTraces=regroupShatrace(finalShaTraces);
        let result={
            decodedValues:await optimizedDecodeValues(sstoreObject, contractTree, finalShaTraces, functionStorage, functionName, mainContract,web3,contractCompiled),
            internalTxs:await decodeInternalTransaction(internalCalls,apiKey,smartContract,endpoint,web3,networkName)
        }
        sstoreObject=null;
        return result;
    }catch (err){
        console.log("errore ",err)
    
    }finally{
        functionStorage = null;
        trackBuffer.length = 0;
        trackBuffer = null;
        sstoreBuffer.length = 0;
        sstoreBuffer = null;
        sstoreOptimization.length = 0;
        sstoreOptimization = null;
        traceDebugged=null;
        // internalCalls.length = 0;
        // internalCalls = null;
        finalShaTraces.length = 0;
        finalShaTraces = null;

        if (global.gc) global.gc();
    }
    // fs.writeFileSync("./temporaryTrials/trace.json", JSON.stringify(traceDebugged.structLogs), {flag: "a+"});
}
function regroupShatrace(finalShaTraces){
    return Array.from(
        new Map(finalShaTraces.map(item => [item.finalKey + item.hexStorageIndex, item])).values()
      );
}
//cleanTest(18424870, "sendFrom", "0x446f97e43687382fefbc6a9c4cccd055829ef2909997fb102a1728db6b37b76a", "CakeOFT");

//function for re-generating the key and understand the variable thanks to the tests on the storage locationapprove(address spender,uint256 amount)0x095ea7b3












/**
 * Method used to compile the smart contract according to the solidity version, retrieved using "solc" package.
 *
 * @param contracts - the contract to compile
 * @param contractName - the name of the contract to compile
 * @returns {Promise<*>} - the AST of the smart contract, allowing the reading of the variables and the functions of the contract.
 */
async function getCompiledData(contracts, contractName) {
    let input = {
        language: 'Solidity',
        sources: {},
        settings: {
            outputSelection: {
                "*": {
                    // data to return
                    // storageLayout -> how the variables are stored in the EVM
                    // ast -> abstract syntax tree, contract structure (syntax tree)
                    "*": ["storageLayout", "ast", "abi"],
                    "": ["ast"]
                }
            }
        }
    };

    let solidityVersion = ""
    if (Array.isArray(contracts)) {
        for (const contract in contracts) {
            input.sources[contract] = {};
            input.sources[contract].content = contracts[contract].content;
            solidityVersion = await detectVersion(contracts[contract].content)
        }
    } else if (contracts) {
        input.sources[contractName] = {};
        input.sources[contractName].content = contracts;
        solidityVersion = await detectVersion(contracts)
    }
    const solcSnapshot = await getRemoteVersion(solidityVersion.replace("soljson-", "").replace(".js", ""))

    let output = solcSnapshot.compile(JSON.stringify(input));
    contractCompiled = output
    input=null;
    let source = JSON.parse(output).sources;
    contractAbi = JSON.stringify(await getAbi(JSON.parse(output), contractName));
   // console.log(contractAbi);
    // fs.writeFileSync('abitest.json', JSON.stringify(contractAbi));
    //get all storage variable for contract, including inherited ones

    //console.log(storageData);
    //take the effective tree
    let contractStorageTree = await getContractVariableTree(JSON.parse(output));
    output=null;
    //get tree of functions for contract, NOT including inherited
    let contractTree = await getFunctionContractTree(source);
    source=null;
    //fs.writeFileSync('./temporaryTrials/contractTree.json', JSON.stringify(contractTree));
    //construct full function tree including also the inherited ones
    let contractFunctionTree = await constructFullFunctionContractTree(contractTree);
    contractTree=null;
    //fs.writeFileSync('./temporaryTrials/contractFunctionTree.json', JSON.stringify(contractFunctionTree));
    //construct full contract tree including also variables
    const fullContractTree = await injectVariablesToTree(contractFunctionTree, contractStorageTree);
    contractStorageTree=null;
    contractFunctionTree=null;
    //fs.writeFileSync('./temporaryTrials/fullContractTree.json', JSON.stringify(fullContractTree));

    return fullContractTree;
}

/**
 * Method used to get the contract ABI from the  main compiled contract
 *
 * @param compiled - compiled contracts returned by the solc compiler
 * @param contractName - the name of the contract to get the ABI
 * @returns {Promise<*>} - the ABI of the contract
 */
async function getAbi(compiled, contractName) {
    for (const contract in compiled.contracts) {
        //console.log("contract", contract);
        const firstKey = Object.keys(compiled.contracts[contract])[0];
        if (String(firstKey) === String(contractName)) {
            //console.log(compiled.contracts[contract]);
            //console.log(compiled.contracts[contract][firstKey]);
            return compiled.contracts[contract][firstKey].abi;
        }else{
            for(const keyNumber in Object.keys(compiled.contracts[contract])){
                otherKey = Object.keys(compiled.contracts[contract])[keyNumber];
                if (String(otherKey) === String(contractName)) {
                    //console.log("trovato contratto abi 2");
                    return compiled.contracts[contract][otherKey].abi;
                }
            }
        }
    }
    if (compiled && compiled.contracts && compiled.contracts["contract0"] && compiled.contracts["contract0"].hasOwnProperty(contractName)) {
        return compiled.contracts["contract0"][contractName].abi;
    }
}

/**
 * Injects storage variables into the contract function tree.
 *
 * @param {Object} contractFunctionTree - Tree containing contract functions.
 * @param {Object} contractStorageTree - Tree containing contract storage variables.
 * @returns {Object} - Updated contract function tree with storage variables injected.
 */
async function injectVariablesToTree(contractFunctionTree, contractStorageTree) {
    const storageMap = new Map();

    // Preprocess the storage tree into a Map for faster lookups
    for (const contractName in contractStorageTree) {
        const { name, storage } = contractStorageTree[contractName];
        storageMap.set(name, storage);
    }

    // Inject storage into the function tree
    for (const contractId in contractFunctionTree) {
        const contract = contractFunctionTree[contractId];
        if (storageMap.has(contract.name)) {
            contract.storage = storageMap.get(contract.name);
        }
    }


    return contractFunctionTree;
}

/**
 * Constructs a full function contract tree by including inherited functions.
 *
 * @param {Object} partialContractTree - Partial contract tree with functions.
 * @returns {Object} - Full contract tree with inherited functions included.
 */
async function constructFullFunctionContractTree(partialContractTree) {
    for (const contractId in partialContractTree) {
        const contract = partialContractTree[contractId];
        const inheritedFunctions = new Set(contract.functions);

        // Add inherited functions
        for (const inheritedId of contract.inherited) {
            const inheritedContract = partialContractTree[inheritedId];
            if (inheritedContract && inheritedContract.name !== contract.name) {
                inheritedContract.functions.forEach(fn => inheritedFunctions.add(fn));
            }
        }

        // Update the contract's functions with unique values
        contract.functions = Array.from(inheritedFunctions);
    }


    return partialContractTree;
}

/**
 * Method used to get all the functions of the contract
 *
 * @param source - the source code of the contracts returned by the solc compiler
 * @returns {Promise<{}>} - the AST of the contract with the functions
 */
async function getFunctionContractTree(source) {

    // let contractToIterate = [];
    let contractTree = {};
    for (const contract in source) {
        for (const directive of source[contract].ast.nodes) {
            //reads the nodes of the ast searching for the contract and not for the imports
            if (directive.nodeType === "ContractDefinition") {
                // AST of the source code of the contracts
                contractTree[directive.id] = {};
                contractTree[directive.id].name = directive.name;
                contractTree[directive.id].inherited = directive.linearizedBaseContracts;
                contractTree[directive.id].functions = [];
                for (const node of directive.nodes) {
                    //if node is the contract definition one initialize its structure
                    //if node is a function definition save it
                    if (node.nodeType.match("FunctionDefinition") && node.body != undefined && node.implemented == true) {
                        //create a buffer representing the function object to push to the function tree
                        contractTree[directive.id].functions.push(node.name);

                    }
                }
            }
        }
    }

    return contractTree;
}

/**
 * Returns the source code of the smart contract using the Etherscan APIs
 *
 * @param contractAddress - the address of the contract to get the source code
 * @returns {Promise<*[]>} - the source code of the contract with the imported contracts
 */
async function getContractCodeEtherscan(contractAddress) {
    let contracts = [];
    let response=[];
    let buffer;
    try{

        response = await axios.get(endpoint + `?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${apiKey}`);
        const data = response.data;
        if (data.result[0].SourceCode === "") {
            throw new Error("No contract found");
        }
        let i = 0;
        // fs.writeFileSync('./temporaryTrials/dataResult.json', JSON.stringify(data.result[0]))
        let jsonCode = data.result[0].SourceCode;
        //console.log(jsonCode);
        // fs.writeFileSync('sourceCode', JSON.stringify(data.result[0]));
    
        if (jsonCode.charAt(0) === "{") {
    
            // fs.writeFileSync('contractEtherscan.json', jsonCode);
            //fs.writeFileSync('solcOutput', jsonCode);
            //const realResult = fs.readFileSync('solcOutput');
            jsonCode = JSON.parse(jsonCode.slice(1, -1)).sources
    
            for (const contract in jsonCode) {
    
                let contractReplaced = contract.replace("node_modules/", "").replace("lib/", "")
                let actualContract = 'contract' + i;
                let code = jsonCode[contract].content;
    
                contracts[contractReplaced] = {};
                contracts[contractReplaced].nameId = actualContract;
                contracts[contractReplaced].content = code;
    
                //input.sources[contract] = {}
                //input.sources[contract].content = code
                //fs.writeFileSync('smartContracts/' + actualContract, JSON.stringify(code));
                i++;
                buffer += code
            }
        } else {
            let actualContract = 'contract' + i;
            let code = jsonCode;
            contracts[actualContract] = {};
            contracts[actualContract].nameId = actualContract;
            contracts[actualContract].content = code;
        }
        return contracts;
    }catch (err){
        console.log("error",err)
    }finally{
        if(response){
            response=null;
        }
    }
}

/**
 * Method used to return the contract variables
 *
 * @param compiled - the compiled contracts returned by the solc compiler
 * @returns {Promise<*[]>} - the contract variables
 */
async function getContractVariableTree(compiled) {
    let contractStorageTree = [];
    //iterate all contracts
    for (const contract in compiled.contracts) {
        //utility for getting the key corresponding to the specific contract and access it
        const firstKey = Object.keys(compiled.contracts[contract])[0];
        //check that the contract has some state variables
        if (compiled.contracts[contract] && compiled.contracts[contract][firstKey] && compiled.contracts[contract][firstKey].storageLayout.storage.length !== 0) {
            //get the storage of the contract
            const storageLay = compiled.contracts[contract][firstKey].storageLayout.storage;
            //read all variables from contract storage
            for (const storageVar of storageLay) {
                //initialize first access to the contract
                if (contractStorageTree[firstKey] === undefined) {
                    contractStorageTree[firstKey] = {};
                    contractStorageTree[firstKey].storage = [];
                    contractStorageTree[firstKey].name = firstKey;
                }
                contractStorageTree[firstKey].storage.push({
                    name: storageVar.label, type: storageVar.type,
                    slot: storageVar.slot, offset: storageVar.offset
                });

                // fs.writeFileSync('./temporaryTrials/contractStorageTree.json', JSON.stringify(contractStorageTree[firstKey]), {flag: "a+"})
            }
        }else{
            for(const keyNumber in Object.keys(compiled.contracts[contract])){
                const otherKey = Object.keys(compiled.contracts[contract])[keyNumber];
                if (compiled.contracts[contract][otherKey].storageLayout.storage.length !== 0) {

                    const storageLay = compiled.contracts[contract][otherKey].storageLayout.storage;
                    for (const storageVar of storageLay) {
                        //initialize first access to the contract
                        if (contractStorageTree[otherKey] === undefined) {
                            contractStorageTree[otherKey] = {};
                            contractStorageTree[otherKey].storage = [];
                            contractStorageTree[otherKey].name = otherKey;
                        }
                        contractStorageTree[otherKey].storage.push({
                            name: storageVar.label, type: storageVar.type,
                            slot: storageVar.slot, offset: storageVar.offset
                        });

                        // fs.writeFileSync('./temporaryTrials/contractStorageTree.json', JSON.stringify(contractStorageTree[otherKey]), {flag: "a+"})
                    }
                }
            }
        }
    }

    return contractStorageTree;
}

/**
 * Method used to retrieve the emitted events in the transaction block, using web3.js.
 *
 * @param transactionHash - the hash of the transaction to get the events
 * @param block - the block number of the transaction
 * @param contractAddress - the address of the contract to get the events
 * @returns {Promise<*[]>} - the events emitted by the transaction
 */
async function getEvents(transactionHash, block, contractAddress) {
    let myContract = new web3.eth.Contract(JSON.parse(contractAbi), contractAddress);
    let filteredEvents = [];
    const pastEvents = await myContract.getPastEvents("allEvents", {fromBlock: block, toBlock: block});
    myContract=null;
    for (let i = 0; i < pastEvents.length; i++) {
        for (const value in pastEvents[i].returnValues) {
            if (typeof pastEvents[i].returnValues[value] === "bigint") {
                pastEvents[i].returnValues[value] = Number(pastEvents[i].returnValues[value]);
            }
        }
        const event = {
            eventName: pastEvents[i].event,
            eventValues: pastEvents[i].returnValues
        };
        filteredEvents.push(event);
    }

    return filteredEvents;
}
// 0xa939a421a423fc2beb109f09f34d3fe96b3bb4bffaacd8203cc60e3d052efea3

//ultima transazione
// 0x8848f14a738c0f2bb87247e6796e1950068c14791f9b436b1b9d31c6747e695e