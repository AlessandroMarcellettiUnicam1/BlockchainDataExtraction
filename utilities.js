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
    /*const response = await axios.post("http://127.0.0.1:8545", {
        "jsonrpc": '2.0',
        "method": 'debug_traceTransaction',
        "params": ['0x77f9327c329f72ca665660650a1d9705aa693257815a689898a5d4468da94ed8', {}], // Replace {} with any optional parameters
        "id": 1
    });*/


    //used to store the storage changed by the function. Used to compare the generated keys
    let functionStorage;
    //used to store all the keys potentially related to a dynamic structure
    /* let functionKeys = [];
     let functionStorageIndexes = [];*/
    let index = 0;
    let trackBuffer = [];
    let bufferPC = -10;
    for (const trace of response.structLogs) {
        //if SHA3 is found then read all keys before being hashed
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
            //functionKeys.push(hexKey);
            //functionStorageIndexes.push(hexStorageIndex);
        } else if (trace.op === "STOP" || trace.op === "RETURN") {
            //retrieve the entire storage after function execution
            //for each storage key discard the ones of static variables and compare the remaining ones with the re-generated
            functionStorage = trace.storage;
        } else if (trace.pc === (bufferPC + 1)) {
            trackBuffer[index].finalKey = trace.stack[trace.stack.length - 1];
            index++;
        }
    }
    let finalTraces = [];
    for(let i = 0; i < trackBuffer.length; i++){
        //if sha3 is not present in the mapping means that it will be used in the next one for nested value
        if(!functionStorage.hasOwnProperty(trackBuffer[i].finalKey)){
            trackBuffer[i].finalKey = trackBuffer[i+1].finalKey;
            finalTraces.push(trackBuffer[i]);
        }else{
            finalTraces.push(trackBuffer[i]);
        }
    }

    await generateMappingKey(finalTraces, functionStorage, functionName, contracts, mainContract);


}

cleanTest(18421569, "transfer", "0x48fa149344df4a4bb2cd7e5f9bfed3271e010fed6d337ee05aa46368708cbbbd", "CakeOFT");

//function for re-generating the key and understand the variable thanks to the tests on the storage locationapprove(address spender,uint256 amount)0x095ea7b3
async function generateMappingKey(trackBuffer, functionStorage, functionName, contracts, mainContract) {
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


}

//function for decoding the storage value
//todo check arrays, structs and nested mappings
async function decodeStorageValue(value, type) {
    //if it is a mapping check for last type of value by splitting it so to cover also nested case
    if (type.includes("mapping")) {
        const typeBuffer = type.split(",");
        if (typeBuffer[typeBuffer.length -1].includes("uint")) {
            return web3.utils.hexToNumber("0x" + value);
        } else if (typeBuffer[typeBuffer.length -1].includes("string") || type.split(",")[0].includes("address")) {
            return web3.utils.hexToAscii("0x" + value);
        } else if (typeBuffer[typeBuffer.length -1].includes("bool")) {
            console.log("bool to handle: " + value)
        }
    } else if (type.includes("array")) {

    }
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
    //console.log(functionVariables);
    //console.log(functionVariables["_approve"]);
    //console.log(functionVariables["approve"]);
    //console.log(functionNames);
    //console.log(functionVariables["_approve"]);
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
    //take all the variables from the storage layout
    //todo add only unique id
    const storageData = await getVariablesFromStorage(JSON.parse(output));
    const variablesAstIds = storageData.variablesAstIds;
    //multiple variables can be referred to the sane ID, added also contract difference
    const variablesAstNames = storageData.storageVariables;
    //console.log(variablesAstNames);


    let functionVariables = {};
    let contractToIterate = [];
    for(const contract in source){

    for (const directive of source[contract].ast.nodes) {
        //reads the nodes of the ast searching for the contract and not for the imports
            if (directive.nodeType === "ContractDefinition") {
                contractToIterate.push(directive);
            }
        }
    }
    for(const contract of contractToIterate) {
        for (const node of contract.nodes) {
            if (node.nodeType.match("FunctionDefinition") && node.body != undefined && node.implemented == true) {
                //iterate the expression nodes in the body of the function
                functionVariables[node.name] = {};
                for (const bodyNode of node.body.statements) {
                 //   console.log(bodyNode);
                    if (bodyNode.hasOwnProperty("expression") && bodyNode.expression.leftHandSide != undefined) {
                        //if the node in the body is an expression involving a variable then take its AST ID
                        if(bodyNode.expression.leftHandSide.baseExpression != undefined) {
                                let astId;
                                //if the variable is a nested one it has two baseExpression
                                if (bodyNode.expression.leftHandSide.baseExpression.baseExpression != undefined) {
                                    astId = bodyNode.expression.leftHandSide.baseExpression.baseExpression.referencedDeclaration;
                                }
                                //otherwise take its simple assignment
                                if (bodyNode.expression.leftHandSide.baseExpression.referencedDeclaration != undefined) {
                                    astId = bodyNode.expression.leftHandSide.baseExpression.referencedDeclaration;
                                }
                                //check if the variable astId is present
                                if (bodyNode.nodeType === "ExpressionStatement" && variablesAstIds.includes(astId)) {
                                    //console.log("variable found!: " + variablesAstNames[bodyNode.expression.leftHandSide.baseExpression.referencedDeclaration].name);
                                    //create an object with
                                    // functionVariables[node.name] = []
                                    //iterate the various possible variables
                                    for(const variable of variablesAstNames[astId]){
                                        //match the same current contract
                                        if(variable.baseContract === contract.canonicalName) {
                                            functionVariables[node.name].baseContract = contract.canonicalName;
                                            functionVariables[node.name].variables = [];
                                            functionVariables[node.name].variables.push({
                                                astId: astId,
                                                name: variable.name,
                                                type: variable.type,
                                                storageSlot: variable.slot,
                                                baseContract: variable.baseContract
                                            });
                                        }
                                    }
                                }
                        }
                    }else if(bodyNode.hasOwnProperty("expression") && bodyNode.expression.nodeType === "FunctionCall" &&
                        bodyNode.expression.expression.name !== "require" && bodyNode.expression.expression.name !== undefined){
                        functionVariables[node.name].functionCall = {name: bodyNode.expression.expression.name,
                        astId: bodyNode.expression.expression.referencedDeclaration};
                        functionVariables[node.name].baseContract = contract.canonicalName;
                        //todo per leggere le variabili delle sub call devo effettivamente leggermi il nodo main
                        //ciò significa che se lo vedo com function call me lo metto da parte e quando lo becco sopra mi metto
                        //le variabili dentro
                    }

                }
            }
        }
    }
    //console.log(functionVariables);
  //  console.log(functionVariables);
   // console.log(functionVariables);
    //console.log(functionVariables);
    return {functionVariables, variablesAstNames};
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


async function getVariablesFromStorage(compiled) {
    const variablesAstIds = [];
    let storageVariables = {};
    for(const contract in compiled.contracts){
        const firstKey = Object.keys(compiled.contracts[contract])[0];
        if(compiled.contracts[contract][firstKey].storageLayout != undefined) {
            if(compiled.contracts[contract][firstKey].storageLayout.storage != undefined) {
               // console.log("daje" + compiled.contracts[contract]);
                const storageLay = compiled.contracts[contract][firstKey].storageLayout.storage;
                for (const storageVar of storageLay) {
                    variablesAstIds.push(storageVar.astId);
                    if(storageVariables[storageVar.astId] === undefined){
                        storageVariables[storageVar.astId] = [];
                        //console.log("undefined");
                    }
                    //console.log("defined");
                    storageVariables[storageVar.astId].push({name : storageVar.label, type : storageVar.type,
                        slot : storageVar.slot, baseContract : firstKey});
                   /* storageVariables[storageVar.astId].
                    storageVariables[storageVar.astId].;
                    storageVariables[storageVar.astId].;
                    storageVariables[storageVar.astId].address = "todo";*/
                }
            }
        }
    }
  //  console.log(storageVariables);
   // console.log(variablesAstIds);
    //console.log(storageVariables);


    /*const firstKey = Object.keys(compiled.contracts['contracts/eth/OFT.sol'])[0];
    const storageLay = compiled.contracts['contracts/eth/OFT.sol'][firstKey].storageLayout.storage;
    for (const storageVar of storageLay) {
        variablesAstIds.push(storageVar.astId);
        storageVariables[storageVar.astId] = {};
        storageVariables[storageVar.astId].name = storageVar.label;
        storageVariables[storageVar.astId].type = storageVar.type;
        storageVariables[storageVar.astId].slot = storageVar.slot;
    }*/
    //console.log(storageVariables);
    return {variablesAstIds, storageVariables};
}

async function getTraceFromGanache(blockNumber, txHash) {

    const response = await axios.post("http://127.0.0.1:8545", {
        "jsonrpc": '2.0',
        "method": 'debug_traceTransaction',
        "params": ['0xcbfe9e05dace16228ba30cbb6f7ef9e3b15670288fa0f5b02b7ad908654d4c7a', {}], // Replace {} with any optional parameters
        "id": 1

    });
    const index = web3.utils.padLeft(web3.utils.numberToHex(2), 64);
    console.log(index);
    const key = web3.utils.padLeft(web3.utils.numberToHex(2), 64);
    let newKey = localweb3.utils.soliditySha3('00000000000000000000000016ddb4df2e84fbe3ceb47331e74b1e42e1de4bf7' + '0000000000000000000000000000000000000000000000000000000000000002');
    console.log(newKey);
    console.log(await localweb3.eth.getStorageAt('0xe2EeCB636b161f3CbAbd2058CeA9eCB4b4e0a3B2', newKey));

    if (newKey === '0x0c6cea2ff3d2084ff38980a465cd3b3d626dc03095879afa94f1f950e223a449') {
        console.log("SIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII")
    }
    //console.log(response.data.result.structLogs);
    for (const trace of response.data.result.structLogs) {

        //console.log(trace);
        //console.log('................00000000000000000000000016ddb4df2e84fbe3ceb47331e74b1e42e1de4bf7
        // 0c6cea2ff3d2084ff38980a465cd3b3d626dc03095879afa94f1f950e223a449...............................................');
    }

    const accounts = await provider.request({
        method: "debug_traceTransaction",
        params: [txHash,
            //{
            //"tracer": "callTracer"}
        ]
    });

    console.log(accounts);


}



async function shaRedo() {
    //test statici vari
    //let aaa =  localweb3.utils.sha3("0000000000000000000000000000000000000000000000000000000000000066" + "0000000000000000000000000000000000000000000000000000000000000012");
    //console.log(aaa);
    // console.log(await web3.eth.getStorageAt(contractAddress, aaa, 16924868));
    // console.log(localweb3.utils.soliditySha3("0000000000000000000000000000000000000000000000000000000000000066" + "0000000000000000000000000000000000000000000000000000000000000012"));

    //from memory : key + storageIndex = hashedKey --> getStorage della variable con storage index x
    //PRENDO ISTRUZIONE DOPO LO SHA PER VEDERE LA CHIAVE CHE STA NEL 1 POSIZIONE DELLO STACK

    //iterate all keys in the memory of an SHA3 command
    for (const memoryKey of memoryKeys) {
        //test the SHA with all possible storage slots of variables within specific the function
        for (const storageSlot of storageSlots) {
            // const prova = web3.utils.padLeft(web3.utils.numberToHex("102"), 64)
            const storageIndex = web3.utils.padLeft(web3.utils.numberToHex(storageSlot), 64).replace('0x', '');
            let newKey = localweb3.utils.sha3Raw(memoryKey + storageIndex);
            console.log("key is: " + web3.utils.asciiToHexmemoryKey + " storage index is: " + storageIndex);
            console.log("hashed key is: " + newKey)
            console.log("wanted key is: " + storageKeys)
            if (storageKeys.includes(newKey)) {
                const variable = await getVarFromFunction(functionVariables, functionName, storageSlot);
                console.log("IT MATCHES address or int: " + JSON.stringify(variable));
            } else {
                const trimmedHexString = memoryKey.split('0')[0];
                newKey = localweb3.utils.soliditySha3(trimmedHexString + storageIndex);
                if (storageKeys.includes(newKey)) {
                    const variable = await getVarFromFunction(functionVariables, functionName, storageSlot);
                    console.log("IT MATCHES string: " + JSON.stringify(variable));
                }
            }
            console.log("nada");

        }
    }
    // let newKey =  localweb3.utils.soliditySha3(hexKey + '0000000000000000000000000000000000000000000000000000000000000000');


    // const hexKeyWithZeros = '6369616f00000000000000000000000000000000000000000000000000000000'
    //const trimmedHexString =  hexKeyWithZeros.split('0')[0];

    // let newKey =  localweb3.utils.soliditySha3('000000000000000000000000000000000000000000000000000000000000001f' + '0000000000000000000000000000000000000000000000000000000000000000');
    // console.log("GETTING STORAGE VAR: " + await localweb3.eth.getStorageAt('0xefCa968983fFa3cF96A24A3Eb214cAE607ddEf83', newKey));

}
