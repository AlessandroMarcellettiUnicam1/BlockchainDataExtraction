# MIGRAZIONE — catena di estrazione storica (`services/`)

Manuale meccanico per portare nel progetto il codice di `ReformatCode/services/`.

## Intestazione

| Voce | Valore |
|---|---|
| Commit di riferimento dei numeri di riga | `c741b5712204b3c77a2ff9a70dd5ca43ec30e24a` (branch `LorenzoLuzi_ReformatDelCodice`) |
| Modifiche non committate al momento della stesura | nessuna sui file originali (`git status --short` mostra solo `?? ReformatCode/`) |
| File originali modificati durante il refactor | nessuno |
| Verifica automatica | `node ReformatCode/compare.js` (111 casi: 93 identici, 18 differenze attese dai fix, 0 falliti) |

Prima di iniziare controlla di essere ancora sullo stesso commit:

```bash
git rev-parse HEAD          # deve stampare c741b5712204b3c77a2ff9a70dd5ca43ec30e24a
git status --short          # non devono comparire file in services/
```

Se il commit è diverso, i numeri di riga possono non corrispondere: cerca gli
ancoraggi per testo, non per riga.

## Scelta del percorso

I moduli della catena sono importati anche da **simulazione e compliance in tempo
reale**, che non fanno parte del refactor:

- `services/ExtractionModule/simulationOrchestrator.js` (caricato da `server.js:73`, `mempoolSimulator.js:4`, `realTimeCompliance/mempoolWorker.js:4`, `baselineWorker.js:4`, `mockMonitoring.js:7`) importa contractUtils, decodingUtils, decodeInternalTransaction, optimizedDecodeValues e workerWithOption;
- `services/realTimeCompliance/baselineWorker.js:3` e `mockMonitoring.js:2` importano `mainWithOption`.

Ci sono quindi due percorsi alternativi. **Scegline uno.**

| | Percorso 1 — sostituzione in place (schede M-01…M-28) | Percorso 2 — solo estrazione storica (scheda M-29) |
|---|---|---|
| Cosa cambia | i file in `services/` vengono sostituiti, dalle foglie verso l'alto | cambia una riga di `server.js`; `services/` resta com'è |
| Graduale | sì, una scheda alla volta | no, tutta la catena insieme |
| Simulazione e compliance | usano il nuovo codice: identico nel refactor puro (verificato), diverso con i fix (indicato in ogni scheda) | restano sul codice originale, fix esclusi |
| `ReformatCode/` dopo la migrazione | non più necessaria | resta codice in esecuzione |

**Se simulazione e compliance non devono cambiare comportamento nemmeno
indirettamente, usa il percorso 2.** Il percorso 1 è quello del manuale passo-passo
richiesto.

## Percorso 1: ordine di applicazione

Dalle foglie del grafo verso l'alto. Prima il **refactor puro**, poi i **fix**, uno
alla volta.

1. **File nuovi:** M-01 `shared/hexUtils.js` → M-02 `shared/etherscan.js` → M-03 `shared/jsonRpc.js` → M-04 `shared/contractTreeHelpers.js` → M-05 `ExtractionModule/traceStorageParser.js`.
2. **Sostituzione dei file**, in versione pre-fix: M-06 `solcVersionManager.js` → M-07 `contractUtils/solcWorker.js` → M-08 `contractUtils/utils.js` → M-09 `decodingUtils/utils.js` → M-10 `decodeInternalTransaction.js` → M-11 `optimizedDecodeValues.js` → M-12 `Erigon/erigonApi.js` → M-13 `ExtractionModule/workerWithOption.js` → M-14 `ExtractionModule/mainWithOption.js`.
3. **Fix**, ognuno indipendente salvo le dipendenze dichiarate: M-15…M-28, in qualsiasi ordine.

```
solcVersionManager ─┬─► solcWorker (fork)
                    └─► contractUtils/utils ─────────────────────────────┬─► mainWithOption ─► workerWithOption (fork)
decodingUtils/utils ─┬─► decodeInternalTransaction ─┐                    │         ▲
                     └─► Erigon/erigonApi ──────────┼────────────────────┘         │
optimizedDecodeValues ──────────────────────────────┴──────────────────────────────┘
shared/* e traceStorageParser: nuovi, usati dai file sopra
```

### Perché si sostituiscono file interi

Tutti i 9 file vanno sostituiti per intero. Ognuno è stato riorganizzato in funzioni
più piccole e alcune parti sono state spostate in file nuovi (`shared/*`,
`traceStorageParser.js`). Una sostituzione funzione per funzione richiederebbe più
di 100 schede e lascerebbe stati intermedi incoerenti, per esempio un helper
spostato ma ancora chiamato dal vecchio codice. Ogni sostituzione resta comunque
indipendente: i file nuovi usano solo gli export pubblici degli altri moduli, che
non cambiano, più i file nuovi delle schede M-01…M-05.

### File originali che diventano inutilizzati

- **Percorso 1:** nessuno, i file vengono sostituiti nella stessa posizione. Dopo
  l'ultima scheda la cartella `ReformatCode/` non serve più; `compare.js` può essere
  conservato altrove per i test di regressione. Il codice morto rimosso è elencato
  in `CHANGELOG.md`.
- **Percorso 2:** nessuno. Simulazione e compliance continuano a usare tutti i
  file originali.

### Modalità "refactor puro"

I file in `ReformatCode/` contengono già i fix, marcati `// FIX-xx`. Per applicare
prima il solo refactor, dopo aver copiato un file sostituisci ogni blocco
**Sostituzione** delle schede fix elencate con il suo **Ancoraggio (pre-fix)**.
Il pre-fix contiene il commento `// FIX-xx non applicato (MIGRAZIONE.md M-yy)`, così
lo ritrovi quando applichi il fix. La versione pre-fix è stata verificata con
`compare.js`: si comporta esattamente come l'originale (vedi "Verifica" in fondo).

## Come testare dopo ogni passo

Preparazione, una volta sola:

```bash
npm install
git worktree add ../bde-baseline c741b5712204b3c77a2ff9a70dd5ca43ec30e24a   # copia dell'originale, fuori dal repo
(cd ../bde-baseline && npm install)                                         # oppure: ln -s "$PWD/node_modules" ../bde-baseline/node_modules
```

Facoltativo, ma consigliato con DB e nodo disponibili: avvia il server sul codice
originale ed esegui `POST /api/test-extraction` su 2-3 intervalli di blocchi noti,
uno per ciascun `option` (extractionType 0, 1, 2, 3). Salva le risposte JSON:
servono come riferimento funzionale.

Dopo **ogni** scheda:

1. `node --check <file modificato>`
2. `node -e "require('./services/<file>')"`, con il percorso del file sostituito.
   Per il worker usa
   `node -e "require('./services/ExtractionModule/workerWithOption'); process.exit(0)"`.
3. Confronto automatico tra originale e albero in migrazione. In `COMPARE_FIXES`
   elenca i fix già applicati (vuoto = refactor puro):

   ```bash
   COMPARE_OLD_DIR=../bde-baseline/services COMPARE_NEW_DIR=services COMPARE_FIXES="" node ReformatCode/compare.js
   # dopo M-15 e M-19, per esempio:
   COMPARE_OLD_DIR=../bde-baseline/services COMPARE_NEW_DIR=services COMPARE_FIXES="FIX-01,FIX-05" node ReformatCode/compare.js
   ```

   Esito atteso: `0 falliti`. FIX-10 è accettato sia identico sia corretto, perché
   fa parte di M-12.
4. Facoltativo: ripeti `POST /api/test-extraction` e confronta con le risposte
   salvate. Nel refactor puro devono essere identiche, a parte tempi e metriche;
   con un fix cambiano solo i campi indicati nella sua scheda.

## Come fare rollback

- **Consigliato:** fai un commit per ogni scheda (`git commit -m "M-xx ..."`).
  Rollback di una scheda: `git revert <commit>`.
- **Senza commit:**
  - file sostituito (M-06…M-14): `git checkout c741b5712204b3c77a2ff9a70dd5ca43ec30e24a -- <file>`;
  - file nuovo (M-01…M-05): `rm <file>`;
  - fix (M-15…M-28): rimetti il blocco **Ancoraggio (pre-fix)** al posto della **Sostituzione**.
- Prima di annullare una scheda annulla quelle che dipendono da lei. Le dipendenze
  sono indicate in ogni scheda.

---

## Schede — file nuovi

### M-01 — Nuovo helper esadecimale condiviso

- **File originale e righe:** nessuno, file nuovo. Sostituisce le copie identiche di `ensureHexPrefix`/`stripHexPrefix` in `services/optimizedDecodeValues.js:6-10`, `services/decodeInternalTransaction.js:8-11` e `services/ExtractionModule/workerWithOption.js:47-56`.
- **Ancoraggio:** nessuno.
- **Sostituzione:** `cp ReformatCode/services/shared/hexUtils.js services/shared/hexUtils.js`. Crea prima la cartella con `mkdir -p services/shared`.
- **Cosa cambia:** aggiunge `services/shared/hexUtils.js` con `HEX_PREFIX`, `ensureHexPrefix` e `stripHexPrefix`.
- **Equivalenza:** identico.
- **Dipendenze:** nessuna.
- **Rischio:** basso. Controlla che `node -e "require('./services/shared/hexUtils')"` non dia errori.
- **Chiamanti:** nessuno finché non applichi M-05, M-10, M-11 e M-13.

### M-02 — Nuove costanti e helper Etherscan

- **File originale e righe:** nessuno, file nuovo. Centralizza il messaggio `"Contract source code not verified"` e l'URL `getsourcecode` presenti in contractUtils, decodingUtils, decodeInternalTransaction, workerWithOption e mainWithOption.
- **Ancoraggio:** nessuno.
- **Sostituzione:** `cp ReformatCode/services/shared/etherscan.js services/shared/etherscan.js`
- **Cosa cambia:** aggiunge `UNVERIFIED_CONTRACT_MESSAGE`, `buildGetSourceCodeUrl` e `isUnverifiedAbi`.
- **Equivalenza:** identico. L'URL ha lo stesso formato `endpoint&module=contract&action=getsourcecode&address=…&apikey=…`.
- **Dipendenze:** nessuna.
- **Rischio:** basso.
- **Chiamanti:** nessuno finché non applichi M-08, M-09, M-10, M-13 e M-14.

### M-03 — Nuovo client JSON-RPC condiviso

- **File originale e righe:** nessuno, file nuovo. Unifica `makeRpcCallStreaming`/`debugTransactionErigonStreaming` (`services/ExtractionModule/workerWithOption.js:146-203` e `services/Erigon/erigonApi.js:129-192`) e le chiamate `fetch` JSON-RPC (`services/Erigon/erigonApi.js:14-97` e `services/decodingUtils/utils.js:131-155`).
- **Ancoraggio:** nessuno.
- **Sostituzione:** `cp ReformatCode/services/shared/jsonRpc.js services/shared/jsonRpc.js`
- **Cosa cambia:** aggiunge `postJsonRpc`, `makeRpcCallStreaming` e `debugTransactionErigonStreaming`. Il log degli errori resta quello storico, `"Error fetching transaction receipt:"`.
- **Equivalenza:** identico. Il file importa `http`/`https`, assenti in erigonApi (FIX-10, attivo con M-12).
- **Dipendenze:** nessuna.
- **Rischio:** basso.
- **Chiamanti:** nessuno finché non applichi M-09, M-12 e M-13.

### M-04 — Nuovi helper per il contract tree

- **File originale e righe:** nessuno, file nuovo. Unifica il contract tree letto dalla cache e l'aggiunta dei metadati, duplicati in `services/contractUtils/utils.js:401-424` e `services/ExtractionModule/mainWithOption.js:216-227` e `290-295`.
- **Ancoraggio:** nessuno.
- **Sostituzione:** `cp ReformatCode/services/shared/contractTreeHelpers.js services/shared/contractTreeHelpers.js`
- **Cosa cambia:** aggiunge `hasCachedCompiledData`, `buildContractTreeFromCache` e `attachContractMetadata`.
- **Equivalenza:** identico.
- **Dipendenze:** nessuna.
- **Rischio:** basso.
- **Chiamanti:** nessuno finché non applichi M-08 e M-14.

### M-05 — Nuovo parser degli structLogs e delle sha trace

- **File originale e righe:** nessuno, file nuovo. Unifica i due parser `getTraceStorageFromErigon` (`services/ExtractionModule/workerWithOption.js:872-1134`) e `getTraceStorageInputStream` (`1136-1447`), oltre a `createShatrace`, `assignStorageToTheInternal`, `regroupShatrace` e `normalizeStorageEntries` (`1449-1533`, `1612-1623`).
- **Ancoraggio:** nessuno.
- **Sostituzione:** `cp ReformatCode/services/ExtractionModule/traceStorageParser.js services/ExtractionModule/traceStorageParser.js`
- **Cosa cambia:** aggiunge `parseStructLogStream` con le opzioni `ERIGON_PARSER_OPTIONS` e `INPUT_STREAM_PARSER_OPTIONS`, che descrivono le 8 differenze tra i due parser originali, più `appendStoredShaTraces`, `createShatrace`, `regroupShatrace` e `assignStorageToTheInternal`. Mantiene l'aliasing originale: le sha trace sono aggiunte allo stesso array che viene scorso.
- **Equivalenza:** identico in versione pre-fix. Contiene i blocchi di **FIX-01 (M-15)** e **FIX-07 (M-21)**: per il refactor puro applica i loro pre-fix dopo la copia.
- **Dipendenze:** M-01.
- **Rischio:** medio, è il punto più delicato del refactor. Verifica con `compare.js` (casi `worker.getTraceStorage*`, `createShatrace`, `assignStorageToTheInternal`).
- **Chiamanti:** nessuno finché non applichi M-13.

---

## Schede — sostituzione dei file

### M-06 — `solcVersionManager.js`

- **File originale e righe:** `services/solcVersionManager.js` righe 1–106 (file intero).
- **Cosa cambia:** costanti per URL, tentativi e timeout; ciclo di retry con `for`; `satisfiesConstraint` al posto della catena di `else if`; `return` dopo `reject` in `getRemoteVersion`. Le funzioni esportate `detectVersion(contractSource)` e `getRemoteVersion(version)` restano invariate.
- **Equivalenza:** identico. `rejectUnauthorized:false` e la regex malformata restano invariati e sono segnalati nel CHANGELOG.
- **Fine riga:** l'originale usa **CRLF** (unico file della catena). Gli ancoraggi qui sotto sono riportati senza `\r`, mentre il file nuovo usa LF come il resto del progetto. Il diff mostrerà quindi tutte le righe come modificate.
- **Dipendenze:** nessuna.
- **Rischio:** basso. Verifica la compilazione di un contratto non in cache.
- **Chiamanti:**
  - `services/contractUtils/utils.js:1` → `require("../solcVersionManager")`
  - `services/contractUtils/solcWorker.js:1` → `require("../solcVersionManager")`

**Ancoraggio inizio (originale, righe 1–2):**
```js
// Convert solidity version from string to array of numbers
const axios = require('axios')
```

**Ancoraggio fine (originale, righe 104–106):**
```js
    detectVersion,
    getRemoteVersion
}
```

**Sostituzione:** `cp ReformatCode/services/solcVersionManager.js services/solcVersionManager.js`. Non serve adattare i percorsi.

### M-07 — `contractUtils/solcWorker.js`

- **File originale e righe:** `services/contractUtils/solcWorker.js` righe 1–40 (file intero).
- **Cosa cambia:** costanti `EXIT_DELAY_MS` e `WORKER_TIMEOUT_MS`; helper `replyAndExit` al posto di quattro blocchi `send` + `setTimeout(exit)` duplicati. Il protocollo IPC resta `{input, compilerVersion}` → `{output}` oppure `{error}`.
- **Equivalenza:** identico.
- **Dipendenze:** nessuna. Usa `getRemoteVersion`, presente sia nel vecchio sia nel nuovo `solcVersionManager`.
- **Rischio:** basso.
- **Chiamanti:**
  - `services/contractUtils/utils.js:17` → `path.join(__dirname, "solcWorker.js")`, avviato con `fork`

**Ancoraggio inizio (originale, righe 1–2):**
```js
const { getRemoteVersion } = require("../solcVersionManager");

```

**Ancoraggio fine (originale, righe 38–40):**
```js
    console.error("Worker timeout - forcing exit");
    process.exit(1);
}, TIMEOUT_MS);
```

**Sostituzione:** `cp ReformatCode/services/contractUtils/solcWorker.js services/contractUtils/solcWorker.js`. Non serve adattare i percorsi.

### M-08 — `contractUtils/utils.js`

- **File originale e righe:** `services/contractUtils/utils.js` righe 1–442 (file intero).
- **Cosa cambia:**
  - **`getContractCodeEtherscan`** è divisa in `hasVerifiedCachedAbi`, `contractDataFromCache`, `fetchContractDataFromEtherscan` e `parseSourceFiles`.
  - **`getCompiledData`** usa `buildCompilerInput` e un solo `JSON.parse` invece di due.
  - **`getContractVariableTree`** ha un unico ciclo (`appendStorageVariables`). La regola originale resta: se il primo contratto del file ha storage, viene letto solo quello.
  - **`getContractTree`** usa le early return e gli helper di M-04.
  - **Rimosso:** `getAbi` (morto e con una variabile globale implicita), gli import `execFile`, `fs` e `getRemoteVersion`, la variabile `buffer`.
  - **Export invariati:** `getCompiledData`, `getContractCodeEtherscan` e `getContractTree(smartContract, impl_contract, endpoint, apiKey, queryResult, firstExtraction=true)`.
- **Equivalenza:** identico. `contracts` resta un Array usato come mappa, perché `getCompiledData` usa `Array.isArray`.
- **Dipendenze:** M-02, M-04.
- **Rischio:** medio. Verifica l'estrazione di un contratto non in cache (compilazione e `saveCompiledContractData`) e di uno in cache.
- **Chiamanti:**
  - `services/ExtractionModule/mainWithOption.js:6` → `require ('../contractUtils/utils')`
  - `services/ExtractionModule/workerWithOption.js:5` → `require("../contractUtils/utils")`
  - `services/ExtractionModule/simulationOrchestrator.js:5` → `require("../contractUtils/utils")` (simulazione: chiamate a `:58`, `:706`, `:734`)

**Ancoraggio inizio (originale, righe 1–2):**
```js
const {getRemoteVersion, detectVersion} = require("../solcVersionManager");
const axios = require("axios");
```

**Ancoraggio fine (originale, righe 440–442):**
```js
    getContractCodeEtherscan,
    getContractTree
}
```

**Sostituzione:** `cp ReformatCode/services/contractUtils/utils.js services/contractUtils/utils.js`, poi adatta i percorsi.

**Adattamento percorsi — prima (righe 7–8 del file copiato):**
```js
// MIGRAZIONE: dentro services/contractUtils il percorso diventa "../../databaseStore"
const { saveCompiledContractData } = require("../../../databaseStore");
```

**Adattamento percorsi — dopo:**
```js
const { saveCompiledContractData } = require("../../databaseStore");
```

### M-09 — `decodingUtils/utils.js`

- **File originale e righe:** `services/decodingUtils/utils.js` righe 1–383 (file intero).
- **Cosa cambia:**
  - `getEventFromErigon` (ricevuta) usa `postJsonRpc` (M-03).
  - Il ternario sempre falso in `iterateInternalForEvent` (riga 259) è sostituito da `element["to"]`, il valore che produceva in ogni caso.
  - `decodeInput` ha un'unica uscita per i tipi diversi da `uint256`, che restituisce il valore così com'è.
  - **Rimosso:** l'import `Web3`.
  - **Nuovo export additivo:** `assignEventToInternal`, usato da M-12.
  - **Mantenuti:** gli export mai importati `safeCheck` e `checkIfEventIsAlreadyStored`, e il parametro inutilizzato `web3` di `decodeTransactionInputs`.
- **Equivalenza:** identico.
- **Dipendenze:** M-02, M-03.
- **Rischio:** medio. Verifica eventi pubblici e interni di una transazione con proxy.
- **Chiamanti:**
  - `services/decodeInternalTransaction.js:5` → `require("./decodingUtils/utils")`
  - `services/Erigon/erigonApi.js:3` → `require("../decodingUtils/utils")`
  - `services/ExtractionModule/workerWithOption.js:16` → `require('../decodingUtils/utils')`
  - `services/ExtractionModule/simulationOrchestrator.js:7` → `require("../decodingUtils/utils")` (simulazione: `:108`, `:159`, `:163`, `:761`)

**Ancoraggio inizio (originale, righe 1–2):**
```js
const InputDataDecoder = require('ethereum-input-data-decoder');
const { searchAbi}= require('../../query/query')
```

**Ancoraggio fine (originale, righe 381–383):**
```js
    getEventsFromInternal,
}

```

**Sostituzione:** `cp ReformatCode/services/decodingUtils/utils.js services/decodingUtils/utils.js`, poi adatta i percorsi.

**Adattamento percorsi — prima (righe 5–8 del file copiato):**
```js
// MIGRAZIONE: dentro services/decodingUtils i due percorsi diventano
// "../../query/query" e "../../databaseStore"
const { searchAbi } = require("../../../query/query");
const { saveAbi } = require("../../../databaseStore");
```

**Adattamento percorsi — dopo:**
```js
const { searchAbi } = require("../../query/query");
const { saveAbi } = require("../../databaseStore");
```

### M-10 — `decodeInternalTransaction.js`

- **File originale e righe:** `services/decodeInternalTransaction.js` righe 1–666 (file intero).
- **Cosa cambia:**
  - **Fetch da Etherscan:** `handleAbiFetch` e `handleAbiFetchErigon` condividono `processFetchedAbi`, `decodeProxyCall` e `decodeRegularCall`. Le differenze sono in `STANDARD_FETCH_VARIANT` e `ERIGON_FETCH_VARIANT`.
  - **ABI da DB:** `handleAbiFromDb` e `handleAbiFromDbErigon` condividono `decodeWithStoredImplementation` e `completeActivityWithFallbacks`.
  - **Metriche:** sono misurate con `measureAsync`/`decodeInputsMeasured`, e le chiavi sono raccolte in `METRIC`.
  - **Rimosso:** la variabile `success` e il blocco irraggiungibile (righe 484-486).
  - **Export invariati:** `decodeInternalTransaction`, `newDecodedInternalTransaction`, `handleAbiFetch`, `decodeInternalRecursive` e `handleAbiFromDb`.
- **Equivalenza:** identico in versione pre-fix. Contiene i blocchi di **FIX-09 (M-23)** e **FIX-11 (M-24)**.
- **Dipendenze:** M-01, M-02.
- **Rischio:** alto: logica ramificata con ABI, proxy, 4byte e retry. Verifica in `compare.js` i casi `decodeInternal*` e `handleAbi*`, poi una transazione reale con chiamate interne verso un proxy.
- **Chiamanti:**
  - `services/Erigon/erigonApi.js:2` → `require("../decodeInternalTransaction")` (import inutilizzato; rimosso da M-12)
  - `services/ExtractionModule/workerWithOption.js:11` → `require('../decodeInternalTransaction')`
  - `services/ExtractionModule/simulationOrchestrator.js:11` → `require("../decodeInternalTransaction")` (simulazione: `decodeInternalRecursive` a `:593`)

**Ancoraggio inizio (originale, righe 1–2):**
```js
const axios = require("axios");
const { searchAbi } = require("../query/query");
```

**Ancoraggio fine (originale, righe 664–666):**
```js
    decodeInternalRecursive,
    handleAbiFromDb
};
```

**Sostituzione:** `cp ReformatCode/services/decodeInternalTransaction.js services/decodeInternalTransaction.js`, poi adatta i percorsi.

**Adattamento percorsi — prima (righe 4–8 del file copiato):**
```js
// MIGRAZIONE: dentro services/ i tre percorsi diventano
// "../query/query", "../databaseStore" e "../config/db"
const { searchAbi } = require("../../query/query");
const { saveAbi } = require("../../databaseStore");
const { connectDB } = require("../../config/db");
```

**Adattamento percorsi — dopo:**
```js
const { searchAbi } = require("../query/query");
const { saveAbi } = require("../databaseStore");
const { connectDB } = require("../config/db");
```

### M-11 — `optimizedDecodeValues.js`

- **File originale e righe:** `services/optimizedDecodeValues.js` righe 1–908 (file intero).
- **Cosa cambia:**
  - **Costanti:** `SLOT_HEX_LENGTH`, `MAX_COMPLEX_BASE_SLOT` (300) e `MAX_DIRECT_SLOT_NUMBER` (9999999).
  - **Helper per gli slot:** `toSlotKey`, `consecutiveSlotKey`, `slotKeyWithIndexSum`, `keccakOfShaTrace` ed `extractPackedElements`.
  - **Unificati:**
    - `readString` e `readStringArray` in `readStringFromSlots`;
    - i due `decodeOptimize*DynamicArray` in `splitPackedDynamicArray`;
    - i tre builder di `getContractVariable` in `buildStorageVariable`;
    - i due rami identici di `getStructMembersByVariable`.
  - **`removeDuplicate`** usa un `Set`.
  - **Rimossi:**
    - gli import `mongoose.get` e `fs`;
    - la variabile globale implicita `type`;
    - il parametro inutilizzato `functionName` delle funzioni interne.
  - **Export invariato:** `optimizedDecodeValues(sstore, contractTree, shaTraces, functionStorage, functionName, mainContract, web3Variable, contractCompiledPassed)`.
- **Equivalenza:** identico in versione pre-fix. Contiene i blocchi di FIX-02 (M-16), FIX-03 (M-17), FIX-04 (M-18), FIX-05 (M-19), FIX-06 (M-20), FIX-13 (M-26) e FIX-14 (M-27).
- **Dipendenze:** M-01.
- **Rischio:** alto: decodifica dello storage. Verifica in `compare.js` i casi `optimizedDecodeValues`, poi `storageState` su transazioni reali.
- **Chiamanti:**
  - `services/Erigon/erigonApi.js:4` → `require("../optimizedDecodeValues")` (import inutilizzato; rimosso da M-12)
  - `services/ExtractionModule/workerWithOption.js:12` → `require('../optimizedDecodeValues')`
  - `services/ExtractionModule/simulationOrchestrator.js:10` → `require("../optimizedDecodeValues")` (simulazione: `:488`, `:708`)

**Ancoraggio inizio (originale, righe 1–2):**
```js
const { get } = require("mongoose");
const fs = require('fs');
```

**Ancoraggio fine (originale, righe 906–908):**
```js
    
}
module.exports = { optimizedDecodeValues };
```

**Sostituzione:** `cp ReformatCode/services/optimizedDecodeValues.js services/optimizedDecodeValues.js`. Non serve adattare i percorsi.

### M-12 — `Erigon/erigonApi.js`

- **File originale e righe:** `services/Erigon/erigonApi.js` righe 1–309 (file intero).
- **Cosa cambia:**
  - **Chiamate al nodo:** le tre `fetch` JSON-RPC usano `postJsonRpc`; `debugTransactionErigonStreaming` arriva da `shared/jsonRpc`; `assignEventToInternal` è ri-esportata da `decodingUtils`.
  - **`buildTransactionHierarchy`** è divisa in `fetchTracePage`, `fetchAllTraces` e `buildPublicTransaction`. Per le trace della stessa transazione le chiamate RPC si fanno una volta sola: stesso output, meno richieste.
  - **Rimosso:** gli import inutilizzati `decodeInternalTransaction`, `optimizedDecodeValues` e `JSONStream`.
  - **Export invariati:** `assignEventToInternal`, `getEventFromErigon`, `debugTransactionErigonStreaming` e `buildTransactionHierarchy`.
- **Equivalenza:** identico in versione pre-fix per `buildTransactionHierarchy`. Contiene i blocchi di **FIX-08 (M-22)** e **FIX-15 (M-28)**. Contiene anche **FIX-10**, senza blocco pre-fix: l'originale `debugTransactionErigonStreaming` di questo file lanciava `ReferenceError: http is not defined` perché `http`/`https` non erano importati. Ora usa `shared/jsonRpc.js`. L'export non è importato da nessun file del workspace.
- **Dipendenze:** M-03, M-09 (export `assignEventToInternal`).
- **Rischio:** medio. Verifica un'estrazione `/submitInternal` o `/api/test-extraction` (modalità `newParams`).
- **Chiamanti:**
  - `services/ExtractionModule/mainWithOption.js:19` → `require("../Erigon/erigonApi")`

**Ancoraggio inizio (originale, righe 1–2):**
```js

const {newDecodedInternalTransaction,decodeInternalTransaction}=require("../decodeInternalTransaction")
```

**Ancoraggio fine (originale, righe 307–309):**
```js
    debugTransactionErigonStreaming,
    buildTransactionHierarchy
}
```

**Sostituzione:** `cp ReformatCode/services/Erigon/erigonApi.js services/Erigon/erigonApi.js`. Non serve adattare i percorsi.

### M-13 — `ExtractionModule/workerWithOption.js`

- **File originale e righe:** `services/ExtractionModule/workerWithOption.js` righe 1–1624 (file intero).
- **Cosa cambia:**
  - **Parsing:** è delegato a `traceStorageParser.js` (M-05); `getTraceStorageFromErigon` e `getTraceStorageInputStream` restano come funzioni sottili che preservano metriche, log e gestione degli errori di ciascun percorso.
  - **`createTransactionLog`** è divisa in:
    - `normalizeTimestamp`;
    - `buildInitialTransactionLog`;
    - `traceTransactionStorage`, con `TRACE_MODES` per i due percorsi;
    - `addTraceData`;
    - `decodeThroughProxyImplementation`;
    - `resolveCollectionName`.
  - **`getEventForTransaction`:** i tre blocchi di eventi della ricevuta sono unificati in `appendReceiptEvents`. `duplicateEvents` si chiama ora `avoidDuplicatingInternalEvents`.
  - **Rimossi:**
    - le funzioni morte `debugTransaction`, `getTraceStorage` e `retriveImplementationContract` (righe 125-144 e 666-869);
    - il parametro `extractionType`, mai inviato da main;
    - gli import `axios`, `fs`, `path`, `net`, `https` e `http`;
    - le variabili `debugResult` e `functionStorage`;
    - le assegnazioni a `null` nei `finally`, che non avevano effetto.
  - **Export invariati:** `makeRpcCallStreaming`, `decodeInput`, `regroupShatrace`, `createShatrace`, `assignStorageToTheInternal` e `decodeInteralTxsStorage`.
  - **Invariati:** il protocollo IPC e gli handler `process.on`.
- **Equivalenza:** identico in versione pre-fix. Contiene il blocco di **FIX-12 (M-25)**, e re-esporta `createShatrace`/`assignStorageToTheInternal` di M-05, quindi attiva FIX-01 e FIX-07 se li hai applicati. Unica differenza nei log: aggiunta una virgola mancante in `DEBUG-PARTIAL-4`.
- **Dipendenze:** M-01, M-02, M-03, M-05.
- **Rischio:** alto: è il processo che estrae ogni transazione. Verifica in `compare.js` i casi `worker.*`, poi un'estrazione reale per ciascun extractionType (0, 1, 2, 3).
- **Chiamanti:**
  - `services/ExtractionModule/mainWithOption.js:505` → `path.join(__dirname, 'workerWithOption.js')`, avviato con `fork`
  - `services/ExtractionModule/simulationOrchestrator.js:13` → `require("./workerWithOption")` (simulazione: `decodeInput` a `:73` e `:744`, `createShatrace` a `:476`, `regroupShatrace` a `:480`)

**Ancoraggio inizio (originale, righe 1–2):**
```js
const mongoose = require("mongoose");
const { connectDB } = require("../../config/db");
```

**Ancoraggio fine (originale, righe 1622–1624):**
```js
    return normalized;
}

```

**Sostituzione:** `cp ReformatCode/services/ExtractionModule/workerWithOption.js services/ExtractionModule/workerWithOption.js`, poi adatta i percorsi.

**Adattamento percorsi — prima (righe 17–21 del file copiato):**
```js
// MIGRAZIONE: dentro services/ExtractionModule i tre percorsi diventano
// "../../config/db", "../../databaseStore" e "../../query/query"
const { connectDB } = require("../../../config/db");
const { saveTransaction, saveAbi } = require("../../../databaseStore");
const { searchAbi } = require("../../../query/query");
```

**Adattamento percorsi — dopo:**
```js
const { connectDB } = require("../../config/db");
const { saveTransaction, saveAbi } = require("../../databaseStore");
const { searchAbi } = require("../../query/query");
```

### M-14 — `ExtractionModule/mainWithOption.js`

- **File originale e righe:** `services/ExtractionModule/mainWithOption.js` righe 1–556 (file intero).
- **Cosa cambia:**
  - **Configurazione di rete:** lo `switch` diventa la mappa `NETWORK_ENV` letta da `buildNetworkData`.
  - **`getAllTransactions`** è divisa in `extractFromAddressRange` (newParams) ed `extractFromContract` (oldParams).
  - **`getContractTree`** usa `compileContractTree`, `describeContractLookup` e gli helper di M-04.
  - **`getStorageData`** usa `extractSingleTransaction`.
  - **Rimossi:**
    - gli import inutilizzati `Web3`, `fs`, `mongoose`, `v8`, `ethers`, `convertProcessSignalToExitCode` e `saveExtractionLog`;
    - la variabile `contractAbi`;
    - i blocchi commentati.
  - **Export invariato:** `getAllTransactions(oldParams, newParams, returnInMemory=false)`, compreso il formato misto dei risultati: `{log, metrics}` per le transazioni nuove, documento del DB per quelle già estratte.
- **Equivalenza:** identico.
- **Dipendenze:** M-02, M-04.
- **Rischio:** medio. Verifica `/submit` (oldParams), `/submitInternal` o `/api/test-extraction` (newParams) e una transazione già presente in DB.
- **Chiamanti:**
  - `server.js:23` → `require("./services/ExtractionModule/mainWithOption")` (chiamate attive a `:576`, `:615` e `:1651`; quelle a `:486` e `:525` sono nel blocco commentato `server.js:431-531`)
  - `services/realTimeCompliance/baselineWorker.js:3` → `require('../ExtractionModule/mainWithOption')` (compliance: `:91`)
  - `services/realTimeCompliance/mockMonitoring.js:2` → `require('../ExtractionModule/mainWithOption')` (compliance: `:78`)

**Ancoraggio inizio (originale, righe 1–2):**
```js
const {Web3} = require('web3');

```

**Ancoraggio fine (originale, righe 554–556):**
```js

//ultima transazione
// 0x8848f14a738c0f2bb87247e6796e1950068c14791f9b436b1b9d31c6747e695e
```

**Sostituzione:** `cp ReformatCode/services/ExtractionModule/mainWithOption.js services/ExtractionModule/mainWithOption.js`, poi adatta i percorsi.

**Adattamento percorsi — prima (righe 8–12 del file copiato):**
```js
// MIGRAZIONE: dentro services/ExtractionModule i tre percorsi diventano
// "../../query/query", "../../config/db" e "../../databaseStore"
const { searchTransaction, searchAbi } = require("../../../query/query");
const { connectDB } = require("../../../config/db");
const { saveExtractionMetrics, saveCompiledContractData } = require("../../../databaseStore");
```

**Adattamento percorsi — dopo:**
```js
const { searchTransaction, searchAbi } = require("../../query/query");
const { connectDB } = require("../../config/db");
const { saveExtractionMetrics, saveCompiledContractData } = require("../../databaseStore");
```

---

## Schede — fix

Ogni fix si applica al file già sostituito: il suo ancoraggio è il blocco pre-fix
lasciato dalla modalità "refactor puro". Se hai copiato i file senza togliere i fix,
questi sono già applicati: spunta la casella e passa oltre.

### M-15 — FIX-01: `hexToNumber` senza prefisso in `createShatrace`

- **File originale e righe:** `services/ExtractionModule/workerWithOption.js` riga 1465.
- **Riga originale del difetto:** `services/ExtractionModule/workerWithOption.js:1465` → `web3.utils.hexToNumber(singleObject.trackBuffer[test].hexStorageIndex)`
- **File da modificare:** `services/ExtractionModule/traceStorageParser.js` (`createShatrace`).
- **Cosa cambia:**
  - **Prima:** `hexStorageIndex` è una parola di memoria a 64 caratteri senza `0x`, e `web3.utils.hexToNumber` lancia `must pass "hex" validation` (verificato con web3 4.16.0). Nel percorso Erigon (option `internalTransaction == 1`) la chiamata non è protetta (`workerWithOption.js:1069-1071`). Basta una chiamata interna che scrive su un mapping per perdere tutti gli `storageState` e gli `internalTxs` della transazione.
  - **Dopo:** il valore è convertito con `ensureHexPrefix` e quei dati sono presenti.
- **Equivalenza:** modificato per fix FIX-01.
- **Dipendenze:** M-05, attivo nel worker dopo M-13.
- **Rischio:** medio. Cambiano `storageState`, `internalTxs` e gli eventi delle transazioni con scritture su mapping nelle chiamate interne. In `compare.js`: casi `FIX-01`.
- **Chiamanti coinvolti:**
  - `services/ExtractionModule/workerWithOption.js:1070` → `createShatrace(mapForStorage[singleObject],sstoreBuffer,web3);`
  - `services/ExtractionModule/simulationOrchestrator.js:476` → `createShatrace(mapForStorage[singleObject], sstoreBuffer, web3);` (simulazione: senza try/catch, quindi anche qui l'errore spariva)

**Ancoraggio (pre-fix, blocco 1):**
```js
    appendStoredShaTraces(singleObject.finalShaTraces, sstoreBuffer, web3, (value) => value, false); // FIX-01 non applicato (MIGRAZIONE.md M-15)
```

**Sostituzione (blocco 1):**
```js
    // FIX-01: hexStorageIndex è una parola di memoria senza "0x": hexToNumber
    // lanciava e (nel percorso Erigon) si perdevano storage e transazioni interne.
    appendStoredShaTraces(singleObject.finalShaTraces, sstoreBuffer, web3, ensureHexPrefix, false);
```

### M-16 — FIX-02: chiavi di storage senza padding a 64 caratteri

- **File originale e righe:** `services/optimizedDecodeValues.js` righe 338, 402, 453, 474, 492 e 502.
- **Riga originale del difetto:** `services/optimizedDecodeValues.js:338` → `let slotResult = web3.utils.numberToHex(num).substring(2);`
- **Riga originale del difetto:** `services/optimizedDecodeValues.js:492` → `let keySlot=web3.utils.numberToHex(web3.utils.hexToNumber(keyOfSlot)+BigInt(i)).slice(2);`
- **File da modificare:** `services/optimizedDecodeValues.js` (`consecutiveSlotKey`, `slotKeyWithIndexSum`).
- **Cosa cambia:**
  - **Prima:** `numberToHex` toglie gli zeri iniziali, mentre le chiavi di `functionStorage` hanno 64 caratteri; verificato: un hash che inizia con `0` produce 63 caratteri. Quando `keccak(slot)` inizia con `0`, circa 1 caso su 16, stringhe lunghe, `string[]`, `uint256[]` e `bytes32[]` dinamici non vengono letti.
  - **Dopo:** padding a 64 caratteri, come già fanno `getContractVariable` e `readStruct`.
- **Equivalenza:** modificato per fix FIX-02.
- **Dipendenze:** M-11.
- **Rischio:** basso. Compaiono valori prima assenti. In `compare.js`: casi `FIX-02`.
- **Chiamanti coinvolti:**
  - `services/ExtractionModule/workerWithOption.js:12` → `require('../optimizedDecodeValues')`
  - `services/ExtractionModule/simulationOrchestrator.js:10` → `require("../optimizedDecodeValues")`

**Ancoraggio (pre-fix, blocco 1):**
```js
    return web3.utils.numberToHex(slotNumber).substring(2); // FIX-02 non applicato (MIGRAZIONE.md M-16)
```

**Sostituzione (blocco 1):**
```js
    // FIX-02: numberToHex elimina gli zeri iniziali, mentre le chiavi di
    // functionStorage hanno sempre 64 caratteri: senza padding la lettura fallisce
    // quando l'hash inizia con "0".
    return web3.utils.padLeft(web3.utils.numberToHex(slotNumber).substring(2), SLOT_HEX_LENGTH);
```

**Ancoraggio (pre-fix, blocco 2):**
```js
    return web3.utils.numberToHex(slotNumber).slice(2); // FIX-02 non applicato (MIGRAZIONE.md M-16)
```

**Sostituzione (blocco 2):**
```js
    // FIX-02: padding a 64 caratteri (vedi consecutiveSlotKey).
    return web3.utils.padLeft(web3.utils.numberToHex(slotNumber).slice(2), SLOT_HEX_LENGTH);
```

### M-17 — FIX-03: `indexSum` interpretato come decimale e `hexToNumber` senza prefisso

- **File originale e righe:** `services/optimizedDecodeValues.js` righe 401–402, 474 e 502.
- **Riga originale del difetto:** `services/optimizedDecodeValues.js:401` → `let keySlotToNumber=web3.utils.hexToNumber(keyslot);`
- **Riga originale del difetto:** `services/optimizedDecodeValues.js:502` → `BigInt(shaTraces.indexSum)`
- **File da modificare:** `services/optimizedDecodeValues.js` (`slotKeyWithIndexSum`).
- **Cosa cambia:**
  - **Origine di `indexSum`:** è una parola dello stack normalizzata a 64 caratteri senza `0x` (`workerWithOption.js:915-916` e `1285-1286`).
  - **Prima:** `BigInt("…10")` vale 10 invece di 16, e `BigInt("…0a")` lancia; verificato. In più `hexToNumber(keyslot)` (riga 401) riceve uno slot senza `0x` e lancia sempre. Risultato: indice sbagliato negli array dinamici, oppure perdita dell'intera decodifica per gli array dinamici di struct.
  - **Dopo:** entrambi i valori sono convertiti con `ensureHexPrefix`.
- **Equivalenza:** modificato per fix FIX-03.
- **Dipendenze:** M-11.
- **Rischio:** basso. In `compare.js`: casi `FIX-03`.
- **Chiamanti coinvolti:** come M-16.

**Ancoraggio (pre-fix, blocco 1):**
```js
    const slotNumber = web3.utils.hexToNumber(baseSlotHex) + BigInt(indexSum); // FIX-03 non applicato (MIGRAZIONE.md M-17)
```

**Sostituzione (blocco 1):**
```js
    // FIX-03: hexToNumber lancia senza prefisso 0x (lo slot base può arrivare
    // senza prefisso) e BigInt() legge una stringa senza 0x come decimale
    // (o lancia se contiene a-f): indexSum è una parola dello stack.
    const slotNumber = web3.utils.hexToNumber(ensureHexPrefix(baseSlotHex)) + BigInt(ensureHexPrefix(indexSum));
```

### M-18 — FIX-04: `readComplexData` restituisce `undefined`

- **File originale e righe:** `services/optimizedDecodeValues.js` righe 89, 260–261 e 433–434.
- **Riga originale del difetto:** `services/optimizedDecodeValues.js:89` → `if (resultreadComplexData.length != undefined) {`
- **File da modificare:** `services/optimizedDecodeValues.js` (`appendPreprocessed`, `readStructFromComplexData`, `readStructFromDynamicArray`).
- **Cosa cambia:**
  - **Origine di `undefined`:** `readComplexData` restituisce `undefined` per `readArrayComplexStatic` (stub) e per gli array dinamici di tipi diversi da string/struct, per esempio `address[]`.
  - **Prima:** `.length` su `undefined` lancia `TypeError`, e lo stesso vale per un membro di struct `undefined` in `readStruct`/`removeStructFormOutput`. Si perde la decodifica dello storage dell'intera transazione.
  - **Dopo:** i risultati `undefined` vengono saltati e le altre variabili sono decodificate.
- **Equivalenza:** modificato per fix FIX-04.
- **Dipendenze:** M-11.
- **Rischio:** basso. In `compare.js`: caso `FIX-04`.
- **Chiamanti coinvolti:** come M-16.

**Ancoraggio (pre-fix, blocco 1):**
```js
    // FIX-04 non applicato (MIGRAZIONE.md M-18, appendPreprocessed)
```

**Sostituzione (blocco 1):**
```js
    // FIX-04: readComplexData restituisce undefined per i tipi non gestiti
    // (es. array statici di tipi complessi, array dinamici di address):
    // "result.length" lanciava TypeError e si perdeva la decodifica dell'intera transazione.
    if (result === undefined) return;
```

**Ancoraggio (pre-fix, blocco 2):**
```js
        variable.element.push(decodedMember); // FIX-04 non applicato (MIGRAZIONE.md M-18, readStructFromComplexData)
```

**Sostituzione (blocco 2):**
```js
        // FIX-04: un membro di tipo non gestito (undefined) faceva fallire readStruct
        // e removeStructFormOutput (TypeError su undefined.value / undefined.type).
        if (decodedMember !== undefined) variable.element.push(decodedMember);
```

**Ancoraggio (pre-fix, blocco 3):**
```js
        variable.element.push(decodedMember); // FIX-04 non applicato (MIGRAZIONE.md M-18, readStructFromDynamicArray)
```

**Sostituzione (blocco 3):**
```js
        // FIX-04: vedi readStructFromComplexData.
        if (decodedMember !== undefined) variable.element.push(decodedMember);
```

### M-19 — FIX-05: gli enum spariscono dall'output

- **File originale e righe:** `services/optimizedDecodeValues.js` righe 612–615.
- **Riga originale del difetto:** `services/optimizedDecodeValues.js:615` → `return Number(bigIntvalue);`
- **File da modificare:** `services/optimizedDecodeValues.js` (`decodePartialPrimitive`).
- **Cosa cambia:**
  - **Prima:** i tipi enum di solc sono sempre `t_enum(Nome)id`, con le parentesi, quindi passano da `decodePartialPrimitive`. Questa restituiva un `Number` invece della variabile; il numero diventava un oggetto senza nome né valore e veniva filtrato. Nessun enum compariva in `storageState`, e i membri enum delle struct avevano valore `undefined`.
  - **Dopo:** `decodedValue` è impostato e la variabile viene restituita.
- **Equivalenza:** modificato per fix FIX-05.
- **Dipendenze:** M-11.
- **Rischio:** basso. Compaiono in `storageState` le variabili enum (valore numerico). In `compare.js`: caso `FIX-05`.
- **Chiamanti coinvolti:** come M-16.

**Ancoraggio (pre-fix, blocco 1):**
```js
        return decodeEnumValue(variable.value); // FIX-05 non applicato (MIGRAZIONE.md M-19)
```

**Sostituzione (blocco 1):**
```js
        // FIX-05: restituiva il Number invece della variabile, quindi tutti gli enum
        // (tipo "t_enum(X)id", sempre con parentesi) sparivano dall'output.
        variable.decodedValue = decodeEnumValue(variable.value);
        return variable;
```

### M-20 — FIX-06: ultima variabile impacchettata letta con lo slice sbagliato

- **File originale e righe:** `services/optimizedDecodeValues.js` righe 898–900.
- **Riga originale del difetto:** `services/optimizedDecodeValues.js:899` → `const startOfTheElement = storageStringLength - endOfTheElement;`
- **File da modificare:** `services/optimizedDecodeValues.js` (`newReadVarFormOffset`).
- **Cosa cambia:**
  - **Prima:** per l'ultima variabile di uno slot si usava `slice(offset*2, 64-offset*2)`. Con offset ≥ 16 il risultato è `""` (per esempio un `bool` dopo un `address`); con offset più piccoli la variabile può essere troncata.
  - **Dopo:** `slice(0, 64-offset*2)`.
  - **Effetto da solo:** nessuno sull'output, perché oggi il valore calcolato viene sovrascritto (vedi FIX-13). Serve come prerequisito di M-26.
- **Equivalenza:** modificato per fix FIX-06.
- **Dipendenze:** M-11.
- **Rischio:** basso.
- **Chiamanti coinvolti:** come M-16.

**Ancoraggio (pre-fix, blocco 1):**
```js
            start = SLOT_HEX_LENGTH - end; // FIX-06 non applicato (MIGRAZIONE.md M-20)
```

**Sostituzione (blocco 1):**
```js
            // FIX-06: l'ultima variabile usava slice(offset*2, 64-offset*2), che per
            // offset >= 16 restituisce "" (es. bool dopo un address) e altrimenti può
            // troncare la variabile: il valore va da 0 a 64-offset*2.
            start = 0;
```

### M-21 — FIX-07: storage assegnato alla chiamata interna sbagliata

- **File originale e righe:** `services/ExtractionModule/workerWithOption.js` righe 1485–1494.
- **Riga originale del difetto:** `services/ExtractionModule/workerWithOption.js:1491` → `assignStorageToTheInternal(txs.calls,mapForStorage,index);`
- **File da modificare:** `services/ExtractionModule/traceStorageParser.js` (`assignStorageToTheInternal`).
- **Cosa cambia:**
  - **Prima:** l'indice del bucket era passato per valore, quindi la ricorsione non lo aggiornava. Con l'albero `[A{A1}, B]`, B riceveva il bucket di A1. È già segnalato in `Revisoni/analisi_punti_tecnici.md`, punto 3.1.
  - **Dopo:** la funzione restituisce l'indice successivo, che viene riassegnato. Nessun chiamante usava il valore restituito, prima `undefined`.
- **Equivalenza:** modificato per fix FIX-07.
- **Dipendenze:** M-05, attivo nel worker dopo M-13.
- **Rischio:** medio. Cambia lo `storageState` delle chiamate interne successive a una chiamata con figli (extractionType 3). In `compare.js`: caso `FIX-07`.
- **Chiamanti coinvolti:**
  - `services/ExtractionModule/workerWithOption.js:1103` → `assignStorageToTheInternal(internalTxs,mapForStorage);`
  - simulazione: importata a `simulationOrchestrator.js:13`, ma la chiamata a `:533` è commentata.

**Ancoraggio (pre-fix, blocco 1):**
```js
            assignStorageToTheInternal(txs.calls, mapForStorage, index); // FIX-07 non applicato (MIGRAZIONE.md M-21)
```

**Sostituzione (blocco 1):**
```js
            // FIX-07: l'indice era passato per valore e non tornava indietro: dopo
            // una chiamata con figli, la successiva riceveva il bucket del primo figlio.
            index = assignStorageToTheInternal(txs.calls, mapForStorage, index);
```

### M-22 — FIX-08: paginazione di `trace_filter`

- **File originale e righe:** `services/Erigon/erigonApi.js` righe 203–246.
- **Riga originale del difetto:** `services/Erigon/erigonApi.js:210` → `fromBlock: "0x" + parseInt(fromBlock).toString(16),`
- **Riga originale del difetto:** `services/Erigon/erigonApi.js:224` → `traces = response.data.result || [];`
- **Riga originale del difetto:** `services/Erigon/erigonApi.js:228` → `return [];`
- **File da modificare:** `services/Erigon/erigonApi.js` (`fetchAllTraces`).
- **Cosa cambia:**
  - **Prima:**
    - la richiesta usava sempre `fromBlock` e mai `currentFromBlock`;
    - ogni pagina sovrascriveva la precedente;
    - una pagina vuota restituiva `[]`, perdendo le trace già lette.
  - **Quando si vede:** se il nodo restituisce `blockNumber` esadecimale e l'ultima trace è prima di `toBlock`, la stessa richiesta si ripete all'infinito.
  - **Dopo:** paginazione da `currentFromBlock`, pagine accumulate, uscita alla prima pagina vuota. Con `blockNumber` decimale, il formato documentato da Infura (numero) e da Alchemy (stringa decimale), il ciclo termina comunque dopo la prima pagina (vedi CHANGELOG, punti dubbi): in quel caso l'output non cambia.
- **Equivalenza:** modificato per fix FIX-08.
- **Dipendenze:** M-12.
- **Rischio:** medio. In `compare.js`: caso `FIX-08`.
- **Chiamanti coinvolti:**
  - `services/ExtractionModule/mainWithOption.js:100` → `buildTransactionHierarchy(`

**Ancoraggio (pre-fix, blocco 1):**
```js
            page = await fetchTracePage(networkData, contractAddressesFrom, contractAddressesTo, fromBlock, toBlock); // FIX-08 non applicato (MIGRAZIONE.md M-22)
```

**Sostituzione (blocco 1):**
```js
            // FIX-08: la richiesta usava sempre fromBlock invece di currentFromBlock
            // (stessa pagina all'infinito se l'ultima trace era prima di toBlock).
            page = await fetchTracePage(networkData, contractAddressesFrom, contractAddressesTo, currentFromBlock, toBlock);
```

**Ancoraggio (pre-fix, blocco 2):**
```js
            console.log(`[Erigon API] Nessuna traccia disponibile (o blocco in fase di indicizzazione) per i blocchi ${fromBlock}-${toBlock}`);
            return []; // FIX-08 non applicato (MIGRAZIONE.md M-22)
```

**Sostituzione (blocco 2):**
```js
            // FIX-08: una pagina vuota termina la paginazione senza scartare le trace
            // già lette (prima: log e "return []" a ogni pagina vuota).
            if (traces.length === 0) {
                console.log(`[Erigon API] Nessuna traccia disponibile (o blocco in fase di indicizzazione) per i blocchi ${fromBlock}-${toBlock}`);
            }
            break;
```

**Ancoraggio (pre-fix, blocco 3):**
```js
        traces.length = 0; // FIX-08 non applicato (MIGRAZIONE.md M-22)
```

**Sostituzione (blocco 3):**
```js
        // FIX-08: le pagine vengono accumulate (prima ogni pagina sovrascriveva la precedente).
```

### M-23 — FIX-09: funzione `ToNumber` inesistente

- **File originale e righe:** `services/decodeInternalTransaction.js` righe 145–147.
- **Riga originale del difetto:** `services/decodeInternalTransaction.js:146` → `element.gas = ToNumber(element.gas);`
- **File da modificare:** `services/decodeInternalTransaction.js` (`decodeInputs`).
- **Cosa cambia:**
  - **Prima:** se `element.gas` non è numerico, per esempio `undefined`, si ha `ReferenceError: ToNumber is not defined` e si perdono le transazioni interne della transazione. Nel workspace `ToNumber` non è definita da nessuna parte.
  - **Dopo:** stessa conversione già usata per `gasUsed` alla riga 149, con il controllo `element.gas &&`.
- **Equivalenza:** modificato per fix FIX-09.
- **Dipendenze:** M-10.
- **Rischio:** basso. Con il worker attuale `gas` è sempre numerico, quindi il caso è raro. In `compare.js`: caso `FIX-09`.
- **Chiamanti coinvolti:**
  - `services/ExtractionModule/workerWithOption.js:11` → `require('../decodeInternalTransaction')`
  - `services/ExtractionModule/simulationOrchestrator.js:11` → `require("../decodeInternalTransaction")`

**Ancoraggio (pre-fix, blocco 1):**
```js
    if (isNaN(Number(element.gas))) { // FIX-09 non applicato (MIGRAZIONE.md M-23)
        element.gas = ToNumber(element.gas);
    }
```

**Sostituzione (blocco 1):**
```js
    // FIX-09: la funzione "ToNumber" non esiste (ReferenceError quando gas non è
    // numerico, es. undefined). Si usa la stessa conversione già applicata a gasUsed.
    if (element.gas && isNaN(Number(element.gas))) {
        element.gas = web3.utils.hexToNumber(element.gas);
    }
```

### M-24 — FIX-11: metriche perse in `handleAbiFetchErigon`

- **File originale e righe:** `services/decodeInternalTransaction.js` riga 456.
- **Riga originale del difetto:** `services/decodeInternalTransaction.js:456` → `await handleUnverifiedContract(element, web3);`
- **File da modificare:** `services/decodeInternalTransaction.js` (`decodeProxyCall`).
- **Cosa cambia:** passa `metrics` come in tutte le altre chiamate. Cambia solo la metrica `time_4byteLookupInternal`, salvata con `saveExtractionMetrics`.
- **Equivalenza:** modificato per fix FIX-11.
- **Dipendenze:** M-10.
- **Rischio:** basso, cambiano solo le metriche. In `compare.js`: caso `FIX-11`.
- **Chiamanti coinvolti:** come M-23.

**Ancoraggio (pre-fix, blocco 1):**
```js
        await handleUnverifiedContract(element, web3, variant === ERIGON_FETCH_VARIANT ? undefined : metrics); // FIX-11 non applicato (MIGRAZIONE.md M-24)
```

**Sostituzione (blocco 1):**
```js
        // FIX-11: la variante Erigon non passava "metrics", perdendo le metriche di 4byte.
        await handleUnverifiedContract(element, web3, metrics);
```

### M-25 — FIX-12: `contractTree.compilerVersion` senza controllo

- **File originale e righe:** `services/ExtractionModule/workerWithOption.js` riga 369.
- **Riga originale del difetto:** `services/ExtractionModule/workerWithOption.js:369` → `compilerVersion: contractTree.compilerVersion || "unknown",`
- **File da modificare:** `services/ExtractionModule/workerWithOption.js` (`addTraceData`).
- **Cosa cambia:** le righe intorno gestiscono `contractTree` nullo con `?.` e `if (contractTree)`, questa no. Con `contractTree` nullo il worker terminava con errore. Con il `mainWithOption` attuale `contractTree` non è mai nullo, quindi il difetto è latente.
- **Equivalenza:** modificato per fix FIX-12.
- **Dipendenze:** M-13.
- **Rischio:** basso. In `compare.js`: caso `FIX-12`.
- **Chiamanti coinvolti:**
  - `services/ExtractionModule/mainWithOption.js:505` → `path.join(__dirname, 'workerWithOption.js')`

**Ancoraggio (pre-fix, blocco 1):**
```js
        compilerVersion: contractTree.compilerVersion || "unknown", // FIX-12 non applicato (MIGRAZIONE.md M-25)
```

**Sostituzione (blocco 1):**
```js
        // FIX-12: contractTree può essere null (è controllato con "?." nelle righe sopra
        // e con "if (contractTree)" sotto): l'accesso diretto lanciava TypeError.
        compilerVersion: contractTree?.compilerVersion || "unknown",
```

### M-26 — FIX-13: valori delle variabili impacchettate sovrascritti (nuovo, trovato in fase 2)

- **File originale e righe:** `services/optimizedDecodeValues.js` righe 120–127.
- **Riga originale del difetto:** `services/optimizedDecodeValues.js:125` → `e.value = functionStorage[e.contentSlot];`
- **File da modificare:** `services/optimizedDecodeValues.js` (`decodingSimpleStorage`).
- **Cosa cambia:**
  - **Prima:** per gli slot con più variabili, `newReadVarFormOffset` calcola il valore di ciascuna, che subito dopo veniva sovrascritto con lo slot intero. Gli effetti:
    - un `uint128` impacchettato era letto come numero a 256 bit;
    - un `bool` dopo un `address` dava un errore di decodifica e veniva scartato;
    - solo la variabile a offset 0 di tipo `address` era corretta.
  - **Dopo:** per gli slot impacchettati resta il valore calcolato.
- **Equivalenza:** modificato per fix FIX-13.
- **Dipendenze:** M-11, **M-20** (senza FIX-06 l'ultima variabile con offset ≥ 16 risulterebbe 0/false).
- **Rischio:** **medio-alto**: cambiano i valori di tutte le variabili impacchettate in `storageState`, già salvate in DB con i valori vecchi. **Non era nella lista approvata in fase 1**: applicalo solo se lo approvi. In `compare.js`: casi `FIX-13`.
- **Chiamanti coinvolti:** come M-16.

**Ancoraggio (pre-fix, blocco 1):**
```js
            variable.value = functionStorage[variable.contentSlot]; // FIX-13 non applicato (MIGRAZIONE.md M-26)
```

**Sostituzione (blocco 1):**
```js
            // FIX-13: per gli slot con più variabili impacchettate newReadVarFormOffset
            // calcola il valore di ciascuna, che veniva poi sovrascritto con lo slot intero
            // (valori errati o scartati per tutte le variabili tranne quella a offset 0).
            if (!isPackedSlot) {
                variable.value = functionStorage[variable.contentSlot];
            }
```

### M-27 — FIX-14: `readBytesArray` non definita (nuovo, trovato in fase 2)

- **File originale e righe:** `services/optimizedDecodeValues.js` riga 373.
- **Riga originale del difetto:** `services/optimizedDecodeValues.js:373` → `return readBytesArray(variable,shaTraces,functionStorage,shatracesProcessed);`
- **File da modificare:** `services/optimizedDecodeValues.js`.
- **Cosa cambia:**
  - **Prima:** `readArray` chiamava `readBytesArray`, che non esiste in nessun file del workspace (verificato con grep). Un array statico di bytes letto da dati complessi, per esempio `mapping(uint => bytes32[2])`, causava `ReferenceError` e la perdita della decodifica dell'intera transazione.
  - **Dopo:** la funzione è definita come lo stub esistente `readUintArray` (valore `undefined`, escluso dall'output). Le altre variabili vengono decodificate.
- **Equivalenza:** modificato per fix FIX-14.
- **Dipendenze:** M-11.
- **Rischio:** basso. **Non era nella lista approvata in fase 1.** In `compare.js`: caso `FIX-14`.
- **Chiamanti coinvolti:** come M-16.

**Ancoraggio (pre-fix, blocco 1):**
```js
// FIX-14 non applicato (MIGRAZIONE.md M-27): readBytesArray non è definita.
```

**Sostituzione (blocco 1):**
```js
/**
 * Array statici di bytes: non gestiti, come readUintArray.
 * FIX-14: la funzione era chiamata da readArray ma non era definita
 * (ReferenceError che faceva perdere la decodifica dell'intera transazione).
 */
function readBytesArray(variable) {
    variable.value = undefined;
    return variable;
}
```

### M-28 — FIX-15: confronto tra blocchi come stringhe (nuovo, trovato in fase 2)

- **File originale e righe:** `services/Erigon/erigonApi.js` riga 203.
- **Riga originale del difetto:** `services/Erigon/erigonApi.js:203` → `while(currentFromBlock <= toBlock){`
- **File da modificare:** `services/Erigon/erigonApi.js` (`fetchAllTraces`).
- **Cosa cambia:**
  - **Prima:** `fromBlock`/`toBlock` arrivano da `req.body`, come stringhe del form multipart in `/submitInternal` (`server.js:498`). `<=` tra stringhe è lessicografico: `"9000000" <= "10000000"` vale `false`, quindi `buildTransactionHierarchy` restituiva `[]` senza fare richieste. Succede quando i due blocchi hanno un numero di cifre diverso.
  - **Dopo:** confronto numerico.
- **Equivalenza:** modificato per fix FIX-15. È identico quando i due blocchi hanno lo stesso numero di cifre o sono numeri.
- **Dipendenze:** M-12.
- **Rischio:** basso. **Non era nella lista approvata in fase 1.** In `compare.js`: caso `FIX-15`.
- **Chiamanti coinvolti:**
  - `services/ExtractionModule/mainWithOption.js:100` → `buildTransactionHierarchy(`

**Ancoraggio (pre-fix, blocco 1):**
```js
    while (currentFromBlock <= toBlock) { // FIX-15 non applicato (MIGRAZIONE.md M-28)
```

**Sostituzione (blocco 1):**
```js
    // FIX-15: fromBlock/toBlock arrivano dal form come stringhe: il confronto
    // "<=" era lessicografico ("9000000" <= "10000000" è false) e l'estrazione
    // restituiva [] senza alcuna richiesta.
    while (Number(currentFromBlock) <= Number(toBlock)) {
```

---

## Percorso 2 — scheda unica

### M-29 — Attivare `ReformatCode` solo per l'estrazione storica di `server.js`

- **File originale e righe:** `server.js` riga 23.
- **Cosa cambia:** `server.js` usa la catena di `ReformatCode/services/`. I `fork` usano `__dirname`, quindi partono anche il nuovo worker e il nuovo `solcWorker`. Compliance e simulazione restano sul codice originale.
- **Equivalenza:** identico più tutti i fix presenti in `ReformatCode`. Per escluderne alcuni, applica i loro pre-fix direttamente nei file di `ReformatCode/services/`.
- **Dipendenze:** nessuna. **Esclude** le schede M-01…M-28.
- **Rischio:** medio: tutta la catena cambia insieme. Verifica `/submit`, `/submitInternal` e `/api/test-extraction` per ogni extractionType.
- **Chiamanti:**
  - `server.js:23` → `require("./services/ExtractionModule/mainWithOption")` (chiamate attive a `:576`, `:615` e `:1651`)
- **Rollback:** ripristina la riga originale.

**Ancoraggio (originale, righe 23–23):**
```js
const { getAllTransactions }=require("./services/ExtractionModule/mainWithOption")
```

**Sostituzione:**
```js
const { getAllTransactions }=require("./ReformatCode/services/ExtractionModule/mainWithOption")
```

---

## Verifica di questo manuale

Ogni ancoraggio è stato controllato automaticamente sul commit indicato:

- righe e testo degli ancoraggi originali (`git show HEAD:<file>`);
- riferimenti `file:riga` dei chiamanti e delle righe dei difetti;
- presenza unica di ogni blocco **Sostituzione** nel file di `ReformatCode`;
- righe degli adattamenti dei percorsi.

Inoltre:

- applicando a una copia di `ReformatCode/services/` tutti i blocchi pre-fix, `compare.js` con `COMPARE_FIXES=""` dà **110 casi identici all'originale più FIX-10**, che non ha pre-fix perché fa parte di M-12; 0 falliti;
- applicando un fix alla volta (FIX-13 insieme a FIX-06), cambiano solo i casi di quel fix; sempre 0 falliti;
- simulando l'intero percorso 1 su una copia del progetto (copia dei file, adattamento dei percorsi, pre-fix):
  - tutti i `require` relativi risolvono a file esistenti fuori da `ReformatCode/`;
  - il confronto dà 110 identici più FIX-10;
  - applicando poi in avanti tutti i fix, i file ottenuti coincidono con quelli di `ReformatCode` (a parte gli adattamenti dei percorsi), con 93 identici, 18 FIX e 0 falliti.

## Checklist

Percorso 1:

- [ ] M-01 — `services/shared/hexUtils.js`
- [ ] M-02 — `services/shared/etherscan.js`
- [ ] M-03 — `services/shared/jsonRpc.js`
- [ ] M-04 — `services/shared/contractTreeHelpers.js`
- [ ] M-05 — `services/ExtractionModule/traceStorageParser.js`
- [ ] M-06 — `services/solcVersionManager.js`
- [ ] M-07 — `services/contractUtils/solcWorker.js`
- [ ] M-08 — `services/contractUtils/utils.js`
- [ ] M-09 — `services/decodingUtils/utils.js`
- [ ] M-10 — `services/decodeInternalTransaction.js`
- [ ] M-11 — `services/optimizedDecodeValues.js`
- [ ] M-12 — `services/Erigon/erigonApi.js` (include FIX-10)
- [ ] M-13 — `services/ExtractionModule/workerWithOption.js`
- [ ] M-14 — `services/ExtractionModule/mainWithOption.js`
- [ ] M-15 — FIX-01 `createShatrace`
- [ ] M-16 — FIX-02 padding delle chiavi
- [ ] M-17 — FIX-03 `indexSum`
- [ ] M-18 — FIX-04 `readComplexData` undefined
- [ ] M-19 — FIX-05 enum
- [ ] M-20 — FIX-06 slice dell'ultima variabile impacchettata
- [ ] M-21 — FIX-07 `assignStorageToTheInternal`
- [ ] M-22 — FIX-08 paginazione `trace_filter`
- [ ] M-23 — FIX-09 `ToNumber`
- [ ] M-24 — FIX-11 metriche
- [ ] M-25 — FIX-12 `compilerVersion`
- [ ] M-26 — FIX-13 variabili impacchettate (nuovo: richiede approvazione)
- [ ] M-27 — FIX-14 `readBytesArray` (nuovo: richiede approvazione)
- [ ] M-28 — FIX-15 confronto dei blocchi (nuovo: richiede approvazione)

Percorso 2:

- [ ] M-29 — `server.js` riga 23 punta a `ReformatCode/`
