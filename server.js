const express = require('express');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs');
const getAllTransactions = require("./main");
const {stringify} = require("csv-stringify");
const app = express();
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

// Route: Home Page
app.post('/submit', async (req, res) => {
    const contractAddress = req.body.contractAddress; // Get data from input1
    const contractName = req.body.contractName; // Get data from input2
    const fromBlock = req.body.fromBlock; // Get 'Start Block' value from form
    const toBlock = req.body.toBlock; // Get 'End Block' value from form

    // Perform actions based on the received data
    console.log(`Start Block: ${fromBlock}`);
    console.log(`End Block: ${toBlock}`);
    // Perform actions with the received data (you can customize this part)
    console.log(`contract Address: ${contractAddress}`);
    console.log(`Contract name: ${contractName}`);
    const logs = await getAllTransactions(contractName, contractAddress, fromBlock, toBlock)

    res.send(logs)
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

    const columns = ["TxHash", "Activity", "Timestamp", "Sender", "GasFee", "StorageState", "Inputs", "Events", "InternalTxs"]
    const logs = jsonToDownload.map(log => {

        const customDate = log.timestamp.split(".")[0] + ".000+0100"

        const txHash = log.txHash;
        const activity = log.activity;
        const timestamp = customDate;
        const sender = log.sender;
        const gasFee = log.gasUsed;
        const storageState = log.storageState.map(variable => variable.name).toString();
        const inputs = log.inputs.map(input => input.name).toString();
        const events = log.events.map(event => event.name).toString();
        const internalTxs = log.internalTxs.map(tx => tx.type).toString();
        return {
            TxHash: txHash,
            Activity: activity,
            Timestamp: timestamp,
            Sender: sender,
            GasFee: gasFee,
            StorageState: '"' + storageState + '"',
            Inputs: '"' + inputs + '"',
            Events: '"' + events + '"',
            InternalTxs: '"' + internalTxs + '"'
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
