/** Soglia sotto i 16MB BSON, con margine per metadati del documento */
const CHUNK_BYTE_THRESHOLD = 12 * 1024 * 1024;

function byteLength(str) {
    return Buffer.byteLength(str, 'utf8');
}

/**
 * Spezza una stringa in chunk UTF-8-safe se supera la soglia.
 * @returns {{ chunkIndex: number, chunkTotal: number, payload: string }[]}
 */
function splitIntoChunks(str, threshold = CHUNK_BYTE_THRESHOLD) {
    const input = str == null ? '' : String(str);
    if (byteLength(input) <= threshold) {
        return [{ chunkIndex: 0, chunkTotal: 1, payload: input }];
    }

    const parts = [];
    let offset = 0;
    while (offset < input.length) {
        let end = offset;
        let size = 0;
        while (end < input.length) {
            const cp = input.codePointAt(end);
            const char = String.fromCodePoint(cp);
            const charBytes = byteLength(char);
            if (size + charBytes > threshold && size > 0) break;
            size += charBytes;
            end += char.length;
        }
        parts.push(input.slice(offset, end));
        offset = end;
    }

    return parts.map((payload, i) => ({
        chunkIndex: i,
        chunkTotal: parts.length,
        payload
    }));
}

function joinChunkPayloads(chunkDocs) {
    return [...chunkDocs]
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map((d) => d.payload)
        .join('');
}

function serializeForStorage(value) {
    if (typeof value === 'string') {
        return { kind: 'string', body: value };
    }
    return { kind: 'json', body: JSON.stringify(value) };
}

function deserializeFromStorage(kind, body) {
    if (kind === 'string') return body;
    try {
        return JSON.parse(body);
    } catch {
        return body;
    }
}

function extractXesHeader(xesString) {
    if (!xesString) return '';
    const firstTraceIndex = xesString.indexOf('<trace>');
    const logCloseIndex = xesString.lastIndexOf('</log>');
    if (firstTraceIndex !== -1) {
        return xesString.substring(0, firstTraceIndex);
    }
    return xesString.substring(0, logCloseIndex > -1 ? logCloseIndex : xesString.length).trim() + '\n';
}

/**
 * @returns {{ caseId: string, traceXml: string }[]}
 */
function extractXesTraces(xesString) {
    if (!xesString) return [];
    const traces = [];
    const traceRegex = /<trace>[\s\S]*?<\/trace>/g;
    let match;
    while ((match = traceRegex.exec(xesString)) !== null) {
        const traceXml = match[0];
        const caseIdMatch = traceXml.match(/<string key="concept:name" value="([^"]+)"\/>/);
        if (!caseIdMatch) continue;
        traces.push({ caseId: caseIdMatch[1], traceXml });
    }
    return traces;
}

function buildXesFromParts(xesHeader, traceXmlList) {
    const header = xesHeader || '';
    const body = (traceXmlList || []).join('\n');
    if (!header && !body) return null;
    return `${header}${body}\n</log>`;
}

/**
 * Stessa euristica di buildUpdate nei worker (con fallback su chiavi comuni).
 */
function extractCaseIdFromComplianceTrace(trace, caseCol) {
    if (typeof trace === 'string') return String(trace);
    if (Array.isArray(trace) && trace.length > 0) {
        const first = trace[0];
        if (caseCol && first && first[caseCol] != null) return String(first[caseCol]);
        if (first && typeof first === 'object') {
            for (const k of ['concept:name', 'case:concept:name', 'case_id', 'caseId']) {
                if (first[k] != null) return String(first[k]);
            }
        }
        return null;
    }
    if (trace && typeof trace === 'object') {
        if (caseCol && trace[caseCol] != null) return String(trace[caseCol]);
        for (const k of ['concept:name', 'case:concept:name', 'case_id', 'caseId']) {
            if (trace[k] != null) return String(trace[k]);
        }
    }
    return null;
}

const STATUS_BUCKETS = [
    'compliant',
    'noncompliant',
    'tempCompliant',
    'tempNonCompliant',
    'ignored'
];

module.exports = {
    CHUNK_BYTE_THRESHOLD,
    splitIntoChunks,
    joinChunkPayloads,
    serializeForStorage,
    deserializeFromStorage,
    extractXesHeader,
    extractXesTraces,
    buildXesFromParts,
    extractCaseIdFromComplianceTrace,
    STATUS_BUCKETS
};
