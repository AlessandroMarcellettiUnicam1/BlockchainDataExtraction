const {Web3} =require('web3');
const InputDataDecoder = require('ethereum-input-data-decoder');
const solc = require('solc');
const fs = require('fs');
const axios = require("axios");
const { Network, Alchemy } = require("alchemy-sdk");
const ethers = require("ethers");
const https = require("https");
const ganache = require("ganache");
const { spawn  } = require('child_process');
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


async function cleanTest(blockNumber, functionName, txHash){
    const provider = ganache.provider({
        network_id: 1,
        fork: 'https://mainnet.infura.io/v3/f3851e4d467341f1b5927b6546d9f30c\@'+blockNumber


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
        let functionKeys = [];
        for(const trace of response.structLogs){
            console.log(trace);
            //if SHA3 is found then read all keys before being hashed
            if(trace.op === "SHA3"){
                const stackLength = trace.stack.length;
                const memoryLocation = trace.stack[stackLength-1];
                //the memory contains 32 byte words so the hex index is converted to number and divided by 32
                //in this way the index in the memory arrays is calculated
                let numberLocation = web3.utils.hexToNumber("0x" + memoryLocation)/32;
                //take the key from the memory
                const hexKey = trace.memory[numberLocation];
                functionKeys.push(hexKey);
            }else if(trace.op === "STOP"){
                //retrieve the entire storage after function execution
                //for each storage key discard the ones of static variables and compare the remaining ones with the re-generated
                functionStorage = trace.storage;
            }
        }
    await generateMappingKey(functionKeys, functionStorage, functionName, contracts);


}
cleanTest(16924868, "setInboundCap", "0x77f9327c329f72ca665660650a1d9705aa693257815a689898a5d4468da94ed8");

//function for re-generating the key and understand the variable thanks to the tests on the storage location
async function generateMappingKey(memoryKeys, functionStorage, functionName, contracts){
    const functionVariables = await getCompiledData(contracts)
    //console.log(functionVariables);
    const storageKeys = await convertStorageKeys(functionStorage);
    let storageSlots = [];

    //storage slots filtered by all the variables modified in the function

    for(const variable of functionVariables[functionName]){
        storageSlots.push(variable.storageSlot)
        console.log(storageSlots);
    }

    //iterate all keys in the memory of an SHA3 command
    let aaa =  localweb3.utils.soliditySha3("0000000000000000000000000000000000000000000000000000000000000066" +
        "0000000000000000000000000000000000000000000000000000000000000012", { encoding: "hex" });
    console.log(aaa);
    console.log(await web3.eth.getStorageAt(contractAddress, aaa, 16924868));
    // console.log(localweb3.utils.soliditySha3("0000000000000000000000000000000000000000000000000000000000000066" + "0000000000000000000000000000000000000000000000000000000000000012"));
    for(const memoryKey of memoryKeys){
        //test the SHA with all possible storage slots of variables within specific the function
        for(const storageSlot of storageSlots){
            const prova = web3.utils.padLeft(web3.utils.numberToHex("102"), 64)
            const storageIndex = web3.utils.padLeft(web3.utils.numberToHex(storageSlot), 64).replace('0x', '');
            let newKey =  localweb3.utils.soliditySha3(memoryKey + storageIndex, { encoding: "hex" });
            console.log(newKey);
            if(storageKeys.includes(newKey)){
                const variable = await getVarFromFunction(functionVariables, functionName, storageSlot);
                console.log("IT MATCHES address or int: " + JSON.stringify(variable));
            }else{
                const trimmedHexString =  memoryKey.split('0')[0];
                newKey = localweb3.utils.soliditySha3(trimmedHexString + storageIndex);
                if(storageKeys.includes(newKey)) {
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

async function convertStorageKeys(functionStorage){
    //console.log(functionStorage);
    let storageKeys = [];
    const buffer = Object.keys(functionStorage);
    for(const storageKey of buffer){
        storageKeys.push('0x' + storageKey);
    }
    return storageKeys;
}
async function getVarFromFunction(functionVariables, functionName, storageSlot){
    for(const variable of functionVariables[functionName]){
        if(variable.storageSlot === storageSlot){
            return variable;
        }
    }
}

async function getCompiledData(contracts){
    let input = {
        language: 'Solidity',
        sources: {

        },
        settings: {
            outputSelection: {
                "*": {
                    "*": ["storageLayout", "ast"],
                    "": ["ast"]
                }
            }
        }
    };


    for(const contract in contracts){
        input.sources[contract] = {};
        input.sources[contract].content = contracts[contract].content;
    }


   // input.sources['contract.sol'] = {}
   // input.sources['contract.sol'].content = fs.readFileSync("contract.sol", 'utf8');
    const output = solc.compile(JSON.stringify(input));

    fs.writeFileSync('testContract.json', output);

    const source = JSON.parse(output).sources;
    //take all the variables from the storage layout
    const storageData = await getVariablesFromStorage(JSON.parse(output));
    const variablesAstIds = storageData.variablesAstIds;
    const variablesAstNames = storageData.storageVariables;

    let functionVariables = {};
    let contractToIterate = {};
    //todo take contract dynamically
    for(const directive of source['contracts/eth/OFT.sol'].ast.nodes){
        //reads the nodes of the ast searching for the contract and not for the imports
        if(directive.nodeType === "ContractDefinition"){
            contractToIterate = directive;
        }
    }

    for(const node of contractToIterate.nodes){
        //read the AST looking for functions todo take name dynamically from transaction
        if(node.nodeType === "FunctionDefinition" && node.name === "setInboundCap"){
            functionVariables[node.name] = [];
            //iterate the expression nodes in the body of the function
            for(const bodyNode of node.body.statements){
                if(bodyNode.hasOwnProperty("expression")){
                    //if the node in the body is an expression involving a variable then take its AST ID
                    const astId = bodyNode.expression.leftHandSide.baseExpression.referencedDeclaration;
                    if(bodyNode.nodeType ===  "ExpressionStatement" && variablesAstIds.includes(astId)){
                        //console.log("variable found!: " + variablesAstNames[bodyNode.expression.leftHandSide.baseExpression.referencedDeclaration].name);

                        functionVariables[node.name].push({astId: astId,  name: variablesAstNames[astId].name,
                            type: variablesAstNames[astId].type, storageSlot: variablesAstNames[astId].slot});
                    }
                }

            }
        }
    }
    //console.log(functionVariables);
    return functionVariables;
}


async function getContractCodeEtherscan(){
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
       for(const contract in jsonCode){
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



async function getVariablesFromStorage(compiled){
    const variablesAstIds = [];
    let storageVariables = {};
    //todo understand if we want single contract or all, make it dynamic
    const firstKey = Object.keys(compiled.contracts['contracts/eth/OFT.sol'])[0];
    const storageLay = compiled.contracts['contracts/eth/OFT.sol'][firstKey].storageLayout.storage;
    for(const storageVar of storageLay){
        variablesAstIds.push(storageVar.astId);
        storageVariables[storageVar.astId] = {};
        storageVariables[storageVar.astId].name = storageVar.label;
        storageVariables[storageVar.astId].type = storageVar.type;
        storageVariables[storageVar.astId].slot = storageVar.slot;
    }
    return {variablesAstIds, storageVariables};
}

async function getTraceFromGanache(blockNumber, txHash){

    const response = await axios.post("http://127.0.0.1:8545", {
        "jsonrpc": '2.0',
        "method": 'debug_traceTransaction',
        "params": ['0xcbfe9e05dace16228ba30cbb6f7ef9e3b15670288fa0f5b02b7ad908654d4c7a', {}], // Replace {} with any optional parameters
        "id": 1

    });
    const index = web3.utils.padLeft(web3.utils.numberToHex(2), 64);
    console.log(index);
    const key = web3.utils.padLeft(web3.utils.numberToHex(2), 64);
    let newKey =  localweb3.utils.soliditySha3('00000000000000000000000016ddb4df2e84fbe3ceb47331e74b1e42e1de4bf7' + '0000000000000000000000000000000000000000000000000000000000000002');
    console.log(newKey);
    console.log(await localweb3.eth.getStorageAt('0xe2EeCB636b161f3CbAbd2058CeA9eCB4b4e0a3B2', newKey));

    if(newKey === '0x0c6cea2ff3d2084ff38980a465cd3b3d626dc03095879afa94f1f950e223a449'){
        console.log("SIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII")
    }
    //console.log(response.data.result.structLogs);
    for(const trace of response.data.result.structLogs) {

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


