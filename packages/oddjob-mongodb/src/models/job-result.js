const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  data: { type: Object },
  created: { type: Date, default: Date.now }
});

schema.index({ created: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('jobResult', schema, 'job_results');
