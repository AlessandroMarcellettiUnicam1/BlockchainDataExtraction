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



    const nodeUrl = 'HTTP://127.0.0.1:8545\n'; // Replace with your Ethereum node or Infura URL
    const transactionHash = '0xYourTransactionHash'; // Replace with the transaction you want to trace
async function getTraceFromGanache(blockNumber, txHash){
    const ganache = require("ganache");
    const response = await axios.post("http://127.0.0.1:8545", {
        "jsonrpc": '2.0',
        "method": 'debug_traceTransaction',
        "params": ['0x41fb50a60fe507a5ef7f57e478551ba19d872a05299b121b6b67ed03f680f42b', {}], // Replace {} with any optional parameters
        "id": 1

    });
    //console.log(response.data.result.structLogs);
    for(const trace of response.data.result.structLogs) {

        console.log(trace);
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
getTraceFromGanache('59', '0x00dcf16e3b93cb428fcbf310d6bf7c15cd2669489383e6806e68f9beda7842f0')
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

//traceTransaction()
//getTraceFromGanache(16924488, '0xc660499c88814c243919ad08337ae88fc3e2395e5d7587da6b13e1dc7c58f46d')
async function main(){
    console.log('una chiamata al main')
   // await getTraceFromGanache('0x3c5102440a911f3c740e0c3477ccd75d60bba3cadaff369975dbeb907d13a461')


}

async function getContractCodeEtherscan(){
    let input = {
        language: 'Solidity',
        sources: {

        },
        settings: {
            outputSelection: {
                '*': {
                    '*': ["storageLayout"]
                }
            }
        }
    };

    const realResult = fs.readFileSync('solcOutput');
    jsonCode = JSON.parse(realResult).sources
    let i;
    for(const contract in jsonCode){

        let actualContract = 'contract' + i;
        let code = jsonCode[contract].content;
        input.sources[contract] = {}
        input.sources[contract].content = code

        i++;

        buffer += code
        //}

    }

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    console.log(output);

}
//getContractCodeEtherscan()

