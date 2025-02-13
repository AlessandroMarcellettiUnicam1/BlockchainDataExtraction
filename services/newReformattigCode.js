let web3;
async function optimizedDecodeValues(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract, web3Variable, contractCompiledPassed) {
    web3 = web3Variable;
    contractCompiled = contractCompiledPassed;
    console.log("------SHAT TRACES------")
    console.log(shaTraces)
    console.log("------FUNCTION STORAGE------")
    console.log(functionStorage)
    const emptyVariable="0000000000000000000000000000000000000000000000000000000000000000";

    let shatracesProcessed=[];
    let resultOfPreprocessing=[]
    for( const shatrace of shaTraces){

        //nel caso di una chiave complessa ottengo sempre un solo elemento da questa chiamata
        //TODO verificare affermazione di sopra
            let slotNumber=web3.utils.hexToNumber("0x" + shatrace.hexStorageIndex);
            if(slotNumber<300){
                
                let variabilePerSlot=getContractVariable(slotNumber,contractTree,functionName,mainContract)[0];
                //shatraceProcessed lo passo anche al read complex data perchè vado ad inserirci tutte quelle chiavi che ottengo
                //durante magari l'estrazioni di una stringa
                //dove nella shatrace trovo un solo elemento mentre nel funcitonstorage trovo tutte le chiavi complesse che contengono la stringa
                resultOfPreprocessing.push(readComplexData(variabilePerSlot,shatrace,functionStorage,shatracesProcessed))
                shatracesProcessed.push(shatrace.finalKey);
                shatracesProcessed.push(shatrace.hexStorageIndex)
            }else {
                console.log("chiave complessa")
            }
    }
//tiro fuori che cosa ho dentro il function storage in base agli slot di memori che leggo 
    let temp=getMainContractCompiled(mainContract);
    for(const storageKey in functionStorage){
        if(!shatracesProcessed.includes(storageKey)){
            let slotNumber=web3.utils.hexToNumber("0x" + storageKey);
            let variablePerSlot=getContractVariable(slotNumber,contractTree,functionName,mainContract);
            let temp=[];
            //Se ho più variabili per slot le tiro fuori una ad una e assegno il valore alla variabile
            if (variablePerSlot.length>1){
                newReadVarFormOffset(variablePerSlot,functionStorage).forEach((e)=>{
                    temp.push(e);
                })
            }else {
                //c'è solo una variabile per quello slot 
                //parlo sempre di variabili primitive 
                //per primitive considero anche gli array 
                variablePerSlot[0].value=functionStorage[variablePerSlot[0].contentSlot];
                temp.push(variablePerSlot[0]);
            }
            temp.forEach((e)=>{
                resultOfPreprocessing.push(e)
            })
        }
    }
    let result=[];
    console.log("resultOfPreprocessing")
    console.log(resultOfPreprocessing)
    resultOfPreprocessing.forEach((element)=>{
        let resultElement=decodeValue(element,functionStorage);
        if(resultElement.length!=undefined){
            result.push(resultElement);
        }else{
            resultElement.forEach((e)=>{
                result.push(e);
            })
        }
    })
    console.log(result)
    
}



//la struttura che mi rappresenta la variabile
//la shatrace è specifica per una varibile 
function readComplexData(variable, shaTraces, functionStorage,shatracesProcessed){
    if(variable.type.includes("struct")){
    }else if (variable.type.includes("mapping")){
    }else if (variable.type.includes("string")){
        return readString(variable,shaTraces,functionStorage,shatracesProcessed);
    }else if(variable.type.includes("array")){
        return readArray(variable,shaTraces,functionStorage,shatracesProcessed);
    }
}

function readString (variable,shaTraces ,functionStorage,shatracesProcessed) {
    //Ci sono alcuni casi in cui mi viene generato un slot tramite keccak
    //Siccome la string <32 lo slot non viene utilizzato
    if(functionStorage[shaTraces.finalKey] !== web3.utils.padLeft("0", 64)){
        let stringLength=web3.utils.hexToNumber("0x"+functionStorage[variable.contentSlot]);
        let slotDiff = stringLength % 64;
        let slotUsed = (stringLength - slotDiff) / 64;
        if (slotDiff > 0) {
            slotUsed = slotUsed + 1;
        }
        let listOfBlock = "";
        let startString = shaTraces.finalKey;
        for (let i = 0; i < slotUsed; i++) {
            let num = web3.utils.hexToNumber("0x" + startString);
            let bigNumberindex = BigInt(i);
            num = num + bigNumberindex;
            let slotResult = web3.utils.numberToHex(num).substring(2);
            shatracesProcessed.push(slotResult);
            listOfBlock = listOfBlock + (functionStorage[slotResult]);
            
        }
        variable.value=listOfBlock;
        return variable;
    }else{
        variable.value=functionStorage[variable.contentSlot];
        return variable;
    }
}

function readArray(variable,shaTraces ,functionStorage,shatracesProcessed){
    if(variable.type.includes("uint")){
        if(variable.type.includes("dyn")){
            return readUintArrayDynamic(variable,shaTraces,functionStorage,shatracesProcessed);
        }else{
            return readUintArray(variable,shaTraces,functionStorage,shatracesProcessed);
        }
    }else if(variable.type.includes("bytes")){
        if(variable.type.includes("dyn")){
            return readBytesArrayDynamic(variable,shaTraces,functionStorage,shatracesProcessed);
        }else{
            return readBytesArray(variable,shaTraces,functionStorage,shatracesProcessed);
        }
    }else{
        return readArrayComplex(variable,shaTraces,functionStorage,shatracesProcessed);
    }
}
function readArrayComplex(variable,shaTraces,functionStorage,shatracesProcessed){

}
function readBytesArrayDynamic(variable,shaTraces ,functionStorage,shatracesProcessed){
    if(variable.type.includes("32")){
        let keyOfSlot=web3.utils.keccak256("0x"+variable.contentSlot);
        variable.value=[];
        if(shaTraces.indexSum==undefined){
            shatracesProcessed.push(keyOfSlot)
            variable.value.push(functionStorage[keyOfSlot.slice(2)]);
        }else{
            let keySlotToNumber=web3.utils.hexToNumber(keyOfSlot);
            let keyResult=web3.utils.numberToHex(keySlotToNumber+BigInt(shaTraces.indexSum)).slice(2);
            shatracesProcessed.push(keyResult)
            variable.value.push(functionStorage[keyResult]);
        }
        return variable;
    }else{
        return decodeOptimizeDynamicArray(variable,shaTraces ,functionStorage,shatracesProcessed);
    }
}


function readUintArrayDynamic(variable,shaTraces ,functionStorage,shatracesProcessed){
    if(variable.type.includes("256")){
        let keyOfSlot=web3.utils.keccak256("0x"+variable.contentSlot);
        variable.value=[];
        if(shaTraces.indexSum==undefined){
            shatracesProcessed.push(keyOfSlot)
            variable.value.push(functionStorage[keyOfSlot.slice(2)]);
        }else{
            let keySlotToNumber=web3.utils.hexToNumber(keyOfSlot);
            let keyResult=web3.utils.numberToHex(keySlotToNumber+BigInt(shaTraces.indexSum)).slice(2);
            shatracesProcessed.push(keyResult)
            variable.value.push(functionStorage[keyResult]);
        }
        return variable;
    }else{
        return decodeOptimizeDynamicArray(variable,shaTraces ,functionStorage,shatracesProcessed);
    }
}

function decodeOptimizeDynamicArray(variable,shaTraces ,functionStorage,shatracesProcessed){
    if(variable.type.includes("uint")){
       return decodeOptimizeUintDynamicArray(variable,shaTraces ,functionStorage,shatracesProcessed);
    }else if(variable.type.includes("bytes")){
        return decodeOptimizeBytesDynamicArray(variable,shaTraces ,functionStorage,shatracesProcessed);
    }
   
}
function decodeOptimizeBytesDynamicArray(variable,shaTraces ,functionStorage,shatracesProcessed){
    console.log("variable bytes ")
}
function decodeOptimizeUintDynamicArray(variable,shaTraces ,functionStorage,shatracesProcessed){
    let result=[];
    let keySlot=web3.utils.keccak256("0x"+variable.contentSlot).slice(2);
    variable.value=functionStorage[keySlot]
    let typeSize=parseInt(variable.type.split(")")[0].split("uint")[1]);
    let arrayLength=web3.utils.hexToNumber("0x"+functionStorage[variable.contentSlot]);
    let charsForElement = typeSize / 4;
    const slotLength = 64;
    for (let i=0;i<arrayLength;i++){
        let startOfTheElement = slotLength - (i*charsForElement);
        let endOfTheElement = startOfTheElement - charsForElement;
        let valueExatracted = variable.value.slice(endOfTheElement,startOfTheElement);
        let valuePadded=web3.utils.padLeft(valueExatracted,64);
        result.push(valuePadded);
    }
    variable.value=result;
    return variable
}
function readUintArray(variable,shaTraces,functionStorage,shatracesProcessed){

}
//i valori primitivi li posso dividere in primitivi completi o partiziali 
//i parziali sono gli array 
//i mapping li posso escludere perché nella decodifica prendo direttamente il valore del mapping 

function decodeValue(variable,functionStorage){
    //take the first type 
    if(!variable.type.includes("(")){
        return decodePrimitive(variable,functionStorage);
    }else{
        //se trovo una parantesi mi trovo in un caso di decodifica parziale
        return decodePartialPrimitive(variable,functionStorage);
    }
}
function decodePrimitive(variable,functionStorage){
    let type=variable.type;
    let value = variable.value;
    if (type.includes("uint")) {
        return Number(web3.utils.hexToNumber("0x" + value));
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
    }else if (type.includes("string")) {
        return web3.utils.hexToAscii("0x" + value).replace(/\0/g, '');
    }
    return value;
}

//funzione per tirare fuori i valori da un array 
function decodePartialPrimitive(variable,functionStorage){
    let type=variable.type;
    let value = variable.value;
    if (type.includes("enum")) {
        let bigIntvalue = web3.eth.abi.decodeParameter("uint256", "0x" + value);
        return Number(bigIntvalue);
    }else if (type.includes("array")){
        return decodeArray(variable,functionStorage);
    }
}
function decodeArray(variable,functionStorage){
    if(variable.type.includes("uint")){
        if(variable.type.includes("dyn")){
            return decodeUintArrayDynamic(variable,functionStorage);
        }else{
            return decodeUintArray(variable,functionStorage);
        }
    }
    if(variable.type.includes("bytes")){
        if(variable.type.includes("dyn")){
            return decodeBytesArrayDynamic(variable,functionStorage);
        }else{
            return decodeBytesArray(variable,functionStorage);
        }
    }else{
        return decodeOtherTypeArray(variable,functionStorage);
    }
    
}
function decodeOtherTypeArray(variable,functionStorage){
    if(variable.value.length!==undefined){
        return decodePrimitive(variable,functionStorage);
    }else{
        variable.value.forEach((element)=>{
            resultVariable.value="";
            resultVariable.value=element;
            result.push(decodePrimitive(resultVariable,functionStorage));
        }) 
        return result;
    }
}
function decodeBytesArrayDynamic(variable,functionStorage){
    if(variable.type.includes("32")){
        return "0x"+variable.value;
    }else{
        let typeSize=parseInt(variable.type.split(")")[0].split("uint")[1]);
        let arrayLength=parseInt(variable.type.split(")")[1].split("_storage")[0]);
        let result=[];
        let charsForElement = typeSize * 2;
        const slotLength = 64;
        for (let i=0;i<arrayLength;i++){
            let startOfTheElement = slotLength - (i*charsForElement);
            let endOfTheElement = startOfTheElement - charsForElement;
            let valueExatracted = variable.value.slice(endOfTheElement,startOfTheElement);
            let valuePadded=web3.utils.padLeft(valueExatracted,64);
            result.push("0x"+valuePadded);
        }
        return result;
    }
}
function decodeBytesArray(variable,functionStorage){
    // if(variable.type.includes("32")){
    //     return "0x"+variable.value;
    // }else{
    //     let typeSize=parseInt(variable.type.split(")")[0].split("bytes")[1]);
    //     let arrayLength=parseInt(variable.type.split(")")[1].split("_storage")[0]);
    //     let result=[];
    //     let charsForElement = typeSize * 2;
    //     const slotLength = 64;
    //     for (let i=0;i<arrayLength;i++){
    //         let startOfTheElement = slotLength - (i*charsForElement);
    //         let endOfTheElement = startOfTheElement - charsForElement;
    //         let valueExatracted = variable.value.slice(endOfTheElement,startOfTheElement);
    //         let valuePadded=web3.utils.padLeft(valueExatracted,64);
    //         result.push("0x"+valuePadded);
    //     }
    //     return result;

    // }
    
}

function decodeUintArray(variable,functionStorage){
    if(variable.type.includes("256")){
        return web3.utils.hexToNumber("0x"+variable.value);
    }else{
        let typeSize=parseInt(variable.type.split(")")[0].split("uint")[1]);
        let arrayLength=parseInt(variable.type.split(")")[1].split("_storage")[0]);
        let result=[];
        let charsForElement = typeSize / 4;
        const slotLength = 64;
        for (let i=0;i<arrayLength;i++){
            let startOfTheElement = slotLength - (i*charsForElement);
            let endOfTheElement = startOfTheElement - charsForElement;
            let valueExatracted = variable.value.slice(endOfTheElement,startOfTheElement);
            let valuePadded=web3.utils.padLeft(valueExatracted,64);
            result.push(web3.utils.hexToNumber("0x"+valuePadded));
        }
        return result;
    }
}
//decode uintArrayDynamic
function decodeUintArrayDynamic(variable,functionStorage){
        let result=[];
        let resultVariable=variable;
        variable.value.forEach((element)=>{
            resultVariable.value="";
            resultVariable.value=element;
            result.push(decodePrimitive(resultVariable,functionStorage));
        }) 
        return result;
}

function getContractVariable(slotIndex, contractTree, functionName, mainContract) {
    let contractVariables = [];

    for (const contractId in contractTree) {
        if (contractTree[contractId].name === mainContract) {
            for (let i = 0; i < contractTree[contractId].storage.length; i++) {
                if (Number(contractTree[contractId].storage[i].slot) === Number(slotIndex)) {
                    let variable={
                        name:contractTree[contractId].storage[i].name,
                        type:contractTree[contractId].storage[i].type,
                        slot:contractTree[contractId].storage[i].slot,
                        offset:contractTree[contractId].storage[i].offset,
                        contentSlot:web3.utils.padLeft( web3.utils.numberToHex(slotIndex).slice(2),64)
                    }
                    contractVariables.push(variable);
                } else if (i < contractTree[contractId].storage.length - 1) {
                    if (Number(contractTree[contractId].storage[i].slot) <= Number(slotIndex) && Number(contractTree[contractId].storage[i + 1].slot) > Number(slotIndex)) {
                        // contractVariables.push(contractTree[contractId].storage[i]);
                        let variable={
                            name:contractTree[contractId].storage[i].name,
                            type:contractTree[contractId].storage[i].type,
                            slot:contractTree[contractId].storage[i].slot,
                            offset:contractTree[contractId].storage[i].offset,
                            contentSlot:web3.utils.padLeft( web3.utils.numberToHex(slotIndex).slice(2),64)
                        }
                        contractVariables.push(variable);
                    }
                }else if(contractVariables.length==0 && i==contractTree[contractId].storage.length-1){
                    // contractVariables.push(contractTree[contractId].storage[i]);
                    let variable={
                        name:contractTree[contractId].storage[i].name,
                        type:contractTree[contractId].storage[i].type,
                        slot:contractTree[contractId].storage[i].slot,
                        offset:contractTree[contractId].storage[i].offset,
                        contentSlot:web3.utils.padLeft( web3.utils.numberToHex(slotIndex).slice(2),64) 
                    }
                    contractVariables.push(variable);
                }
            }
        }
    }
    return contractVariables;
}


function getStructMembersByVariable(variable, mainContractCompiled) {
    let members = [];
    const storageLayout = mainContractCompiled.storageLayout.storage;
    storageLayout.forEach((item) => {
        if (item.label===variable.name) {
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

function getMainContractCompiled(mainContract) {
    const testContract = JSON.parse(contractCompiled);
    for (const contract in testContract.contracts) {
        const firstKey = Object.keys(testContract.contracts[contract])[0];
        if (firstKey === mainContract) {
            return testContract.contracts[contract][firstKey];
        }
    }
}
function newReadVarFormOffset(variables, functionStorage) {
    const storageStringLength = 64;
    for (let i=0;i<variables.length;i++){
        let value = functionStorage[variables[i].contentSlot];
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
                const startOfTheElement = storageStringLength - (variables[i].offset * 2);
                let result = value.slice(endOfTheElement,startOfTheElement);
                variables[i].value=web3.utils.padLeft(result,64);
            }
        }else{
            const endOfTheElement = storageStringLength - (variables[i].offset * 2);
            const startOfTheElement = storageStringLength - endOfTheElement;
            let result = value.slice(startOfTheElement, endOfTheElement);
            variables[i].value=web3.utils.padLeft(result,64);
        }
        
    }
   return variables;
    
}
module.exports = { optimizedDecodeValues };