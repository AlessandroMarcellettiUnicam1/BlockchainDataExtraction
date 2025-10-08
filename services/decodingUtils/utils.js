const InputDataDecoder = require('ethereum-input-data-decoder');
const { searchAbi}= require('../../query/query')
const { Web3 } = require('web3');
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
 * Method used to retrieve the emitted events in the transaction block, using web3.js.
 *
 * @param transactionHash - the hash of the transaction to get the events
 * @param block - the block number of the transaction
 * @param contractAddress - the address of the contract to get the events
 * @returns {Promise<*[]>} - the events emitted by the transaction
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


async function getEventsFromInternal(transactionHash,block,contractAddress,networkName,web3){
    let filteredEvents = [];
    let query = { contractAddress: contractAddress.toLowerCase() };
    const response = await searchAbi(query);
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

async function iterateInternalForEvent(transactionHash,block,internalTxs,extractionType,network,web3){
    let filteredEvents=[];
    let flattenInternalTransaction=internalTxs;
    if(extractionType==2){
        flattenInternalTransaction=flattenInternalTransactions(internalTxs,transactionHash);
    }
    for (const element of flattenInternalTransaction) {
                let eventsFromInternal = await getEventsFromInternal(transactionHash, block, element["contractAddress"], network,web3);
                for (const ev of eventsFromInternal) {
                    if(!checkIfEventIsAlreadyStored(filteredEvents, ev)){
                        filteredEvents.push(ev);
                    }
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
    checkIfEventIsAlreadyStored
}