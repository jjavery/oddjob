const path = require('path');
const debug = require('debug')('oddjob:sqlite');
const uuid = require('uuid');
const knex = require('knex');
const { ConnectionString } = require('connection-string');

class SqliteConnector {
  _client;
  _jobsTableName;
  _jobLogsTableName;
  _jobResultsTableName;
  _connecting = null;
  _schemaCreated = false;

  constructor(uri, options = {}) {
    options = Object.assign({}, options);

    const {
      jobsTableName = 'jobs',
      jobLogsTableName = 'job_logs',
      jobResultsTableName = 'job_results'
    } = options;

    this._jobsTableName = jobsTableName;
    this._jobLogsTableName = jobLogsTableName;
    this._jobResultsTableName = jobResultsTableName;

    delete options.jobsTableName;
    delete options.jobLogsTableName;
    delete options.jobResultsTableName;

    const connectionString = new ConnectionString(uri);

    const filename = path.join('/', ...connectionString.path);

    this._client = knex({
      client: 'sqlite3',
      connection: {
        filename
      },
      useNullAsDefault: true,
      pool: {
        afterCreate: (connection, callback) =>
          connection.run('PRAGMA foreign_keys = ON', callback)
      }
    });
  }

  async connect() {
    let connecting = this._connecting;

    if (connecting == null) {
      connecting = this._connecting = this.ensureSchema();
    }

    await connecting;

    this._connecting = null;
  }

  async connected() {
    return this._connecting != null ? this._connecting : Promise.resolve();
  }

  async disconnect() {
    await this.connected();

    this._client.destroy();
  }

  async ensureSchema() {
    if (this._schemaCreated) {
      return;
    }

    this._schemaCreated = true;

    const client = this._client;
    const jobsTableName = this._jobsTableName;
    const jobLogsTableName = this._jobLogsTableName;
    const jobResultsTableName = this._jobResultsTableName;

    if (!(await client.schema.hasTable(jobsTableName))) {
      await client.schema.createTable(jobsTableName, (table) => {
        table.uuid('id').primary();
        table.string('type', 256).notNullable();
        table.string('unique_id', 256);
        table.string('client', 256);
        table.string('worker', 256);
        table.string('recurring', 4096);
        table.string('timezone', 32).defaultTo('UTC');
        table.string('status', 16).defaultTo('waiting');
        table.integer('retries').defaultTo(3);
        table.integer('try').defaultTo(0);
        table.integer('priority').defaultTo(0);
        table.json('stopwatches');
        table.json('message');
        table.dateTime('scheduled').notNullable();
        table.dateTime('acquired').nullable();
        table.dateTime('timeout').nullable();
        table.dateTime('expire').nullable();
        table.dateTime('completed').nullable();
        table.dateTime('created').notNullable();
        table.dateTime('modified').notNullable();
        table.unique(['unique_id']);
        table.index(['status', 'scheduled', 'timeout', 'priority', 'created']);
        table.index(['type', 'created']);
        table.index(['created']);
        table.index(['completed']);
      });
    }

    if (!(await client.schema.hasTable(jobLogsTableName))) {
      await client.schema.createTable(jobLogsTableName, (table) => {
        table.uuid('id').primary();
        table
          .uuid('job_id')
          .references('id')
          .inTable('jobs')
          .onDelete('CASCADE');
        table.string('level', 8).notNullable();
        table.json('message');
        table.dateTime('created').notNullable();
        table.index(['job_id']);
        table.index(['created']);
      });
    }

    if (!(await client.schema.hasTable(jobResultsTableName))) {
      await client.schema.createTable(jobResultsTableName, (table) => {
        table
          .uuid('id')
          .primary()
          .references('id')
          .inTable('jobs')
          .onDelete('CASCADE');
        table.json('message');
        table.dateTime('created').notNullable();
        table.index(['created']);
      });
    }
  }

  createJob(data = {}) {
    const now = new Date();

    const job = Object.assign(
      {
        id: uuid.v4(),
        timezone: 'UTC',
        status: 'waiting',
        retries: 3,
        try: 0,
        priority: 0,
        scheduled: now,
        created: now,
        modified: now
      },
      data
    );

    return job;
  }

  async saveJob(job) {
    await this.connected();

    if (job.id == null) {
      job = this.createJob(job);
    }

    // if (job.unique_id == null) {
    //   delete job.unique_id;
    // }

    const client = this._client;
    const jobsTableName = this._jobsTableName;

    await client(jobsTableName).insert(job);

    const data = Object.assign({}, job);

    return data;
  }

  async findJobById(id) {
    await this.connected();

    const client = this._client;
    const jobsTableName = this._jobsTableName;

    const result = await client(jobsTableName).where({
      id
    });

    if (result == null || result.length !== 1) {
      return null;
    }

    const data = result[0];

    initialize(data);

    return data;
  }

  async updateJobById(id, update) {
    await this.connected();

    // if (update.unique_id == null) {
    //   delete update.unique_id;
    // }

    const client = this._client;
    const jobsTableName = this._jobsTableName;

    const count = await client(jobsTableName).where({ id }).update(update);

    if (count == null || count === 0) {
      return null;
    }

    const result = await client(jobsTableName).where({ id });

    let data = null;

    if (result != null && result.length === 1) {
      data = result[0];

      initialize(data);
    }

    return data;
  }

  async pollForRunnableJob(types, timeout, worker) {
    await this.connected();

    const now = new Date();

    const query = (query) => {
      query.whereIn('type', types).where((query) => {
        query
          // waiting and scheduled to run
          .where((query) => {
            query
              .where('status', 'waiting')
              .where('scheduled', '<=', now)
              .whereNull('timeout');
          })
          // was running and lock timed out
          .orWhere((query) => {
            query
              .where('status', 'running')
              .where('scheduled', '<=', now)
              .where('timeout', '<=', now);
          })
          // recurring and failed
          .orWhere((query) => {
            query
              .whereNotNull('recurring')
              .where('status', 'failed')
              .where('scheduled', '<=', now)
              .whereNull('timeout');
          });
      });
    };

    const update = {
      status: 'running',
      acquired: now,
      timeout,
      worker,
      modified: now
    };

    debug('Begin poll query %j', query);

    const client = this._client;
    const jobsTableName = this._jobsTableName;

    // Get a candidate
    const result = await client(jobsTableName)
      .where(query)
      .orderBy([
        { column: 'priority', order: 'desc' },
        { column: 'created', order: 'asc' }
      ])
      .limit(1);

    let data = null;

    if (result != null && result.length === 1) {
      data = result[0];

      initialize(data);

      // Attempt to update the candidate
      const count = await client(jobsTableName)
        .where('id', data.id)
        .where('modified', data.modified)
        .where(query)
        .update(update)
        .increment('try', 1);

      // Also update the local copy
      Object.assign(data, update);

      // If update count is zero then another update got to it first
      if (count == null || count === 0) {
        data = null;
      }
    }

    if (data == null) {
      debug('End poll query; no jobs found');
    } else {
      debug('End poll query; found job type "%s" id "%s"', data.type, data.id);
    }

    return data;
  }

  async updateRunningJob({ id, acquired, timeout }, update) {
    await this.connected();

    // if (update.unique_id == null) {
    //   delete update.unique_id;
    // }

    const query = (query) => {
      query
        .where('id', id)
        .where('status', 'running')
        .where('acquired', acquired)
        .where('timeout', timeout);
    };

    const client = this._client;
    const jobsTableName = this._jobsTableName;

    const count = await client(jobsTableName).where(query).update(update);

    if (count == null || count === 0) {
      return null;
    }

    const result = await client(jobsTableName).where({ id });

    let data = null;

    if (result != null && result.length === 1) {
      data = result[0];

      initialize(data);
    }

    return data;
  }

  async writeJobLog(id, level, message) {
    await this.connected();

    const data = {
      id: uuid.v4(),
      job_id: id,
      level,
      message,
      created: new Date()
    };

    const client = this._client;
    const jobLogsTableName = this._jobLogsTableName;

    const result = await client(jobLogsTableName).insert(data);

    return result != null && result.length > 0 ? data : null;
  }

  async readJobLog(id, skip = 0, limit = 100) {
    await this.connected();

    const client = this._client;
    const jobLogsTableName = this._jobLogsTableName;

    const data = await client(jobLogsTableName)
      .where('job_id', id)
      .select(['id', 'level', 'message', 'created'])
      .orderBy([{ column: 'created', order: 'asc' }])
      .offset(skip)
      .limit(limit);

    for (let i = 0; i < data.length; ++i) {
      data[i].created = new Date(data[i].created);
    }

    return data;
  }

  async writeJobResult(id, message) {
    await this.connected();

    const data = {
      id: id,
      message,
      created: new Date()
    };

    const client = this._client;
    const jobResultsTableName = this._jobResultsTableName;

    const result = await client(jobResultsTableName).insert(data);

    return result != null && result.length > 0 ? data : null;
  }

  async readJobResult(id) {
    await this.connected();

    const client = this._client;
    const jobResultsTableName = this._jobResultsTableName;

    const result = await client(jobResultsTableName).where('id', id);

    if (result != null && result.length > 0) {
      result[0].created = new Date(result[0].created);

      return result[0];
    } else {
      return null;
    }
  }
}

function initialize(data) {
  data.scheduled = data.scheduled ? new Date(data.scheduled) : null;
  data.acquired = data.acquired ? new Date(data.acquired) : null;
  data.timeout = data.timeout ? new Date(data.timeout) : null;
  data.expire = data.expire ? new Date(data.expire) : null;
  data.completed = data.completed ? new Date(data.completed) : null;
  data.created = data.created ? new Date(data.created) : null;
  data.modified = data.modified ? new Date(data.modified) : null;
}

module.exports = SqliteConnector;
