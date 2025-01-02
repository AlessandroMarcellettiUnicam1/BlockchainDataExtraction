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

module.exports = {getContractVariable};