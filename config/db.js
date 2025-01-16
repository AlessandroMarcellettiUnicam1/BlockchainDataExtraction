const mongoose = require('mongoose');

const connectDB = async (db) => {
    try {
        await mongoose.disconnect()
        await mongoose.connect(process.env.MONGODB_URL + '/' + db + '_DB')
        console.log("Connected to MongoDB - " + db + "_DB");
    } catch (error) {
        console.error('Error connecting to MongoDB:', error.message);
        throw new Error(error.message)
    }
};

module.exports = {connectDB};