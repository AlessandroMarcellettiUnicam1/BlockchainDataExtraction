const axios = require("axios");
const { searchAbi } = require("../query/query");
const { saveAbi } = require("../databaseStore");
const { connectDB } = require("../config/db");
const { getEventsFromInternal }= require("./decodingUtils/utils")
const InputDataDecoder = require("ethereum-input-data-decoder");

function ensureHexPrefix(value) {
    const stringValue = String(value ?? "");
    return stringValue.startsWith("0x") ? stringValue : "0x" + stringValue;
}
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
            element.input = ensureHexPrefix(element.inputsCall);
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
    // 1. Unify the input source to prevent TypeErrors later
    const rawInput = element.input || element.inputsCall;
    
    // Ignore empty inputs or standard ETH transfers
    if (!rawInput || rawInput === "0x") {
        return false; 
    }

    const methodSignature = rawInput.slice(0, 10);
    
    if (methodSignature === "0x00000000") {
        element.activity = "Transfer*";
        element.inputs = rawInput;
        return false;
    }

    try {
        const response = await axios.get(
            `https://www.4byte.directory/api/v1/signatures/?hex_signature=${methodSignature}`
        );
        
        const results = response.data.results;

        if (results && results.length > 0) {
            // 2. Loop through ALL results. If there's a collision, try decoding 
            // them one by one until one succeeds without throwing an error.
            for (let result of results) {
                const textSignature = result.text_signature;
                
                // Split safely: "transfer(address,uint256)" -> ["transfer", "address,uint256)"]
                const [activity, paramsString] = textSignature.split('(');
                element.activity = activity;
                
                // 3. Handle zero-parameter functions safely
                const rawParams = paramsString.slice(0, -1);
                const valueTypes = rawParams ? rawParams.split(',') : [];
                
                try {
                    let tempResult = [];
                    
                    if (valueTypes.length > 0) {
                        const valueDecoded = web3.eth.abi.decodeParameters(
                            valueTypes,
                            rawInput.slice(10) // Use unified rawInput safely
                        );
                        
                        // Iterate safely using the length of expected types
                        for (let i = 0; i < valueTypes.length; i++) {
                            tempResult.push({
                                value: valueDecoded[i],
                                name: valueTypes[i],
                                type: valueTypes[i]
                            });
                        }
                    }
                    
                    element.inputs = tempResult;
                    return true; // Decoding successful, exit function
                    
                } catch (err) {
                    // Decoding failed (likely a signature collision mismatch).
                    // Continue to the next result in the loop.
                    continue; 
                }
            }
            
            // Fallback if ALL decoding attempts failed but signatures were found
            if (!element.inputs || element.inputs.length === 0) {
                element.inputs = rawInput;
                return true;
            }
        }
    } catch (err) {
        console.error(`Error fetching method signature for ${methodSignature}:`, err.message);
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
        element.inputsCall = ensureHexPrefix(element.inputsCall);
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
        element.inputsCall = ensureHexPrefix(element.inputsCall);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));

    try {
        const callForAbi = await axios.get(
            `${endpoint}&module=contract&action=getsourcecode&address=${addressTo}&apikey=${apiKey}`
        );
        const proxyImplementation = '';
        const storeAbi = {
            contractName: callForAbi.data.result[0].ContractName,
            abi: callForAbi.data.result[0].ABI,
            proxy: callForAbi.data.result[0].Proxy,
            proxyImplementation: proxyImplementation,
            sourceCode:callForAbi.data.result[0].SourceCode,
            contractAddress: addressTo,
            compilerVersion:callForAbi.data.result[0].CompilerVersion,
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
                    sourceCode:anotherCallForAbi.data.result[0].SourceCode,
                    contractAddress: nextElement.to,
                    compilerVersion:anotherCallForAbi.data.result[0].CompilerVersion
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
                    }
                    // Note: no implementationAbi available in this branch; storeAbi is saved below
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
    } catch (err) {
        console.log("handleAbiFetch error for address", addressTo, ":", err.message);
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
        const timeBeforeDecodingInput=Date.now();
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
        const timeBeforeDecodingInput=Date.now();
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
    
    while (!success ) {
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
            sourceCode:callForAbi.data.result[0].SourceCode,
            compilerVersion:callForAbi.data.result[0].CompilerVersion,
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
                    sourceCode:anotherCallForAbi.data.result[0].SourceCode,
                    compilerVersion:anotherCallForAbi.data.result[0].CompilerVersion,
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
    if (!success) {
        console.log(`handleAbiFetchErigon: reached for address ${addressTo}`);
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
async function decodeInternalRecursive(internalCalls, smartContract, networkData, web3, depth, callId,transactionHash,blockNumber,seenEvent, simulation = false) {
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

        if (!simulation) {
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
        }
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
                web3, depth + 1, element.callId,transactionHash,blockNumber,seenEvent, simulation);
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
    //TODO: prendo tempo da qui 
    const internalCalls = await debugInternalTransaction(transactionHash, networkData.web3Endpoint);
    //fino a qui e questo è la debug 
    //Tempo intenral da qui 

    //per la decode degli input stampare il tempo della decode degli input per capire se è possibile omettere il valore
    if (!smartContract && internalCalls) {
        let seenEvent = new Set();
        await connectDB(networkData.networkName);
        await decodeInternalRecursive(internalCalls, smartContract, networkData, web3, 0, "0",transactionHash,blockNumber,seenEvent);
    } else {
        console.log("smart contract uploaded manually");
    }
    //a qui e sono le internal
    return internalCalls;
}

module.exports = { 
    decodeInternalTransaction,      
    newDecodedInternalTransaction,
    handleAbiFetch,
    decodeInternalRecursive,
    handleAbiFromDb
};
