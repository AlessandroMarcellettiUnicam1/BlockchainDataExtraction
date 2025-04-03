// const {Web3} = require('web3');


let networkName = ""
let web3Endpoint = ""
let apiKey = ""
let endpoint = ""
let web3=null;
let _contractAddress = ""
const primitiveValue=["uint","int","string","bool","address","enum","bytes"];
let contractCompiled = null;

let traceTime = 0
let decodeTime = 0
const csvColumns = ["transactionHash", "debugTime", "decodeTime", "totalTime"]

async function optimizedDecodeValues(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract, web3Variable, contractCompiledPassed) {
    web3 = web3Variable;
    contractCompiled = contractCompiledPassed;
    let decodedValues = [];
    let flag = true;

    for (const storageVar in functionStorage) {
        for (const shaTrace of shaTraces) {
            if (storageVar === shaTrace.finalKey) {
                const slotIndex = web3.utils.hexToNumber("0x" + shaTrace.hexStorageIndex);
                const contractVar = getContractVariable(slotIndex, contractTree, functionName, mainContract);

                if (!contractVar[0].type.includes("struct") && !contractVar[0].type.includes("string")) {
                    flag = false;
                    const decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage);
                    decodedValues.push(createBufferVariable(contractVar[0], decodedValue, functionStorage[storageVar]));
                }
            }
        }
    }

    if (flag) {
        const { sstoreBuffer } = sstore;
        for (const storageVar in functionStorage) {
            for (let sstoreIndex = 0; sstoreIndex < sstoreBuffer.length; sstoreIndex++) {
                const numberIndex = web3.utils.hexToNumber("0x" + sstoreBuffer[sstoreIndex]);
                if (storageVar === sstoreBuffer[sstoreIndex]) {
                    const contractVar = getContractVariable(numberIndex, contractTree, functionName, mainContract);
                    if (contractVar.length > 1) {
                        const updatedVariables = readVarFromOffset(contractVar, functionStorage[storageVar]);
                        updatedVariables.forEach(varItem => {
                            const decodedValue = decodeStorageValue(varItem, varItem.value, mainContract, storageVar, functionStorage);
                            decodedValues.push(createBufferVariable(varItem, decodedValue, varItem.value));
                        });
                    } else if (contractVar.length === 1) {
                        let decodedValue;
                        if (isUintArray(contractVar[0].type)) {
                            decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage, sstore.sstoreOptimization);
                        } else {
                            decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage, null, shaTraces);
                        }
                        decodedValues.push(createBufferVariable(contractVar[0], decodedValue, functionStorage[storageVar]));
                    }
                }
            }
        }
    }

    return mergeAndSortDecodedValues(decodedValues);
}

function createBufferVariable(contractVar, decodedValue, rawValue) {
    return {
        variableId: "variable_" + contractVar.name + "_" + _contractAddress,
        variableName: contractVar.name,
        type: contractVar.type,
        variableValue: decodedValue,
        variableRawValue: rawValue
    };
}

function isUintArray(type) {
    const regexUintArray = /(array.*(?:uint|int))|((?:uint|int).*array)/;
    return regexUintArray.test(type);
}

function mergeAndSortDecodedValues(decodedValues) {
    let outputStruct = [];
    decodedValues.forEach(decodedValue => {
        if (decodedValue.type.includes("struct")) {
            outputStruct.push(decodedValue);
        }
    });
    decodedValues = decodedValues.filter(item => !item.type.includes("struct"));
    if (decodedValues.length > 0) {
        decodedValues = mergeVariableValues(decodedValues);
    }
    outputStruct.forEach(e => {
        decodedValues.push(e);
    });
    return decodedValues;
}
//Funzione 
async function newDecodeValues(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract,web3Variable,contractCompiledPassed) {
    web3=web3Variable;
    contractCompiled = contractCompiledPassed;
// console.log("SSTORE");
//     console.log(sstore);
//     console.log("-------NEW DECODE VALUES---------");
//     let decodedValues = [];
//     console.log("-------SHA TRACES---------")
//     console.log(shaTraces);
//     console.log("-------FUNCTION STORAGE---------")
//     console.log(functionStorage);
    let flag= true;
    //iterate storage keys looking for complex keys coming from SHA3
    for (const storageVar in functionStorage) {
        for (const shaTrace of shaTraces) {
            // console.log('StorageVar=== shaTrace.finalKey', storageVar,shaTrace.finalKey)
            if (storageVar === shaTrace.finalKey) {
                // console.log("SONO NEL CASO 1")
                // console.log(shaTrace)
                // console.log(storageVar)
                const slotIndex = web3.utils.hexToNumber("0x" + shaTrace.hexStorageIndex);
                // console.log("slot indexxxx", slotIndex);
                const contractVar = getContractVariable(slotIndex, contractTree, functionName, mainContract);
                // console.log("contract var", contractVar);
                // console.log("E string ",!contractVar[0].type.includes("string"))
                //Se è una struttura vado al caso primitive 
                if(!contractVar[0].type.includes("string")){
                    flag=false;
                    const decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage);
                    const bufferVariable = {
                        variableId: "variable_" + contractVar[0].name + "_" + _contractAddress,
                        variableName: contractVar[0].name,
                        type: contractVar[0].type,
                        variableValue: decodedValue,
                        variableRawValue: functionStorage[storageVar]
                    };
                    decodedValues.push(bufferVariable);
                }
            }
        }
    }
    //storage should have only non-complex keys so only simple numbers representing slots
    //todo deal with variables storage optimizations
    //todo deal with sstore complex keys not present in any SHA
    let optimizedArray = []
    const {sstoreOptimization, sstoreBuffer} = sstore
    let flagCase2=true;
    if(flag){
        console.log("SONO NEL CASO sotto")
        for (const storageVar in functionStorage) {
            for (let sstoreIndex = 0; sstoreIndex < sstoreBuffer.length; sstoreIndex++) {
                const numberIndex = web3.utils.hexToNumber("0x" + sstoreBuffer[sstoreIndex]);
                if (storageVar === sstoreBuffer[sstoreIndex]) {
                    const contractVar = getContractVariable(numberIndex, contractTree, functionName, mainContract);
                    if (contractVar.length > 1 && flagCase2) {
                        console.log("SONO NEL CASO 2")
                        flagCase2=false;
                        const updatedVariables = readVarFromOffset(contractVar, functionStorage[storageVar]);
                        for (let varI = 0; varI < updatedVariables.length; varI++) {
                            const decodedValue = decodeStorageValue(updatedVariables[varI], updatedVariables[varI].value, mainContract, storageVar, functionStorage);
                            const bufferVariable = {
                                variableId: "variable_" + contractVar[varI].name + "_" + _contractAddress,
                                variableName: updatedVariables[varI].name,
                                type: updatedVariables[varI].type,
                                variableValue: decodedValue,
                                variableRawValue: updatedVariables[varI].value
                            };
                            decodedValues.push(bufferVariable);
                        }
                    } else if (contractVar.length === 1) {
                        let decodedValue;
                        // handle array with data optimization
                        const regexUintArray = /(array.*(?:uint|int))|((?:uint|int).*array)/
                        if (regexUintArray.test(contractVar[0].type)/* && !contractVar[0].type.includes("int256")*/) {
                            console.log("SONO NEL CASO 3")

                            optimizedArray.push({contractVar: contractVar[0], storageVar})
                            const optimezedVariables = optimizedArray.reduce((acc, item) => {
                                if (item.name === contractVar.name && item.type === contractVar.type && item.storageVar === storageVar) {
                                    acc.push(item)
                                }
                                return acc
                            }, [])

                            contractVar[0].index = optimezedVariables.length - 1
                            decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage, sstoreOptimization)
                        } else {
                            console.log("SONO NEL CASO 4")
                            //TODO se è un string devo passare tutto il functionStorage soprattutto se è una string a più lunga di un bytes
                            decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage,null,shaTraces)
                            // decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage)
                        }
                        const bufferVariable = {
                            variableId: "variable_" + contractVar[0].name + "_" + _contractAddress,
                            variableName: contractVar[0].name,
                            type: contractVar[0].type,
                            variableValue: decodedValue,
                            variableRawValue: functionStorage[storageVar]
                        };
                        decodedValues.push(bufferVariable);
                    }
                }
            }
        }
    }
    let outputStruct = [];
    decodedValues.forEach((decodedValue) => {
        if(decodedValue.type.includes("struct")){
            outputStruct.push(decodedValue);
            
        }
    });
    decodedValues = decodedValues.filter(item => !item.type.includes("struct"));
    if(decodedValues.length>0){
        decodedValues=mergeVariableValues(decodedValues);
    }
    outputStruct.forEach((e)=>{
        decodedValues.push(e);
    })
    // decodedValues = mergeVariableValues(decodedValues);

    return decodedValues;
}
/**
 * Method used to decode the value of a variable and it is called for each detected variable in the storage state
 *
 * @param sstore - contains the sstore optimization, including an array of stacks, and the sstore buffer with the variable storage slot
 * @param contractTree - the contract tree used to identify the contract variables with the 'mainContract'
 * @param shaTraces - the final traces of the storage keys
 * @param functionStorage - the storage state of the smart contract
 * @param functionName - the function name of the invoked method, useful to decode the storage state
 * @param mainContract - the main contract to decode, used to identify the contract variables
 * @returns {Promise<(*&{variableValue: string|string|*})[]>} - the decoded value of the detected variable
 */
async function tempnewDecodeValues(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract,web3Variable,contractCompiledPassed) {
     web3=web3Variable;
    contractCompiled = contractCompiledPassed;
    console.log("SSTORE",sstore);
    console.log("SHA TRACES",shaTraces);
    console.log("FUNCTION STORAGE",functionStorage);

    // preprocessData(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract);
    let decodedValues = [];
    let contractVar = null;
    if(shaTraces.length!=0){
        for(const shaTrace of shaTraces){
            console.log(shaTrace)
            const slotIndex = web3.utils.hexToNumber("0x" + shaTrace.hexStorageIndex);
            contractVar = getContractVariable(slotIndex, contractTree, functionName, mainContract);
            console.log("contract var", contractVar); 
            if(contractVar[0].type.includes("array") || contractVar[0].type.includes("mapping")){
                complexCase(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract,decodedValues);
            }else if( contractVar[0].type.includes("uint") || contractVar[0].type.includes("bool") || contractVar[0].type.includes("address") || contractVar[0].type.includes("enum") || contractVar[0].type.includes("bytes") || contractVar[0].type.includes("struct")){
                primitiveCase(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract,decodedValues);
            }else if(contractVar[0].type.includes("string")){
                // decodeString(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract)
                primitiveCase(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract,decodedValues)
            }
        }
    }else{
        primitiveCase(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract,decodedValues)
        // complexCase(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract,decodedValues);
    }
    
    console.log(decodedValues);
    //iterate storage keys looking for complex keys coming from SHA3
    
    //storage should have only non-complex keys so only simple numbers representing slots
    //todo deal with variables storage optimizations
    //todo deal with sstore complex keys not present in any SHA
    

    //TODO ill decode se c'è una struttura non va accorpato va gestito solo il caso delle stringhe in generale
    let outputStruct = [];
    decodedValues.forEach((decodedValue) => {
        if(decodedValue.type.includes("struct")){
            outputStruct.push(decodedValue);
            
        }
    });
    decodedValues = decodedValues.filter(item => !item.type.includes("struct"));
    if(decodedValues.length>0){
        decodedValues=mergeVariableValues(decodedValues);
    }
    outputStruct.forEach((e)=>{
        decodedValues.push(e);
    })

    return decodedValues;
}

function complexCase(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract,decodedValues){
    console.log("SONO NEL CASO COMPLESSO")
    for (const storageVar in functionStorage) {
        for (const shaTrace of shaTraces) {
            if (storageVar === shaTrace.finalKey) {
                // if(!isPrimitive(contractTree, shaTraces, functionName, mainContract)){
                    console.log(shaTrace)
                    console.log(storageVar)
                    const slotIndex = web3.utils.hexToNumber("0x" + shaTrace.hexStorageIndex);
                    console.log("slot indexxxx", slotIndex);
                    const contractVar = getContractVariable(slotIndex, contractTree, functionName, mainContract);
                    console.log("contract var", contractVar);
                    const decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage);
                    const bufferVariable = {
                        variableId: "variable_" + contractVar[0].name + "_" + _contractAddress,
                        variableName: contractVar[0].name,
                        type: contractVar[0].type,
                        variableValue: decodedValue,
                        variableRawValue: functionStorage[storageVar]
                    };
                    decodedValues.push(bufferVariable);
                
            }
        }
    }

}
function primitiveCase(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract,decodedValues){
    console.log("SONO NEL CASO PRIMITIVE")
    let optimizedArray = []
    const {sstoreOptimization, sstoreBuffer} = sstore
        for (const storageVar in functionStorage) {
            for (let sstoreIndex = 0; sstoreIndex < sstoreBuffer.length; sstoreIndex++) {
                const numberIndex = web3.utils.hexToNumber("0x" + sstoreBuffer[sstoreIndex]);
                if (storageVar === sstoreBuffer[sstoreIndex]) {
                    const contractVar = getContractVariable(numberIndex, contractTree, functionName, mainContract);
                    if (contractVar.length > 1) {
                        console.log("SONO NEL CASO 2")

                        const updatedVariables = readVarFromOffset(contractVar, functionStorage[storageVar]);
                        for (let varI = 0; varI < updatedVariables.length; varI++) {
                            const decodedValue = decodeStorageValue(updatedVariables[varI], updatedVariables[varI].value, mainContract, storageVar, functionStorage);
                            const bufferVariable = {
                                variableId: "variable_" + contractVar[varI].name + "_" + _contractAddress,
                                variableName: updatedVariables[varI].name,
                                type: updatedVariables[varI].type,
                                variableValue: decodedValue,
                                variableRawValue: updatedVariables[varI].value
                            };
                            decodedValues.push(bufferVariable);
                        }
                    } else if (contractVar.length === 1) {
                        let decodedValue;
                        // handle array with data optimization
                        const regexUintArray = /(array.*(?:uint|int))|((?:uint|int).*array)/
                        if (regexUintArray.test(contractVar[0].type)/* && !contractVar[0].type.includes("int256")*/) {
                            console.log("SONO NEL CASO 3")

                            optimizedArray.push({contractVar: contractVar[0], storageVar})
                            const optimezedVariables = optimizedArray.reduce((acc, item) => {
                                if (item.name === contractVar.name && item.type === contractVar.type && item.storageVar === storageVar) {
                                    acc.push(item)
                                }
                                return acc
                            }, [])

                            contractVar[0].index = optimezedVariables.length - 1
                            decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage, sstoreOptimization)
                        } else {
                            
                            console.log("SONO NEL CASO 4")

                            decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage,null,shaTraces)
                        }
                        const bufferVariable = {
                            variableId: "variable_" + contractVar[0].name + "_" + _contractAddress,
                            variableName: contractVar[0].name,
                            type: contractVar[0].type,
                            variableValue: decodedValue,
                            variableRawValue: functionStorage[storageVar]
                        };
                        decodedValues.push(bufferVariable);
                    }
                }
            }
        }

}
/**
 * Method used to return the variable to decode from the contract tree according to the storage slot identified
 *
 * @param slotIndex - the storage slot index of the variable to decode
 * @param contractTree - the contract tree used to identify the contract variables with the 'mainContract'
 * @param functionName - the function name of the invoked method
 * @param mainContract - the main contract to decode, used to identify the contract variables
 * @returns {*[]} - the contract variables to decode
 */
function getContractVariable(slotIndex, contractTree, functionName, mainContract) {
    /*console.log("-----------contract treeee-----")
    console.log(contractTree)
    console.log("-----------function name-----")
    console.log(functionName)
    console.log("-----------main contract-----")
    console.log(mainContract)*/
    let contractVariables = [];
    //iterates all contracts in contract tree
    for (const contractId in contractTree) {
        //console.log("-------contractId-------");
        //console.log(contractId);
        //if contract is the chosen one and it has function then take variable
        // && contractTree[contractId].functions.includes(functionName) do we really need this?
        if (contractTree[contractId].name === mainContract) {
            //iterate contract variables
            //console.log("-----------sono nell'if e sto vedendo il tree dell'id specifico-----")
            //console.log(contractTree[contractId]);

            //TODO non capisco la logica di questo for 
            for (let i = 0; i < contractTree[contractId].storage.length; i++) {
                if (Number(contractTree[contractId].storage[i].slot) === Number(slotIndex)) {
                    contractVariables.push(contractTree[contractId].storage[i]);
                } else if (i < contractTree[contractId].storage.length - 1) {
                    if (Number(contractTree[contractId].storage[i].slot) <= Number(slotIndex) && Number(contractTree[contractId].storage[i + 1].slot) > Number(slotIndex)) {
                        contractVariables.push(contractTree[contractId].storage[i]);
                    }
                }
            }
            // for (const contractVariable of contractTree[contractId].storage) {
            //     //check if there are more variables for the same index due to optimization purposes
            //     if (Number(contractVariable.slot) === Number(slotIndex)) {
            //         contractVariables.push(contractVariable);
            //     }
            // }
        }
    }
    return contractVariables;
}
/**
 *
 * @param variable - the variable to decode
 * @param value - the value of the variable to decode, depends on the variable type
 * @param mainContract - used to identify the members of a struct
 * @param storageVar - the storage slot of the variable to decode
 * @param functionStorage - the storage state of the smart contract
 * @param completeSstore - array of stacks taken from the SSTORE opcodes to identify more updates of the same variable
 * @returns {number|*|string|string|{}} - the decoded variable
 */
function decodeStorageValue(variable, value, mainContract, storageVar, functionStorage, completeSstore,shaTraces) {
    console.log("Variable: ", variable)
    //if it is a mapping check for last type of value by splitting it so to cover also nested case
    if (variable.type.includes("mapping")) {
        const typeBuffer = variable.type.split(",");
        const valueType = typeBuffer[typeBuffer.length - 1];
        if (valueType.includes("struct")) {
            //TODO decode mapping of struct
            // try with "decodeStructType" method, be careful to the variable name, it is not the
            // same of the structname
            return decodeStructType(variable, value, mainContract, storageVar)
            // return value
        } else {
            //TODO decode mapping of arrays
            return decodePrimitiveType(valueType, value);
        }
    } else if (variable.type.includes("array")) {
        // console.log("Variable: ", variable)
        const arrayTypeSplitted = variable.type.split(")")
        const arraySize = arrayTypeSplitted[arrayTypeSplitted.length - 1].split("_")[0]
        if (arraySize !== "dyn") {
            return decodeStaticArray(variable, value, mainContract, storageVar, Number(arraySize), functionStorage, completeSstore)
        } else {
            return decodeDynamicArray(variable, value, mainContract, storageVar, functionStorage)
        }
    } else if (variable.type.includes("struct")) {
        return decodeStructType(variable, value, mainContract, storageVar,shaTraces,functionStorage)
    } else {
        return decodePrimitiveType(variable.type, value,shaTraces,functionStorage);
    }
}

/**
 * Method used to decode the primitive types in Solidity
 *
 * @param type - the type of the variable to decode
 * @param value - the raw value of the variable to decode
 * @returns {*|number|string} - the decoded value of the variable
 */
function decodePrimitiveType(type, value,shaTraces,functionStorage) {
    console.log("variabileeee", value);
    if (type.includes("uint")) {
        return Number(web3.utils.hexToNumber("0x" + value))
    } else if (type.includes("string")) {
        // // decodeString(type,value);
        console.log("SONO QUI ")
        let decodedString="";
        console.log("SHA TRACES",shaTraces);
        console.log("FUNCTION STORAGE",functionStorage);
        if(shaTraces && functionStorage[shaTraces[0].finalKey]!=web3.utils.padLeft("0",64)){
            decodedString=decodeString(shaTraces,functionStorage);
        }

        if(decodedString.length<=32){
            let chars = value.split("0")[0]
            if (chars.length % 2 !== 0) chars = chars + "0"
            return web3.utils.hexToAscii("0x" + chars)
        }else{
            return web3.utils.hexToAscii("0x" + decodedString).replace(/\0/g,'');
        }
    } else if (type.includes("bool")) {
        return web3.eth.abi.decodeParameter("bool", "0x" + value);
    } else if (type.includes("bytes")) {
        let temp=web3.utils.hexToBytes("0x" + value)
        // return JSON.stringify(temp).replace("\"", "");
        return "0x"+value.slice(2);
    } else if (type.includes("address")) {
        return "0x" + value.slice(-40);
    } else if (type.includes("enum")) {
        let bigIntvalue = web3.eth.abi.decodeParameter("uint256", "0x" + value)
        return Number(bigIntvalue)
    }
    return value
}

function decodeString(shaTraces, functionStorage) {
    console.log("SHA TRACES",shaTraces);
    console.log("FUNCTION STORAGE",functionStorage);
    let stringLength=web3.utils.hexToNumber("0x"+functionStorage[shaTraces[0].hexStorageIndex]);
    let slotDiff=stringLength%64;
    let slotUsed=(stringLength-slotDiff)/64;  
    if(slotDiff>0){
        slotUsed=slotUsed+1;
    }
    let listOfBlock="";
    let startString=shaTraces[0].finalKey;
    for(let i=0;i<slotUsed;i++){
        let num=web3.utils.hexToNumber("0x"+startString)
        console.log(num);
        let bigNumberindex=BigInt(i);
        console.log(bigNumberindex);
        num=num+bigNumberindex;
        let slotResult=web3.utils.numberToHex(num).substring(2);
        console.log(slotResult)
        listOfBlock=listOfBlock+(functionStorage[slotResult]);
    }
    
    return listOfBlock;
}

/**
 * Method used to decode a static array. Since that the length of the array is already known the method
 * decodes the value of the array at the specified index, starting from the first slot of the array and
 * iterating up to find the correct slot passed to the method. With the struct type the reasoning is similar:
 * for each member of a struct a storage slot is occupied (except for the optimization), so more consecutive
 * storage slots represent the entire struct in the array. For the structs the iteration is computed calculating
 * the number of members, in this way every time the number of members is reached the array index is incremented.
 *
 * @param variable - the variable to decode
 * @param value - the value of the variable to decode, depends on the variable type
 * @param mainContract - used to identify the members of a struct
 * @param storageVar - the storage slot of the variable to decode
 * @param arraySize - the size of the array to decode, catched from the variable type
 * @param functionStorage - the storage state of the smart contract
 * @param completeSstore - array of stacks taken from the SSTORE opcodes to identify more updates of the same variable
 * @returns {{}|string} - an object containing the array index and the value of the variable
 */
function decodeStaticArray(variable, value, mainContract, storageVar, arraySize, functionStorage, completeSstore) {
    let arrayStorageSlot = Number(variable.slot);
    const output = {}
    if (variable.type.includes("struct")) {
        const structType = variable.type.split("(")[2].split(")")[0]
        const getContract = getMainContractCompiled(mainContract);
        const structMembers = getStructMembersByStructType(structType, getContract);
        const arrayTotalSize = arraySize * structMembers.length
        let counter = 0
        let arrayIndex = -1
        for (let i = arrayStorageSlot; i < arrayTotalSize + arrayStorageSlot; i++) {
            const storageVarDec = web3.utils.toDecimal("0x" + storageVar)
            if (counter === 0) arrayIndex++
            if (storageVarDec === i) {
                const memberLabel = structMembers[counter].label
                output.arrayIndex = arrayIndex
                output.struct = structType
                output[memberLabel] = decodePrimitiveType(structMembers[counter].type, value)
                return JSON.stringify(output)
            }
            if (counter === structMembers.length - 1) {
                counter = 0
            } else {
                counter++
            }
        }
    } else {
        if (typeof variable.index !== "undefined") {
            let counter = 0
            for (let i = 0; i < completeSstore.length; i++) {
                const stack = completeSstore[i]
                if (stack[stack.length - 1] === storageVar) {
                    if (counter === variable.index) {
                        output.value = Number(web3.utils.hexToNumber("0x" + stack[stack.length - 3]))
                        return output
                    } else {
                        counter++
                    }
                }
            }

            // TODO: fix static array with optimization
            // const value = optimezedArray(arraySize - 1, variable.type.split("int")[1].split(")")[0], functionStorage, storageSlotPadded)
            // output.value = web3.utils.hexToNumber("0x" + value)
            return JSON.stringify(output)
        } else {
            for (let i = 0; i < arraySize; i++) {
                const arrayStorageSlot = Number(variable.slot) + i
                if (arrayStorageSlot === web3.utils.hexToNumber("0x" + storageVar)) {
                    output.arrayIndex = i
                    output.value = decodePrimitiveType(variable.type, value)
                    return JSON.stringify(output)
                }
            }
        }
    }
    //TODO optimize the code
}
/**
 * Method used to get the main contract compiled to identify the members of a struct
 *
 * @param mainContract - the main contract with the struct
 * @returns {*} - the main contract compiled
 */
function getMainContractCompiled(mainContract) {
    const testContract = JSON.parse(contractCompiled);
    for (const contract in testContract.contracts) {
        const firstKey = Object.keys(testContract.contracts[contract])[0];
        if (firstKey === mainContract) {
            return testContract.contracts[contract][firstKey]
        }
    }
}


/**
 * Method used to decode a struct type starting from the compiled contract to
 * find the struct member. The member of a struct are stored like the array,
 * each slot contains a member of the struct (except for members with otpimization),
 * so the first slot of the struct corresponds to the first member, from there it is
 * enough to iterate the consecutive slots up to the number of members.
 *
 * @param variable - the variable to decode
 * @param value - the value of the variable to decode, depends on the variable type
 * @param mainContract - used to identify the members of a struct
 * @param storageVar - the storage slot of the variable to decode
 * @returns {string} - the value of the struct
 */
function decodeStructType(variable, value, mainContract, storageVar,shaTraces,functionStorage) {
    console.log("Variable: ", variable)
    console.log("Value: ", value)
    console.log("MainContract: ", mainContract)
    console.log("StorageVar: ", storageVar)
    const getContractCompiled = getMainContractCompiled(mainContract);
    const members = getStructMembersByVariableName(variable.name, getContractCompiled);
    const memberItem = {
        struct: variable.type.split("(")[1].split(")")[0],
    }
    console.log("Members: ", members)
    console.log("MemberItem: ", memberItem)
    // TODO array member
    // TODO mapping member
    // TODO optimization (uint8, uint16, uint32)
    members.forEach((member) => {
        const memberSlot = Number(member.slot) + Number(variable.slot)
        if (memberSlot === web3.utils.toDecimal("0x" + storageVar)) {
            memberItem[member.label] = decodePrimitiveType(member.type, value,shaTraces,functionStorage)
        }
    })
    return JSON.stringify(memberItem)
}

function getStructMembersByVariableName(variableName, mainContractCompiled) {
    let members = []
    const storageLayout = mainContractCompiled.storageLayout.storage;
    storageLayout.forEach((item) => {
        if (item.label === variableName) {
            const structType = item.type;
            const storageTypes = mainContractCompiled.storageLayout.types;
            for (type in storageTypes) {
                if (type === structType) {
                    members = storageTypes[type].members
                }
            }
        }
    })
    return members
}
/**
 * Method used to find the members of a struct starting from the struct type
 * and the main contract compiled
 *
 * @param type - the struct type to find
 * @param mainContractCompiled - the main contract compiled
 * @returns {*[]} - the members of the struct
 */
function getStructMembersByStructType(type, mainContractCompiled) {
    let members = []
    const storageTypes = mainContractCompiled.storageLayout.types;
    for (const storageType in storageTypes) {
        if (storageType.includes(type)) {
            members = storageTypes[storageType].members
        }
    }
    return members
}

/**
 * Method used to decode the dynamic array. In this case the first storage slot of the array
 * return the final length of that one and with a "push()" method the updated index
 * corresponds to the last index of the array. The computation of the update involves the keccak256
 * of the array storage slot, then the length of the array is summed with the outcome of the hash.
 * This operation returns the storage slot of the updated index in the storage state.
 * With the struct type the reasoning is similar: for each member of a struct a storage slot is occupied
 * (except for the optimization), so more consecutive storage slots represent the entire struct in the array.
 * For "push()" method the updated struct is computed multiplying the number of the struct members with the array size.
 * The outcome is summed to the keccak256 hash of the array storage slot.
 *
 * The situation is different when there are direct updates of indexes, the application does not yet support this case.
 *
 * @param variable - the variable to decode
 * @param value - the raw value of the variable to decode, depends on the variable type
 * @param mainContract - used to identify the members of a struct
 * @param storageVar - the storage slot of the variable to decode
 * @param functionStorage - the storage state of the smart contract
 * @returns {string} - the decoded variable
 */
function decodeDynamicArray(variable, value, mainContract, storageVar, functionStorage) {
    //take the index of the first value != 0
    console.log('-------VARIABLE-------', variable)
    console.log('-------VALUE-------', value)
    console.log('MAIN CONTRACT', mainContract)
    console.log('STORAGEVAR', storageVar)
    console.log('FUNCTION STORAGE', functionStorage)
    const varibleSlotToNumber=web3.utils.numberToHex(variable.slot);
    console.log('VARIABLE SLOT TO NUMBER', varibleSlotToNumber)
    const varibleSlotSliced=varibleSlotToNumber.slice(2);
    console.log('VARIABLE SLOT SLICED', varibleSlotSliced)
    const slotPadded=web3.utils.padLeft(varibleSlotSliced, 64);
    console.log('SLOT PADDED', slotPadded)
    const firstNonZeroIndex=web3.utils.hexToNumber('0x'+functionStorage[slotPadded].slice(2));
    console.log('FIRST NON ZERO INDEX', firstNonZeroIndex)
    // const lastIndex = web3.utils.hexToNumber("0x" + value) - 1
    const lastIndex = firstNonZeroIndex;
    console.log('LAST INDEX', lastIndex)
    console.log('STORAGEVAR', storageVar);
    // let arrayStorageSlot = web3.utils.keccak256("0x" + storageVar)
    let arrayStorageSlot=web3.utils.hexToNumber("0x" + storageVar.slice(2));
    console.log('ARRAY STORAGE SLOT', arrayStorageSlot)
    const output = {
        arrayIndex: lastIndex
    }
    if (variable.type.includes("struct")) {
        const structType = variable.type.split("(")[2].split(")")[0]
        const getContract = getMainContractCompiled(mainContract);
        const structMembers = getStructMembersByStructType(structType, getContract);
        arrayStorageSlot = arrayStorageSlot + (lastIndex * structMembers.length);
        output.struct = structType
        for (let i = 0; i < structMembers.length; i++) {
            const functionStorageIndex = arrayStorageSlot + i;
            const functionStorageIndexHex = web3.utils.numberToHex(functionStorageIndex);
            const numberToHex = functionStorageIndexHex.slice(2);
            const functionStorageIndexPadded = web3.utils.padLeft(numberToHex, 64);
            // TODO: decode non-primitive types members
            console.log('STRUCT MEMBER',structMembers[i])
            console.log('FUNCTION STORAGE',functionStorage[functionStorageIndex])
            output[structMembers[i].label] = decodePrimitiveType(structMembers[i].type, functionStorage[functionStorageIndex.toString(16)])
        }
        return JSON.stringify(output)
        // TODO: handle direct update of indexes - similar case to the static array
    } else if ((variable.type.includes("uint") || variable.type.includes("int")) && !variable.type.includes("256")) {
        const value = optimezedArray(lastIndex, variable.type.split("uint")[1].split(")")[0], functionStorage, storageVar)
        console.log('Output value',value);

        output.value = web3.utils.hexToNumber("0x" + value)
        return JSON.stringify(output)
    } else {
        console.log("Entro nell'else")
        // arrayStorageSlot = BigInt(arrayStorageSlot) + BigInt(lastIndex)
        // output.value = decodePrimitiveType(variable.type, functionStorage[arrayStorageSlot.toString(16).padStart(64, '0')])

        //prima veniva passato il function sto
        output.value=decodePrimitiveType(variable.type,functionStorage[storageVar].slice(2))
        // output.value=decodePrimitiveType(variable.type,value.slice(2))
        return JSON.stringify(output)
    }
}

function optimezedArray(arraySize, typeSize, functionStorage, slot) {
    console.log('arraySize', arraySize)
    console.log('typeSize', typeSize)
    console.log('functionStorage', functionStorage)
    console.log('slot', slot)
    const storageStringLength = 64
    const charsForElement = typeSize / 4
    const elementNumberPerString = storageStringLength / charsForElement
    console.log('STAMPO FUNCTION STORAGE')
    const ending=storageStringLength - (arraySize * charsForElement)
    console.log(functionStorage[slot].slice(ending, ending+charsForElement))
    console.log('End',ending,ending+charsForElement)
    if (arraySize <= elementNumberPerString - 1) {
        const completeArrayValue=functionStorage[slot];
        // return functionStorage[slot].slice(ending, ending+charsForElement)
        return functionStorage[slot].slice(ending, ending+charsForElement)
    } else {
        const arrayStorageSlot = Math.floor(arraySize / elementNumberPerString)
        const newSlot = BigInt("0x" + slot) + BigInt(arrayStorageSlot)
        const newStorageSlot = functionStorage[newSlot.toString(16).padStart(64, '0')]
        return newStorageSlot.slice(0, storageStringLength - (arraySize * charsForElement))
    }
}

//used to merge storage variables of structs member in static array
function mergeVariableValues(arr) {
    return Object.values(arr.reduce((acc, item) => {

        if (typeof item.variableValue === "string" && item.variableValue.includes("arrayIndex")) {
            const variableValue = JSON.parse(item.variableValue);
            const arrayIndex = variableValue.arrayIndex;
            const key = `${arrayIndex}_${item.type}`
            if (!acc[key]) {
                acc[key] = {
                    ...item,
                    variableValue: variableValue
                };
            } else {
                acc[key].variableValue = {
                    ...acc[key].variableValue,
                    ...variableValue
                };
            }
        } else {
            acc[item.variableName] = item
        }

        return acc;
    }, {})).map(item => ({
        ...item,
        variableValue: typeof item.variableValue === "object" ? JSON.stringify(item.variableValue) : item.variableValue
    }));
}

function isPrimitive(contractTree, shaTraces, functionName, mainContract){
    const slotIndex = web3.utils.hexToNumber("0x" + shaTraces[0].hexStorageIndex);
    console.log("slot indexxxx", slotIndex);
    const contractVar = getContractVariable(slotIndex, contractTree, functionName, mainContract);
    console.log("contract var", contractVar);
    const cleanType= contractVar[0].type.slice(2).split("_")[0];
    if(contractVar[0].type.includes("array") || contractVar[0].type.includes("struct") || contractVar[0].type.includes("mapping")){
       return false;

    }else if(primitiveValue.includes(cleanType)){
       return true;

        // let decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage)
        // console.log("decoded value", decodedValue);

    }
}

function preprocessData(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract){
    console.log("-------NEW DECODE VALUES---------");
    let decodedValues = [];
    console.log("-------SHA TRACES---------")
    console.log(shaTraces);
    console.log("-------FUNCTION STORAGE---------")
    console.log(functionStorage);
    console.log("-------SSTORE---------")
    console.log(sstore);
    console.log("-------CONTRACT TREE---------")
    console.log(contractTree);
    
    if(shaTraces){
        const slotIndex = web3.utils.hexToNumber("0x" + shaTraces[0].hexStorageIndex);
        console.log("slot indexxxx", slotIndex);
        const contractVar = getContractVariable(slotIndex, contractTree, functionName, mainContract);
        console.log("contract var", contractVar);
        const cleanType= contractVar[0].type.slice(2).split("_")[0];
        console.log("clean primitive type", cleanType);
        console.log("primitive value", primitiveValue);
        if(contractVar[0].type.includes("array") || contractVar[0].type.includes("struct") || contractVar[0].type.includes("mapping")){
            console.log("Caso complesso")

        }else if(primitiveValue.includes(cleanType)){
            console.log("Caso primitive")

            // let decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage)
            // console.log("decoded value", decodedValue);

        }
    }
}
function readVarFromOffset(variables, value) {
    const fullWord = value.split('');
    let len = fullWord.length;
    for (let i = 0; i < variables.length; i++) {
        variables[i].value = "";
        // [0,0,0,0,0,0,0,0,0,0,0,0,1,1] takes from the bytes offset to the end of the array
        //last values optimized are inserted at the end of the hex
        if (variables[i + 1] !== undefined) {
            //check if the offset is the first starting from 0
            if (variables[i].offset === 0) {
                const nextOffset = (variables[i + 1].offset) * 2;
                len = len - nextOffset;
                const slicedWord = fullWord.splice(len, nextOffset);
                variables[i].value = slicedWord.join('');
            } else {
                const nextOffset = (variables[i + 1].offset) * 2;
                len = len - nextOffset;
                const slicedWord = fullWord.slice(len, nextOffset);
                variables[i].value = slicedWord.join('');
            }
        } else {
            variables[i].value = fullWord.join('');
        }
    }
    return variables;
}
module.exports = {newDecodeValues};