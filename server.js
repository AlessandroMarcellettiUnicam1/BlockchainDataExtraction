const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const getAllTransactions = require("./main");
const app = express();
const port = 3000;

// Middleware: Logging for every request
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Middleware: Serving static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));

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
    const log = await getAllTransactions(contractName, contractAddress, fromBlock, toBlock)
    //   .then(function(result) {
    // res.send(result);
    //})

    const file = 'jsonLog.json'; // Replace this with your file path
    const fileName = 'jsonLog.json'; // Replace this with your file name

    const formattedFileName = encodeURIComponent(fileName);

    // Set the appropriate headers for the file download
    res.setHeader('Content-Disposition', `attachment; filename="${formattedFileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    // Send the file as a response
    res.sendFile(path.resolve(file), (err) => {
        if (err) {
            // Handle error if file sending fails
            console.error(err);
            res.status(err.status).end();
        } else {
            console.log('File sent successfully');
        }
    });

    // Send a response back to the client
});

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
