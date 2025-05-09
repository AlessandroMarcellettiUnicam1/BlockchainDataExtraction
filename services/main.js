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

const {ethers} = require("hardhat");

let networkName = ""
let web3 = null
let web3Endpoint = ""
let apiKey = ""
let endpoint = ""

let _contractAddress = ""

let contractCompiled = null

let traceTime = 0
let decodeTime = 0
const csvColumns = ["transactionHash", "debugTime", "decodeTime", "totalTime"]

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

async function getAllTransactions(mainContract, contractAddress, impl_contract, fromBlock, toBlock, network, filters, smartContract) {

    _contractAddress = contractAddress
    networkName = network;
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
            console.log("Change Network")
    }

    web3 = new Web3(web3Endpoint)

    try {
        //contractAddress = proxy address in which storage and txs are made
        const data = await axios.get(endpoint + `?module=account&action=txlist&address=${contractAddress}&startblock=${fromBlock}&endblock=${toBlock}&sort=asc&apikey=${apiKey}`)
        const contractTransactions = await data.data.result
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
        await connectDB(networkName);
        await saveExtractionLog(userLog,networkName)

        // return await getStorageData(contractTransactions, mainContract, contractTree, contractAddress, filters).then(async ()=>{
        //     await removeCollectionFromDB(networkName);
        // });

        const result = await getStorageData(contractTransactions, mainContract, contractTree, contractAddress, filters);
        // await removeCollectionsInOrder(contractAddress,networkName,process.env.LOG_DB_NAME);
        await mongoose.disconnect();
        // await removeCollectionFromDB(networkName).then(removeAddressCollection(contractAddress,process.env.LOG_DB_NAME));
        return result;
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
        return err
    }
}

module.exports = {
    getAllTransactions,
};
//CakeOFT
//PixesFarmsLand
//AdidasOriginals
//getAllTransactions("CakeOFT");

function applyFilters(contractTransactions, filters) {
    const gasUsedFilter = filters.gasUsed
    const gasPriceFilter = filters.gasPrice
    const timestampFilter = filters.timestamp
    const sendersFilter = filters.senders;
    const functionsFilter = filters.functions;

    let contractTransactionsFiltered = contractTransactions
    if (sendersFilter.length > 0) {
        contractTransactionsFiltered = contractTransactionsFiltered.filter(tx => sendersFilter.includes(tx.from.toLowerCase()))
    }
    if (functionsFilter.length > 0) {
        contractTransactionsFiltered = contractTransactionsFiltered.filter(tx => functionsFilter.includes(tx.inputDecoded.method))
    }
    if (gasUsedFilter) {
        contractTransactionsFiltered = contractTransactionsFiltered.filter(tx => tx.gasUsed >= gasUsedFilter[0] && tx.gasUsed <= gasUsedFilter[1])
    }
    if (gasPriceFilter) {
        contractTransactionsFiltered = contractTransactionsFiltered.filter(tx => tx.gasPrice >= gasPriceFilter[0] && tx.gasPrice <= gasPriceFilter[1])
    }
    if (timestampFilter) {
        const start = Math.floor(new Date(timestampFilter[0]).getTime() / 1000)
        const end = Math.floor(new Date(timestampFilter[1]).getTime() / 1000)
        contractTransactionsFiltered = contractTransactionsFiltered.filter(tx => tx.timeStamp >= start && tx.timeStamp <= end)
    }

    return contractTransactionsFiltered
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
    try {
        await hre.run('clean');
        await hre.changeNetwork(networkName, blockNumber)
        const start = new Date()
        
        
        const response = await hre.network.provider.send("debug_traceTransaction", [
            transactionHash
        ]);
        
        
    
        // fs.writeFileSync("./temporaryTrials/trace.json", JSON.stringify(response));
        // const internalCalls = response.structLogs
        // .filter(log => log.op === "CALL" || log.op === "DELEGATECALL" || log.op === "STATICCALL");

        // const indiceTemp=response.structLogs.indexOf(internalCalls[0]);

        const end = new Date()
        const requiredTime = parseFloat(((end - start) / 1000).toFixed(2))
        traceTime += requiredTime
        return {response, requiredTime}
    } catch (err) {
        console.error(err)
        throw new Error(err.message)
    }
}

/**
 * Method used to compute the extraction phase, starting from the transactions extracted from Etherscan API.
 * The transactions are filtered using the filters provided by the user, than is carried out a search of that transactions
 * in the database to avoid to process them again. If the transaction is not found in the database, then the transaction is debugged
 * to proceed with the storage decoding.
 *
 * @param contractTransactions - the transactions extracted using Etherscan API
 * @param mainContract - the main contract to decode
 * @param contractTree - the contract tree derived before to decode the storage
 * @param contractAddress - the contract address used to search the transactions in the database and to save the new ones
 * @param filters - the filters to be applied to the transactions
 * @returns {Promise<*[]>} - the blockchain log with the extracted data
 */
async function getStorageData(contractTransactions, mainContract, contractTree, contractAddress, filters,smartContract) {
    let blockchainLog = [];
    let partialInt = 0;

    // the "contractABI" are used to decode the input data of the transactions
    contractTransactions.map(tx => {
        const decoder = new InputDataDecoder(contractAbi);
        tx.inputDecoded = decoder.decodeData(tx.input);
    })

    // apply filters to the transactions
    const transactionsFiltered = applyFilters(contractTransactions, filters)
    // stringify([], {header: true, columns: csvColumns}, (err, output) => {
    //     fs.writeFileSync('csvLogs.csv', output)
    // })

    // before to start the extraction, the connection to the database is established to check if the transaction has already been processed
    await connectDB(networkName)
    const batchSize = 5
        for (let i = 0; i < transactionsFiltered.length; i += batchSize) {
            const batch = transactionsFiltered.slice(i, i + batchSize);
            for (const tx of batch) {
                try {
                    let query = {
                        transactionHash: tx.hash.toLowerCase(),
                        contractAddress: contractAddress.toLowerCase()
                    }
            
                    const response = await searchTransaction(query,networkName)
                    console.log("Transactions found -> ", response);
            
            
                    if (response) {
                        console.log("transaction already processed: ", tx.hash)
                        const {_id, __v, ...transactionData} = response[0]
                        blockchainLog.push(transactionData);
                        console.log("-----------------------------------------------------------------------");
                    } else {
                        console.log("Processing transaction " + partialInt)
                        console.log(tx.hash);
                        let {response, requiredTime} = await debugTransaction(tx.hash, tx.blockNumber)
            
                        //if(partialInt < 10){
                        const start = new Date()
                        const pastEvents = await getEvents(tx.hash, Number(tx.blockNumber), contractAddress);
                        let newLog = {
                            functionName: tx.inputDecoded.method,
                            transactionHash: tx.hash,
                            blockNumber: parseInt(tx.blockNumber),
                            contractAddress: tx.to,
                            sender: tx.from,
                            gasUsed: parseInt(tx.gasUsed),
                            timestamp: '',
                            inputs: [],
                            storageState: [],
                            internalTxs: [],
                            events: pastEvents
                        };
            
                        // const decoder = new InputDataDecoder(contractAbi);
                        // const result = decoder.decodeData(tx.input);
            
                        // newLog.activity = tx.method;
                        newLog.timestamp = new Date(tx.timeStamp * 1000).toISOString()
            
                        let inputId = 0 
                        for (let i = 0; i < tx.inputDecoded.inputs.length; i++) { 
                            //check if the input value is an array or a struct
                            // TODO -> check how a Struct array is represented
                            // Deploy a SC in a Test Net and send a tx with input data to decode its structure
                            let inputName = ""
                            if (Array.isArray(tx.inputDecoded.names[i])) {
                                inputName = tx.inputDecoded.names[i].toString()
                            } else {
                                inputName = tx.inputDecoded.names[i]
                            }
            
                            if (Array.isArray(tx.inputDecoded.inputs[i])) {
                                let bufferTuple = [];
                                //if it is a struct split the sub-attributes
                                if (tx.inputDecoded.types[i].includes(",")) {
                                    const bufferTypes = tx.inputDecoded.types[i].split(",");
                                    for (let z = 0; z < tx.inputDecoded.inputs[i].length; z++) {
                                        bufferTuple.push(decodeInput(bufferTypes[z], tx.inputDecoded.inputs[i][z]));
                                    }
                                } else {
                                    for (let z = 0; z < tx.inputDecoded.inputs[i].length; z++) {
                                        bufferTuple.push(decodeInput(tx.inputDecoded.types[i], tx.inputDecoded.inputs[i][z]));
                                    }
                                }
            
                                newLog.inputs[i] = {
                                    // inputId: "inputName_" + inputId + "_" + tx.hash,
                                    inputName: inputName,
                                    type: tx.inputDecoded.types[i],
                                    inputValue: bufferTuple.toString()
                                }
                            } else {
                                newLog.inputs[i] = {
                                    // inputId: "inputName_" + inputId + "_" + tx.hash,
                                    inputName: inputName,
                                    type: tx.inputDecoded.types[i],
                                    inputValue: decodeInput(tx.inputDecoded.types[i], tx.inputDecoded.inputs[i])
                                }
                            }
                            inputId++
                        }
            
                        const storageVal = await getTraceStorage(response, tx.blockNumber, tx.inputDecoded.method, tx.hash,
                            mainContract, contractTree,smartContract);
                        newLog.storageState = storageVal.decodedValues;
                        newLog.internalTxs = storageVal.internalTxs;
                        const end = new Date()
                        const requiredDecodeTime = parseFloat(((end - start) / 1000).toFixed(2))
                        decodeTime += requiredDecodeTime
            
                        // let csvRow = []
                        // csvRow.push({
                        //     transactionHash: tx.hash,
                        //     debugTime: requiredTime,
                        //     decodeTime: requiredDecodeTime,
                        //     totalTime: parseFloat((requiredTime + requiredDecodeTime).toFixed(2))
                        // })
                        // stringify(csvRow, (err, output) => {
                        //     fs.appendFileSync('csvLogs.csv', output)
                        // })
                        blockchainLog=newLog
                        //TODO: remember to remove the comment
                        await saveTransaction(newLog, tx.to)
                        response = null
                        // fs.rmSync("../BlockchainDataExtraction/cache/hardhat-network-fork/rpc_cache/eth-mainnet.g.alchemy.com",{recursive: true, force: true});
            
                        
                        
                        console.log("-----------------------------------------------------------------------");
            
                    }
                } catch (err) {
                  console.error(`Error processing tx ${tx.hash}:`, err);
                }
                partialInt++;
                // 🧹 Clear memory manually
                if (global.gc) global.gc();
            }
        }
    console.log("Extraction finished")
    // await removeCollectionFromDB(networkName);
    // await mongoose.disconnect()
    // fs.writeFileSync('abitest.json', JSON.stringify(blockchainLog));
    return blockchainLog;
}

async function removeCollectionsInOrder(contractAddress, networkMain,backlog) {
    try {
        await removeCollectionFromDB(networkMain).then(()=>removeAddressCollection(contractAddress,backlog)); // Executes first
        // await removeAddressCollection(contractAddress, backlog); // Executes after the first one completes
        console.log("Both collections deleted successfully.");
    } catch (error) {
        console.error("Error in removing collections:", error);
    }
}
async function removeCollectionFromDB(network){
    try {
        await connectDB(network);
        await mongoose.connection.db.dropCollection('ExtractionLog');
        await mongoose.connection.db.dropCollection('ExtractionAbi');

    } catch (err) {
        if (err.code === 26) {
            console.log(`Collection ExtractionLog does not exist.`);
        } else {
            console.error(`Error deleting collection ExtractionLog:`, err);
        }
    }
}
async function removeAddressCollection(contractAddress,network){
    try {
        await connectDB(network);
        await mongoose.connection.db.dropCollection(contractAddress);

    } catch (err) {
        if (err.code === 26) {
            console.log(`Collection  does not exist.`);
        } else {
            console.error(`Error deleting collection :`, err);
        }
    }
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
    /* const provider = ganache.provider({
         network_id: 1,
         fork: 'https://mainnet.infura.io/v3/f3851e4d467341f1b5927b6546d9f30c\@' + blockNumber
     });
     const response = await provider.request({
         method: "debug_traceTransaction",
         params: [transactionHash]
     });*/

    // await helpers.reset(web3Endpoint, Number(blockNumber));
    //  hre.network.config.forking.blockNumber = Number(blockNumber);
    // console.log(hre.config);
    //check for historical fork

    // await hre.network.provider.request({
    //     method: "hardhat_reset",
    //     params: [
    //         {
    //             forking: {
    //                 jsonRpcUrl: web3Endpoint,
    //                 blockNumber: Number(blockNumber)
    //             }
    //         }
    //     ]
    // })

    // const response = await hre.network.provider.send("debug_traceTransaction", [
    //     transactionHash
    // ]);
    //used to store the storage changed by the function. Used to compare the generated keys
    let functionStorage = {};
    //used to store all the keys potentially related to a dynamic structure
    /* let functionKeys = [];
     let functionStorageIndexes = [];*/
    let index = 0;
    let trackBuffer = [];
    let bufferPC = -10;
    let sstoreBuffer = [];
    const sstoreOptimization = []
    let internalCalls = [];
    let keccakBeforeAdd = {};

    const sstoreToPrint = []
    if(global.gc) global.gc();
    // fs.writeFileSync("./temporaryTrials/trace.json", JSON.stringify(traceDebugged.structLogs), {flag: "a+"});
    if (traceDebugged.structLogs) {
        for (const trace of traceDebugged.structLogs) {
            //if SHA3 is found then read all keys before being hashed
            // computation of the memory location and the storage index of a complex variable (mapping or struct)
            // in the stack we have the offset and the lenght of the memory
            if (trace.op === "KECCAK256") {

                bufferPC = trace.pc;
                const stackLength = trace.stack.length;
                const memoryLocation = trace.stack[stackLength - 1];
                //the memory contains 32 byte words so the hex index is converted to number and divided by 32
                //in this way the index in the memory arrays is calculated
                let numberLocation = web3.utils.hexToNumber("0x" + memoryLocation) / 32;
                let storageIndexLocation = numberLocation + 1;
                //take the key from the memory
                const hexKey = trace.memory[numberLocation];
                //take the storage slot from the memory
                const hexStorageIndex = trace.memory[storageIndexLocation];
                trackBuffer[index] = {
                    hexKey: hexKey,
                    hexStorageIndex: hexStorageIndex
                };
                // console.log("----KECCAK WITH PC:----", trace.pc)
                // console.log("----LEFT:", hexKey)
                // console.log("----RIGHT:", hexStorageIndex)
                // end of a function execution -> returns the storage state with the keys and values in the storage
            } else if (trace.op === "STOP") {

                //retrieve the entire storage after function execution
                //for each storage key discard the ones of static variables and compare the remaining ones with the re-generated
                // console.log("------STOP OPCODE-------");
                //console.log(trace);
                for (const slot in trace.storage) {
                    functionStorage[slot] = trace.storage[slot];
                }
            } else if (trace.pc === (bufferPC + 1)) {
                /*console.log("----AFTER KECCAK:----", trace.pc)
                console.log("----RIGHT:", trace.stack[trace.stack.length - 1])*/
                keccakBeforeAdd = trackBuffer[index];
                bufferPC = -10;
                trackBuffer[index].finalKey = trace.stack[trace.stack.length - 1];
                keccakBeforeAdd = trackBuffer[index];
                index++;
                //todo compact with code below
                if(trace.op == "ADD" && (trace.stack[trace.stack.length - 1] === keccakBeforeAdd.finalKey ||
                        trace.stack[trace.stack.length - 2] === keccakBeforeAdd.finalKey) &&

                    keccakBeforeAdd.hexStorageIndex === "0000000000000000000000000000000000000000000000000000000000000000") {

                    const keyBuff =  trackBuffer[index-1].hexKey;
                    const slotBuff =  trackBuffer[index-1].hexStorageIndex;
                    trackBuffer[index-1].hexKey = slotBuff;
                    trackBuffer[index-1].hexStorageIndex = keyBuff;

                    // console.log("----ADD OPCODE----")
                    // console.log("----first", trace.stack[trace.stack.length - 1]);
                    // console.log("----second", trace.stack[trace.stack.length - 2]);
                    

                }
            }
                //in case the trace is a SSTORE save the key. CAUTION: not every SSTORE changes the final storage state but every storage state change has an sstore
                // SSTORE -> updates the storage state
            // in the code we save the stack updated with the new value (the last element of the stack is the value to store in the storage slot)
            else if (trace.op === "SSTORE") {
                sstoreToPrint.push(trace)
                // used to store the entire stack of the SSTORE for the optimization
                sstoreOptimization.push(trace.stack)
                // the last element of the stack is the storage slot in which data is pushed
                sstoreBuffer.push(trace.stack[trace.stack.length - 1]);

                // console.log("----SSTORE PUSHING:----")
                // console.log("----storage slot:", trace.stack[trace.stack.length - 1])
                // console.log("----value:", trace.stack[trace.stack.length - 2])

            } else if(trace.op == "ADD"){
                /*ADD is the opcode that in case of arrays adds the next position to start to the computed keccak
                if this is found and one of the inputs is the keccak and the previous keccak has 0 as slot then manage
                this means that the keccak found is related to an array and we need to swap the slot with the key
                this because for mappings we have K(h(k) . slot) while in arrays K(slot . 0x0...)*/

                // console.log("----ADD OPCODE----")
                // console.log("----first", trace.stack[trace.stack.length - 1]);
                // console.log("----second", trace.stack[trace.stack.length - 2]);
                /*console.log(keccakBeforeAdd.finalKey);
                console.log(keccakBeforeAdd.hexStorageIndex);*/

                if ((trace.stack[trace.stack.length - 1] === keccakBeforeAdd.finalKey ||
                        trace.stack[trace.stack.length - 2] === keccakBeforeAdd.finalKey) &&

                    keccakBeforeAdd.hexStorageIndex === "0000000000000000000000000000000000000000000000000000000000000000"){
                    const keyBuff =  trackBuffer[index-1].hexKey;
                    const slotBuff =  trackBuffer[index-1].hexStorageIndex;
                    trackBuffer[index-1].hexKey = slotBuff;
                    trackBuffer[index-1].hexStorageIndex = keyBuff;
                    
                }
            } else if (trace.op === "CALL") {
                //read the offset from the stack
                const offsetBytes = trace.stack[trace.stack.length - 4];
                //convert the offset to number 896
                let offsetNumber =Math.trunc( web3.utils.hexToNumber("0x" + offsetBytes) / 32);
                //read the length of the memory to read 914
                const lengthBytes = trace.stack[trace.stack.length - 5];
                //convert the length to number
                let lengthNumber =Math.trunc( web3.utils.hexToNumber("0x" + lengthBytes) / 32);
                //create the call object
                let stringDepthConstruction="";
                for(let i=0;i<trace.depth-1;i++){
                    stringDepthConstruction+="_1";
                }
                // internalTxId + "_" + transactionHash,

                let call = {
                    callId: "call_0" + stringDepthConstruction,
                    callType: trace.op,
                    callDepth: trace.depth,
                    gasUsed: web3.utils.hexToNumber("0x"+trace.stack[trace.stack.length - 1]),
                    value: trace.stack[trace.stack.length - 3],
                    to: "0x"+trace.stack[trace.stack.length - 2].slice(-40),
                    inputsCall: ""
                }
                let stringMemory="";
                trace.memory.forEach((element)=>{
                    stringMemory+=element;
                })
                //taglio i valori che mi interessano 
                stringMemory=stringMemory.slice(web3.utils.hexToNumber("0x" + offsetBytes)*2, (web3.utils.hexToNumber("0x" + offsetBytes)*2)+web3.utils.hexToNumber("0x" + lengthBytes)*2);
                call.inputsCall=stringMemory;

                //read all the inputs from the memory and insert it in the call object
                // let stringTemp="";
                // for (let i = offsetNumber; i <= offsetNumber + lengthNumber; i++) {
                //     call.inputsCall.push(trace.memory[i]);
                //     stringTemp+=trace.memory[i];
                // }
                // console.log("string Temp", stringTemp);
                internalCalls.push(call);
            } else if (trace.op === "DELEGATECALL" || trace.op === "STATICCALL") {
                // internalCalls.push(trace.stack[trace.stack.length - 2]);
                const offsetBytes = trace.stack[trace.stack.length - 3];
                let offsetNumber = await web3.utils.hexToNumber("0x" + offsetBytes) / 32;
                const lengthBytes = trace.stack[trace.stack.length - 4];
                let lengthNumber = await web3.utils.hexToNumber("0x" + lengthBytes) / 32;
                let stringDepthConstruction="";
                for(let i=0;i<trace.depth-1;i++){
                    stringDepthConstruction+="_1";
                }
                let call = {
                    callId: "call_0" + stringDepthConstruction,
                    callType: trace.op,
                    callDepth: trace.depth,
                    gas: web3.utils.hexToNumber("0x"+trace.stack[trace.stack.length - 1]),
                    to: "0x"+trace.stack[trace.stack.length - 2].slice(-40),
                    inputsCall: ""
                }
                let stringMemory="";
                trace.memory.forEach((element)=>{
                    stringMemory+=element;
                })
                 //taglio i valori che mi interessano 
                 stringMemory=stringMemory.slice(web3.utils.hexToNumber("0x" + offsetBytes)*2, (web3.utils.hexToNumber("0x" + offsetBytes)*2)+web3.utils.hexToNumber("0x" + lengthBytes)*2);
                 call.inputsCall=stringMemory;
 
                // for (let i = offsetNumber; i <= offsetNumber + lengthNumber; i++) {
                //     call.inputsCall.push(trace.memory[i]);
                // }
                internalCalls.push(call);
            } else if (trace.op === "RETURN") {
                //console.log("---------RETURN---------")
                //console.log(trace);
            }
//             fs.writeFileSync("./temporaryTrials/trace.json", JSON.stringify(trace), {flag: "a+"});
        }
    }
    if (traceDebugged.structLogs) {
        for (const trace of traceDebugged.structLogs) {

            //if SHA3 is found then read all keys before being hashed
            // computation of the memory location and the storage index of a complex variable (mapping or struct)
            // in the stack we have the offset and the lenght of the memory
            if (trace.op === "KECCAK256") {

                bufferPC = trace.pc;
                const stackLength = trace.stack.length;
                const memoryLocation = trace.stack[stackLength - 1];
                //the memory contains 32 byte words so the hex index is converted to number and divided by 32
                //in this way the index in the memory arrays is calculated
                let numberLocation = web3.utils.hexToNumber("0x" + memoryLocation) / 32;
                let storageIndexLocation = numberLocation + 1;
                //take the key from the memory
                const hexKey = trace.memory[numberLocation];
                //take the storage slot from the memory
                const hexStorageIndex = trace.memory[storageIndexLocation];
                trackBuffer[index] = {
                    hexKey: hexKey,
                    hexStorageIndex: hexStorageIndex
                };
                // console.log("----KECCAK WITH PC:----", trace.pc)
                // console.log("----LEFT:", hexKey)
                // console.log("----RIGHT:", hexStorageIndex)
                // end of a function execution -> returns the storage state with the keys and values in the storage
            } else if (trace.op === "STOP") {
                //retrieve the entire storage after function execution
                //for each storage key discard the ones of static variables and compare the remaining ones with the re-generated
                // console.log("------STOP OPCODE-------");
                //console.log(trace);
                for (const slot in trace.storage) {
                    functionStorage[slot] = trace.storage[slot];
                }
            } else if (trace.pc === (bufferPC + 1)) {
                /*console.log("----AFTER KECCAK:----", trace.pc)
                console.log("----RIGHT:", trace.stack[trace.stack.length - 1])*/
                keccakBeforeAdd = trackBuffer[index];
                bufferPC = -10;
                trackBuffer[index].finalKey = trace.stack[trace.stack.length - 1];
                // console.log(trackBuffer[index]);
                index++;
                //todo compact with code below
                // console.log('keccakBeforeAdd', keccakBeforeAdd)
                // console.log('trace.stack[trace.stack.length - 1]', trace.stack[trace.stack.length - 1])
                // console.log('trace.stack[trace.stack.length - 2]',trace.stack[trace.stack.length - 2])
                if(trace.op == "ADD" && (trace.stack[trace.stack.length - 1] === keccakBeforeAdd.finalKey ||
                        trace.stack[trace.stack.length - 2] === keccakBeforeAdd.finalKey) &&
                    keccakBeforeAdd.hexStorageIndex === "0000000000000000000000000000000000000000000000000000000000000000") {
                        // console.log('PRIMO ADD ')
                        // console.log('trace stack', trace.stack)

                    const keyBuff =  trackBuffer[index-1].hexKey;
                    const slotBuff =  trackBuffer[index-1].hexStorageIndex;
                    trackBuffer[index-1].hexKey = slotBuff;
                    trackBuffer[index-1].hexStorageIndex = keyBuff;
                    const nextTrace=traceDebugged.structLogs[traceDebugged.structLogs.indexOf(trace)+1];
                    const nextTraceStack=nextTrace.stack[nextTrace.stack.length - 1];
                    // console.log( nextTraceStack);
                    trackBuffer[index-1].finalKey =nextTraceStack;
                    // console.log("----ADD OPCODE----")
                    // console.log("----first", trace.stack[trace.stack.length - 1]);
                    // console.log("----second", trace.stack[trace.stack.length - 2]);
                    trackBuffer[index-1].indexSum= trace.stack[trace.stack.length - 2];
                }
            }
                //in case the trace is a SSTORE save the key. CAUTION: not every SSTORE changes the final storage state but every storage state change has an sstore
                // SSTORE -> updates the storage state
            // in the code we save the stack updated with the new value (the last element of the stack is the value to store in the storage slot)
            else if (trace.op === "SSTORE") {
                sstoreToPrint.push(trace)
                // used to store the entire stack of the SSTORE for the optimization
                sstoreOptimization.push(trace.stack)
                // the last element of the stack is the storage slot in which data is pushed
                sstoreBuffer.push(trace.stack[trace.stack.length - 1]);
                // console.log("----SSTORE PUSHING:----")
                // console.log("----storage slot:", trace.stack[trace.stack.length - 1])
                // console.log("----value:", trace.stack[trace.stack.length - 2])
            } else if(trace.op == "ADD"){
                // console.log('SECONDO ADD')
                /*ADD is the opcode that in case of arrays adds the next position to start to the computed keccak
                if this is found and one of the inputs is the keccak and the previous keccak has 0 as slot then manage
                this means that the keccak found is related to an array and we need to swap the slot with the key
                this because for mappings we have K(h(k) . slot) while in arrays K(slot . 0x0...)*/
                // console.log("----ADD OPCODE----")
                // console.log("----first", trace.stack[trace.stack.length - 1]);
                // console.log("----second", trace.stack[trace.stack.length - 2]);
                /*console.log(keccakBeforeAdd.finalKey);
                console.log(keccakBeforeAdd.hexStorageIndex);*/

                if ((trace.stack[trace.stack.length - 1] === keccakBeforeAdd.finalKey ||
                        trace.stack[trace.stack.length - 2] === keccakBeforeAdd.finalKey) &&
                    keccakBeforeAdd.hexStorageIndex === "0000000000000000000000000000000000000000000000000000000000000000"){
                    const keyBuff =  trackBuffer[index-1].hexKey;
                    const slotBuff =  trackBuffer[index-1].hexStorageIndex;
                    trackBuffer[index-1].hexKey = slotBuff;
                    trackBuffer[index-1].hexStorageIndex = keyBuff;
                }
            } else if (trace.op === "CALL") {
                //read the offset from the stack
                const offsetBytes = trace.stack[trace.stack.length - 4];
                //convert the offset to number
                let offsetNumber = web3.utils.hexToNumber("0x" + offsetBytes) / 32;
                //read the length of the memory to read
                const lengthBytes = trace.stack[trace.stack.length - 5];
                //convert the length to number
                let lengthNumber = web3.utils.hexToNumber("0x" + lengthBytes) / 32;
                //create the call object
                let stringDepthConstruction="";
                for(let i=0;i<trace.depth-1;i++){
                    stringDepthConstruction+="_1";
                }
                let call = {
                    callId: "call_0" + stringDepthConstruction,
                    callType: trace.op,
                    callDepth: trace.depth,
                    gasUsed: web3.utils.hexToNumber("0x"+trace.stack[trace.stack.length - 1]),
                    value: trace.stack[trace.stack.length - 3],
                    to: "0x"+trace.stack[trace.stack.length - 2].slice(-40),
                    inputsCall: ""
                }
                let stringMemory="";
                trace.memory.forEach((element)=>{
                    stringMemory+=element;
                })
                 //taglio i valori che mi interessano 
                 stringMemory=stringMemory.slice(web3.utils.hexToNumber("0x" + offsetBytes)*2, (web3.utils.hexToNumber("0x" + offsetBytes)*2)+web3.utils.hexToNumber("0x" + lengthBytes)*2);
                 call.inputsCall=stringMemory;
                //read all the inputs from the memory and insert it in the call object
                // for (let i = offsetNumber; i <= offsetNumber + lengthNumber; i++) {
                //     call.inputsCall.push(trace.memory[i]);
                // }
                internalCalls.push(call);
            } else if (trace.op === "DELEGATECALL" || trace.op === "STATICCALL") {
                // internalCalls.push(trace.stack[trace.stack.length - 2]);
                const offsetBytes = trace.stack[trace.stack.length - 3];
                let offsetNumber = await web3.utils.hexToNumber("0x" + offsetBytes) / 32;
                const lengthBytes = trace.stack[trace.stack.length - 4];
                let lengthNumber = await web3.utils.hexToNumber("0x" + lengthBytes) / 32;
                let stringDepthConstruction="";
                for(let i=0;i<trace.depth-1;i++){
                    stringDepthConstruction+="_1";
                }
                let call = {
                    callId: "call_0" + stringDepthConstruction,
                    callType: trace.op,
                    callDepth: trace.depth,
                    gas: web3.utils.hexToNumber("0x"+trace.stack[trace.stack.length - 1]),
                    to: "0x"+trace.stack[trace.stack.length - 2].slice(-40),
                    inputsCall: ""
                }
                let stringMemory="";
                trace.memory.forEach((element)=>{
                    stringMemory+=element;
                })
                 //taglio i valori che mi interessano 
                 stringMemory=stringMemory.slice(web3.utils.hexToNumber("0x" + offsetBytes)*2, (web3.utils.hexToNumber("0x" + offsetBytes)*2)+web3.utils.hexToNumber("0x" + lengthBytes)*2);
                 call.inputsCall=stringMemory;
                // for (let i = offsetNumber; i <= offsetNumber + lengthNumber; i++) {
                //     call.inputsCall.push(trace.memory[i]);
                // }
                internalCalls.push(call);
            } else if (trace.op === "RETURN") {
                //console.log("---------RETURN---------")
                //console.log(trace);
            }
//             fs.writeFileSync("./temporaryTrials/trace.json", JSON.stringify(trace), {flag: "a+"});
        }
    }
    
    // fs.writeFileSync("./temporaryTrials/sstoreToPrint.json", JSON.stringify(sstoreToPrint))
    // fs.writeFileSync("./temporaryTrials/storeBuffer.json", JSON.stringify(sstoreBuffer));
    let finalShaTraces = [];
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
                    console.log("storage è semplice quindi lo salvo", trackBuffer[test].hexStorageIndex)
                    trace.hexStorageIndex = trackBuffer[test].hexStorageIndex;
                    flag = true;
                    finalShaTraces.push(trace);
                }
            }
            finalShaTraces.push(trace);
            sstoreBuffer.splice(sstoreBuffer.indexOf(trackBuffer[i].finalKey), 1);
        }

    }

    //const uniqueTraces = Array.from(new Set(finalTraces.map(JSON.stringify))).map(JSON.parse);
    //removes duplicate storing keys, it will catch only the last update done on a variable
    const uniqueSStore = Array.from(new Set(sstoreBuffer.map(JSON.stringify))).map(JSON.parse);
    // const uniqueStorage = Array.from(new Set(functionStorage.map(JSON.stringify))).map(JSON.parse);
    // fs.writeFileSync('./temporaryTrials/uniqueSStore.json', JSON.stringify(uniqueSStore));
    if (Object.keys(functionStorage).length !== 0) {
        // fs.writeFileSync(`./temporaryTrials/functionStorage_${transactionHash}.json`, JSON.stringify(functionStorage));
        // fs.writeFileSync('./temporaryTrials/finalShaTraces.json', JSON.stringify(finalShaTraces));
    }

    const sstoreObject = {sstoreOptimization, sstoreBuffer}
    // console.log("------FINAL SHA TRACES------")
    // console.log(finalShaTraces);
    // console.log(regroupShatrace(finalShaTraces))
    finalShaTraces=regroupShatrace(finalShaTraces);
    const decodedValues = await optimizedDecodeValues(sstoreObject, contractTree, finalShaTraces, functionStorage, functionName, mainContract,web3,contractCompiled);
    // const decodedValues = await decodeValues(sstoreObject, contractTree, finalShaTraces, functionStorage, functionName, mainContract);
    const internalTxs= await decodeInternalTransaction(internalCalls,apiKey,smartContract,endpoint,web3,networkName)
    return {decodedValues, internalTxs};
}
function regroupShatrace(finalShaTraces){
    return Array.from(
        new Map(finalShaTraces.map(item => [item.finalKey + item.hexStorageIndex, item])).values()
      );
}
//cleanTest(18424870, "sendFrom", "0x446f97e43687382fefbc6a9c4cccd055829ef2909997fb102a1728db6b37b76a", "CakeOFT");

//function for re-generating the key and understand the variable thanks to the tests on the storage locationapprove(address spender,uint256 amount)0x095ea7b3


/**
 * Method used to return the variable to decode from the contract tree according to the storage slot identified
 *
 * @param slotIndex - the storage slot index of the variable to decode
 * @param contractTree - the contract tree used to identify the contract variables with the 'mainContract'
 * @param functionName - the function name of the invoked method
 * @param mainContract - the main contract to decode, used to identify the contract variables
 * @returns {*[]} - the contract variables to decode
 */
function getContractVariable(slotIndex, contractTree, functionName, mainContract) {
    /*console.log("-----------contract treeee-----")
    console.log(contractTree)
    console.log("-----------function name-----")
    console.log(functionName)
    console.log("-----------main contract-----")
    console.log(mainContract)*/
    let contractVariables = [];
    //iterates all contracts in contract tree
    for (const contractId in contractTree) {
        //console.log("-------contractId-------");
        //console.log(contractId);
        //if contract is the chosen one and it has function then take variable
        // && contractTree[contractId].functions.includes(functionName) do we really need this?
        if (contractTree[contractId].name === mainContract) {
            //iterate contract variables
            //console.log("-----------sono nell'if e sto vedendo il tree dell'id specifico-----")
            //console.log(contractTree[contractId]);
            for (let i = 0; i < contractTree[contractId].storage.length; i++) {
                if (Number(contractTree[contractId].storage[i].slot) === Number(slotIndex)) {
                    contractVariables.push(contractTree[contractId].storage[i]);
                } else if (i < contractTree[contractId].storage.length - 1) {
                    if (Number(contractTree[contractId].storage[i].slot) <= Number(slotIndex) && Number(contractTree[contractId].storage[i + 1].slot) > Number(slotIndex)) {
                        contractVariables.push(contractTree[contractId].storage[i]);
                    }
                }
            }
            // for (const contractVariable of contractTree[contractId].storage) {
            //     //check if there are more variables for the same index due to optimization purposes
            //     if (Number(contractVariable.slot) === Number(slotIndex)) {
            //         contractVariables.push(contractVariable);
            //     }
            // }
        }
    }
    return contractVariables;
}

//used to merge storage variables of structs member in static array
function mergeVariableValues(arr) {
    console.log("merge variable values ");
    console.log(arr);
    // fs.writeFileSync('formattest.json', JSON.stringify(arr));

    return Object.values(arr.reduce((acc, item) => {


        if (typeof item.variableValue === "string" && item.variableValue.includes("arrayIndex")) {
            const variableValue = JSON.parse(item.variableValue);
            const arrayIndex = variableValue.arrayIndex;
            const key = `${arrayIndex}_${item.type}`
            if (!acc[key]) {
                acc[key] = {
                    ...item,
                    variableValue: variableValue
                };
            } else {
                acc[key].variableValue = {
                    ...acc[key].variableValue,
                    ...variableValue
                };
            }
        } else {
            acc[item.variableName] = item
        }

        return acc;
    }, {})).map(item => ({
        ...item,
        variableValue: typeof item.variableValue === "object" ? JSON.stringify(item.variableValue) : item.variableValue
    }));
}

/**
 * Method used to decode the value of a variable and it is called for each detected variable in the storage state
 *
 * @param sstore - contains the sstore optimization, including an array of stacks, and the sstore buffer with the variable storage slot
 * @param contractTree - the contract tree used to identify the contract variables with the 'mainContract'
 * @param shaTraces - the final traces of the storage keys
 * @param functionStorage - the storage state of the smart contract
 * @param functionName - the function name of the invoked method, useful to decode the storage state
 * @param mainContract - the main contract to decode, used to identify the contract variables
 * @returns {Promise<(*&{variableValue: string|string|*})[]>} - the decoded value of the detected variable
 */
async function decodeValues(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract) {
    console.log("SSTORE");
    console.log(sstore);
    console.log("-------NEW DECODE VALUES---------");
    let decodedValues = [];
    console.log("-------SHA TRACES---------")
    console.log(shaTraces);
    console.log("-------FUNCTION STORAGE---------")
    console.log(functionStorage);
    let flag=true;
    // if(shaTraces){
    //     const slotIndex = web3.utils.hexToNumber("0x" + shaTraces[0].hexStorageIndex);
    //     console.log("slot indexxxx", slotIndex);
    //     const contractVar = getContractVariable(slotIndex, contractTree, functionName, mainContract);
    //     console.log("contract var", contractVar);
    //     if(contractVar[0].type.includes("array")){
    //         console.log("Caso 1")
    //     }
    // }
    //iterate storage keys looking for complex keys coming from SHA3

    for (const storageVar in functionStorage) {
        for (const shaTrace of shaTraces) {
            console.log('StorageVar=== shaTrace.finalKey', storageVar,shaTrace.finalKey)
            if (storageVar === shaTrace.finalKey) {

                console.log("SONO NEL CASO 1")
                console.log(shaTrace)
                console.log(storageVar)
                const slotIndex = web3.utils.hexToNumber("0x" + shaTrace.hexStorageIndex);
                console.log("slot indexxxx", slotIndex);
                const contractVar = getContractVariable(slotIndex, contractTree, functionName, mainContract);
                console.log("contract var", contractVar);
                console.log("E string ",!contractVar[0].type.includes("string"))
                if(!contractVar[0].type.includes("string")){

                    const decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage);
                    const bufferVariable = {
                        variableId: "variable_" + contractVar[0].name + "_" + _contractAddress,
                        variableName: contractVar[0].name,
                        type: contractVar[0].type,
                        variableValue: decodedValue,
                        variableRawValue: functionStorage[storageVar]
                    };
                    decodedValues.push(bufferVariable);
                }

            }
        }
    }
    //storage should have only non-complex keys so only simple numbers representing slots
    //todo deal with variables storage optimizations
    //todo deal with sstore complex keys not present in any SHA

    let optimizedArray = []
    const {sstoreOptimization, sstoreBuffer} = sstore
    console.log(flag)
    if(flag){
        console.log("SONO NEL CASO sotto")
        for (const storageVar in functionStorage) {
            for (let sstoreIndex = 0; sstoreIndex < sstoreBuffer.length; sstoreIndex++) {
                const numberIndex = web3.utils.hexToNumber("0x" + sstoreBuffer[sstoreIndex]);
                if (storageVar === sstoreBuffer[sstoreIndex]) {
                    const contractVar = getContractVariable(numberIndex, contractTree, functionName, mainContract);
                    if (contractVar.length > 1) {
                        console.log("SONO NEL CASO 2")

                        const updatedVariables = readVarFromOffset(contractVar, functionStorage[storageVar]);
                        for (let varI = 0; varI < updatedVariables.length; varI++) {
                            const decodedValue = decodeStorageValue(updatedVariables[varI], updatedVariables[varI].value, mainContract, storageVar, functionStorage);
                            const bufferVariable = {
                                variableId: "variable_" + contractVar[varI].name + "_" + _contractAddress,
                                variableName: updatedVariables[varI].name,
                                type: updatedVariables[varI].type,
                                variableValue: decodedValue,
                                variableRawValue: updatedVariables[varI].value
                            };
                            decodedValues.push(bufferVariable);
                        }
                        
                    } else if (contractVar.length === 1) {
                        let decodedValue;
                        // handle array with data optimization
                        const regexUintArray = /(array.*(?:uint|int))|((?:uint|int).*array)/
                        if (regexUintArray.test(contractVar[0].type)/* && !contractVar[0].type.includes("int256")*/) {
                            console.log("SONO NEL CASO 3")

                            optimizedArray.push({contractVar: contractVar[0], storageVar})
                            const optimezedVariables = optimizedArray.reduce((acc, item) => {
                                if (item.name === contractVar.name && item.type === contractVar.type && item.storageVar === storageVar) {
                                    acc.push(item)
                                }
                                return acc
                            }, [])

                            contractVar[0].index = optimezedVariables.length - 1
                            decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage, sstoreOptimization)
                        } else {
                            console.log("SONO NEL CASO 4")
                            //TODO se è un string devo passare tutto il functionStorage soprattutto se è una string a più lunga di un bytes
                            decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage)
                        }

                        const bufferVariable = {
                            variableId: "variable_" + contractVar[0].name + "_" + _contractAddress,
                            variableName: contractVar[0].name,
                            type: contractVar[0].type,
                            variableValue: decodedValue,
                            variableRawValue: functionStorage[storageVar]
                        };
                        decodedValues.push(bufferVariable);
                    }

                }
            }
        }
    }
    decodedValues = mergeVariableValues(decodedValues);

    return decodedValues;
}

function readVarFromOffset(variables, value) {
    const fullWord = value.split('');
    let len = fullWord.length;
    for (let i = 0; i < variables.length; i++) {
        variables[i].value = "";
        // [0,0,0,0,0,0,0,0,0,0,0,0,1,1] takes from the bytes offset to the end of the array
        //last values optimized are inserted at the end of the hex
        if (variables[i + 1] !== undefined) {
            //check if the offset is the first starting from 0
            if (variables[i].offset === 0) {
                const nextOffset = (variables[i + 1].offset) * 2;
                len = len - nextOffset;
                const slicedWord = fullWord.splice(len, nextOffset);
                variables[i].value = slicedWord.join('');
            } else {
                const nextOffset = (variables[i + 1].offset) * 2;
                len = len - nextOffset;
                const slicedWord = fullWord.slice(len, nextOffset);
                variables[i].value = slicedWord.join('');
            }
        } else {
            variables[i].value = fullWord.join('');
        }
    }
    return variables;
}

/**
 * Method used to decode the primitive types in Solidity
 *
 * @param type - the type of the variable to decode
 * @param value - the raw value of the variable to decode
 * @returns {*|number|string} - the decoded value of the variable
 */
function decodePrimitiveType(type, value) {
    console.log("variabileeee", value);
    if (type.includes("uint")) {
        return Number(web3.utils.hexToNumber("0x" + value))
    } else if (type.includes("string")) {
        let chars = value.split("0")[0]
        if (chars.length % 2 !== 0) chars = chars + "0"
        return web3.utils.hexToAscii("0x" + chars)
    } else if (type.includes("bool")) {
        return web3.eth.abi.decodeParameter("bool", "0x" + value);
    } else if (type.includes("bytes")) {
        return JSON.stringify(web3.utils.hexToBytes("0x" + value)).replace("\"", "");
    } else if (type.includes("address")) {
        return "0x" + value.slice(-40);
    } else if (type.includes("enum")) {
        let bigIntvalue = web3.eth.abi.decodeParameter("uint256", "0x" + value)
        return Number(bigIntvalue)
    }
    return value
}

/**
 * Method used to get the main contract compiled to identify the members of a struct
 *
 * @param mainContract - the main contract with the struct
 * @returns {*} - the main contract compiled
 */
function getMainContractCompiled(mainContract) {
    const testContract = JSON.parse(contractCompiled);
    for (const contract in testContract.contracts) {
        const firstKey = Object.keys(testContract.contracts[contract])[0];
        if (firstKey === mainContract) {
            return testContract.contracts[contract][firstKey]
        }
    }
}

/**
 * Method used to find the members of a struct starting from the struct type
 * and the main contract compiled
 *
 * @param type - the struct type to find
 * @param mainContractCompiled - the main contract compiled
 * @returns {*[]} - the members of the struct
 */
function getStructMembersByStructType(type, mainContractCompiled) {
    let members = []
    const storageTypes = mainContractCompiled.storageLayout.types;
    for (const storageType in storageTypes) {
        if (storageType.includes(type)) {
            members = storageTypes[storageType].members
        }
    }
    return members
}

function getStructMembersByVariableName(variableName, mainContractCompiled) {
    let members = []
    const storageLayout = mainContractCompiled.storageLayout.storage;
    storageLayout.forEach((item) => {
        if (item.label === variableName) {
            const structType = item.type;
            const storageTypes = mainContractCompiled.storageLayout.types;
            for (type in storageTypes) {
                if (type === structType) {
                    members = storageTypes[type].members
                }
            }
        }
    })
    return members
}

/**
 * Method used to decode a struct type starting from the compiled contract to
 * find the struct member. The member of a struct are stored like the array,
 * each slot contains a member of the struct (except for members with otpimization),
 * so the first slot of the struct corresponds to the first member, from there it is
 * enough to iterate the consecutive slots up to the number of members.
 *
 * @param variable - the variable to decode
 * @param value - the value of the variable to decode, depends on the variable type
 * @param mainContract - used to identify the members of a struct
 * @param storageVar - the storage slot of the variable to decode
 * @returns {string} - the value of the struct
 */
function decodeStructType(variable, value, mainContract, storageVar) {
    const getContractCompiled = getMainContractCompiled(mainContract);
    const members = getStructMembersByVariableName(variable.name, getContractCompiled);
    const memberItem = {
        struct: variable.type.split("(")[1].split(")")[0],
    }
    // TODO array member
    // TODO mapping member
    // TODO optimization (uint8, uint16, uint32)
    members.forEach((member) => {
        const memberSlot = Number(member.slot) + Number(variable.slot)
        if (memberSlot === web3.utils.toDecimal("0x" + storageVar)) {
            memberItem[member.label] = decodePrimitiveType(member.type, value)
        }
    })
    return JSON.stringify(memberItem)
}

/**
 * Used by the "decodeDynamicArray" method to decode the value of a dynamic array when
 * there is an optimization (with uint8, uint16, ...)
 *
 * @param arraySize - the size of the array to decode
 * @param typeSize - the size of the type of the array to figure out how many items
 *                   are included in the same string
 * @param functionStorage - the storage state of the smart contract
 * @param slot - the storage slot of the variable to decode
 * @returns {*} - the value of the updated index
 */
function optimezedArray(arraySize, typeSize, functionStorage, slot) {
    console.log('arraySize', arraySize)
    console.log('typeSize', typeSize)
    console.log('functionStorage', functionStorage)
    console.log('slot', slot)
    const storageStringLength = 64
    const charsForElement = typeSize / 4
    const elementNumberPerString = storageStringLength / charsForElement
    console.log('STAMPO FUNCTION STORAGE')
    const ending=storageStringLength - (arraySize * charsForElement)
    console.log(functionStorage[slot].slice(ending, ending+charsForElement))
    console.log('End',ending,ending+charsForElement)
    if (arraySize <= elementNumberPerString - 1) {
        const completeArrayValue=functionStorage[slot];
        // return functionStorage[slot].slice(ending, ending+charsForElement)
        return functionStorage[slot].slice(0, storageStringLength - (arraySize * charsForElement))
    } else {
        const arrayStorageSlot = Math.floor(arraySize / elementNumberPerString)
        const newSlot = BigInt("0x" + slot) + BigInt(arrayStorageSlot)
        const newStorageSlot = functionStorage[newSlot.toString(16).padStart(64, '0')]
        return newStorageSlot.slice(0, storageStringLength - (arraySize * charsForElement))
    }
}
function temp2(arraySize, typeSize, functionStorage, slot) {
    const storageStringLength = 64
    console.log("typesize: " + typeSize);
    const charsForElement = typeSize / 4
    const elementNumberPerString = storageStringLength / charsForElement
    if (arraySize <= elementNumberPerString - 1) {
        return functionStorage[slot].slice(0, storageStringLength - (arraySize * charsForElement))
    } else {
        console.log("array suze: " + arraySize);
        const arrayStorageSlot = Math.floor(arraySize / elementNumberPerString)
        console.log("array storage slot" + arrayStorageSlot);
        const newSlot = BigInt("0x" + slot) + BigInt(arrayStorageSlot)
        console.log("new slot" + newSlot);
        console.log("cose" + newSlot.toString(16).padStart(64, '0'));
        const newStorageSlot = functionStorage[newSlot.toString(16).padStart(64, '0')]
        return newStorageSlot.slice(0, storageStringLength - (arraySize * charsForElement))
    }
}

/**
 * Method used to decode a static array. Since that the length of the array is already known the method
 * decodes the value of the array at the specified index, starting from the first slot of the array and
 * iterating up to find the correct slot passed to the method. With the struct type the reasoning is similar:
 * for each member of a struct a storage slot is occupied (except for the optimization), so more consecutive
 * storage slots represent the entire struct in the array. For the structs the iteration is computed calculating
 * the number of members, in this way every time the number of members is reached the array index is incremented.
 *
 * @param variable - the variable to decode
 * @param value - the value of the variable to decode, depends on the variable type
 * @param mainContract - used to identify the members of a struct
 * @param storageVar - the storage slot of the variable to decode
 * @param arraySize - the size of the array to decode, catched from the variable type
 * @param functionStorage - the storage state of the smart contract
 * @param completeSstore - array of stacks taken from the SSTORE opcodes to identify more updates of the same variable
 * @returns {{}|string} - an object containing the array index and the value of the variable
 */
function decodeStaticArray(variable, value, mainContract, storageVar, arraySize, functionStorage, completeSstore) {
    let arrayStorageSlot = Number(variable.slot);
    const output = {}
    if (variable.type.includes("struct")) {
        const structType = variable.type.split("(")[2].split(")")[0]
        const getContract = getMainContractCompiled(mainContract);
        const structMembers = getStructMembersByStructType(structType, getContract);
        const arrayTotalSize = arraySize * structMembers.length
        let counter = 0
        let arrayIndex = -1
        for (let i = arrayStorageSlot; i < arrayTotalSize + arrayStorageSlot; i++) {
            const storageVarDec = web3.utils.toDecimal("0x" + storageVar)
            if (counter === 0) arrayIndex++
            if (storageVarDec === i) {
                const memberLabel = structMembers[counter].label
                output.arrayIndex = arrayIndex
                output.struct = structType
                output[memberLabel] = decodePrimitiveType(structMembers[counter].type, value)
                return JSON.stringify(output)
            }
            if (counter === structMembers.length - 1) {
                counter = 0
            } else {
                counter++
            }
        }
    } else {
        if (typeof variable.index !== "undefined") {
            let counter = 0
            for (let i = 0; i < completeSstore.length; i++) {
                const stack = completeSstore[i]
                if (stack[stack.length - 1] === storageVar) {
                    if (counter === variable.index) {
                        output.value = Number(web3.utils.hexToNumber("0x" + stack[stack.length - 3]))
                        return output
                    } else {
                        counter++
                    }
                }
            }

            // TODO: fix static array with optimization
            // const value = optimezedArray(arraySize - 1, variable.type.split("int")[1].split(")")[0], functionStorage, storageSlotPadded)
            // output.value = web3.utils.hexToNumber("0x" + value)
            return JSON.stringify(output)
        } else {
            for (let i = 0; i < arraySize; i++) {
                const arrayStorageSlot = Number(variable.slot) + i
                if (arrayStorageSlot === web3.utils.hexToNumber("0x" + storageVar)) {
                    output.arrayIndex = i
                    output.value = decodePrimitiveType(variable.type, value)
                    return JSON.stringify(output)
                }
            }
        }
    }
    //TODO optimize the code
}

/**
 * Method used to decode the dynamic array. In this case the first storage slot of the array
 * return the final length of that one and with a "push()" method the updated index
 * corresponds to the last index of the array. The computation of the update involves the keccak256
 * of the array storage slot, then the length of the array is summed with the outcome of the hash.
 * This operation returns the storage slot of the updated index in the storage state.
 * With the struct type the reasoning is similar: for each member of a struct a storage slot is occupied
 * (except for the optimization), so more consecutive storage slots represent the entire struct in the array.
 * For "push()" method the updated struct is computed multiplying the number of the struct members with the array size.
 * The outcome is summed to the keccak256 hash of the array storage slot.
 *
 * The situation is different when there are direct updates of indexes, the application does not yet support this case.
 *
 * @param variable - the variable to decode
 * @param value - the raw value of the variable to decode, depends on the variable type
 * @param mainContract - used to identify the members of a struct
 * @param storageVar - the storage slot of the variable to decode
 * @param functionStorage - the storage state of the smart contract
 * @returns {string} - the decoded variable
 */
function decodeDynamicArray(variable, value, mainContract, storageVar, functionStorage) {

    //take the index of the first value != 0
    console.log('-------VARIABLE-------', variable)
    console.log('-------VALUE-------', value)
    console.log('MAIN CONTRACT', mainContract)
    console.log('STORAGEVAR', storageVar)
    console.log('FUNCTION STORAGE', functionStorage)
    const varibleSlotToNumber=web3.utils.numberToHex(variable.slot);
    console.log('VARIABLE SLOT TO NUMBER', varibleSlotToNumber)
    const varibleSlotSliced=varibleSlotToNumber.slice(2);
    console.log('VARIABLE SLOT SLICED', varibleSlotSliced)
    const slotPadded=web3.utils.padLeft(varibleSlotSliced, 64);
    console.log('SLOT PADDED', slotPadded)
    const firstNonZeroIndex=web3.utils.hexToNumber('0x'+functionStorage[slotPadded].slice(2));
    console.log('FIRST NON ZERO INDEX', firstNonZeroIndex)
    // const lastIndex = web3.utils.hexToNumber("0x" + value) - 1
    const lastIndex = firstNonZeroIndex;
    console.log('LAST INDEX', lastIndex)
    console.log('STORAGEVAR', storageVar);
    // let arrayStorageSlot = web3.utils.keccak256("0x" + storageVar)
    let arrayStorageSlot=web3.utils.hexToNumber("0x" + storageVar.slice(2));
    console.log('ARRAY STORAGE SLOT', arrayStorageSlot)
    const output = {
        arrayIndex: lastIndex
    }
    if (variable.type.includes("struct")) {
        const structType = variable.type.split("(")[2].split(")")[0]
        const getContract = getMainContractCompiled(mainContract);
        const structMembers = getStructMembersByStructType(structType, getContract);
        arrayStorageSlot = arrayStorageSlot + (lastIndex * structMembers.length);
        output.struct = structType
        for (let i = 0; i < structMembers.length; i++) {
            const functionStorageIndex = arrayStorageSlot + i;
            const functionStorageIndexHex = web3.utils.numberToHex(functionStorageIndex);
            const numberToHex = functionStorageIndexHex.slice(2);
            const functionStorageIndexPadded = web3.utils.padLeft(numberToHex, 64);
            // TODO: decode non-primitive types members
            console.log('STRUCT MEMBER',structMembers[i])
            console.log('FUNCTION STORAGE',functionStorage[functionStorageIndex])
            output[structMembers[i].label] = decodePrimitiveType(structMembers[i].type, functionStorage[functionStorageIndex.toString(16)])
        }
        return JSON.stringify(output)
        // TODO: handle direct update of indexes - similar case to the static array
    } else if ((variable.type.includes("uint") || variable.type.includes("int")) && !variable.type.includes("256")) {
        const value = optimezedArray(lastIndex, variable.type.split("uint")[1].split(")")[0], functionStorage, storageVar)
        console.log('Output value',value);
        output.value = web3.utils.hexToNumber("0x" + value)
        return JSON.stringify(output)
    } else {
        console.log("Entro nell'else")
        // arrayStorageSlot = BigInt(arrayStorageSlot) + BigInt(lastIndex)
        // output.value = decodePrimitiveType(variable.type, functionStorage[arrayStorageSlot.toString(16).padStart(64, '0')])

        //prima veniva passato il function sto
        output.value=decodePrimitiveType(variable.type,functionStorage[storageVar].slice(2))
        // output.value=decodePrimitiveType(variable.type,value.slice(2))
        return JSON.stringify(output)
    }
}
function temp(variable, value, mainContract, storageVar, functionStorage) {

    const lastIndex = web3.utils.hexToNumber("0x" + value) - 1
    console.log("------last index------");
    console.log(lastIndex);
    let arrayStorageSlot = web3.utils.keccak256("0x" + storageVar)
    const output = {
        arrayIndex: lastIndex
    }
    console.log("------array storage slot------")
    console.log(arrayStorageSlot)
    if (variable.type.includes("struct")) {
        const structType = variable.type.split("(")[2].split(")")[0]
        const getContract = getMainContractCompiled(mainContract);
        const structMembers = getStructMembersByStructType(structType, getContract);
        arrayStorageSlot = BigInt(arrayStorageSlot) + BigInt(lastIndex * structMembers.length)
        output.struct = structType
        for (let i = 0; i < structMembers.length; i++) {
            const functionStorageIndex = arrayStorageSlot + BigInt(i)
            // TODO: decode non-primitive types members
            output[structMembers[i].label] = decodePrimitiveType(structMembers[i].type, functionStorage[functionStorageIndex.toString(16)])
        }
        return JSON.stringify(output)
        // TODO: handle direct update of indexes - similar case to the static array
    } else if ((variable.type.includes("uint") || variable.type.includes("int")) && !variable.type.includes("256")) {
        const value = optimezedArray(lastIndex, variable.type.split("uint")[1].split(")")[0], functionStorage, arrayStorageSlot.slice(2))
        output.value = web3.utils.hexToNumber("0x" + value)
        return JSON.stringify(output)
    } else {
        arrayStorageSlot = BigInt(arrayStorageSlot) + BigInt(lastIndex)
        output.value = decodePrimitiveType(variable.type, functionStorage[arrayStorageSlot.toString(16).padStart(64, '0')])
        return JSON.stringify(output)
    }
}
/**
 *
 * @param variable - the variable to decode
 * @param value - the value of the variable to decode, depends on the variable type
 * @param mainContract - used to identify the members of a struct
 * @param storageVar - the storage slot of the variable to decode
 * @param functionStorage - the storage state of the smart contract
 * @param completeSstore - array of stacks taken from the SSTORE opcodes to identify more updates of the same variable
 * @returns {number|*|string|string|{}} - the decoded variable
 */
function decodeStorageValue(variable, value, mainContract, storageVar, functionStorage, completeSstore) {
    console.log("Variable: ", variable)
    //if it is a mapping check for last type of value by splitting it so to cover also nested case
    if (variable.type.includes("mapping")) {
        const typeBuffer = variable.type.split(",");
        const valueType = typeBuffer[typeBuffer.length - 1];
        if (valueType.includes("struct")) {
            console.log("SONO NEL CASO MAPPING STRUCT")
            //TODO decode mapping of struct
            // try with "decodeStructType" method, be careful to the variable name, it is not the
            // same of the structname
            return decodeStructType(variable, value, mainContract, storageVar)
            // return value
        } else {
            //TODO decode mapping of arrays
            // be careful with the struct type or struct name
            // return decodePrimitiveType(valueType, value);
            return value
        }
    } else if (variable.type.includes("array")) {

        const arrayTypeSplitted = variable.type.split(")")
        const arraySize = arrayTypeSplitted[arrayTypeSplitted.length - 1].split("_")[0]
        if (arraySize !== "dyn") {
            return decodeStaticArray(variable, value, mainContract, storageVar, Number(arraySize), functionStorage, completeSstore)
        } else {
            //todo bugfix
            //return decodeDynamicArray(variable, value, mainContract, storageVar, functionStorage)
            return value
        }
    } else if (variable.type.includes("struct")) {
        console.log("SONO NEL CASO STRUCT")
        return decodeStructType(variable, value, mainContract, storageVar)
    } else {
        return decodePrimitiveType(variable.type, value)
    }
}

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
    
    console.log(solidityVersion)
    //v0.8.4+commit.c7e474f2
    // v0.5.15+commit.6a57276f
//v0.8.28+commit.7893614a
    // solidityVersion = "v0.8.28+commit.7893614a";
    const solcSnapshot = await getRemoteVersion(solidityVersion.replace("soljson-", "").replace(".js", ""))

    const output = solcSnapshot.compile(JSON.stringify(input));
    contractCompiled = output
    // fs.writeFileSync('testContract.json', output);
    if (!JSON.parse(output).contracts) {
        throw new Error(JSON.parse(output).errors[0].message);
    }

    const source = JSON.parse(output).sources;
    contractAbi = JSON.stringify(await getAbi(JSON.parse(output), contractName));
   // console.log(contractAbi);
    // fs.writeFileSync('abitest.json', JSON.stringify(contractAbi));
    //get all storage variable for contract, including inherited ones
    const storageData = await getContractVariableTree(JSON.parse(output));
    //console.log(storageData);
    //take the effective tree
    const contractStorageTree = storageData;
    //get tree of functions for contract, NOT including inherited
    const contractTree = await getFunctionContractTree(source);
    //fs.writeFileSync('./temporaryTrials/contractTree.json', JSON.stringify(contractTree));
    //construct full function tree including also the inherited ones
    const contractFunctionTree = await constructFullFunctionContractTree(contractTree);
    //fs.writeFileSync('./temporaryTrials/contractFunctionTree.json', JSON.stringify(contractFunctionTree));
    //construct full contract tree including also variables
    const fullContractTree = await injectVariablesToTree(contractFunctionTree, contractStorageTree);
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
            console.log("trovato contratto abi")
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
 * Method used to get the full contract tree with the variables and the functions
 *
 * @param contractFunctionTree - the partial contract tree with the functions derived by
 *                               "constructFullFunctionContractTree" method
 * @param contractStorageTree - the contract tree with the variables derived by "getContractVariableTree" method
 * @returns {Promise<*>} - the full contract tree with the functions and the variables used to compile the storage
 *                         state of the smart contract
 */
async function injectVariablesToTree(contractFunctionTree, contractStorageTree) {
    //iterate the partial contract tree where only functions are stored
    for (const contractId in contractFunctionTree) {
        //iterate again the contracts
        for (const contractName in contractStorageTree) {
            //find the same contract in the tree with variables

            if (contractFunctionTree[contractId].name === contractStorageTree[contractName].name) {
                contractFunctionTree[contractId].storage = contractStorageTree[contractName].storage;
            }
        }
    }
    console.log("contract function tree");
    //console.log(contractFunctionTree);
    return contractFunctionTree;
}

/**
 * Method used to construct the full function contract tree including the inherited functions
 *
 * @param partialContractTree - the partial contract tree with the functions obtained by "getFunctionContractTree" method
 * @returns {Promise<*>} - the full contract tree with the functions
 */
async function constructFullFunctionContractTree(partialContractTree) {
    //iterate all contracts from the partial tree (key is AST id)
    for (const contractId in partialContractTree) {
        //get the ID of all inherited contract and iter them
        for (const inheritedId of partialContractTree[contractId].inherited) {
            //console.log("avente inherited: " + inheritedId + " che corrisponde a: " + partialContractTree[inheritedId].name);
            if (partialContractTree[inheritedId].name !== partialContractTree[contractId].name &&
                partialContractTree[contractId].functions.length > 0) {
                //console.log("ora inserisce" + partialContractTree[inheritedId].functions);
                partialContractTree[contractId].functions.push(...partialContractTree[inheritedId].functions);
            }
            //push inside the main contract the inherited functions
            //partialContractTree[contractId].functions.push(partialContractTree[inheritedId].functions);
        }
        const uniqueArray = Array.from(new Set(partialContractTree[contractId].functions));
        partialContractTree[contractId].functions = uniqueArray;
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
    let buffer;
    const response = await axios.get(endpoint + `?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${apiKey}`);
    const data = response.data;
    if (data.result[0].SourceCode === "") {
        throw new Error("No contract found");
    }
    let i = 0;
    // fs.writeFileSync('./temporaryTrials/dataResult.json', JSON.stringify(data.result[0]))
    let jsonCode = data.result[0].SourceCode;
    //console.log(jsonCode);
    fs.writeFileSync('sourceCode', JSON.stringify(data.result[0]));

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
                    console.log("trovato storage 2");
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
    const myContract = new web3.eth.Contract(JSON.parse(contractAbi), contractAddress);
    let filteredEvents = [];
    const pastEvents = await myContract.getPastEvents("allEvents", {fromBlock: block, toBlock: block});
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
function getContractCompiled(){
    return contractCompiled;
}