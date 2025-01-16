/**
 * Returns the source code of the smart contract using the Etherscan APIs
 *
 * @param contractAddress - the address of the contract to get the source code
 * @returns {Promise<*[]>} - the source code of the contract with the imported contracts
 */
async function getContractCodeEtherscan(contractAddress) {
    let contracts = [];
    let buffer;
    const response = await axios.get(endpoint + `?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${apiKey}`);
    const data = response.data;
    if (data.result[0].SourceCode === "") {
        throw new Error("No contract found");
    }
    let i = 0;
    fs.writeFileSync('./temporaryTrials/dataResult.json', JSON.stringify(data.result[0]))
    let jsonCode = data.result[0].SourceCode;
    //console.log(jsonCode);
    fs.writeFileSync('sourceCode', JSON.stringify(data.result[0]));

    if (jsonCode.charAt(0) === "{") {

        // fs.writeFileSync('contractEtherscan.json', jsonCode);
        //fs.writeFileSync('solcOutput', jsonCode);
        //const realResult = fs.readFileSync('solcOutput');
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
            //fs.writeFileSync('smartContracts/' + actualContract, JSON.stringify(code));
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
    return contracts;
}
module.exports = {getContractCodeEtherscan};