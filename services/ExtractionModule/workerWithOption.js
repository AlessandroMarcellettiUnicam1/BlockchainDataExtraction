const mongoose = require("mongoose");
const { connectDB } = require("../../config/db");
require('dotenv').config();

// Import necessary modules that were missing
const { Web3 } = require('web3');
const hre = require("hardhat");
const InputDataDecoder = require('ethereum-input-data-decoder');
const axios = require("axios");
const { decodeInternalTransaction,newDecodedInternalTransaction } = require('../decodeInternalTransaction');
const { optimizedDecodeValues } = require('../optimizedDecodeValues');
const { saveTransaction } = require("../../databaseStore");
const {searchTransaction} = require("../../query/query")
const {decodeTransactionInputs,getEvents,iterateInternalForEvent,decodeInputs,safeCheck} = require('../decodingUtils/utils')
let web3 = null;
let contractAbi = {};
let networkName = "";
let web3Endpoint = "";
let apiKey = "";
let endpoint = "";
let contractCompiled = null;
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
async function processTransaction(tx, mainContract, contractTree, contractAddress, smartContract,extractionType,network,option) {
    console.log(option)
    const query = {
        transactionHash: tx.hash.toLowerCase(),
        contractAddress: contractAddress.toLowerCase()
    };

    const response = await searchTransaction(query, networkName);
    if (response) {
        console.log(`Transaction already processed: ${tx.hash}`);
        const { _id, __v, ...transactionData } = response[0];
        return transactionData;
    }
    if(!(contractAbi === undefined || (typeof contractAbi === 'object' && contractAbi !== null && Object.keys(contractAbi).length === 0))){
        decodeTransactionInputs(tx,contractAbi);
    }
    
    try{
        console.log(`Processing transaction: ${tx.hash}`);
        let transactionLog=await createTransactionLog(tx, mainContract, contractTree, smartContract,extractionType,contractAddress,network,option);
        
        return [];
        
    }finally{
        if (global.gc) global.gc();
    }
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
        await hre.changeNetwork(networkName, blockNumber)
        const start = new Date()
        
        response = await hre.network.provider.send("debug_traceTransaction", [
            transactionHash
        ]);

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
 * Creates a transaction log by decoding inputs, storage state, and events.
 *
 * @param {Object} tx - The transaction object.
 * @param {Object} debugResult - The debugged transaction result.
 * @param {string} mainContract - The main contract to decode.
 * @param {Object} contractTree - The contract tree for decoding.
 * @param {Object} smartContract - The smart contract uploaded file.
 * @returns {Promise<Object>} - The transaction log.
 */
async function createTransactionLog(tx, mainContract, contractTree, smartContract,extractionType,contractAddress,network,option) {

    let transactionLog = {
        functionName:tx.inputDecoded?tx.inputDecoded.method:tx.methodId,
        transactionHash: tx.hash,
        blockNumber: parseInt(tx.blockNumber),
        contractAddress: tx.to,
        sender: tx.from,
        gasUsed: parseInt(tx.gasUsed),
        timestamp: new Date(tx.timeStamp * 1000).toISOString(),
        inputs: tx.inputDecoded?decodeInputs(tx.inputDecoded,web3):[],
        value:tx.value,
        storageState: [],
        internalTxs: [],
        events: []
    };
    let storageVal=null;
    let debugResult=null;
    try{
        if(option.default!=0){
            debugResult = await debugTransaction(tx.hash, tx.blockNumber);
            try{
                storageVal = await getTraceStorage(debugResult.response, tx.blockNumber, tx.inputDecoded?tx.inputDecoded.method:null, tx.hash, mainContract, contractTree, smartContract,option);
            }catch (err){
                console.log("error in the getTraceStorage")
            }
            transactionLog.storageState = storageVal.decodedValues;
            transactionLog.internalTxs = storageVal.internalTxs;
        }
        transactionLog.events=await getEvents(tx.hash,Number(tx.blockNumber),contractAddress,web3,contractAbi);
        if(transactionLog.internalTxs && transactionLog.internalTxs.length>0){
            let internalResult= await iterateInternalForEvent(tx.hash,Number(tx.blockNumber),transactionLog.internalTxs,extractionType,extractionType,web3,apiKey,endpoint)
            internalResult = internalResult.filter(element => !safeCheck(transactionLog.events, element));
            internalResult.forEach((element)=>{
                transactionLog.events.push(element)
            })
        }
        await saveTransaction(transactionLog, tx.to);

    }finally{
        if (debugResult) {
            if (debugResult.response && debugResult.response.structLogs) {
                debugResult.response.structLogs = null;
            }
            debugResult.response = null;
            debugResult = null;
        }
        
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
 *
 * @param traceDebugged - the debugged transaction with its opcodes
 * @param blockNumber - the block number where the transaction is stored
 * @param functionName - the function name of the invoked method, useful to decode the storage state
 * @param transactionHash - the transaction hash used only to identify the internal transactions
 * @param mainContract - the main contract to decode, used to identify the contract variables
 * @param contractTree - the contract tree used to identify the contract variables with the 'mainContract'
 * @returns {Promise<{decodedValues: (*&{variableValue: string|string|*})[], internalCalls: *[]}>} - the decoded values of the storage state and the internal calls
 */
async function getTraceStorage(traceDebugged, blockNumber, functionName, transactionHash, mainContract, contractTree,smartContract,extractionOption) {
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
        let internalStorage=[];
        if(extractionOption.internalStorage!=0){
            internalStorage=contractTree.storageLayoutFlag?await optimizedDecodeValues(sstoreObject, contractTree.fullContractTree, finalShaTraces, functionStorage, functionName, mainContract,web3,contractCompiled):[];
        }
        let internalTxs=[]
        if(extractionOption.internalTransaction==0){
            internalTxs=await decodeInternalTransaction(internalCalls,apiKey,smartContract,endpoint,web3,networkName,web3Endpoint)
        }else if(extractionOption.internalTransaction==1){
            internalTxs=await newDecodedInternalTransaction(transactionHash, apiKey, smartContract, endpoint, web3, networkName,web3Endpoint);
        }
        let result={
            decodedValues:internalStorage,
            internalTxs:internalTxs
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


// Initialize worker environment
function initializeWorker(network, contractAbiData, contractCompiledData) {
    networkName = network;
    contractAbi = contractAbiData;
    contractCompiled = contractCompiledData;
    switch (network) {
        case "Mainnet":
            web3Endpoint = process.env.WEB3_ALCHEMY_MAINNET_URL;
            apiKey = process.env.API_KEY_ETHERSCAN;
            endpoint = process.env.ETHERSCAN_MAINNET_ENDPOINT;
            break;
        case "Sepolia":
            web3Endpoint = process.env.WEB3_ALCHEMY_SEPOLIA_URL;
            apiKey = process.env.API_KEY_ETHERSCAN;
            endpoint = process.env.ETHERSCAN_SEPOLIA_ENDPOINT;
            break;
        case "Polygon":
            web3Endpoint = process.env.WEB3_ALCHEMY_POLYGON_URL;
            apiKey = process.env.API_KEY_POLYGONSCAN;
            endpoint = process.env.POLYGONSCAN_MAINNET_ENDPOINT;
            break;
        case "Amoy":
            web3Endpoint = process.env.WEB3_ALCHEMY_AMOY_URL;
            apiKey = process.env.API_KEY_POLYGONSCAN;
            endpoint = process.env.POLYGONSCAN_TESTNET_ENDPOINT;
            break;
    }
    web3 = new Web3(web3Endpoint);
}

// Handle messages from main process
process.on("message", async (data) => {
    const { tx, mainContract, contractTree, contractAddress, smartContract,option, network, contractAbiData, contractCompiledData,extractionType } = data;
    let transactionLog;
    try {
        // Initialize worker with necessary data
        initializeWorker(network, contractAbiData, contractCompiledData);
        
        // Connect to database
        await connectDB(networkName);
        
        // Process the transaction
        await processTransaction(tx, mainContract, contractTree, contractAddress, smartContract,extractionType,network,option);

        // Clean up
        // await mongoose.disconnect();
        
        if (global.gc) global.gc();
        await hre.run("clean");
        await hre.network.provider.send("hardhat_reset");
        if (hre.network.provider.removeAllListeners) {
            hre.network.provider.removeAllListeners();
        }
        
        // Clean up Web3 instance
        web3 = null;
        contractAbi = null;
        contractCompiled = null;
        
        // Force garbage collection
        if (global.gc) global.gc();
        // Send success message
        process.send("done");
        // Exit successfully
        process.exit(0);
    } catch (err) {
        console.error("Worker error:", err);
        
        // Clean up on error
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
        
        // Send error message
        process.send({ error: err.message });
        
        // Exit with error
        process.exit(1);
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception in worker:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection in worker at:', promise, 'reason:', reason);
    process.exit(1);
});

