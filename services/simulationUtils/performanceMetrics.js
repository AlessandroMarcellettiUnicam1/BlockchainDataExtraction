const fs = require('fs');
const path = require('path');

const METRICS_DIR = path.join(__dirname, '../../metrics'); 

if (!fs.existsSync(METRICS_DIR)) {
    fs.mkdirSync(METRICS_DIR, { recursive: true });
}

async function logMetrics(fileName, dataRow) {
    const filePath = path.join(METRICS_DIR, fileName);
    const fileExists = fs.existsSync(filePath);
    
    if (!fileExists) {
        const headers = Object.keys(dataRow).join(',') + '\n';
        fs.writeFileSync(filePath, headers);
    }
    
    const csvRow = Object.values(dataRow).join(',') + '\n';
    await fs.promises.appendFile(filePath, csvRow);
}

module.exports = {
    logMetrics
};