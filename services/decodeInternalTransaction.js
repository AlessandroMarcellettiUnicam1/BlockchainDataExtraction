const axios = require("axios");
const {searchAbi} =require("../query/query");
const {saveAbi} = require("../databaseStore");
const {connectDB}=require("../config/db");
const InputDataDecoder = require('ethereum-input-data-decoder');
async function decodeInternalTransaction(internalCalls,apiKey,smartContract,endpoint,web3){
    if(!smartContract){
        
        await connectDB(process.env.LOG_DB_NAME);
        await Promise.all(internalCalls.map(async (element) => {
            let addressTo =element.to;
            let query = {
                contractAddress: addressTo.toLowerCase()
            };
            const response = await searchAbi(query);
            if (!response) {
                let callForAbi;
                let success = false;
                while (!success) {
                    callForAbi = await axios.get(endpoint+`?module=contract&action=getsourcecode&address=${addressTo}&apikey=${apiKey}`);
                        if(!callForAbi.data.message.includes('NOTOK') ){
                            let storeAbi = {
                                contractName:callForAbi.data.result[0].ContractName,
                                contractAddress: addressTo,
                                abi: callForAbi.data.result[0].ABI
                            };
                            await saveAbi(storeAbi);
                            const decoder = new InputDataDecoder(storeAbi.abi);
                            let tempResult=decoder.decodeData("0x" + element.inputsCall);
                            element.activity=tempResult.method;
                            element.contractCalledName=callForAbi.data.result[0].ContractName;
                            element.inputs=[];
                            
                            for(let i=0;i<tempResult.inputs.length;i++){
                                let numberConverted=tempResult.inputs[i];
                                if(tempResult.inputs[i]._isBigNumber){
                                    numberConverted=web3.utils.hexToNumber(tempResult.inputs[i]._hex);
                                }
                                element.inputs.push({
                                    name:tempResult.names[i],
                                    type:tempResult.types[i],
                                    value:numberConverted
                                })
                            }
                            success = true;
                    }else{
                        if(callForAbi.data.result[0].ABI.includes("Contract source code not verified")){
                            success = true;
                            element.activity="Contract source code not verified";
                        }else{
                            await new Promise(resolve => setTimeout(resolve, 5000)); // wait for 5 seconds
                        }
                    }
                }
                
            
            } else {
                if(!response.abi.includes("Contract source code not verified")){
                    let abiFromDb = JSON.parse(response.abi);
                    const decoder = new InputDataDecoder(abiFromDb);
                    let tempResult=decoder.decodeData("0x" + element.inputsCall);
                    element.contractCalledName=response.contractName;
                    element.activity=tempResult.method;
    
                    element.inputs=[];
                    
                    for(let i=0;i<tempResult.inputs.length;i++){
                        let numberConverted=tempResult.inputs[i];
                        if(tempResult.inputs[i]._isBigNumber){
                            numberConverted=web3.utils.hexToNumber(tempResult.inputs[i]._hex);
                        }
                        element.inputs.push({
                            name:tempResult.names[i],
                            type:tempResult.types[i],
                            value:numberConverted
                        })
                    }
                }else{
                    element.activity="Contract source code not verified";
                }
            }
        }));
    }else{
        console.log("smart contract uploaded manually ")
    }
return internalCalls;
}



module.exports = { decodeInternalTransaction };