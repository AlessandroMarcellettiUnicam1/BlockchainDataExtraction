const {getRemoteVersion, detectVersion} = require("../solcVersionManager");
const axios = require("axios");

/**
 * Returns the source code of the smart contract using the Etherscan APIs
 *
 * @param contractAddress - the address of the contract to get the source code
 * @returns {Promise<*[]>} - the source code of the contract with the imported contracts
 */
async function getContractCodeEtherscan(contractAddress,endpoint,apiKey) {
    let contracts = [];
    let response=[];
    let buffer;
    try{    
        response = await axios.get(endpoint + `&module=contract&action=getsourcecode&address=${contractAddress}&apikey=${apiKey}`);
        const data = response.data;
        if (data.result[0].SourceCode === "") {
            throw new Error("No contract found");
        }
        let i = 0;

        let jsonCode = data.result[0].SourceCode;

    
        if (jsonCode.charAt(0) === "{") {
    

            jsonCode = JSON.parse(jsonCode.slice(1, -1)).sources
    
            for (const contract in jsonCode) {
    
                let contractReplaced = contract.replace("node_modules/", "").replace("lib/", "")
                let actualContract = 'contract' + i;
                let code = jsonCode[contract].content;
    
                contracts[contractReplaced] = {};
                contracts[contractReplaced].nameId = actualContract;
                contracts[contractReplaced].content = code;
    
                //input.sources[contract] = {}
                //input.sources[contract].content = code
                i++;
                buffer += code
            }
        } else {
            let actualContract = 'contract' + i;
            let code = jsonCode;
            contracts[actualContract] = {};
            contracts[actualContract].nameId = actualContract;
            contracts[actualContract].content = code;
        }
        return {contracts:contracts,compilerVersion:data.result[0].CompilerVersion};
    }catch (err){
        console.log("error",err)
    }finally{
        if(response){
            response=null;
        }
    }
}

/**
 * Method used to compile the smart contract according to the solidity version, retrieved using "solc" package.
 *
 * @param contracts - the contract to compile
 * @param contractName - the name of the contract to compile
 * @returns {Promise<*>} - the AST of the smart contract, allowing the reading of the variables and the functions of the contract.
 */
async function getCompiledData(contracts, contractName,compilerVerion) {
    let contractAbi;
    let storageLayoutFlag = true;
    let input = {
        language: 'Solidity',
        sources: {},
        settings: {
            outputSelection: {
                "*": {
                    // data to return
                    // storageLayout -> how the variables are stored in the EVM
                    // ast -> abstract syntax tree, contract structure (syntax tree)
                    "*": ["storageLayout", "ast", "abi"],
                    "": ["ast"]
                }
            }
        }
    };

    let solidityVersion = ""
    if (Array.isArray(contracts)) {
        for (const contract in contracts) {
            input.sources[contract] = {};
            input.sources[contract].content = contracts[contract].content;
            solidityVersion = await detectVersion(contracts[contract].content)
        }
    } else if (contracts) {
        input.sources[contractName] = {};
        input.sources[contractName].content = contracts;
        solidityVersion = await detectVersion(contracts)
    }
    let solcSnapshot;
    try {
        solcSnapshot = await getRemoteVersion(compilerVerion);
 
    } catch (err) {
        console.error( err.message);
    }
    const output = solcSnapshot.compile(JSON.stringify(input));
    contractCompiled = output
    const source = JSON.parse(output).sources;
    contractAbi = JSON.stringify(await getAbi(JSON.parse(output), contractName));
    //get all storage variable for contract, including inherited ones
    const storageData = await getContractVariableTree(JSON.parse(output));

    //take the effective tree
    const contractStorageTree = storageData;
    //get tree of functions for contract, NOT including inherited
    const contractTree = await getFunctionContractTree(source);

    //construct full function tree including also the inherited ones
    const contractFunctionTree = await constructFullFunctionContractTree(contractTree);

    //construct full contract tree including also variables
    const fullContractTree = await injectVariablesToTree(contractFunctionTree, contractStorageTree);
    if (Object.keys(contractStorageTree).length === 0){
        console.log("contratto senza storage layout")
        storageLayoutFlag=false;
    }

    return {fullContractTree:fullContractTree,storageLayoutFlag:storageLayoutFlag,contractAbi:contractAbi,contractCompiled:contractCompiled};
}
/**
 * Method used to return the contract variables
 *
 * @param compiled - the compiled contracts returned by the solc compiler
 * @returns {Promise<*[]>} - the contract variables
 */
async function getContractVariableTree(compiled) {
    let contractStorageTree = [];
    //iterate all contracts
    for (const contract in compiled.contracts) {
        //utility for getting the key corresponding to the specific contract and access it
        const firstKey = Object.keys(compiled.contracts[contract])[0];
        //check that the contract has some state variables
        if (compiled.contracts[contract] && compiled.contracts[contract][firstKey] && compiled.contracts[contract][firstKey].storageLayout && compiled.contracts[contract][firstKey].storageLayout.storage && compiled.contracts[contract][firstKey].storageLayout.storage.length !== 0) {
            //get the storage of the contract
            const storageLay = compiled.contracts[contract][firstKey].storageLayout.storage;
            //read all variables from contract storage
            for (const storageVar of storageLay) {
                //initialize first access to the contract
                if (contractStorageTree[firstKey] === undefined) {
                    contractStorageTree[firstKey] = {};
                    contractStorageTree[firstKey].storage = [];
                    contractStorageTree[firstKey].name = firstKey;
                }
                contractStorageTree[firstKey].storage.push({
                    name: storageVar.label, type: storageVar.type,
                    slot: storageVar.slot, offset: storageVar.offset
                });


            }
        }else{
            for(const keyNumber in Object.keys(compiled.contracts[contract])){
                const otherKey = Object.keys(compiled.contracts[contract])[keyNumber];
                if (compiled.contracts[contract][otherKey].storageLayout && compiled.contracts[contract][otherKey].storageLayout.storage &&compiled.contracts[contract][otherKey].storageLayout.storage.length !== 0) {

                    const storageLay = compiled.contracts[contract][otherKey].storageLayout.storage;
                    for (const storageVar of storageLay) {
                        //initialize first access to the contract
                        if (contractStorageTree[otherKey] === undefined) {
                            contractStorageTree[otherKey] = {};
                            contractStorageTree[otherKey].storage = [];
                            contractStorageTree[otherKey].name = otherKey;
                        }
                        contractStorageTree[otherKey].storage.push({
                            name: storageVar.label, type: storageVar.type,
                            slot: storageVar.slot, offset: storageVar.offset
                        });


                    }
                }
            }
        }
    }

    return contractStorageTree;
}
/**
 * Method used to get all the functions of the contract
 *
 * @param source - the source code of the contracts returned by the solc compiler
 * @returns {Promise<{}>} - the AST of the contract with the functions
 */
async function getFunctionContractTree(source) {

    // let contractToIterate = [];
    let contractTree = {};
    for (const contract in source) {
       
       //console.log(source[contract])
       if(source[contract].ast){
            for (const directive of source[contract].ast.nodes) {
            //reads the nodes of the ast searching for the contract and not for the imports
            if (directive.nodeType === "ContractDefinition") {
                // AST of the source code of the contracts
                contractTree[directive.id] = {};
                contractTree[directive.id].name = directive.name;
                contractTree[directive.id].inherited = directive.linearizedBaseContracts;
                contractTree[directive.id].functions = [];
                for (const node of directive.nodes) {
                    //if node is the contract definition one initialize its structure
                    //if node is a function definition save it
                    if (node.nodeType.match("FunctionDefinition") && node.body != undefined && node.implemented == true) {
                        //create a buffer representing the function object to push to the function tree
                        contractTree[directive.id].functions.push(node.name);

                    }
                }
            }
        }
       }
        
    }

    return contractTree;
}
/**
 * Constructs a full function contract tree by including inherited functions.
 *
 * @param {Object} partialContractTree - Partial contract tree with functions.
 * @returns {Object} - Full contract tree with inherited functions included.
 */
async function constructFullFunctionContractTree(partialContractTree) {
     //iterate all contracts from the partial tree (key is AST id)
    for (const contractId in partialContractTree) {
        //get the ID of all inherited contract and iter them
        for (const inheritedId of partialContractTree[contractId].inherited) {
            //console.log("avente inherited: " + inheritedId + " che corrisponde a: " + partialContractTree[inheritedId].name);
            if (partialContractTree[inheritedId].name !== partialContractTree[contractId].name &&
                partialContractTree[contractId].functions.length > 0) {
                //console.log("ora inserisce" + partialContractTree[inheritedId].functions);
                partialContractTree[contractId].functions.push(...partialContractTree[inheritedId].functions);
            }
            //push inside the main contract the inherited functions
            //partialContractTree[contractId].functions.push(partialContractTree[inheritedId].functions);
        }
        const uniqueArray = Array.from(new Set(partialContractTree[contractId].functions));
        partialContractTree[contractId].functions = uniqueArray;
    }
    return partialContractTree;
}
/**
 * Injects storage variables into the contract function tree.
 *
 * @param {Object} contractFunctionTree - Tree containing contract functions.
 * @param {Object} contractStorageTree - Tree containing contract storage variables.
 * @returns {Object} - Updated contract function tree with storage variables injected.
 */
async function injectVariablesToTree(contractFunctionTree, contractStorageTree) {
    for (const contractId in contractFunctionTree) {
        //iterate again the contracts
        for (const contractName in contractStorageTree) {
            //find the same contract in the tree with variables

            if (contractFunctionTree[contractId].name === contractStorageTree[contractName].name) {
                contractFunctionTree[contractId].storage = contractStorageTree[contractName].storage;
            }
        }
    }


    return contractFunctionTree;
}
/**
 * Method used to get the contract ABI from the  main compiled contract
 *
 * @param compiled - compiled contracts returned by the solc compiler
 * @param contractName - the name of the contract to get the ABI
 * @returns {Promise<*>} - the ABI of the contract
 */
async function getAbi(compiled, contractName) {
    for (const contract in compiled.contracts) {
        //console.log("contract", contract);
        const firstKey = Object.keys(compiled.contracts[contract])[0];
        if (String(firstKey) === String(contractName)) {

            return compiled.contracts[contract][firstKey].abi;
        }else{
            for(const keyNumber in Object.keys(compiled.contracts[contract])){
                otherKey = Object.keys(compiled.contracts[contract])[keyNumber];
                if (String(otherKey) === String(contractName)) {

                    return compiled.contracts[contract][otherKey].abi;
                }
            }
        }
    }
    if (compiled && compiled.contracts && compiled.contracts["contract0"] && compiled.contracts["contract0"].hasOwnProperty(contractName)) {
        return compiled.contracts["contract0"][contractName].abi;
    }
}
module.exports={
    getCompiledData,
    getContractCodeEtherscan
}