const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '../..');

async function logMetrics(fileName, dataRow) {
    const safeFileName = path.basename(fileName);
    const filePath = path.join(BACKEND_DIR, safeFileName);
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
