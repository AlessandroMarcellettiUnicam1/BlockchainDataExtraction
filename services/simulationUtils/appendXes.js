function appendXes(baseXes, newXes) {
    // estraggo il bloggo trace e event dallo xes appena convertito
    const traceStart = newXes.indexOf('<trace>');
    const traceEnd = newXes.indexOf('</trace>') + 8;
    const newTraceBlock = newXes.substring(traceStart, traceEnd);

    const eventStart = newXes.indexOf('<event>');
    const eventEnd = newXes.indexOf('</event>') + 8;
    const newEventBlock = newXes.substring(eventStart, eventEnd);

    // estraggo 
    const caseIdRegex = /<string key="concept:name" value="([^"]+)"\/>/;
    const caseMatch = newTraceBlock.match(caseIdRegex);
    const caseId = caseMatch ? caseMatch[1] : null;

    if (caseId) {
        const caseIdentifier = `<string key="concept:name" value="${caseId}"/>`;
        const identifierIndex = baseXes.indexOf(caseIdentifier);

        // se il caseId si trova già nel log base
        if (identifierIndex !== -1) {
            const nextTraceClose = baseXes.indexOf('</trace>', identifierIndex);

            if (nextTraceClose !== -1) {
                const before = baseXes.substring(0, nextTraceClose);
                const after = baseXes.substring(nextTraceClose);
                return before + newEventBlock + '\n' + after;
            }
        }
        // non trovo il caseId, faccio l'append alla fine del log base
        else {
            const logCloseIndex = baseXes.lastIndexOf('</log>');
            
            if (logCloseIndex !== -1) {
                const before = baseXes.substring(0, logCloseIndex);
                const after = baseXes.substring(logCloseIndex);
                return before + newTraceBlock + '\n' + after;
            }
        }
    } else {
        console.warn("Append ignorato.");
    }

    return baseXes;
}

module.exports = {
    appendXes
};