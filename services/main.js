const {Web3} = require('web3');
const InputDataDecoder = require('ethereum-input-data-decoder');
const fs = require('fs');
const axios = require("axios");
const {stringify} = require("csv-stringify")
//let contractAbi = fs.readFileSync('abiEtherscan.json', 'utf8');
let contractAbi = {};
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

let networkName = ""
let web3 = null
let web3Endpoint = ""
let apiKey = ""
let endpoint = ""

let inputId = 0
let internalTxId = 0
let eventId = 0

let _contractAddress = ""

let contractCompiled = null

let traceTime = 0
let decodeTime = 0
const csvColumns = ["txHash", "debugTime", "decodeTime", "totalTime"]

async function getAllTransactions(mainContract, contractAddress, fromBlock, toBlock, network, filters, smartContract) {

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
        const data = await axios.get(endpoint + `?module=account&action=txlist&address=${contractAddress}&startblock=${fromBlock}&endblock=${toBlock}&sort=asc&apikey=${apiKey}`)
        const contractTransactions = await data.data.result
        // returns all contracts linked to te contract sent in input from etherscan
        let contracts = null
        if (smartContract) {
            contracts = smartContract
        } else {
            contracts = await getContractCodeEtherscan(contractAddress);
        }
        const contractTree = await getCompiledData(contracts, mainContract);
        return await getStorageData(contractTransactions, contracts, mainContract, contractTree, contractAddress, filters, fromBlock, toBlock);
        // let csvRow = []
        // csvRow.push({
        //     txHash: null,
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

async function debugTransaction(txHash, blockNumber) {
    try {
        await hre.changeNetwork(networkName, blockNumber)
        const start = new Date()
        const response = await hre.network.provider.send("debug_traceTransaction", [
            txHash
        ]);

        fs.writeFileSync("./temporaryTrials/trace.json", JSON.stringify(response));
        const end = new Date()
        const requiredTime = parseFloat(((end - start) / 1000).toFixed(2))
        traceTime += requiredTime
        return {response, requiredTime}
    } catch (err) {
        console.error(err)
        throw new Error(err.message)
    }
}

async function getStorageData(contractTransactions, contracts, mainContract, contractTree, contractAddress, filters, fromBlock, toBlock) {
    let blockchainLog = [];
    let partialInt = 0;

    const userLog = {
        networkUsed: networkName,
        contractAddress,
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

    await saveExtractionLog(userLog)

    contractTransactions.map(tx => {
        const decoder = new InputDataDecoder(contractAbi);
        tx.inputDecoded = decoder.decodeData(tx.input);
    })

    const transactionsFiltered = applyFilters(contractTransactions, filters)
    // stringify([], {header: true, columns: csvColumns}, (err, output) => {
    //     fs.writeFileSync('csvLogs.csv', output)
    // })

    await connectDB(networkName)
    for (const tx of transactionsFiltered) {
        let query = {
            txHash: tx.hash.toLowerCase(),
            contractAddress: contractAddress.toLowerCase()
        }

        let transaction;

        const response = await searchTransaction(query)

        console.log("Transactions found -> ", response);

        if (response)
            transaction = response;

        if (transaction) {
            console.log("transaction already processed: ", tx.hash)
            blockchainLog.push(...transaction);
            console.log("-----------------------------------------------------------------------");
        } else {
            console.log("Processing transaction " + partialInt)
            console.log(tx.hash);
            const {response, requiredTime} = await debugTransaction(tx.hash, tx.blockNumber)

            //if(partialInt < 10){
            const start = new Date()
            const pastEvents = await getEvents(tx.hash, Number(tx.blockNumber), contractAddress);
            let newLog = {
                txHash: tx.hash,
                blockNumber: parseInt(tx.blockNumber),
                contractAddress: tx.to,
                sender: tx.from,
                gasUsed: parseInt(tx.gasUsed),
                activity: tx.inputDecoded.method,
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
                        inputId: "inputName_" + inputId + "_" + tx.hash,
                        inputName: inputName,
                        type: tx.inputDecoded.types[i],
                        inputValue: bufferTuple.toString()
                    }
                } else {
                    newLog.inputs[i] = {
                        inputId: "inputName_" + inputId + "_" + tx.hash,
                        inputName: inputName,
                        type: tx.inputDecoded.types[i],
                        inputValue: decodeInput(tx.inputDecoded.types[i], tx.inputDecoded.inputs[i])
                    }
                }
                inputId++
            }

            const storageVal = await getTraceStorage(response, tx.blockNumber, tx.inputDecoded.method, tx.hash,
                mainContract, contracts, contractTree, partialInt);
            newLog.storageState = storageVal.decodedValues;
            newLog.internalTxs = storageVal.internalCalls;
            const end = new Date()
            const requiredDecodeTime = parseFloat(((end - start) / 1000).toFixed(2))
            decodeTime += requiredDecodeTime
            // let csvRow = []
            // csvRow.push({
            //     txHash: tx.hash,
            //     debugTime: requiredTime,
            //     decodeTime: requiredDecodeTime,
            //     totalTime: parseFloat((requiredTime + requiredDecodeTime).toFixed(2))
            // })
            // stringify(csvRow, (err, output) => {
            //     fs.appendFileSync('csvLogs.csv', output)
            // })
            blockchainLog.push(newLog)
            await saveTransaction(newLog, tx.to)
            console.log("-----------------------------------------------------------------------");
        }
        partialInt++;
    }
    console.log("Extraction finished")
    await mongoose.disconnect()
    return blockchainLog;
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

async function getTraceStorage(traceDebugged, blockNumber, functionName, txHash, mainContract, contracts, contractTree) {
    /* const provider = ganache.provider({
         network_id: 1,
         fork: 'https://mainnet.infura.io/v3/f3851e4d467341f1b5927b6546d9f30c\@' + blockNumber
     });
     const response = await provider.request({
         method: "debug_traceTransaction",
         params: [txHash]
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
    //     txHash
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
    let internalCalls = [];

    if (traceDebugged.structLogs) {
        for (const trace of traceDebugged.structLogs) {
            //if SHA3 is found then read all keys before being hashed
            // computation of the memory location and the storage index of a complex variable (mapping or struct)
            // in the stack we have the offset and the lenght of the memory
            if (trace.op === "SHA3") {
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

                // end of a function execution -> returns the storage state with the keys and values in the storage
            } else if (trace.op === "STOP") {
                //retrieve the entire storage after function execution
                //for each storage key discard the ones of static variables and compare the remaining ones with the re-generated
                for (const slot in trace.storage) {
                    functionStorage[slot] = trace.storage[slot];
                }
            } else if (trace.pc === (bufferPC + 1)) {
                bufferPC = 0;
                trackBuffer[index].finalKey = trace.stack[trace.stack.length - 1];
                index++;
            }
                //in case the trace is a SSTORE save the key. CAUTION: not every SSTORE changes the final storage state but every storage state change has an sstore
                // SSTORE -> updates the storage state
            // in the code we save the stack updated with the new value (the last element of the stack is the value to store in the storage slot)
            else if (trace.op === "SSTORE") {
                sstoreBuffer.push(trace.stack[trace.stack.length - 1]);
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
                let call = {
                    callId: "call_" + internalTxId + txHash,
                    callType: trace.op,
                    to: trace.stack[trace.stack.length - 2],
                    inputsCall: []
                }
                //read all the inputs from the memory and insert it in the call object
                for (let i = offsetNumber; i <= offsetNumber + lengthNumber; i++) {
                    call.inputsCall.push(trace.memory[i]);
                }
                internalCalls.push(call);
            } else if (trace.op === "DELEGATECALL" || trace.op === "STATICCALL") {
                // internalCalls.push(trace.stack[trace.stack.length - 2]);
                const offsetBytes = trace.stack[trace.stack.length - 3];
                let offsetNumber = await web3.utils.hexToNumber("0x" + offsetBytes) / 32;
                const lengthBytes = trace.stack[trace.stack.length - 4];
                let lengthNumber = await web3.utils.hexToNumber("0x" + lengthBytes) / 32;
                let call = {
                    callId: "call_" + internalTxId + txHash,
                    callType: trace.op,
                    to: trace.stack[trace.stack.length - 2],
                    inputsCall: []
                }
                for (let i = offsetNumber; i <= offsetNumber + lengthNumber; i++) {
                    call.inputsCall.push(trace.memory[i]);
                }
                internalCalls.push(call);
            } else if (trace.op === "RETURN") {
                //console.log(trace);
            }
            // fs.writeFileSync("./temporaryTrials/trace.json", JSON.stringify(trace), {flag: "a+"});
            internalTxId++
        }
    }

    fs.writeFileSync("./temporaryTrials/storeBuffer.json", JSON.stringify(sstoreBuffer));
    let finalShaTraces = [];
    for (let i = 0; i < trackBuffer.length; i++) {
        //check if the SHA3 key is contained in an SSTORE
        if (sstoreBuffer.includes(trackBuffer[i].finalKey)) {
            //create a final trace for that key
            const trace = {
                finalKey: trackBuffer[i].finalKey
            }
            let flag = false;
            let test = i;
            //Iterate previous SHA3 looking for a simple integer slot index
            while (flag === false) {
                //if the storage key is not a standard number then check for the previous one
                if (!(web3.utils.hexToNumber("0x" + trackBuffer[test].hexStorageIndex) < 30)) {
                    test--;
                } else {
                    //if the storage location is a simple one then save it in the final trace with the correct key
                    trace.hexStorageIndex = trackBuffer[test].hexStorageIndex;
                    flag = true;
                    finalShaTraces.push(trace);
                }
            }
            sstoreBuffer.splice(sstoreBuffer.indexOf(trackBuffer[i].finalKey), 1);
        }

    }

    //const uniqueTraces = Array.from(new Set(finalTraces.map(JSON.stringify))).map(JSON.parse);
    //removes duplicate storing keys, it will catch only the last update done on a variable
    const uniqueSStore = Array.from(new Set(sstoreBuffer.map(JSON.stringify))).map(JSON.parse);
    // const uniqueStorage = Array.from(new Set(functionStorage.map(JSON.stringify))).map(JSON.parse);
    fs.writeFileSync('./temporaryTrials/uniqueSStore.json', JSON.stringify(uniqueSStore));
    if (Object.keys(functionStorage).length !== 0) {
        // fs.writeFileSync(`./temporaryTrials/functionStorage_${txHash}.json`, JSON.stringify(functionStorage));
        fs.writeFileSync('./temporaryTrials/finalShaTraces.json', JSON.stringify(finalShaTraces));
    }
    const decodedValues = await newDecodeValues(uniqueSStore, contractTree, finalShaTraces, functionStorage, functionName, contracts, mainContract, txHash);
    return {decodedValues, internalCalls};
}

//cleanTest(18424870, "sendFrom", "0x446f97e43687382fefbc6a9c4cccd055829ef2909997fb102a1728db6b37b76a", "CakeOFT");

//function for re-generating the key and understand the variable thanks to the tests on the storage locationapprove(address spender,uint256 amount)0x095ea7b3


function getContractVariable(slotIndex, contractTree, functionName, contracts, mainContract) {
    let contractVariables = [];
    //iterates all contracts in contract tree
    for (const contractId in contractTree) {
        //if contract is the chosen one and it has function then take variable
        if (contractTree[contractId].name === mainContract && contractTree[contractId].functions.includes(functionName)) {
            //iterate contract variables
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

// used to merge storage variables of structs member in static array
function mergeVariableValues(arr) {
    return Object.values(arr.reduce((acc, item) => {
        const variableValue = JSON.parse(item.variableValue);
        const arrayIndex = variableValue.arrayIndex;

        if (arrayIndex !== undefined) {
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
            if (!acc[item.type]) {
                acc[item.type] = {
                    ...item,
                    variableValue: variableValue
                }
            } else {
                acc[item.type].variableValue = {
                    ...acc[item.type].variableValue,
                    ...variableValue
                }
            }
        }

        return acc;
    }, {})).map(item => ({
        ...item,
        variableValue: typeof item.variableValue === "object" ? JSON.stringify(item.variableValue) : item.variableValue
    }));
}

async function newDecodeValues(sstore, contractTree, shaTraces, functionStorage, functionName, contracts, mainContract, txHash) {
    // console.log(contractTree["4514"].storage);
    let decodedValues = [];
    //iterate storage keys looking for complex keys coming from SHA3
    for (const storageVar in functionStorage) {
        for (const shaTrace of shaTraces) {
            if (storageVar === shaTrace.finalKey) {
                const slotIndex = web3.utils.hexToNumber("0x" + shaTrace.hexStorageIndex);
                const contractVar = getContractVariable(slotIndex, contractTree, functionName, contracts, mainContract);
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
    //storage should have only non-complex keys so only simple numbers representing slots
    //todo deal with variables storage optimizations
    //todo deal with sstore complex keys not present in any SHA
    for (const storageVar in functionStorage) {
        for (let sstoreIndex = 0; sstoreIndex < sstore.length; sstoreIndex++) {
            const numberIndex = web3.utils.hexToNumber("0x" + sstore[sstoreIndex]);
            if (storageVar === sstore[sstoreIndex]) {
                const contractVar = getContractVariable(numberIndex, contractTree, functionName, contracts, mainContract);
                if (contractVar.length > 1) {
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
                    const decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage)
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

    // merge the struct's member in a static array
    const isStructArray = decodedValues.some(item => typeof item.variableValue === "string" && item.variableValue.includes("arrayIndex"));
    if (isStructArray) {
        decodedValues = mergeVariableValues(decodedValues);
    }

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

function decodePrimitiveType(type, value) {
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

function getMainContractCompiled(mainContract) {
    const testContract = JSON.parse(contractCompiled);
    for (const contract in testContract.contracts) {
        const firstKey = Object.keys(testContract.contracts[contract])[0];
        if (firstKey === mainContract) {
            return testContract.contracts[contract][firstKey]
        }
    }
}

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

function decodeStructType(variable, value, mainContract, storageVar) {
    const getContractCompiled = getMainContractCompiled(mainContract);
    const members = getStructMembersByVariableName(variable.name, getContractCompiled);
    const memberItem = {
        struct: variable.type.split("(")[1].split(")")[0],
    }
    // TODO array member
    members.forEach((member) => {
        const memberSlot = Number(member.slot) + Number(variable.slot)
        if (memberSlot === web3.utils.toDecimal("0x" + storageVar)) {
            memberItem[member.label] = decodePrimitiveType(member.type, value)
        }
    })
    return JSON.stringify(memberItem)
}

function optimezedArray(arraySize, typeSize, functionStorage, slot) {
    const storageStringLength = 64
    const charsForElement = typeSize / 4
    const elementNumberPerString = storageStringLength / charsForElement
    if (arraySize <= elementNumberPerString - 1) {
        return functionStorage[slot].slice(0, storageStringLength - (arraySize * charsForElement))
    } else {
        const arrayStorageSlot = Math.floor(arraySize / elementNumberPerString)
        const newSlot = BigInt("0x" + slot) + BigInt(arrayStorageSlot)
        const newStorageSlot = functionStorage[newSlot.toString(16).padStart(64, '0')]
        return newStorageSlot.slice(0, storageStringLength - (arraySize * charsForElement))
    }
}

function decodeStaticArray(variable, value, mainContract, storageVar, arraySize, functionStorage) {
    const arrayStorageSlot = Number(variable.slot);
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
    } else if ((variable.type.includes("uint") || variable.type.includes("int")) && !variable.type.includes("256")) {
        const hexStorageSlot = arrayStorageSlot.toString(16)
        const storageSlotPadded = hexStorageSlot.padStart(64, '0')
        // TODO: fix static array with optimization
        const value = optimezedArray(arraySize - 1, variable.type.split("uint")[1].split(")")[0], functionStorage, storageSlotPadded)
        output.value = web3.utils.hexToNumber("0x" + value)
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
    //TODO optimize the code
}

function decodeDynamicArray(variable, value, mainContract, storageVar, functionStorage) {
    const lastIndex = web3.utils.hexToNumber("0x" + value) - 1
    let arrayStorageSlot = web3.utils.keccak256("0x" + storageVar)
    const output = {
        arrayIndex: lastIndex
    }
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
        output.value = decodePrimitiveType(variable.type, functionStorage[arrayStorageSlot.toString(16)])
        return JSON.stringify(output)
    }
}

//function for decoding the storage value
function decodeStorageValue(variable, value, mainContract, storageVar, functionStorage) {
    //if it is a mapping check for last type of value by splitting it so to cover also nested case
    if (variable.type.includes("mapping")) {
        const typeBuffer = variable.type.split(",");
        const valueType = typeBuffer[typeBuffer.length - 1];
        if (valueType.includes("struct")) {
            //TODO decode mapping of struct
            return "miss mapping of struct"
        } else {
            return decodePrimitiveType(valueType, value);
        }
    } else if (variable.type.includes("array")) {
        console.log("Variable: ", variable)
        const arrayTypeSplitted = variable.type.split(")")
        const arraySize = arrayTypeSplitted[arrayTypeSplitted.length - 1].split("_")[0]
        if (arraySize !== "dyn") {
            return decodeStaticArray(variable, value, mainContract, storageVar, Number(arraySize), functionStorage)
        } else {
            return decodeDynamicArray(variable, value, mainContract, storageVar, functionStorage)
        }
    } else if (variable.type.includes("struct")) {
        return decodeStructType(variable, value, mainContract, storageVar)
    } else {
        return decodePrimitiveType(variable.type, value);
    }
}

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
    const solcSnapshot = await getRemoteVersion(solidityVersion.replace("soljson-", "").replace(".js", ""))

    const output = solcSnapshot.compile(JSON.stringify(input));
    contractCompiled = output
    fs.writeFileSync('testContract.json', output);
    if (!JSON.parse(output).contracts) {
        throw new Error(JSON.parse(output).errors[0].message);
    }

    const source = JSON.parse(output).sources;
    contractAbi = JSON.stringify(await getAbi(JSON.parse(output), contractName));
    // fs.writeFileSync('abitest.json', JSON.stringify(contractAbi));
    //get all storage variable for contract, including inherited ones
    const storageData = await getContractVariableTree(JSON.parse(output));
    //take the effective tree
    const contractStorageTree = storageData;
    //get tree of functions for contract, NOT including inherited
    const contractTree = await getFunctionContractTree(source);
    fs.writeFileSync('./temporaryTrials/contractTree.json', JSON.stringify(contractTree));
    //construct full function tree including also the inherited ones
    const contractFunctionTree = await constructFullFunctionContractTree(contractTree);
    fs.writeFileSync('./temporaryTrials/contractFunctionTree.json', JSON.stringify(contractFunctionTree));
    //construct full contract tree including also variables
    const fullContractTree = await injectVariablesToTree(contractFunctionTree, contractStorageTree);
    fs.writeFileSync('./temporaryTrials/fullContractTree.json', JSON.stringify(fullContractTree));

    return fullContractTree;
}

async function getAbi(compiled, contractName) {
    for (const contract in compiled.contracts) {
        const firstKey = Object.keys(compiled.contracts[contract])[0];
        if (firstKey === contractName) {
            return compiled.contracts[contract][firstKey].abi;
        }
    }
}

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
    return contractFunctionTree;
}

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

async function getFunctionContractTree(source) {

    // let contractToIterate = [];
    let contractTree = {};
    let counter = 0
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

async function getContractCodeEtherscan(contractAddress) {
    let contracts = [];
    let buffer;
    const response = await axios.get(endpoint + `?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${apiKey}`);
    const data = response.data;
    if (data.result[0].SourceCode === "") {
        throw new Error("No contract found");
    }
    let i = 0;
    fs.writeFileSync('./temporaryTrials/dataResult.json', JSON.stringify(data.result[0]))
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

async function getContractVariableTree(compiled) {
    let contractStorageTree = [];
    //iterate all contracts
    for (const contract in compiled.contracts) {
        //utility for getting the key corresponding to the specific contract and access it
        const firstKey = Object.keys(compiled.contracts[contract])[0];
        //check that the contract has some state variables
        if (compiled.contracts[contract][firstKey].storageLayout.storage.length !== 0) {
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

                fs.writeFileSync('./temporaryTrials/contractStorageTree.json', JSON.stringify(contractStorageTree[firstKey]), {flag: "a+"})
            }
        }
    }

    return contractStorageTree;
}

async function getEvents(txHash, block, contractAddress) {
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
            eventId: "event_" + eventId + "_" + txHash,
            eventName: pastEvents[i].event,
            eventValues: pastEvents[i].returnValues
        };
        filteredEvents.push(event);
        eventId++
    }

    return filteredEvents;
}
