/**
 *
 * @param traceDebugged - the debugged transaction with its opcodes
 * @param blockNumber - the block number where the transaction is stored
 * @param functionName - the function name of the invoked method, useful to decode the storage state
 * @param txHash - the transaction hash used only to identify the internal transactions
 * @param mainContract - the main contract to decode, used to identify the contract variables
 * @param contractTree - the contract tree used to identify the contract variables with the 'mainContract'
 * @returns {Promise<{decodedValues: (*&{variableValue: string|string|*})[], internalCalls: *[]}>} - the decoded values of the storage state and the internal calls
 */
const { newDecodeValues } = require('./newDecodeValues');
async function getTraceStorage(traceDebugged, blockNumber, functionName, txHash, mainContract, contractTree) {
    /* const provider = ganache.provider({
         network_id: 1,
         fork: 'https://mainnet.infura.io/v3/f3851e4d467341f1b5927b6546d9f30c\@' + blockNumber
     });
     const response = await provider.request({
         method: "debug_traceTransaction",
         params: [txHash]
     });*/

    // await helpers.reset(web3Endpoint, Number(blockNumber));
    //  hre.network.config.forking.blockNumber = Number(blockNumber);
    // console.log(hre.config);
    //check for historical fork

    // await hre.network.provider.request({
    //     method: "hardhat_reset",
    //     params: [
    //         {
    //             forking: {
    //                 jsonRpcUrl: web3Endpoint,
    //                 blockNumber: Number(blockNumber)
    //             }
    //         }
    //     ]
    // })

    // const response = await hre.network.provider.send("debug_traceTransaction", [
    //     txHash
    // ]);
    //used to store the storage changed by the function. Used to compare the generated keys
    let functionStorage = {};
    //used to store all the keys potentially related to a dynamic structure
    /* let functionKeys = [];
     let functionStorageIndexes = [];*/
    let index = 0;
    let trackBuffer = [];
    let bufferPC = -10;
    let sstoreBuffer = [];
    const sstoreOptimization = []
    let internalCalls = [];
    let keccakBeforeAdd = {};
    const sstoreToPrint = []
    fs.writeFileSync("./temporaryTrials/trace.json", JSON.stringify(traceDebugged.structLogs), {flag: "a+"});

    if (traceDebugged.structLogs) {
        let internalTxId = 0
        for (const trace of traceDebugged.structLogs) {

            //if SHA3 is found then read all keys before being hashed
            // computation of the memory location and the storage index of a complex variable (mapping or struct)
            // in the stack we have the offset and the lenght of the memory
            if (trace.op === "KECCAK256") {

                bufferPC = trace.pc;
                const stackLength = trace.stack.length;
                const memoryLocation = trace.stack[stackLength - 1];
                //the memory contains 32 byte words so the hex index is converted to number and divided by 32
                //in this way the index in the memory arrays is calculated
                let numberLocation = web3.utils.hexToNumber("0x" + memoryLocation) / 32;
                let storageIndexLocation = numberLocation + 1;
                //take the key from the memory
                const hexKey = trace.memory[numberLocation];
                //take the storage slot from the memory
                const hexStorageIndex = trace.memory[storageIndexLocation];
                trackBuffer[index] = {
                    hexKey: hexKey,
                    hexStorageIndex: hexStorageIndex
                };
                console.log("----KECCAK WITH PC:----", trace.pc)
                console.log("----LEFT:", hexKey)
                console.log("----RIGHT:", hexStorageIndex)
                // end of a function execution -> returns the storage state with the keys and values in the storage
            } else if (trace.op === "STOP") {
                //retrieve the entire storage after function execution
                //for each storage key discard the ones of static variables and compare the remaining ones with the re-generated
                console.log("------STOP OPCODE-------");
                console.log(trace);
                for (const slot in trace.storage) {
                    functionStorage[slot] = trace.storage[slot];
                }
            } else if (trace.pc === (bufferPC + 1)) {
                /*console.log("----AFTER KECCAK:----", trace.pc)
                console.log("----RIGHT:", trace.stack[trace.stack.length - 1])*/
                keccakBeforeAdd = trackBuffer[index];
                bufferPC = -10;
                trackBuffer[index].finalKey = trace.stack[trace.stack.length - 1];
                console.log(trackBuffer[index]);
                index++;
                //todo compact with code below
                console.log('keccakBeforeAdd', keccakBeforeAdd)
                console.log('trace.stack[trace.stack.length - 1]', trace.stack[trace.stack.length - 1])
                console.log('trace.stack[trace.stack.length - 2]',trace.stack[trace.stack.length - 2])
                if(trace.op == "ADD" && (trace.stack[trace.stack.length - 1] === keccakBeforeAdd.finalKey ||
                        trace.stack[trace.stack.length - 2] === keccakBeforeAdd.finalKey) &&
                    keccakBeforeAdd.hexStorageIndex === "0000000000000000000000000000000000000000000000000000000000000000") {
                        console.log('PRIMO ADD ')
                        console.log('trace stack', trace.stack)

                    const keyBuff =  trackBuffer[index-1].hexKey;
                    const slotBuff =  trackBuffer[index-1].hexStorageIndex;
                    trackBuffer[index-1].hexKey = slotBuff;
                    trackBuffer[index-1].hexStorageIndex = keyBuff;
                    const nextTrace=traceDebugged.structLogs[traceDebugged.structLogs.indexOf(trace)+1];
                    const nextTraceStack=nextTrace.stack[nextTrace.stack.length - 1];
                    console.log( nextTraceStack);
                    trackBuffer[index-1].finalKey =nextTraceStack;
                    console.log("----ADD OPCODE----")
                    console.log("----first", trace.stack[trace.stack.length - 1]);
                    console.log("----second", trace.stack[trace.stack.length - 2]);
                }
            }
                //in case the trace is a SSTORE save the key. CAUTION: not every SSTORE changes the final storage state but every storage state change has an sstore
                // SSTORE -> updates the storage state
            // in the code we save the stack updated with the new value (the last element of the stack is the value to store in the storage slot)
            else if (trace.op === "SSTORE") {
                sstoreToPrint.push(trace)
                // used to store the entire stack of the SSTORE for the optimization
                sstoreOptimization.push(trace.stack)
                // the last element of the stack is the storage slot in which data is pushed
                sstoreBuffer.push(trace.stack[trace.stack.length - 1]);
                console.log("----SSTORE PUSHING:----")
                console.log("----storage slot:", trace.stack[trace.stack.length - 1])
                console.log("----value:", trace.stack[trace.stack.length - 2])
            } else if(trace.op == "ADD"){
                console.log('SECONDO ADD')
                /*ADD is the opcode that in case of arrays adds the next position to start to the computed keccak
                if this is found and one of the inputs is the keccak and the previous keccak has 0 as slot then manage
                this means that the keccak found is related to an array and we need to swap the slot with the key
                this because for mappings we have K(h(k) . slot) while in arrays K(slot . 0x0...)*/
                console.log("----ADD OPCODE----")
                console.log("----first", trace.stack[trace.stack.length - 1]);
                console.log("----second", trace.stack[trace.stack.length - 2]);
                /*console.log(keccakBeforeAdd.finalKey);
                console.log(keccakBeforeAdd.hexStorageIndex);*/

                if ((trace.stack[trace.stack.length - 1] === keccakBeforeAdd.finalKey ||
                        trace.stack[trace.stack.length - 2] === keccakBeforeAdd.finalKey) &&
                    keccakBeforeAdd.hexStorageIndex === "0000000000000000000000000000000000000000000000000000000000000000"){
                    const keyBuff =  trackBuffer[index-1].hexKey;
                    const slotBuff =  trackBuffer[index-1].hexStorageIndex;
                    trackBuffer[index-1].hexKey = slotBuff;
                    trackBuffer[index-1].hexStorageIndex = keyBuff;
                }
            } else if (trace.op === "CALL") {
                //read the offset from the stack
                const offsetBytes = trace.stack[trace.stack.length - 4];
                //convert the offset to number
                let offsetNumber = web3.utils.hexToNumber("0x" + offsetBytes) / 32;
                //read the length of the memory to read
                const lengthBytes = trace.stack[trace.stack.length - 5];
                //convert the length to number
                let lengthNumber = web3.utils.hexToNumber("0x" + lengthBytes) / 32;
                //create the call object
                let call = {
                    callId: "call_" + internalTxId + "_" + txHash,
                    callType: trace.op,
                    to: trace.stack[trace.stack.length - 2],
                    inputsCall: []
                }
                //read all the inputs from the memory and insert it in the call object
                for (let i = offsetNumber; i <= offsetNumber + lengthNumber; i++) {
                    call.inputsCall.push(trace.memory[i]);
                }
                internalCalls.push(call);
            } else if (trace.op === "DELEGATECALL" || trace.op === "STATICCALL") {
                // internalCalls.push(trace.stack[trace.stack.length - 2]);
                const offsetBytes = trace.stack[trace.stack.length - 3];
                let offsetNumber = await web3.utils.hexToNumber("0x" + offsetBytes) / 32;
                const lengthBytes = trace.stack[trace.stack.length - 4];
                let lengthNumber = await web3.utils.hexToNumber("0x" + lengthBytes) / 32;
                let call = {
                    callId: "call_" + internalTxId + "_" + txHash,
                    callType: trace.op,
                    to: trace.stack[trace.stack.length - 2],
                    inputsCall: []
                }
                for (let i = offsetNumber; i <= offsetNumber + lengthNumber; i++) {
                    call.inputsCall.push(trace.memory[i]);
                }
                internalCalls.push(call);
            } else if (trace.op === "RETURN") {
                //console.log("---------RETURN---------")
                //console.log(trace);
            }
//             fs.writeFileSync("./temporaryTrials/trace.json", JSON.stringify(trace), {flag: "a+"});
            internalTxId++
        }
    }
    
    // fs.writeFileSync("./temporaryTrials/sstoreToPrint.json", JSON.stringify(sstoreToPrint))
    fs.writeFileSync("./temporaryTrials/storeBuffer.json", JSON.stringify(sstoreBuffer));
    let finalShaTraces = [];
    console.log('SSTOREBUFER',sstoreBuffer);
    console.log('TRACK BUFFER', trackBuffer);
    console.log('Track buffer length', trackBuffer.length);
    for (let i = 0; i < trackBuffer.length; i++) {
        console.log("---sto iterando con indice i ---", i)
        console.log('trackBuffer[i].finalKey', trackBuffer[i].finalKey)
        //check if the SHA3 key is contained in a SSTORE
        if (sstoreBuffer.includes(trackBuffer[i].finalKey)) {
            console.log("---sstore contiene finalKey---")
            //create a final trace for that key
            const trace = {
                finalKey: trackBuffer[i].finalKey
            }
            console.log(trace)
            let flag = false;
            let test = i;
            console.log("testtttttttt", test);
            //Iterate previous SHA3 looking for a simple integer slot index
            while (flag === false) {
                console.log("---sono nel while cercando cose---")
                //if the storage key is not a standard number then check for the previous one
                if (!(web3.utils.hexToNumber("0x" + trackBuffer[test].hexStorageIndex) < 300)) {
                    test--;
                    console.log("non ho trovato uno slot semplice e vado indietro")
                } else {
                    //if the storage location is a simple one then save it in the final trace with the correct key
                    console.log("storage è semplice quindi lo salvo", trackBuffer[test].hexStorageIndex)
                    trace.hexStorageIndex = trackBuffer[test].hexStorageIndex;
                    flag = true;
                    finalShaTraces.push(trace);
                }
            }
            sstoreBuffer.splice(sstoreBuffer.indexOf(trackBuffer[i].finalKey), 1);
        }

    }

    //const uniqueTraces = Array.from(new Set(finalTraces.map(JSON.stringify))).map(JSON.parse);
    //removes duplicate storing keys, it will catch only the last update done on a variable
    const uniqueSStore = Array.from(new Set(sstoreBuffer.map(JSON.stringify))).map(JSON.parse);
    // const uniqueStorage = Array.from(new Set(functionStorage.map(JSON.stringify))).map(JSON.parse);
    fs.writeFileSync('./temporaryTrials/uniqueSStore.json', JSON.stringify(uniqueSStore));
    if (Object.keys(functionStorage).length !== 0) {
        // fs.writeFileSync(`./temporaryTrials/functionStorage_${txHash}.json`, JSON.stringify(functionStorage));
        fs.writeFileSync('./temporaryTrials/finalShaTraces.json', JSON.stringify(finalShaTraces));
    }

    const sstoreObject = {sstoreOptimization, sstoreBuffer}
    console.log("------FINAL SHA TRACES------")
    console.log(finalShaTraces);
    const decodedValues = await newDecodeValues(sstoreObject, contractTree, finalShaTraces, functionStorage, functionName, mainContract);
    return {decodedValues, internalCalls};
}
module.exports = {getTraceStorage};