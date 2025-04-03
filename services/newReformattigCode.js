const { get } = require("mongoose");

let web3;
let mainContractName;

/**
 * Optimizes and decodes values from the given storage and contract data.
 *
 * @param {Object} sstore - The storage object.
 * @param {Object} contractTree - The contract tree structure.
 * @param {Array} shaTraces - An array of SHA traces.
 * @param {Object} functionStorage - The function storage object.
 * @param {string} functionName - The name of the function.
 * @param {string} mainContract - The main contract name.
 * @param {Object} web3Variable - The web3 instance.
 * @param {Object} contractCompiledPassed - The compiled contract object.
 * @returns {Promise<Array>} - A promise that resolves to an array of decoded values.
 */
async function optimizedDecodeValues(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract, web3Variable, contractCompiledPassed) {
    web3 = web3Variable;
    contractCompiled = contractCompiledPassed;
    // console.log("------SHAT TRACES------")
    // console.log(shaTraces)
    // console.log("------FUNCTION STORAGE------")
    // console.log(functionStorage)
    const emptyVariable="0000000000000000000000000000000000000000000000000000000000000000";
    mainContractName=mainContract
    let shatracesProcessed=[];
    let resultOfPreprocessing=[]
    if(functionStorage!={}){
        for( const shatrace of shaTraces){
            // if(shatrace.hasOwnProperty("indexSum")){
                let slotNumber=web3.utils.hexToNumber("0x" + shatrace.hexStorageIndex);
                if(slotNumber<300 && !shatracesProcessed.includes(shatrace.finalKey)){
                    let variabilePerSlot=getContractVariable(slotNumber,contractTree,functionName,mainContract)[0];
                        //shatraceProcessed lo passo anche al read complex data perchè vado ad inserirci tutte quelle chiavi che ottengo
                        //durante magari l'estrazioni di una stringa
                        //dove nella shatrace trovo un solo elemento mentre nel funcitonstorage trovo tutte le chiavi complesse che contengono la stringa
                        let resultreadComplexData=readComplexData(variabilePerSlot,shatrace,functionStorage,shatracesProcessed,shaTraces)
                        if(resultreadComplexData.length!=undefined){
                            resultreadComplexData.forEach((e)=>{
                                resultOfPreprocessing.push(e)
                            })
                        }else{
                            resultOfPreprocessing.push(resultreadComplexData)
                        }
                        shatracesProcessed.push(shatrace.finalKey);
                        shatracesProcessed.push(shatrace.hexStorageIndex)
    
                    
                }else {
                    shatracesProcessed.push(shatrace.finalKey);
                }
            // }
        }
    //tiro fuori che cosa ho dentro il function storage in base agli slot di memori che leggo 
        let mainContractCompiled=getMainContractCompiled(mainContract);
        for(const storageKey in functionStorage){
            if(!shatracesProcessed.includes(storageKey) && web3.utils.hexToNumber("0x" + storageKey)<9999999){
                let slotNumber= web3.utils.hexToNumber("0x" + storageKey);
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
        resultOfPreprocessing.forEach((element)=>{
            let resultElement=decodeValue(element,functionStorage,mainContractCompiled);
            result.push(resultElement)
            
        })
        
        result=fixOutput(result);
        result.map(function(obj){
            obj['variableName']=obj['name'];
            delete obj['name']
            obj['variableRawValue']=obj['value'];
            delete obj['value']
            obj['variableValue']=obj['decodedValue'];
            delete obj['decodedValue']

            // TODO: code used to remove unnecessary fields
            delete obj['slot']
            delete obj['offset']
            delete obj['contentSlot']
        })
        let expandedResult = [];
        result.forEach((obj) => {
            if (Array.isArray(obj.variableValue)) {
            const maxLength = obj.variableValue.length;
            for (let i = 0; i < maxLength; i++) {
                let variableRawValue=obj.variableRawValue[i]?obj.variableRawValue[i]:obj.variableRawValue;
                expandedResult.push({
                type: obj.type,
                variableName: obj.variableName + "_" + i,
                variableRawValue: variableRawValue,
                variableValue: obj.variableValue[i]
                });
            }
            } else {
            expandedResult.push(obj);
            }
        });
        result = expandedResult;
        result=removeStructFormOutput(result);
        result = result.filter(obj => obj.variableRawValue !== undefined && obj.variableValue !== undefined);
        result=removeDuplicateV2(result);
        return result;
    }
    
}
function removeDuplicateV2(result){
    let uniqueResults = [];
    let seen =[];

    result.forEach((element) => {
        const key =element.type+element.variableName+element.variableRawValue+element.variableValue;
        if (!seen.includes(key)) {
            seen.push(key);
            uniqueResults.push(element);
        }
    });
    return uniqueResults;
}
function removeStructFormOutput(result){
    let outputResult=[]
    result.forEach((element)=>{
        if(element.type.includes("struct")){
            extractElementFromStruct(element,outputResult);
        }else{
            outputResult.push(element);
            
        }
    })
    return outputResult;
}
function extractElementFromStruct(element,outputResult){
    element.element.forEach((e)=>{
        if(e.type.includes("struct")){
            extractElementFromStruct(e,outputResult);
        }else if(e.type.includes("array") && Array.isArray(e.decodedValue)){
            let name=element.name?element.name:"";
            e.decodedValue.forEach((arrayElement)=>{
                outputResult.push({
                    type:e.type,
                    variableName:name+"_"+e.label,
                    variableRawValue:e.contentSlot,
                    variableValue:arrayElement
                })
            })
            
            
        }else{
            let name=element.name?element.name:"";
            outputResult.push({
                type:element.type,
                variableName:name+"_"+e.label,
                variableRawValue:e.contentSlot,
                variableValue:e.decodedValue
            })
        }
    })
}
function fixOutput(result){
    removeDuplicate(result);
    let outputResult=[]
    result.forEach((element)=>{
        if(element){
            element.slot = Number(element.slot);
            if(element.element && element.element.length){
                element.element.forEach((e)=>{
                    e.slot = Number(e.slot);
                })
            }
        }
        //check if the element.slot is a BigInt
        
    });
    result.forEach((element)=>{
        if(element){
            let flag=true;
                if(Array.isArray(element.element)){
                    element.element.forEach((e)=>{
                        if(e.decodedValue){
                            if(Array.isArray(e.decodedValue) && e.decodedValue.length===0 && flag){
                                flag=false;
                            }else if(!Array.isArray(e.decodedValue) && e.decodedValue===undefined && flag){
                                flag=false;
                            }
                        }
                    })
                    if(flag){
                        outputResult.push(element);
                    }
                }else{
                    if(Array.isArray(element.decodedValue) && element.decodedValue.length===0 && flag){
                        flag=false;
                        // outputResult.push(element);
                    }else if((!Array.isArray(element.decodedValue)) && element.decodedValue===undefined && flag){
                        // outputResult.push(element);
                        flag=false;
                    }
                    if(flag){
                        outputResult.push(element);
                    }
                }
        }
    })
    
    return outputResult;
}
function removeDuplicate(result){
    const uniqueResults = [];
    const seen = new Set();

    result.forEach((element) => {
        const key = element.name;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueResults.push(element);
        }
    });
    result = uniqueResults;
}
function checkDuplicate(outputResult){
    outputResult.forEach((e)=>{
        if(e.astId===element.astId){
            return true;
        }
    })
    return false;
}


/**
 * Reads complex data based on the type of the variable.
 * 
 *
 * @param {Object} variable - The variable object containing type and contentSlot.
 * @param {Object} shaTraces - The SHA traces object.
 * @param {Object} functionStorage - The function storage object.
 * @param {Object} shatracesProcessed - The processed SHA traces object.
 * @returns {Object} - The processed variable with its value.
 */
function readComplexData(variable, shaTraces, functionStorage,shatracesProcessed,arrayShaTrace){
    let variableType=variable.type.split("(")[0];
    // let variableType=variable.type;
    if(variableType.includes("struct")){
        return readStructFromComplexData(variable,shaTraces,functionStorage,shatracesProcessed,arrayShaTrace);
    }else if (variableType.includes("mapping")){
        return readMapping(variable,shaTraces,functionStorage,shatracesProcessed,arrayShaTrace);
    }else if(variableType.includes("array")){
        return readArray(variable,shaTraces,functionStorage,shatracesProcessed,arrayShaTrace);
    }else if (variableType.includes("string")){
        return readString(variable,shaTraces,functionStorage,shatracesProcessed,arrayShaTrace);
    }else{
        variable.value=functionStorage[variable.contentSlot];
        return variable;
    }
}
function extractComplexKey(variable, shaTraces, functionStorage,shatracesProcessed,arrayShaTrace){
    for(let i=0;i<arrayShaTrace.length;i++){
        if(arrayShaTrace[i].hexStorageIndex===variable.contentSlot){
            let concatKey="0x"+arrayShaTrace[i].hexKey+arrayShaTrace[i].hexStorageIndex;
            let slotKey=web3.utils.keccak256(concatKey).slice(2);
            variable.contentSlot=slotKey;
            i=0;
        }
    }
    if(functionStorage[variable.contentSlot]){
        variable.value=functionStorage[variable.contentSlot];
    }
    return variable;
}
/**
 * Reads and processes a structured variable from complex data.
 *
 * @param {Object} variable - The variable object containing slot and contentSlot information.
 * @param {Array} shaTraces - An array of SHA traces.
 * @param {Object} functionStorage - The storage object for functions.
 * @param {Array} shatracesProcessed - An array to store processed SHA traces.
 * @returns {Object} The processed variable with its elements.
 */
function readStructFromComplexData(variable, shaTraces, functionStorage,shatracesProcessed,arrayShaTrace){
    let members=getStructMembersByVariable(variable,contractCompiled);
    // if(Number(variable.slot)!==web3.utils.hexToNumber("0x"+variable.contentSlot)){
    //     variable.contentSlot=web3.utils.padLeft( web3.utils.numberToHex(variable.slot).slice(2),64);        
    // }
    variable.element=[];
    members.forEach((element)=>{
        let slotElementStruct;
        if(web3.utils.hexToNumber("0x"+variable.contentSlot)>9999999){
            slotElementStruct=BigInt(element.slot)+web3.utils.hexToNumber("0x"+variable.contentSlot)
        }else{
            slotElementStruct=BigInt(element.slot)+BigInt(variable.slot);
        }
        element.slot=slotElementStruct;
        element.contentSlot=web3.utils.padLeft( web3.utils.numberToHex(slotElementStruct).slice(2),64);
        shatracesProcessed.push(element.contentSlot);
        element=readComplexData(element,shaTraces,functionStorage,shatracesProcessed,arrayShaTrace)
        variable.element.push(element)
    })
    return variable;
}

//Function fro decoding mapping 
//viene codificata la chiave e poi lo slot
/**
 * Reads and processes the mapping variable based on its type.
 *
 * @param {Object} variable - The variable object containing type and other properties.
 * @param {Object} shaTraces - An object containing hexKey and hexStorageIndex.
 * @param {Object} functionStorage - An object containing storage data.
 * @param {Object} shatracesProcessed - An object to store processed traces.
 * @returns {Object} - The processed variable with updated contentSlot and value.
 */
function readMapping(variable,shaTraces ,functionStorage,shatracesProcessed,arrayShaTrace){
    variable.type=variable.type.replace("t_mapping(","");
    variable.type=variable.type.slice(0,-1);
    let temp=variable.type.split(",");
    variable.type=variable.type.replace(temp[0]+",","");
    // variable.type=variable.type.split("t_mapping(")[1];
    if(!variable.type.includes("t_mapping")){
        if(variable.type.includes(",")){
            let temp=variable.type.split(",");
            variable.type=variable.type.replace(temp[0]+",","");
        }
        if(variable.type.includes("array")){
            let keyConcat="0x"+shaTraces.hexKey+shaTraces.hexStorageIndex;
            let slotKey=web3.utils.keccak256(keyConcat).slice(2);
            variable.contentSlot=slotKey;
            return readComplexData(variable,shaTraces ,functionStorage,shatracesProcessed,arrayShaTrace);
        }else if(variable.type.includes("string")){
            let keyConcat="0x"+shaTraces.hexKey+shaTraces.hexStorageIndex;
            let slotKey=web3.utils.keccak256(keyConcat).slice(2);
            variable.contentSlot=slotKey;
            return readComplexData(variable,shaTraces ,functionStorage,shatracesProcessed,arrayShaTrace);
        }else if (variable.type.includes("struct")){
            extractComplexKey(variable, shaTraces, functionStorage,shatracesProcessed,arrayShaTrace)
            // variable.type=variable.type.slice(0,-1);
            // let keyConcat="0x"+shaTraces.hexKey+shaTraces.hexStorageIndex;
            // let slotKey=web3.utils.keccak256(keyConcat).slice(2);
            // variable.contentSlot=slotKey;
            return readComplexData(variable,shaTraces ,functionStorage,shatracesProcessed,arrayShaTrace);
        }else{
            extractComplexKey(variable, shaTraces, functionStorage,shatracesProcessed,arrayShaTrace)
            return variable;
        }
    }else{
        return readComplexData(variable,shaTraces ,functionStorage,shatracesProcessed,arrayShaTrace);
    }
}


/**
 * Reads a string from the function storage based on the provided variable and shaTraces.
 *
 * @param {Object} variable - The variable object containing the contentSlot and value.
 * @param {Object} shaTraces - The shaTraces object containing the finalKey.
 * @param {Object} functionStorage - The storage object containing the function data.
 * @param {Array} shatracesProcessed - The array to store processed shaTraces.
 * @returns {Object} The updated variable object with the read string value.
 */
function readString (variable,shaTraces ,functionStorage,shatracesProcessed,arrayShaTrace) {
    if(functionStorage[shaTraces.finalKey] !== web3.utils.padLeft("0", 64)&& functionStorage[variable.contentSlot] &&web3.utils.hexToNumber("0x"+functionStorage[variable.contentSlot])<9999999){
        let stringLength=web3.utils.hexToNumber("0x"+functionStorage[variable.contentSlot]);
        let slotDiff = stringLength % 64;
        let slotUsed = (stringLength - slotDiff) / 64;
        if (slotDiff > 0) {
            slotUsed = slotUsed + 1;
        }
        let listOfBlock = "";
        let startString = web3.utils.keccak256("0x"+variable.contentSlot).slice(2);
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
        if(functionStorage[variable.contentSlot]){
            variable.value=functionStorage[variable.contentSlot];
        }
        return variable;
    }
}

/**
 * Reads an array based on the variable type and processes it accordingly.
 *
 * @param {Object} variable - The variable object containing type and contentSlot information.
 * @param {Array} shaTraces - An array of SHA traces.
 * @param {Object} functionStorage - An object containing function storage data.
 * @param {Array} shatracesProcessed - An array to store processed SHA traces.
 * @returns {Array|Object} - The processed array based on the variable type.
 */
function readArray(variable,shaTraces ,functionStorage,shatracesProcessed,arrayShaTrace){
    variable.arrayLength=functionStorage[variable.contentSlot];
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
        if(variable.type.includes("dyn")){
            return readArrayComplexDyn(variable,shaTraces,functionStorage,shatracesProcessed,arrayShaTrace);
        }else{
            return readArrayComplexStatic(variable,shaTraces,functionStorage,shatracesProcessed);
        }  
    }
}

function readArrayComplexStatic(variable,shaTraces,functionStorage,shatracesProcessed){
    console.log("readArrayComplexStatic")
}
function readArrayComplexDyn(variable,shaTraces,functionStorage,shatracesProcessed,arrayShaTrace){
    variable.type=variable.type.split("t_array(")[1];
    variable.type=variable.type.split(")dyn_storage")[0];
    if(variable.type.includes("string")){
        variable.contentSlot=shaTraces.finalKey;
        return readStringArray(variable,shaTraces,functionStorage,shatracesProcessed);
    }else if(variable.type.includes("struct")){
        let keyslot=web3.utils.keccak256("0x"+variable.contentSlot).slice(2);
        if(shaTraces.indexSum===undefined){
            shatracesProcessed.push(keyslot)
            variable.contentSlot=keyslot
            variable.slot=web3.utils.hexToNumber("0x"+keyslot);
        }else{
            let keySlotToNumber=web3.utils.hexToNumber(keyslot);
            let keyResult=web3.utils.numberToHex(keySlotToNumber+BigInt(shaTraces.indexSum)).slice(2);
            shatracesProcessed.push(keyResult)
            variable.contentSlot=keyResult
            variable.slot=web3.utils.numberToHex("0x"+keyResult);
        }
        return readComplexData(variable,shaTraces,functionStorage,shatracesProcessed,arrayShaTrace);
    }
    
}
//siccome sono in un array è diverso dalla variabile singola
function readStringArray(variable,shaTraces ,functionStorage,shatracesProcessed){
    if(functionStorage[shaTraces.finalKey] !== web3.utils.padLeft("0", 64) && web3.utils.hexToNumber("0x"+functionStorage[variable.contentSlot])<9999999){
        let stringLength=web3.utils.hexToNumber("0x"+functionStorage[variable.contentSlot]);
        let slotDiff = stringLength % 64;
        let slotUsed = (stringLength - slotDiff) / 64;
        if (slotDiff > 0) {
            slotUsed = slotUsed + 1;
        }
        let listOfBlock = "";
        let startString = web3.utils.keccak256("0x"+shaTraces.finalKey).slice(2);
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
            if(web3.utils.hexToNumber("0x"+variable.arrayLength)>0){
                for(let i=0;i<web3.utils.hexToNumber("0x"+variable.arrayLength);i++){
                    let keySlot=web3.utils.numberToHex(web3.utils.hexToNumber(keyOfSlot)+BigInt(i)).slice(2);
                    shatracesProcessed.push(keySlot)
                    variable.value.push(functionStorage[keySlot]);
                }
            }else{
                shatracesProcessed.push(keyOfSlot)
                variable.value.push(functionStorage[keyOfSlot.slice(2)]);
            }
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
    let result=[];
    let keySlot=web3.utils.keccak256("0x"+variable.contentSlot).slice(2);
    variable.value=functionStorage[keySlot]
    let typeSize=parseInt(variable.type.split(")")[0].split("bytes")[1]);
    let arrayLength=web3.utils.hexToNumber("0x"+functionStorage[variable.contentSlot]);
    let charsForElement = typeSize *2;
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
    variable.value=undefined;
    return variable;
}

//i valori primitivi li posso dividere in primitivi completi o partiziali 
//i parziali sono gli array 
//i mapping li posso escludere perché nella decodifica prendo direttamente il valore del mapping 

function decodeValue(variable,functionStorage,contractCompiled){
    //take the first type 
    if(!variable.type.includes("(") || variable.type.includes("t_contract")){
        variable.decodedValue=decodePrimitive(variable,functionStorage);
        return variable;
    }else{
        //se trovo una parantesi mi trovo in un caso di decodifica parziale
        return decodePartialPrimitive(variable,functionStorage,contractCompiled);
    }
}
function decodePrimitive(variable,functionStorage){
    let type=variable.type;
    if(variable.value){
    let value = variable.value;
    if (type.includes("uint")) {
        return Number(web3.utils.hexToNumber("0x" + value));
    } else if (type.includes("bool")) {
        return web3.eth.abi.decodeParameter("bool", "0x" + value);
    } else if (type.includes("bytes")) {
        // return JSON.stringify(web3.utils.hexToBytes("0x" + value)).replace("\"", "");
        return "0x"+value;

    } else if (type.includes("address")) {
        return "0x" + value.slice(-40);
    } else if (type.includes("enum")) {
        let bigIntvalue = web3.eth.abi.decodeParameter("uint256", "0x" + value);
        return Number(bigIntvalue);
    }else if (type.includes("string")) {
        return web3.utils.hexToAscii("0x" + value).replace(/\0/g, '');
    }
    return value;
    }else{
        return undefined
    }
}

//funzione per tirare fuori i valori da un array 
function decodePartialPrimitive(variable,functionStorage,contractCompiled){
    let type=variable.type.split("(")[0];
    // let type=variable.type;
    if (type.includes("enum")) {
        let value = variable.value;
        let bigIntvalue = web3.eth.abi.decodeParameter("uint256", "0x" + value);
        return Number(bigIntvalue);
    }else if (type.includes("array")){
        return decodeArray(variable,functionStorage);
    }else if(type.includes("struct")){
        return readStruct(variable,functionStorage,contractCompiled);
    }
}
function readStruct(variable,functionStorage,contractCompiled){
    // if(Number(variable.slot)!==web3.utils.hexToNumber("0x"+variable.contentSlot)){
    //     variable.contentSlot=web3.utils.padLeft( web3.utils.numberToHex(variable.slot).slice(2),64);        
    // }
    if(variable.element){
        variable.element.forEach((element)=>{
            if(element.value){
                element=decodeValue(element,functionStorage,contractCompiled);
            }else if(element.type.includes("(")){
                element=decodeValue(element,functionStorage,contractCompiled);
            }
        })
        return variable
    }else{
        let members=getStructMembersByVariable(variable,contractCompiled);
        variable.element=[];
        members.forEach((element)=>{
            // Number(variable.slot)
            let slotElementStruct=Number(element.slot)+web3.utils.hexToNumber("0x"+variable.contentSlot);
            element.slot=slotElementStruct;
            element.contentSlot=web3.utils.padLeft( web3.utils.numberToHex(slotElementStruct).slice(2),64);
            if(functionStorage[element.contentSlot]){
                element.value=functionStorage[element.contentSlot];
                variable.element.push(element);
            }
            // if(slotElementStruct===Number(web3.utils.hexToNumber("0x"+variable.contentSlot)) ){
            //     variable.type=element.type;
            //     variable.memberName=element.label;   
            // }
        })
        return decodeValue(variable,functionStorage,contractCompiled);

    }
    return variable;
    variable.type="";
    variable.memberName="";
    
    
    return decodeValue(variable,functionStorage,contractCompiled);
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
        variable.decodedValue=decodePrimitive(variable,functionStorage);
        return variable;
    }else{
        variable.decodedValue=[];
        variable.value.forEach((element)=>{
            // resultVariable.value="";
            // resultVariable.value=element;
            variable.decodedValue.push(decodePrimitive({type:variable.type,value:element},functionStorage));
        }) 
        return variable;
    }
}
function decodeBytesArrayDynamic(variable,functionStorage){
    variable.decodedValue=[];
    variable.value.forEach((element)=>{
        variable.decodedValue.push(decodePrimitive({type:variable.type,value:element},functionStorage));
    }) 
    return variable;
    // if(variable.type.includes("32")){
    //     variable.elementDecoded.push("0x"+variable.value);
    //     return variable;
    // }else{
    //     let typeSize=parseInt(variable.type.split(")")[0].split("uint")[1]);
    //     let arrayLength=parseInt(variable.type.split(")")[1].split("_storage")[0]);
    //     let result=[];
    //     let charsForElement = typeSize * 2;
    //     const slotLength = 64;
    //     for (let i=0;i<arrayLength;i++){
    //         let startOfTheElement = slotLength - (i*charsForElement);
    //         let endOfTheElement = startOfTheElement - charsForElement;
    //         let valueExatracted = variable.value.slice(endOfTheElement,startOfTheElement);
    //         let valuePadded=web3.utils.padLeft(valueExatracted,64);
    //         variable.elementDecoded.push("0x"+valuePadded);
    //     }
    //     return variable;
    // }
}
function decodeBytesArray(variable,functionStorage){
    if(variable.type.includes("32")){
        variable.decodedValue="0x"+variable.value;
        return variable;
    }else{
        let typeSize=parseInt(variable.type.split(")")[0].split("bytes")[1]);
        let arrayLength=parseInt(variable.type.split(")")[1].split("_storage")[0]);
        let result=[];
        let charsForElement = typeSize * 2;
        const slotLength = 64;
        variable.decodedValue=[];
        for (let i=0;i<arrayLength;i++){
            let startOfTheElement = slotLength - (i*charsForElement);
            let endOfTheElement = startOfTheElement - charsForElement;
            let valueExatracted = variable.value.slice(endOfTheElement,startOfTheElement);
            let valuePadded=web3.utils.padLeft(valueExatracted,64);
            variable.decodedValue.push("0x"+valuePadded);
        }
        return variable;

    }
    
}

function decodeUintArray(variable,functionStorage){
    if(variable.type.includes("256")){
        if(variable.value==undefined){
            return variable;
        }
        variable.decodedValue=web3.utils.hexToNumber("0x"+variable.value);
        return variable
    }else{
        let typeSize=parseInt(variable.type.split(")")[0].split("uint")[1]);
        let arrayLength=parseInt(variable.type.split(")")[1].split("_storage")[0]);
        let result=[];
        variable.decodedValue=[];
        let charsForElement = typeSize / 4;
        const slotLength = 64;
        for (let i=0;i<arrayLength;i++){
            let startOfTheElement = slotLength - (i*charsForElement);
            let endOfTheElement = startOfTheElement - charsForElement;
            let valueExatracted = variable.value.slice(endOfTheElement,startOfTheElement);
            let valuePadded=web3.utils.padLeft(valueExatracted,64);
            variable.decodedValue.push(web3.utils.hexToNumber("0x"+valuePadded));
        }
        return variable;
    }
}
//decode uintArrayDynamic
function decodeUintArrayDynamic(variable,functionStorage){
        variable.decodedValue=[];
        if(Array.isArray(variable.value)){
        variable.value.forEach((element)=>{
            if(element){
                variable.decodedValue.push(decodePrimitive({type:variable.type,value:element},functionStorage));
            }
        }) 
        }else{
            variable.decodedValue=decodePrimitive({type:variable.type,value:variable.value},functionStorage);
        }
        return variable;
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
                        contentSlot:web3.utils.padLeft( web3.utils.numberToHex(Number(contractTree[contractId].storage[i].slot)).slice(2),64)
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
                            contentSlot:web3.utils.padLeft( web3.utils.numberToHex(Number(contractTree[contractId].storage[i].slot)).slice(2),64)
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
    let storageLayout;
    if(mainContractCompiled.storageLayout===undefined){
        storageLayout=getMainContractCompiled(mainContractName).storageLayout.storage;
    }else{
        storageLayout = mainContractCompiled.storageLayout.storage;
    }
    let members = [];
    storageLayout.forEach((item) => {
        let name=variable.name?variable.name:variable.label;
        if (item.label===name) {
            const structType = variable.type;
            const storageTypes = getMainContractCompiled(mainContractName).storageLayout.types;
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
                    if (type===structType) {
                        members = storageTypes[type].members;
                    }
                }
            }
        }else if(item.type===variable.type){
            const structType = variable.type;
            const storageTypes = getMainContractCompiled(mainContractName).storageLayout.types;
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
                    if (type===structType) {
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