const mongoose = require("mongoose");
const { connectDB } = require("../../config/db");
require("dotenv").config();
const JSONStream = require("JSONStream");
const { getContractTree } = require("../contractUtils/utils");
// Import necessary modules that were missing
const { Web3, net } = require("web3");
const hre = require("hardhat");
const InputDataDecoder = require("ethereum-input-data-decoder");
const axios = require("axios");
const {
  decodeInternalTransaction,
  newDecodedInternalTransaction,
} = require("../decodeInternalTransaction");
const { optimizedDecodeValues } = require("../optimizedDecodeValues");
const { saveTransaction } = require("../../databaseStore");
const { searchAbi } = require("../../query/query");
const { saveAbi } = require("../../databaseStore");
const {
  decodeTransactionInputs,
  getEvents,
  iterateInternalForEvent,
  decodeInputs,
  getEventFromErigon,
  getEventsFromInternal,
  getEventFromHardHat,
} = require("../decodingUtils/utils");

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

BigInt.prototype.toJSON = function () {
  return this.toString();
};

/**
 *
 * @param {*} tx
 * @param {*} mainContract
 * @param {*} contractTree
 * @param {*} contractAddress
 * @param {*} smartContract
 * @param {*} extractionType
 * @param {*} option
 * @param {*} networkData
 * @returns
 */
async function processTransaction(
  tx,
  mainContract,
  contractTree,
  contractAddress,
  smartContract,
  extractionType,
  option,
  networkData,
  addressRange,
  returnInMemory = false,
) {
  decodeInput(tx, contractTree);
  try {
    console.log(`Processing transaction: ${tx.hash}`);
    const result = await createTransactionLog(
      tx,
      mainContract,
      contractTree,
      smartContract,
      extractionType,
      contractAddress,
      networkData,
      option,
      addressRange,
    );

    return {
      log: returnInMemory ? result.log : null,
      metrics: result.metrics,
    };
  } finally {
    if (global.gc) global.gc();
  }
}

/**
 * Function used to decode the input and the methd name of a public trasaction
 * If the input is equal to "0x" means that it is a Transfer
 * @param {*} tx
 * @param {*} contractTree
 */
function decodeInput(tx, contractTree) {
  if (tx.input == "0x") {
    tx.methodId = "Transfer";
  } else if (
    contractTree?.contractAbi &&
    (typeof contractTree.contractAbi !== "object" ||
      Object.keys(contractTree.contractAbi).length > 0)
  ) {
    decodeTransactionInputs(tx, contractTree.contractAbi);
  }
}

/**
 * This method involves the debugging of the transaction to extract the storage state.
 * The debugging is handled by the Hardhat environment configured in the file "hardhat.config.js"
 *
 * @param transactionHash - the transaction hash to be debugged
 * @param blockNumber - the block number where the transaction is stored
 * @returns {Promise<{requiredTime: number, response: any}>} - the response of the debugged transaction and the required time to debug it
 */
async function debugTransaction(transactionHash, blockNumber, networkData) {
  let response = null;
  try {
    const start = performance.now();
    if (hre.config.networks[networkData.networkName.toLowerCase()]) {
      hre.config.networks[networkData.networkName.toLowerCase()].url =
        networkData.web3Endpoint;
    }
    hre.config.networks.hardhat.forking.url = networkData.web3Endpoint;
    await hre.changeNetwork(networkData.networkName, blockNumber);
    response = await hre.network.provider.send("debug_traceTransaction", [
      transactionHash,
    ]);
    const end = performance.now();
    const requiredTime = parseFloat(((end - start) / 1000).toFixed(2));
    return { response, requiredTime };
  } catch (err) {
    console.error(err);
    throw new Error(err.message);
  } finally {
    // No hardhat_reset here anymore

    if (global.gc) global.gc();
  }
}

// Modified to return a readable stream instead of writing to file
function debugTransactionErigonStreaming(transactionHash, erigonUrl) {
  return new Promise((resolve, reject) => {
    const start = new Date();

    makeRpcCallStreaming(erigonUrl, "debug_traceTransaction", [transactionHash])
      .then((stream) => {
        const end = new Date();
        const requiredTime = parseFloat(((end - start) / 1000).toFixed(2));
        resolve({ requiredTime, stream });
      })
      .catch(reject);
  });
}

// Modified to return stream instead of writing to file
function makeRpcCallStreaming(url, method, params) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === "https:";
    const client = isHttps ? https : http;

    const payload = JSON.stringify({
      jsonrpc: "2.0",
      method: method,
      params: params,
      id: 1,
    });

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
      timeout: 300000,
    };

    const req = client.request(options, (res) => {
      // Return the response stream directly
      resolve(res);
    });

    req.on("error", (err) => {
      reject(new Error(`Request failed: ${err.message}`));
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    req.write(payload);
    req.end();
  });
}

/**
 *
 * @param {*} tx
 * @param {*} mainContract
 * @param {*} contractTree
 * @param {*} smartContract
 * @param {*} extractionType
 * @param {*} contractAddress
 * @param {*} networkData
 * @param {*} option
 * @returns
 */
async function createTransactionLog(
  tx,
  mainContract,
  contractTree,
  smartContract,
  extractionType,
  contractAddress,
  option,
  networkData,
  addressRange,
) {
  const localMetrics = {
    time_debugErigon: 0,
    time_traceStorageErigon: 0,
    time_debugStandard: 0,
    time_traceStorageStandard: 0,
    time_getEvents: 0,

    time_processTraceErigon: 0,
    time_optimizedDecodeValuesErigon: 0,
    time_decodeInternalTransactionErigon: 0,
    time_newDecodedInternalTransactioneErigon: 0,
    time_assignStorageToTheInternalErigon: 0,
    time_decodeInternalTxsStorageErigon: 0,

    time_processTraceStandard: 0,
    time_optimizedDecodeValuesStandard: 0,
  };

  let web3 = new Web3(networkData.web3Endpoint);
  if (tx.timestamp && tx.timestamp.includes("0x")) {
    tx.timeStamp = web3.utils.hexToNumber(tx.timestamp);
  } else if (tx.timestamp) {
    tx.timeStamp = Number(tx.timestamp);
  }
  let transactionLog = {
    functionName: tx.inputDecoded ? tx.inputDecoded.method : tx.methodId,
    transactionHash: tx.hash,
    blockNumber: parseInt(tx.blockNumber),
    contractAddress: tx.to,
    sender: tx.from,
    gasUsed: parseInt(tx.gasUsed),
    timestamp: tx.timeStamp
      ? new Date(tx.timeStamp * 1000).toISOString()
      : new Date().toISOString(),
    inputs: tx.inputDecoded ? decodeInputs(tx.inputDecoded, web3) : [],
    value: tx.value,
    storageState: [],
    internalTxs: [],
    events: [],
  };
  let storageVal = null;
  let debugResult = null;
  try {
    if (option.default != 0) {
      //if the internal transaction are extende menaning that I can use a node
      if (option.internalTransaction == 1) {
        const t1 = performance.now();
        console.log(
          `[${new Date().toISOString()}, DEBUG-1] Inizio richiesta streaming al nodo per TX: ${tx.hash}`,
        );
        const { stream, requiredTime } = await debugTransactionErigonStreaming(
          tx.hash,
          networkData.web3Endpoint,
        );
        console.log(
          `[${new Date().toISOString()}, DEBUG-2] Stream ricevuto dal nodo per TX: ${tx.hash}`,
        );
        localMetrics.time_debugErigon = parseFloat(
          (performance.now() - t1).toFixed(3),
        );
        // Capture time after launching the worker
        // Log the timing data to CSV
        try {
          const t2 = performance.now();
          console.log(
            `[${new Date().toISOString()}, DEBUG-INTERNAL-3] Inizio parsing dello stream (getTraceStorage...) per TX: ${tx.hash}`,
          );
          storageVal = await getTraceStorageFromErigon(
            stream,
            networkData,
            tx.inputDecoded ? tx.inputDecoded.method : null,
            tx.hash,
            mainContract,
            contractTree,
            smartContract,
            option,
            web3,
            transactionLog.blockNumber,
            localMetrics,
          );
          console.log(
            `[${new Date().toISOString()}, DEBUG-INTERNAL-4] Parsing stream completato con successo per TX: ${tx.hash}`,
          );
          localMetrics.time_traceStorageErigon = parseFloat(
            (performance.now() - t2).toFixed(3),
          );
          //storageVal.internalTxs=await newDecodedInternalTransaction(transactionLog.transactionHash, smartContract, networkData, web3);
        } catch (err) {
          console.log(err);
        }
      } else {
        const t3 = performance.now();
        console.log(
          `[${new Date().toISOString()}, DEBUG-1] Inizio richiesta streaming al nodo per TX: ${tx.hash}`,
        );
        const { stream, requiredTime } = await debugTransactionErigonStreaming(
          tx.hash,
          networkData.web3Endpoint,
        );
        console.log(
          `[${new Date().toISOString()}, DEBUG-2] Stream ricevuto dal nodo per TX: ${tx.hash}`,
        );
        localMetrics.time_debugStandard = parseFloat(
          (performance.now() - t3).toFixed(3),
        );
        try {
          const t4 = performance.now();
          console.log(
            `[${new Date().toISOString()}, DEBUG-PARTIAL-3] Inizio parsing dello stream (getTraceStorage...) per TX: ${tx.hash}`,
          );
          storageVal = await getTraceStoragePartial(
            stream,
            networkData,
            tx.inputDecoded ? tx.inputDecoded.method : null,
            tx.hash,
            mainContract,
            contractTree,
            smartContract,
            option,
            web3,
            transactionLog.blockNumber,
            localMetrics,
          );
          console.log(
            `[${new Date().toISOString()} DEBUG-PARTIAL-4] Parsing stream completato con successo per TX: ${tx.hash}`,
          );
          localMetrics.time_traceStorageStandard = parseFloat(
            (performance.now() - t4).toFixed(3),
          );
        } catch (err) {
          console.log(err);
        }
      }
      transactionLog.storageState = storageVal ? storageVal.decodedValues : [];
      transactionLog.internalTxs = storageVal ? storageVal.internalTxs : [];
      let storeAbi = {
        contractName: contractTree?.contractName,
        abi: contractTree?.contractAbi,
        proxy: contractTree?.proxy,
        proxyImplementation: "",
        contractAddress: tx?.to,
        sourceCode: contractTree?.sourceCode,
        compilerVersion: contractTree.compilerVersion || "unknown",
      };
      transactionLog.finalShaTraces = undefined;
      transactionLog.functionStorage = undefined;
      //forse a questo punto basta controllare solo se il contratto è un proxy o no
      if (
        transactionLog.functionName == null &&
        transactionLog.internalTxs &&
        transactionLog.internalTxs.length > 0
      ) {
        if (transactionLog.internalTxs[0].type == "DELEGATECALL") {
          const addressTo = transactionLog.internalTxs[0].to;
          const query = { contractAddress: addressTo.toLowerCase() };
          const response = await searchAbi(query);
          if (response) {
            if (contractTree) {
              storeAbi.proxy = "1";
              storeAbi.proxyImplementation = query.contractAddress;
            }
            try {
              const decoder = new InputDataDecoder(response.abi);
              const inputData = tx.input;
              const tempResult = decoder.decodeData(inputData);
              transactionLog.functionName = tempResult.method;
              if (transactionLog.inputs.length < 1) {
                transactionLog.inputs = tempResult.inputs.map((input, i) => {
                  let value = input;
                  if (input._isBigNumber) {
                    value = Number(web3.utils.hexToNumber(input._hex));
                  }
                  return {
                    inputName: tempResult.names[i],
                    type: tempResult.types[i],
                    inputValue: value,
                  };
                });
              }
            } catch (err) {
              console.log("errr" + err);
            }
            // const decoder = new InputDataDecoder(response.abi);
          }
        }
      }
      if (contractTree) {
        await saveAbi(storeAbi);
      }
    }
    //TODO: tempo eventi
    const t5 = performance.now();
    console.log(
      `[${new Date().toISOString()}, DEBUG-5] Inizio recupero eventi (getEventForTransaction)...`,
    );
    await getEventForTransaction(
      transactionLog,
      tx.hash,
      Number(tx.blockNumber),
      contractAddress,
      web3,
      contractTree,
      option,
      networkData,
    );
    console.log(
      `[${new Date().toISOString()}, DEBUG-6] Eventi recuperati (getEventForTransaction)...`,
    );
    localMetrics.time_getEvents = parseFloat(
      (performance.now() - t5).toFixed(3),
    );
    if (addressRange && addressRange.length > 1) {
      let collectionName = "";
      for (let i = 0; i < addressRange.length; i++) {
        collectionName += addressRange[i].substring(0, 5).toLowerCase();
      }
      await saveTransaction(transactionLog, collectionName);
    } else if (addressRange && addressRange.length == 1) {
      await saveTransaction(transactionLog, addressRange[0].toLowerCase());
    } else {
      await saveTransaction(transactionLog, tx.to != "" ? tx.to : tx.from);
    }

    console.log(`[DEBUG-7] Ritorno del transaction log`);
    return { log: transactionLog, metrics: localMetrics };
  } finally {
    if (debugResult) {
      if (debugResult.response && debugResult.response.structLogs) {
        debugResult.response.structLogs = null;
      }
      debugResult.response = null;
      debugResult = null;
    }

    if (storageVal) {
      storageVal.decodedValues = null;
      storageVal.internalTxs = null;
      storageVal = null;
    }
    transactionLog = null;
  }
}

/**
 * function to get the event emitted in t
 * @param {*} transactionLog : is the log tha we have to store in the db
 * @param {*} hash : has of the transaction
 * @param {*} blockNumber : block number to get the event emitted
 * @param {*} contractAddress : the address of the contract
 * @param {*} web3 : we3 instances
 * @param {*} contractTree : object contract tree that contain the abi
 * @param {*} extractionType : the extraction type
 * @param {*} networkData : object representing the network data ( apiKey,endPoint, networkName,web3Endpoint)
 */
async function getEventForTransaction(
  transactionLog,
  hash,
  blockNumber,
  contractAddress,
  web3,
  contractTree,
  option,
  networkData,
) {
  if (option.default != 0) {
    const duplicateEvents = process.env.DUPLICATE_EVENTS == "false";
    let seenEvent = new Set();
    if (transactionLog.internalTxs && duplicateEvents) {
      searchEventInInternal(transactionLog.internalTxs, seenEvent);
    }

    if (
      contractTree &&
      contractTree.contractAbi &&
      Object.keys(contractTree.contractAbi).length !== 0
    ) {
      let publicEvents = await getEvents(
        hash,
        blockNumber,
        contractAddress,
        web3,
        contractTree.contractAbi,
      );
      publicEvents.forEach((ele) => {
        if (!seenEvent.has(ele.eventSignature)) {
          transactionLog.events.push(ele);
          seenEvent.add(ele.eventSignature);
        }
      });
    }
    //if to get the event from internal transaction
    if (transactionLog.internalTxs && transactionLog.internalTxs.length > 0) {
      let internalEvents = await iterateInternalForEvent(
        hash,
        blockNumber,
        transactionLog.internalTxs,
        option,
        networkData,
        web3,
      );
      internalEvents.forEach((ele) => {
        if (!seenEvent.has(ele.eventSignature)) {
          //The negation of the flag because if we choose to duplicate the event so we se the flag to true in the
          //env when we declare the variable we check if the flag is equal to false( standar case)
          if (!duplicateEvents) {
            transactionLog.events.push(ele);
          }
          seenEvent.add(ele.eventSignature);
        }
      });
      // commented code for using hard hat
      let allEventsFromReceipt =
        //option.internalTransaction == 1
        await getEventFromErigon(transactionLog.transactionHash, networkData);
      //: await getEventFromHardHat(transactionLog.transactionHash, networkData, hre,blockNumber);
      if (allEventsFromReceipt.length > 0) {
        for (const ele of allEventsFromReceipt) {
          let logIndex = web3.utils.hexToNumber(ele.logIndex).toString();
          if (!seenEvent.has(logIndex)) {
            let eventMissing = await getEventsFromInternal(
              transactionLog.transactionHash,
              blockNumber,
              ele.address.toLowerCase(),
              networkData,
              web3,
            );
            if (eventMissing.length > 0) {
              let flag = true;
              eventMissing.forEach((event) => {
                if (!seenEvent.has(event.eventSignature)) {
                  flag = false;
                  transactionLog.events.push(event);
                  seenEvent.add(event.eventSignature);
                }
              });
              if (flag) {
                transactionLog.events.push({
                  eventName: "undefined",
                  eventValues: ele.topics,
                  eventFrom: ele.address.toLowerCase(),
                });
                seenEvent.add(logIndex);
              }
            } else {
              transactionLog.events.push({
                eventName: "undefined",
                eventValues: ele.topics,
                eventFrom: ele.address.toLowerCase(),
              });
              seenEvent.add(logIndex);
            }
          }
        }
      }
    }
  } else {
    //if to get the event form the public transaction
    let seenEvent = new Set();
    if (contractTree && Object.keys(contractTree.contractAbi).length !== 0) {
      let publicEvents = await getEvents(
        hash,
        blockNumber,
        contractAddress,
        web3,
        contractTree.contractAbi,
      );
      publicEvents.forEach((ele) => {
        if (!seenEvent.has(ele.eventSignature)) {
          transactionLog.events.push(ele);
          seenEvent.add(ele.eventSignature);
        }
      });
    }
    //if to get the event from internal transaction
    // transactionLog.internalTxs && transactionLog.internalTxs.length > 0
    // if (option.internalTransaction == 1) {
    let allEventsFromErigon = await getEventFromErigon(
      transactionLog.transactionHash,
      networkData,
    );
    for (const ele of allEventsFromErigon) {
      let logIndex = web3.utils.hexToNumber(ele.logIndex).toString();
      if (!seenEvent.has(logIndex)) {
        let result = await getEventsFromInternal(
          transactionLog.transactionHash,
          blockNumber,
          ele.address,
          networkData,
          web3,
        );
        if (result.length > 0) {
          let flag = true;
          result.forEach((event) => {
            if (!seenEvent.has(event.eventSignature)) {
              transactionLog.events.push(event);
              seenEvent.add(event.eventSignature);
              flag = false;
            }
          });
          if (flag) {
            transactionLog.events.push({
              eventName: "undefined",
              eventValues: ele.topics,
              eventFrom: ele.address.toLowerCase(),
            });
            seenEvent.add(logIndex);
          }
        } else {
          //se sono qui è perché per quell'logindex non sono riuscito a decodificare l'evento
          transactionLog.events.push({
            eventName: "undefined",
            eventValues: ele.topics,
            eventFrom: ele.address.toLowerCase(),
          });
          seenEvent.add(logIndex);
        }
      }
    }
    // } else {
    //     let allEventsFromErigon = await getEventFromHardHat(transactionLog.transactionHash, networkData, hre,blockNumber)
    //     for (const ele of allEventsFromErigon) {
    //         let logIndex = web3.utils.hexToNumber(ele.logIndex).toString();
    //         if (!seenEvent.has(logIndex)) {
    //             let result = await getEventsFromInternal(transactionLog.transactionHash, blockNumber, ele.address, networkData, web3);
    //             if(result.length==0){
    //                 result=await getEventsFromInternal(transactionLog.transactionHash, blockNumber, transactionLog.sender, networkData, web3);
    //             }
    //             if (result.length > 0) {
    //                 let flag = true
    //                 result.forEach((event) => {
    //                     if (!seenEvent.has(event.eventSignature)) {
    //                         transactionLog.events.push(event);
    //                         seenEvent.add(event.eventSignature)
    //                         flag = false;
    //                     }
    //                 })
    //                 if (flag) {
    //                     transactionLog.events.push({
    //                         eventName: "undefined",
    //                         eventValues: ele.topics,
    //                         eventFrom: ele.address.toLowerCase(),
    //                     })
    //                     seenEvent.add(logIndex)
    //                 }
    //             } else {
    //                 transactionLog.events.push({
    //                     eventName: "undefined",
    //                     eventValues: ele.topics,
    //                     eventFrom: ele.address.toLowerCase(),
    //                 })
    //                 seenEvent.add(logIndex)
    //             }
    //         }
    //     }
    // }
  }
}

function searchEventInInternal(internals, seenEvent) {
  for (const internal of internals) {
    internal.events?.forEach((event) => {
      seenEvent.add(event.eventSignature);
    });

    if (internal.calls) {
      searchEventInInternal(internal.calls, seenEvent);
    }
  }
}

/**
 *
 * @param traceDebugged - the debugged transaction with its opcodes
 * @param blockNumber - the block number where the transaction is stored
 * @param functionName - the function name of the invoked method, useful to decode the storage state
 * @param transactionHash - the transaction hash used only to identify the internal transactions
 * @param mainContract - the main contract to decode, used to identify the contract variables
 * @param contractTree - the contract tree used to identify the contract variables with the 'mainContract'
 * @returns {Promise<{decodedValues: (*&{variableValue: string|string|*})[], internalCalls: *[]}>} - the decoded values of the storage state and the internal calls
 */
async function getTraceStorage(
  traceDebugged,
  networkData,
  functionName,
  transactionHash,
  mainContract,
  contractTree,
  smartContract,
  extractionOption,
  web3,
  blockNumber,
) {
  //used to store the storage changed by the function. Used to compare the generated keys
  let functionStorage = {};
  //used to store all the keys potentially related to a dynamic structure
  let index = 0;
  let trackBuffer = [];
  let bufferPC = -10;
  let sstoreBuffer = [];
  let sstoreOptimization = [];
  let internalCalls = [];
  let keccakBeforeAdd = {};
  let finalShaTraces = [];
  let tempInternalCallArray = [];
  try {
    if (traceDebugged.structLogs) {
      const CALL_OPCODES = ["CALL", "DELEGATECALL", "STATICCALL", "CALLCODE"];

      tempInternalCallArray = traceDebugged.structLogs.filter((step) =>
        CALL_OPCODES.includes(step.op),
      );

      for (const trace of traceDebugged.structLogs) {
        if (trace.op === "KECCAK256" && trace.depth == 1) {
          bufferPC = trace.pc;
          const stackLength = trace.stack.length;
          const memoryLocation = trace.stack[stackLength - 1];
          let numberLocation =
            web3.utils.hexToNumber("0x" + memoryLocation) / 32;
          let storageIndexLocation = numberLocation + 1;
          const hexKey = trace.memory[numberLocation];
          const hexStorageIndex = trace.memory[storageIndexLocation];
          trackBuffer[index] = { hexKey, hexStorageIndex };
        } else if (trace.op === "STOP" && trace.depth == 1) {
          for (const slot in trace.storage) {
            functionStorage[slot] = trace.storage[slot];
          }
        } else if (trace.pc === bufferPC + 1 && trace.depth == 1) {
          keccakBeforeAdd = trackBuffer[index];
          bufferPC = -10;
          trackBuffer[index].finalKey = trace.stack[trace.stack.length - 1];
          keccakBeforeAdd = trackBuffer[index];
          index++;
          if (
            trace.op === "ADD" &&
            (trace.stack[trace.stack.length - 1] === keccakBeforeAdd.finalKey ||
              trace.stack[trace.stack.length - 2] ===
                keccakBeforeAdd.finalKey) &&
            keccakBeforeAdd.hexStorageIndex ===
              "0000000000000000000000000000000000000000000000000000000000000000"
          ) {
            const keyBuff = trackBuffer[index - 1].hexKey;
            const slotBuff = trackBuffer[index - 1].hexStorageIndex;
            trackBuffer[index - 1].hexKey = slotBuff;
            trackBuffer[index - 1].hexStorageIndex = keyBuff;
            const nextTrace =
              traceDebugged.structLogs[
                traceDebugged.structLogs.indexOf(trace) + 1
              ];
            if (nextTrace) {
              trackBuffer[index - 1].finalKey =
                nextTrace.stack[nextTrace.stack.length - 1];
            }
            trackBuffer[index - 1].indexSum =
              trace.stack[trace.stack.length - 2];
          }
        } else if (trace.op === "SSTORE" && trace.depth == 1) {
          sstoreOptimization.push(trace.stack);
          sstoreBuffer.push(trace.stack[trace.stack.length - 1]);
        } else if (
          trace.op === "CALL" ||
          trace.op === "DELEGATECALL" ||
          trace.op === "STATICCALL"
        ) {
          const offsetBytes =
            trace.stack[
              trace.op === "CALL"
                ? trace.stack.length - 4
                : trace.stack.length - 3
            ];
          const lengthBytes =
            trace.stack[
              trace.op === "CALL"
                ? trace.stack.length - 5
                : trace.stack.length - 4
            ];
          let stringDepthConstruction = "";
          for (let i = 0; i < trace.depth - 1; i++) {
            stringDepthConstruction += "_1";
          }
          const nextTrace =
            tempInternalCallArray[tempInternalCallArray.indexOf(trace) + 1];
          let possibleImplementation;
          if (nextTrace) {
            possibleImplementation = retriveImplementationContract(
              trace,
              nextTrace,
              web3,
            );
          }
          let call = {
            callId: "0_1" + stringDepthConstruction,
            callType: trace.op,
            depth: trace.depth,
            gas: web3.utils.hexToNumber(
              "0x" + trace.stack[trace.stack.length - 1],
            ),
            to: "0x" + trace.stack[trace.stack.length - 2].slice(-40),
            inputsCall: "",
            possibleImplementation: possibleImplementation,
          };
          let stringMemory = trace.memory.join("");
          stringMemory = stringMemory.slice(
            web3.utils.hexToNumber("0x" + offsetBytes) * 2,
            web3.utils.hexToNumber("0x" + offsetBytes) * 2 +
              web3.utils.hexToNumber("0x" + lengthBytes) * 2,
          );
          call.inputsCall = stringMemory;
          internalCalls.push(call);
        }
      }
    }

    finalShaTraces = trackBuffer;
    // console.log('SSTOREBUFER',sstoreBuffer);
    // console.log('TRACK BUFFER', trackBuffer);
    // console.log('Track buffer length', trackBuffer.length);
    for (let i = 0; i < trackBuffer.length; i++) {
      // console.log("---sto iterando con indice i ---", i)
      // console.log('trackBuffer[i].finalKey', trackBuffer[i].finalKey)
      //check if the SHA3 key is contained in a SSTORE
      if (sstoreBuffer.includes(trackBuffer[i].finalKey)) {
        // console.log("---sstore contiene finalKey---")
        //create a final trace for that key
        const trace = {
          finalKey: trackBuffer[i].finalKey,
          hexKey: trackBuffer[i].hexKey,
          indexSum: trackBuffer[i].indexSum,
          hexStorageIndex: trackBuffer[i].hexStorageIndex,
        };
        // console.log(trace)
        let flag = false;
        let test = i;
        // console.log("testtttttttt", test);
        //Iterate previous SHA3 looking for a simple integer slot index
        while (flag === false) {
          //TODO non capisco questo controllo perché torna indietro anche se sono
          //con l'indice 0
          // console.log("---sono nel while cercando cose---")
          //if the storage key is not a standard number then check for the previous one
          if (
            !(
              web3.utils.hexToNumber("0x" + trackBuffer[test].hexStorageIndex) <
              300
            )
          ) {
            if (test > 0) {
              test--;
            } else {
              flag = true;
            }
            // console.log("non ho trovato uno slot semplice e vado indietro")
          } else {
            //if the storage location is a simple one then save it in the final trace with the correct key

            trace.hexStorageIndex = trackBuffer[test].hexStorageIndex;
            flag = true;
            finalShaTraces.push(trace);
          }
        }
        finalShaTraces.push(trace);
        sstoreBuffer.splice(sstoreBuffer.indexOf(trackBuffer[i].finalKey), 1);
      }
    }
    traceDebugged.structLogs.length = 0;

    let sstoreObject = { sstoreOptimization, sstoreBuffer };
    finalShaTraces = regroupShatrace(finalShaTraces);
    let internalStorage = [];
    if (extractionOption.internalStorage != 0) {
      internalStorage =
        contractTree && contractTree.storageLayoutFlag
          ? await optimizedDecodeValues(
              sstoreObject,
              contractTree.fullContractTree,
              finalShaTraces,
              functionStorage,
              functionName,
              mainContract,
              web3,
              contractTree.contractCompiled,
            )
          : [];
    }
    let internalTxs = [];
    if (extractionOption.internalTransaction == 0) {
      internalTxs = await decodeInternalTransaction(
        internalCalls,
        smartContract,
        web3,
        networkData,
        transactionHash,
        blockNumber,
      );
    } else if (extractionOption.internalTransaction == 1) {
      internalTxs = await newDecodedInternalTransaction(
        transactionHash,
        smartContract,
        networkData,
        web3,
        blockNumber,
      );
    }
    let result = {
      decodedValues: internalStorage,
      internalTxs: internalTxs,
    };
    sstoreObject = null;
    return result;
  } catch (err) {
    console.log("errore ", err);
  } finally {
    functionStorage = null;
    trackBuffer.length = 0;
    trackBuffer = null;
    sstoreBuffer.length = 0;
    sstoreBuffer = null;
    sstoreOptimization.length = 0;
    sstoreOptimization = null;
    traceDebugged = null;
    finalShaTraces.length = 0;
    finalShaTraces = null;
    if (global.gc) global.gc();
  }
}

function retriveImplementationContract(trace, nextTrace, web3) {
  let possibleImplementation;
  // trace.op=="CALL" && nextTrace.op=="DELEGATECALL" && trace.depth<nextTrace.depth
  if (
    (trace.op == "CALL" || trace.op == "STATICCALL") &&
    nextTrace.op == "DELEGATECALL" &&
    trace.depth < nextTrace.depth
  ) {
    const offsetBytes =
      nextTrace.stack[
        nextTrace.op === "CALL"
          ? nextTrace.stack.length - 4
          : nextTrace.stack.length - 3
      ];
    const lengthBytes =
      nextTrace.stack[
        nextTrace.op === "CALL"
          ? nextTrace.stack.length - 5
          : nextTrace.stack.length - 4
      ];
    possibleImplementation = {
      to: "0x" + nextTrace.stack[nextTrace.stack.length - 2].slice(-40),
      from: "0x" + trace.stack[trace.stack.length - 2].slice(-40),
      type: nextTrace.op,
      input: "",
    };
    let stringMemory = nextTrace.memory.join("");
    stringMemory = stringMemory.slice(
      web3.utils.hexToNumber("0x" + offsetBytes) * 2,
      web3.utils.hexToNumber("0x" + offsetBytes) * 2 +
        web3.utils.hexToNumber("0x" + lengthBytes) * 2,
    );
    possibleImplementation.input = "0x" + stringMemory;
  }
  return possibleImplementation;
}

// Modified getTraceStorage2 to accept a stream instead of reading from file
async function getTraceStorageFromErigon(
  httpStream,
  networkData,
  functionName,
  transactionHash,
  mainContract,
  contractTree,
  smartContract,
  extractionOption,
  web3,
  blockNumber,
  localMetrics = {},
) {
  let functionStorage = {};
  /**
   * The index of the functionStorageArray is the index associated with the transaction/internalTransaction
   * THe index are controlled by the index in the indexMap
   */
  let mapForStorage = {};
  let depthToIndexMap = new Map(); // Map depth -> current active index for that depth
  let nextIndex = 1; // Start from 1
  // index removed: KECCAK256 entries now pushed per-depth via mapForStorage
  let trackBuffer = [];
  let bufferPC = -10;
  let sstoreBuffer = [];
  let sstoreOptimization = [];
  let internalCalls = [];
  let keccakBeforeAdd = {};
  let finalShaTraces = [];
  // Parse the stream directly - no file I/O!
  const parser = JSONStream.parse("result.structLogs.*");
  httpStream.pipe(parser);

  let previousTrace = null;
  // Helper function to get or create index for a depth
  function getOrCreateIndexForDepth(depth) {
    if (!depthToIndexMap.has(depth)) {
      const newIndex = nextIndex++;
      depthToIndexMap.set(depth, newIndex);
      mapForStorage[newIndex] = {
        trackBuffer: [],
        functionStorage: {},
      };
    }
    return depthToIndexMap.get(depth);
  }
  const tStarStream = performance.now();
  console.log(
    `[${new Date().toISOString()}, DEBUG-PARSER-1] Avvio lettura stream di dati...`,
  );
  await new Promise((resolve, reject) => {
    parser.on("data", (trace) => {
      // Normalize stack first
      if (trace.stack && trace.stack.length > 0) {
        let tempArray = [];
        trace.stack.forEach((element) => {
          element = element.slice(2, element.length);
          element = web3.utils.padLeft(element, 64);
          tempArray.push(element);
        });
        trace.stack = tempArray;
      }
      if (previousTrace) {
        processTrace(previousTrace, trace);
      }

      previousTrace = trace;
    });

    parser.on("end", () => {
      if (previousTrace) {
        processTrace(previousTrace, null);
      }
      console.log(
        `[${new Date().toISOString()}, DEBUG-PARSER-2] Fine lettura stream raggiunta.`,
      );
      resolve();
    });

    parser.on("error", (error) => {
      console.error("Error parsing stream:", error);
      reject(error);
    });
  });
  localMetrics.time_processTraceErigon = parseFloat(
    (performance.now() - tStarStream).toFixed(3),
  );

  function processTrace(trace, nextTrace) {
    const currentIndex = getOrCreateIndexForDepth(trace.depth);

    if (trace.op === "KECCAK256") {
      bufferPC = trace.pc;
      const stackLength = trace.stack.length;
      const memoryLocation = trace.stack[stackLength - 1];
      let numberLocation = web3.utils.hexToNumber("0x" + memoryLocation) / 32;
      let storageIndexLocation = numberLocation + 1;
      const safeMemory = trace.memory || [];
      const hexKey = safeMemory[numberLocation];
      const hexStorageIndex = trace.memory[storageIndexLocation];

      mapForStorage[currentIndex].trackBuffer.push({ hexKey, hexStorageIndex });
    } else if (trace.op === "STOP" || trace.op === "RETURN") {
      for (const slot in trace.storage) {
        mapForStorage[currentIndex].functionStorage[slot] = trace.storage[slot];
      }
      depthToIndexMap.delete(trace.depth);
    } else if (trace.pc === bufferPC + 1) {
      bufferPC = -10;
      const lastIdx = mapForStorage[currentIndex].trackBuffer.length - 1;
      if (lastIdx < 0) return; // no KECCAK256 entry to attach to
      mapForStorage[currentIndex].trackBuffer[lastIdx].finalKey =
        trace.stack[trace.stack.length - 1];
      keccakBeforeAdd = mapForStorage[currentIndex].trackBuffer[lastIdx];

      if (
        trace.op === "ADD" &&
        (trace.stack[trace.stack.length - 1] === keccakBeforeAdd.finalKey ||
          trace.stack[trace.stack.length - 2] === keccakBeforeAdd.finalKey) &&
        keccakBeforeAdd.hexStorageIndex ===
          "0000000000000000000000000000000000000000000000000000000000000000"
      ) {
        const keyBuff = mapForStorage[currentIndex].trackBuffer[lastIdx].hexKey;
        const slotBuff =
          mapForStorage[currentIndex].trackBuffer[lastIdx].hexStorageIndex;
        mapForStorage[currentIndex].trackBuffer[lastIdx].hexKey = slotBuff;
        mapForStorage[currentIndex].trackBuffer[lastIdx].hexStorageIndex =
          keyBuff;

        if (nextTrace && nextTrace.stack && nextTrace.stack.length > 0) {
          mapForStorage[currentIndex].trackBuffer[lastIdx].finalKey =
            nextTrace.stack[nextTrace.stack.length - 1];
        }
        mapForStorage[currentIndex].trackBuffer[lastIdx].indexSum =
          trace.stack[trace.stack.length - 2];
      }
    } else if (trace.op === "SSTORE") {
      sstoreOptimization.push(trace.stack);
      sstoreBuffer.push(trace.stack[trace.stack.length - 1]);

      for (const slot in trace.storage) {
        mapForStorage[currentIndex].functionStorage[slot] = trace.storage[slot];
      }
    } else if (
      trace.op === "CALL" ||
      trace.op === "DELEGATECALL" ||
      trace.op === "STATICCALL"
    ) {
      const offsetBytes =
        trace.stack[
          trace.op === "CALL" ? trace.stack.length - 4 : trace.stack.length - 3
        ];
      const lengthBytes =
        trace.stack[
          trace.op === "CALL" ? trace.stack.length - 5 : trace.stack.length - 4
        ];
      let stringDepthConstruction = "";
      for (let i = 0; i < trace.depth - 1; i++) {
        stringDepthConstruction += "_1";
      }
      let call = {
        callId: "0_1" + stringDepthConstruction,
        callType: trace.op,
        depth: trace.depth,
        gas: web3.utils.hexToNumber("0x" + trace.stack[trace.stack.length - 1]),
        to: "0x" + trace.stack[trace.stack.length - 2].slice(-40),
        inputsCall: "",
      };

      // Pre-create structure for the next depth
      getOrCreateIndexForDepth(trace.depth + 1);

      let stringMemory = (trace.memory || []).join("");
      stringMemory = stringMemory.slice(
        web3.utils.hexToNumber("0x" + offsetBytes) * 2,
        web3.utils.hexToNumber("0x" + offsetBytes) * 2 +
          web3.utils.hexToNumber("0x" + lengthBytes) * 2,
      );
      call.inputsCall = stringMemory;
      internalCalls.push(call);
    } else if (trace.op === "SLOAD") {
      for (const slot in trace.storage) {
        mapForStorage[currentIndex].functionStorage[slot] = trace.storage[slot];
      }
    }
  }

  try {
    const publicTrackBuffer = mapForStorage["1"]?.trackBuffer || [];
    finalShaTraces = publicTrackBuffer;
    console.log(
      `[${new Date().toISOString()}, DEBUG-PARSER-3] Inizio calcolo SHA3 Traces (cicli while)...`,
    );
    for (let i = 0; i < publicTrackBuffer.length; i++) {
      if (sstoreBuffer.includes(publicTrackBuffer[i].finalKey)) {
        const trace = {
          finalKey: publicTrackBuffer[i].finalKey,
          hexKey: publicTrackBuffer[i].hexKey,
          indexSum: publicTrackBuffer[i].indexSum,
          hexStorageIndex: publicTrackBuffer[i].hexStorageIndex,
        };

        let flag = false;
        let test = i;

        while (flag === false) {
          if (
            !(
              web3.utils.hexToNumber(
                "0x" + publicTrackBuffer[test].hexStorageIndex,
              ) < 300
            )
          ) {
            if (test > 0) {
              test--;
            } else {
              flag = true;
            }
          } else {
            trace.hexStorageIndex = publicTrackBuffer[test].hexStorageIndex;
            flag = true;
            finalShaTraces.push(trace);
          }
        }
        finalShaTraces.push(trace);
        sstoreBuffer.splice(
          sstoreBuffer.indexOf(publicTrackBuffer[i].finalKey),
          1,
        );
      }
    }
    for (const singleObject in mapForStorage) {
      createShatrace(mapForStorage[singleObject], sstoreBuffer, web3);
    }
    let sstoreObject = { sstoreOptimization, sstoreBuffer };
    finalShaTraces = regroupShatrace(finalShaTraces);
    let internalStorage = [];
    //dal mapping della struttura alla key 1 è associata la chiamata pubblica quindi la posso passare direttamente "hardcoded"
    //TODO: Time decodeStorage public
    console.log(
      `[${new Date().toISOString()}, DEBUG-PARSER-4] Inizio decodifica ottimizzata (optimizedDecodeValues) e chiamate interne...`,
    );
    if (extractionOption.internalStorage != 0) {
      const tODV = performance.now();
      internalStorage =
        contractTree && contractTree.storageLayoutFlag
          ? await optimizedDecodeValues(
              sstoreObject,
              contractTree.fullContractTree,
              mapForStorage["1"].finalShaTraces,
              mapForStorage["1"].functionStorage,
              functionName,
              mainContract,
              web3,
              contractTree.contractCompiled,
            )
          : [];
      localMetrics.time_optimizedDecodeValuesErigon = parseFloat(
        (performance.now() - tODV).toFixed(3),
      );
    }
    let internalTxs = [];
    if (extractionOption.internalTransaction == 0) {
      const tDIT = performance.now();
      internalTxs = await decodeInternalTransaction(
        internalCalls,
        smartContract,
        web3,
        networkData,
        transactionHash,
        blockNumber,
      );
      localMetrics.time_decodeInternalTransactionErigon = parseFloat(
        (performance.now() - tDIT).toFixed(3),
      );
    } else if (extractionOption.internalTransaction == 1) {
      const tNDIT = performance.now();
      internalTxs = await newDecodedInternalTransaction(
        transactionHash,
        smartContract,
        networkData,
        web3,
        blockNumber,
      );
      localMetrics.time_newDecodedInternalTransactioneErigon = parseFloat(
        (performance.now() - tNDIT).toFixed(3),
      );
    }
    if (extractionOption.storageInternalTransactio == 1) {
      try {
        const tASTTI = performance.now();
        assignStorageToTheInternal(internalTxs, mapForStorage);
        localMetrics.time_assignStorageToTheInternalErigon = parseFloat(
          (performance.now() - tASTTI).toFixed(3),
        );
      } catch (err) {
        console.log("error in assignStorageToTheInternal");
      }

      const tDITS = performance.now();
      await decodeInteralTxsStorage(internalTxs, web3);
      localMetrics.time_decodeInternalTxsStorageErigon = parseFloat(
        (performance.now() - tDITS).toFixed(3),
      );
    }

    let result = {
      decodedValues: internalStorage,
      internalTxs: internalTxs,
    };
    sstoreObject = null;
    console.log(
      `[${new Date().toISOString()}, DEBUG-PARSER-5] Tutte le elaborazioni sincrone terminate, ritorno i dati.`,
    );
    return result;
  } catch (err) {
    console.log("errore ", err);
    throw err;
  } finally {
    functionStorage = null;
    trackBuffer.length = 0;
    trackBuffer = null;
    sstoreBuffer.length = 0;
    sstoreBuffer = null;
    sstoreOptimization.length = 0;
    sstoreOptimization = null;
    finalShaTraces.length = 0;
    finalShaTraces = null;
    if (global.gc) global.gc();
  }
}

async function getTraceStoragePartial(
  httpStream,
  networkData,
  functionName,
  transactionHash,
  mainContract,
  contractTree,
  smartContract,
  extractionOption,
  web3,
  blockNumber,
  localMetrics = {},
) {
  let mapForStorage = {};
  let depthToIndexMap = new Map();
  let nextIndex = 1;
  let bufferPC = -10;
  let sstoreBuffer = [];
  let sstoreOptimization = [];
  let internalCalls = [];
  let keccakBeforeAdd = {};
  let finalShaTraces = [];
  let previousTrace = null;

  const parser = JSONStream.parse("result.structLogs.*");
  httpStream.pipe(parser);

  function getOrCreateIndexForDepth(depth) {
    if (!depthToIndexMap.has(depth)) {
      const newIndex = nextIndex++;
      depthToIndexMap.set(depth, newIndex);
      mapForStorage[newIndex] = {
        trackBuffer: [],
        functionStorage: {},
      };
    }
    return depthToIndexMap.get(depth);
  }

  const tStartStream = performance.now();

  function processTrace(trace, nextTrace) {
    const currentIndex = getOrCreateIndexForDepth(trace.depth);

    if (trace.op === "KECCAK256") {
      bufferPC = trace.pc;
      const stackLength = trace.stack.length;
      const memoryLocation = trace.stack[stackLength - 1];
      let numberLocation = web3.utils.hexToNumber("0x" + memoryLocation) / 32;
      let storageIndexLocation = numberLocation + 1;

      const safeMemory = trace.memory || [];
      const hexKey = safeMemory[numberLocation];
      const hexStorageIndex = safeMemory[storageIndexLocation];

      mapForStorage[currentIndex].trackBuffer.push({ hexKey, hexStorageIndex });
    } else if (trace.op === "STOP" || trace.op === "RETURN") {
      for (const slot in trace.storage) {
        mapForStorage[currentIndex].functionStorage[slot] = trace.storage[slot];
      }
      if (trace.op === "STOP") depthToIndexMap.delete(trace.depth);
    } else if (trace.pc === bufferPC + 1) {
      bufferPC = -10;
      const lastIdx = mapForStorage[currentIndex].trackBuffer.length - 1;
      if (lastIdx < 0) return;

      mapForStorage[currentIndex].trackBuffer[lastIdx].finalKey =
        trace.stack[trace.stack.length - 1];
      keccakBeforeAdd = mapForStorage[currentIndex].trackBuffer[lastIdx];

      if (
        trace.op === "ADD" &&
        (trace.stack[trace.stack.length - 1] === keccakBeforeAdd.finalKey ||
          trace.stack[trace.stack.length - 2] === keccakBeforeAdd.finalKey) &&
        keccakBeforeAdd.hexStorageIndex ===
          "0000000000000000000000000000000000000000000000000000000000000000"
      ) {
        const keyBuff = mapForStorage[currentIndex].trackBuffer[lastIdx].hexKey;
        const slotBuff =
          mapForStorage[currentIndex].trackBuffer[lastIdx].hexStorageIndex;
        mapForStorage[currentIndex].trackBuffer[lastIdx].hexKey = slotBuff;
        mapForStorage[currentIndex].trackBuffer[lastIdx].hexStorageIndex =
          keyBuff;

        if (nextTrace && nextTrace.stack && nextTrace.stack.length > 0) {
          mapForStorage[currentIndex].trackBuffer[lastIdx].finalKey =
            nextTrace.stack[nextTrace.stack.length - 1];
        }
        mapForStorage[currentIndex].trackBuffer[lastIdx].indexSum =
          trace.stack[trace.stack.length - 2];
      }
    } else if (trace.op === "SSTORE") {
      sstoreOptimization.push(trace.stack);
      sstoreBuffer.push(trace.stack[trace.stack.length - 1]);

      for (const slot in trace.storage) {
        mapForStorage[currentIndex].functionStorage[slot] = trace.storage[slot];
      }
    } else if (
      trace.op === "CALL" ||
      trace.op === "DELEGATECALL" ||
      trace.op === "STATICCALL" ||
      trace.op === "CALLCODE"
    ) {
      const isCall = trace.op === "CALL" || trace.op === "CALLCODE";
      const offsetBytes = trace.stack[trace.stack.length - (isCall ? 4 : 3)];
      const lengthBytes = trace.stack[trace.stack.length - (isCall ? 5 : 4)];

      let stringDepthConstruction = "";
      for (let i = 0; i < trace.depth - 1; i++) {
        stringDepthConstruction += "_1";
      }

      let call = {
        callId: "0_1" + stringDepthConstruction,
        callType: trace.op,
        depth: trace.depth,
        gas: web3.utils.hexToNumber("0x" + trace.stack[trace.stack.length - 1]),
        to: "0x" + trace.stack[trace.stack.length - 2].slice(-40),
        inputsCall: "",
      };

      getOrCreateIndexForDepth(trace.depth + 1);

      let stringMemory = (trace.memory || []).join("");
      if (stringMemory.length > 0) {
        call.inputsCall = stringMemory.slice(
          web3.utils.hexToNumber("0x" + offsetBytes) * 2,
          web3.utils.hexToNumber("0x" + offsetBytes) * 2 +
            web3.utils.hexToNumber("0x" + lengthBytes) * 2,
        );
      }

      internalCalls.push(call);
    } else if (trace.op === "SLOAD") {
      for (const slot in trace.storage) {
        mapForStorage[currentIndex].functionStorage[slot] = trace.storage[slot];
      }
    }
  }

  try {
    console.log(
      `[${new Date().toISOString()}, DEBUG-PARSER-PARTIAL-1] Avvio lettura stream di dati...`,
    );
    await new Promise((resolve, reject) => {
      parser.on("data", (trace) => {
        if (trace.stack && trace.stack.length > 0) {
          trace.stack = trace.stack.map((element) => {
            let el = element.startsWith("0x") ? element.slice(2) : element;
            return web3.utils.padLeft(el, 64);
          });
        }
        if (previousTrace) {
          processTrace(previousTrace, trace);
        }
        previousTrace = trace;
      });

      parser.on("end", () => {
        if (previousTrace) processTrace(previousTrace, null);
        console.log(
          `[${new Date().toISOString()}, DEBUG-PARSER-PARTIAL-2] Fine lettura stream raggiunta.`,
        );
        resolve();
      });

      parser.on("error", (error) => reject(error));
    });

    localMetrics.time_processTraceStandard = parseFloat(
      (performance.now() - tStartStream).toFixed(3),
    );

    const publicTrackBuffer = mapForStorage["1"]?.trackBuffer || [];
    finalShaTraces = publicTrackBuffer;

    console.log(
      `[${new Date().toISOString()}, DEBUG-PARSER-PARTIAL-3] Inizio calcolo SHA3 Traces (cicli while)...`,
    );
    for (let i = 0; i < publicTrackBuffer.length; i++) {
      if (sstoreBuffer.includes(publicTrackBuffer[i].finalKey)) {
        const trace = {
          finalKey: publicTrackBuffer[i].finalKey,
          hexKey: publicTrackBuffer[i].hexKey,
          indexSum: publicTrackBuffer[i].indexSum,
          hexStorageIndex: publicTrackBuffer[i].hexStorageIndex,
        };

        let flag = false;
        let test = i;

        while (flag === false) {
          const storageIndex = publicTrackBuffer[test].hexStorageIndex;
          if (!storageIndex) {
            flag = true; // Salta se undefined
            continue;
          }
          if (
            !(
              web3.utils.hexToNumber(
                "0x" + publicTrackBuffer[test].hexStorageIndex,
              ) < 300
            )
          ) {
            if (test > 0) test--;
            else flag = true;
          } else {
            trace.hexStorageIndex = publicTrackBuffer[test].hexStorageIndex;
            flag = true;
            finalShaTraces.push(trace);
          }
        }
        finalShaTraces.push(trace);
        sstoreBuffer.splice(
          sstoreBuffer.indexOf(publicTrackBuffer[i].finalKey),
          1,
        );
      }
    }

    for (const singleObject in mapForStorage) {
      if (
        mapForStorage[singleObject] &&
        mapForStorage[singleObject].trackBuffer
      ) {
        const validTrackBuffer = mapForStorage[singleObject].trackBuffer.filter(
          (t) => t && t.hexStorageIndex,
        );
        if (
          validTrackBuffer.length > 0 &&
          typeof createShatrace === "function"
        ) {
          // Ricostruiamo l'oggetto solo con i dati validi
          const safeObject = {
            ...mapForStorage[singleObject],
            trackBuffer: validTrackBuffer,
          };
          try {
            createShatrace(safeObject, sstoreBuffer, web3);
          } catch (e) {
            console.warn(
              `[getTraceStorage] createShatrace ignorato per l'oggetto ${singleObject} a causa di dati non validi.`,
            );
          }
        }
      }
    }

    let sstoreObject = { sstoreOptimization, sstoreBuffer };
    if (typeof regroupShatrace === "function")
      finalShaTraces = regroupShatrace(finalShaTraces);

    let internalStorage = [];

    // --- DECODIFICA STORAGE ---
    console.log(
      `[${new Date().toISOString()}, DEBUG-PARSER-PARTIAL4] Inizio decodifica ottimizzata (optimizedDecodeValues) e chiamate interne...`,
    );
    if (extractionOption.internalStorage != 0 && mapForStorage["1"]) {
      const tODV = performance.now();
      internalStorage =
        contractTree && contractTree.storageLayoutFlag
          ? await optimizedDecodeValues(
              sstoreObject,
              contractTree.fullContractTree,
              mapForStorage["1"].finalShaTraces || finalShaTraces,
              mapForStorage["1"].functionStorage,
              functionName,
              mainContract,
              web3,
              contractTree.contractCompiled,
            )
          : [];
      localMetrics.time_optimizedDecodeValuesStandard = parseFloat(
        (performance.now() - tODV).toFixed(3),
      );
    }

    console.log(
      `[${new Date().toISOString()}, DEBUG-PARSER-PARTIAL-5] Tutte le elaborazioni sincrone terminate, ritorno i dati.`,
    );
    return {
      decodedValues: internalStorage,
      internalTxs: internalCalls,
    };
  } catch (err) {
    console.error("Errore durante l'elaborazione dello stream:", err);
    throw err;
  } finally {
    sstoreBuffer = null;
    sstoreOptimization = null;
    finalShaTraces = null;
    internalCalls = null;
    mapForStorage = null;
    if (global.gc) global.gc();
  }
}

function createShatrace(singleObject, sstoreBuffer, web3) {
  singleObject.finalShaTraces = singleObject.trackBuffer;

  for (let i = 0; i < singleObject.trackBuffer.length; i++) {
    if (
      singleObject.trackBuffer[i] &&
      sstoreBuffer.includes(singleObject.trackBuffer[i].finalKey)
    ) {
      const trace = {
        finalKey: singleObject.trackBuffer[i].finalKey,
        hexKey: singleObject.trackBuffer[i].hexKey,
        indexSum: singleObject.trackBuffer[i].indexSum,
        hexStorageIndex: singleObject.trackBuffer[i].hexStorageIndex,
      };

      let flag = false;
      let test = i;

      while (flag === false) {
        if (
          !(
            web3.utils.hexToNumber(
              "0x" + singleObject.trackBuffer[test].hexStorageIndex,
            ) < 300
          )
        ) {
          if (test > 0) {
            test--;
          } else {
            flag = true;
          }
        } else {
          trace.hexStorageIndex =
            singleObject.trackBuffer[test].hexStorageIndex;
          flag = true;
          singleObject.finalShaTraces.push(trace);
        }
      }
      singleObject.finalShaTraces.push(trace);
      sstoreBuffer.splice(
        sstoreBuffer.indexOf(singleObject.trackBuffer[i].finalKey),
        1,
      );
    }
  }
  singleObject.finalShaTraces = regroupShatrace(singleObject.finalShaTraces);
  delete singleObject.trackBuffer;
}

function assignStorageToTheInternal(internalTxs, mapForStorage, index = 2) {
  for (let txs of internalTxs) {
    txs.finalShaTraces = mapForStorage[index]?.finalShaTraces || [];
    txs.functionStorage = mapForStorage[index]?.functionStorage || {};
    index++;
    if (txs.calls && txs.calls.length > 0) {
      assignStorageToTheInternal(txs.calls, mapForStorage, index);
    }
  }
}

async function decodeInteralTxsStorage(internalTxs, web3) {
  for (let txs of internalTxs) {
    const query = { contractAddress: txs.to.toLowerCase() };
    //TODO: Time get information from Db
    let queryResult = await searchAbi(query);
    let contractTree = await getContractTree(
      null,
      txs.to,
      null,
      null,
      queryResult,
      false,
    );
    //TODO: Time decode storage
    let storageState = [];
    try {
      storageState =
        contractTree && contractTree.storageLayoutFlag
          ? await optimizedDecodeValues(
              null,
              contractTree.fullContractTree,
              txs.finalShaTraces,
              txs.functionStorage,
              txs.activity,
              txs.contractCalledName,
              web3,
              contractTree.contractCompiled,
            )
          : [];
    } catch (err) {
      console.log("error in decoding stoarge internal ");
    }

    txs.storageState = storageState;
    delete txs["finalShaTraces"];
    delete txs["functionStorage"];

    if (txs.calls && txs.calls.length > 0) {
      await decodeInteralTxsStorage(txs.calls, web3);
    }
  }
}

function regroupShatrace(finalShaTraces) {
  finalShaTraces = finalShaTraces.flat();
  return Array.from(
    new Map(
      finalShaTraces.map((item) => [
        item.finalKey + item.hexStorageIndex,
        item,
      ]),
    ).values(),
  );
}

// Handle messages from main process
process.on("message", async (data) => {
  const {
    tx,
    mainContract,
    contractTree,
    contractAddress,
    smartContract,
    option,
    networkData,
    extractionType,
    addressRange,
    returnInMemory,
  } = data;
  let transactionLog;
  try {
    // Connect to database
    await connectDB(networkData.networkName);

    // Process the transaction
    const result = await processTransaction(
      tx,
      mainContract,
      contractTree,
      contractAddress,
      smartContract,
      extractionType,
      networkData,
      option,
      addressRange,
      returnInMemory,
    );

    // Clean up
    // await mongoose.disconnect();

    if (global.gc) global.gc();
    await hre.run("clean");
    await hre.network.provider.send("hardhat_reset");
    if (hre.network.provider.removeAllListeners) {
      hre.network.provider.removeAllListeners();
    }
    // contractAbi = null;
    // contractCompiled = null;
    // Force garbage collection
    if (global.gc) global.gc();

    // Send success message
    if (returnInMemory && result.log) {
      const safeData = JSON.parse(JSON.stringify(result.log));
      process.send({ status: "done", data: safeData, metrics: result.metrics });
    } else {
      process.send({ status: "done", data: null, metrics: result.metrics });
    }
    // ...
    // Exit successfully
    process.exit(0);
  } catch (err) {
    console.error("Worker error:", err);

    // Clean up on error
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }

    // Send error message
    process.send({ error: err.message });

    // Exit with error
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception in worker:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error(
    "Unhandled Rejection in worker at:",
    promise,
    "reason:",
    reason,
  );
  process.exit(1);
});

module.exports = {
  makeRpcCallStreaming,
  decodeInput,
  regroupShatrace,
  createShatrace,
  assignStorageToTheInternal,
  decodeInteralTxsStorage,
};
