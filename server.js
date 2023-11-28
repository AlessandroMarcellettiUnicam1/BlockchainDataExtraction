const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');

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
app.post('/submit', (req, res) => {
    const input1 = req.body.input1; // Get data from input1
    const input2 = req.body.input2; // Get data from input2
    const startBlock = req.body.startBlock; // Get 'Start Block' value from form
    const endBlock = req.body.endBlock; // Get 'End Block' value from form

    // Perform actions based on the received data
    console.log(`Start Block: ${startBlock}`);
    console.log(`End Block: ${endBlock}`);
    // Perform actions with the received data (you can customize this part)
    console.log(`Received input1: ${input1}`);
    console.log(`Received input2: ${input2}`);

    // Send a response back to the client
    res.send('POST request received!');
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
