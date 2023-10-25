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
const sourceCode = fs.readFileSync('contractEtherscan.sol', 'utf8');
let contractAbi = fs.readFileSync('abiEtherscan.json', 'utf8');
let localweb3 = new Web3('HTTP://127.0.0.1:8545')
let web3 = new Web3('https://eth-mainnet.g.alchemy.com/v2/ISHV03DLlGo2K1-dqE6EnsyrP2GF44Gt')
let transactions = [];
let generalStorageLayout;
let contractTransactions = [];
let blockchainLog = [{}];
const contractAddress = '0x152649eA73beAb28c5b49B26eb48f7EAD6d4c898';


const nodeUrl = 'HTTP://127.0.0.1:8545'; // Replace with your Ethereum node or Infura URL

//todo 1) o rimuovere la funzione singola oppure 2) iterare per le chiamate interne perchè
async function cleanTest(blockNumber, functionName, txHash, mainContract) {
    //console.log(await web3.eth.getTransaction(txHash));;
    const provider = ganache.provider({
        network_id: 1,
        fork: 'https://mainnet.infura.io/v3/f3851e4d467341f1b5927b6546d9f30c\@' + blockNumber
    });
    const contracts = await getContractCodeEtherscan();
    const response = await provider.request({
        method: "debug_traceTransaction",
        params: [txHash,

        ]
    });

    //used to store the storage changed by the function. Used to compare the generated keys
    let functionStorage = {};
    //used to store all the keys potentially related to a dynamic structure
    /* let functionKeys = [];
     let functionStorageIndexes = [];*/
    let index = 0;
    let trackBuffer = [];
    let bufferPC = -10;
    fs.writeFileSync("out.json", JSON.stringify(response.structLogs));
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
           // console.log("---------Ecco uno SHA3 --------------")
           // console.log("storageIndex: " + hexStorageIndex);
           // console.log("key: " + hexKey);

            //functionKeys.push(hexKey);
            //functionStorageIndexes.push(hexStorageIndex);
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
            //console.log(trace);
        }
    }
    let finalTraces = [];
    //console.log(trackBuffer);
    //console.log(functionStorage);

    for(let i = 0; i < trackBuffer.length; i++){
        //console.log("final key: " + trackBuffer[i].finalKey);
            //if sha3 is not present in the mapping means that it will be used in the next one for nested value
        let flag = false;
        let test = i;
        while(flag === false){

             //   trackBuffer[i].finalKey = trackBuffer[test].finalKey;
                if (!functionStorage.hasOwnProperty(trackBuffer[test].finalKey)) {
                    test++;
                    //takes the next key as the valid one, assumed to be of a nested mapping
                   // console.log("chiave trovata " + trackBuffer[i].finalKey);
                    //finalTraces.push(trackBuffer[i]);
                } else {
                    flag = true;
                    trackBuffer[i].finalKey = trackBuffer[test].finalKey;
                    finalTraces.push(trackBuffer[i]);
                }
        }

    }
    const uniqueTraces = Array.from(new Set(finalTraces.map(JSON.stringify))).map(JSON.parse);
    await decodeValues(uniqueTraces, functionStorage, functionName, contracts, mainContract);


}

cleanTest(18424870, "sendFrom", "0x446f97e43687382fefbc6a9c4cccd055829ef2909997fb102a1728db6b37b76a", "CakeOFT");

//function for re-generating the key and understand the variable thanks to the tests on the storage locationapprove(address spender,uint256 amount)0x095ea7b3

async function decodeValues(trackBuffer, functionStorage, functionName, contracts, mainContract){
    const contractTree = await getCompiledData(contracts, functionName);
    //iterate the tree of contracts
    for(const contractId in contractTree){
        //if the contract is the main one then check the storage
        if(contractTree[contractId].name === mainContract && contractTree[contractId].functions.includes(functionName)){
            //iterate the trace
            //console.log("Contratto: " + mainContract + ", attività: " + functionName);
            for (const trace of trackBuffer) {
                //convert storage index to integer
                const slotIndex = await web3.utils.hexToNumber("0x" + trace.hexStorageIndex);

                //iterate the possible variables of the matching contract
                for(const contractVariable of contractTree[contractId].storage){
                    //if the variable has the same slot then it is
                    if(Number(contractVariable.slot) === Number(slotIndex)){
                       // console.log("variabile " + contractVariable.name + " di tipo: " + contractVariable.type + " allo slot: " + contractVariable.slot);
                       // console.log("dallo storage: " + slotIndex + " e la chiave FORSE è: " + trace.finalKey);
                        const varVal = await decodeStorageValue(contractVariable, functionStorage[trace.finalKey]);
                        console.log(slotIndex, functionStorage[trace.finalKey]);
                        //todo capire se ha cancellato, creato o aggiornato
                        console.log("Ha modificato la variable: " + contractVariable.name + ", di tipo: " + contractVariable.type);
                        console.log("Che ora ha valore: " + varVal);
                    }
                }
            }
        }
    }
    // console.log(contractTree);

}
/*async function generateMappingKey(trackBuffer, functionStorage, functionName, contracts, mainContract) {
    //get variables changed respective functions in teh contracts
    const data = await getCompiledData(contracts, functionName)
    const functionVariables = data.functionVariables;
    const variableAstTree =  data.variablesAstNames;
    const storageKeys = await convertStorageKeys(functionStorage);
    let storageSlots = [];
    let functionNames = [];
    //if function has subCall then take its variables
    if(functionVariables[functionName].hasOwnProperty("functionCall")) {
        //todo match astId for additional verification
        functionNames.push(functionVariables[functionName].functionCall.name);
        //storage slots filtered by all the variables modified in the function
        for (const variable of functionVariables[functionVariables[functionName].functionCall.name].variables) {
            storageSlots.push(variable.storageSlot);
        }
        //if function has also its own variables add them
    }if(functionVariables[functionName].hasOwnProperty("variables")){
        functionNames.push(functionVariables[functionName].name);
        for (const variable of functionVariables[functionVariables[functionName].name].variables) {
            storageSlots.push(variable.storageSlot);
        }
    }

    for (const trace of trackBuffer) {
        const numberIndex = await web3.utils.hexToNumber("0x" + trace.hexStorageIndex);
        const variable = await getVarFromFunction(functionVariables, functionNames, numberIndex, variableAstTree, mainContract);
        const varVal = await decodeStorageValue(functionStorage[trace.finalKey], variable.type);
        console.log("Call: " + functionName + ", of Contract: " + functionVariables[functionName].baseContract + " ----internal function call---> " +
            functionVariables[functionName].functionCall.name + ", of Contract: " + functionVariables[functionVariables[functionName].functionCall.name].baseContract)
        console.log("Updated variable: " + variable.name + ", with type: " + variable.type + ", and value: " + varVal + ", of Contrat: " + variable.baseContract);
        //console.log(functionVariables);
    }
}*/

//function for decoding the storage value
//todo check arrays, structs and nested mappings
async function decodeStorageValue(variable, value) {
    //console.log("variable to handle: --------->" + value);
    //if it is a mapping check for last type of value by splitting it so to cover also nested case
    if (variable.type.includes("mapping")) {
        const typeBuffer = variable.type.split(",");
        if (typeBuffer[typeBuffer.length -1].includes("uint")) {
            return web3.utils.hexToNumber("0x" + value);
        } else if (typeBuffer[typeBuffer.length -1].includes("string") || variable.type.split(",")[0].includes("address")) {
            return web3.utils.hexToAscii("0x" + value);
        } else if (typeBuffer[typeBuffer.length -1].includes("bool")) {
            if(value === "0000000000000000000000000000000000000000000000000000000000000000"){
                return false;
            }else {
                return true;
            }
        } else if (typeBuffer[typeBuffer.length -1].includes("bytes")) {
           return web3.utils.hexToBytes("0x" + value);
        }
    } else if (variable.type.includes("array")) {

    } else{
        if (variable.type.includes("uint")) {
            return web3.utils.hexToNumber("0x" + value);
        } else if (variable.type.includes("string") || variable.type.includes("address")) {
            return web3.utils.hexToAscii("0x" + value);
        } else if (variable.type.includes("bool")) {
            if(value === "0000000000000000000000000000000000000000000000000000000000000000"){
                return false;
            }else {
                return true;
            }
        } else if (variable.type.includes("bytes")) {
            return web3.utils.hexToBytes("0x" + value);
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
                    "*": ["storageLayout", "ast"],
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
    for(const contractId in contractFunctionTree){
        for(const contractName in contractStorageTree){
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
        // console.log("---------------------------------------");
        //  console.log("sto su contratto: " + partialContractTree[contractId].name);
        //get the ID of all inherited contract and iter them
            for (const inheritedId of partialContractTree[contractId].inherited) {
                //console.log("avente inherited: " + inheritedId + " che corrisponde a: " + partialContractTree[inheritedId].name);
                if(partialContractTree[inheritedId].name !== partialContractTree[contractId].name &&
                    partialContractTree[contractId].functions.length > 0){
                    //console.log("ora inserisce" + partialContractTree[inheritedId].functions);
                    partialContractTree[contractId].functions.push(...partialContractTree[inheritedId].functions);
                }
                //push inside the main contract the inherited functions

                //console.log("contractId: " + contractId + JSON.stringify(partialContractTree[contractId].functions));
                //partialContractTree[contractId].functions.push(partialContractTree[inheritedId].functions);
            }
        const uniqueArray = Array.from(new Set(partialContractTree[contractId].functions));
        partialContractTree[contractId].functions = uniqueArray;
        //console.log("so the final contract is: " + partialContractTree[contractId].functions);
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
