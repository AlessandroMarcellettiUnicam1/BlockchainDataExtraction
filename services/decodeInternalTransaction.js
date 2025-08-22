const axios = require("axios");
const { searchAbi } = require("../query/query");
const { saveAbi } = require("../databaseStore");
const { connectDB } = require("../config/db");
const InputDataDecoder = require("ethereum-input-data-decoder");


async function decodeInternalTransaction(internalCalls, apiKey, smartContract, endpoint, web3, networkName) {
    if (!smartContract) {
        await connectDB(networkName);

        for (const element of internalCalls) {
            let addressTo = element.to;
            let query = { contractAddress: addressTo.toLowerCase() };
            const response = await searchAbi(query);

            if (!response) {
                await handleAbiFetch(element, addressTo, apiKey, endpoint, web3);
            } else {
                await handleAbiFromDb(element, response, web3);
            }
        }
    } else {
        console.log("smart contract uploaded manually");
    }
    return internalCalls;
}

/**
 * Handles fetching ABI from the API and decoding the transaction.
 */
async function handleAbiFetch(element, addressTo, apiKey, endpoint, web3) {
    let success = false;

    while (!success) {
        const callForAbi = await axios.get(`${endpoint}?module=contract&action=getsourcecode&address=${addressTo}&apikey=${apiKey}`);
        if (!callForAbi.data.message.includes("NOTOK")) {
            let storeAbi = {
                contractName: callForAbi.data.result[0].ContractName,
                contractAddress: addressTo,
                abi: callForAbi.data.result[0].ABI,
            };
            await saveAbi(storeAbi);

            if (!storeAbi.abi.includes("Contract source code not verified")) {
                decodeInputs(element, storeAbi.abi, web3, callForAbi.data.result[0].ContractName);
            } else {
                element.activity = "Contract source code not verified";
            }
            success = true;
        } else {
            await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait for 5 seconds before retrying
        }
    }
}

/**
 * Handles decoding the transaction using ABI from the database.
 */
async function handleAbiFromDb(element, response, web3) {
    // console.log("ABI found in DB for address:", response.contractAddress);
    if (!response.abi.includes("Contract source code not verified")) {
        let abiFromDb = JSON.parse(response.abi);
        decodeInputs(element, abiFromDb, web3, response.contractName);
    } else {
        if(element.input){
            element.inputsCall=element.input;
            delete element.input;
        }
        element.activity = "Contract source code not verified";
    }
}

/**
 * Decodes the inputs of a transaction using the ABI.
 */
function decodeInputs(element, abi, web3, contractName) {
    const decoder = new InputDataDecoder(abi);
    let tempResult;
    if(element.inputsCall){
        tempResult = decoder.decodeData(element.inputsCall);
        delete element.inputsCall;
    }else{
        tempResult = decoder.decodeData(element.input);
        delete element.input;
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

async function newDecodedInternalTransaction(transactionHash,apiKey, smartContract, endpoint, web3, networkName){
    let internalCalls=await debugInteralTransaction(transactionHash,endpoint, web3);
    if (!smartContract) {
        await connectDB(networkName);
        await decodeInternalRecursive(internalCalls, apiKey, smartContract, endpoint, web3,0);
    } else {
        console.log("smart contract uploaded manually");
    }
    return internalCalls;
}
async function decodeInternalRecursive(internalCalls, apiKey, smartContract, endpoint, web3,depth) {
    for (let element of internalCalls) {
            let addressTo = element.to;
            let query = { contractAddress: addressTo.toLowerCase() };
            element.depth = element.type+"_0_1";
            element.gas=web3.utils.hexToNumber(element.gas);
            element.gasUsed=web3.utils.hexToNumber(element.gasUsed);
            element.value=element.value?web3.utils.hexToNumber(element.value):0;
            for(let i=0;i<depth;i++){
                element.depth += "_1";
            }
            const response = await searchAbi(query);

            if (!response) {
                await handleAbiFetch(element, addressTo, apiKey, endpoint, web3);
            } else {
                await handleAbiFromDb(element, response, web3);
            }
            if( element.calls && element.calls.length > 0) {
                await decodeInternalRecursive(element.calls, apiKey, smartContract, endpoint, web3,depth+1);
            }
    }
}
async function debugInteralTransaction(transactionHash,web3Endpoint,web3) {
    try{
        const rpcUrl = web3.currentProvider?.host || web3Endpoint;
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