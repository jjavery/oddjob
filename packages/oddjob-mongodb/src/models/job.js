const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  type: { type: String, maxlength: 256, required: true },
  unique_id: { type: String, maxlength: 256 },
  client: { type: String, maxlength: 256 },
  worker: { type: String, maxlength: 256 },
  recurring: { type: String, maxlength: 4096 },
  timezone: { type: String, maxlength: 32, default: 'UTC' },
  status: {
    type: String,
    enum: ['ignore', 'waiting', 'running', 'completed', 'expired', 'failed'],
    default: 'waiting'
  },
  retries: { type: Number, default: 3 },
  try: { type: Number, default: 0 },
  priority: { type: Number, default: 0 },
  stopwatches: { type: Object },
  message: { type: Object },
  scheduled: { type: Date, default: Date.now },
  acquired: { type: Date },
  timeout: { type: Date },
  expire: { type: Date },
  completed: { type: Date },
  created: { type: Date, default: Date.now },
  modified: { type: Date, default: Date.now }
});

schema.index({ unique_id: 1 }, { unique: true, sparse: true });
schema.index({ status: 1, scheduled: 1, timeout: 1, priority: 1, created: 1 });
schema.index({ type: 1, created: 1 });
schema.index({ created: 1 });
schema.index({ completed: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('job', schema);
