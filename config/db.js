const mongoose = require('mongoose');

const connectDB = async (network) => {
    await mongoose.disconnect();
    try {
        await mongoose.connect(process.env.MONGODB_URL + '/' + network + '_DB');
        console.log('Connected to MongoDB - ' + network + '_DB');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error.message);
        process.exit(1); // Exit process with failure
    }
};

module.exports = connectDB;