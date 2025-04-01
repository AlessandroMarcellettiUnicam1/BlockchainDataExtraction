const express = require('express');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs');
const {stringify} = require("csv-stringify");
const multer = require('multer');
const jsonToCsv = require("json-2-csv")


const {getAllTransactions} = require("./services/main");
const app = express();
const upload = multer({dest: 'uploads/'})
const port = 8000;
const { setEventTypes }=require("./ocelMapping/eventTypes");
app.use(cors());

// Middleware: Logging for every request
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Middleware: Serving static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json({limit: '1mb'}));

const {searchTransaction} = require('./query/query');
const {connectDB} = require("./config/db");
const { setObjectTypes } = require('./ocelMapping/objectTypes/objectTypes');

app.post('/api/ocelMap',(req,res)=>{
    const ocelMap=req.body;
    let ocel = {
        eventTypes: [],
        objectTypes: [],
        events: [],
        objects: []
    }
    const eventTypes=setEventTypes(ocelMap.blockchainLog,ocel)
    ocel.events = eventTypes.events
    ocel.eventTypes = eventTypes.eventTypes
    ocelMap.objectsToMap.forEach((obj)=>{
        ocel=setObjectTypes(obj,ocel,ocelMap.blockchainLog)
    })
    res.send(ocel);
})
app.post('/api/xes', async (req, res) => {
    const jsonToTranslate = req.body.jsonToXes;
    const {caseId, activityKey,timestamp} = req.body.objectsToXes;
    let xes={
        xesString:null
    }
    xes.xesString=jsonToXes(jsonToTranslate,caseId.value,activityKey.value)
    res.send(xes);
    // const filename = "xesLogs.json"
    // // const xesString = jsonToXesString(jsonToTranslate);
    // const formattedFileName = encodeURIComponent(filename);
    // fs.writeFileSync(filename, xesString);

    // res.setHeader('Content-Disposition', `attachment; filename="${formattedFileName}"`);
    // res.setHeader('Content-Type', 'application/octet-stream');

    // res.sendFile(path.resolve(filename), (err) => {
    //     if (err) {
    //         console.error(err);
    //         res.status(err.status).end();
    //     } else {
    //         fs.unlinkSync(path.resolve(filename));
    //         console.log('File sent successfully');
    //     }
    // });
})
app.post('/api/query', async (req, res) => {
    const query = req.body;

    console.log("Query received -> ", query);
    await connectDB(query.network)
    delete query.network;
    try {
        const results = await searchTransaction(query);

        if (results) {
            res.json(results);
        } else {
            res.status(404).json({ message: 'No result found' });
        }
    } catch (error) {
        console.error('Error during query execution:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route: Home Page
app.post('/submit', upload.single('file'), async (req, res) => {
    const contractAddress = req.body.contractAddress; // Get data from input1
    const implementationContractAddress = req.body.implementationContractAddress; // Get data from input1
    const contractName = req.body.contractName; // Get data from input2
    const fromBlock = req.body.fromBlock; // Get 'Start Block' value from form
    const toBlock = req.body.toBlock; // Get 'End Block' value from form
    const network = req.body.network;
    const filters = JSON.parse(req.body.filters);

    // Perform actions based on the received data
    console.log(`Start Block: ${fromBlock}`);
    console.log(`End Block: ${toBlock}`);
    // Perform actions with the received data (you can customize this part)
    console.log(`contract Address: ${contractAddress}`);
    console.log(`implementation contract Address: ${implementationContractAddress}`);
    console.log(`Contract name: ${contractName}`);
    let logs = []
    if (req.file) {
        fs.readFile(req.file.path, 'utf-8', async (err, data) => {
            if (err) {
                console.error(err)
                return res.status(500).send("Error reading file")
            }
            logs = await getAllTransactions(contractName, contractAddress, implementationContractAddress, fromBlock, toBlock, network, filters, data)
            fs.unlink(req.file.path, (err) => {
                if (err) {
                    console.error(err)
                }
                if (logs instanceof Error) {
                    res.status(404).send(logs.message)
                } else {
                    res.send(logs)
                }
            })
        })
    } else {
        logs = await getAllTransactions(contractName, contractAddress, implementationContractAddress, fromBlock, toBlock, network, filters)
        if (logs instanceof Error) {
            res.status(404).send(logs.message)
        } else {
            res.send(logs)
        }
    }
});

app.post('/json-download', (req, res) => {

    const jsonToDownload = req.body.jsonLog;
    fs.writeFileSync('jsonLog.json', JSON.stringify(jsonToDownload, null, 2));

    const formattedFileName = encodeURIComponent('jsonLog.json');
    res.setHeader('Content-Disposition', `attachment; filename="${formattedFileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    res.sendFile(path.resolve("jsonLog.json"), (err) => {
        if (err) {
            // Handle error if file sending fails
            console.error(err);
            res.status(err.status).end();
        } else {
            fs.unlinkSync(path.resolve("jsonLog.json"))
            console.log('File sent successfully');
        }
    });
})

app.post('/csv-download', async (req, res) => {
    const jsonToDownload = req.body.jsonLog;
    const fileName = 'jsonLog.csv';

    const columns = ["BlockNumber", "transactionHash", "functionName", "Timestamp", "Sender", "GasFee", "StorageState", "Inputs", "Events", "InternalTxs"]
    const logs = jsonToDownload.map(log => {

        const customDate = log.timestamp.split(".")[0] + ".000+0100"

        const blockNumber = log.blockNumber;
        const tr = log.transactionHash;
        const activity = log.functionName;
        const timestamp = customDate;
        const sender = log.sender;
        const gasFee = log.gasUsed;
        const storageState = log.storageState.map(variable => variable.variableName).toString();
        const inputs = log.inputs.map(input => input.inputName).toString();
        const events = log.events.map(event => event.eventName).toString();
        const internalTxs = log.internalTxs.map(tx => tx.callType).toString();
        return {
            BlockNumber: blockNumber,
            transactionHash: tr,
            functionName: activity,
            Timestamp: timestamp,
            Sender: sender,
            GasFee: gasFee,
            StorageState: storageState,
            Inputs: inputs,
            Events: events,
            InternalTxs: internalTxs
        }
    })
    stringify(logs, {header: true, columns: columns}, (err, output) => {
        fs.writeFileSync(`./${fileName}`, output)
        const formattedFileName = encodeURIComponent(fileName);
        res.setHeader('Content-Disposition', `attachment; filename="${formattedFileName}"`);
        res.setHeader('Content-Type', 'application/octet-stream');

        res.sendFile(path.resolve(fileName), (err) => {
            if (err) {
                // Handle error if file sending fails
                console.error(err);
                res.status(err.status).end();
            } else {
                fs.unlinkSync(path.resolve("jsonLog.csv"))
                console.log('File sent successfully');
            }
        })
    })
})

app.post('/ocel-download', (req, res) => {

    const jsonToDownload = req.body.ocel;
    const filename = "ocelLogs.json"
    // const jsonOcel = JsonOcelExporter.apply(jsonToDownload);

    fs.writeFileSync(filename, JSON.stringify(jsonToDownload, null, 2));

    const formattedFileName = encodeURIComponent(filename);
    res.setHeader('Content-Disposition', `attachment; filename="${formattedFileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    res.sendFile(path.resolve(filename), (err) => {
        if (err) {
            // Handle error if file sending fails
            console.error(err);
            res.status(err.status).end();
        } else {
            fs.unlinkSync(path.resolve(filename))
            console.log('File sent successfully');
        }
    });
})
app.post('/xes-translator',(req,res)=>{
    const filename="xesLogs.xes"
    fs.writeFileSync(filename, req.body.jsonLog.xesString);
    const formattedFileName = encodeURIComponent(filename);
    res.setHeader('Content-Disposition', `attachment; filename="${formattedFileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.sendFile(path.resolve(filename), (err) => {
        if (err) {
            // Handle error if file sending fails
            console.error(err);
            res.status(err.status).end();
        } else {
            fs.unlinkSync(path.resolve(filename))
            console.log('File sent successfully');
        }
    })
})

function jsonToXes(jsonToTranslate, caseIdKey, activityKey) {
    const trace = {};
    jsonToTranslate.forEach(entry => {
        let caseIds = findAllValuesByKey(entry, caseIdKey); // Get all case IDs
        let activities = findAllValuesByKey(entry, activityKey); // Get all activities
        // Match occurrences one by one
        for (let i = 0; i < caseIds.length; i++) {
            let caseId = caseIds[i];
            let activity = activities[i];

            if (caseId in trace) {
                trace[caseId].push({ [activityKey]: activity, entry: entry });
            } else {
                trace[caseId] = [{ [activityKey]: activity, entry: entry }];
            }
        }
    });
    let stringResult=[];
    let index=0
    for(const key in trace){
        stringResult.push(`\t<trace>`);
        stringResult.push(`\t<string key="concept:name" value="${key}"/>`);
        trace[key].forEach((entry)=>{
            stringResult.push(`\t\t<event>`);
            stringResult.push(`\t\t<string key="concept:name" value="${entry[activityKey]}"/>`);
            generateKeyValueStrings(entry.entry,caseIdKey,activityKey,index,caseIdKey).forEach(elemt=>{
                stringResult.push(elemt);
            })
            stringResult.push(`\t\t</event>`);
            // stringResult.push(generateKeyValueStrings(entry.entry,caseIdKey,activityKey));
        })
        stringResult.push(`\t</trace>`);
    }
let finalResult = `<?xml version="1.0" encoding="UTF-8"?>\n<log xmlns="http://www.xes-standard.org/">\n`;
finalResult += stringResult.join("\n");
finalResult += `\n</log>`;

    return finalResult;
}


function generateKeyValueStrings(obj, caseId, activityKey, keyToCheck = "") {
    let result = [];

    if (typeof obj === "object" && obj !== null) {
        for (let key in obj) {
            let newKeyToCheck = keyToCheck ? `${keyToCheck}_${key}` : key;

            if (Array.isArray(obj[key])) {
                obj[key].forEach((item, index) => {
                    let arrayKey = `${newKeyToCheck}[${index}]`;
                    result.push(...generateKeyValueStrings(item, caseId, activityKey, arrayKey));
                });
            } else if (typeof obj[key] === "object" && obj[key] !== null) {
                result.push(...generateKeyValueStrings(obj[key], caseId, activityKey, newKeyToCheck));
            } else if (key !== caseId && key !== activityKey) {
                let newKeyToCheckCut=newKeyToCheck;
                if(newKeyToCheck.includes("[")){
                    newKeyToCheckCut=newKeyToCheck.split("[")[0];
                }
                switch (newKeyToCheckCut) {
                    case "inputs":
                        result.push(`\t\t\t<string key="${newKeyToCheck}" value="${obj[key]}"/>`);
                        break;
                    case "events":
                        if(!(newKeyToCheck.split("_eventValues")[1]?.includes("1") || newKeyToCheck.split("_eventValues")[1]?.includes("2") 
                        || newKeyToCheck.split("_eventValues")[1]?.includes("0") || newKeyToCheck.split("_eventValues")[1]?.includes("_length"))){
                            newKeyToCheck = newKeyToCheck.replace("events","BCEvent");
                            result.push(`\t\t\t<string key="${newKeyToCheck}" value="${obj[key]}"/>`);
                        }
                        break;
                    case "internalTxs":
                        newKeyToCheck = newKeyToCheck.replace("internalTxs","Int");
                        result.push(`\t\t\t<string key="${newKeyToCheck}" value="${obj[key]}"/>`);
                        break;
                    case "storageState":
                        newKeyToCheck = newKeyToCheck.replace("storageState","stateVar");
                        result.push(`\t\t\t<string key="${newKeyToCheck}" value="${obj[key]}"/>`);
                        break;
                    default:
                        result.push(`\t\t\t<string key="${newKeyToCheck}" value="${obj[key]}"/>`);
                        break;
                }
                
            }
        }
    } else {
        switch (keyToCheck) {
            case "inputs":
                result.push(`\t\t\t<string key="${keyToCheck}" value="${obj}"/>`);
                break;
            case "events":
                keyToCheck = keyToCheck.replace("events","BCEvent");
                result.push(`\t\t\t<string key="${keyToCheck}" value="${obj}"/>`);
                break;
            case "internalTxs":
                keyToCheck = keyToCheck.replace("internalTxs","Int");
                result.push(`\t\t\t<string key="${keyToCheck}" value="${obj}"/>`);
                break;
            case "storageState":
                keyToCheck = keyToCheck.replace("storageState","stateVar");
                result.push(`\t\t\t<string key="${keyToCheck}" value="${obj}"/>`);
                break;
            default:
                result.push(`\t\t\t<string key="${keyToCheck}" value="${obj}"/>`);
                break;
        }
        // result.push(`<string  key="${keyToCheck}" value="${obj}"/>`);
    }

    return result;
}



function findAllValuesByKey(obj, key) {
    let results = [];

    function recursiveSearch(o) {
        if (typeof o !== 'object' || o === null) return;

        if (key in o) {
            results.push(o[key]);
        }

        for (let k in o) {
            if (typeof o[k] === 'object') {
                recursiveSearch(o[k]);
            } else if (Array.isArray(o[k])) {
                o[k].forEach(item => recursiveSearch(item));
            }
        }
    }

    recursiveSearch(obj);
    return results;
}
app.post('/jsonocel-download', (req, res) => {

    const jsonToDownload = req.body.ocel;
    const filename = "ocelLogs.jsonocel"

    fs.writeFileSync(filename, JSON.stringify(jsonToDownload, null, 2));

    const formattedFileName = encodeURIComponent(filename);
    res.setHeader('Content-Disposition', `attachment; filename="${formattedFileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    res.sendFile(path.resolve(filename), (err) => {
        if (err) {
            // Handle error if file sending fails
            console.error(err);
            res.status(err.status).end();
        } else {
            fs.unlinkSync(path.resolve(filename))
            console.log('File sent successfully');
        }
    });

})

app.post('/csvocel-download', (req, res) => {
    const ocel = req.body.ocel;
    const filename = "ocelLogs.csv"

    const array = Array(1).fill(ocel)
    const csvRow = jsonToCsv.json2csv(array, {arrayIndexesAsKeys: true})

    fs.writeFileSync(filename, csvRow)

    const formattedFileName = encodeURIComponent(filename);
    res.setHeader('Content-Disposition', `attachment; filename="${formattedFileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    res.sendFile(path.resolve(filename), (err) => {
        if (err) {
            // Handle error if file sending fails
            console.error(err);
            res.status(err.status).end();
        } else {
            fs.unlinkSync(path.resolve(filename))
            console.log('File sent successfully');
        }
    });
    // fs.writeFileSync(filename, csvRow)
})

app.get('/', (req, res) => {
    res.send('Welcome to the Home Page!');
});

// Route: About Page
app.get('/about', (req, res) => {
    res.send('This is the About Page');
});

// Route: Dynamic Route with Parameter
app.get('/user/:id', (req, res) => {
    res.send(`User ID: ${req.params.id}`);
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

