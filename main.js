const { Web3 } = require('web3');
const InputDataDecoder = require('ethereum-input-data-decoder');
const solc = require('solc');
const fs = require('fs');
const axios = require("axios");
//let contractAbi = fs.readFileSync('abiEtherscan.json', 'utf8');
let contractAbi = {};
let web3 = new Web3('https://eth-mainnet.g.alchemy.com/v2/ISHV03DLlGo2K1-dqE6EnsyrP2GF44Gt')
let contractTransactions = [];
const abiDecoder = require('abi-decoder');
//const contractAddress = '0x152649eA73beAb28c5b49B26eb48f7EAD6d4c898'cake;
//const contractAddress = '0x5C1A0CC6DAdf4d0fB31425461df35Ba80fCBc110';
//const contractAddress = '0xc9EEf4c46ABcb11002c9bB8A47445C96CDBcAffb';
//const cotractAddressAdidas = 0x28472a58A490c5e09A238847F66A68a47cC76f0f
const hre = require("hardhat");
const helpers = require("@nomicfoundation/hardhat-toolbox/network-helpers");

async function getAllTransactions(mainContract, contractAddress, fromBlock, toBlock) {
    const apiKey = 'I81RM42RCBH3HIC9YEK1GX6KYQ12U73K1C';

    const endpoint = `https://api.etherscan.io/api?module=account&action=txlist&address=${contractAddress}&startblock=${fromBlock}&endblock=${toBlock}&sort=asc&apikey=${apiKey}`;

    const data = await axios.get(endpoint);
    contractTransactions = data.data.result;
    // returns all contracts linked to te contract sent in input from etherscan
    const contracts = await getContractCodeEtherscan(contractAddress);
    // returns 
    const contractTree = await getCompiledData(contracts, mainContract);
    return await getStorageData(contractTransactions, contracts, mainContract, contractTree, contractAddress);

    // writeFiles(jsonLog);
}

module.exports = getAllTransactions;
//CakeOFT
//PixesFarmsLand
//AdidasOriginals
//getAllTransactions("CakeOFT");

async function getStorageData(contractTransactions, contracts, mainContract, contractTree, contractAddress) {
    let blockchainLog = [];
    let partialInt = 0;
    for (const tx of contractTransactions) {
        //if(partialInt < 10){
        console.log("processing transaction " + partialInt)
        const pastEvents = await getEvents(tx.hash, Number(tx.blockNumber), contractAddress);
        let newLog = {
            txHash: tx.hash,
            sender: tx.from,
            gasUsed: tx.gasUsed,
            activity: '',
            timestamp: '',
            inputs: [],
            storageState: [],
            internalTxs: [],
            events: pastEvents
        };
        console.log(tx.hash);
        console.log("-----------------------------------------------------------------------");

        const decoder = new InputDataDecoder(contractAbi);
        const result = decoder.decodeData(tx.input);

        const isoDate = new Date(tx.timeStamp * 1000).toISOString()

        newLog.activity = result.method;
        newLog.timestamp = isoDate

        for (let i = 0; i < result.inputs.length; i++) {
            //check if the input value is an array or a struct
            // TODO -> check how a Struct array is represented
            // Deploy a SC in a Test Net and send a tx with input data to decode its structure
            if (Array.isArray(result.inputs[i])) {
                let bufferTuple = [];
                //if it is a struct split the sub-attributes
                if (result.types[i].includes(",")) {
                    const bufferTypes = result.types[i].split(",");
                    for (let z = 0; z < result.inputs[i].length; z++) {
                        bufferTuple.push(await decodeInput(bufferTypes[z], result.inputs[i][z]));
                    }
                } else {
                    for (let z = 0; z < result.inputs[i].length; z++) {
                        bufferTuple.push(await decodeInput(result.types[i], result.inputs[i][z]));
                    }
                }

                newLog.inputs[i] = {
                    name: result.names[i],
                    type: result.types[i],
                    value: bufferTuple
                }
            } else {
                newLog.inputs[i] = {
                    name: result.names[i],
                    type: result.types[i],
                    value: await decodeInput(result.types[i], result.inputs[i])
                }
            }
        }

        const storageVal = await getTraceStorage(tx.blockNumber, tx.functionName.split("(")[0], tx.hash,
            mainContract, contracts, contractTree, partialInt);
        newLog.storageState = storageVal.decodedValues;
        newLog.internalTxs = storageVal.internalCalls;
        blockchainLog.push(newLog)
        partialInt++;
    }
    try {
        return blockchainLog;
    } catch (error) {
        console.error(`Error writing output file: ${error}`);
    }
}


async function decodeInput(type, value) {
    if (type === 'uint256') {
        return Number(web3.utils.hexToNumber(value._hex));
    } else if (type === 'string') {
        return web3.utils.hexToAscii(value);
    } else if (type.includes("byte")) {
        return value;
        //return JSON.stringify(web3.utils.hexToBytes(value)).replace("\"", "");
    } else if (type.includes("address")) {
        return value;
    } else {
        return value;
    }
}

async function getTraceStorage(blockNumber, functionName, txHash, mainContract, contracts, contractTree, _counter) {

    /* const provider = ganache.provider({
         network_id: 1,
         fork: 'https://mainnet.infura.io/v3/f3851e4d467341f1b5927b6546d9f30c\@' + blockNumber
     });
     const response = await provider.request({
         method: "debug_traceTransaction",
         params: [txHash]
     });*/
    await helpers.reset("https://eth-mainnet.g.alchemy.com/v2/ISHV03DLlGo2K1-dqE6EnsyrP2GF44Gt", Number(blockNumber));
    //  hre.network.config.forking.blockNumber = Number(blockNumber);
    // console.log(hre.config);
    //check for historical fork
    const t = new Date();
    const response = await hre.network.provider.send("debug_traceTransaction", [
        txHash
    ]);

    const t1 = new Date();
    //console.log(t1 - t);
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
    if (response.structLogs)
    // fs.writeFileSync("./temporaryTrials/trace_" + _counter + ".json", JSON.stringify(response.structLogs));

    // let counter = 0
    for (const trace of response.structLogs) {
        //if SHA3 is found then read all keys before being hashed
        // computation of the memory location and the storage index of a complex variable (mapping or struct)
        // in the stack we have the offset and the lenght of the memory
        if (trace.op === "SHA3") {
            //console.log(trace);
            fs.writeFileSync("./temporaryTrials/trace.json", JSON.stringify(trace), { flag: "a+" });
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
            fs.writeFileSync("./temporaryTrials/trace.json", JSON.stringify(trace), { flag: "a+" });
            for (const slot in trace.storage) {
                functionStorage[slot] = trace.storage[slot];
            }
        } else if (trace.pc === (bufferPC + 1)) {
            fs.writeFileSync("./temporaryTrials/trace.json", JSON.stringify(trace), { flag: "a+" });
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
            let call = { type: trace.op, to: trace.stack[trace.stack.length - 2], inputs: [] }
            //read all the inputs from the memory and insert it in the call object
            for (let i = offsetNumber; i <= offsetNumber + lengthNumber; i++) {
                call.inputs.push(trace.memory[i]);
            }
            internalCalls.push(call);
        } else if (trace.op === "DELEGATECALL" || trace.op === "STATICCALL") {
            // internalCalls.push(trace.stack[trace.stack.length - 2]);
            const offsetBytes = trace.stack[trace.stack.length - 3];
            let offsetNumber = await web3.utils.hexToNumber("0x" + offsetBytes) / 32;
            const lengthBytes = trace.stack[trace.stack.length - 4];
            let lengthNumber = await web3.utils.hexToNumber("0x" + lengthBytes) / 32;
            let call = { type: trace.op, to: trace.stack[trace.stack.length - 2], inputs: [] }
            for (let i = offsetNumber; i <= offsetNumber + lengthNumber; i++) {
                call.inputs.push(trace.memory[i]);
            }
            internalCalls.push(call);
        } else if (trace.op === "RETURN") {
            //console.log(trace);
        }
        // fs.writeFileSync("./temporaryTrials/trace.json", JSON.stringify(trace), {flag: "a+"});
    }

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

    if (Object.keys(functionStorage).length !== 0) {
        fs.writeFileSync('./temporaryTrials/functionStorage.json', JSON.stringify(functionStorage));
        fs.writeFileSync('./temporaryTrials/finalShaTraces.json', JSON.stringify(finalShaTraces));
    }
    const decodedValues = await newDecodeValues(uniqueSStore, contractTree, finalShaTraces, functionStorage, functionName, contracts, mainContract);
    return { decodedValues, internalCalls };

}

//cleanTest(18424870, "sendFrom", "0x446f97e43687382fefbc6a9c4cccd055829ef2909997fb102a1728db6b37b76a", "CakeOFT");

//function for re-generating the key and understand the variable thanks to the tests on the storage locationapprove(address spender,uint256 amount)0x095ea7b3


async function getContractVariable(slotIndex, contractTree, functionName, contracts, mainContract) {
    let contractVariables = [];
    //iterates all contracts in contract tree
    for (const contractId in contractTree) {
        //if contract is the chosen one and it has function then take variable
        if (contractTree[contractId].name === mainContract && contractTree[contractId].functions.includes(functionName)) {
            //iterate contract variables
            for (const contractVariable of contractTree[contractId].storage) {
                //check if there are more variables for the same index due to optimization purposes
                if (Number(contractVariable.slot) === Number(slotIndex)) {
                    contractVariables.push(contractVariable);
                }
            }
        }
    }
    return contractVariables;
}

async function newDecodeValues(sstore, contractTree, shaTraces, functionStorage, functionName, contracts, mainContract) {
    // console.log(contractTree["4514"].storage);
    let decodedValues = [];
    //iterate storage keys looking for complex keys coming from SHA3
    for (const storageVar in functionStorage) {
        for (const shaTrace of shaTraces) {
            if (storageVar === shaTrace.finalKey) {
                const slotIndex = web3.utils.hexToNumber("0x" + shaTrace.hexStorageIndex);
                const contractVar = await getContractVariable(slotIndex, contractTree, functionName, contracts, mainContract);
                const decodedValue = await decodeStorageValue(contractVar[0], functionStorage[storageVar], storageVar);
                const bufferVariable = { name: contractVar[0].name, type: contractVar[0].type, value: decodedValue, rawValue: functionStorage[storageVar] };
                decodedValues.push(bufferVariable);
                //delete functionStorage[storageVar];
            }
        }
    }
    //storage should have only non-complex keys so only simple numbers representing slots
    //todo deal with variables storage optimizations
    //todo deal with sstore complex keys not present in any SHA
    for (const storageVar in functionStorage) {
        for (let sstoreIndex = 0; sstoreIndex < sstore.length; sstoreIndex++) {
            const numberIndex = web3.utils.hexToNumber("0x" + sstore[sstoreIndex]);
            if (storageVar === sstore[sstoreIndex] && numberIndex < 30) {
                const contractVar = await getContractVariable(numberIndex, contractTree, functionName, contracts, mainContract);
                if (contractVar.length > 1) {
                    const updatedVariables = await readVarFromOffset(contractVar, functionStorage[storageVar]);
                    for (let varI = 0; varI < updatedVariables.length; varI++) {
                        const decodedValue = await decodeStorageValue(updatedVariables[varI], updatedVariables[varI].value);
                        const bufferVariable = {
                            name: updatedVariables[varI].name,
                            type: updatedVariables[varI].type,
                            value: decodedValue,
                            rawValue: functionStorage[storageVar]
                        };
                        decodedValues.push(bufferVariable);
                    }
                } else {
                    const decodedValue = await decodeStorageValue(contractVar[0], functionStorage[storageVar]);
                    const bufferVariable = {
                        name: contractVar[0].name,
                        type: contractVar[0].type,
                        value: decodedValue,
                        rawValue: functionStorage[storageVar]
                    };
                    decodedValues.push(bufferVariable);
                    //delete functionStorage[storageVar];
                }
            }
        }
    }
    return decodedValues;
}


async function decodeValues(sstore, contractTree, trackBuffer, functionStorage, functionName, contracts, mainContract) {
    //console.log(functionStorage);
    //iterate the tree of contracts
    let decodedValues = [];
    // console.log(contractTree);
    for (const contractId in contractTree) {
        //if the contract is the main one then check the storage
        if (contractTree[contractId].name === mainContract && contractTree[contractId].functions.includes(functionName)) {
            //iterate the SHA3 traces for mappings
            for (const trace of trackBuffer) {
                //convert storage index to integer
                const slotIndex = await web3.utils.hexToNumber("0x" + trace.hexStorageIndex);

                //iterate the possible variables of the matching contract
                // console.log(contractTree[contractId].storage);
                //todo fix the double index case
                //todo case of two variables in the same slot for optimization purpose
                for (const contractVariable of contractTree[contractId].storage) {
                    let bufferVariable = {};
                    //if the variable has the same slot then it is
                    if (Number(contractVariable.slot) === Number(slotIndex) && (functionStorage[trace.finalKey] !== undefined)) {
                        const varVal = await decodeStorageValue(contractVariable, functionStorage[trace.finalKey]);
                        //todo capire se ha cancellato, creato o aggiornato
                        bufferVariable = { name: contractVariable.name, type: contractVariable.type, value: varVal };
                        decodedValues.push(bufferVariable);
                    } else {
                        for (const sstoreIndex of sstore) {
                            const integerSlot = await web3.utils.hexToNumber("0x" + sstoreIndex);
                            if (integerSlot === Number(contractVariable.slot) && (functionStorage[sstoreIndex] !== undefined)) {
                                const varVal = await decodeStorageValue(contractVariable, functionStorage[sstoreIndex]);
                                bufferVariable = { name: contractVariable.name, type: contractVariable.type, value: varVal };
                                decodedValues.push(bufferVariable);
                            }
                        }
                    }
                }
            }
        }
    }
    return decodedValues;

}

async function readVarFromOffset(variables, value) {
    const fullWord = value.split('');
    let values = [];
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
                values.push(slicedWord.join(''));
                variables[i].value = slicedWord.join('');
            } else {
                const nextOffset = (variables[i + 1].offset) * 2;
                len = len - nextOffset;
                const slicedWord = fullWord.slice(len, nextOffset);
                values.push(slicedWord.join(''));
                variables[i].value = slicedWord.join('');
            }
        } else {
            const slicedWord = fullWord.join('');
            values.push(slicedWord);
            variables[i].value = slicedWord;
        }
    }
    return variables;

}

//function for decoding the storage value
async function decodeStorageValue(variable, value, storageVar) {

    //console.log("variable to handle: --------->" + value);
    //if it is a mapping check for last type of value by splitting it so to cover also nested case
    if (variable.type.includes("mapping")) {
        const typeBuffer = variable.type.split(",");
        const valueType = typeBuffer[typeBuffer.length - 1];
        if (valueType.includes("uint")) {
            return Number(web3.utils.hexToNumber("0x" + value));
        } else if (valueType.includes("string")) {
            return web3.utils.hexToAscii("0x" + value);
        } else if (valueType.includes("t_bool")) {
            if (value === "0000000000000000000000000000000000000000000000000000000000000000") {
                return false;
            } else {
                return true;
            }
        } else if (valueType.includes("bytes")) {
            return JSON.stringify(web3.utils.hexToBytes("0x" + value)).replace("\"", "");
        } else if (valueType.includes("address")) {
            return value;
        } else if (valueType.includes("struct")) {
        }
    } else if (variable.type.includes("array")) {
        return value;
    } else {
        if (variable.type.includes("uint")) {
            return Number(web3.utils.hexToNumber("0x" + value));
        } else if (variable.type.includes("string")) {
            return web3.utils.hexToString("0x" + value);
        } else if (variable.type.includes("bool")) {
            if (value === "0000000000000000000000000000000000000000000000000000000000000000") {
                return false;
            } else {
                return true;
            }
        } else if (variable.type.includes("bytes")) {
            return JSON.stringify(web3.utils.hexToBytes("0x" + value)).replace("\"", "");
        } else if (variable.type.includes("address")) {
            return value;
        }
    }
    return value;
}


async function convertStorageKeys(functionStorage) {
    //console.log(functionStorage);
    let storageKeys = [];
    const buffer = Object.keys(functionStorage);
    for (const storageKey of buffer) {
        storageKeys.push('0x' + storageKey);
    }
    return storageKeys;
}

async function getVarFromFunction(functionVariables, functionNames, storageSlot, variableAstTree, mainContract) {

    for (const astVar in variableAstTree) {
        for (const _var of variableAstTree[astVar]) {
            if (_var.baseContract === mainContract && Number(_var.slot) === Number(storageSlot)) {
                return _var;
            }
        }
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


    for (const contract in contracts) {
        input.sources[contract] = {};
        input.sources[contract].content = contracts[contract].content;
    }

    const output = solc.compile(JSON.stringify(input));
    fs.writeFileSync('testContract.json', output);

    const source = JSON.parse(output).sources;
    contractAbi = JSON.stringify(await getAbi(JSON.parse(output), contractName));
    //fs.writeFileSync('abitest.json', JSON.stringify(contractAbi));
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
                contractTree[directive.id].name = directive.canonicalName;
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
    const apiKey = 'I81RM42RCBH3HIC9YEK1GX6KYQ12U73K1C';
    const endpoint = `https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${apiKey}`;
    let contracts = [];
    let buffer;
    const response = await axios.get(endpoint);
    const data = response.data;
    let i = 0;
    fs.writeFileSync('./temporaryTrials/dataResult.json', JSON.stringify(data.result[0]))
    let jsonCode = data.result[0].SourceCode;
    //console.log(jsonCode);
    fs.writeFileSync('prova12', JSON.stringify(data.result[0]));

    if(jsonCode.charAt(0) == "{"){


    // fs.writeFileSync('contractEtherscan.json', jsonCode);
    //fs.writeFileSync('solcOutput', jsonCode);
    //const realResult = fs.readFileSync('solcOutput');
    jsonCode = JSON.parse(jsonCode.slice(1, -1)).sources
        for (const contract in jsonCode) {

            let actualContract = 'contract' + i;
            let code = jsonCode[contract].content;
            contracts[contract] = {};
            contracts[contract].nameId = actualContract;
            contracts[contract].content = code;
            //input.sources[contract] = {}
            //input.sources[contract].content = code
            //fs.writeFileSync('smartContracts/' + actualContract, JSON.stringify(code));
            i++;
            buffer += code
        }
    }else{
        let actualContract = 'contract'+i;
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

                fs.writeFileSync('./temporaryTrials/contractStorageTree.json', JSON.stringify(contractStorageTree[firstKey]), { flag: "a+" })
            }
        }
    }

    return contractStorageTree;
}

async function getEvents(txHash, block, contractAddress) {
    const myContract = new web3.eth.Contract(JSON.parse(contractAbi), contractAddress);
    let filteredEvents = [];
    const pastEvents = await myContract.getPastEvents("allEvents", { fromBlock: block, toBlock: block });
    for (let i = 0; i < pastEvents.length; i++) {
        for (const value in pastEvents[i].returnValues) {
            if (typeof pastEvents[i].returnValues[value] === "bigint") {
                pastEvents[i].returnValues[value] = Number(pastEvents[i].returnValues[value]);
            }
        }
        const event = {
            name: pastEvents[i].event,
            values: pastEvents[i].returnValues
        };
        filteredEvents.push(event);

    }

    return filteredEvents;
}
