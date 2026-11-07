# Analisi dei punti tecnici 3-11 (Reviewer 1)

Analisi basata sul codice del repository al commit `755c0c7` (branch `main`). Nessun file di codice è stato modificato.

## Premesse valide per tutti i punti

- **Percorso analizzato.** La pipeline che produce gerarchia e storage per singola chiamata è quella di `extractionType = "3"` in `server.js:565` e `server.js:605`, cioè `option = { internalTransaction: 1, storageInternalTransactio: 1 }`. La chiave `storageInternalTransactio` è scritta così, senza la "n" finale, sia nel server sia in `services/ExtractionModule/workerWithOption.js:1100`, quindi funziona. In questo percorso:
  - lo storage viene da `getTraceStorageFromErigon` (`workerWithOption.js:872-1134`), che legge lo stream `structLogs` di `debug_traceTransaction`;
  - la gerarchia delle chiamate viene dal `callTracer` del nodo, tramite `newDecodedInternalTransaction` (`services/decodeInternalTransaction.js:638-658`);
  - le due cose vengono unite da `assignStorageToTheInternal` (`workerWithOption.js:1485-1494`).
  
  Gli altri tipi di estrazione sono citati solo dove contano.
- **Codice non usato.** `getTraceStorage` (`workerWithOption.js:666-848`, replay Hardhat a sola profondità 1) e `debugTransaction` (`workerWithOption.js:125-144`) non vengono mai chiamati. Il replay passa sempre dal nodo con `debugTransactionErigonStreaming` (`workerWithOption.js:277` e `:322`). Se l'articolo descrive un replay Hardhat, il testo va allineato al codice.
- **Dipendenza dal runtime.** La richiesta `debug_traceTransaction` passa solo l'hash, senza configurazione del tracer (`workerWithOption.js:150`, `params: [transactionHash]`). Tre comportamenti dipendono quindi dai default del client e non si deducono dal codice:
  - se il campo `memory` è presente (su geth è disattivato di default, su Erigon è attivo);
  - in quali step compare `storage`;
  - se la mappa `storage` è cumulativa per indirizzo.
  
  Ogni volta che una conclusione dipende da questo, lo segnalo esplicitamente.

---

## Punto 3: Duplicati nella discovery e attribuzione dello storage per profondità

- **Critica del revisore:** una transazione genera più trace. Il revisore chiede come la discovery eviti i duplicati, e fa notare che recuperare le chiamate per profondità è ambiguo quando un frame contiene più chiamate sorelle alla stessa profondità.
- **Stato:** Bug probabile. La deduplicazione è gestita; l'attribuzione alle chiamate sorelle contiene un errore.
- **Dove nel codice:**
  - discovery: `services/Erigon/erigonApi.js:200-302` (`buildTransactionHierarchy`), deduplicazione a `erigonApi.js:257`;
  - controllo dei duplicati prima del replay: `services/ExtractionModule/mainWithOption.js:443-455` (`getStorageData`); vincolo nel DB a `schema/data.js:54` (`transactionHash: unique`);
  - indice per profondità: `workerWithOption.js:881-907` (`depthToIndexMap`, `getOrCreateIndexForDepth`), chiusura a `workerWithOption.js:957-963`, pre-creazione a `workerWithOption.js:1013`;
  - assegnazione ai nodi del call tree: `workerWithOption.js:1485-1494` (`assignStorageToTheInternal`).
- **Come viene gestito:**
  - **Duplicati.** `trace_filter` restituisce una trace per ogni frame. `buildTransactionHierarchy` le raccoglie in una `Map` indicizzata per `transactionHash` e inserisce solo se la chiave non c'è già (`erigonApi.js:257`). Ogni transazione pubblica compare quindi una sola volta. Ci sono altre due difese:
    - `getStorageData` interroga il DB per hash e contratto e salta le transazioni già estratte (`mainWithOption.js:445-455`);
    - lo schema impone `transactionHash` unico per collezione (`schema/data.js:54`).
    
    L'efficacia del vincolo dipende dalla creazione dell'indice da parte di mongoose al runtime.
  - **Profondità.** Lo storage non si cerca per profondità "nuda". `depthToIndexMap` associa a ogni profondità l'indice del frame attivo; quando un frame termina con `STOP`/`RETURN` la voce viene cancellata (`:962`). Una sorella successiva alla stessa profondità riceve quindi un nuovo indice (`:897-906`). I bucket `mapForStorage[k]` sono numerati in pre-ordine DFS dei frame.
  - **Gerarchia.** Viene dal `callTracer`, con `callId` gerarchici unici (`decodeInternalTransaction.js:550`, per esempio `0_1`, `0_2`, `0_1_1`), non dalla profondità.
- **Cosa manca:**
  1. **Assegnazione bucket → nodo errata.** `assignStorageToTheInternal` passa `index` per valore nella ricorsione (`workerWithOption.js:1489-1491`): al ritorno da un sottoalbero, il chiamante non avanza l'indice del numero di discendenti visitati. Prendiamo l'albero `[A{calls:[A1]}, B]`, con bucket in pre-ordine A=2, A1=3, B=4. Il codice assegna A←2, A1←3, B←**3**. B riceve lo storage di A1 e il bucket 4 non viene mai usato. Questo vale per ogni transazione in cui una chiamata con figli è seguita da una sorella. È un errore deterministico, che si vede dalla sola lettura del codice.
  2. **Bucket "sporchi".** I bucket restano sporchi quando un frame non termina con `STOP`/`RETURN` (vedi punto 4). In quel caso la sorella successiva riusa lo stesso bucket.
  3. **Paginazione rotta in `buildTransactionHierarchy`:**
     - la richiesta usa sempre `fromBlock` invece di `currentFromBlock` (`erigonApi.js:210-211`);
     - `after`/`count` stanno al livello superiore del payload JSON-RPC e non dentro l'oggetto filtro (`:216-217`), quindi il nodo li ignora;
     - `traces` viene sovrascritto a ogni giro invece di essere concatenato (`:224`).
     
     Se l'ultima trace restituita ha blocco minore di `toBlock` (`:235-241`), la richiesta successiva è identica alla precedente e il ciclo non termina. Se invece termina, conta solo l'ultima risposta. Va verificato con un'esecuzione su un intervallo il cui ultimo blocco non contiene transazioni rilevanti.
  4. **Chiamate RPC ridondanti.** `getEventFromErigon` e `getBlockFromErigon` vengono chiamate per ogni trace, prima del controllo dei duplicati (`erigonApi.js:250-251`). Non è un problema di correttezza, ma pesa sui tempi.
  5. **Semantica del filtro.** Non si deduce dal codice se `fromAddress` e `toAddress` siano combinati in unione o in intersezione: dipende dal client (Erigon ha un parametro `mode`, che il codice non passa).
  6. **Percorso legacy.** Il percorso legacy basato su Etherscan `txlist` (`mainWithOption.js:327-357`) riparte da `lastBlock + 1` (`:350`). Se una pagina viene troncata al limite di Etherscan a metà di un blocco, le transazioni restanti di quel blocco si perdono. Questo riguarda la completezza, non i duplicati.
  7. **Percorso struct-log (`internalTransaction = 0`).** `callId` dipende solo dalla profondità (`workerWithOption.js:1244-1250`): chiamate sorelle ottengono lo stesso ID e la lista è piatta. Qui l'ambiguità segnalata dal revisore è reale.
- **Stima di lavoro per completarlo:** 10-16 h. Correggere la paginazione richiede 1-2 h. Correggere l'assegnazione richiede 2-3 h se si restituisce l'indice dalla ricorsione, oppure 6-8 h per uno stack di frame con ID espliciti allineati al `callTracer`. Servono poi 2-3 h di test su transazioni note e 1-2 h di testo. Tipo di intervento: codice, testo e una piccola verifica sperimentale. Se il dataset pubblico è stato generato con questo percorso, va rigenerato o almeno ricontrollato.
- **Confidenza:** alta per l'errore di `assignStorageToTheInternal` e per la paginazione, perché si vedono dalla sola lettura del codice. Media per gli effetti reali della paginazione, che dipendono dalla risposta del nodo.

---

## Punto 4: Chiusura dei frame (REVERT, INVALID, OOG, SELFDESTRUCT, precompile, EOA, creazioni)

- **Critica del revisore:** l'algoritmo chiude i frame solo su STOP e RETURN. Il revisore chiede come vengono gestiti REVERT, INVALID, out-of-gas, SELFDESTRUCT, chiamate a precompile o a EOA e creazioni di contratti, che possono disallineare lo stack delle chiamate attive.
- **Stato:** Non gestito per l'attribuzione dello storage. La gerarchia invece è robusta, perché viene dal `callTracer`.
- **Dove nel codice:**
  - chiusura: `workerWithOption.js:957-963` (solo `STOP`/`RETURN`); nel percorso struct-log solo `STOP` (`workerWithOption.js:1196`);
  - pre-creazione del bucket del figlio su CALL: `workerWithOption.js:1013`;
  - opcode di chiamata riconosciuti: `workerWithOption.js:996` (`CALL`/`DELEGATECALL`/`STATICCALL`; mancano `CALLCODE`, `CREATE`, `CREATE2`);
  - gerarchia: `decodeInternalTransaction.js:606-629` (`callTracer`) e `:540-598`;
  - schema: `schema/data.js:22-50` (`internalTxSchema`) e `:73` (`status`).
  
  Una ricerca nel codice di estrazione di `REVERT|INVALID|SELFDESTRUCT|CREATE|precompile` non trova nulla. L'unica occorrenza è un commento in `simulationOrchestrator.js:301`.
- **Come viene gestito:**
  - **Gerarchia.** Viene costruita dal `callTracer` del client (`decodeInternalTransaction.js:613`), che delimita i frame da sé. Include i frame falliti (campo `error`), le chiamate a EOA e precompile, `CREATE`/`CREATE2` e `SELFDESTRUCT`. L'oggetto viene mutato sul posto (`:544-595`), quindi nel log in memoria i campi del tracer restano.
  - **Creazione come transazione pubblica.** Se `to` è nullo, si recupera `contractAddress` dalla ricevuta (`erigonApi.js:253-256`).
  - **Chiamate a EOA.** Etherscan restituisce "not verified", quindi si passa a `handleUnverifiedContract` e, con input `0x`, l'attività diventa `transfer` (`decodeInternalTransaction.js:22-42`).
- **Cosa manca:**
  1. **Disallineamento dei bucket di storage.** L'algoritmo non chiude il frame quando la profondità scende, ma solo su `STOP`/`RETURN`. Nei casi seguenti la voce di `depthToIndexMap` resta attiva e la chiamata sorella successiva riusa il bucket del frame precedente:
     - `REVERT`, `INVALID`, out-of-gas (nessun opcode finale) e `SELFDESTRUCT`;
     - chiamate a EOA e precompile. Il bucket viene pre-creato a `:1013`, ma nessuno step viene eseguito a quella profondità.
     
     Il `callTracer` conta invece questi nodi singolarmente. Combinato con l'errore del punto 3, ogni nodo successivo riceve lo storage sbagliato.
  2. **Stato dei frame falliti.** Lo schema `internalTxSchema` non ha i campi `error` e `revertReason`. Con lo strict mode di mongoose questi campi si perdono nei nodi di primo livello salvati nel DB; si conservano solo nei `calls` annidati, di tipo `Mixed`.
  3. **Stato della transazione pubblica.** Il log non imposta mai `status` (`workerWithOption.js:251-266`), quindi vale sempre il default `"Success"` (`schema/data.js:73`), anche per transazioni fallite.
  4. **Precompile.** Per le precompile si interroga Etherscan con un'attesa fissa di 5 s per indirizzo sconosciuto (`decodeInternalTransaction.js:386`). Poi il selettore spurio viene cercato su 4byte (`:69-71`), con il rischio di nomi di attività inventati. L'effetto dipende dal runtime.
  5. **CREATE fallita.** Se il client omette `to` per una CREATE fallita, `element.to.toLowerCase()` (`decodeInternalTransaction.js:547-548`) solleva un'eccezione. Questa fa fallire tutta la decodifica interna della transazione, che viene catturata a `workerWithOption.js:314-316`, e il log esce senza `internalTxs` né storage. Dipende dal formato di output del client.
  6. **Percorso struct-log (`extractionType = "1"`).** `CREATE`/`CREATE2` non entrano in `internalCalls`, quindi le creazioni interne mancano.
- **Stima di lavoro per completarlo:** 20-28 h.
  - 8-12 h per chiudere i frame sul calo di profondità invece che sull'opcode, trattare come frame vuoti le chiamate seguite da uno step alla stessa profondità (EOA e precompile) e allineare i bucket ai nodi del `callTracer` in pre-ordine;
  - 2-3 h per propagare `error` e lo stato della ricevuta nello schema;
  - 1-2 h per saltare Etherscan e 4byte per precompile e indirizzi senza codice (`eth_getCode`);
  - 6-8 h per contratti sintetici su nodo locale (revert, OOG, selfdestruct, create, precompile) usati come test;
  - 2 h di testo.
  
  Tipo di intervento: codice, nuovi esperimenti e testo.
- **Confidenza:** alta sul fatto che la chiusura non gestisce questi casi, perché è visibile nel codice. Media su alcuni effetti a valle (precompile e CREATE fallita), che dipendono da Etherscan, da 4byte e dal formato del `callTracer`.

---

## Punto 5: DELEGATECALL e indirizzo a cui viene attribuito lo storage

- **Critica del revisore:** nei frame DELEGATECALL, SSTORE modifica lo storage del chiamante. Il revisore chiede a quale indirizzo vengono attribuite le voci di storage, anche nelle delegate call verso librerie.
- **Stato:** Gestito solo in parte.
- **Dove nel codice:**
  - bucket per profondità: `workerWithOption.js:942-1031`;
  - assegnazione: `workerWithOption.js:1485-1494`;
  - decodifica dello storage interno: `workerWithOption.js:1496-1527` (`decodeInteralTxsStorage`), con il layout di `txs.to` a `:1499-1503` e `:1510-1512`;
  - schema senza indirizzo dello storage: `schema/data.js:9-14`.
- **Come viene gestito:**
  - **Attribuzione.** Lo storage di un frame DELEGATECALL finisce nel bucket di quel frame e viene attaccato al nodo DELEGATECALL del call tree, che ha `from` = chiamante e `to` = implementazione o libreria.
  - **Decodifica.** Usa il layout del contratto `to` (`:1499-1512`). Per il pattern proxy → implementazione è il comportamento corretto, perché il layout dell'implementazione è per costruzione quello applicato allo storage del proxy.
  - **Contenuto di `trace.storage`.** Gli slot catturati sono quelli del contesto di esecuzione, cioè dell'indirizzo del chiamante. Lo stabilisce il client (geth/Erigon usano l'indirizzo del contesto), non il codice dell'estrattore.
- **Cosa manca:**
  1. **Indirizzo non esplicito.** Il log non dice mai a quale indirizzo appartiene lo storage. `storageStateSchema` ha solo `variableName`, `type`, `variableValue` e `variableRawValue` (`schema/data.js:9-14`). Chi legge un nodo DELEGATECALL può pensare che lo storage sia di `to`, mentre è di `from`.
  2. **Librerie.** Una libreria non ha variabili di stato, quindi `storageLayoutFlag` risulta falso oppure non ci sono variabili a cui associare gli slot. Le scritture fatte da una libreria tramite puntatori `storage` restano non decodificate. Non si ricorre al layout del chiamante (il primo antenato che non è una delegate call).
  3. **CALLCODE.** Non viene riconosciuto nel percorso principale (`workerWithOption.js:996`).
  4. **Possibile doppione (dipende dal runtime).** Se il client riporta `storage` cumulativo per indirizzo anche negli step `SLOAD`/`RETURN` successivi del chiamante, gli stessi slot compaiono anche nel bucket del chiamante.
- **Stima di lavoro per completarlo:** 8-12 h.
  - 1-2 h per aggiungere un campo `storageAddress` (uguale a `from` per DELEGATECALL/CALLCODE, a `to` altrimenti) e aggiornare lo schema;
  - 4-6 h per decodificare le delegate call verso librerie con il layout del chiamante non-delegate;
  - 2-3 h di test (proxy EIP-1967 e libreria con struct in storage);
  - 1 h di testo.
  
  Tipo di intervento: codice e testo. Nella lettera di risposta si può già descrivere il comportamento attuale per i proxy.
- **Confidenza:** media. Il percorso nel codice è chiaro, ma quale indirizzo compaia in `trace.storage` è una scelta del client e va confermato su una transazione reale.

---

## Punto 6: Letture e scritture mescolate sotto "state changes"

- **Critica del revisore:** i log sembrano mescolare letture e scritture sotto il nome di "state changes".
- **Stato:** Non gestito. L'osservazione del revisore è corretta.
- **Dove nel codice:**
  - `workerWithOption.js:1026-1031`: `SLOAD` unisce `trace.storage` in `functionStorage`;
  - `workerWithOption.js:987-994`: `SSTORE` unisce `trace.storage` nello stesso oggetto;
  - `workerWithOption.js:1450` e `:1038`: `finalShaTraces` è un alias di `trackBuffer`, quindi restano tutte le KECCAK256, comprese quelle usate per letture;
  - `services/optimizedDecodeValues.js:24`: il parametro `sstore` non viene mai usato nel corpo della funzione;
  - `schema/data.js:9-14`: non c'è un campo che indichi il tipo di accesso.
- **Come viene gestito:** Non viene distinto. `functionStorage` raccoglie gli slot sia dagli step `SLOAD` sia dagli step `SSTORE`, e `optimizedDecodeValues` decodifica tutto il contenuto di `functionStorage` (`optimizedDecodeValues.js:108-130`). `sstoreBuffer`/`sstoreOptimization` vengono raccolti (`workerWithOption.js:988-989`) ma il decoder li ignora. Il filtro su `sstoreBuffer` in `createShatrace` non ha effetto, perché l'array di output è lo stesso array di input (`:1450`).
- **Cosa manca:** uno stato per slot e per frame che dica se lo slot è stato letto, scritto o entrambe le cose, insieme a un campo `accessType` nel log. Per le scritture servirebbe anche, idealmente, il valore precedente.
- **Stima di lavoro per completarlo:** 7-11 h.
  - 4-6 h per tracciare per bucket gli slot scritti (`stack[len-1]` di `SSTORE`), propagarli al decoder e aggiungere `accessType`;
  - 1-2 h di schema e test;
  - 1 h per rinominare "state changes" in "storage accesses" nel testo, oppure filtrare le sole scritture;
  - 1-2 h di verifica su un campione.
  
  Tipo di intervento: codice e testo. I log già pubblicati andrebbero rigenerati, o almeno il testo dovrebbe dichiarare che contengono anche letture.
- **Confidenza:** alta. Il codice unisce esplicitamente gli step SLOAD e SSTORE, e il parametro `sstore` non compare nel corpo della funzione.

---

## Punto 7: Scritture nei frame revertiti, valori intermedi o netti, transient storage

- **Critica del revisore:** il revisore chiede se le scritture nei frame revertiti vengono scartate, se il log riporta i valori intermedi o solo quelli netti, e come viene trattato il transient storage.
- **Stato:** Non gestito.
- **Dove nel codice:**
  - nessuna gestione di `REVERT` nel parser (`workerWithOption.js:942-1032`);
  - sovrascrittura per slot con `Object.assign` (`workerWithOption.js:991-994`);
  - `TSTORE`/`TLOAD` non compaiono in nessun file di `services/`;
  - `hardhat.config.js:72` imposta `hardfork: "cancun"`, ma il percorso Hardhat non viene usato (vedi Premesse).
- **Come viene gestito:**
  - **Netto o intermedio.** `functionStorage` è un oggetto indicizzato per slot e `Object.assign` sovrascrive. Per ogni bucket (frame) resta l'ultimo valore osservato in quel frame. In pratica il log riporta il **valore finale per frame**: non i valori intermedi, e nemmeno il netto della transazione. Lo stesso slot può comparire in più nodi con valori diversi. Il valore precedente (pre-state) non viene riportato. Che il valore registrato allo step `SSTORE` sia quello appena scritto dipende da come il client compila `storage`.
  - **Frame revertiti.** Le scritture non vengono scartate: non c'è alcun controllo sull'esito del frame. Anche per la transazione pubblica `status` resta `"Success"` (vedi punto 4). Se la mappa `storage` del tracer venga riportata indietro dopo un revert è un comportamento del client, non dell'estrattore.
  - **Transient storage.** Viene ignorato: `TSTORE`/`TLOAD` non sono gestiti, quindi non compaiono nel log. Il risultato è coerente (non è stato persistente), ma l'articolo non lo dichiara.
- **Cosa manca:**
  - scartare o marcare come `reverted` le voci dei frame con `error` (dal `callTracer`) e di tutti i loro discendenti;
  - definire e documentare la semantica scelta (finale per frame, oppure netto per transazione con valore prima e dopo);
  - dichiarare il trattamento del transient storage, o in alternativa tracciarlo.
- **Stima di lavoro per completarlo:** 10-16 h.
  - 4-6 h per la marcatura o lo scarto dei frame revertiti, che dipende dall'allineamento dei frame del punto 4;
  - 3-4 h per aggiungere il valore precedente (`prestateTracer` in diff mode, utile anche come ground truth per la validazione chiesta dal revisore);
  - 0,5 h per documentare il transient storage, oppure 3-4 h per tracciare `TSTORE`;
  - 2 h di testo.
  
  Tipo di intervento: codice, testo e nuovi esperimenti (test con revert annidati).
- **Confidenza:** alta sull'assenza di gestione di revert e transient storage. Media sulla semantica "finale per frame", perché dipende da come il client compila `storage` negli step.

---

## Punto 8: Chiavi dei mapping e strutture supportate

- **Critica del revisore:** recuperare le chiavi dei mapping richiede la preimmagine di KECCAK256 in memoria. Il revisore chiede quali strutture sono supportate: mapping annidati, struct, array dinamici, stringhe e bytes lunghi, slot impacchettati.
- **Stato:** Gestito solo in parte.
- **Dove nel codice:**
  - cattura della preimmagine: `workerWithOption.js:945-956`; associazione allo slot finale: `workerWithOption.js:964-985`;
  - euristiche sullo slot base: `optimizedDecodeValues.js:81` (`< 300`), `:117` (`< 9999999`), `workerWithOption.js:1052-1064`;
  - decoder: `optimizedDecodeValues.js:205-220` (dispatch), `:221-234` (catena per i mapping annidati), `:277-312` (mapping), `:244-264` (struct), `:324-350` (stringhe), `:361-410` e `:465-555` (array), `:868-907` (slot impacchettati);
  - formato dell'output: `optimizedDecodeValues.js:46-55`.
- **Come viene gestito:**
  - **Preimmagine.** Su `KECCAK256` si legge la parola di memoria all'offset `stack[top]/32` (chiave) e la successiva (slot). Allo step successivo si aggiunge lo slot risultante (`finalKey`). Viene riconosciuto anche il caso `ADD` per gli indici degli array (`:971-985`).
  - **Mapping semplici** con chiave di tipo valore a 32 byte: `readMapping` → `extractComplexKey`.
  - **Mapping annidati:** si risale la catena delle preimmagini confrontando `hexStorageIndex` con lo slot corrente (`:221-229`) e ricorrendo sul tipo valore (`:309-310`).
  - **Mapping verso struct, array e string:** `:288-304`.
  - **Struct** di primo livello e annidate: `:244-264`.
  - **Array dinamici** di `uint256`, `uintN`, `bytes32`/`bytesN`, `string` e struct: `:361-410`, `:465-555`.
  - **Stringhe lunghe:** ricostruite leggendo `keccak(slot) + i` (`:324-350`).
  - **Variabili impacchettate** di primo livello nello stesso slot: estratte per offset (`:868-907`).
- **Cosa manca:**
  1. **La chiave del mapping non compare nel log.** Serve solo a calcolare lo slot. L'output contiene `variableName` (nome del mapping), `variableRawValue` e `variableValue` (`optimizedDecodeValues.js:46-55`), e `contentSlot`/`hexKey` vengono scartati. Due aggiornamenti dello stesso mapping con chiavi diverse risultano indistinguibili per chiave.
  2. **Chiavi di tipo dinamico** (`string`, `bytes`): si leggono sempre due parole e si ignora la lunghezza della preimmagine (`stack[len-2]`, mai letta a `:945-956`), quindi questo caso non è supportato. Anche un offset non allineato a 32 byte non è gestito: produrrebbe un indice frazionario e `memory[...]` risulterebbe `undefined`.
  3. **Array statici:**
     - `readArrayComplexStatic` è uno stub che restituisce `undefined` (`:384-386`). Se viene raggiunto, `resultreadComplexData.length` (`:89`) solleva un `TypeError` che fa fallire la decodifica dello storage dell'intera transazione (vedi `workerWithOption.js:1117-1119` e `:314-316`). Bug probabile.
     - `readUintArray` restituisce sempre `undefined` (`:556-559`).
     - Nel percorso "semplice" viene decodificato solo il primo slot.
  4. **`bytes` lunghi:** `t_bytes_storage` viene trattato come primitivo, quindi non c'è ricostruzione su più slot.
  5. **Struct impacchettate:** l'offset dei membri viene ignorato (`:252-258`), quindi più membri nello stesso slot ricevono ciascuno l'intero slot.
  6. **Array dinamici impacchettati** (`uintN[]` con N < 256): si legge solo il primo slot (`:538-555`). Per le struct in array dinamico si assume che sia stato modificato l'ultimo elemento (`:427`).
  7. **Variabili con slot base ≥ 300** non vengono trattate come complesse (`:81`). Gli slot ≥ 9.999.999 non vengono decodificati come semplici (`:117`). Restano quindi fuori lo storage namespaced ERC-7201 e gli slot EIP-1967.
  8. **Dipendenza dal runtime.** Senza il campo `memory` nel trace (default di geth) nessuna chiave viene recuperata: il codice salta il ramo (`workerWithOption.js:951`) senza avvisare.
- **Stima di lavoro per completarlo:**
  - solo testo, con la tabella onesta delle strutture supportate e non supportate: 2-3 h;
  - correzioni minime (chiave nel log, stub degli array statici che non faccia fallire tutto, configurazione esplicita del tracer con memoria attiva): 6-9 h;
  - copertura completa (preimmagini a lunghezza variabile, struct e array impacchettati, `bytes` lunghi, rimozione delle soglie 300/9.999.999 usando il layout): 20-30 h in più;
  - suite di contratti sintetici, una per struttura, utile anche per la validazione chiesta dal revisore: 8-12 h.
  
  Tipo di intervento: testo, più codice e nuovi esperimenti se si vuole ampliare la copertura.
- **Confidenza:** alta per l'assenza della chiave nell'output, per lo stub e per le soglie, visibili nel codice. Media sulla correttezza effettiva dei casi "supportati", che non ho eseguito: va verificata con i contratti sintetici.

---

## Punto 9: Affermazione che l'AST elenca le variabili modificate da ogni funzione

- **Critica del revisore:** l'affermazione che l'AST elenchi direttamente le variabili di stato modificate da ciascuna funzione va corretta o spiegata.
- **Stato:** Non gestito. Il codice non fa quello che dice l'affermazione.
- **Dove nel codice:**
  - `services/contractUtils/utils.js:275-307` (`getFunctionContractTree`): dall'AST legge solo `ContractDefinition`, i nomi delle funzioni implementate e `linearizedBaseContracts`;
  - `utils.js:217-268` (`getContractVariableTree`): le variabili vengono dallo **storageLayout** di solc, non dall'AST;
  - `utils.js:340-354`: unisce le due strutture per nome del contratto;
  - `optimizedDecodeValues.js:760-801` (`getContractVariable`): riceve `functionName` ma non lo usa.
  
  Il campo `.functions` non viene letto da nessuna parte fuori da `contractUtils/utils.js` (verificato con grep).
- **Come viene gestito:** l'AST serve solo a costruire un elenco di nomi di funzione per contratto, con ereditarietà. Le variabili e i loro slot vengono dallo storage layout. Quali variabili siano state modificate si ricava dal trace (gli slot toccati), non da un'analisi statica dell'AST.
- **Cosa manca:** nel testo, correggere l'affermazione: l'AST fornisce la struttura dei contratti, lo storage layout fornisce variabili e slot, il trace fornisce gli accessi effettivi. Se si volesse davvero un'analisi statica delle variabili scritte per funzione (visitando i nodi `Assignment` e le chiamate interne), sarebbe un lavoro nuovo e non necessario per l'estrazione.
- **Stima di lavoro per completarlo:** 1-2 h, solo testo. In alternativa 15-25 h di codice per un'analisi statica, che non consiglio.
- **Confidenza:** alta. Il codice è breve e il parametro inutilizzato e il campo mai letto sono verificabili con grep.

---

## Punto 10: Rilevamento dei proxy (EIP-1967, minimal proxy, diamond, upgrade nel tempo)

- **Critica del revisore:** il rilevamento si basa sui metadati dell'explorer e su un'euristica sulla chiamata successiva. Il revisore chiede di discuterne la copertura per proxy EIP-1967, minimal proxy, diamond e aggiornamenti dell'implementazione nel tempo.
- **Stato:** Gestito solo in parte.
- **Dove nel codice:**
  - indirizzo dell'implementazione fornito manualmente: `mainWithOption.js:104-106` (`implementationContractAddress`);
  - transazione pubblica, euristica sul DELEGATECALL dal `to`: `workerWithOption.js:373-418`;
  - chiamate interne con flag `Proxy` di Etherscan più primo figlio DELEGATECALL con stesso `from` e stesso input: `decodeInternalTransaction.js:407-445` (`handleAbiFetchErigon`);
  - riuso dell'implementazione salvata nel DB: `decodeInternalTransaction.js:335-351` (`handleAbiFromDbErigon`);
  - salvataggio solo in inserimento: `databaseStore.js:52-63` (`saveAbi`, che esce se il record esiste già, `:61-62`);
  - `databaseStore.js:91` (`saveCompiledContractData` scrive `proxyImplementation: ''`);
  - funzione `retriveImplementationContract` (`workerWithOption.js:849-869`), presente solo nel percorso non usato.
- **Come viene gestito:**
  - **Transazione pubblica.** Se il metodo non è stato decodificato, si cerca nel call tree un DELEGATECALL da `tx.to` verso un altro indirizzo e si usa l'ABI di quel target. L'indirizzo trovato viene salvato come `proxyImplementation` (`workerWithOption.js:375-415`). Questo passaggio non richiede metadati dell'explorer.
  - **Chiamate interne.** Si attiva solo se Etherscan segna il contratto come `Proxy === '1'` e il primo figlio è un DELEGATECALL con stesso `from` e stesso input (`decodeInternalTransaction.js:407-413`).
  - **Storage dei proxy.** Viene decodificato con il layout del target della delegate call, coerentemente con il punto 5.
- **Cosa manca:**
  1. **EIP-1967.** Lo slot non viene mai letto (nessuna `eth_getStorageAt` e nessuna costante `0x3608…`). Il riconoscimento dipende dal flag di Etherscan o dall'osservazione di un DELEGATECALL.
  2. **Minimal proxy EIP-1167.** Non c'è riconoscimento del bytecode. Per le chiamate interne dipende dal flag di Etherscan (comportamento del servizio, non deducibile dal codice). Per la transazione pubblica funziona grazie all'euristica sul DELEGATECALL.
  3. **Upgrade nel tempo.** Non gestiti:
     - `saveAbi` non aggiorna un record esistente (`databaseStore.js:61-62`), quindi la prima implementazione osservata viene riusata per tutte le transazioni successive tramite `handleAbiFromDbErigon` (`:335-351`), qualunque sia il blocco;
     - l'`implementationContractAddress` manuale è unico per tutto l'intervallo di blocchi (`mainWithOption.js:104-106`);
     - `saveCompiledContractData` può azzerare `proxyImplementation` (`databaseStore.js:91`), con effetti che dipendono dall'ordine delle chiamate.
  4. **Diamond EIP-2535.** Viene salvata una sola implementazione per indirizzo, quindi le chiamate a facet diverse vengono decodificate con l'ABI della facet salvata. Dove la decodifica fallisce si ricade su 4byte (`decodeInternalTransaction.js:346-348`).
  5. **Euristica sul primo figlio.** Richiede `input` identico e un DELEGATECALL come **primo** figlio (`:408-413`). I proxy che fanno prima altre chiamate (beacon proxy che chiamano `implementation()` sul beacon) non vengono riconosciuti.
- **Stima di lavoro per completarlo:** 20-32 h.
  - 4-6 h per leggere lo slot EIP-1967 al blocco della transazione;
  - 2-3 h per riconoscere il bytecode EIP-1167;
  - 3-4 h per preferire sempre il target DELEGATECALL osservato alla cache del DB, che risolve gran parte di upgrade e diamond;
  - 4-6 h per una cache dell'implementazione per intervallo di blocchi;
  - 6-10 h per un esperimento di copertura: classificare i proxy del dataset per tipo e contare le decodifiche riuscite e fallite (risponde anche alla richiesta di tassi di fallimento);
  - 2-3 h di testo.
  
  Tipo di intervento: codice, nuovi esperimenti e testo. Una versione di solo testo, che discuta i limiti, richiede 3-4 h.
- **Confidenza:** alta sull'assenza di EIP-1967, EIP-1167 e gestione degli upgrade (verificato con grep). Media sulla copertura effettiva tramite il flag di Etherscan, che dipende dal servizio.

---

## Punto 11: Versioni del compilatore, sorgenti multi-file, contratti non Solidity

- **Critica del revisore:** il revisore chiede di spiegare come vengono gestiti, durante la ricompilazione, le versioni del compilatore, i sorgenti multi-file e i contratti non scritti in Solidity.
- **Stato:** Gestito solo in parte.
- **Dove nel codice:**
  - recupero dei sorgenti: `services/contractUtils/utils.js:59-143` (`getContractCodeEtherscan`), con il parsing dello standard JSON e del formato multi-file a `:102-126`;
  - compilazione: `utils.js:152-210` (`getCompiledData`), compilazione in un processo figlio a `:16-51`;
  - `services/contractUtils/solcWorker.js:3-19` (`loadRemoteVersion`) e `:36-40` (timeout di 120 s);
  - `services/solcVersionManager.js:58-69` e `:71-101` (`detectVersion`);
  - percorso alternativo con `fallback` grezzo: `mainWithOption.js:190-205` e `:242-311`.
- **Come viene gestito:**
  - **Versione del compilatore.** Si usa la `CompilerVersion` esatta restituita da Etherscan (per esempio `v0.8.19+commit…`), passata a `solc.loadRemoteVersion` (`solcWorker.js:6`, `utils.js:184`). `detectVersion` viene chiamata (`utils.js:175`, `:180`) ma il suo risultato non viene usato.
  - **Multi-file.** Lo standard JSON di Etherscan (formato `{{…}}`) e il formato JSON multi-sorgente vengono letti e si passano a solc tutte le `sources` (`utils.js:102-119`). Un file unico, anche appiattito, viene compilato come `contract0` (`:120-126`). Il contratto principale viene scelto per `ContractName` (`optimizedDecodeValues.js:855-866`).
  - **Output e cache.** Si richiedono `storageLayout`, `ast` e `abi` (`utils.js:158-166`). Il risultato viene salvato nel DB (`saveCompiledContractData`) e riusato.
  - **Errori.** La compilazione avviene in un processo figlio, per isolare i crash di memoria. In caso di errore si ricade su un `contractTree` grezzo con la sola ABI di Etherscan: la decodifica degli input continua, quella dello storage no (`mainWithOption.js:298-311`).
- **Cosa manca:**
  1. **Settings dello standard JSON scartati.** Remappings, `evmVersion`, `viaIR`, librerie e ottimizzatore vengono persi: si prende solo `.sources` (`utils.js:104`, `:106`). Il layout dello storage non dipende dall'ottimizzatore, ma senza remappings gli import di progetti Foundry/Hardhat possono non risolversi.
  2. **Chiavi dei sorgenti alterate.** Le chiavi vengono modificate (`replace("node_modules/")`, `replace("lib/")`, `utils.js:110`) senza aggiornare i percorsi di import nei sorgenti. Questo può rompere la risoluzione degli import, a seconda del progetto.
  3. **Errori di compilazione non controllati.** Nessun controllo di `output.errors` (`utils.js:189-191`). Una compilazione fallita produce un `storageLayoutFlag` falso senza registrarne il motivo, e così non si possono riportare i tassi di fallimento chiesti dal revisore.
  4. **Solo Solidity.** `language: 'Solidity'` è fisso (`utils.js:155`) e non c'è alcun supporto per Vyper (grep). I contratti Vyper ottengono solo la decodifica degli input via ABI, senza storage.
  5. **Chiamate di rete inutili.** `detectVersion` scarica `list.json` per ogni file sorgente (`solcVersionManager.js:80`) e il risultato non viene usato. Costa in latenza e può far fallire la compilazione se `binaries.soliditylang.org` non risponde (`:50-52`).
- **Stima di lavoro per completarlo:** 9-13 h senza Vyper.
  - 3-5 h per passare i `settings` originali dello standard JSON, compresi remappings ed `evmVersion`, e conservare i percorsi originali;
  - 2-3 h per registrare `output.errors` e il motivo del fallback nelle metriche;
  - 0,5 h per rimuovere `detectVersion`;
  - 2 h per un esperimento sul tasso di compilazioni riuscite nel dataset;
  - 2 h di testo.
  
  Il supporto a Vyper (compilatore Vyper, `-f layout`) richiede altre 10-15 h; in alternativa basta dichiararlo come limite nel testo. Tipo di intervento: codice, testo e una piccola verifica sperimentale.
- **Confidenza:** alta. Il flusso di compilazione è lineare e le assenze (settings, errori, Vyper) sono verificabili. Media sull'impatto reale dei remappings mancanti, che dipende dai contratti del dataset.

---

## Tabella riassuntiva

| Punto | Tema | Stato | Ore stimate | Tipo di intervento |
|---|---|---|---|---|
| 3 | Duplicati nella discovery / storage per profondità | Bug probabile (deduplicazione gestita) | 10-16 | Codice + testo + piccola verifica |
| 4 | REVERT / INVALID / OOG / SELFDESTRUCT / precompile / EOA / CREATE | Non gestito (storage); gerarchia gestita dal `callTracer` | 20-28 | Codice + nuovi esperimenti + testo |
| 5 | DELEGATECALL e librerie | Gestito solo in parte | 8-12 | Codice + testo |
| 6 | Letture e scritture | Non gestito | 7-11 | Codice + testo (rigenerare i log) |
| 7 | Frame revertiti, netto o intermedio, transient storage | Non gestito | 10-16 | Codice + testo + nuovi esperimenti |
| 8 | Chiavi dei mapping e strutture supportate | Gestito solo in parte | 2-3 (testo) / 6-9 (minimo) / fino a 40-50 (completo) | Testo, più codice ed esperimenti per ampliare |
| 9 | Affermazione sull'AST | Non gestito (affermazione errata) | 1-2 | Solo testo |
| 10 | Proxy (EIP-1967, 1167, diamond, upgrade) | Gestito solo in parte | 20-32 (3-4 solo testo) | Codice + nuovi esperimenti + testo |
| 11 | Compilazione (versioni, multi-file, non Solidity) | Gestito solo in parte | 9-13 (+10-15 per Vyper) | Codice + testo + piccola verifica |

**Note sulla tabella.**
- I punti 3, 4 e 7 condividono la stessa infrastruttura: delimitazione dei frame e allineamento con il `callTracer`. Affrontati insieme costano meno della somma, circa 30-40 h invece di 40-60.
- I contratti sintetici dei punti 4, 7 e 8 e l'uso del `prestateTracer` in diff mode come riferimento possono servire anche alla validazione contro una ground truth chiesta dal revisore nei commenti generali.
- Le ore escludono la rigenerazione del dataset pubblico, che dipende dal tempo macchina e dal nodo archivio.
