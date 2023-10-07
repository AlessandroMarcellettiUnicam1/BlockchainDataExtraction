const {Web3} =require('web3');
const InputDataDecoder = require('ethereum-input-data-decoder');
const solc = require('solc');
const fs = require('fs');
const sourceCode = fs.readFileSync('contract.sol', 'utf8');
const contractAbi = [
    {
        "inputs": [
            {
                "internalType": "uint256",
                "name": "inp1",
                "type": "uint256"
            },
            {
                "internalType": "bool",
                "name": "inp2",
                "type": "bool"
            }
        ],
        "name": "initializeThreshold",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
]
let web3 = new Web3('HTTP://127.0.0.1:7545')
let web4 = new Web3('https://polygon-mumbai.g.alchemy.com/v2/CQRFEl7R7T4GDaY9AK9DzUBnW2B5WB2h')
let transactions = [];
let generalStorageLayout;
const contractAddress = '0xba36edd800959696625c3e9bade8f8e51b5b3c7d'
let blockchainLog = [{}];
async function readStorageLayout() {

    const input = {
        language: 'Solidity',
        sources: {
            'contract.sol': {
                content: sourceCode
            }
        },
        settings: {
            outputSelection: {
                '*': {
                    '*': ["storageLayout"]
                }
            }
        }
    };
    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    for (let contractName in output.contracts['contract.sol']) {
        //console.log(output.contracts['contract.sol'][contractName].storageLayout);
        generalStorageLayout = output.contracts['contract.sol'][contractName].storageLayout
    }
    console.log(generalStorageLayout);
    await getStorageData()

}

async function getStorageData(){
    //todo get all transactions from the contract
   // const transaction = await web3.eth.getTransaction("0xc43edd41977e9fb87c0f8a5851d092460281266dd5b939fc7609a8fa764277e9")

   // console.log(web3.utils.hexToNumber(result.inputs[0]._hex));
    //console.log(transactions);
    for(const tx of transactions){
        let newLog = {
            activity: '',
            inputNames: [],
            inputTypes: [],
            inputValues: [],
            storageVarTypes: [],
            storageVarNames: [],
            storageValues: []
        };
        console.log('---------------------------------------------------');
        const decoder = new InputDataDecoder(contractAbi);
        const result = decoder.decodeData(tx.input);
        newLog.activity = result.method;
        for (let i = 0; i < result.inputs.length; i++) {

            newLog.inputTypes[i] = result.types[i];
            newLog.inputNames[i] = result.names[i];
            //console.log(result.method);
            //console.log(result.types[i]);
            //console.log(result.names[i]);

        if(result.types[i] === 'uint256'){
                //console.log(web3.utils.hexToNumber(result.inputs[i]._hex));
            newLog.inputValues[i] = web3.utils.hexToNumber(result.inputs[i]._hex);
        }else if(result.types[i] === 'string'){
               // console.log(web3.utils.hexToAscii(result.inputs[i]));
            newLog.inputValues[i] = web3.utils.hexToAscii(result.inputs[i]);
        }else{
                //console.log(result.inputs[i])
            newLog.inputValues[i] = result.inputs[i];
            }
        }
        //WORKS WITH STORAGE
        let index = 0;
        for (const storageVar of generalStorageLayout.storage){
            newLog.storageVarNames[index] = storageVar.label

            //console.log(storageVar.label)
           // console.log(result.inputs[i])
            const storageValue = await web3.eth.getStorageAt(contractAddress, storageVar.slot, tx.blockNumber)
            //console.log(storageValue);

            if(storageVar.type === 't_uint256'){
                //console.log(web3.utils.hexToNumber(storageValue));
                newLog.storageValues[index] = web3.utils.hexToNumber(storageValue);
            }else if(storageVar.type === 't_string'){
                //console.log(web3.utils.hexToAscii(storageValue));
                newLog.storageValues[index] = web3.utils.hexToAscii(storageValue);
            }else if(storageVar.type === 't_bool'){
                if(storageValue == true){
                    newLog.storageValues[index] = 'true'
                    //console.log('true');
                }else{
                    //console.log('false')
                    newLog.storageValues[index] = 'false'
                }
            }
            index ++;
        }
    blockchainLog.push(newLog)
    }
}

async function getTransactionsByAddress() {
    try {
        const latestBlock = await web3.eth.getBlockNumber();


        for (let blockNumber = 0; blockNumber <= latestBlock; blockNumber++) {
            const block = await web3.eth.getBlock(blockNumber, true);
            if (block && block.transactions) {
                for(const tx of block.transactions){
                  //  console.log(tx);
                    if(tx.to === contractAddress){
                      //console.log(tx);
                       transactions.push(tx);
                    }
               }
            }
        }
        await readStorageLayout()


        // console.log(transactions);
    } catch (error) {
        console.error('Error:', error);
    }
}

async function getAllTransactions(){
    const axios = require('axios');

// Replace with your Etherscan API key
    const apiKey = 'I81RM42RCBH3HIC9YEK1GX6KYQ12U73K1C';

// Replace with the contract address you want to retrieve transactions for
    const contractAddress = '0xf258FabBF035353001f0f34799666608d4A75C90';

// Etherscan API endpoint for contract transactions
    const endpoint = `https://api.etherscan.io/api?module=account&action=txlist&address=${contractAddress}&startblock=0&endblock=99999999&sort=asc&apikey=${apiKey}`;

    axios
        .get(endpoint)
        .then((response) => {
            const data = response.data;
            if (data.status === '1') {
                const transactions = data.result;
                transactions.forEach((transaction) => {
                    console.log(transaction);
                });
            } else {
                console.error('Error: Unable to retrieve transactions.');
            }
        })
        .catch((error) => {
            console.error(`An error occurred: ${error}`);
        });

}
//getAllTransactions()
//getTransactionsByAddress()


async function pp(){

// Replace with the desired output file path
const inputData = blockchainLog;


    const ocelJson = Serializer.serializeJson(inputData);



    try {
        // Serialize the object-centric event log data to JSON
        const ocelJson = JSON.stringify(objectCentricData, null, 2);

        // Write the OCEL JSON to the output file
        fs.writeFileSync(ocelOutputFilePath, ocelJson);
        console.log(`OCEL JSON file created at ${ocelOutputFilePath}`);
    } catch (error) {
        console.error(`Error writing output file: ${error}`);
    }

}

