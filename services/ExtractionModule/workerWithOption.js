const mongoose = require("mongoose");
const { connectDB } = require("../../config/db");
require('dotenv').config();
const fs = require('fs');
// Import necessary modules that were missing
const { Web3, net } = require('web3');
const hre = require("hardhat");
const InputDataDecoder = require('ethereum-input-data-decoder');
const axios = require("axios");
const { decodeInternalTransaction,newDecodedInternalTransaction } = require('../decodeInternalTransaction');
const { optimizedDecodeValues } = require('../optimizedDecodeValues');
const { saveTransaction } = require("../../databaseStore");
const {searchTransaction} = require("../../query/query")
const {decodeTransactionInputs,getEvents,iterateInternalForEvent,decodeInputs,safeCheck} = require('../decodingUtils/utils')

/**
 * 
 * @param {*} tx 
 * @param {*} mainContract 
 * @param {*} contractTree 
 * @param {*} contractAddress 
 * @param {*} smartContract 
 * @param {*} extractionType 
 * @param {*} option 
 * @param {*} networkData 
 * @returns 
 */
async function processTransaction(tx, mainContract, contractTree, contractAddress, smartContract,extractionType,option,networkData) {
    if (contractTree?.contractAbi && (typeof contractTree.contractAbi !== 'object' || Object.keys(contractTree.contractAbi).length > 0)) {
        decodeTransactionInputs(tx, contractTree.contractAbi);
    }
    try{
        console.log(`Processing transaction: ${tx.hash}`);
        let transactionLog=await createTransactionLog(tx, mainContract, contractTree, smartContract,extractionType,contractAddress,option,networkData);
        
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
async function debugTransaction(transactionHash, blockNumber,networkData) {
    let response = null;
    try {
        await hre.changeNetwork(networkData.networkName, blockNumber)
        const start = new Date()
        response = await hre.network.provider.send("debug_traceTransaction", [
            transactionHash
        ]);
         // Save the response to a JSON file
        // fs.writeFileSync("alltrace.json", JSON.stringify(response, null, 2));
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
 * 
 * @param {*} tx 
 * @param {*} mainContract 
 * @param {*} contractTree 
 * @param {*} smartContract 
 * @param {*} extractionType 
 * @param {*} contractAddress 
 * @param {*} networkData 
 * @param {*} option 
 * @returns 
 */
async function createTransactionLog(tx, mainContract, contractTree, smartContract,extractionType,contractAddress,networkData,option) {
    let web3=new Web3(networkData.web3Endpoint)
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
            debugResult = await debugTransaction(tx.hash, tx.blockNumber,networkData);
            try{
                storageVal = await getTraceStorage(debugResult.response, networkData, tx.inputDecoded?tx.inputDecoded.method:null, tx.hash, mainContract, contractTree, smartContract,option,web3);
            }catch (err){
                console.log("error in the getTraceStorage")
            }
            transactionLog.storageState =storageVal ? storageVal.decodedValues:[];
            transactionLog.internalTxs =storageVal ? storageVal.internalTxs:[];
        }
        await getEventForTransaction(transactionLog,tx.hash,Number(tx.blockNumber),contractAddress,web3,contractTree,extractionType,networkData);
        await saveTransaction(transactionLog, tx.to!=''?tx.to:tx.from);

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
 * function to get the event emitted in t
 * @param {*} transactionLog : is the log tha we have to store in the db
 * @param {*} hash : has of the transaction
 * @param {*} blockNumber : block number to get the event emitted
 * @param {*} contractAddress : the address of the contract
 * @param {*} web3 : we3 instances 
 * @param {*} contractTree : object contract tree that contain the abi
 * @param {*} extractionType : the extraction type
 * @param {*} networkData : object representing the network data ( apiKey,endPoint, networkName,web3Endpoint)
 */
async function getEventForTransaction(transactionLog,hash,blockNumber,contractAddress,web3,contractTree,extractionType,networkData){
    if (contractTree && Object.keys(contractTree.contractAbi).length !== 0) {
        transactionLog.events = await getEvents(hash, blockNumber, contractAddress, web3, contractTree.contractAbi);
    }
    if (transactionLog.internalTxs && transactionLog.internalTxs.length > 0) {
        let internalResult = await iterateInternalForEvent(hash, blockNumber, transactionLog.internalTxs, extractionType, networkData, web3);
        internalResult = internalResult.filter(element => !safeCheck(transactionLog.events, element));
        internalResult.forEach((element) => {
            transactionLog.events.push(element)
        })
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
async function getTraceStorage(traceDebugged, networkData, functionName, transactionHash, mainContract, contractTree,smartContract,extractionOption,web3) {
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
            internalStorage=contractTree && contractTree.storageLayoutFlag?await optimizedDecodeValues(sstoreObject, contractTree.fullContractTree, finalShaTraces, functionStorage, functionName, mainContract,web3,contractTree.contractCompiled):[];
        }
        let internalTxs=[]
        if(extractionOption.internalTransaction==0){
            internalTxs=await decodeInternalTransaction(internalCalls,networkData.apiKey,smartContract,networkData.endpoint,web3,networkData.networkName,networkData.web3Endpoint)
        }else if(extractionOption.internalTransaction==1){
            internalTxs=await newDecodedInternalTransaction(transactionHash, networkData.apiKey, smartContract, networkData.endpoint, web3, networkData.networkName,networkData.web3Endpoint);
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


// Handle messages from main process
process.on("message", async (data) => {
    const { tx, mainContract, contractTree, contractAddress, smartContract,option, networkData,extractionType } = data;
    let transactionLog;
    try {
        
        // Connect to database  
        await connectDB(networkData.networkName);
        
        // Process the transaction
        await processTransaction(tx, mainContract, contractTree, contractAddress, smartContract,extractionType,networkData,option);

        // Clean up
        // await mongoose.disconnect();
        
        if (global.gc) global.gc();
        await hre.run("clean");
        await hre.network.provider.send("hardhat_reset");
        if (hre.network.provider.removeAllListeners) {
            hre.network.provider.removeAllListeners();
        }
        
        // contractAbi = null;
        // contractCompiled = null;
        
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

