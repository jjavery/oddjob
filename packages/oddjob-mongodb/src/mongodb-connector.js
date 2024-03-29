const { MongoClient, ObjectId } = require('mongodb');
// const { Logger } = require('mongodb');
const debug = require('debug')('oddjob:mongodb');

class MongodbConnector {
  _client;
  _jobsCollectionName;
  _jobLogsCollectionName;
  _jobResultsCollectionName;
  _jobsCollection = null;
  _jobLogsCollection = null;
  _jobResultsCollection = null;
  _connecting = null;
  _indexesCreated = false;

  get _jobs() {
    return this._jobsCollection;
  }

  get _jobLogs() {
    return this._jobLogsCollection;
  }

  get _jobResults() {
    return this._jobResultsCollection;
  }

  constructor(uri, options = {}) {
    options = { useUnifiedTopology: true, ...options };

    const {
      jobsCollectionName = 'jobs',
      jobLogsCollectionName = 'job_logs',
      jobResultsCollectionName = 'job_results'
    } = options;

    this._jobsCollectionName = jobsCollectionName;
    this._jobLogsCollectionName = jobLogsCollectionName;
    this._jobResultsCollectionName = jobResultsCollectionName;

    if (options.client) {
      this._client = client;
    } else {
      delete options.jobsCollectionName;
      delete options.jobLogsCollectionName;
      delete options.jobResultsCollectionName;

      this._client = new MongoClient(uri, options);
    }
  }

  async connect() {
    let connecting = this._connecting;

    if (connecting == null) {
      const _connect = async () => {
        const client = this._client;

        await client.connect();

        const db = client.db();

        this._jobsCollection = db.collection(this._jobsCollectionName);
        this._jobLogsCollection = db.collection(this._jobLogsCollectionName);
        this._jobResultsCollection = db.collection(
          this._jobResultsCollectionName
        );

        await this.ensureIndexes();
      };

      connecting = this._connecting = _connect();
    }

    await connecting;

    this._connecting = null;

    // Logger.setLevel('debug');
  }

  async connected() {
    return this._connecting != null ? this._connecting : Promise.resolve();
  }

  async disconnect() {
    await this.connected();

    this._jobsCollection = null;
    this._jobLogsCollection = null;
    this._jobResultsCollection = null;

    return this._client.close();
  }

  async ensureIndexes() {
    if (this._indexesCreated) {
      return;
    }

    this._indexesCreated = true;

    return Promise.all([
      this._jobs.createIndex({ unique_id: 1 }, { unique: true, sparse: true }),
      this._jobs.createIndex({
        status: 1,
        type: 1,
        priority: 1,
        created: 1,
        scheduled: 1,
        timeout: 1,
        recurring: 1
      }),
      this._jobs.createIndex({ type: 1, created: 1 }),
      this._jobs.createIndex({ created: 1 }),
      this._jobs.createIndex({ completed: 1 }, { expireAfterSeconds: 86400 }),

      this._jobLogs.createIndex({ job_id: 1 }),
      this._jobLogs.createIndex({ created: 1 }, { expireAfterSeconds: 86400 }),

      this._jobResults.createIndex(
        { created: 1 },
        { expireAfterSeconds: 86400 }
      )
    ]);
  }

  createJob(data = {}) {
    const now = new Date();

    const job = {
      id: new ObjectId().toHexString(),
      timezone: 'UTC',
      status: 'waiting',
      retries: 3,
      try: 0,
      priority: 0,
      scheduled: now,
      created: now,
      modified: now,
      ...data
    };

    return job;
  }

  async saveJob(job) {
    await this.connected();

    if (job.id == null) {
      job = this.createJob(job);
    }

    if (job.unique_id == null) {
      delete job.unique_id;
    }

    const $set = { ...job };
    delete $set.id;

    try {
      await this._jobs.findOneAndUpdate(
        { _id: new ObjectId(job.id) },
        { $set },
        { upsert: true, returnDocument: 'after' }
      );
    } catch (err) {
      if (err != null && err.code === 11000) {
        throw new Error('duplicate-key');
      } else {
        throw err;
      }
    }

    const data = { ...job };

    initialize(data);

    return data;
  }

  async findJobById(id) {
    await this.connected();

    const data = await this._jobs.findOne({
      _id: new ObjectId(id)
    });

    initialize(data);

    return data;
  }

  async updateJobById(id, update) {
    await this.connected();

    if (update.unique_id == null) {
      delete update.unique_id;
    }

    const { value: data } = await this._jobs.findOneAndUpdate(
      {
        _id: new ObjectId(id)
      },
      { $set: update },
      { returnDocument: 'after' }
    );

    initialize(data);

    return data;
  }

  async cancelJob(id, unique_id) {
    await this.connected();

    const query = id != null ? { _id: new ObjectId(id) } : { unique_id };

    const { value: data } = await this._jobs.findOneAndUpdate(
      query,
      { $set: { status: 'canceled', modified: new Date() } },
      { returnDocument: 'after' }
    );

    initialize(data);

    return data;
  }

  async pollForRunnableJob(types, timeout, worker) {
    await this.connected();

    const now = new Date();

    const query = {
      status: { $in: ['waiting', 'running', 'error', 'failed'] },
      type: { $in: types },
      scheduled: { $lte: now },
      $or: [
        // waiting and scheduled to run
        {
          status: 'waiting'
        },
        // was running and then canceled or lock timed out
        {
          status: 'running',
          timeout: { $lte: now }
        },
        // was running and then error
        {
          status: 'error'
        },
        // recurring and failed
        {
          status: 'failed',
          recurring: { $ne: null }
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

    const { value: data } = await this._jobs.findOneAndUpdate(query, update, {
      sort: {
        priority: 1,
        created: 1
      },
      returnDocument: 'after'
    });

    initialize(data);

    if (data == null) {
      debug('End poll query; no jobs found');
    } else {
      debug('End poll query; found job type "%s" id "%s"', data.type, data.id);
    }

    return data;
  }

  async updateRunningJob({ id, acquired, timeout }, update) {
    await this.connected();

    if (update.unique_id == null) {
      delete update.unique_id;
    }

    const query = {
      _id: new ObjectId(id),
      status: 'running',
      acquired,
      timeout
    };

    const { value: data } = await this._jobs.findOneAndUpdate(
      query,
      { $set: update },
      { returnDocument: 'after' }
    );

    initialize(data);

    return data;
  }

  async writeJobLog(type, id, level, message) {
    await this.connected();

    const data = {
      _id: new ObjectId(),
      job_type: type,
      job_id: new ObjectId(id),
      level,
      message,
      created: new Date()
    };

    const result = await this._jobLogs.insertOne(data);

    return result != null && result.insertedCount > 0 ? data : null;
  }

  async readJobLog(id, skip = 0, limit = 100) {
    await this.connected();

    const data = await this._jobLogs
      .find(
        { job_id: new ObjectId(id) },
        {
          sort: { _id: 1 },
          skip,
          limit,
          projection: { _id: 0, level: 1, message: 1, created: 1 }
        }
      )
      .toArray();

    return data;
  }

  async writeJobResult(type, id, message) {
    await this.connected();

    const data = {
      _id: new ObjectId(id),
      job_type: type,
      message,
      created: new Date()
    };

    const result = await this._jobResults.insertOne(data);

    return result != null && result.insertedCount > 0 ? data : null;
  }

  async readJobResult(id) {
    await this.connected();

    const data = await this._jobResults.findOne({
      _id: new ObjectId(id)
    });

    return data;
  }
}

function initialize(data) {
  if (data != null && data._id != null) {
    data.id = data._id.toHexString();
  }
}

module.exports = MongodbConnector;
