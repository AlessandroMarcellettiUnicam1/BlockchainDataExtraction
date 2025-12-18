const axios = require("axios");
const { searchAbi } = require("../query/query");
const { saveAbi } = require("../databaseStore");
const { connectDB } = require("../config/db");
const { getEventsFromInternal }= require("./decodingUtils/utils")
const InputDataDecoder = require("ethereum-input-data-decoder");

/**
 * 
 * @param {*} element 
 * @param {*} web3 
 */
async function handleUnverifiedContract(element, web3) {
    if (!element.input) {
        if(element.inputsCall.slice(0,2)=="0x"){
            element.input=element.inputsCall;
        }else{
            element.input = "0x" + element.inputsCall;
        }
    }
    
    if (element.input === "0x") {
        element.activity = "transfer";
        element.value = element.value || "0x";
    } else {
        await tryMethodSignature(element, web3);
        if (!element.activity) {
            element.activity = element.input?.slice(0, 10) || element.inputsCall?.slice(0, 10);
        }
    }
    
    delete element.input;
}

/**
 * 
 * @param {*} element 
 * @param {*} web3 
 * @returns 
 */
async function tryMethodSignature(element, web3) {
    const methodSignature = element.input?.slice(0, 10) || element.inputsCall?.slice(0, 10);
    
    if (methodSignature === "0x00000000") {
        element.activity = "Transfer*";
        element.value = element.value;
        element.inputs = element.input;
        return false;
    }

    try {
        const callForSignature = await axios.get(
            `https://www.4byte.directory/api/v1/signatures/?hex_signature=${methodSignature}`
        );
        if (callForSignature.data.results && callForSignature.data.results[0]) {
            if (callForSignature.data.results.length < 2) {
                for (let result of callForSignature.data.results) {
                    const textSignature = result.text_signature;
                    const activityAndValue = textSignature.slice(0, -1).split('(');
                    const activity = activityAndValue[0];
                    const valueTypes = activityAndValue[1].split(',');
                    element.activity = activity;
                    
                    try {
                        const valueDecoded = web3.eth.abi.decodeParameters(
                            valueTypes,
                            element.input.slice(10)
                        );
                        
                        const tempResult = [];
                        for (const key in valueDecoded) {
                            if (!key.includes("length")) {
                                tempResult.push({
                                    value: valueDecoded[key],
                                    name: valueTypes[Number(key)],
                                    type: valueTypes[Number(key)]
                                });
                            }
                        }
                        
                        if (tempResult.length > 0) {
                            element.inputs = tempResult;
                            return true;
                        }
                    } catch (err) {
                        console.log("Error decoding method:", element.callId,element.from,element.to);
                        continue;
                    }
                }
            }
            
            if (!element.inputs) {
                element.inputs = element.input;
                return true;
            }
        }
    } catch (err) {
        console.log("Error fetching method signature:", err.message);
    }
    
    return false;
}

/**
 * 
 * @param {*} element 
 * @param {*} abi 
 * @param {*} web3 
 * @param {*} contractName 
 */
function decodeInputs(element, abi, web3, contractName) {
    const decoder = new InputDataDecoder(abi);
    const inputData = element.input?element.input:element.inputsCall;
    const tempResult = decoder.decodeData(inputData);

    // Convert gas values if needed
    if (isNaN(Number(element.gas))) {
        element.gas = ToNumber(element.gas);
    }
    if (element.gasUsed && isNaN(Number(element.gasUsed))) {
        element.gasUsed = web3.utils.hexToNumber(element.gasUsed);
    }
    
    element.activity = tempResult.method;
    element.contractCalledName = contractName;
    element.inputs = tempResult.inputs.map((input, i) => {
        let value = input;
        if (input._isBigNumber) {
            value = Number(web3.utils.hexToNumber(input._hex));
        }
        return {
            name: tempResult.names[i],
            type: tempResult.types[i],
            value: value,
        };
    });
}

/**
 * 
 * @param {*} element 
 * @param {*} response 
 * @param {*} web3 
 * @returns 
 */
async function handleAbiFromDb(element, response, web3) {
    if(!element.input && element.inputsCall){
        element.inputsCall="0x"+element.inputsCall;
    }
    if (response.abi.includes("Contract source code not verified")) {
        await handleUnverifiedContract(element, web3);
        return;
    }
    //i read From the contract in the db if this is a proxy contract if yes I ge the api of the implemetation
    if(response.proxy=='1' && response.proxyImplementation!=''){
        const query = { contractAddress: response.proxyImplementation.toLowerCase() };
        const implementationResponse = await searchAbi(query);
        if(implementationResponse && !implementationResponse.abi.includes("Contract source code not verified")){
            const abiFromDb = JSON.parse(implementationResponse.abi);
            decodeInputs(element, abiFromDb, web3, implementationResponse.contractName);
            if (!element.activity || element.activity == null) {
                await tryMethodSignature(element, web3);
            }
        }
    }else{
        const abiFromDb = JSON.parse(response.abi);
        decodeInputs(element, abiFromDb, web3, response.contractName);
        if(!element.activity || element.activity==null){
            await tryMethodSignature(element, web3);
        }
        if (!element.activity) {
            await handleUnverifiedContract(element, web3);
        }
    }
}

/**
 * 
 * @param {*} element 
 * @param {*} addressTo 
 * @param {*} apiKey 
 * @param {*} endpoint 
 * @param {*} web3 
 */
async function handleAbiFetch(element, addressTo, apiKey, endpoint, web3) {
    let success = false;
    if(!element.input && element.inputsCall){
        element.inputsCall="0x"+element.inputsCall;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
        
        const callForAbi = await axios.get(
            `${endpoint}&module=contract&action=getsourcecode&address=${addressTo}&apikey=${apiKey}`
        );
        const proxyImplementation = '';
        const storeAbi = {
            contractName: callForAbi.data.result[0].ContractName,
            abi: callForAbi.data.result[0].ABI,
            proxy: callForAbi.data.result[0].Proxy,
            proxyImplementation: proxyImplementation,
            contractAddress: addressTo,
        };
       
        
        // Handle proxy contracts using DELEGATECALL pattern
        if (callForAbi.data.result[0].Proxy === '1') {
            const nextElement = element.possibleImplementation;
            
            let input=element.input?element.input:element.inputsCall;
            if (nextElement && 
                nextElement.type === "DELEGATECALL" && 
                nextElement.from === element.to && 
                nextElement.input === input) {
                    
                const anotherCallForAbi = await axios.get(
                    `${endpoint}&module=contract&action=getsourcecode&address=${nextElement.to}&apikey=${apiKey}`
                );
                
                const implementationAbi = {
                    contractName: anotherCallForAbi.data.result[0].ContractName,
                    abi: anotherCallForAbi.data.result[0].ABI,
                    proxy: anotherCallForAbi.data.result[0].Proxy,
                    proxyImplementation: '',
                    contractAddress: nextElement.to,
                };
                
                if (!anotherCallForAbi.data.result[0].ABI.includes("Contract source code not verified")) {
                    decodeInputs(element, anotherCallForAbi.data.result[0].ABI, web3, anotherCallForAbi.data.result[0].ContractName);
                    
                    if (!element.activity && element.activity==null) {
                        await tryMethodSignature(element, web3);
                    } else {
                        storeAbi.proxyImplementation = nextElement.to;
                        await saveAbi(implementationAbi);
                    }
                } else {
                    await handleUnverifiedContract(element, web3);
                }
            }else{
                if (!callForAbi.data.result[0].ABI.includes("Contract source code not verified")) {
                    decodeInputs(element, callForAbi.data.result[0].ABI, web3, callForAbi.data.result[0].ContractName);
                    
                    if (!element.activity && element.activity==null) {
                        await tryMethodSignature(element, web3);
                    } else {
                        storeAbi.proxyImplementation = nextElement.to;
                        await saveAbi(implementationAbi);
                    }
                } else {
                    await handleUnverifiedContract(element, web3);
                }
            }
            
            await saveAbi(storeAbi);
            success = true;
        } else if (!callForAbi.data.message.includes("NOTOK")) {
            // Regular contract
            
            if (!callForAbi.data.result[0].ABI.includes("Contract source code not verified")) {
                decodeInputs(element, callForAbi.data.result[0].ABI, web3, callForAbi.data.result[0].ContractName);
                if (!element.activity && element.activity==null) {
                    await tryMethodSignature(element, web3);
                } else {
                    await saveAbi(storeAbi);
                }
            } else {
                await handleUnverifiedContract(element, web3);
            }
            
            success = true;
        }
}
/**
 * 
 * @param {*} element 
 * @param {*} response 
 * @param {*} web3 
 * @returns 
 */
async function handleAbiFromDbErigon(element, response, web3) {
    if (response.abi.includes("Contract source code not verified")) {
        await handleUnverifiedContract(element, web3);
        return;
    }
    if (response.proxy === '1' && response.proxyImplementation!='') {
        let query = { contractAddress: response.proxyImplementation.toLowerCase() };
        let responseImplementation = await searchAbi(query);

        if (responseImplementation && !responseImplementation.abi.includes("Contract source code not verified")) {
            const abiFromDb = JSON.parse(responseImplementation.abi);
            decodeInputs(element, abiFromDb, web3, responseImplementation.contractName);
            if (!element.activity || element.activity == null) {
                await tryMethodSignature(element, web3);
            }
        } else {
            await tryMethodSignature(element, web3);
        }
    }else{
        const abiFromDb = JSON.parse(response.abi);
        if(response.abi!='[]'){
            decodeInputs(element, abiFromDb, web3, response.contractName);  
        }
        
        
        if (!element.activity) {
            await tryMethodSignature(element, web3);
        }
        
        // Final fallback
        if (!element.activity) {
            await handleUnverifiedContract(element, web3);
        }
    }
}

/**
 * 
 * @param {*} element 
 * @param {*} addressTo 
 * @param {*} apiKey 
 * @param {*} endpoint 
 * @param {*} web3 
 */
async function handleAbiFetchErigon(element, addressTo, apiKey, endpoint, web3) {
    let success = false;
    
    while (!success) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        
        const callForAbi = await axios.get(
            `${endpoint}&module=contract&action=getsourcecode&address=${addressTo}&apikey=${apiKey}`
        );

        const proxyImplementation = '';
        const storeAbi = {
            contractName: callForAbi.data.result[0].ContractName,
            abi: callForAbi.data.result[0].ABI,
            proxy: callForAbi.data.result[0].Proxy,
            proxyImplementation: proxyImplementation,
            contractAddress: addressTo,
        };

        // Handle proxy contracts using DELEGATECALL pattern
        if (callForAbi.data.result[0].Proxy === '1') {
            const nextElement = element.calls?.[0];
            let input=element.input?element.input:element.inputsCall;
            if (nextElement && 
                nextElement.type === "DELEGATECALL" && 
                nextElement.from === element.to && 
                nextElement.input === input) {
                
                const anotherCallForAbi = await axios.get(
                    `${endpoint}&module=contract&action=getsourcecode&address=${nextElement.to}&apikey=${apiKey}`
                );
                
                const implementationAbi = {
                    contractName: anotherCallForAbi.data.result[0].ContractName,
                    abi: anotherCallForAbi.data.result[0].ABI,
                    proxy: anotherCallForAbi.data.result[0].Proxy,
                    proxyImplementation: '',
                    contractAddress: nextElement.to,
                };
                
                if (!anotherCallForAbi.data.result[0].ABI.includes("Contract source code not verified")) {
                    decodeInputs(element, anotherCallForAbi.data.result[0].ABI, web3, 
                        anotherCallForAbi.data.result[0].ContractName);
                    
                    if (!element.activity && element.activity==null) {
                        await tryMethodSignature(element, web3);
                    } else {
                        storeAbi.proxyImplementation = nextElement.to;
                        await saveAbi(implementationAbi);
                    }
                } else {
                    await handleUnverifiedContract(element, web3);
                }
            }else{
                if (!callForAbi.data.result[0].ABI.includes("Contract source code not verified")) {
                    decodeInputs(element, callForAbi.data.result[0].ABI, web3, callForAbi.data.result[0].ContractName);
                    
                    if (!element.activity && element.activity==null) {
                        await tryMethodSignature(element, web3);
                    } 
                } else {
                    await handleUnverifiedContract(element, web3);
                }
            }
            
            await saveAbi(storeAbi);
            success = true;
        } else if (!callForAbi.data.message.includes("NOTOK")) {
            // Regular contract
                if (storeAbi.abi!='[]' && !callForAbi.data.result[0].ABI.includes("Contract source code not verified")) {
                    decodeInputs(element, callForAbi.data.result[0].ABI, web3, 
                        callForAbi.data.result[0].ContractName);
                    
                    if (!element.activity && element.activity==null) {
                        await tryMethodSignature(element, web3);
                    } else {
                        await saveAbi(storeAbi);
                    }
                } else {
                    if(!element.activity){
                        await handleUnverifiedContract(element, web3);
                    }
                }
            
            success = true;
        }
    }
}

/**
 * 
 * @param {*} internalCalls 
 * @param {*} smartContract 
 * @param {*} web3 
 * @param {*} networkData 
 * @returns 
 */
async function decodeInternalTransaction(internalCalls, smartContract, web3, networkData,transactionHash,blockNumber) {
    if (!smartContract) {
        let seenEvent = new Set();
        await connectDB(networkData.networkName);
        for (const element of internalCalls) {
            element.events=[];
            const addressTo = element.to;
            const query = { contractAddress: addressTo.toLowerCase() };
            const response = await searchAbi(query);
            if (!response) {
                await handleAbiFetch(element, addressTo, networkData.apiKey, 
                    networkData.endpoint, web3);
            } else {
                await handleAbiFromDb(element, response, web3);
            }
            let eventsOfTheInternal=await getEventsFromInternal(transactionHash,blockNumber,addressTo,networkData,web3);
            eventsOfTheInternal.forEach((event)=>{
                if (!seenEvent.has(event.eventSignature)) {
                    element.events.push(event);
                    seenEvent.add(event.eventSignature)
                }
            })
        }
    } else {
        console.log("smart contract uploaded manually");
    }
    
    return internalCalls;
}

/**
 * 
 * @param {*} internalCalls 
 * @param {*} smartContract 
 * @param {*} networkData 
 * @param {*} web3 
 * @param {*} depth 
 * @param {*} callId 
 */
async function decodeInternalRecursive(internalCalls, smartContract, networkData, web3, depth, callId,transactionHash,blockNumber,seenEvent) {
    let idDepth = 1;
    
    for (const element of internalCalls) {
        element.events=[];
        const addressTo = element.to;
        const query = { contractAddress: addressTo.toLowerCase() };
        
        element.callId = callId + "_" + idDepth;
        element.depth = depth;
        element.gas = web3.utils.hexToNumber(element.gas);
        element.gasUsed = web3.utils.hexToNumber(element.gasUsed);
        element.value = element.value ? web3.utils.hexToNumber(element.value) : 0;
        idDepth++;
        
        const response = await searchAbi(query);
        
        if (!response) {
            await handleAbiFetchErigon(element, addressTo, networkData.apiKey, 
                networkData.endpoint, web3);
        } else {
            await handleAbiFromDbErigon(element, response, web3);
        }
        let eventInternal=await getEventsFromInternal(transactionHash,blockNumber,addressTo,networkData,web3);
        if(eventInternal.length==0){
            eventInternal=await getEventsFromInternal(transactionHash,blockNumber,element.from,networkData,web3);
        }
        eventInternal.forEach((event)=>{
            if (!seenEvent.has(event.eventSignature)) {
                element.events.push(event)
                seenEvent.add(event.eventSignature)
            }
        })
        // Clean up input fields
        if (element.inputs && element.inputs.length > 0) {
            delete element.inputsCall;
            delete element.input;
        } else {
            element.inputsCall = element.input;
            delete element.input;
        }
        
        // Recursively process nested calls
        if (element.calls && element.calls.length > 0) {
            await decodeInternalRecursive(element.calls, smartContract, networkData, 
                web3, depth + 1, element.callId,transactionHash,blockNumber,seenEvent);
        }
    }
}

/**
 * 
 * @param {*} transactionHash 
 * @param {*} web3Endpoint 
 * @returns 
 */
async function debugInternalTransaction(transactionHash, web3Endpoint) {
    try {
        const payload = {
            jsonrpc: "2.0",
            method: "debug_traceTransaction",
            params: [
                transactionHash,
                { tracer: "callTracer" }
            ],
            id: 1
        };
        
        const response = await axios.post(web3Endpoint, payload, {
            headers: { "Content-Type": "application/json" }
        });
        
        return response.data.result.calls;
    } catch (err) {
        console.error("debugInternalTransaction error:", err.message);
        throw err;
    }
}
/**
 * 
 * @param {*} transactionHash 
 * @param {*} smartContract 
 * @param {*} networkData 
 * @param {*} web3 
 * @returns 
 */
async function newDecodedInternalTransaction(transactionHash, smartContract, networkData, web3,blockNumber) {
    const internalCalls = await debugInternalTransaction(transactionHash, networkData.web3Endpoint);
    
    if (!smartContract && internalCalls) {
        let seenEvent = new Set();
        await connectDB(networkData.networkName);
        await decodeInternalRecursive(internalCalls, smartContract, networkData, web3, 0, "0",transactionHash,blockNumber,seenEvent);
    } else {
        console.log("smart contract uploaded manually");
    }
    
    return internalCalls;
}

module.exports = { 
    decodeInternalTransaction,      
    newDecodedInternalTransaction   
};