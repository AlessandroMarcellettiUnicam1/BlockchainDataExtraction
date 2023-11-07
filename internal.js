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

//what if: we take addresses and
async function getInternalTransactions(txHash){
    const aaa = await axios.post("HTTP://127.0.0.1:8545", {
        "jsonrpc": '2.0',
        "method": 'debug_traceTransaction',
        "params": ['0x0a793310afe3c51adfe318dc27767b670b135e1be3af2d3eb087a3aab9f385b0', {}], // Replace {} with any optional parameters
        "id": 1
    });
    //console.log(aaa.data.result.structLogs);
    for(const ca of aaa.data.result.structLogs){
        if(ca.op==="SSTORE" || ca.op === "SHA3"){
            console.log(ca);
        }
    }
    process.exit();

    const MORALIS_API_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6ImJjOGVkMDZjLTc5YmEtNDIxYS1iMzE1LTQ0NTIxYWVjNDE0OSIsIm9yZ0lkIjoiMzU5NDk5IiwidXNlcklkIjoiMzY5NDY1IiwidHlwZUlkIjoiN2Q4YTNkOWEtOTNhMi00MjdlLTg5ZTEtMzM5ZTkwNjdlMWVhIiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE2OTYyMzQwNjcsImV4cCI6NDg1MTk5NDA2N30.O28eO9rDl_wGDt0LJ9i7LaeVwp3auYrHrwo8dDmN2Yw";
    const chain = EvmChain.ETHEREUM;
    await Moralis.start({
        apiKey: MORALIS_API_KEY,
    });
    const response = await Moralis.EvmApi.transaction.getInternalTransactions({
        "chain": "0x1",
        "transactionHash": txHash
    });

    //console.log(response.raw);
    for(const internTx of response.raw){
        //get contract address
       // console.log(internTx.to);
        //await getAbi(internTx.to);


    }
}
getInternalTransactions("0x446f97e43687382fefbc6a9c4cccd055829ef2909997fb102a1728db6b37b76a");


//NOT WORKING, IT IS POSSIBLE TO GET ABI ONLY OF VERIFIED CONTRACTS
async function getAbi(cAddress){
    const apiKey = 'I81RM42RCBH3HIC9YEK1GX6KYQ12U73K1C';
    const endpoint = `https://api.etherscan.io/api?module=contract&action=getabi&address=${cAddress}&apikey=${apiKey}`;

    axios.get(endpoint)
        .then((response) => {
            const data = response.data;
            console.log(response);
            if (data.status === '1') {
                console.log(data);
            } else {
                console.error('Error: Unable to retrieve transactions.');
            }
        })
        .catch((error) => {
            console.error(`An error occurred: ${error}`);
        });

}
