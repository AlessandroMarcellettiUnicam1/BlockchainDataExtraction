// Recupero del sorgente da Etherscan, compilazione con solc (in un processo figlio)
// e costruzione del "contract tree" (funzioni + layout di storage).
const { detectVersion } = require("../solcVersionManager");
const axios = require("axios");
const path = require("path");
const { fork } = require("child_process");
// MIGRAZIONE: dentro services/contractUtils il percorso diventa "../../databaseStore"
const { saveCompiledContractData } = require("../../../databaseStore");
const { UNVERIFIED_CONTRACT_MESSAGE, buildGetSourceCodeUrl } = require("../shared/etherscan");
const {
    hasCachedCompiledData,
    buildContractTreeFromCache,
    attachContractMetadata,
} = require("../shared/contractTreeHelpers");

const SOLC_WORKER_PATH = path.join(__dirname, "solcWorker.js");
const SOLC_WORKER_EXEC_ARGV = ["--max-old-space-size=8192", "--expose-gc"];
// Prefisso del nome sintetico assegnato a ogni sorgente ("contract0", "contract1", ...).
const SOURCE_NAME_PREFIX = "contract";

/**
 * Compila l'input standard-json in un processo figlio (solcWorker.js).
 * Isola gli errori di memoria del compilatore: se il figlio muore, il processo
 * principale sopravvive.
 * @param {Object} input standard-json input di solc
 * @param {string} compilerVersion versione remota di solc
 * @returns {Promise<string>} output JSON (stringa) del compilatore
 */
function compileInChildProcess(input, compilerVersion) {
    return new Promise((resolve, reject) => {
        const worker = fork(SOLC_WORKER_PATH, [], { execArgv: SOLC_WORKER_EXEC_ARGV });
        let settled = false;
        // Ogni evento chiude la promise una sola volta.
        const settleOnce = (handler) => (...args) => {
            if (settled) return;
            settled = true;
            handler(...args);
        };

        worker.send({ input, compilerVersion });

        worker.on("message", settleOnce((msg) => {
            if (msg.output) {
                resolve(msg.output);
            } else if (msg.error) {
                reject(new Error(msg.error));
            }
        }));

        worker.on("exit", settleOnce((code, signal) => {
            if (code !== 0) {
                reject(new Error(`Worker exited with code ${code} and signal ${signal}`));
            }
        }));

        worker.on("error", settleOnce((err) => {
            reject(err);
        }));
    });
}

/**
 * true se il documento letto dal DB contiene un'ABI verificata utilizzabile.
 * @param {Object|null|undefined} queryResult
 * @returns {boolean}
 */
function hasVerifiedCachedAbi(queryResult) {
    return Boolean(queryResult && typeof queryResult.abi === "string" && !queryResult.abi.includes(UNVERIFIED_CONTRACT_MESSAGE));
}

/**
 * Estrae i metadati del contratto dal documento in DB.
 * @param {Object} queryResult
 * @returns {Object}
 */
function contractDataFromCache(queryResult) {
    return {
        compilerVersion: queryResult.compilerVersion,
        contractAbi: queryResult.abi,
        sourceCode: queryResult.sourceCode,
        proxy: queryResult.proxy,
        contractName: queryResult.contractName,
    };
}

/**
 * Scarica i metadati del contratto da Etherscan.
 * @returns {Promise<Object|null>} null se il sorgente non è verificato
 */
async function fetchContractDataFromEtherscan(contractAddress, endpoint, apiKey) {
    const response = await axios.get(buildGetSourceCodeUrl(endpoint, contractAddress, apiKey));
    const etherscanResult = response?.data?.result?.[0];
    if (!etherscanResult || etherscanResult.SourceCode === "" || etherscanResult.ABI === UNVERIFIED_CONTRACT_MESSAGE) {
        console.warn("getContractCodeEtherscan: no verified contract source available", {
            contractAddress,
            hasResult: !!etherscanResult,
            abiPreview: typeof etherscanResult?.ABI === "string" ? etherscanResult.ABI.slice(0, 80) : typeof etherscanResult?.ABI,
        });
        return null;
    }
    return {
        compilerVersion: etherscanResult.CompilerVersion,
        contractAbi: etherscanResult.ABI,
        sourceCode: etherscanResult.SourceCode,
        proxy: etherscanResult.Proxy,
        contractName: etherscanResult.ContractName,
    };
}

/**
 * Converte il campo SourceCode di Etherscan nella mappa dei sorgenti.
 * - "{{...}}" o "{...}": standard-json, una voce per file (percorsi senza
 *   "node_modules/" e "lib/");
 * - altrimenti: sorgente singolo con chiave "contract0".
 * NOTA: il risultato è un Array usato come mappa (chiavi stringa); getCompiledData
 * si basa su Array.isArray, quindi il tipo va mantenuto.
 * @param {string} sourceCode
 * @returns {Array}
 */
function parseSourceFiles(sourceCode) {
    const contracts = [];
    if (sourceCode.charAt(0) !== "{") {
        const sourceName = SOURCE_NAME_PREFIX + 0;
        contracts[sourceName] = { nameId: sourceName, content: sourceCode };
        return contracts;
    }

    // Etherscan racchiude lo standard-json in doppie graffe "{{ ... }}".
    const standardJson = sourceCode.charAt(1) === "{" ? sourceCode.slice(1, -1) : sourceCode;
    const sources = JSON.parse(standardJson).sources;
    let index = 0;
    for (const fileName in sources) {
        const cleanedName = fileName.replace("node_modules/", "").replace("lib/", "");
        contracts[cleanedName] = {
            nameId: SOURCE_NAME_PREFIX + index,
            content: sources[fileName].content,
        };
        index++;
    }
    return contracts;
}

/**
 * Restituisce il sorgente del contratto (con i file importati) e i suoi metadati,
 * leggendoli dal DB se disponibili, altrimenti da Etherscan.
 *
 * @param {string} contractAddress indirizzo del contratto
 * @param {string} endpoint endpoint Etherscan/Polygonscan
 * @param {string} apiKey
 * @param {Object} [queryResult] documento ContractData già in DB
 * @param {boolean} [firstExtraction=true] se false non interroga Etherscan
 * @returns {Promise<{contracts: Array, compilerVersion, contractAbi, sourceCode, proxy, contractName}|null>}
 */
async function getContractCodeEtherscan(contractAddress, endpoint, apiKey, queryResult, firstExtraction = true) {
    try {
        let data;
        if (hasVerifiedCachedAbi(queryResult)) {
            data = contractDataFromCache(queryResult);
        } else {
            if (!firstExtraction) return null;
            data = await fetchContractDataFromEtherscan(contractAddress, endpoint, apiKey);
            if (!data) return null;
        }

        return {
            contracts: parseSourceFiles(data.sourceCode),
            compilerVersion: data.compilerVersion,
            contractAbi: data.contractAbi,
            sourceCode: data.sourceCode,
            proxy: data.proxy,
            contractName: data.contractName,
        };
    } catch (err) {
        console.log("error", err);
        return null;
    }
}

/**
 * Costruisce l'input standard-json di solc. Per ogni sorgente invoca detectVersion
 * (il risultato non è usato, ma la chiamata è mantenuta: vedi CHANGELOG, punti dubbi).
 * @param {Array|string} contracts mappa dei sorgenti o sorgente singolo
 * @param {string} contractName nome usato come chiave se contracts è una stringa
 * @returns {Promise<Object>}
 */
async function buildCompilerInput(contracts, contractName) {
    const input = {
        language: "Solidity",
        sources: {},
        settings: {
            outputSelection: {
                "*": {
                    // storageLayout -> come le variabili sono salvate nella EVM
                    // ast -> albero sintattico del contratto
                    "*": ["storageLayout", "ast", "abi"],
                    "": ["ast"],
                },
            },
        },
    };

    if (Array.isArray(contracts)) {
        for (const sourceName in contracts) {
            input.sources[sourceName] = { content: contracts[sourceName].content };
            await detectVersion(contracts[sourceName].content);
        }
    } else if (contracts) {
        input.sources[contractName] = { content: contracts };
        await detectVersion(contracts);
    }
    return input;
}

/**
 * Compila il contratto e costruisce il contract tree completo (funzioni, anche
 * ereditate, e variabili di storage).
 *
 * @param {Array|string} contracts sorgenti da compilare
 * @param {string} contractName nome del contratto principale
 * @param {string} compilerVersion versione di solc
 * @returns {Promise<{fullContractTree, storageLayoutFlag: boolean, contractCompiled: string}|{}>}
 *          {} se la compilazione fallisce
 */
async function getCompiledData(contracts, contractName, compilerVersion) {
    const input = await buildCompilerInput(contracts, contractName);

    let contractCompiled;
    try {
        contractCompiled = await compileInChildProcess(input, compilerVersion);
    } catch (err) {
        console.error(err.message);
        return {};
    }

    const compiled = JSON.parse(contractCompiled);
    // Variabili di storage per contratto, comprese quelle ereditate.
    const contractStorageTree = await getContractVariableTree(compiled);
    // Funzioni per contratto, escluse quelle ereditate.
    const partialFunctionTree = await getFunctionContractTree(compiled.sources);
    // Albero completo delle funzioni, comprese quelle ereditate.
    const contractFunctionTree = await constructFullFunctionContractTree(partialFunctionTree);
    // Albero completo con le variabili di storage.
    const fullContractTree = await injectVariablesToTree(contractFunctionTree, contractStorageTree);

    let storageLayoutFlag = true;
    if (Object.keys(contractStorageTree).length === 0) {
        console.log("contratto senza storage layout");
        storageLayoutFlag = false;
    }

    return { fullContractTree, storageLayoutFlag, contractCompiled };
}

/**
 * true se l'output di solc per il contratto ha almeno una variabile di storage.
 * @param {Object|undefined} contractOutput
 * @returns {boolean}
 */
function hasStorageLayout(contractOutput) {
    return Boolean(contractOutput?.storageLayout?.storage && contractOutput.storageLayout.storage.length !== 0);
}

/**
 * Aggiunge al tree le variabili di storage del contratto indicato.
 * @param {Array} contractStorageTree mappa (Array con chiavi stringa) nome -> {name, storage}
 * @param {string} contractName
 * @param {Array} storageLayout storageLayout.storage dell'output di solc
 */
function appendStorageVariables(contractStorageTree, contractName, storageLayout) {
    for (const storageVar of storageLayout) {
        if (contractStorageTree[contractName] === undefined) {
            contractStorageTree[contractName] = { storage: [], name: contractName };
        }
        contractStorageTree[contractName].storage.push({
            name: storageVar.label,
            type: storageVar.type,
            slot: storageVar.slot,
            offset: storageVar.offset,
        });
    }
}

/**
 * Restituisce le variabili di storage di ogni contratto compilato.
 * Per ogni file: se il primo contratto del file ha storage viene letto solo quello,
 * altrimenti vengono letti tutti i contratti del file che hanno storage.
 *
 * @param {Object} compiled output di solc (già parsato)
 * @returns {Promise<Array>} mappa (Array con chiavi stringa) nome contratto -> {name, storage}
 */
async function getContractVariableTree(compiled) {
    const contractStorageTree = [];
    for (const sourceName in compiled.contracts) {
        const contractsInSource = compiled.contracts[sourceName];
        const contractNames = Object.keys(contractsInSource);
        const firstContractName = contractNames[0];

        if (contractsInSource && hasStorageLayout(contractsInSource[firstContractName])) {
            appendStorageVariables(contractStorageTree, firstContractName, contractsInSource[firstContractName].storageLayout.storage);
            continue;
        }
        for (const contractName of contractNames) {
            if (hasStorageLayout(contractsInSource[contractName])) {
                appendStorageVariables(contractStorageTree, contractName, contractsInSource[contractName].storageLayout.storage);
            }
        }
    }
    return contractStorageTree;
}

/**
 * Restituisce, per ogni ContractDefinition dell'AST, le funzioni implementate
 * (escluse le ereditate).
 *
 * @param {Object} sources campo "sources" dell'output di solc
 * @returns {Promise<Object>} id AST -> {name, inherited, functions}
 */
async function getFunctionContractTree(sources) {
    const contractTree = {};
    for (const sourceName in sources) {
        const ast = sources[sourceName].ast;
        if (!ast) continue;

        for (const directive of ast.nodes) {
            // Solo le definizioni di contratto, non gli import/pragma.
            if (directive.nodeType !== "ContractDefinition") continue;

            contractTree[directive.id] = {
                name: directive.name,
                inherited: directive.linearizedBaseContracts,
                functions: [],
            };
            for (const node of directive.nodes) {
                if (node.nodeType.match("FunctionDefinition") && node.body != undefined && node.implemented == true) {
                    contractTree[directive.id].functions.push(node.name);
                }
            }
        }
    }
    return contractTree;
}

/**
 * Aggiunge a ogni contratto le funzioni dei contratti da cui eredita.
 * Muta e restituisce l'oggetto ricevuto.
 *
 * @param {Object} partialContractTree id AST -> {name, inherited, functions}
 * @returns {Promise<Object>}
 */
async function constructFullFunctionContractTree(partialContractTree) {
    for (const contractId in partialContractTree) {
        const contract = partialContractTree[contractId];
        for (const inheritedId of contract.inherited) {
            const inheritedContract = partialContractTree[inheritedId];
            if (inheritedContract.name !== contract.name && contract.functions.length > 0) {
                contract.functions.push(...inheritedContract.functions);
            }
        }
        contract.functions = Array.from(new Set(contract.functions));
    }
    return partialContractTree;
}

/**
 * Aggiunge a ogni contratto dell'albero delle funzioni le sue variabili di storage.
 * Muta e restituisce contractFunctionTree.
 *
 * @param {Object} contractFunctionTree
 * @param {Array} contractStorageTree
 * @returns {Promise<Object>}
 */
async function injectVariablesToTree(contractFunctionTree, contractStorageTree) {
    for (const contractId in contractFunctionTree) {
        for (const contractName in contractStorageTree) {
            if (contractFunctionTree[contractId].name === contractStorageTree[contractName].name) {
                contractFunctionTree[contractId].storage = contractStorageTree[contractName].storage;
            }
        }
    }
    return contractFunctionTree;
}

/**
 * Restituisce il contract tree dell'implementazione: dai dati compilati in DB se
 * presenti, altrimenti scaricando e compilando il sorgente (e salvandolo in DB).
 *
 * @param {*} smartContract file caricato dall'utente (se valorizzato la funzione restituisce null)
 * @param {string} impl_contract indirizzo del contratto di implementazione
 * @param {string} endpoint endpoint Etherscan/Polygonscan
 * @param {string} apiKey
 * @param {Object} [queryResult] documento ContractData già in DB
 * @param {boolean} [firstExtraction=true]
 * @returns {Promise<Object|null>}
 * @throws {Error} con il messaggio dell'errore originale se recupero o compilazione falliscono
 */
async function getContractTree(smartContract, impl_contract, endpoint, apiKey, queryResult, firstExtraction = true) {
    if (smartContract) {
        return null;
    }

    try {
        if (hasCachedCompiledData(queryResult)) {
            return buildContractTreeFromCache(queryResult);
        }

        const contractsResult = await getContractCodeEtherscan(impl_contract, endpoint, apiKey, queryResult, firstExtraction);
        if (!contractsResult) {
            return null;
        }

        const contractTree = await getCompiledData(contractsResult.contracts, contractsResult.contractName, contractsResult.compilerVersion);
        attachContractMetadata(contractTree, contractsResult);
        await saveCompiledContractData(impl_contract, contractTree);
        return contractTree;
    } catch (err) {
        console.error("getContractCodeEtherscan error: ", err);
        throw new Error(err.message);
    }
}

module.exports = {
    getCompiledData,
    getContractCodeEtherscan,
    getContractTree,
};
