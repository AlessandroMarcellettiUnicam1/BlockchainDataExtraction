function appendXes(baseXes, newXes) {
    let updatedXes = baseXes;
    
    // Utilizziamo una Map per collezionare le tracce modificate. 
    // Se lo stesso caseId viene modificato più volte nello stesso blocco, manterremo solo la versione finale.
    let modifiedTracesMap = new Map(); 

    // 1. Estrazione degli Header dal log base (viene eseguita una volta sola)
    const firstTraceIndex = baseXes.indexOf('<trace>');
    const logCloseIndex = baseXes.lastIndexOf('</log>');
    
    const xesHeaders = firstTraceIndex !== -1 
        ? baseXes.substring(0, firstTraceIndex) 
        : baseXes.substring(0, logCloseIndex > -1 ? logCloseIndex : baseXes.length).trim() + '\n';

    // 2. Troviamo TUTTI i blocchi <trace> presenti nel log appena convertito (newXes)
    const traceRegex = /<trace>[\s\S]*?<\/trace>/g;
    let match;

    while ((match = traceRegex.exec(newXes)) !== null) {
        const newTraceBlock = match[0];
        
        // Estrazione del caseId per questa specifica traccia
        const caseIdMatch = newTraceBlock.match(/<string key="concept:name" value="([^"]+)"\/>/);
        const caseId = caseIdMatch ? caseIdMatch[1] : null;

        if (!caseId) continue;

        // Estrazione di tutti i tag <event> all'interno della traccia (esclude le intestazioni della singola traccia)
        const eventRegex = /<event>[\s\S]*?<\/event>/g;
        let eventsBlock = "";
        let eventMatch;
        while ((eventMatch = eventRegex.exec(newTraceBlock)) !== null) {
            eventsBlock += eventMatch[0] + '\n';
        }

        const caseIdentifier = `<string key="concept:name" value="${caseId}"/>`;
        const identifierIndex = updatedXes.indexOf(caseIdentifier);

        // A. TRACCIA ESISTENTE NEL LOG BASE
        if (identifierIndex !== -1) {
            const traceStartIndex = updatedXes.lastIndexOf('<trace>', identifierIndex);
            const traceEndIndex = updatedXes.indexOf('</trace>', identifierIndex);

            if (traceStartIndex !== -1 && traceEndIndex !== -1) {
                const before = updatedXes.substring(0, traceEndIndex);
                const after = updatedXes.substring(traceEndIndex);

                // Inserimento dei nuovi eventi poco prima della chiusura </trace>
                updatedXes = before + eventsBlock + after;

                // Estrazione dell'intera traccia storica appena aggiornata
                const newTraceEndIndex = updatedXes.indexOf('</trace>', traceStartIndex) + 8;
                const fullyModifiedTrace = updatedXes.substring(traceStartIndex, newTraceEndIndex);
                modifiedTracesMap.set(caseId, fullyModifiedTrace);
            }
        } 
        // B. TRACCIA NUOVA (Non presente nel log base)
        else {
            const currentLogCloseIndex = updatedXes.lastIndexOf('</log>');
            if (currentLogCloseIndex !== -1) {
                const before = updatedXes.substring(0, currentLogCloseIndex);
                const after = updatedXes.substring(currentLogCloseIndex);
                
                // Append dell'intera nuova traccia prima della chiusura del log
                updatedXes = before + newTraceBlock + '\n' + after;
                modifiedTracesMap.set(caseId, newTraceBlock);
            }
        }
    }

    // 3. Creazione del "Mini-XES" assemblando: Header + Tutte le Tracce Modificate + Chiusura
    let miniXesToVerify = null;
    
    if (modifiedTracesMap.size > 0) {
        // Uniamo tutti i valori della mappa (le tracce) in un'unica stringa
        const allModifiedTracesString = Array.from(modifiedTracesMap.values()).join('\n');
        miniXesToVerify = xesHeaders + allModifiedTracesString + '\n</log>';
    } else {
        console.warn("[AppendXes] Nessuna traccia valida elaborata.");
    }

    return {
        updatedXes,
        miniXesToVerify
    };
}

module.exports = { appendXes };