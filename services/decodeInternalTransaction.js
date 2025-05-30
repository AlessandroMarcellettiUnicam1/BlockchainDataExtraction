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
    if (!response.abi.includes("Contract source code not verified")) {
        let abiFromDb = JSON.parse(response.abi);
        decodeInputs(element, abiFromDb, web3, response.contractName);
    } else {
        element.activity = "Contract source code not verified";
    }
}

/**
 * Decodes the inputs of a transaction using the ABI.
 */
function decodeInputs(element, abi, web3, contractName) {
    const decoder = new InputDataDecoder(abi);
    const tempResult = decoder.decodeData("0x" + element.inputsCall);

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

module.exports = { decodeInternalTransaction };