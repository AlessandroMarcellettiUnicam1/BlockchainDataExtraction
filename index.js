const {Web3} =require('web3');
const InputDataDecoder = require('ethereum-input-data-decoder');
const solc = require('solc');
const fs = require('fs');
const axios = require("axios");
const { Network, Alchemy } = require("alchemy-sdk");
const ethers = require("ethers");
const https = require("https");
const ganache = require("ganache");
const { spawnSync  } = require('child_process');
const sourceCode = fs.readFileSync('contractEtherscan.sol', 'utf8');
let contractAbi = fs.readFileSync('abiEtherscan.json', 'utf8');
let localweb3 = new Web3('HTTP://127.0.0.1:8545')
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
                //'*': ["storageLayout"]
                '*': ["*"]
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

let indiceProva = 8;
async function getTraces(blockNumber, txHash){
   /* const mappingKey = 0;
const index = 0
    const encodedIndex = web3.eth.abi.encodeParameters(['uint'],['0'])
    const key = 'ciaone'
    const encodeKey = web3.eth.abi.encodeParameters(['string'],['ciaone'])
    for(let i = 0; i < 20; i++){
        const slot = web3.utils.soliditySha3(encodeKey + encodedIndex, {"encoding" : "hex"});
        console.log(slot);
        // const keyInBytes32 = web3.utils.asciiToHex(i);
        const storageValue = await localweb3.eth.getStorageAt(contractAddress, slot)
        console.log("STORAGE Value: " + storageValue);
    }*/
   // const tx = await web3.eth.getTransaction("0x2649b657617dac7272a9aaac751cb1c4a45d8e220a0ea9dfb0077aec750177eb");
    //const decoder = new InputDataDecoder(contractAbi);
    //const result = decoder.decodeData(tx.input);
    //console.log(result);
    //const storageValue = await web3.eth.getStorageAt(contractAddress, "0x6fc3b8e7a837271ba00b731b2bd88ce48419283825eb0ec35420d4c59904f32e", 16924888)
    //const please = await web3.utils.hexToNumber(storageValue);
   // console.log("STORAGE Value: " + please);

if(indiceProva < 10) {
    const ls = spawnSync('node', ['C:\\Users\\alkit\\OneDrive\\Desktop\\lavoro\\processMiningExtractor\\utilities.js'],  { encoding: 'utf-8' });
    console.log(ls.output);
   /* ls.stdout.on('data', (data) => {
        console.log("pippo");
        console.log(`stdout: ${data}`);
    });

    ls.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    ls.on('close', (code, signal) => {
        console.log(`child process exited with code ${code}`);
    });*/
   /* const vaa = setTimeout(async () => {
        await getStorageFromTrace(ls.pid, blockNumber, txHash);
        clearTimeout(vaa)
        console.log("terminatedd")

    }, 5000);*/
}

}

//getTraces(16924448, 0xc660499c88814c243919ad08337ae88fc3e2395e5d7587da6b13e1dc7c58f46d)

async function getTraceFromGanache(blockNumber, txHash){
    const ganache = require("ganache");

    const provider = ganache.provider({
        network_id: 1,
        fork: 'https://mainnet.infura.io/v3/f3851e4d467341f1b5927b6546d9f30c\@'+blockNumber


    });
    console.log(ganache.server);
    //await server.listen(8545, async function (err, blockchain) {
        //const provider = server.provider;
    const transactionTrace = await provider.request({
            method: "debug_traceTransaction",
            params: [txHash,
                //{
                //"tracer": "callTracer"}c43c7e3c9db62df2391156b2affb91410494af669d064ea4ed2c3479e89170e9
        ]
        });
        console.log('-------------------------------------------Trace taken');
    let storageValues = [];
   // console.log(transactionTrace);
    for(const trace of transactionTrace.structLogs){
        //console.log(trace);
        //STOP AND return takes all storages
        //SLOAD can take read storage variables
        //SSTORE takes all updated variables
        //CALL and DELEGATECALL and CALLCODE reads internal
        //console.log(trace);

        //if(trace.op === 'SHA3'){
           console.log('a CALL is terminated');
            console.log(trace);

           /* const keys = Object.keys(trace.storage);
            for(const key of keys){
                const decimalKey = parseInt(key, 16);
                //console.log("Storage Key:", key);
                storageValues.push(trace.storage[key])
            }*/
        //}
    }
    return storageValues;

   // });

}
//getTraceFromGanache(16924488, '0xc660499c88814c243919ad08337ae88fc3e2395e5d7587da6b13e1dc7c58f46d')
async function main(){
console.log('una chiamata al main')
    await getTraceFromGanache(
        18385438, '0x2f8e6e277aca58d56fd0e5ad0c9a0f54e89fc08b3521783ae8cfc51491827ee5')
  //  await getInternalTransactions('0x5f92755579cb5621d885f54ae656109f18d48416fc15aae8796ef1ac4b442d22')
}
//main()

async function getStorageFromTrace(pid, blockNumber, txAddress){
    let storageValues = []
    axios.post('http://127.0.0.1:8545', {"method": "debug_traceTransaction", "params" :  [txAddress,  {
            "tracer": "callTracer"
        }]}).then((response) => {
        const rawData = response.data;
       // console.log(rawData.result.structLogs);

        for (const log of rawData.result.structLogs) {
            //console.log('.........................................')
            //console.log(log.op)
            //console.log(log.storage)

            if(log.op === 'STOP' ){
                console.log(log.storage);
                const keys = Object.keys(log.storage);
                for(const key of keys){
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

async function processStorage(storageKeys, blockNumber){
    for (const storageKey of storageKeys){
        console.log(storageKey);
        const storageValue = await web3.eth.getStorageAt(contractAddress, '0x6fc3b8e7a837271ba00b731b2bd88ce48419283825eb0ec35420d4c59904f32e', blockNumber)
         console.log("STORAGE Value: " + storageValue);
        process.exit()
    }
}
//getContractCodeEtherscan(false, 'CakeOFT')
//todo work with mapping value
async function getStorageData(){
    let partialInt = 0;
    console.log(contractTransactions.length);
    for(const tx of contractTransactions){
        if(partialInt < 5){
            await getInternalTransactions(tx.hash);
        let newLog = {
            activity: '',
            timestamp: '',
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
        newLog.timestamp = tx.timeStamp;
        for (let i = 0; i < result.inputs.length; i++) {

            newLog.inputTypes[i] = result.types[i];
            newLog.inputNames[i] = result.names[i];

        if(result.types[i] === 'uint256'){
                console.log("Input INTEGER: " + Number(web3.utils.hexToNumber(result.inputs[i]._hex)));
            newLog.inputValues[i] = Number(web3.utils.hexToNumber(result.inputs[i]._hex));
        }else if(result.types[i] === 'string'){
                console.log("Input STRING: " + web3.utils.hexToAscii(result.inputs[i]));
            newLog.inputValues[i] = web3.utils.hexToAscii(result.inputs[i]);
        }else{
                console.log("Input BOOLEAN: " + result.inputs[i])
            newLog.inputValues[i] = result.inputs[i];
            }


        }
            const storageVal = await getTraceFromGanache(tx.blockNumber, tx.hash);
            newLog.storageValues = storageVal;
        //WORKS WITH STORAGE
        /*let index = 0;
        for (const storageVar of generalStorageLayout.storage){

                newLog.storageVarNames[index] = storageVar.label

                console.log("STORAGE VARAIBLE: " + storageVar.label)

                const storageValue = await web3.eth.getStorageAt(contractAddress, storageVar.slot, tx.blockNumber)
               // console.log("STORAGE Value: " + storageValue);

                if(storageVar.type === 't_uint256'){
                    console.log("STORAGE decoded integer VARAIBLE: " + Number(web3.utils.hexToNumber(storageValue)));
                    newLog.storageValues[index] = Number(web3.utils.hexToNumber(storageValue));
                }else if(storageVar.type === 't_string'){
                    console.log("STORAGE decoded string VARAIBLE: " + web3.utils.hexToAscii(storageValue));
                    newLog.storageValues[index] = web3.utils.hexToAscii(storageValue);
                }else if(storageVar.type === 't_bool'){
                    if(storageValue == true){
                        newLog.storageValues[index] = true
                        console.log("STORAGE decoded boolean VARAIBLE: " + 'true');
                    }else{
                        console.log('false')
                        newLog.storageValues[index] = false
                    }
                }else{
                    newLog.storageValues[index] = storageValue
                    console.log("TIPO GREZZO: " + storageVar.type + "CON VALORE: " + storageValue)
                }
            index ++;
        }*/
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
        fs.writeFileSync('pancakeSwap.json', finalParsedLog);
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
    console.log("index.js")

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
                  //  console.log(transaction);
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
//getAllTransactions();

async function getInternalTransactions(txHash){
    const apiKey = 'I81RM42RCBH3HIC9YEK1GX6KYQ12U73K1C';

// Replace with the contract address you want to retrieve transactions for

// Etherscan API endpoint for contract transactions
    const endpoint = `https://api.etherscan.io/api?module=account&action=txlistinternal&txhash=${txHash}&apikey=${apiKey}`;

    axios
        .get(endpoint)
        .then((response) => {
            const data = response.data;

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
async function getContractCodeEtherscan(firstRun, chosenContract){
    const axios = require('axios');
    const apiKey = 'I81RM42RCBH3HIC9YEK1GX6KYQ12U73K1C';
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
                for(const contract in jsonCode){
                    let actualContract = 'contract' + i;
                    let code = jsonCode[contract].content;
                    input.sources[contract] = {}
                        input.sources[contract].content = code
                        if(firstRun){
                           fs.writeFileSync('smartContracts/' + actualContract, JSON.stringify(code));
                        }
                        i++;

                        buffer += code
                }
                if(firstRun){
                    fs.writeFileSync('abiEtherscan.json', data.result[0].ABI);
                }
                console.log(input);
                const output = JSON.parse(solc.compile(JSON.stringify(input)));
               // console.log(output);
                //fs.writeFileSync('solcOutput', output);
                for(const contract in output.contracts){
                   let contractname = Object.keys(output.contracts[contract])[0];
                   if(contractname.includes(chosenContract)){
                       //console.log(output.contracts[contract][contractname]);
                       generalStorageLayout = output.contracts[contract][contractname].storageLayout;;
                   }
                }
               // getAllTransactions()
            } else {
                console.error('Error: Unable to retrieve transactions.');
            }
        })
        .catch((error) => {
            console.error(`An error occurred: ${error}`);
        });
}
getContractCodeEtherscan(false, 'CakeOFT')

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

