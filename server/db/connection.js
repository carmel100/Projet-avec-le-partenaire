const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config()

mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true, 
    useUnifiedTopology: true
}).then(() => console.log('Connected to DB')).catch((e)=> console.log('Error', e))