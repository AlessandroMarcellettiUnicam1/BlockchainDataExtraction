let networkName = "";
let web3Endpoint = "";
let apiKey = "";
let endpoint = "";
let web3 = null;
let _contractAddress = "";
const primitiveValue = ["uint", "int", "string", "bool", "address", "enum", "bytes"];
let contractCompiled = null;

const csvColumns = ["txHash", "debugTime", "decodeTime", "totalTime"];

async function optimizedDecodeValues(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract, web3Variable, contractCompiledPassed) {
    web3 = web3Variable;
    contractCompiled = contractCompiledPassed;
    let decodedValues = [];
    let flag = true;
    console.log("------SHAT TRACES------")
    console.log(shaTraces)
    console.log("------FUNCTION STORAGE------")
    console.log(functionStorage)
    
    for (const storageVar in functionStorage) {
        for (const shaTrace of shaTraces) {
            if (storageVar === shaTrace.finalKey) {
                const slotIndex = web3.utils.hexToNumber("0x" + shaTrace.hexStorageIndex);
                const contractVar = getContractVariable(slotIndex, contractTree, functionName, mainContract);
                console.log(contractVar)
                if (!contractVar[0].type.includes("string")) {
                    flag = false;
                    console.log("Primo")
                    const decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage,null,shaTraces);
                    decodedValues.push(createBufferVariable(contractVar[0], decodedValue, functionStorage[storageVar]));
                } else if (contractVar[0].type.includes("array")) {
                    flag = false;
                    console.log("Primo")
                    const decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage,null,shaTraces);
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
                    if (contractVar.length > 1 ) {
                        flagCase2=false;
                        console.log("Secondo")
                        const updatedVariables = readVarFromOffset(contractVar, functionStorage[storageVar]);
                        updatedVariables.forEach(varItem => {
                            const decodedValue = decodeStorageValue(varItem, varItem.value, mainContract, storageVar, functionStorage);
                            decodedValues.push(createBufferVariable(varItem, decodedValue, varItem.value));
                        });
                    } else if (contractVar.length === 1) {
                        let decodedValue;
                        if (isUintArray(contractVar[0].type)) {
                            console.log("Terzo")
                            console.log(sstoreBuffer)
                            decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage, sstore.sstoreOptimization);
                        } else {
                            decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage, null, shaTraces);
                            console.log("Quarto")

                        }
                        decodedValues.push(createBufferVariable(contractVar[0], decodedValue, functionStorage[storageVar]));
                    }
                }
            }
        }
    }
    console.log(decodedValues)
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

function getContractVariable(slotIndex, contractTree, functionName, mainContract) {
    let contractVariables = [];
    for (const contractId in contractTree) {
        if (contractTree[contractId].name === mainContract) {
            for (let i = 0; i < contractTree[contractId].storage.length; i++) {
                if (Number(contractTree[contractId].storage[i].slot) === Number(slotIndex)) {
                    contractVariables.push(contractTree[contractId].storage[i]);
                } else if (i < contractTree[contractId].storage.length - 1) {
                    if (Number(contractTree[contractId].storage[i].slot) <= Number(slotIndex) && Number(contractTree[contractId].storage[i + 1].slot) > Number(slotIndex)) {
                        contractVariables.push(contractTree[contractId].storage[i]);
                    }
                }
            }
        }
    }
    return contractVariables;
}

function decodeStorageValue(variable, value, mainContract, storageVar, functionStorage, completeSstore, shaTraces) {
    if (variable.type.includes("mapping")) {
        const typeBuffer = variable.type.split(",");
        const valueType = typeBuffer[typeBuffer.length - 1];
        if (valueType.includes("struct")) {
            return decodeStructType(variable, value, mainContract, storageVar);
        } else {
            return decodePrimitiveType(valueType, value);
        }
    } else if (variable.type.includes("array")) {
        const arrayTypeSplitted = variable.type.split(")");
        const arraySize = arrayTypeSplitted[arrayTypeSplitted.length - 1].split("_")[0];
        if (arraySize !== "dyn") {
            return decodeStaticArray(variable, value, mainContract, storageVar, Number(arraySize), functionStorage, completeSstore);
        } else {
            return decodeDynamicArray(variable, value, mainContract, storageVar, functionStorage,shaTraces);
        }
    } else if (variable.type.includes("struct")) {
        return decodeStructType(variable, value, mainContract, storageVar, shaTraces, functionStorage);
    } else {
        return decodePrimitiveType(variable.type, value, shaTraces, functionStorage);
    }
}

function decodePrimitiveType(type, value, shaTraces, functionStorage) {
    if (type.includes("uint")) {
        return Number(web3.utils.hexToNumber("0x" + value));
    } else if (type.includes("string")) {
        let decodedString = "";
        if (shaTraces && functionStorage[shaTraces[0].finalKey] != web3.utils.padLeft("0", 64)) {
            decodedString = decodeString(type,shaTraces, functionStorage);
        }

        if (decodedString.length <= 32) {
            let chars = value.split("0")[0];
            if (chars.length % 2 !== 0) chars = chars + "0";
            return web3.utils.hexToAscii("0x" + chars);
        } else {
            return web3.utils.hexToAscii("0x" + decodedString).replace(/\0/g, '');
        }
    } else if (type.includes("bool")) {
        return web3.eth.abi.decodeParameter("bool", "0x" + value);
    } else if (type.includes("bytes")) {
        // return JSON.stringify(web3.utils.hexToBytes("0x" + value)).replace("\"", "");
        return JSON.stringify(value);

    } else if (type.includes("address")) {
        return "0x" + value.slice(-40);
    } else if (type.includes("enum")) {
        let bigIntvalue = web3.eth.abi.decodeParameter("uint256", "0x" + value);
        return Number(bigIntvalue);
    }
    return value;
}
//TODO per decodificare la stringa potrei girare nella shatrace e mi tiro fuori i valori 
//Nel caso in cui la stringa sia >32 potrei andare a controllare se nel shatrace 
// è presente il keccak dello slot più l'indice dell'array 
//questo perché quando ho un striga io ho nella shaTrace ho le chiavi per gli slot delle stringhe 

function decodeString(type,shaTraces, functionStorage) {
    if(type.includes("array") && type.includes("dyn")){
        let arrayIndex = web3.utils.hexToNumber("0x" + functionStorage[shaTraces[0].hexStorageIndex])-1;
        let stringZeroPositionKeccak=web3.utils.keccak256("0x" + shaTraces[0].hexStorageIndex);
        let stringLengthHex=web3.utils.hexToNumber(stringZeroPositionKeccak)+BigInt(arrayIndex);
        let letStringSlotLength=web3.utils.numberToHex(stringLengthHex);
        let stringLengthNumber=functionStorage[letStringSlotLength.slice(2)];
        let stringLength=web3.utils.hexToNumber("0x" + stringLengthNumber);
        let slotDiff = stringLength % 64;
        let slotUsed = (stringLength - slotDiff) / 64; 
        if (slotDiff > 0) {
            slotUsed = slotUsed + 1;
        }
        let listOfBlock = "";
        let startString = web3.utils.keccak256(letStringSlotLength);
        for (let i = 0; i < slotUsed; i++) {
            let num = web3.utils.hexToNumber(startString);
            let bigNumberindex = BigInt(i);
            num = num + bigNumberindex;
            let slotResult = web3.utils.numberToHex(num).substring(2);
            listOfBlock = listOfBlock + (functionStorage[slotResult]);
        }
        return listOfBlock;
    }
    let stringLength = web3.utils.hexToNumber("0x" + functionStorage[shaTraces[0].hexStorageIndex]);
    let slotDiff = stringLength % 64;
    let slotUsed = (stringLength - slotDiff) / 64;
    if (slotDiff > 0) {
        slotUsed = slotUsed + 1;
    }

    let listOfBlock = "";
    let startString = shaTraces[0].finalKey;
    for (let i = 0; i < slotUsed; i++) {
        let num = web3.utils.hexToNumber("0x" + startString);
        let bigNumberindex = BigInt(i);
        num = num + bigNumberindex;
        let slotResult = web3.utils.numberToHex(num).substring(2);
        listOfBlock = listOfBlock + (functionStorage[slotResult]);
    }
    return listOfBlock;
}
funct

function decodeStaticArray(variable, value, mainContract, storageVar, arraySize, functionStorage, completeSstore) {
    let arrayStorageSlot = Number(variable.slot);
    const output = {};
    if (variable.type.includes("struct")) {
        const structType = variable.type.split("(")[2].split(")")[0];
        const getContract = getMainContractCompiled(mainContract);
        const structMembers = getStructMembersByStructType(structType, getContract);
        const arrayTotalSize = arraySize * structMembers.length;
        let counter = 0;
        let arrayIndex = -1;
        for (let i = arrayStorageSlot; i < arrayTotalSize + arrayStorageSlot; i++) {
            const storageVarDec = web3.utils.toDecimal("0x" + storageVar);
            if (counter === 0) arrayIndex++;
            if (storageVarDec === i) {
                const memberLabel = structMembers[counter].label;
                output.arrayIndex = arrayIndex;
                output.struct = structType;
                output[memberLabel] = decodePrimitiveType(structMembers[counter].type, value);
                return JSON.stringify(output);
            }
            if (counter === structMembers.length - 1) {
                counter = 0;
            } else {
                counter++;
            }
        }
    } else {
        if (typeof variable.index !== "undefined") {
            let counter = 0;
            for (let i = 0; i < completeSstore.length; i++) {
                const stack = completeSstore[i];
                if (stack[stack.length - 1] === storageVar) {
                    if (counter === variable.index) {
                        output.value = Number(web3.utils.hexToNumber("0x" + stack[stack.length - 3]));
                        return output;
                    } else {
                        counter++;
                    }
                }
            }
            return JSON.stringify(output);
        } else {
            let result=[];
            for (let i = 0; i < arraySize; i++) {
                const arrayStorageSlot = Number(variable.slot) + i;
                if (arrayStorageSlot === web3.utils.hexToNumber("0x" + storageVar)) {
                    //TODO: calcolo la dimensione dei dati dentro l'array 
                    //spezzo l'array in base alla dimensione dei dati
                    //calcolo l'output
                    if(variable.type.includes("uint")){
                        if(!variable.type.split("uint")[1].split(")")[0].includes("256")){
                            for (let j = 0; j < arraySize; j++) {
                                
                                const value = decodeStaticArrayOptimized(variable.type.split("uint")[1].split(")")[0], functionStorage, storageVar,j);
                                if(value!=''){
                                    
                                    result.push({
                                        arrayIndex:j,
                                        value:decodePrimitiveType(variable.type, value)
                                })
                                }
                                output.arrayIndex = j;
                                output.value = decodePrimitiveType(variable.type, value);
                            }
                        }else{
                            for(const storageVarKey in functionStorage){
                                let index=web3.utils.hexToNumber("0x" + storageVarKey.slice(2))-variable.slot;
                                result.push({
                                    arrayIndex:index,
                                    value:decodePrimitiveType(variable.type, functionStorage[storageVarKey].slice(2))
                                })
                            }
                        }
                    }else{
                        for(const storageVarKey in functionStorage){
                            let storageVarValue=functionStorage[storageVarKey];
                            if (!variable.type.includes("string")) {
                                storageVarValue=storageVarValue.slice(2);
                            }
                            let index=web3.utils.hexToNumber("0x" + storageVarKey.slice(2))-variable.slot;
                            result.push({
                                arrayIndex:index,
                                value:decodePrimitiveType(variable.type, storageVarValue)
                            })
                        }
                    }
                    
                    
                    console.log(result)
                    return JSON.stringify(result);
                }
            }
        }
    }
}
function decodeStaticArrayOptimized(typeSize,functionStorage,storageVar,cut){
    const storageStringLength = 64;
    const charsForElement = typeSize / 4;
    const elementNumberPerString = storageStringLength / charsForElement;
    const elementToDecode = storageStringLength - (cut * charsForElement);
    web3.utils.padLeft(functionStorage[storageVar].slice( elementToDecode - charsForElement,elementToDecode),62);
    return functionStorage[storageVar].slice( elementToDecode - charsForElement,elementToDecode);
}
function getMainContractCompiled(mainContract) {
    const testContract = JSON.parse(contractCompiled);
    for (const contract in testContract.contracts) {
        const firstKey = Object.keys(testContract.contracts[contract])[0];
        if (firstKey === mainContract) {
            return testContract.contracts[contract][firstKey];
        }
    }
}

function decodeStructType(variable, value, mainContract, storageVar, shaTraces, functionStorage) {
    const getContractCompiled = getMainContractCompiled(mainContract);
    const members = getStructMembersByVariableName(variable.name, getContractCompiled);
    const memberItem = {
        struct: variable.type.split("(")[1].split(")")[0],
    };
    members.forEach((member) => {
        const memberSlot = Number(member.slot) + Number(variable.slot);
        if (memberSlot === web3.utils.toDecimal("0x" + storageVar)) {
            memberItem[member.label] = decodePrimitiveType(member.type, value, shaTraces, functionStorage);
        }
    });
    return JSON.stringify(memberItem);
}

function getStructMembersByVariableName(variableName, mainContractCompiled) {
    let members = [];
    const storageLayout = mainContractCompiled.storageLayout.storage;
    storageLayout.forEach((item) => {
        if (item.label === variableName) {
            const structType = item.type;
            const storageTypes = mainContractCompiled.storageLayout.types;
            for (type in storageTypes) {
                if (type === structType) {
                    members = storageTypes[type].members;
                }
            }
        }
    });
    return members;
}

function getStructMembersByStructType(type, mainContractCompiled) {
    let members = [];
    const storageTypes = mainContractCompiled.storageLayout.types;
    for (const storageType in storageTypes) {
        if (storageType.includes(type)) {
            members = storageTypes[storageType].members;
        }
    }
    return members;
}

function decodeDynamicArray(variable, value, mainContract, storageVar, functionStorage,shaTraces) {
    const varibleSlotToNumber = web3.utils.numberToHex(variable.slot);
    const varibleSlotSliced = varibleSlotToNumber.slice(2);
    const slotPadded = web3.utils.padLeft(varibleSlotSliced, 64);
    const firstNonZeroIndex = web3.utils.hexToNumber('0x' + functionStorage[slotPadded].slice(2));
    const lastIndex = firstNonZeroIndex;
    let arrayStorageSlot = web3.utils.hexToNumber("0x" + storageVar.slice(2));
    const output = {
        arrayIndex: lastIndex
    };
    if (variable.type.includes("struct")) {
        const structType = variable.type.split("(")[2].split(")")[0];
        const getContract = getMainContractCompiled(mainContract);
        const structMembers = getStructMembersByStructType(structType, getContract);
        arrayStorageSlot = arrayStorageSlot + (lastIndex * structMembers.length);
        output.struct = structType;
        for (let i = 0; i < structMembers.length; i++) {
            const functionStorageIndex = arrayStorageSlot + i;
            const functionStorageIndexHex = web3.utils.numberToHex(functionStorageIndex);
            const numberToHex = functionStorageIndexHex.slice(2);
            const functionStorageIndexPadded = web3.utils.padLeft(numberToHex, 64);
            output[structMembers[i].label] = decodePrimitiveType(structMembers[i].type, functionStorage[functionStorageIndex.toString(16)]);
        }
        return JSON.stringify(output);
    } else if ((variable.type.includes("uint") || variable.type.includes("int")) && !variable.type.includes("256")) {
        let resultOutput=[];
        for(let i=0;i<lastIndex;i++){
            const value = optimezedArray(i+1, variable.type.split("uint")[1].split(")")[0], functionStorage, storageVar);
            resultOutput.push({
                arrayIndex:i,
                value:web3.utils.hexToNumber("0x" + value)
            })
        }

        // const value = optimezedArray(lastIndex, variable.type.split("uint")[1].split(")")[0], functionStorage, storageVar);
        // output.value = web3.utils.hexToNumber("0x" + value);
        return JSON.stringify(resultOutput);
    } else {
        if(variable.type.includes("string")){
            output.value = decodePrimitiveType(variable.type, functionStorage[storageVar],shaTraces,functionStorage);    
        }else{
            output.value = decodePrimitiveType(variable.type, functionStorage[storageVar].slice(2));
        }
        return JSON.stringify(output);
    }
}

function optimezedArray(arraySize, typeSize, functionStorage, slot) {
    const storageStringLength = 64;
    const charsForElement = typeSize / 4;
    const elementNumberPerString = storageStringLength / charsForElement;
    const ending = storageStringLength - (arraySize * charsForElement);
    if (arraySize <= elementNumberPerString - 1) {
        return functionStorage[slot].slice(ending, ending + charsForElement);
    } else {
        const arrayStorageSlot = Math.floor(arraySize / elementNumberPerString);
        const newSlot = BigInt("0x" + slot) + BigInt(arrayStorageSlot);
        const newStorageSlot = functionStorage[newSlot.toString(16).padStart(64, '0')];
        return newStorageSlot.slice(0, storageStringLength - (arraySize * charsForElement));
    }
}

function mergeVariableValues(arr) {
    return arr
    // return Object.values(arr.reduce((acc, item) => {
    //     if (typeof item.variableValue === "string" && item.variableValue.includes("arrayIndex")) {
    //         const variableValue = JSON.parse(item.variableValue);
    //         const arrayIndex = variableValue.arrayIndex;
    //         const key = `${arrayIndex}_${item.type}`;
    //         if (!acc[key]) {
    //             acc[key] = {
    //                 ...item,
    //                 variableValue: variableValue
    //             };
    //         } else {
    //             acc[key].variableValue = {
    //                 ...acc[key].variableValue,
    //                 ...variableValue
    //             };
    //         }
    //     } else {
    //         acc[item.variableName] = item;
    //     }
    //     return acc;
    // }, {})).map(item => ({
    //     ...item,
    //     variableValue: typeof item.variableValue === "object" ? JSON.stringify(item.variableValue) : item.variableValue
    // }));
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
module.exports = { optimizedDecodeValues };
