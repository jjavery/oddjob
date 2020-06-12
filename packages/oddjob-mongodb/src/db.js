const mongoose = require('mongoose');
const debug = require('debug')('oddjob:mongodb');

mongoose.set('useNewUrlParser', true);
mongoose.set('useFindAndModify', false);
mongoose.set('useCreateIndex', true);
mongoose.set('useUnifiedTopology', true);
// mongoose.set('debug', true);

const Job = require('./models/job');
const JobLog = require('./models/job-log');
const JobResult = require('./models/job-result');

const { ObjectId } = mongoose.Types;

const settings = {
  uri: 'mongodb://localhost/oddjob'
};

function init(options = {}) {
  Object.assign(settings, options);
}

function connect() {
  return mongoose.connect(settings.uri);
}

function disconnect() {
  return mongoose.disconnect();
}

function createJob() {
  const job = new Job();

  job.id = ObjectId().toHexString();

  return job;
}

async function writeJobLog(id, level, message) {
  await JobLog.create({ job_id: ObjectId(id), level, message });
}

async function readJobLog(id, skip, limit) {
  return JobLog.find(
    { job_id: ObjectId(id) },
    { _id: 0, level: 1, message: 1, created: 1 }
  )
    .sort({ _id: -1 })
    .skip(skip)
    .limit(limit);
}

async function findJobById(id) {
  return Job.findById(id);
}

async function updateRunningJob({ id, acquired, timeout }, update) {
  const query = {
    _id: ObjectId(id),
    status: 'running',
    acquired,
    timeout
  };

  return Job.findOneAndUpdate(query, { $set: update }, { new: true });
}

async function writeJobResult(id, data) {
  return JobResult.create({ _id: ObjectId(id), data });
}

async function readJobResult(id) {
  return JobResult.findById(id);
}

async function updateJobById(id, update) {
  return Job.findByIdAndUpdate(
    id,
    { $set: update },
    {
      new: true
    }
  );
}

async function pollForRunnableJob(types, timeout, worker) {
  const now = new Date();

  const query = {
    type: {
      $in: types
    },
    $or: [
      // waiting and scheduled to run
      {
        status: 'waiting',
        scheduled: { $lte: now },
        timeout: null
      },
      // was running and lock timed out
      {
        status: 'running',
        scheduled: { $lte: now },
        timeout: { $lte: now }
      },
      // recurring and failed
      {
        recurring: { $ne: null },
        status: 'failed',
        scheduled: { $lte: now },
        timeout: null
      }
    ]
  };

  const update = {
    $set: {
      status: 'running',
      acquired: now,
      timeout,
      worker,
      modified: now
    },
    $inc: {
      try: 1
    }
  };

  debug('Begin poll query %j', query);

  const data = Job.findOneAndUpdate(query, update, { new: true }).sort({
    priority: -1,
    created: 1
  });

  if (!data) {
    debug('End poll query; no jobs found');
  } else {
    debug('End poll query; found job type "%s" id "%s"', data.type, data.id);
  }

  return data;
}

module.exports = {
  ODDJOB_PLUGIN_TYPE: 'db',
  init,
  connect,
  disconnect,
  createJob,
  findJobById,
  updateJobById,
  updateRunningJob,
  writeJobLog,
  readJobLog,
  writeJobResult,
  readJobResult,
  pollForRunnableJob
};
