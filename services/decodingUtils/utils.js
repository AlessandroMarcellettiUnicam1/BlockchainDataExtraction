const InputDataDecoder = require('ethereum-input-data-decoder');
const { searchAbi}= require('../../query/query')
const { Web3 } = require('web3');
const axios = require("axios");
const {saveAbi}= require("../../databaseStore")
const hre = require("hardhat");
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

//TODO basta che giro per gli address dei contratti una volta sola che tanto con il metodo get event prendo tutti gli eventi generati in quella trasazione

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
                    eventValues: element.returnValues,
                    eventFrom:contractAddress.toLowerCase(),
                    eventSignature:element.logIndex.toString()
                };
                filteredEvents.push(event);
        }
    })
    return filteredEvents;
}

async function getEventFromErigon(transactionHash,networkData){
    const body = {
    jsonrpc: "2.0",
    method: "eth_getTransactionReceipt",
    params: [transactionHash],
    id: 1
  };
  try {
    const response = await fetch(networkData.web3Endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    return data.result.logs; 
  } catch (err) {
    console.error("Error fetching transaction receipt:", err);
    throw err;
  }
}
/**
 * 
 * @param {*} transactionHash 
 * @param {*} networkData 
 * @param {*} hardhat 
 * @returns 
 */
async function getEventFromHardHat(transactionHash,networkData,hardhat,blockNumber){
    // Use the same provider that Hardhat uses
    await hre.changeNetwork(networkData.networkName, blockNumber)
    // Get the transaction receipt (same as eth_getTransactionReceipt)
    const receipt = await hre.network.provider.send("eth_getTransactionReceipt", [transactionHash]);
    return receipt.logs;
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
async function getEventsFromInternal(transactionHash, block, contractAddress, networkData, web3) {
  let filteredEvents = [];
  let targetAbi;
  let targetAddress = contractAddress;
  // Fetch ABI
  let proxyInfo = await searchAbi({ contractAddress });
  if (!proxyInfo) {
    proxyInfo = { abi: await handleAbiFetch(contractAddress, networkData.apiKey, networkData.endpoint) };
  }
  let implInfo;
  // Handle proxy logic
  if (proxyInfo.proxy === '1' && proxyInfo.proxyImplementation) {
    implInfo = await searchAbi({ contractAddress: proxyInfo.proxyImplementation });
    if (implInfo && implInfo.abi && !implInfo.abi.includes("Contract source code not verified")) {
      targetAbi = JSON.parse(implInfo.abi);
    }
  } else if (proxyInfo && proxyInfo.abi && !proxyInfo.abi.includes("Contract source code not verified")) {
    targetAbi = JSON.parse(proxyInfo.abi);
  }

  if (!targetAbi) return [];

  // Decode events
  const contract = new web3.eth.Contract(targetAbi, targetAddress);
  const pastEvents = await contract.getPastEvents("allEvents", { fromBlock: block, toBlock: block });

  for (const e of pastEvents) {
    if (e.transactionHash === transactionHash && e.event) {
      const eventValues = Object.fromEntries(
        Object.entries(e.returnValues).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])
      );
      if(e.event){
        filteredEvents.push({
            eventName: e.event,
            eventValues,
            eventFrom: contractAddress.toLowerCase(),
            eventSignature: e.logIndex.toString(),
            });
        }
    }
  }

  return filteredEvents;
}
/**
 * 
 * @param {*} addressTo 
 * @param {*} apiKey 
 * @param {*} endpoint 
 * @returns 
 */
async function handleAbiFetch(addressTo, apiKey, endpoint) {
   
    const callForAbi = await axios.get(
        `${endpoint}&module=contract&action=getsourcecode&address=${addressTo}&apikey=${apiKey}`
    );
    const storeAbi = {
        contractName: callForAbi.data.result[0].ContractName,
        abi: callForAbi.data.result[0].ABI,
        proxy: callForAbi.data.result[0].Proxy,
        proxyImplementation: '',
        contractAddress: addressTo,
        compilerVersion:callForAbi.data.result[0].CompilerVersion,
        sourceCode:callForAbi.data.result[0].SourceCode
    }
    if (!callForAbi.data.message.includes("NOTOK")) {
        await saveAbi(storeAbi);
    }
    return storeAbi.abi
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
async function iterateInternalForEvent(transactionHash, block, internalTxs, option, networkData, web3) {
    let eventArray = [];
    if (option.internalTransaction == 1) {
        let resultEvents=[];
        await assignEventToInternal(transactionHash, block, internalTxs, networkData, web3, resultEvents);
        if (resultEvents.length > 0) {
            resultEvents.forEach(ele => {
                eventArray.push(ele);
            })
        }

    } else {
        for (const element of internalTxs) {
            let resultEvents = await getEventsFromInternal(transactionHash, block, option.internalTransaction == 1 ? element["contractAddress"] : element["to"], networkData, web3);
            if (resultEvents.length > 0) {
                resultEvents.forEach(ele => {
                    eventArray.push(ele);
                })

            }
        }
    }
    return eventArray;
}

/**
 * 
 * @param {*} transactionHash 
 * @param {*} block 
 * @param {*} internalTxs 
 * @param {*} networkData 
 * @param {*} web3 
 */
async function assignEventToInternal(transactionHash, block, internalTxs, networkData, web3, resultEvents) {
    for (const transaction of internalTxs) {
        let eventFromInternalContract = await getEventsFromInternal(transactionHash, block, transaction.to, networkData, web3);
        if (eventFromInternalContract.length == 0) {
            eventFromInternalContract = await getEventsFromInternal(transactionHash, block, transaction.from, networkData, web3);
        }
        eventFromInternalContract.forEach((event)=>{
            resultEvents.push(event)
        })
        if (transaction.calls) {
            await assignEventToInternal(transactionHash, block, transaction.calls, networkData, web3, resultEvents);
        }
    }
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
  return events.some(el => deepEqual(el,eventToCheck));
}
function deepEqual(a, b, seen = new WeakMap()) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a == null || b == null) return false;

  if (seen.has(a)) return seen.get(a) === b;
  seen.set(a, b);

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual(a[key], b[key], seen)) return false;
  }
  return true;
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
    safeCheck,
    getEventFromErigon,
    getEventFromHardHat,
    getEventsFromInternal,
}