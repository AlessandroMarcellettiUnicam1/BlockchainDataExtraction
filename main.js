const {Web3} = require('web3');
const InputDataDecoder = require('ethereum-input-data-decoder');
const solc = require('solc');
const fs = require('fs');
const axios = require("axios");
const {Network, Alchemy} = require("alchemy-sdk");
const ethers = require("ethers");
const https = require("https");
const ganache = require("ganache");
const {spawn} = require('child_process');
const buffer = require("buffer");
const Moralis = require("moralis").default;
const sourceCode = fs.readFileSync('contractEtherscan.sol', 'utf8');
let contractAbi = fs.readFileSync('abiEtherscan.json', 'utf8');
let localweb3 = new Web3('HTTP://127.0.0.1:8545')
let web3 = new Web3('https://eth-mainnet.g.alchemy.com/v2/ISHV03DLlGo2K1-dqE6EnsyrP2GF44Gt')
let transactions = [];
let generalStorageLayout;
let contractTransactions = [];
let blockchainLog = [{}];
const abiDecoder = require('abi-decoder');
const {EvmChain} = require("@moralisweb3/common-evm-utils");
const contractAddress = '0x152649eA73beAb28c5b49B26eb48f7EAD6d4c898';
const hre = require("hardhat");
const helpers = require("@nomicfoundation/hardhat-toolbox/network-helpers");


const nodeUrl = 'HTTP://127.0.0.1:8545'; // Replace with your Ethereum node or Infura URL

async function getAllTransactions(mainContract) {
    const apiKey = 'I81RM42RCBH3HIC9YEK1GX6KYQ12U73K1C';
    const endpoint = `https://api.etherscan.io/api?module=account&action=txlist&address=${contractAddress}&startblock=0&endblock=99999999&sort=asc&apikey=${apiKey}`;

    const data = await axios.get(endpoint);
    contractTransactions = data.data.result;
    const contracts = await getContractCodeEtherscan();
    const contractTree = await getCompiledData(contracts);
    await getStorageData(contractTransactions, contracts, mainContract, contractTree);

}

getAllTransactions("CakeOFT");

async function getStorageData(contractTransactions, contracts, mainContract, contractTree){
    let partialInt = 0;
    for(const tx of contractTransactions){
        if(partialInt < 50){
            const pastEvents = await getEvents(tx.hash, Number(tx.blockNumber));
            //const internalTxs = await getInternalTransactions(tx.hash);
            //todo take progressive id
            let newLog = {
                activity: '',
                timestamp: '',
                inputNames: [],
                inputTypes: [],
                inputValues: [],
               // storageVarTypes: [],
               // storageVarNames: [],
                storageState: [],
                internalTxs: [],
                events: pastEvents
            };
            console.log(tx.hash);
            const decoder = new InputDataDecoder(contractAbi);

            const result = decoder.decodeData(tx.input);
            newLog.activity = result.method;
            newLog.timestamp = tx.timeStamp;
            for (let i = 0; i < result.inputs.length; i++) {

                newLog.inputTypes[i] = result.types[i];
                newLog.inputNames[i] = result.names[i];

                if(result.types[i] === 'uint256'){
                    newLog.inputValues[i] = Number(web3.utils.hexToNumber(result.inputs[i]._hex));
                }else if(result.types[i] === 'string'){
                    newLog.inputValues[i] = web3.utils.hexToAscii(result.inputs[i]);
                }else if(result.types[i].includes("byte")){
                    newLog.inputValues[i] = JSON.stringify(web3.utils.hexToBytes(result.inputs[i])).replace("\"", "");
                }else if(result.types[i].includes("address")){
                    newLog.inputValues[i] = result.inputs[i];
                }else{
                    newLog.inputValues[i] = result.inputs[i];
                }
            }
            const storageVal = await getTraceStorage(tx.blockNumber, tx.functionName.split("(")[0], tx.hash,
                mainContract, contracts, contractTree);
            //console.log(storageVal);
            newLog.storageState = storageVal.decodedValues;
            newLog.internalTxs = storageVal.internalCalls;
            //console.log("FINITOOO!!!")
            blockchainLog.push(newLog)
            partialInt++;
        }else{
            break;
        }
    }
    try {
        // Serialize the object-centric event log data to JSON
        const finalParsedLog = JSON.stringify(blockchainLog, null, 2);
        // Write the  JSON to the output file
        fs.writeFileSync('pancakeSwap.json', finalParsedLog);
        console.log(`JSON file created`);
    } catch (error) {
        console.error(`Error writing output file: ${error}`);
    }
}

async function getTraceStorage(blockNumber, functionName, txHash, mainContract, contracts, contractTree) {

   /* const provider = ganache.provider({
        network_id: 1,
        fork: 'https://mainnet.infura.io/v3/f3851e4d467341f1b5927b6546d9f30c\@' + blockNumber
    });
    const response = await provider.request({
        method: "debug_traceTransaction",
        params: [txHash]
    });*/
    await helpers.reset("https://mainnet.infura.io/v3/f3851e4d467341f1b5927b6546d9f30c", Number(blockNumber));
  //  hre.network.config.forking.blockNumber = Number(blockNumber);
   // console.log(hre.config);
    //check for historical fork
    const t = new Date();
    const response = await hre.network.provider.send("debug_traceTransaction", [
        txHash
    ]);

    const t1 = new Date();
    console.log(t1 - t);
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
   // fs.writeFileSync("out.json", JSON.stringify(response.structLogs));



    for (const trace of response.structLogs) {
        //if SHA3 is found then read all keys before being hashed
        if (trace.op === "SHA3") {
            //console.log(trace);
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
        } else if (trace.op === "STOP" || trace.op === "RETURN") {
            //retrieve the entire storage after function execution
            //for each storage key discard the ones of static variables and compare the remaining ones with the re-generated
            for(const slot in trace.storage){
                functionStorage[slot] = trace.storage[slot];
            }
        } else if (trace.pc === (bufferPC + 1)) {
           // console.log("---------Ecco quello dopo --------------")
           // console.log(trace.stack[trace.stack.length - 1]);
            bufferPC = 0;
            trackBuffer[index].finalKey = trace.stack[trace.stack.length - 1];
            index++;
        }
        else if (trace.op === "SSTORE") {
            sstoreBuffer.push(trace.stack[trace.stack.length - 1]);
            //console.log(trace);
        }else if(trace.op === "CALL"){
            //read the offset from the stack
            const offsetBytes = trace.stack[trace.stack.length - 4];
            //convert the offset to number
            let offsetNumber = web3.utils.hexToNumber("0x" + offsetBytes) / 32;
            //read the length of the memory to read
            const lengthBytes = trace.stack[trace.stack.length - 5];
            //convert the length to number
            let lengthNumber = web3.utils.hexToNumber("0x" + lengthBytes) / 32;
            //create the call object
            let call = {type: trace.op, to: trace.stack[trace.stack.length - 2], inputs: []}
            //read all the inputs from the memory and insert it in the call object
            for(let i = offsetNumber; i <= offsetNumber + lengthNumber; i++){
                call.inputs.push(trace.memory[i]);
            }
            internalCalls.push(call);
        }else if(trace.op === "DELEGATECALL" || trace.op === "STATICCALL"){
           // internalCalls.push(trace.stack[trace.stack.length - 2]);
            const offsetBytes = trace.stack[trace.stack.length - 3];
            let offsetNumber = web3.utils.hexToNumber("0x" + offsetBytes) / 32;
            const lengthBytes = trace.stack[trace.stack.length - 4];
            let lengthNumber = web3.utils.hexToNumber("0x" + lengthBytes) / 32;
            let call = {type: trace.op, to: trace.stack[trace.stack.length - 2], inputs: []}
            for(let i = offsetNumber; i <= offsetNumber + lengthNumber; i++){
                call.inputs.push(trace.memory[i]);
            }
            internalCalls.push(call);
        } else if(trace.op === "RETURN"){
           //console.log(trace);
        }
    }

    let finalShaTraces = [];
    //console.log(trackBuffer);
    for (let i = 0; i < trackBuffer.length; i++){
    //check if the SAH3 key is contained in an SSTORE
    if(sstoreBuffer.includes(trackBuffer[i].finalKey)){
        //create a final trace for that key
        const trace = {
            finalKey: trackBuffer[i].finalKey
        }
        let flag = false;
        let test = i;
        //Iterate previous SHA3 looking for a simple integer slot index
            while(flag === false){
                //if the storage key is not a standard number then check for the previous one
                if (!(await web3.utils.hexToNumber("0x" + trackBuffer[test].hexStorageIndex) < 30)) {
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
   // console.log(sstoreBuffer);
    const uniqueSStore = Array.from(new Set(sstoreBuffer.map(JSON.stringify))).map(JSON.parse);
    //console.log(uniqueSStore);
    //console.log(functionStorage);
    const decodedValues = await decodeValues(uniqueSStore, contractTree, finalShaTraces, functionStorage, functionName, contracts, mainContract);
    return {decodedValues, internalCalls};

}

//cleanTest(18424870, "sendFrom", "0x446f97e43687382fefbc6a9c4cccd055829ef2909997fb102a1728db6b37b76a", "CakeOFT");

//function for re-generating the key and understand the variable thanks to the tests on the storage locationapprove(address spender,uint256 amount)0x095ea7b3

async function decodeValues(sstore, contractTree, trackBuffer, functionStorage, functionName, contracts, mainContract){
    //console.log(functionStorage);
    //iterate the tree of contracts
    let decodedValues = [];
   // console.log(contractTree);
    for(const contractId in contractTree){
        //if the contract is the main one then check the storage

        if(contractTree[contractId].name === mainContract && contractTree[contractId].functions.includes(functionName)){
            //iterate the trace
           // console.log(trackBuffer);
            for (const trace of trackBuffer) {
                //convert storage index to integer
                const slotIndex = await web3.utils.hexToNumber("0x" + trace.hexStorageIndex);

                //iterate the possible variables of the matching contract
               // console.log(contractTree[contractId].storage);
                //todo fix the double index case
                for(const contractVariable of contractTree[contractId].storage){
                    let bufferVariable = {};
                    //if the variable has the same slot then it is
                    if(Number(contractVariable.slot) === Number(slotIndex)){
                        const varVal = await decodeStorageValue(contractVariable, functionStorage[trace.finalKey]);
                        //todo capire se ha cancellato, creato o aggiornato
                        bufferVariable = {name: contractVariable.name, type: contractVariable.type, value: varVal};
                        decodedValues.push(bufferVariable);
                    }else{
                        for(const sstoreIndex of sstore){
                            const integerSlot = await web3.utils.hexToNumber("0x"+sstoreIndex);
                            if(integerSlot === Number(contractVariable.slot)){
                                const varVal = await decodeStorageValue(contractVariable, functionStorage[sstoreIndex]);
                                bufferVariable = {name: contractVariable.name, type: contractVariable.type, value: varVal};
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

//function for decoding the storage value
//todo check arrays and structs, use abiDecoder
async function decodeStorageValue(variable, value) {
    //console.log("variable to handle: --------->" + value);
    //if it is a mapping check for last type of value by splitting it so to cover also nested case
    if (variable.type.includes("mapping")) {
        const typeBuffer = variable.type.split(",");
        if (typeBuffer[typeBuffer.length -1].includes("uint")) {
            return Number(web3.utils.hexToNumber("0x" + value));
        } else if (typeBuffer[typeBuffer.length -1].includes("string")) {
            return web3.utils.hexToAscii("0x" + value);
        } else if (typeBuffer[typeBuffer.length -1].includes("t_bool")) {
            if(value === "0000000000000000000000000000000000000000000000000000000000000000"){
                return false;
            }else {
                return true;
            }
        } else if (typeBuffer[typeBuffer.length -1].includes("bytes")) {
           return JSON.stringify(web3.utils.hexToBytes("0x" + value)).replace("\"", "");
        }else if(typeBuffer[typeBuffer.length -1].includes("address")){
            return value;
        }
    } else if (variable.type.includes("array")) {
        return value;

    } else{
        if (variable.type.includes("uint")) {
            return Number(web3.utils.hexToNumber("0x" + value));
        } else if (variable.type.includes("string")) {
            return web3.utils.hexToString("0x" + value);
        } else if (variable.type.includes("bool")) {
            if(value === "0000000000000000000000000000000000000000000000000000000000000000"){
                return false;
            }else {
                return true;
            }
        } else if (variable.type.includes("bytes")) {
            return JSON.stringify(web3.utils.hexToBytes("0x" + value)).replace("\"", "");
        }else if(variable.type.includes("address")){
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

    for(const astVar in variableAstTree){
        for(const _var of variableAstTree[astVar]){
            if(_var.baseContract === mainContract && Number(_var.slot) === Number(storageSlot)){
                return _var;
            }
        }
    }

    /* for(const functionName of functionNames) {
         for (const variable of functionVariables[functionName].variables) {
             if (Number(variable.storageSlot) === Number(storageSlot)) {
                 //console.log("yes");
                 return variable;
             }
         }
     }*/
}



async function getCompiledData(contracts) {
    let input = {
        language: 'Solidity',
        sources: {},
        settings: {
            outputSelection: {
                "*": {
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


    // input.sources['contract.sol'] = {}
    // input.sources['contract.sol'].content = fs.readFileSync("contract.sol", 'utf8');
    const output = solc.compile(JSON.stringify(input));

    fs.writeFileSync('testContract.json', output);

    const source = JSON.parse(output).sources;
    //get all storage variable for contract, including inherited ones
    const storageData = await getContractVariableTree(JSON.parse(output));
    //take only astIds todo useless?
    const variablesAstIds = storageData.variablesAstIds;
    //take the effective tree
    const contractStorageTree = storageData.contractStorageTree;
    //get tree of functions for contract, NOT including inherited
    const contractTree = await getFunctionContractTree(source, variablesAstIds, contractStorageTree);
    //construct full function tree including also the inherited ones
    const contractFunctionTree = await constructFullFunctionContractTree(contractTree);
    //construct full contract tree including also variables
    const fullContractTree = await injectVariablesToTree(contractFunctionTree, contractStorageTree);
    //console.log(fullContractTree["4514"]);
    return fullContractTree;
}


async function injectVariablesToTree(contractFunctionTree, contractStorageTree){
    //iterate the partial contract tree where only functions are stored
    for(const contractId in contractFunctionTree){
        //iterate again the contracts
        for(const contractName in contractStorageTree){
            //find the same contract in the tree with variables

            if(contractFunctionTree[contractId].name === contractStorageTree[contractName].name){
                contractFunctionTree[contractId].storage = contractStorageTree[contractName].storage;
            }
        }
    }
    return contractFunctionTree;

}
async function constructFullFunctionContractTree(partialContractTree){
    //iterate all contracts from the partial tree (key is AST id)
    for(const contractId in partialContractTree){
        //get the ID of all inherited contract and iter them
            for (const inheritedId of partialContractTree[contractId].inherited) {
                //console.log("avente inherited: " + inheritedId + " che corrisponde a: " + partialContractTree[inheritedId].name);
                if(partialContractTree[inheritedId].name !== partialContractTree[contractId].name &&
                    partialContractTree[contractId].functions.length > 0){
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

async function getFunctionContractTree(source){

    let contractToIterate = [];
    let contractTree = {};
    for(const contract in source){
        for (const directive of source[contract].ast.nodes) {
            //reads the nodes of the ast searching for the contract and not for the imports
            if (directive.nodeType === "ContractDefinition") {
                contractToIterate.push(directive);
            }
        }
    }

    for(const contract of contractToIterate) {
        if(contract.nodeType === "ContractDefinition") {
            //console.log(contract);
            contractTree[contract.id] = {};
            contractTree[contract.id].name = contract.canonicalName;
            contractTree[contract.id].inherited = contract.linearizedBaseContracts;
            contractTree[contract.id].functions = [];
            //console.log(contractTree[contract.id]);
        }
        for (const node of contract.nodes) {
            //if node is the contract definition one initialize its structure
                //if node is a function definition save it
            if (node.nodeType.match("FunctionDefinition") && node.body != undefined && node.implemented == true) {

                //create a buffer representing the function object to push to the function tree
                contractTree[contract.id].functions.push(node.name);

            }
        }
    }


    return contractTree;
}


async function getContractCodeEtherscan() {
    const apiKey = 'I81RM42RCBH3HIC9YEK1GX6KYQ12U73K1C';
    const endpoint = `https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${apiKey}`;
    let contracts = [];
    let buffer;
    const response = await axios.get(endpoint);
    const data = response.data;
    let i = 0;
    let jsonCode = data.result[0].SourceCode;

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


    return contracts;

}


async function getContractVariableTree(compiled) {
    const variablesAstIds = [];
    let contractStorageTree = [];
    //iterate all contracts
    for(const contract in compiled.contracts){
        //utility for getting the key corresponding to the specific contract and access it
        const firstKey = Object.keys(compiled.contracts[contract])[0];
        //check that the contract has some state variables
        if(compiled.contracts[contract][firstKey].storageLayout != undefined) {
            if(compiled.contracts[contract][firstKey].storageLayout.storage != undefined) {
                //get the storage of the contract
                const storageLay = compiled.contracts[contract][firstKey].storageLayout.storage;
                //read all variables from contract storage
                for (const storageVar of storageLay) {
                    //save variable AST id
                    variablesAstIds.push(storageVar.astId);
                    //initialize first access to the contract
                    if(contractStorageTree[firstKey] === undefined){
                        contractStorageTree[firstKey] = {};
                        contractStorageTree[firstKey].storage = [];
                        contractStorageTree[firstKey].name = firstKey;
                    }
                    contractStorageTree[firstKey].storage.push({name : storageVar.label, type : storageVar.type,
                        slot : storageVar.slot});
                }
            }
        }
    }

    return {variablesAstIds, contractStorageTree};
}
async function getInternalTransactions(txHash){
    const apiKey = 'I81RM42RCBH3HIC9YEK1GX6KYQ12U73K1C';
    const endpoint = `https://api.etherscan.io/api?module=account&action=txlistinternal&txhash=${txHash}&apikey=${apiKey}`;
    axios
        .get(endpoint)
        .then((response) => {
            const data = response.data;
            if (data.status === '1') {
                console.log(data);
            } else {
                console.error('Error: Unable to retrieve transactions.');
            }
        })
        .catch((error) => {
            console.error(`An error occurred: ${error}`);
        });

    const MORALIS_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6ImJjOGVkMDZjLTc5YmEtNDIxYS1iMzE1LTQ0NTIxYWVjNDE0OSIsIm9yZ0lkIjoiMzU5NDk5IiwidXNlcklkIjoiMzY5NDY1IiwidHlwZUlkIjoiN2Q4YTNkOWEtOTNhMi00MjdlLTg5ZTEtMzM5ZTkwNjdlMWVhIiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE2OTYyMzQwNjcsImV4cCI6NDg1MTk5NDA2N30.O28eO9rDl_wGDt0LJ9i7LaeVwp3auYrHrwo8dDmN2Yw";
    const chain = EvmChain.ETHEREUM;
    await Moralis.start({
        apiKey: MORALIS_API_KEY,
    });
    const response = await Moralis.EvmApi.transaction.getInternalTransactions({
        "chain": "0x1",
        "transactionHash": txHash
    });
    for(const internTx of response.raw){
        console.log(internTx.input);
        console.log(" ------------------------------------------------------------------------------------- ")

    }
}

async function getEvents(txHash, block){
    const myContract = new web3.eth.Contract(JSON.parse(contractAbi), contractAddress);
   // const receipt = await web3.eth.getTransactionReceipt(txHash);
   // console.log(receipt.logs);
    //const decodedLogs = await abiDecoder.decodeLogs(receipt.logs);
    let filteredEvents = [];
    const pastEvents = await myContract.getPastEvents("allEvents", {fromBlock: block, toBlock: block});
    for(let i = 0; i < pastEvents.length; i++){
        for(const value in pastEvents[i].returnValues) {
            if(typeof pastEvents[i].returnValues[value] === "bigint"){
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
