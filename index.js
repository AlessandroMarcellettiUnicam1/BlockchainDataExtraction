const {Web3} =require('web3');
const InputDataDecoder = require('ethereum-input-data-decoder');
const solc = require('solc');
const fs = require('fs');
const axios = require("axios");
const sourceCode = fs.readFileSync('contractEtherscan.sol', 'utf8');
let contractAbi = fs.readFileSync('abiEtherscan.json', 'utf8');
let localweb3 = new Web3('HTTP://127.0.0.1:7545')
let web3 = new Web3('https://eth-mainnet.g.alchemy.com/v2/ISHV03DLlGo2K1-dqE6EnsyrP2GF44Gt')
let transactions = [];
let generalStorageLayout;
let contractTransactions = [];
let blockchainLog = [{}];
const contractAddress = '0x152649eA73beAb28c5b49B26eb48f7EAD6d4c898';

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



async function readStorageLayout() {

    /*const input = {
        language: 'Solidity',
        sources: {
            'Claims.sol': {
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
    };*/
    //console.log(input);
        const output = solc.compile(JSON.stringify(input));
        fs.writeFileSync('solcOutput', output);
        for(const pippo in output.sources) {
            console.log(pippo);
        }


/* WITH OLD SOLC READ AST
for(const contract of output.sources[''].AST.children){
    //if(contract.name == 'VariableDeclaration'){
    for(const singleContract in contract){
        if(contract.name === 'ContractDefinition'){
            console.log('................................');
            //console.log(contract.children);
            for(const attribute of contract.children){
                if(attribute.name === 'VariableDeclaration'){
                    console.log(attribute);
                }
            }
        }
    }
    //}
}*/

   // READ STORAGE LAYOUT WITH SOLC 0.5+
   for(const pippo in output.sources){
        console.log(pippo);
    }
    console.log(await web3.eth.getStorageAt(contractAddress, 16));
    for (let contractName in output.contracts['contractEtherscan.sol']) {
        //console.log(output.contracts['contract.sol'][contractName].storageLayout);
        generalStorageLayout = output.contracts['contractEtherscan.sol'][contractName].storageLayout
    }
   //TODO await getStorageData()

}

//todo work with mapping value
async function getStorageData(){
   // const transaction = await web3.eth.getTransaction("0xc43edd41977e9fb87c0f8a5851d092460281266dd5b939fc7609a8fa764277e9")

   // console.log(web3.utils.hexToNumber(result.inputs[0]._hex));
    let partialInt = 0;
    console.log(contractTransactions.length);
    for(const tx of contractTransactions){
        if(partialInt < 10){
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
        //console.log(tx.input);
        const result = decoder.decodeData(tx.input);
       // console.log("Decoded inputData: " + result);
        newLog.activity = result.method;
        for (let i = 0; i < result.inputs.length; i++) {

            newLog.inputTypes[i] = result.types[i];
            newLog.inputNames[i] = result.names[i];
            /*console.log("ACTIVITY: " + result.method);
            console.log("Input type" + result.types[i]);
            console.log("Input name" + result.names[i]);*/

        if(result.types[i] === 'uint256'){
                console.log("Input INTEGER: " + web3.utils.hexToNumber(result.inputs[i]._hex));
            newLog.inputValues[i] = web3.utils.hexToNumber(result.inputs[i]._hex);
        }else if(result.types[i] === 'string'){
                console.log("Input STRING: " + web3.utils.hexToAscii(result.inputs[i]));
            newLog.inputValues[i] = web3.utils.hexToAscii(result.inputs[i]);
        }else{
                console.log("Input BOOLEAN: " + result.inputs[i])
            newLog.inputValues[i] = result.inputs[i];
            }
        }
        //WORKS WITH STORAGE
        let index = 0;
        for (const storageVar of generalStorageLayout.storage){

                newLog.storageVarNames[index] = storageVar.label

                console.log("STORAGE VARAIBLE: " + storageVar.label)

                const storageValue = await web3.eth.getStorageAt(contractAddress, storageVar.slot, tx.blockNumber)
               // console.log("STORAGE Value: " + storageValue);

                if(storageVar.type === 't_uint256'){
                    console.log("STORAGE decoded integer VARAIBLE: " + web3.utils.hexToNumber(storageValue));
                    newLog.storageValues[index] = web3.utils.hexToNumber(storageValue);
                }else if(storageVar.type === 't_string'){
                    console.log("STORAGE decoded string VARAIBLE: " + web3.utils.hexToAscii(storageValue));
                    newLog.storageValues[index] = web3.utils.hexToAscii(storageValue);
                }else if(storageVar.type === 't_bool'){
                    if(storageValue == true){
                        newLog.storageValues[index] = 'true'
                        console.log("STORAGE decoded boolean VARAIBLE: " + 'true');
                    }else{
                        console.log('false')
                        newLog.storageValues[index] = 'false'
                    }
                }else{
                    console.log(storageVar.type)
                }
            index ++;
        }
        console.log("FINITOOO!!!")
    blockchainLog.push(newLog)
            partialInt++;
            }else{
            break;
        }}
    try {
        // Serialize the object-centric event log data to JSON
        console.log(blockchainLog);
        const finalParsedLog = JSON.stringify(blockchainLog, null, 2);

        // Write the OCEL JSON to the output file
        fs.writeFileSync('outputLog.json', finalParsedLog);
        console.log(`OCEL JSON file created`);
    } catch (error) {
        console.error(`Error writing output file: ${error}`);
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
                      console.log(tx);
                       transactions.push(tx);
                    }
               }
            }
        }
       // await readStorageLayout()


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

// Etherscan API endpoint for contract transactions
    const endpoint = `https://api.etherscan.io/api?module=account&action=txlist&address=${contractAddress}&startblock=0&endblock=99999999&sort=asc&apikey=${apiKey}`;

    axios
        .get(endpoint)
        .then((response) => {
            const data = response.data;

            if (data.status === '1') {
                const transactions = data.result;
                transactions.forEach((transaction) => {
                    //console.log(transaction);
                    contractTransactions.push(transaction);
                });
                getStorageData()
            } else {
                console.error('Error: Unable to retrieve transactions.');
            }
        })
        .catch((error) => {
            console.error(`An error occurred: ${error}`);
        });



}


async function getContractCodeEtherscan(firstRun, chosenContract){
    const axios = require('axios');

// Replace with your Etherscan API key
    const apiKey = 'I81RM42RCBH3HIC9YEK1GX6KYQ12U73K1C';

// Replace with the contract address you want to retrieve transactions for

// Etherscan API endpoint for contract transactions
    const endpoint = `https://api.etherscan.io/api?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${apiKey}`;


let buffer;
    axios
        .get(endpoint)
        .then((response) => {
            const data = response.data;
            if (data.status === '1') {
                let i = 0;
                let jsonCode = data.result[0].SourceCode;
               // fs.writeFileSync('contractEtherscan.json', jsonCode);
                //fs.writeFileSync('solcOutput', jsonCode);
                const realResult = fs.readFileSync('solcOutput');
                jsonCode = JSON.parse(realResult).sources
                //console.log(jsonCode);
                for(const contract in jsonCode){
                    //console.log(jsonCode[contract]);
                    //for(const code in jsonCode){
                    let actualContract = 'contract' + i;
                    let code = jsonCode[contract].content;
                    //console.log(code);
                    input.sources[contract] = {}
                        input.sources[contract].content = code
                        if(firstRun){
                           fs.writeFileSync('smartContracts/' + actualContract, JSON.stringify(code));
                        }
                        i++;

                        buffer += code
                    //}
                }
                if(firstRun){
                    fs.writeFileSync('abiEtherscan.json', data.result[0].ABI);
                }
                const output = JSON.parse(solc.compile(JSON.stringify(input)));
                //fs.writeFileSync('solcOutput', output);
                //console.log(output);
                for(const contract in output.contracts){
                   let contractname = Object.keys(output.contracts[contract])[0];
                   if(contractname.includes(chosenContract)){
                       generalStorageLayout = output.contracts[contract][contractname].storageLayout;
                       console.log("Contract storage retrieved");
                   }
                }
                getAllTransactions()
            } else {
                console.error('Error: Unable to retrieve transactions.');
            }
        })
        .catch((error) => {
            console.error(`An error occurred: ${error}`);
        });
}
getContractCodeEtherscan(false, 'CakeOFT')

//getTransactionsByAddress()
//readStorageLayout()
//getContractCodeEtherscan()

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

