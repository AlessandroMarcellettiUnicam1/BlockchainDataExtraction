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


async function cleanTest(){
    const response = await axios.post("http://127.0.0.1:8545", {
        "jsonrpc": '2.0',
        "method": 'debug_traceTransaction',
        "params": ['0x8b91eb0715fa896550648b11c6b3fbc561e6c30ccc1ec3b08abaca521fcd075c', {}], // Replace {} with any optional parameters
        "id": 1
    });


        //used to store the storage changed by the function. Used to compare the generated keys
        let functionStorage;
        //used to store all the keys potentially related to a dynamic structure
        let functionKeys = [];
        for(const trace of response.data.result.structLogs){
            //if SHA3 is found then read all keys before being hashed
            if(trace.op === "SHA3"){
                const stackLength = trace.stack.length;
                const memoryLocation = trace.stack[stackLength-1];
                //todo understand the conversion index in the storage - index in the memory
                const hexKey = trace.memory[web3.utils.hexToNumber("0x"+memoryLocation)];
                functionKeys.push(hexKey);
            }else if(trace.op === "STOP"){
                //retrieve the entire storage after function execution
                //for each storage key discard the ones of static variables and compare the remaining ones with the re-generated
                functionStorage = trace.storage;
            }
        }
    await generateMappingKey(functionKeys, functionStorage);


}
//cleanTest();

//function for re-generating the key and understand the variable thanks to the tests on the storage location
async function generateMappingKey(memoryKeys, functionStorage){

    const storageKeys = await convertStorageKeys(functionStorage);
    //todo take from compiled file
    //storage slots taken from storage Layout, they correspond to the storage indexes of all state variables
    const storageSlots = [0, 1];

    for(const memoryKey of memoryKeys){
        for(const storageSlot of storageSlots){
            const storageIndex = web3.utils.padLeft(web3.utils.numberToHex(storageSlot), 64);
            let newKey =  localweb3.utils.soliditySha3(memoryKey + storageIndex.replace('0x', ''));
            if(storageKeys.includes(newKey)){
                console.log("IT MATCHES address or int: " + newKey);
            }else{
                const trimmedHexString =  memoryKey.split('0')[0];
                newKey = localweb3.utils.soliditySha3(trimmedHexString + web3.utils.padLeft(web3.utils.numberToHex(storageSlot), 64));
                if(storageKeys.includes(newKey)) {
                    console.log("IT MATCHES string: " + newKey);
                }
            }
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

        /*const provider = ganache.provider({
             network_id: 5777,
             //url: 'HTTP://127.0.0.1:8545'
             //network_id: 1,
              fork: 'HTTP://127.0.0.1\@'+blockNumber


         });*/
    /*console.log(ganache.server);

    const accounts = await provider.request({
        method: "debug_traceTransaction",
            params: [txHash,
            //{
            //"tracer": "callTracer"}
        ]
    });

    console.log(accounts);*/


}
//getTraceFromGanache('59', '0x00dcf16e3b93cb428fcbf310d6bf7c15cd2669489383e6806e68f9beda7842f0')
    async function traceTransaction() {
        try {
            const response = await axios.post(nodeUrl, {
                "jsonrpc": '2.0',
                "method": 'trace_transaction',
                "params": ['0x4c253746668dca6ac3f7b9bc18248b558a95b5fc881d140872c2dff984d344a7', {}], // Replace {} with any optional parameters
                "id": 1

            });

            console.log(response.data);
        } catch (error) {
            console.error(error);
        }
    }

async function getContractCodeEtherscan(){
    let input = {
        language: 'Solidity',
        sources: {

        },
        settings: {
            outputSelection: {
                "*": {
                    "*": ["storageLayout"],
                    "": ["ast"]git co
                },
            }
        }
    };
    //todo reuse code in index.js to make this dynamic
    input.sources['contract.sol'] = {}
    input.sources['contract.sol'].content = fs.readFileSync("contract.sol", 'utf8');

    const output = solc.compile(JSON.stringify(input));

    fs.writeFileSync('testContract.json', output);

    const source = JSON.parse(output).sources;

    //todo take all of these dynamically from ast or storageLayout
    const variablesAstIds = [5];
    const variablesAstNames = {
        5: {
            name: "vediamo",
            type: "mapping(address => uint256",
            storageSlot: 0
        }
    }
    let functionVariables = {}
    for(const node of source['contract.sol'].ast.nodes[1].nodes){
        //read the AST looking for functions
        if(node.nodeType === "FunctionDefinition"){
            //iterate the expression nodes in the body of the function
            for(const bodyNode of node.body.statements){
                //if the node in the body is an expression involving a variable then take its AST ID
                const astId = bodyNode.expression.leftHandSide.baseExpression.referencedDeclaration;
                if(bodyNode.nodeType ===  "ExpressionStatement" && variablesAstIds.includes(astId)){
                    //console.log("variable found!: " + variablesAstNames[bodyNode.expression.leftHandSide.baseExpression.referencedDeclaration].name);
                    functionVariables[node.name] = [];
                    functionVariables[node.name].push({astId: astId,  name: variablesAstNames[astId].name,
                        type: variablesAstNames[astId].type, storageSlot: variablesAstNames[astId].storageSlot});
                }
            }
        }
    }
    //console.log(functionVariables);
    return functionVariables;


    /*for(const contract in jsonCode){

        let actualContract = 'contract' + i;
        let code = jsonCode[contract].content;
        input.sources[contract] = {}
        input.sources[contract].content = code

        i++;

        buffer += code
        //}

    }


    for (let contractName in output.contracts['contractEtherscan.sol']) {
        //console.log(output.contracts['contract.sol'][contractName].storageLayout);
        generalStorageLayout = output.contracts['contractEtherscan.sol'][contractName].storageLayout
    }*/

}
getContractCodeEtherscan()


