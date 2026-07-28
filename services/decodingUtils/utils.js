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

function parseAbiSafely(abi) {
    if (!abi || abi === "[]" || (typeof abi === "string" && abi.includes("Contract source code not verified"))) return null;
    if (Array.isArray(abi)) return abi;
    try {
        return JSON.parse(abi);
    } catch (err) {
        console.log("ABI parse failed for event decoding: " + err.message);
        return null;
    }
}

function normalizeEventValues(values) {
    return Object.fromEntries(
        Object.entries(values || {})
            .filter(([key]) => key !== "__length__" && Number.isNaN(Number(key)))
            .map(([key, value]) => [key, typeof value === "bigint" ? Number(value) : value])
    );
}

function getEventSignature(web3, eventAbi) {
    const signature = `${eventAbi.name}(${eventAbi.inputs.map((input) => input.type).join(",")})`;
    return web3.utils.sha3(signature);
}

function hasUsableAbiForEvents(abi) {
    return !!parseAbiSafely(abi);
}

function getProxyImplementationAddress(contractData) {
    return (
        contractData?.proxyImplementation ||
        contractData?.Implementation ||
        contractData?.implementation ||
        ""
    ).toLowerCase();
}

async function decodeReceiptEventsForAddress(transactionHash, contractAddress, abi, networkData, web3) {
    const targetAbi = parseAbiSafely(abi);
    if (!targetAbi) return [];

    const receiptLogs = await getEventFromErigon(transactionHash, networkData);
    const eventByTopic = new Map(
        targetAbi
            .filter((item) => item.type === "event" && !item.anonymous)
            .map((eventAbi) => [getEventSignature(web3, eventAbi), eventAbi])
    );
    const normalizedAddress = contractAddress.toLowerCase();
    const decodedEvents = [];

    for (const log of receiptLogs || []) {
        if (log.address?.toLowerCase() !== normalizedAddress) continue;
        const topic0 = log.topics?.[0];
        const eventAbi = eventByTopic.get(topic0);
        if (!eventAbi) continue;
        try {
            const decoded = web3.eth.abi.decodeLog(eventAbi.inputs, log.data || "0x", log.topics.slice(1));
            decodedEvents.push({
                eventName: eventAbi.name,
                eventValues: normalizeEventValues(decoded),
                eventFrom: normalizedAddress,
                eventSignature: web3.utils.hexToNumber(log.logIndex).toString()
            });
        } catch (err) {
            console.log("Receipt event decode failed: " + err.message);
        }
    }

    return decodedEvents;
}
async function getEvents(transactionHash, block, contractAddress, web3, contractAbi, networkData) {
    if (networkData?.web3Endpoint) {
        const decodedReceiptEvents = await decodeReceiptEventsForAddress(transactionHash, contractAddress, contractAbi, networkData, web3);
        if (decodedReceiptEvents.length > 0) return decodedReceiptEvents;
    }

    const parsedAbi = parseAbiSafely(contractAbi);
    if (!parsedAbi) return [];

    let myContract = new web3.eth.Contract(parsedAbi, contractAddress);
    let filteredEvents = [];
    const pastEvents = await myContract.getPastEvents("allEvents", {fromBlock: block, toBlock: block});
    myContract=null;
    pastEvents.forEach((element)=>{
        if(transactionHash==element.transactionHash && element.event){
                const event = {
                    eventName: element.event,
                    eventValues: normalizeEventValues(element.returnValues),
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
  if (!contractAddress) return [];
  const normalizedAddress = contractAddress.toLowerCase();
  let proxyInfo = await searchAbi({ contractAddress: normalizedAddress });
  if (!proxyInfo) {
    proxyInfo = await handleAbiFetch(normalizedAddress, networkData.apiKey, networkData.endpoint);
  }

  let targetAbi = proxyInfo?.abi;
  let implementationAddress = getProxyImplementationAddress(proxyInfo);

  if (proxyInfo?.proxy === '1' && !implementationAddress) {
    const refreshedProxyInfo = await handleAbiFetch(normalizedAddress, networkData.apiKey, networkData.endpoint);
    implementationAddress = getProxyImplementationAddress(refreshedProxyInfo);
    targetAbi = refreshedProxyInfo?.abi || targetAbi;
  }

  if (proxyInfo?.proxy === '1' && implementationAddress) {
    let implInfo = await searchAbi({ contractAddress: implementationAddress });
    if (!implInfo || !hasUsableAbiForEvents(implInfo.abi)) {
      implInfo = await handleAbiFetch(implementationAddress, networkData.apiKey, networkData.endpoint);
    }
    if (hasUsableAbiForEvents(implInfo?.abi)) {
      targetAbi = implInfo.abi;
    }
  }

  return await decodeReceiptEventsForAddress(transactionHash, normalizedAddress, targetAbi, networkData, web3);
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
    const result = callForAbi.data.result?.[0] || {};
    const storeAbi = {
        contractName: result.ContractName,
        abi: result.ABI,
        proxy: result.Proxy,
        proxyImplementation: result.Implementation || '',
        contractAddress: addressTo.toLowerCase(),
        compilerVersion: result.CompilerVersion,
        sourceCode: result.SourceCode
    }
    if (!callForAbi.data.message.includes("NOTOK")) {
        await saveAbi(storeAbi);
    }
    return storeAbi;
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
function decodeInput(type, value, web3) {
    if (value == null) return value;

    if (type === 'uint256') {
        try {
            if (value._hex) {
                return Number(web3.utils.hexToNumber(value._hex));
            } 
            else if (typeof value === 'string' && value.startsWith('0x')) {
                return Number(web3.utils.hexToNumber(value));
            } 
            else {
                return Number(value);
            }
        } catch (e) {
            console.warn(`[decodeInput] Fallita decodifica uint256 per il valore:`, value);
            return 0; // Fallback per non far crashare l'estrattore
        }
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

