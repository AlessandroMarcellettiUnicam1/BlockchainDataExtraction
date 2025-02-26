const axios = require("axios");
const {searchAbi} =require("../query/query");
const {saveAbi} = require("../databaseStore");
const {connectDB}=require("../config/db");
let web3;
const InputDataDecoder = require('ethereum-input-data-decoder');
async function decodeInternalTransaction(internalCalls,apiKey){
    await connectDB(process.env.LOG_DB_NAME);
await Promise.all(internalCalls.map(async (element) => {
    let addressTo = "0x" + element.to.slice(-40);
    let query = {
        contractAddress: addressTo.toLowerCase()
    };
    const response = await searchAbi(query);
    if (!response) {
        let callForAbi;
        let success = false;
        while (!success) {
            callForAbi = await axios.get(`https:api.etherscan.io/api?module=contract&action=getabi&address=${addressTo}&apikey=${apiKey}`);
                if(!callForAbi.data.message.includes('NOTOK')){
                    let storeAbi = {
                        contractAddress: addressTo,
                        abi: callForAbi.data.result
                    };
                    await saveAbi(storeAbi);
                    const decoder = new InputDataDecoder(callForAbi.data.result);
                    let tempResult=decoder.decodeData("0x" + element.inputsCall);
                    element.inputDecoded=tempResult.inputs;
                    element.method=tempResult.method;
                    element.types=tempResult.types;
                    element.variableNames=tempResult.names;
                    success = true;
            }else{
                if(callForAbi.data.result.includes("Contract source code not verified")){
                    success = true;
                    element.method="Contract source code not verified";
                }else{
                    await new Promise(resolve => setTimeout(resolve, 5000)); // wait for 5 seconds
                }
            }
        }
        
       
    } else {
        let abiFromDb = JSON.parse(response);
        const decoder = new InputDataDecoder(abiFromDb);
        let tempResult=decoder.decodeData("0x" + element.inputsCall);
        element.inputDecoded=tempResult.inputs;
        element.method=tempResult.method;
        element.types=tempResult.types;
        element.variableNames=tempResult.names;
    }
}));
return internalCalls;
//    let result=[];
//     internalCalls.forEach(async (element) =>{
//         let addressTo="0x" +element.to.slice(-40);
//         let query = {
//                 contractAddress: addressTo.toLowerCase()
//             }
//         const response = await searchAbi(query)
//         if(!response){
//             let callForAbi = await axios.get(`https:api.etherscan.io/api?module=contract&action=getabi&address=${addressTo}&apikey=${apiKey}`);
//             let storeAbi={
//                 contractAddress: addressTo,
//                 abi: callForAbi.data.result
//             }
//             saveAbi(storeAbi);
//             const decoder = new InputDataDecoder(callForAbi.data.result);
//             result.push(decoder.decodeData("0x"+element.inputsCall))
//         }else{
//             let abiFromDb=JSON.parse(response);
//             const decoder = new InputDataDecoder(abiFromDb);
//             result.push(decoder.decodeData("0x"+element.inputsCall));
//         }
//     });
//    return result;
    // internalCalls.forEach(async element => {
    //     if(element.callType==="CALL"){
    //         let addressTo="0x" + element.to.slice(-40);
    //         let query = {
    //             contractAddress: addressTo.toLowerCase()
    //         }
    //         const response = await searchAbi(query)
    //         console.log(response);
            // if(response){
            //     let abiFromDb=response;
            // }else{
            //     let callForAbi = await axios.get(`https:api.etherscan.io/api?module=contract&action=getabi&address=${addressTo}&apikey=${apiKey}`);
            //     saveAbi(addressTo,callForAbi.data.result);
            // }
            
            // const decoder = new InputDataDecoder(callForAbi.data.result);
            // let result = decoder.decodeData("0x"+element.inputsCall);
            // element.inputDecoded=result;
    //     }
    // });
}



module.exports = { decodeInternalTransaction };