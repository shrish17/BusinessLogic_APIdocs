// backend/resetRateLimit.js
const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const db = mongoose.connection.db;
  const result = await db.collection('rate_limit_state').deleteMany({});
  console.log(`Cleared ${result.deletedCount} rate limit record(s)`);
  process.exit(0);
}).catch(err => {
  console.error('Failed to connect:', err.message);
  process.exit(1);
});