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

app.use(cors());

// Middleware: Logging for every request
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Middleware: Serving static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

const {searchTransaction} = require('./query/query');

app.post('/api/query', async (req, res) => {
    const query = req.body;

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
    console.log(`Contract name: ${contractName}`);
    let logs = []
    if (req.file) {
        fs.readFile(req.file.path, 'utf-8', async (err, data) => {
            if (err) {
                console.error(err)
                return res.status(500).send("Error reading file")
            }

            logs = await getAllTransactions(contractName, contractAddress, fromBlock, toBlock, network, filters, data)
            fs.unlink(req.file.path, (err) => {
                if (err) {
                    console.error(err)
                }
                res.send(logs)
            })
        })
    } else {
        logs = await getAllTransactions(contractName, contractAddress, fromBlock, toBlock, network, filters)
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

    const columns = ["BlockNumber", "TxHash", "Activity", "Timestamp", "Sender", "GasFee", "StorageState", "Inputs", "Events", "InternalTxs"]
    const logs = jsonToDownload.map(log => {

        const customDate = log.timestamp.split(".")[0] + ".000+0100"

        const blockNumber = log.blockNumber;
        const txHash = log.txHash;
        const activity = log.activity;
        const timestamp = customDate;
        const sender = log.sender;
        const gasFee = log.gasUsed;
        const storageState = log.storageState.map(variable => variable.variableName).toString();
        const inputs = log.inputs.map(input => input.inputName).toString();
        const events = log.events.map(event => event.eventName).toString();
        const internalTxs = log.internalTxs.map(tx => tx.callType).toString();
        return {
            BlockNumber: blockNumber,
            TxHash: txHash,
            Activity: activity,
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
