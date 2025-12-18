const mongoose = require("mongoose");
const { connectDB } = require("../../config/db");
require('dotenv').config();
const JSONStream = require("JSONStream");
// Import necessary modules that were missing
const { Web3, net } = require('web3');
const hre = require("hardhat");
const InputDataDecoder = require('ethereum-input-data-decoder');
const axios = require("axios");
const { decodeInternalTransaction,newDecodedInternalTransaction } = require('../decodeInternalTransaction');
const { optimizedDecodeValues } = require('../optimizedDecodeValues');
const { saveTransaction } = require("../../databaseStore");
const {searchAbi} = require("../../query/query")
const {saveAbi}=require("../../databaseStore")
const {decodeTransactionInputs,getEvents,iterateInternalForEvent,decodeInputs,getEventFromErigon,getEventsFromInternal,getEventFromHardHat} = require('../decodingUtils/utils')

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
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
    decodeInput(tx, contractTree)
    
    try{
        console.log(`Processing transaction: ${tx.hash}`);
        let transactionLog=await createTransactionLog(tx, mainContract, contractTree, smartContract,extractionType,contractAddress,option,networkData);
        
        return [];
        
    }finally{
        if (global.gc) global.gc();
    }
}
/**
 * Function used to decode the input and the methd name of a public trasaction
 * If the input is equal to "0x" means that it is a Transfer
 * @param {*} tx 
 * @param {*} contractTree 
 */
function decodeInput(tx,contractTree){
    if (tx.input == "0x") {
        tx.methodId = "Tranfer";
    } else if (contractTree?.contractAbi && (typeof contractTree.contractAbi !== 'object' || Object.keys(contractTree.contractAbi).length > 0)) {
        decodeTransactionInputs(tx, contractTree.contractAbi);
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
// Modified to return a readable stream instead of writing to file
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
    if(tx.timestamp && tx.timestamp.includes("0x")){
        tx.timeStamp=web3.utils.hexToNumber(tx.timestamp);
    }
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
            //if the internal transaction are extende menaning that I can use a node
            if(option.internalTransaction==1){
                const { stream, requiredTime } = await debugTransactionErigonStreaming(tx.hash,networkData.web3Endpoint);
                try{
                    storageVal = await getTraceStorageFromErigon(stream, networkData,tx.inputDecoded?tx.inputDecoded.method:null,tx.hash,mainContract,contractTree,smartContract,option,web3,transactionLog.blockNumber);
                    //storageVal.internalTxs=await newDecodedInternalTransaction(transactionLog.transactionHash, smartContract, networkData, web3);
                }catch (err){
                    console.log(err);
                }
            }else{
                debugResult = await debugTransaction(tx.hash, tx.blockNumber,networkData);
                try{
                    storageVal = await getTraceStorage(debugResult.response, networkData, tx.inputDecoded?tx.inputDecoded.method:null, tx.hash, mainContract, contractTree, smartContract,option,web3,transactionLog.blockNumber);
                }catch(err){
                    console.log(err)
                }
            }
            transactionLog.storageState =storageVal ? storageVal.decodedValues:[];
            transactionLog.internalTxs =storageVal ? storageVal.internalTxs:[];
            let storeAbi;
            if(contractTree){
                storeAbi = {
                    contractName: mainContract,
                    abi: contractTree.contractAbi,
                    proxy: '',
                    proxyImplementation: '',
                    contractAddress: tx.to,
                };
            }
            if(transactionLog.functionName==null && transactionLog.internalTxs && transactionLog.internalTxs.length>0){
                if(transactionLog.internalTxs[0].type=="DELEGATECALL"){
                    const addressTo = transactionLog.internalTxs[0].to;
                    const query = { contractAddress: addressTo.toLowerCase() };
                    const response = await searchAbi(query);
                    if(response){
                        if(contractTree){
                            storeAbi.proxy='1';
                            storeAbi.proxyImplementation=query.contractAddress;
                        }
                        
                        const decoder = new InputDataDecoder(response.abi);
                        const inputData = tx.input;
                        const tempResult = decoder.decodeData(inputData);
                        transactionLog.functionName = tempResult.method;
                        if (transactionLog.inputs.length< 1) {
                            transactionLog.inputs = tempResult.inputs.map((input, i) => {
                                let value = input;
                                if (input._isBigNumber) {
                                    value = Number(web3.utils.hexToNumber(input._hex));
                                }
                                return {
                                    inputName: tempResult.names[i],
                                    type: tempResult.types[i],
                                    inputValue: value,
                                };
                            });
                            
                        }
                    }
                }
                
            }
            if(contractTree){
                await saveAbi(storeAbi);
            }
            
        }
        await getEventForTransaction(transactionLog,tx.hash,Number(tx.blockNumber),contractAddress,web3,contractTree,option,networkData);
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
async function getEventForTransaction(transactionLog, hash, blockNumber, contractAddress, web3, contractTree, option, networkData) {
    if (option.default != 0) {
        const duplicateEvents=process.env.DUPLICATE_EVENTS=="false";
        let seenEvent = new Set();
        if(transactionLog.internalTxs && duplicateEvents){
            searchEventInInternal(transactionLog.internalTxs,seenEvent);
        }
        
        if (contractTree && contractTree.contractAbi && Object.keys(contractTree.contractAbi).length !== 0) {
            let publicEvents = await getEvents(hash, blockNumber, contractAddress, web3, contractTree.contractAbi);
            publicEvents.forEach((ele) => {
                if (!seenEvent.has(ele.eventSignature)) {
                    transactionLog.events.push(ele)
                    seenEvent.add(ele.eventSignature)
                }
            })
        }
        //if to get the event from internal transaction
        if (transactionLog.internalTxs && transactionLog.internalTxs.length > 0) {
            let internalEvents = await iterateInternalForEvent(hash, blockNumber, transactionLog.internalTxs, option, networkData, web3);
            internalEvents.forEach((ele) => {
                if (!seenEvent.has(ele.eventSignature)) {
                    //The negation of the flag because if we choose to duplicate the event so we se the flag to true in the 
                    //env when we declare the variable we check if the flag is equal to false( standar case)
                    if(!duplicateEvents){
                        transactionLog.events.push(ele)
                    }
                    seenEvent.add(ele.eventSignature)
                }
            })
            let allEventsFromReceipt = option.internalTransaction == 1
                ? await getEventFromErigon(transactionLog.transactionHash, networkData)
                : await getEventFromHardHat(transactionLog.transactionHash, networkData, hre,blockNumber);
            if (allEventsFromReceipt.length > 0) {
                for (const ele of allEventsFromReceipt) {
                    let logIndex = web3.utils.hexToNumber(ele.logIndex).toString();
                    if (!seenEvent.has(logIndex)) {
                        let eventMissing = await getEventsFromInternal(transactionLog.transactionHash, blockNumber, ele.address.toLowerCase(), networkData, web3)
                        if (eventMissing.length > 0) {
                            let flag = true;
                            eventMissing.forEach((event) => {
                                if (!seenEvent.has(event.eventSignature)) {
                                    flag = false;
                                    transactionLog.events.push(event)
                                    seenEvent.add(event.eventSignature)
                                }
                            })
                            if (flag) {
                                transactionLog.events.push({
                                    eventName: "undefined",
                                    eventValues: ele.topics,
                                    eventFrom: ele.address.toLowerCase(),
                                })
                                seenEvent.add(logIndex)
                            }
                        } else {
                            transactionLog.events.push({
                                eventName: "undefined",
                                eventValues: ele.topics,
                                eventFrom: ele.address.toLowerCase(),
                            })
                            seenEvent.add(logIndex)
                        }
                    }

                }
            }
        }
    } else {
        //if to get the event form the public transaction
        let seenEvent = new Set();
        if (contractTree && Object.keys(contractTree.contractAbi).length !== 0) {

            let publicEvents = await getEvents(hash, blockNumber, contractAddress, web3, contractTree.contractAbi);
            publicEvents.forEach((ele) => {
                if (!seenEvent.has(ele.eventSignature)) {
                    transactionLog.events.push(ele)
                    seenEvent.add(ele.eventSignature)
                }
            })
        }
        //if to get the event from internal transaction
        // transactionLog.internalTxs && transactionLog.internalTxs.length > 0
        if (option.internalTransaction == 1) {
            let allEventsFromErigon = await getEventFromErigon(transactionLog.transactionHash, networkData);
            for (const ele of allEventsFromErigon) {
                let logIndex = web3.utils.hexToNumber(ele.logIndex).toString();
                if (!seenEvent.has(logIndex)) {
                    let result = await getEventsFromInternal(transactionLog.transactionHash, blockNumber, ele.address, networkData, web3);
                    if (result.length > 0) {
                        let flag = true;
                        result.forEach((event) => {
                            if (!seenEvent.has(event.eventSignature)) {
                                transactionLog.events.push(event);
                                seenEvent.add(event.eventSignature)
                                flag = false;
                            }
                        })
                        if (flag) {
                            transactionLog.events.push({
                                eventName: "undefined",
                                eventValues: ele.topics,
                                eventFrom: ele.address.toLowerCase(),
                            })
                            seenEvent.add(logIndex)
                        }

                    } else {
                        //se sono qui è perché per quell'logindex non sono riuscito a decodificare l'evento
                        transactionLog.events.push({
                            eventName: "undefined",
                            eventValues: ele.topics,
                            eventFrom: ele.address.toLowerCase(),
                        })
                        seenEvent.add(logIndex)
                    }
                }

            }
        } else {
            let allEventsFromErigon = await getEventFromHardHat(transactionLog.transactionHash, networkData, hre,blockNumber)
            for (const ele of allEventsFromErigon) {
                let logIndex = web3.utils.hexToNumber(ele.logIndex).toString();
                if (!seenEvent.has(logIndex)) {
                    let result = await getEventsFromInternal(transactionLog.transactionHash, blockNumber, ele.address, networkData, web3);
                    if(result.length==0){
                        result=await getEventsFromInternal(transactionLog.transactionHash, blockNumber, transactionLog.sender, networkData, web3);
                    }
                    if (result.length > 0) {
                        let flag = true
                        result.forEach((event) => {
                            if (!seenEvent.has(event.eventSignature)) {
                                transactionLog.events.push(event);
                                seenEvent.add(event.eventSignature)
                                flag = false;
                            }
                        })
                        if (flag) {
                            transactionLog.events.push({
                                eventName: "undefined",
                                eventValues: ele.topics,
                                eventFrom: ele.address.toLowerCase(),
                            })
                            seenEvent.add(logIndex)
                        }
                    } else {
                        transactionLog.events.push({
                            eventName: "undefined",
                            eventValues: ele.topics,
                            eventFrom: ele.address.toLowerCase(),
                        })
                        seenEvent.add(logIndex)
                    }
                }
            }
        }
    }
}

function searchEventInInternal(internals,seenEvent){
    for(const internal of internals){
        internal.events?.forEach((event)=>{
            seenEvent.add(event.eventSignature);
        })

        if (internal.calls) {
            searchEventInInternal(internal.calls,seenEvent);
        }
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
async function getTraceStorage(traceDebugged, networkData, functionName, transactionHash, mainContract, contractTree,smartContract,extractionOption,web3,blockNumber) {
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
    let tempInternalCallArray=[];
    try{
        if (traceDebugged.structLogs) {
            const CALL_OPCODES = ["CALL", "DELEGATECALL", "STATICCALL", "CALLCODE"];

            tempInternalCallArray  = traceDebugged.structLogs.filter((step) =>CALL_OPCODES.includes(step.op));

            for (const trace of traceDebugged.structLogs) {
                if (trace.op === "KECCAK256" && trace.depth==1) {
                    bufferPC = trace.pc;
                    const stackLength = trace.stack.length;
                    const memoryLocation = trace.stack[stackLength - 1];
                    let numberLocation = web3.utils.hexToNumber("0x" + memoryLocation) / 32;
                    let storageIndexLocation = numberLocation + 1;
                    const hexKey = trace.memory[numberLocation];
                    const hexStorageIndex = trace.memory[storageIndexLocation];
                    trackBuffer[index] = { hexKey, hexStorageIndex };
                } else if (trace.op === "STOP" && trace.depth==1) {
                    for (const slot in trace.storage) {
                        functionStorage[slot] = trace.storage[slot];
                    }
                } else if (trace.pc === (bufferPC + 1) && trace.depth==1) {
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
                } else if (trace.op === "SSTORE" && trace.depth==1) {
                    sstoreOptimization.push(trace.stack);
                    sstoreBuffer.push(trace.stack[trace.stack.length - 1]);
                } else if (trace.op === "CALL" || trace.op === "DELEGATECALL" || trace.op === "STATICCALL") {
                    const offsetBytes = trace.stack[trace.op === "CALL" ? trace.stack.length - 4 : trace.stack.length - 3];
                    const lengthBytes = trace.stack[trace.op === "CALL" ? trace.stack.length - 5 : trace.stack.length - 4];
                    let stringDepthConstruction = "";
                    for (let i = 0; i < trace.depth - 1; i++) {
                        stringDepthConstruction += "_1";
                    }
                    const nextTrace=tempInternalCallArray[tempInternalCallArray.indexOf(trace)+1];
                    let possibleImplementation
                    if(nextTrace){
                        possibleImplementation=retriveImplementationContract(trace,nextTrace,web3)
                    }
                    let call = {
                        callId: "0_1" + stringDepthConstruction,
                        callType: trace.op,
                        depth: trace.depth,
                        gas: web3.utils.hexToNumber("0x" + trace.stack[trace.stack.length - 1]),
                        to: "0x" + trace.stack[trace.stack.length - 2].slice(-40),
                        inputsCall: "",
                        possibleImplementation:possibleImplementation
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
            internalTxs=await decodeInternalTransaction(internalCalls,smartContract,web3,networkData,transactionHash,blockNumber)
        }else if(extractionOption.internalTransaction==1){
            internalTxs=await newDecodedInternalTransaction(transactionHash, smartContract, networkData, web3,blockNumber);
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
function retriveImplementationContract(trace,nextTrace,web3){
    let possibleImplementation;
    // trace.op=="CALL" && nextTrace.op=="DELEGATECALL" && trace.depth<nextTrace.depth
    if((trace.op=="CALL" || trace.op=="STATICCALL") && nextTrace.op=="DELEGATECALL" && trace.depth<nextTrace.depth){
        const offsetBytes = nextTrace.stack[nextTrace.op === "CALL" ? nextTrace.stack.length - 4 : nextTrace.stack.length - 3];
        const lengthBytes = nextTrace.stack[nextTrace.op === "CALL" ? nextTrace.stack.length - 5 : nextTrace.stack.length - 4];
        possibleImplementation={
            to:"0x" + nextTrace.stack[nextTrace.stack.length - 2].slice(-40),
            from:"0x" + trace.stack[trace.stack.length - 2].slice(-40),
            type:nextTrace.op,
            input:''
        }
        let stringMemory = nextTrace.memory.join("");
        stringMemory = stringMemory.slice(
            web3.utils.hexToNumber("0x" + offsetBytes) * 2,
            web3.utils.hexToNumber("0x" + offsetBytes) * 2 + web3.utils.hexToNumber("0x" + lengthBytes) * 2
        );
        possibleImplementation.input = "0x"+stringMemory;
    }
    return possibleImplementation;
}
// Modified getTraceStorage2 to accept a stream instead of reading from file
async function getTraceStorageFromErigon(httpStream, networkData,functionName,transactionHash,mainContract,contractTree,smartContract,extractionOption,web3,blockNumber) {
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
        if (trace.op === "KECCAK256" && trace.depth==1) {
            bufferPC = trace.pc;
            const stackLength = trace.stack.length;
            const memoryLocation = trace.stack[stackLength - 1];
            let numberLocation = web3.utils.hexToNumber("0x" + memoryLocation) / 32;
            let storageIndexLocation = numberLocation + 1;
            const hexKey = trace.memory[numberLocation];
            const hexStorageIndex = trace.memory[storageIndexLocation];
            trackBuffer[index] = { hexKey, hexStorageIndex };
            
        } else if (trace.op === "STOP" && trace.depth==1) {
            for (const slot in trace.storage) {
                functionStorage[slot] = trace.storage[slot];
            }
            
        } else if (trace.pc === (bufferPC + 1) && trace.depth==1) {
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
            
        } else if (trace.op === "SSTORE" && trace.depth==1) {
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
        }else if(trace.op=="SLOAD" && trace.depth==1){
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
            internalTxs = await decodeInternalTransaction(internalCalls, smartContract, web3, networkData,transactionHash,blockNumber);
        } else if (extractionOption.internalTransaction == 1) {
            internalTxs = await newDecodedInternalTransaction(transactionHash, smartContract, networkData, web3,blockNumber);
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

