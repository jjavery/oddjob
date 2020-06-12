const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  job_id: { type: mongoose.Types.ObjectId, required: true },
  level: { type: String, enum: ['error', 'warn', 'info', 'debug'] },
  message: { type: Object },
  created: { type: Date, default: Date.now }
});

schema.index({ job_id: 1 });
schema.index({ created: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('jobLog', schema, 'job_log');
