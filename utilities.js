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



async function getTraces(blockNumber, txHash){

        const ls = spawn('ganache.cmd', ['--fork.network', 'mainnet', '--fork.blockNumber', blockNumber], {});
        console.log(ls.pid);
        ls.stdout.on('data', (data) => {
            console.log("pippo");
            console.log(`stdout: ${data}`);
        });

        ls.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });

        ls.on('close', (code, signal) => {
            console.log(`child process exited with code ${code}`);
        });
        const vaa = setTimeout(async () => {
           const p = await getStorageFromTrace(ls.pid, blockNumber, txHash);

            console.log("terminatedd")
            process.kill(ls.pid);
            process.exit()
            return p;

        }, 5000);
    }

async function getStorageFromTrace(pid, blockNumber, txAddress){
    let storageValues = []
    axios.post('http://127.0.0.1:8545', {"method": "debug_traceTransaction", "params" :  [txAddress,  {
            "tracer": "prestateTracer"
        }]}).then((response) => {
        const rawData = response.data;
        // console.log(rawData.result.structLogs);

        for (const log of rawData.result.structLogs) {
            console.log('.........................................')
            console.log(log.op)
            console.log(log.storage)

            if(log.op === 'STOP'){
                console.log(log.storage);
                const keys = Object.keys(log.storage);
                for(const key of keys){
                    console.log('sto isnerendo OP')
                    storageValues.push(log.storage[key])
                }

            }
        }
        // web3.eth.getStorageAt(contractAddress, "0x6fc3b8e7a837271ba00b731b2bd88ce48419283825eb0ec35420d4c59904f32e", 16924888)
        process.kill(pid);
        // processStorage(storageKeys, blockNumber)
        //process.exit()
        return storageValues;
    }).catch((error) => {
        console.error(`An error occurred: ${error}`);
    });



}
getTraces(16924448, 0xc660499c88814c243919ad08337ae88fc3e2395e5d7587da6b13e1dc7c58f46d)