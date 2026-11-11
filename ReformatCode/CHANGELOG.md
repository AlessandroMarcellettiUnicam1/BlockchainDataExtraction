# CHANGELOG — refactor della catena di estrazione

Riferimento: commit `c741b5712204b3c77a2ff9a70dd5ca43ec30e24a`. Tutti i numeri di riga
"originali" si riferiscono a questo commit. Nessun file originale è stato modificato.

## 1. File refactorizzati

| File in `ReformatCode/services/` | Righe (orig. → nuovo) | Sintesi |
|---|---|---|
| `solcVersionManager.js` | 106 → 143 | costanti; retry con `for`; `satisfiesConstraint` al posto della catena di `else if`; `return` dopo `reject` |
| `contractUtils/solcWorker.js` | 40 → 43 | `replyAndExit` al posto di 4 blocchi duplicati; costanti |
| `contractUtils/utils.js` | 442 → 425 | `getContractCodeEtherscan` divisa in 4 funzioni; `getCompiledData` con un solo `JSON.parse`; ciclo unico in `getContractVariableTree`; early return in `getContractTree` |
| `decodingUtils/utils.js` | 383 → 399 | ricevute via `postJsonRpc`; `decodeInput` semplificata; nuovo export additivo `assignEventToInternal` |
| `decodeInternalTransaction.js` | 666 → 627 | varianti standard/Erigon unificate (`processFetchedAbi` più `STANDARD_`/`ERIGON_FETCH_VARIANT`); helper per le metriche; costanti |
| `optimizedDecodeValues.js` | 908 → 841 | helper per gli slot; lettura stringhe unificata; split degli array impacchettati unificato; `getContractVariable`/`getStructMembersByVariable` senza duplicati; `Set` in `removeDuplicate` |
| `Erigon/erigonApi.js` | 309 → 166 | fetch JSON-RPC condivise; `buildTransactionHierarchy` divisa in 3 funzioni; nessuna RPC ripetuta per la stessa transazione |
| `ExtractionModule/workerWithOption.js` | 1624 → 758 | parser estratto in `traceStorageParser.js`; `createTransactionLog` ed eventi divisi in funzioni brevi; codice morto rimosso |
| `ExtractionModule/mainWithOption.js` | 556 → 499 | `NETWORK_ENV` al posto dello `switch`; due modalità separate; `compileContractTree`; `extractSingleTransaction` |

Nuovi file condivisi:

- `shared/hexUtils.js`
- `shared/etherscan.js`
- `shared/jsonRpc.js`
- `shared/contractTreeHelpers.js`
- `ExtractionModule/traceStorageParser.js`

Su tutti i file:

- JSDoc sugli export;
- async/await al posto delle catene di promise (`debugTransactionErigonStreaming`);
- stile del progetto: CommonJS, 4 spazi, doppi apici, punto e virgola.

Il progetto non ha ESLint né Prettier.

**Firme pubbliche invariate**, compresi parametri inutilizzati e valori di ritorno. Unica aggiunta:

- l'export `assignEventToInternal` di `decodingUtils/utils.js`;
- `assignStorageToTheInternal`, che con FIX-07 restituisce l'indice successivo invece di `undefined`. Il valore restituito non è usato da nessun chiamante.

## 2. Codice rimosso

Prima di ogni rimozione ho fatto un grep su tutto il workspace (esclusi `node_modules`
e `ReformatCode`), cercando anche `require` dinamici, riferimenti come stringa ed export.

| Codice | Dove (originale) | Motivo |
|---|---|---|
| `debugTransaction` | `workerWithOption.js:125-144` | mai chiamata né esportata |
| `getTraceStorage` | `workerWithOption.js:666-848` | mai chiamata né esportata; è una terza versione del parser |
| `retriveImplementationContract` | `workerWithOption.js:849-869` | chiamata solo da `getTraceStorage` |
| `getAbi` | `contractUtils/utils.js:362-382` | mai chiamata né esportata; creava la variabile globale implicita `otherKey` |
| copia di `makeRpcCallStreaming`/`debugTransactionErigonStreaming` | `erigonApi.js:129-192` | duplicato; sostituita da `shared/jsonRpc.js` (vedi FIX-10) |
| copia di `assignEventToInternal` | `erigonApi.js:108-121` | identica a quella di `decodingUtils`; ora ri-esportata da lì |
| blocco `if (!success)` | `decodeInternalTransaction.js:484-486` | irraggiungibile (si esce dal `while` solo con `success = true`) |
| variabili `success`, `buffer`, `solidityVersion`, `debugResult`, `trackBuffer`/`functionStorage` del parser Erigon, `contractAbi`, `result` (2×) | vari | assegnate e mai lette |
| parametro `extractionType` di `processTransaction`/`createTransactionLog` | `workerWithOption.js:72`, `216` | interno, mai inviato da `mainWithOption` (`runWorkerForTx`, righe 513-523) |
| parametro `functionName` delle funzioni interne di `optimizedDecodeValues` | `optimizedDecodeValues.js:77`, `108`, `760` | interno, mai letto (resta nella firma pubblica) |
| ternario `option.internalTransaction == 1 ? … : element["to"]` | `decodingUtils/utils.js:259` | sempre falso dentro il ramo `else`; sostituito dal valore che produceva |
| import inutilizzati | main: `Web3`, `fs`, `mongoose`, `v8`, `ethers`, `convertProcessSignalToExitCode`, `saveExtractionLog`; worker: `axios`, `fs`, `path`, `net`; contractUtils: `execFile`, `fs`, `getRemoteVersion`; erigonApi: `newDecodedInternalTransaction`, `decodeInternalTransaction`, `optimizedDecodeValues`, `JSONStream`; decodingUtils: `Web3`; optimizedDecodeValues: `get` (mongoose), `fs` | nessun uso; i moduli restano richiesti dove servono |
| assegnazioni a `null`/`length = 0` nei `finally` | worker, main | variabili locali che escono comunque di scope; nessun oggetto restituito le condivideva. `global.gc()` è mantenuto |
| `typeof createShatrace === "function"`, `typeof regroupShatrace === "function"` | `workerWithOption.js:1367`, `1386` | sempre veri (funzioni dichiarate nello stesso file) |
| blocchi commentati | main, worker, erigonApi, optimizedDecodeValues | codice disattivato e commenti obsoleti |
| `finalShaTraces = regroupShatrace(finalShaTraces)` nel parser Erigon | `workerWithOption.js:1073` | risultato mai usato (la decodifica usa `mapForStorage["1"].finalShaTraces`); `regroupShatrace` non ha effetti collaterali |

**Mantenuti, anche se mai importati nel workspace** (vincolo drop-in):

- `safeCheck`, `checkIfEventIsAlreadyStored`, `deepEqual` (decodingUtils);
- `assignEventToInternal`, `getEventFromErigon` e `debugTransactionErigonStreaming` di erigonApi;
- `makeRpcCallStreaming` e `decodeInteralTxsStorage` del worker.

`handleAbiFetch`/`handleAbiFromDb` sono importate da `simulationOrchestrator.js:11` ma non chiamate: mantenute.

## 3. Duplicati unificati

| Duplicato | Dove (originale) | Ora |
|---|---|---|
| `ensureHexPrefix`/`stripHexPrefix` (3 copie) | `optimizedDecodeValues.js:6`, `decodeInternalTransaction.js:8`, `workerWithOption.js:47-56` | `shared/hexUtils.js` |
| streaming RPC (2 copie) | worker `146-203`, erigonApi `129-192` | `shared/jsonRpc.js` |
| fetch JSON-RPC (4 copie) | erigonApi `14-97`, decodingUtils `131-155` | `postJsonRpc` (stesso log `"Error fetching transaction receipt:"` per tutte) |
| URL `getsourcecode` e messaggio "non verificato" (molte copie) | 5 file | `shared/etherscan.js` |
| contract tree da cache e assegnazione dei metadati | contractUtils `401-424`, main `216-227`, `290-295` | `shared/contractTreeHelpers.js` |
| due parser degli structLogs (~250 righe ciascuno) | worker `872-1134`, `1136-1447` | `traceStorageParser.js` con le opzioni `ERIGON_PARSER_OPTIONS`/`INPUT_STREAM_PARSER_OPTIONS` (vedi sotto) |
| ciclo di risoluzione delle sha trace (3 copie) | worker `1040-1068`, `1316-1355`, `1452-1480` | `appendStoredShaTraces` (parametri: conversione esadecimale, stop su indice mancante) |
| tre blocchi degli eventi della ricevuta | worker `519-552`, `570-604`, `606-640` | `appendReceiptEvents` (parametro `fallbackToSender`) |
| rami Erigon/Standard di `createTransactionLog` | worker `272-359` | `traceTransactionStorage` con `TRACE_MODES` |
| `handleAbiFetch`/`handleAbiFetchErigon` | decodeInternalTransaction `219-322`, `381-487` | `processFetchedAbi`/`decodeProxyCall`/`decodeRegularCall` più le varianti |
| `handleAbiFromDb`/`handleAbiFromDbErigon` | `174-209`, `330-371` | `decodeWithStoredImplementation`, `completeActivityWithFallbacks` |
| decodifica + metrica (~10 copie) | decodeInternalTransaction | `decodeInputsMeasured`, `measureAsync` |
| `readString`/`readStringArray` | optimizedDecodeValues `324-350`, `439-463` | `readStringFromSlots` (flag `isArrayElement`) |
| `decodeOptimizeUint/BytesDynamicArray` e gli split degli array statici | optimizedDecodeValues `520-555`, `697-744` | `splitPackedDynamicArray`, `extractPackedElements` |
| 3 builder di variabile, 2 rami di `getStructMembersByVariable` | optimizedDecodeValues `766-795`, `814-850` | `buildStorageVariable`, condizione unica |
| due cicli di `getContractVariableTree` | contractUtils `224-264` | `appendStorageVariables` |

Differenze tra i due parser, mantenute come opzioni:

| Aspetto | Erigon (`internalTransaction == 1`) | Input stream |
|---|---|---|
| KECCAK256 senza memoria | non registra | registra (`memory || []`) |
| storage di STOP/RETURN/SSTORE/SLOAD | normalizzato senza `0x` | copia grezza |
| chiusura di una profondità | STOP e RETURN | solo STOP |
| opcode di chiamata | CALL, DELEGATECALL, STATICCALL | anche CALLCODE |
| parole di memoria | unite togliendo `0x` | unione grezza |
| chiamata senza memoria | non registrata | registrata |
| `contractAddress` del bucket | impostato | no |
| sha trace pubbliche | `ensureHexPrefix`, nessuno stop | `"0x" + valore`, stop se manca l'indice |
| `createShatrace` sui bucket | in place, senza try | su una copia filtrata, con try/catch (quindi `finalShaTraces` resta undefined e si usa il fallback) |

È mantenuto anche l'aliasing originale, necessario per gli SSTORE ripetuti sulla stessa chiave: le sha trace vengono aggiunte allo stesso array che si sta scorrendo.

## 4. Bug corretti

Ogni fix è marcato nel codice con `// FIX-xx:` e ha una scheda separata in
`MIGRAZIONE.md`, con il blocco pre-fix equivalente all'originale. "Verificato" indica
il caso di `compare.js` in cui il vecchio codice fallisce o produce un output
sbagliato e il nuovo è corretto.

| Fix | Riga originale | Problema e motivazione | Fonte / verifica |
|---|---|---|---|
| FIX-01 | `workerWithOption.js:1465` | `hexToNumber(hexStorageIndex)` senza `0x` lancia. Nel percorso Erigon (`1069-1071`, senza try) si perdono `storageState` e `internalTxs` di ogni transazione in cui una chiamata interna scrive su un mapping | web3 4.16.0 eseguito: `hexToNumber("ab")` → `must pass "hex" validation`; `compare.js` FIX-01 (2 casi) |
| FIX-02 | `optimizedDecodeValues.js:338, 402, 453, 474, 492, 502` | `numberToHex(...).slice(2)` senza padding: chiave di 63 caratteri quando l'hash inizia con 0, quindi lettura mancata | web3 4.16.0: `numberToHex` di un valore con zero iniziale → 63 caratteri esadecimali; Solidity: dati di array dinamici e stringhe lunghe in `keccak256(p)` ([layout in storage](https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html)); `compare.js` FIX-02 (2 casi) |
| FIX-03 | `optimizedDecodeValues.js:401-402, 474, 502` | `BigInt(indexSum)` con `indexSum` a 64 caratteri senza `0x` (stack normalizzato, `workerWithOption.js:915-916`, `1285-1286`): letto come decimale o eccezione. `hexToNumber(keyslot)` senza prefisso (401) lancia sempre | Node: `BigInt("…10")` = `10n`, `BigInt("…0a")` lancia; `compare.js` FIX-03 (2 casi) |
| FIX-04 | `optimizedDecodeValues.js:89, 260-261, 433-434` | `readComplexData` restituisce `undefined` (stub di `readArrayComplexStatic`, array dinamici non string/struct): `.length` o un membro `undefined` lanciano `TypeError` e si perde la decodifica dell'intera transazione | `compare.js` FIX-04 (`address[]` dinamico) |
| FIX-05 | `optimizedDecodeValues.js:612-615` | il ramo enum restituisce un `Number` invece della variabile: gli enum spariscono sempre dall'output | solc 0.8.26 eseguito: tipo `t_enum(Status)4` (contiene `(`); `compare.js` FIX-05 e layout reale (sotto) |
| FIX-06 | `optimizedDecodeValues.js:898-900` | ultima variabile impacchettata: `slice(offset*2, 64-offset*2)` dà `""` per offset ≥ 16 | Solidity: "the first item in a storage slot is stored lower-order aligned" ([layout](https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html)); solc 0.8.26: `bool` a offset 20, enum a offset 21 |
| FIX-07 | `workerWithOption.js:1485-1494` | indice passato per valore nella ricorsione: con `[A{A1}, B]`, B riceve il bucket di A1 | `Revisoni/analisi_punti_tecnici.md` §3.1; `compare.js` FIX-07 |
| FIX-08 | `erigonApi.js:210, 224, 228` | `trace_filter` sempre da `fromBlock`, pagine sovrascritte, `return []` sulla pagina vuota: ciclo infinito o trace perse se l'ultima trace è prima di `toBlock` | `compare.js` FIX-08 (vecchio: 3 richieste tutte da `0x64`, risultato `[]`) |
| FIX-09 | `decodeInternalTransaction.js:146` | `ToNumber` non è definita nel workspace (grep): `ReferenceError` quando `gas` non è numerico | grep sul workspace; `compare.js` FIX-09 |
| FIX-10 | `erigonApi.js:154` | `http`/`https` non importati: `ReferenceError` in `debugTransactionErigonStreaming` di erigonApi (export mai importato) | `compare.js` FIX-10 |
| FIX-11 | `decodeInternalTransaction.js:456` | `handleUnverifiedContract` chiamata senza `metrics`: si perde la metrica `time_4byteLookupInternal` | `compare.js` FIX-11 |
| FIX-12 | `workerWithOption.js:369` | `contractTree.compilerVersion` senza `?.`, mentre le righe intorno gestiscono `contractTree` nullo (latente: `mainWithOption` non passa mai null) | `compare.js` FIX-12 |
| **FIX-13** (nuovo) | `optimizedDecodeValues.js:125` | il valore di ogni variabile impacchettata calcolato da `newReadVarFormOffset` veniva sovrascritto con lo slot intero | solc 0.8.26 più `compare.js`, vedi sotto |
| **FIX-14** (nuovo) | `optimizedDecodeValues.js:373` | `readBytesArray` chiamata ma mai definita (grep su tutto il workspace): `ReferenceError` per `mapping(… => bytesN[k])` | grep; `compare.js` FIX-14 |
| **FIX-15** (nuovo) | `erigonApi.js:203` | `currentFromBlock <= toBlock` tra stringhe (form multipart, `server.js:498`) è lessicografico: `"9999990" <= "10000010"` è false e si ottiene `[]` senza richieste | `compare.js` FIX-15 |

FIX-13, 14 e 15 sono stati trovati in fase 2 e **non erano nella lista approvata**.
Le loro schede (M-26, M-27, M-28) sono separate e si possono saltare.

Prova sul layout reale compilato con solc 0.8.26: `address owner; bool paused; Status status;` nello slot 0, `uint128 a; uint128 b;` nello slot 1. Con `a = 4` e `b = 9`:

| | `owner` | `paused` | `status` | `a` | `b` |
|---|---|---|---|---|---|
| originale | corretto | assente | assente | 3.06e39 | 3.06e39 |
| nuovo | corretto | `true` | `1` | `4` | `9` |

## 5. Punti dubbi lasciati invariati

| Punto | Dove | Perché non corretto |
|---|---|---|
| **Le struct non compaiono mai nell'output** (verificato con il codice originale) | `optimizedDecodeValues.js:46-70` | il filtro su `variableValue` precede `removeStructFormOutput`, e le struct non hanno `decodedValue`. Correggere richiede di scegliere il formato: `extractElementFromStruct` usa `e.name` del membro, che è vuoto, invece del nome della struct |
| `parseInt(blockNumber, 16)` | `erigonApi.js:232` | `trace_filter` restituisce `blockNumber` in decimale ([Infura](https://docs.infura.io/reference/ethereum/json-rpc-methods/trace-methods/trace_filter.md): numero; [Alchemy](https://www.alchemy.com/docs/node/trace-api/trace-api-endpoints/trace-filter.md): stringa decimale), quindi viene sovrastimato e il ciclo termina dopo la prima pagina. Correggerlo cambia il numero di richieste e il comportamento in caso di troncamento |
| `after: 1000`, `count: 100` fuori dal filtro | `erigonApi.js:216-217` | entrambe le documentazioni li vogliono **dentro** il filtro; spostandoli, `after=1000` salterebbe le prime 1000 trace. Infura limita inoltre il range a 100 blocchi per richiesta |
| upload del file `.sol` | `mainWithOption.js:212-213`, `283` | `smartContract` è una stringa: `getCompiledData(undefined, …)` non compila nulla e `saveCompiledContractData` sovrascrive il record con valori vuoti. Serve decidere come compilare l'upload |
| controllo duplicati contro collection di salvataggio | `mainWithOption.js:129`, `445-449` contro `workerWithOption.js:444-454` | in modalità newParams il controllo usa la collection `tx.to`, mentre il worker salva in `contractAddressesTo`: le transazioni vengono ri-estratte |
| formato misto dei risultati | `mainWithOption.js:453-477` | `{log, metrics}` contro il documento del DB; la compliance gestisce entrambi (`item.log ? item.log : item`) |
| `process.exit` subito dopo `process.send` | `workerWithOption.js:1564-1570` | possibile perdita di messaggi IPC grandi (solcWorker usa un ritardo di 100 ms); non documentato con certezza |
| handler `process.on` del worker installati al require | `workerWithOption.js:1537-1596` | attivi anche nel server tramite `simulationOrchestrator.js:13` (`uncaughtException` → `exit(1)`) |
| `detectVersion` con risultato inutilizzato | `contractUtils/utils.js:175, 180` | scarica `list.json` per ogni sorgente e può lanciare; toglierlo cambia il comportamento in caso di errore. La `secondRegex` (`solcVersionManager.js:75`) è malformata |
| `rejectUnauthorized: false` | `solcVersionManager.js:32` | TLS non verificato verso binaries.soliditylang.org |
| `extractComplexKey` riparte da 1 | `optimizedDecodeValues.js:227` | `i=0` seguito da `i++`: errore di uno, effetto dipendente dai dati |
| retry infinito su NOTOK | `decodeInternalTransaction.js:384` | `handleAbiFetchErigon` non ha un limite di tentativi |
| `compileInChildProcess` può non terminare | `contractUtils/utils.js:27-43` | messaggio senza `output`/`error`, oppure uscita con codice 0 senza messaggio |
| perdita di precisione con `Number()` | `decodingUtils/utils.js:50, 349-355`; `optimizedDecodeValues.js:582` | uint256 ed eventi bigint oltre 2^53 |
| `int` con segno e `t_contract` | `optimizedDecodeValues.js:575-605` | restituiti come esadecimale grezzo |
| controllo invertito `length !== undefined` | `optimizedDecodeValues.js:676` | gli array hanno `length`: il ramo per array non si raggiunge |
| euristiche `includes("32")` / `includes("256")` | `optimizedDecodeValues.js:466, 485, 698, 722` | per esempio `bytes3` non contiene "32", ma `t_uint32` contiene "32" |
| stringhe: blocco in più e "undefined" | `optimizedDecodeValues.js:326-341` | la lunghezza usa `2*len+1`: con `len` multiplo di 32 si legge un blocco in più |
| BigInt + Number | `optimizedDecodeValues.js:253, 640` | `contentSlot` tra 9999999 e 2^53 → `TypeError` |
| soglie 300 / 9999999 | `optimizedDecodeValues.js:81, 117` | euristiche senza riferimento |
| tuple in `decodeInputs` | `decodingUtils/utils.js:336` | `types[i].split(",")` non gestisce tuple annidate |
| `element.to.toLowerCase()` | `decodeInternalTransaction.js:504, 548`; `workerWithOption.js:1499` | `to` indefinito per CREATE fallite |
| `Object.keys(contractTree.contractAbi)` | `workerWithOption.js:557` | lancia se `contractAbi` è null con `option.default == 0` |
| REVERT e chiamate verso EOA | parser, `workerWithOption.js:957, 1192` | il bucket della profondità non si chiude, quindi lo storage viene unito alla chiamata successiva (`Revisoni/analisi_punti_tecnici.md`) |
| `txlist` di Etherscan | `mainWithOption.js:327-357` | risultato in stringa in caso di errore; pagine troncate oltre il limite dell'API |
| `filters.functions` con `inputDecoded` mancante | `mainWithOption.js:406` | `TypeError` nel filtro (catturato, estrazione vuota) |

## 6. Altre note

- **Log:** aggiunta la virgola mancante in `[… DEBUG-PARTIAL-4]`. Gli altri messaggi sono invariati.
- **Fine riga:** `solcVersionManager.js` originale usa CRLF, quello nuovo LF come il resto della catena.
- **`saveAbi`:** nella variante Erigon l'ordine delle chiavi del documento è diverso. `saveAbi` crea `new Model(storeAbi)` (`databaseStore.js:65-66`), quindi mongoose ordina i campi secondo lo schema e il dato salvato non cambia.
- **Assunzione di equivalenza:** le voci dello stack degli structLogs sono stringhe, come nel JSON-RPC. I due parser normalizzavano lo stack in modi diversi, uno con `startsWith` e uno con `String(...)`, e i risultati coincidono per le stringhe.
- **Infrastruttura:** `databaseStore.js`, `query/query.js`, `config/db.js` e `hardhat` sono importati dalla loro posizione originale, come approvato.

## 7. Verifica eseguita

- `node --check` su tutti i file di `ReformatCode/`; verifica dei `require` relativi (solo file di `ReformatCode` e infrastruttura approvata).
- `node ReformatCode/compare.js`, che carica esplicitamente vecchio e nuovo codice con stub per rete, DB, Hardhat, solc e `fork`, e usa web3, JSONStream ed ethereum-input-data-decoder reali: **111 casi, 93 identici, 18 differenze attese (FIX), 0 falliti**.
- Controllo del meccanismo di confronto: originale contro sé stesso, 111/111 identici.
- Verifica automatica di `MIGRAZIONE.md`:
  - ancoraggi sul commit;
  - riferimenti `file:riga`;
  - refactor puro identico, a parte FIX-10;
  - ogni fix applicato da solo con 0 falliti;
  - simulazione completa del percorso 1 su una copia del progetto.
- **Non coperto:** comportamento reale di nodo, Etherscan, 4byte, MongoDB e Hardhat. Il progetto non ha una suite di test. Prima di usare il codice in produzione, confronta le risposte di `POST /api/test-extraction` prima e dopo la migrazione.
