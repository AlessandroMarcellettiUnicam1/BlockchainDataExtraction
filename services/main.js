const {Web3} = require('web3');

const fs = require('fs');
const axios = require("axios");
const {stringify} = require("csv-stringify")
let contractAbi = {};
const { decodeInternalTransaction } = require('./decodeInternalTransaction');
const { optimizedDecodeValues }= require('./optimizedDecodeValues')
const { getCompiledData, getContractCodeEtherscan } = require ('./contractUtils/utils')
//const contractAddress = '0x152649eA73beAb28c5b49B26eb48f7EAD6d4c898'cake;
//const contractAddress = '0x5C1A0CC6DAdf4d0fB31425461df35Ba80fCBc110';
//const contractAddress = '0xc9EEf4c46ABcb11002c9bB8A47445C96CDBcAffb';
//const cotractAddressAdidas = 0x28472a58A490c5e09A238847F66A68a47cC76f0f
const hre = require("hardhat");
const {saveTransaction, saveExtractionLog} = require("../databaseStore");
const {searchTransaction} = require("../query/query")
const {connectDB} = require("../config/db");
const mongoose = require("mongoose");
require('dotenv').config();
const v8 = require('v8');
const path = require('path');
const { fork } = require("child_process");

const {ethers} = require("hardhat");

let networkName = ""
let web3 = null
let web3Endpoint = ""
let apiKey = ""
let endpoint = ""

let _contractAddress = ""

let contractCompiled = null


/**
 * Method called by the server to extract the transactions
 *
 * @param mainContract - contract name
 * @param contractAddress - the contract address to be analyzed
 * @param fromBlock - the starting block number
 * @param toBlock - the ending block number
 * @param network - the network where the contract is deployed
 * @param filters - the filters to be applied to the transactions
 * @param smartContract - the smart contract uploaded file
 * @returns {Promise<*|*[]>} - the blockchain log with the extracted data
 */

async function getAllTransactions(mainContract, contractAddress, impl_contract, fromBlock, toBlock, network, filters, smartContract,extractionType) {
    _contractAddress = contractAddress
    networkName = network;
    try{
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

        }

        web3 = new Web3(web3Endpoint)
        //contractAddress = proxy address in which storage and txs are made
        
        let data = await axios.get(endpoint + `&module=account&action=txlist&address=${contractAddress}&startblock=${fromBlock}&endblock=${toBlock}&sort=asc&apikey=${apiKey}`)
        const contractTransactions = await data.data.result
        data=null;
        // returns all contracts linked to te contract sent in input from etherscan
        let contractsResult = null
        // if the contract is uploaded by the user then the contract is compiled
        if (smartContract) {
            contractsResult = smartContract
        } else {
            //implementation contract address
            contractsResult = await getContractCodeEtherscan(impl_contract,endpoint,apiKey);
        }
        //mainContract = implementationContract name
        const contractTree = await getCompiledData(contractsResult.contracts, mainContract,contractsResult.compilerVersion);
        contractCompiled=contractTree.contractCompiled
        contractAbi=contractTree.contractAbi
        if(contractAbi === undefined || (typeof contractAbi === 'object' && contractAbi !== null && Object.keys(contractAbi).length === 0)){
            let callForAbi = await axios.get(`${endpoint}&module=contract&action=getsourcecode&address=${contractAddress}&apikey=${apiKey}`);
            if(!callForAbi.data.message.includes("NOTOK")) {
                    contractAbi=callForAbi.data.result[0].ABI
            }
        }
        
        contractsResult=null;
        const userLog = {
            networkUsed: networkName,
            proxyContract: contractAddress,
            implementationContract: impl_contract,
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
        
       
        await connectDB(networkName);
        await saveExtractionLog(userLog,networkName)
        // let txFromDb=[];
        // for(const tx of contractTransactions){
        //     const query = {
        //         transactionHash: tx.hash.toLowerCase(),
        //         contractAddress: contractAddress.toLowerCase()
        //     };
        //     const response = await searchTransaction(query, networkName);
        //         if (response) {
        //             console.log(`Transaction already processed: ${tx.hash}`);
        //             const { _id, __v, ...transactionData } = response[0];
        //             txFromDb.push(transactionData);
        //         }
        // }
        // if(txFromDb.length>0){
        //     await mongoose.disconnect();
        //     return txFromDb;
        // }
        const result = await getStorageData(contractTransactions, mainContract, contractTree, contractAddress, filters, smartContract,extractionType);
        await mongoose.disconnect();

       
        // await removeCollectionFromDB(networkName).then(removeAddressCollection(contractAddress,process.env.LOG_DB_NAME));
        // return result;
        //changed contratAddress to impl since it contains the storage to evaluate
        // return await getStorageData(contractTransactions, mainContract, contractTree, impl_contract, filters,smartContract);
        // let csvRow = []
        // csvRow.push({
        //     transactionHash: null,
        //     debugTime: null,
        //     decodeTime: null,
        //     totalTime: parseFloat((traceTime + decodeTime).toFixed(2))
        // })
        // stringify(csvRow, (err, output) => {
        //     fs.appendFileSync('csvLogs.csv', output)
        // })
        contractCompiled=null;
        return result;
    } catch (err) {
        console.error(err)
        return err;
    }finally{
        await cleanupResources();
    }
}
async function cleanupResources() {
    try {
        // Close database connections
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
        
        // Clean up web3 instance
        web3 = null;

        // Clean up hardhat
        if (hre && hre.network && hre.network.provider) {
            await hre.run("clean");
            await hre.network.provider.send("hardhat_reset");
            if (hre.network.provider.removeAllListeners) {
                hre.network.provider.removeAllListeners();
            }
        }

        // Force garbage collection
        if (global.gc) {
            global.gc();
        }
    } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError);
    }
}
module.exports = {
    getAllTransactions
};
//CakeOFT
//PixesFarmsLand
//AdidasOriginals
//getAllTransactions("CakeOFT");

/**
 * Filters contract transactions based on user-defined criteria.
 *
 * @param {Array} contractTransactions - List of contract transactions.
 * @param {Object} filters - Filters to apply (gasUsed, gasPrice, timestamp, senders, functions).
 * @returns {Array} - Filtered transactions.
 */
function applyFilters(contractTransactions, filters) {
    const { gasUsed, gasPrice, timestamp, senders, functions } = filters;

    return contractTransactions.filter(tx => {
        const matchesSender = !senders.length || senders.includes(tx.from.toLowerCase());
        const matchesFunction = !functions.length || functions.includes(tx.inputDecoded.method);
        const matchesGasUsed = !gasUsed || (tx.gasUsed >= gasUsed[0] && tx.gasUsed <= gasUsed[1]);
        const matchesGasPrice = !gasPrice || (tx.gasPrice >= gasPrice[0] && tx.gasPrice <= gasPrice[1]);
        const matchesTimestamp = !timestamp || (
            tx.timeStamp >= Math.floor(new Date(timestamp[0]).getTime() / 1000) &&
            tx.timeStamp <= Math.floor(new Date(timestamp[1]).getTime() / 1000)
        );

        return matchesSender && matchesFunction && matchesGasUsed && matchesGasPrice && matchesTimestamp;
    });
}

/**
 * Method used to compute the extraction phase, starting from the transactions extracted from Etherscan API.
 * The transactions are filtered using the filters provided by the user, then a search is carried out in the database
 * to avoid processing them again. If the transaction is not found in the database, it is debugged to proceed with storage decoding.
 *
 * @param {Array} contractTransactions - Transactions extracted using Etherscan API.
 * @param {string} mainContract - The main contract to decode.
 * @param {Object} contractTree - The contract tree derived before decoding the storage.
 * @param {string} contractAddress - The contract address used to search the transactions in the database and save new ones.
 * @param {Object} filters - Filters to be applied to the transactions.
 * @param {Object} smartContract - The smart contract uploaded file.
 * @returns {Promise<Array>} - The blockchain log with the extracted data.
 */
async function getStorageData(contractTransactions, mainContract, contractTree, contractAddress, filters, smartContract,extractionType) {
    let transactionsFiltered=null;
    // Decode input data for all transactions
   
    try{
    // Apply filters to transactions
        transactionsFiltered = applyFilters(contractTransactions, filters);
        contractTransactions=null;

        if (global.gc) global.gc();
        // Establish database connection
       
       
        for(const tx of transactionsFiltered){
            // await getEvents(tx.hash,contractAddress, Number(tx.blockNumber)) 
            try{
                await runWorkerForTx(tx, mainContract, contractTree, contractAddress, smartContract,extractionType);

            }catch (e){
                console.log("errore nel worker",e)
            }
        }
        console.log("Extraction finished");
        return [];
    }catch(err){
        console.log(err)
        return;
    }finally{
        if (transactionsFiltered) {
            transactionsFiltered.length = 0;
            transactionsFiltered = null;
        }
        if (global.gc) global.gc();
        await hre.run("clean");
        if (hre.network.provider.removeAllListeners) {
            hre.network.provider.removeAllListeners();
        }

    }
    
}
function runWorkerForTx(tx, mainContract, contractTree, contractAddress, smartContract,extractionType) {
    const workerPath = path.join(__dirname, 'worker.js');
    return new Promise((resolve, reject) => {
        const worker = fork(workerPath, [], {
            // Increase memory limit for worker
            execArgv: ['--max-old-space-size=1024', '--expose-gc']
        });
        // Set timeout for worker (optional)
        const timeout = setTimeout(() => {
            worker.kill('SIGKILL');
            reject(new Error('Worker timeout'));
        }, 3000000); // 5 minutes timeout
        worker.send({
            tx,
            mainContract,
            contractTree,
            contractAddress,
            smartContract,
            extractionType,
            network: networkName,
            contractAbiData: contractAbi,
            contractCompiledData: contractCompiled
        });

        worker.on("message", (msg) => {
            clearTimeout(timeout);
            if (msg === "done") {
                resolve();
            } else if (msg.error) {
                reject(new Error(msg.error));
            }
        });

        worker.on("exit", (code, signal) => {
            clearTimeout(timeout);
            if (code !== 0 && signal !== 'SIGKILL') {
                reject(new Error(`Worker exited with code ${code} and signal ${signal}`));
            } else if (code === 0) {
                resolve();
            }
        });

        worker.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}


// 0xa939a421a423fc2beb109f09f34d3fe96b3bb4bffaacd8203cc60e3d052efea3

//ultima transazione
// 0x8848f14a738c0f2bb87247e6796e1950068c14791f9b436b1b9d31c6747e695e