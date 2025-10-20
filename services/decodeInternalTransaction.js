const axios = require("axios");
const { searchAbi } = require("../query/query");
const { saveAbi } = require("../databaseStore");
const { connectDB } = require("../config/db");
const InputDataDecoder = require("ethereum-input-data-decoder");

/**
 * 
 * @param {*} internalCalls 
 * @param {*} smartContract 
 * @param {*} web3 
 * @param {*} networkData 
 * @returns 
 */
async function decodeInternalTransaction(internalCalls, smartContract, web3,networkData) {
    if (!smartContract) {
        await connectDB(networkName);
        for (const element of internalCalls) {
            let addressTo = element.to;
            let query = { contractAddress: addressTo.toLowerCase() };
            const response = await searchAbi(query);
            if (!response) {
                await handleAbiFetch(element, addressTo, networkData.apiKey, networkData.endpoint, web3);
            } else {
                await handleAbiFromDb(element, response, web3);
            }
        }
    } else {
        // console.log("smart contract uploaded manually");
    }
    return internalCalls;
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
    while (!success) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        let callForAbi = await axios.get(`${endpoint}&module=contract&action=getsourcecode&address=${addressTo}&apikey=${apiKey}`);
        if(callForAbi.data.result[0].Proxy==1){
            let storeAbi = {
                contractName: callForAbi.data.result[0].ContractName,
                contractAddress: addressTo,
                abi: callForAbi.data.result[0].ABI,
            };
            try{
                decodeInputs(element, storeAbi.abi, web3, callForAbi.data.result[0].ContractName);
            }catch (err){
                console.log("provato a decodificare l'internal tramite il proxy e non l'implementazione")
            }
            addressTo= callForAbi.data.result[0].Implementation;
        }else if(callForAbi.data.result[0].SimilarMatch){
            addressTo=callForAbi.data.result[0].SimilarMatch;
        }else if(!callForAbi.data.message.includes("NOTOK")) {
            let storeAbi = {
                contractName: callForAbi.data.result[0].ContractName,
                contractAddress: addressTo,
                abi: callForAbi.data.result[0].ABI,
            };
            await saveAbi(storeAbi);

            if (!storeAbi.abi.includes("Contract source code not verified")) {
                decodeInputs(element, storeAbi.abi, web3, callForAbi.data.result[0].ContractName);
            } else {
                if(!element.input){
                    element.input="0x"+element.inputsCall
                }
                if(element.input==="0x"){
                    element.activity="tranfer"
                    element.value="0x"
                    element.name="undefined"
                    element.type="undefined"
                }else if(!await tryMethodSignature(element,web3)){
                    element.activity="undefined"
                }
                delete element.input
            }
            success = true;
        }
    }
}
/**
 * 
 * @param {*} element 
 * @param {*} web3 
 * @returns 
 */
async function tryMethodSignature(element,web3){
    let methodSignature=element.input.slice(0,10)
    if(methodSignature!="0x00000000"){
        let callForSignature=await axios.get(`https://www.4byte.directory/api/v1/signatures/?hex_signature=${methodSignature}`);
        if(callForSignature.data.results && callForSignature.data.results[0] && callForSignature.data.results[0].text_signature){
            //for a signature there are multiple method
            for(let i=0;i<callForSignature.data.results.length;i++){
                let result=callForSignature.data.results[i].text_signature;
                let activityAndValue=result.slice(0,-1).split('(')
                let activity=activityAndValue[0];
                let valueTypes=activityAndValue[1].split(',');
                element.activity=activity;
                let valueDecoded;
                try{
                    valueDecoded=web3.eth.abi.decodeParameters(valueTypes,element.input.slice(10));
                }catch(err){
                    console.log("errore in decoding element the method: ",element)
                    continue;
                }
                
                let tempResult=[];
                for (const key in valueDecoded){
                    if(!key.includes("length")){
                        let temp={
                            value:valueDecoded[key],
                            name:valueTypes[Number(key)],
                            type:valueTypes[Number(key)]
                        }
                        tempResult.push(temp)
                    }
                }
                if(tempResult.length>0){
                    element.inputs=tempResult;
                    return true;  
                }
            
            };
            if(!element.inputs){
                element.inputs=element.input;
                return true;
            }
            
        }
    }else if(methodSignature!="0x00000000"){
        element.activity = "Transfer*"
        element.value = element.value;
        element.name = "undefined"
        element.type = "undefined"
    }
    return false;

}
/**
 * if the abi is of a contract already extract i get the abi from the db and use it to decode the input
 * @param {*} element 
 * @param {*} response 
 * @param {*} web3 
 */
async function handleAbiFromDb(element, response, web3) {
    // console.log("ABI found in DB for address:", response.contractAddress);
    if (!response.abi.includes("Contract source code not verified")) {
        let abiFromDb = JSON.parse(response.abi);
        decodeInputs(element, abiFromDb, web3, response.contractName);
    } else {
        if(!element.input){
            element.input="0x"+element.inputsCall;
        }
        if(element.input){
            element.inputsCall=element.input;
            if(element.input==="0x"){
                    element.activity="tranfer"
                    element.value=element.value
                    element.name="undefined"
                    element.type="undefined"
            }else if(!await tryMethodSignature(element,web3)){
                element.activity = "Contract source code not verified";
            }
            delete element.input
        }
    }
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
    
    let tempResult;

    
    if(element.inputsCall){
        tempResult = decoder.decodeData(element.inputsCall);
    }else{
        tempResult = decoder.decodeData(element.input);
    }

    if(isNaN(Number(element.gas))) {
        element.gas = web3.utils.hexToNumber(element.gas);  
    }
    if(isNaN(Number(element.gas))) {
        element.gasUsed = web3.utils.hexToNumber(element.gasUsed);
    }

    // element.gas=web3.utils.hexToNumber(element.gas);
    // element.gasUsed=web3.utils.hexToNumber(element.gasUsed);
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
 * @param {*} transactionHash 
 * @param {*} smartContract 
 * @param {*} networkData 
 * @param {*} web3 
 * @returns 
 */
async function newDecodedInternalTransaction(transactionHash, smartContract,networkData, web3,){
    let internalCalls=await debugInteralTransaction(transactionHash,networkData.endpoint);
    if (!smartContract && internalCalls) {
        
        await connectDB(networkName);
        await decodeInternalRecursive(internalCalls, smartContract, networkData, web3,0);
    } else {
        // console.log("smart contract uploaded manually");
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
 */
async function decodeInternalRecursive(internalCalls, smartContract,networkData, web3,depth) {
        for (const element of internalCalls) {
                let addressTo = element.to;
                let query = { contractAddress: addressTo.toLowerCase() };
                element.callId = "0_1";
                element.depth=depth;
                element.gas=web3.utils.hexToNumber(element.gas);
                element.gasUsed=web3.utils.hexToNumber(element.gasUsed);
                element.value=element.value?web3.utils.hexToNumber(element.value):0;
                for(let i=0;i<element.depth;i++){
                    element.callId += "_1";
                }
                const response = await searchAbi(query);
                if (!response) {
                    await handleAbiFetch(element, addressTo, networkData.apiKey, networkData.endpoint, web3);
                } else {
                    await handleAbiFromDb(element, response, web3);
                }
                if(element.inputs && element.inputs.length>0){
                    delete element.inputsCall
                    delete element.input;
                }else{
                    element.inputsCall=element.input;
                    delete element.input;
                }
                if( element.calls && element.calls.length > 0) {
                    await decodeInternalRecursive(element.calls, smartContract, networkData, web3,depth+1);
                }
        }
}
function flattenCalls(call, parentIndex = null, list = [], index = { i: 0 }) {
    const currentIndex = index.i++;
    
    list.push({
        index: currentIndex,
        parentIndex: parentIndex,
        from: call.from,
        to: call.to,
        hasInput: !!call.input,
        hasOutput: !!call.output,
        type: call.type,
        value: call.value,
    });

    if (call.calls && call.calls.length) {
        for (const nested of call.calls) {
            flattenCalls(nested, currentIndex, list, index);
        }
    }

    return list;
}

/**
 * 
 * @param {*} transactionHash 
 * @param {*} web3Endpoint 
 * @returns 
 */
async function debugInteralTransaction(transactionHash,web3Endpoint) {
    try{
        const rpcUrl = web3Endpoint;
        const payload = {
            jsonrpc: "2.0",
            method: "debug_traceTransaction",
            params: [
                transactionHash,
                { tracer: "callTracer" }
            ],
            id: 1
        };
         const response = await axios.post(rpcUrl, payload, {
            headers: { "Content-Type": "application/json" }
        });
        return response.data.result.calls ;
    } catch(err){
        console.error("debugInteralTransaction error:", err.message);
        throw err;
    }
}
module.exports = { decodeInternalTransaction,newDecodedInternalTransaction };