let networkName = "";
let web3Endpoint = "";
let apiKey = "";
let endpoint = "";
let web3 = null;
let _contractAddress = "";
const primitiveValue = ["uint", "int", "string", "bool", "address", "enum", "bytes"];
let contractCompiled = null;

const csvColumns = ["transactionHash", "debugTime", "decodeTime", "totalTime"];
//selezioni i casi da applicare in base alla shatrace 
//ovvero se ho un shatrace mi potrei trovare in un caso di mapping o array per prima cosa
//nel caso avessi una struttura non ho un shatrace tranne quando nella struttura ho array o mapping 
//se ho una stringa >32 ho una shatrace a questo punto verifico prima se sia una stringa o no
//se entro nel primo caso io salto tutte le casistiche sottostanti 
//le casisitiche sottostanti sono per tutti i valori dello storage

async function optimizedDecodeValues(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract, web3Variable, contractCompiledPassed) {
    web3 = web3Variable;
    contractCompiled = contractCompiledPassed;
    let decodedValues = [];
    let flag = true;
    let flagString32=true;
    // ("------SHAT TRACES------")
    // console.log(shaTraces)
    // console.log("------FUNCTION STORAGE------")
    // console.log(functionStorageconsole.log)
    
    for (const storageVar in functionStorage) {
        for (const shaTrace of shaTraces) {
            if (storageVar === shaTrace.finalKey) {
                const slotIndex = web3.utils.hexToNumber("0x" + shaTrace.hexStorageIndex);
                const contractVar = getContractVariable(slotIndex, contractTree, functionName, mainContract);
                //le struct dovrebbero essere considerate come variabili primitive 
                //nel caso in cui ho un stringa >32 creo una shatrace ma rigurada la string non la struttura
                //quindi devo comunque andare nel caso semplice
                if(contractVar[0].type.includes("struct")){
                    const getContractCompiled = getMainContractCompiled(mainContract);
                    const members = getStructMembersByVariableName(contractVar[0].name, getContractCompiled);
                    members.forEach((member) => {
                        if(member.type.includes("string")){
                            console.log("errore")
                            flagString32=false;
                        }
                    })
                    // decodeStorageValue(variable, value, mainContract, storageVar, functionStorage, completeSstore, shaTraces)
                }
                if (flagString32 &&(!contractVar[0].type.includes("string") || contractVar[0].type.includes("array") || contractVar[0].type.includes("mapping"))) {
                    flag = false;
                    console.log("Primo")
                    const decodedValue = decodeStorageValue(contractVar[0], functionStorage[storageVar], mainContract, storageVar, functionStorage, null, shaTraces);
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
                    console.log("contraceVar",contractVar)
                    if (contractVar.length > 1 ) {
                        flagCase2=false;
                        console.log("Secondo")
                        const updatedVariables = newReadVarFormOffset(contractVar, functionStorage[storageVar]);
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
                            console.log("Quarto")
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
                }else if(contractVariables.length==0 && i==contractTree[contractId].storage.length-1){
                    contractVariables.push(contractTree[contractId].storage[i]);
                }
            }
        }
    }
    return contractVariables;
}
//seleziono la variabile da decodificare in base al tipo della variabile 
function decodeStorageValue(variable, value, mainContract, storageVar, functionStorage, completeSstore, shaTraces) {
    if (variable.type.includes("mapping")) {
        const typeBuffer = variable.type.split(",");
        const valueType = typeBuffer[typeBuffer.length - 1];
        if (valueType.includes("struct")) {
            return decodeStructType(variable, value, mainContract, storageVar,shaTraces, functionStorage);
        } else if (valueType.includes("array")) {
            const arrayTypeSplitted = valueType.split(")");
            const arraySize = arrayTypeSplitted[arrayTypeSplitted.length - 2].split("_")[0];
            if (arraySize !== "dyn") {
                return decodeStaticArray(variable, value, mainContract, storageVar, Number(arraySize), functionStorage, completeSstore);
            } else {
                return decodeDynamicArrayIntoMapping(variable,functionStorage,arrayTypeSplitted[0]);
                // return decodeDynamicArray(variable, value, mainContract, storageVar, functionStorage,shaTraces);
            }
        }else {
            return decodePrimitiveType(valueType, value,shaTraces,functionStorage);
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

//Decodifico una variabile primitiva 
function decodePrimitiveType(variable, value, shaTraces, functionStorage) {
    let type=variable.type || variable;
    if (type.includes("uint")) {
        return Number(web3.utils.hexToNumber("0x" + value));
    } else if (type.includes("string")) {
        let decodedString = "";
        if (shaTraces){
            if(shaTraces.length>0){
                if (functionStorage[shaTraces[0].finalKey] !== web3.utils.padLeft("0", 64)) {
                    decodedString = decodeString(variable,shaTraces, functionStorage);
                }
            }
        }
        //TODO da verificare queste if a cascata non sono molto eleganti
        if (decodedString.length <= 32 && decodedString!="") {
            let chars = value.split("0")[0];
            if (chars.length % 2 !== 0) chars = chars + "0";
            return web3.utils.hexToAscii("0x" + value);
        } else if(decodedString===""){
            let chars = value.split("0")[0];
            if (chars.length % 2 !== 0) chars = chars + "0";
            return web3.utils.hexToAscii("0x" + chars);
        }else{
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
//per decodificare la stringa potrei girare nella shatrace e mi tiro fuori i valori 
//Nel caso in cui la stringa sia >32 potrei andare a controllare se nel shatrace 
// è presente il keccak dello slot più l'indice dell'array 
//questo perché quando ho un striga io ho nella shaTrace ho le chiavi per gli slot delle stringhe 


//dallo slot io posso ottenermi la chiave di qualsiasi cosa presente sia nella shatrace che nello storage
//Se io dallo slot mi tiro fuori la chiave controllo se quella chiave è presente nello storage
//prima di fare la decodifica in stringa del valore contenuto in quella chiave io rifaccio il keccak della chiave e lo cerco nello storage
//Se esisto lo decodifico e incremento il keccak di 1 e lo ricerco cosi fino a quando non trovo più nulla


//ora posso decodificare le stringhe indipendentemente se sono più o meno lunghe di 32 
//il problema è che se ho due stringhe separate l'output mi viene condensato 
//TODO capire se è il caso di spezzare il modo in cui vengono estratte oppure se magari si può correggere in fase di output
function decodeString(variable,shaTraces, functionStorage) {
    let type=variable.type || variable;
    if(type.includes("array") && type.includes("dyn")){
        return decodeStringOnArray(variable,shaTraces,functionStorage);
    }
    if(shaTraces){
        if(functionStorage[shaTraces[0].hexStorageIndex]){
            let stringLengthHex= functionStorage[shaTraces[0].hexStorageIndex]
            let stringLength = web3.utils.hexToNumber("0x" + stringLengthHex);
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
        }else if(functionStorage[shaTraces[0].finalKey]) {
            return decodeStringInMapping(variable,shaTraces,functionStorage);
        }
    }

}
//TODO: Ho messo la chiave dentro la shatrace 
//basta che combino la chiave con li slot e ottengo la chiave del mapping
function decodeStringInMapping(variable,shaTraces,functionStorage){
    let listOfBlock="";
    //cercare la chiave del mapping
    let slotInBytes=shaTraces[0].hexStorageIndex;
    //Siccome do per scontato che sto cercando una stringa in un mapping faccio la concatenazione delle chiavi 
    for(const shaTrace of shaTraces){
        //calcolo la chiave del mapping con lo slot e l'indice che gli passo 
        //poi vedo se quella chiave è presente nello storage

        //Io per poter trovare tutte le informazioni di cui ho bisogno
        //utilizzo i dati "semplici"
        // nel caso di chiavi complesse io le vado a calcolare
        //quindi sarebbe ripetitivo iterare per una chiave complessa da cui ho già ottenuto tutte le info
        if(shaTrace.finalKey!==web3.utils.keccak256("0x"+shaTrace.hexKey.slice(2))){
            let mappingKey="0x"+shaTrace.hexKey
            let concatKey=mappingKey+slotInBytes;

            let keccakOfConcatKey=web3.utils.keccak256(concatKey);
            if(functionStorage[keccakOfConcatKey.slice(2)]){
                console.log("chiave trovata nello storage")
                //calcolo la chiave complessa in caso di una stringa >32 
                let keccakOfKeccak=web3.utils.keccak256(keccakOfConcatKey);
                //se ho una stringa >32 entro dentro l'if perche significa che ho trovato una chiave
                //generata da un'altra chiave
                if(functionStorage[keccakOfKeccak.slice(2)]){
                    console.log("sono nel caso di una stringa >32")
                    //nel blocco keccakConcatenato ho la lunghezza della stringa 
                    
                    let i = 0;
                    let tempKeccakOfkeccak=keccakOfKeccak;
                    while(functionStorage[keccakOfKeccak.slice(2)] && functionStorage[tempKeccakOfkeccak.slice(2)]){
                        listOfBlock+=functionStorage[tempKeccakOfkeccak.slice(2)];
                        i++;
                        let newKeyInt=web3.utils.hexToNumber(keccakOfKeccak)+BigInt(i);
                        tempKeccakOfkeccak=web3.utils.numberToHex(newKeyInt);
                    }
                    //se entro dentro l'else significa che la stringa è <32
                    //quindi il contenuto lo trovo direttamente nella chiave combinata "semplice"
                }else{
                    listOfBlock=functionStorage[keccakOfConcatKey.slice(2)];
                }
            }
        }
    }
    return listOfBlock;
}
//Do per scontato che sono in un array 
function decodeStringOnArray(variable,shaTraces,functionStorage){
    //mi tiro fuori il keccak dello slot
    let result="";
    let slotInBytes=web3.utils.padLeft(web3.utils.numberToHex(variable.slot),64);
    let slotKeccak=web3.utils.keccak256(slotInBytes);
    let arrayLenghtInBytes=functionStorage[slotInBytes.slice(2)];
    let arrayLengthInNumber=web3.utils.hexToNumber("0x" + arrayLenghtInBytes);
    let keccakToBigInt=web3.utils.hexToNumber("0x"+slotKeccak.slice(2));
    let arraIndexBigInt=BigInt(arrayLengthInNumber-1);
    let slotKeccakPlusIndex=keccakToBigInt+arraIndexBigInt;
    let keccakToBytes=web3.utils.numberToHex(slotKeccakPlusIndex);
    let keccakOfKeccak=web3.utils.keccak256(keccakToBytes);
    if(functionStorage[keccakOfKeccak.slice(2)]){
        console.log("chiave complessa")
        for(let i=0;i<=arrayLengthInNumber;i++){
            let newKey=web3.utils.hexToNumber(keccakOfKeccak)+BigInt(i);
            let newKeyHex=web3.utils.numberToHex(newKey);
            if(functionStorage[newKeyHex.slice(2)]){
                result+=(functionStorage[newKeyHex.slice(2)]);
            }
        }
        return result;
    }else{
        console.log("caso di stringa semplice")
        for(let i=0-1;i<arrayLengthInNumber;i++){
            let newKey=keccakToBigInt+BigInt(i);
            let newKeyHex=web3.utils.numberToHex(newKey);
            if(functionStorage[newKeyHex.slice(2)]){
                result+=(functionStorage[newKeyHex.slice(2)]);
            }
        }
        return result;
    }
}

function decodeStaticArray(variable, value, mainContract, storageVar, arraySize, functionStorage, completeSstore) {
    console.log("decodeStaticArray")
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
                    //calcolo la dimensione dei dati dentro l'array 
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
                            //TODO: in questa transazione 7596491 ho due array definiti di lunghezza 5
                            // il problema è che per il primo array l'indice viene calcolato correttamente 
                            //mentre per il secondo array io dovrei togliere la lunghezza del primo array oltre che dello slot
                            // il problema è che la shatrace è vuota 
                            // nel funcion storage ci sono solo i due array 
                            //quindi ho prendo le leunghezze dei vari array quando estraggo i dati dalla struttura oppure non so 

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
    if(variable.type.includes("mapping")){
        members.forEach((member) => {
            let computeMappingKey=web3.utils.keccak256("0x"+shaTraces[0].hexKey+shaTraces[0].hexStorageIndex);
            console.log(computeMappingKey)
            let keyToInt=web3.utils.hexToNumber(computeMappingKey);
            const memberSlot = BigInt(Number(member.slot)) + keyToInt;
            let keyToBytes=web3.utils.numberToHex(memberSlot);
            if (functionStorage[keyToBytes.slice(2)]) {
                memberItem[member.label] = decodePrimitiveType(member.type, functionStorage[keyToBytes.slice(2)], shaTraces, functionStorage);
            }
        });
    }else{
        // function decodeStorageValue(variable, value, mainContract, storageVar, functionStorage, completeSstore, shaTraces)
        members.forEach((member) => {
            console.log(member)
            // const memberSlot = Number(member.slot) + Number(variable.slot);
            // if (memberSlot === web3.utils.toDecimal("0x" + storageVar)) {
            //     memberItem[member.label] = decodePrimitiveType(member.type, value, shaTraces, functionStorage);
            // }
            let memberNumberSlot = Number(member.slot);
            memberNumberSlot+=Number(variable.slot);
            member.slot=String(memberNumberSlot);
            memberItem[member.label] = decodeStorageValueIntoStruct(member, value, mainContract, storageVar, functionStorage, null, shaTraces);
        });
    }
return JSON.stringify(memberItem);
}
//decodifica le variabili all'interno di una struttura 
function decodeStorageValueIntoStruct(variable, value, mainContract, storageVar, functionStorage, completeSstore, shaTraces) {

    if (variable.type.includes("mapping")) {
        const typeBuffer = variable.type.split(",");
        const valueType = typeBuffer[typeBuffer.length - 1];
        if (valueType.includes("struct")) {
            return decodeStructType(variable, value, mainContract, storageVar,shaTraces, functionStorage);
        } else if (valueType.includes("array")) {
            const arrayTypeSplitted = valueType.split(")");
            const arraySize = arrayTypeSplitted[arrayTypeSplitted.length - 2].split("_")[0];
            if (arraySize !== "dyn") {
                return decodeStaticArray(variable, value, mainContract, storageVar, Number(arraySize), functionStorage, completeSstore);
            } else {
                return decodeDynamicArrayIntoMapping(variable,functionStorage,arrayTypeSplitted[0]);
                // return decodeDynamicArray(variable, value, mainContract, storageVar, functionStorage,shaTraces);
            }
        }else {
            return decodePrimitiveType(valueType, value,shaTraces,functionStorage);
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
//tiro fuori le variabili all'iterno delle variabili
function getStructMembersByVariableName(variableName, mainContractCompiled) {
    let members = [];
    const storageLayout = mainContractCompiled.storageLayout.storage;
    storageLayout.forEach((item) => {
        if (item.label===variableName) {
            const structType = item.type;
            const storageTypes = mainContractCompiled.storageLayout.types;
            if(structType.includes("mapping")){
                let temp=structType.split(",")[1];
                let structInsideMapping=temp.substring(0,temp.length-1);
                for (type in storageTypes) {
                    if (type===structInsideMapping) {
                        members= storageTypes[type].members;
                    }
                }
            }else{
                for (type in storageTypes) {
                    if (type.includes(structType)) {
                        members = storageTypes[type].members;
                    }
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
//TODO funzione per estrarre un array il valore di un array dinamico dentro un mapping
//il problema è che è difficile trovare la chiave dell'array dentro il functionStorage
//perché non trovo l'input della chiave del mapping 

//Il problema della funzione è che se metto una chiave grande ho un loop lunghissimo 
//TODO: Trovare una soluzione 
function decodeDynamicArrayIntoMapping(variable, functionStorage,variableType) {
    let i = 0;
    while(true){
        //prima trovo la chiave del mapping 
        let indexInHex = web3.utils.padLeft(web3.utils.numberToHex(i).slice(2),64);
        let slotInHex= web3.utils.padLeft(web3.utils.numberToHex(variable.slot).slice(2),64);
        let keyMapping=web3.utils.keccak256("0x"+indexInHex+slotInHex);
        if(functionStorage[keyMapping.slice(2)]){
            return JSON.stringify(decodeArrayFromMapping(variableType,keyMapping.slice(2),functionStorage));
        }
        i++;
    }
}
//Funzione che serve per trovare la chiave dell'array dentro il mapping 

function  decodeArrayFromMapping(variable,keyMapping,functionStorage){
    let arrayLength=web3.utils.hexToNumber("0x"+functionStorage[keyMapping]);
    let arrayKey=web3.utils.keccak256("0x"+keyMapping);
    let result=[];
    for(let i=0;i<arrayLength;i++){
        let keyToNumber=web3.utils.hexToNumber(arrayKey);
        let newKey=web3.utils.numberToHex(keyToNumber+BigInt(i));
        if(functionStorage[newKey.slice(2)]){
            result.push({
                arrayIndex:i,
                value:decodePrimitiveType(variable,functionStorage[newKey.slice(2)])
            });
        }
    }
    return result;
}
//TODO quando faccio il decode di una array dinamico dentro un mapping 
//i valori sono diversi. Dentro il function storage ho tutte key non trovo più lo slot 
function decodeDynamicArray(variable, value, mainContract, storageVar, functionStorage,shaTraces) {
    const varibleSlotToNumber = web3.utils.numberToHex(variable.slot);
    const varibleSlotSliced = varibleSlotToNumber.slice(2);
    const slotPadded = web3.utils.padLeft(varibleSlotSliced, 64);
    const firstNonZeroIndexBytes=functionStorage[slotPadded];
    if(firstNonZeroIndexBytes){
        const firstNonZeroIndex = web3.utils.hexToNumber('0x' + firstNonZeroIndexBytes.slice(2));
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
                output.value = decodePrimitiveType(variable, functionStorage[storageVar],shaTraces,functionStorage);    
            }else{
                output.value = decodePrimitiveType(variable, functionStorage[storageVar].slice(2));
            }
            return JSON.stringify(output);
        }
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
    // return arr
    return Object.values(arr.reduce((acc, item) => {
        if (typeof item.variableValue === "string" && item.variableValue.includes("arrayIndex")) {
            const variableValue = JSON.parse(item.variableValue);
            const arrayIndex = variableValue.arrayIndex;
            const key = `${arrayIndex}_${item.type}`;
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
            acc[item.variableName] = item;
        }
        return acc;
    }, {})).map(item => ({
        ...item,
        variableValue: typeof item.variableValue === "object" ? JSON.stringify(item.variableValue) : item.variableValue
    }));
}
function newReadVarFormOffset(variables, value) {
    const storageStringLength = 64;
    for (let i=0;i<variables.length;i++){
        variables[i].value="";
        if(variables[i+1]!== undefined){
            if(variables[i].type.includes("uint") && !variables[i].type.includes("256")){
                let typeSize=variables[i].type.split("uint")[1].split(")")[0]
                const charsForElement = typeSize / 4;
                //*2 perché la lunghezza di uno slot in memoria è da 64 invece che da 32 
                const endOfTheElement = storageStringLength - (variables[i].offset * 2);
                const startOfTheElement = endOfTheElement - charsForElement;
                let result = value.slice(startOfTheElement, endOfTheElement);
                variables[i].value=web3.utils.padLeft(result,64);
            }else if(variables[i].type.includes("bytes") && !variables[i].type.includes("32")){
                let typeSize=variables[i].type.split("bytes")[1].split(")")[0]
                const charsForElement = typeSize * 2;
                //*2 perché la lunghezza di uno slot in memoria è da 64 invece che da 32 
                const endOfTheElement = storageStringLength - (variables[i].offset * 2);
                const startOfTheElement = endOfTheElement - charsForElement;
                let result = value.slice(startOfTheElement, endOfTheElement);
                variables[i].value=web3.utils.padLeft(result,64);
            }else {
                const endOfTheElement = storageStringLength - (variables[i+1].offset * 2);
                const startOfTheElement = storageStringLength - endOfTheElement;
                let result = value.slice(startOfTheElement, endOfTheElement);
                variables[i].value=web3.utils.padLeft(result,64);
            }
        }else{
            const endOfTheElement = storageStringLength - (variables[i].offset * 2);
            const startOfTheElement = storageStringLength - endOfTheElement;
            let result = value.slice(startOfTheElement, endOfTheElement);
            variables[i].value=web3.utils.padLeft(result,64);
        }
        
    }
    console.log(variables)
   return variables;
    
}
//TODO Fix this part of the code 0x85839D9140Ca6E7E4306A920b7bBbA84492D3d67 try with this contract
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
                let temp=  len - nextOffset;
                const slicedWord = fullWord.slice(nextOffset,temp);
                variables[i].value = slicedWord.join('');
            } else {
                const nextOffset = (variables[i + 1].offset) * 2;
                let temp = len - nextOffset;
                const slicedWord = fullWord.slice(nextOffset,temp);
                variables[i].value = slicedWord.join('');
            }
        } else {
            variables[i].value = fullWord.join('');
        }
    }
    return variables;
}
module.exports = { optimizedDecodeValues };
