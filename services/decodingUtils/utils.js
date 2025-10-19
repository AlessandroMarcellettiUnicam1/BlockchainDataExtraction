const InputDataDecoder = require('ethereum-input-data-decoder');
const { searchAbi}= require('../../query/query')
const { Web3 } = require('web3');
const axios = require("axios");
const {saveAbi}= require("../../databaseStore")
/**
 * Decodes the input data of all transactions using the contract ABI.
 *
 * @param {Array} contractTransactions - List of contract transactions.
 */
function decodeTransactionInputs(tx,contractAbi,web3) {
    let decoder=null;
    try{
        decoder = new InputDataDecoder(contractAbi);
        tx.inputDecoded = decoder.decodeData(tx.input);
    }finally{
        decoder=null;
    }
}


/**
 * 
 * @param {*} transactionHash 
 * @param {*} block 
 * @param {*} contractAddress 
 * @param {*} web3 
 * @param {*} contractAbi 
 * @returns 
 */
async function getEvents(transactionHash, block, contractAddress,web3,contractAbi) {
    let myContract = new web3.eth.Contract(JSON.parse(contractAbi), contractAddress);
    let filteredEvents = [];
    const pastEvents = await myContract.getPastEvents("allEvents", {fromBlock: block, toBlock: block});
    myContract=null;
    pastEvents.forEach((element)=>{
        if(transactionHash==element.transactionHash){
                for (const value in element.returnValues) {
                    if (typeof element.returnValues[value] === "bigint") {
                        element.returnValues[value] = Number(element.returnValues[value]);
                    }
                }
                const event = {
                    eventName: element.event,
                    eventValues: element.returnValues
                };
                filteredEvents.push(event);
        }
    })
    return filteredEvents;
}

/**
 * 
 * @param {*} transactionHash 
 * @param {*} block 
 * @param {*} contractAddress 
 * @param {*} networkData 
 * @param {*} web3 
 * @returns 
 */
async function getEventsFromInternal(transactionHash,block,contractAddress,networkData,web3){
    let filteredEvents = [];
    let query = { contractAddress: contractAddress };
    let response = await searchAbi(query);
    if(!(response && !response.abi.includes("Contract source code not verified"))){
        response = await handleAbiFetch(contractAddress,networkData.apiKey,networkData.endpoint)
    }
    if(response && !response.abi.includes("Contract source code not verified")){
        let abiFromDb = JSON.parse(response.abi);
        let internalContract= new web3.eth.Contract(abiFromDb, contractAddress);
        const pastEvents=await internalContract.getPastEvents("allEvents", {fromBlock: block, toBlock: block});
        myContract=null;
        pastEvents.forEach((element)=>{
            if(transactionHash==element.transactionHash){
                    for (const value in element.returnValues) {
                        if (typeof element.returnValues[value] === "bigint") {
                            element.returnValues[value] = Number(element.returnValues[value]);
                        }
                    }
                    const event = {
                        eventName: element.event,
                        eventValues: element.returnValues
                    };
                    filteredEvents.push(event);
            }
        })
    }
  
    return filteredEvents;
}
async function handleAbiFetch(addressTo, apiKey, endpoint) {
    let success = false;
    while (!success) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        let callForAbi = await axios.get(`${endpoint}&module=contract&action=getsourcecode&address=${addressTo}&apikey=${apiKey}`);
        if(callForAbi.data.result[0].Proxy==1){
           addressTo= callForAbi.data.result[0].Implementation;
        }else if(callForAbi.data.result[0].SimilarMatch){
            addressTo=callForAbi.data.result[0].SimilarMatch;
        }else if(!callForAbi.data.message.includes("NOTOK")) {
            let storeAbi = {
                contractName: callForAbi.data.result[0].ContractName,
                contractAddress: addressTo,
                abi: callForAbi.data.result[0].ABI,
            };
            await saveAbi(storeAbi);

            if (!storeAbi.abi.includes("Contract source code not verified")) {
                return storeAbi;
            } else {
                
            }
            success = true;
        }
    }
}
/**
 * 
 * @param {*} transactionHash 
 * @param {*} block 
 * @param {*} internalTxs 
 * @param {*} extractionType 
 * @param {*} networkData 
 * @param {*} web3 
 * @returns 
 */
async function iterateInternalForEvent(transactionHash,block,internalTxs,extractionType,networkData,web3){
    let filteredEvents=[];
    let flattenInternalTransaction=internalTxs;
    if(extractionType==2){
        flattenInternalTransaction=flattenInternalTransactions(internalTxs,transactionHash);
    }
    for (const element of flattenInternalTransaction) {
            let eventsFromInternal = await getEventsFromInternal(transactionHash, block, extractionType==2?element["contractAddress"]:element["to"], networkData,web3);
            for (const ev of eventsFromInternal) {
                   if(!safeCheck(filteredEvents,ev)) filteredEvents.push(ev)
            }
    }
    return filteredEvents;
}
function flattenInternalTransactions(transactions,txHash){
    if(!Array.isArray(transactions) || transactions.length===0){
        return [];
    }
    let i = 0;
    let result = [];
    result = result.concat(transactions);
    for(const transaction of transactions) {
        result = result.concat(flattenInternalTransactions(transaction.calls,txHash));
    }

      return result.map(item=>changeKey(item,"to","contractAddress")).
                    map(item=>changeKey(item,"from","sender"));
}
function changeKey(obj, oldKey, newKey){
    if(obj.hasOwnProperty(oldKey)){
        obj[newKey] = obj[oldKey];
        delete obj[oldKey];
    }
    return obj;
}
function safeCheck(arr, ev) {
  try {
    return checkIfEventIsAlreadyStored(arr, ev);
  } catch {
    console.log("Event to large to check ")
    return false; 
  }
}
function checkIfEventIsAlreadyStored(events, eventToCheck) {

  return events.some(el => JSON.stringify(el) === JSON.stringify(eventToCheck));
}

/**
 * Decodes transaction inputs into a structured format.
 *
 * @param {Object} inputDecoded - The decoded input data.
 * @returns {Array} - The decoded inputs.
 */
function decodeInputs(inputDecoded,web3) {
    return inputDecoded.inputs.map((input, i) => {
        const inputName = Array.isArray(inputDecoded.names[i]) ? inputDecoded.names[i].toString() : inputDecoded.names[i];
        if (Array.isArray(input)) {
            const bufferTuple = input.map((val, z) => decodeInput(inputDecoded.types[i].split(",")[z] || inputDecoded.types[i], val,web3));
            return { inputName, type: inputDecoded.types[i], inputValue: bufferTuple.toString() };
        } else {
            return { inputName, type: inputDecoded.types[i], inputValue: decodeInput(inputDecoded.types[i], input,web3) };
        }
    });
}
function decodeInput(type, value,web3) {
    if (type === 'uint256') {
        return Number(web3.utils.hexToNumber(value._hex));
    } else if (type === 'string') {
        return value;
    } else if (type && type.includes("byte")) {
        return value;
    } else if (type && type.includes("address")) {
        return value;
    } else {
        return value;
    }
}

module.exports={
    decodeTransactionInputs,
    getEvents,
    iterateInternalForEvent,
    decodeInputs,
    checkIfEventIsAlreadyStored,
    safeCheck
}