const axios = require("axios");
const {searchAbi} =require("../query/query");
const {saveAbi} = require("../databaseStore");
let web3;
const InputDataDecoder = require('ethereum-input-data-decoder');
async function decodeInternalTransaction(internalCalls,apiKey){
    

   let addressTo="0x" +internalCalls[0].to.slice(-40);
   let query = {
                contractAddress: addressTo.toLowerCase()
            }
    const response = await searchAbi(query)
    console.log(response);
    if(!response){
        let callForAbi = await axios.get(`https:api.etherscan.io/api?module=contract&action=getabi&address=${addressTo}&apikey=${apiKey}`);
        let storeAbi={
            contractAddress: addressTo,
            abi: callForAbi.data.result
        }
        saveAbi(storeAbi);
    }
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