const https = require('https');
const http = require('http');
const JSONStream = require('JSONStream');
const { optimizedDecodeValues } = require('../optimizedDecodeValues');

function debugTraceCall(params, url) {
    return new Promise((resolve, reject) => {
        const start = new Date();

        makeRpcCallStreaming(url, 'debug_traceCall', params)
            .then(stream => {
                const end = new Date();
                const requiredTime = parseFloat(((end - start) / 1000).toFixed(2));
                resolve({ requiredTime, stream });
            })
            .catch(reject);
    });
}

module.exports = {
    debugTraceCall,
    makeRpcCallStreaming
};