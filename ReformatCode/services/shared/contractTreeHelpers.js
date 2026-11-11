// Helper comuni per la costruzione del "contract tree" (dati compilati + metadati
// Etherscan). Unificano blocchi identici presenti in contractUtils/utils.js e
// ExtractionModule/mainWithOption.js.

/**
 * true se il documento ContractData letto dal DB contiene già i dati compilati.
 * @param {Object|null|undefined} queryResult
 * @returns {boolean}
 */
function hasCachedCompiledData(queryResult) {
    return Boolean(queryResult?.fullContractTree && queryResult?.contractCompiled);
}

/**
 * Ricostruisce il contract tree da un documento ContractData già salvato.
 * @param {Object} queryResult documento restituito da searchAbi
 * @returns {Object} contract tree
 */
function buildContractTreeFromCache(queryResult) {
    return {
        fullContractTree: queryResult.fullContractTree,
        storageLayoutFlag: queryResult.storageLayoutFlag,
        contractCompiled: queryResult.contractCompiled,
        contractAbi: queryResult.abi,
        sourceCode: queryResult.sourceCode,
        proxy: queryResult.proxy,
        contractName: queryResult.contractName,
        proxyImplementation: queryResult.proxyImplementation || "",
        compilerVersion: queryResult.compilerVersion,
    };
}

/**
 * Copia sul contract tree compilato i metadati restituiti da getContractCodeEtherscan.
 * Muta e restituisce contractTree.
 * @param {Object} contractTree risultato di getCompiledData
 * @param {Object} contractsResult risultato di getContractCodeEtherscan
 * @returns {Object}
 */
function attachContractMetadata(contractTree, contractsResult) {
    contractTree.contractAbi = contractsResult.contractAbi;
    contractTree.sourceCode = contractsResult.sourceCode;
    contractTree.proxy = contractsResult.proxy;
    contractTree.contractName = contractsResult.contractName;
    contractTree.proxyImplementation = "";
    contractTree.compilerVersion = contractsResult.compilerVersion;
    return contractTree;
}

module.exports = {
    hasCachedCompiledData,
    buildContractTreeFromCache,
    attachContractMetadata,
};
