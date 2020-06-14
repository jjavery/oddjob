const os = require('os');
const debug = require('debug')('oddjob:job');
const date = require('./date');
const plugins = require('./plugins');
const getNextOccurrence = require('./get-next-occurence');

const client = `${os.hostname()}[${process.pid}]`;

/** Provides access to the properties and methods needed to define a job */
class Job {
  _db;
  _data;

  /**
   * Job ID
   * @type {string}
   */
  get id() {
    return this._data.id;
  }

  /**
   * Job type
   * @type {string}
   */
  get type() {
    return this._data.type;
  }

  /**
   * Application-defined message to pass to the job handler
   * @type {any}
   */
  get message() {
    return this._data.message;
  }

  /**
   * Unique ID of the job
   * @type {string}
   */
  get unique_id() {
    return this._data.unique_id;
  }

  /**
   * Cron expression
   * @type {string}
   */
  get recurring() {
    return this._data.recurring;
  }

  /**
   * Date and time after which the job will run
   * @type {Date}
   */
  get scheduled() {
    return this._data.scheduled;
  }

  /**
   * Date and time after which the job will no longer run
   * @type {Date}
   */
  get expire() {
    return this._data.expire;
  }

  /**
   * Number of times to retry on failure
   * @type {number}
   */
  get retries() {
    return this._data.retries;
  }

  /**
   * The current number of times the job has been tried
   * @type {number}
   */
  get try() {
    return this._data.try;
  }

  /**
   * Priority of the job
   * @type {number}
   */
  get priority() {
    return this._data.priority;
  }

  /**
   * Date and time that the job was acquired (locked) by the job queue
   * @type {Date}
   */
  get acquired() {
    return this._data.acquired;
  }

  /**
   * Date and time when the job's lock will expire
   * @type {Date}
   */
  get timeout() {
    return this._data.timeout;
  }

  /**
   * Has the handler completed the job?
   * @type {boolean}
   */
  get isComplete() {
    return this._data.status === 'completed';
  }

  /**
   * Has the job's lock timed out?
   * @type {boolean}
   */
  get hasTimedOut() {
    return this._data.timeout != null && this._data.timeout <= new Date();
  }

  /**
   * Has the job expired?
   * @type {boolean}
   */
  get hasExpired() {
    return this._data.expire != null && this._data.expire <= new Date();
  }

  /**
   * Is the job eligible to be retried?
   * @type {boolean}
   */
  get canRetry() {
    return this._data.try <= this._data.retries + 1;
  }

  /**
   * @param {string} type - The job type
   * @param {Object} options={} - Optional parameters
   * @param {any} options.message - Application-defined message to pass to the job handler
   * @param {string} options.unique_id - Unique ID of the job
   * @param {string} options.recurring - Cron expression
   * @param {Date} options.scheduled=now - Date and time after which the job will run
   * @param {Date} options.expire - Date and time after which the job will no longer run
   * @param {number} options.retries=2 - Number of times to retry on failure
   * @param {number} options.priority=0 - Priority of the job
   * @param {number} options.delay=0 - Number of seconds to delay run
   */
  constructor(
    type,
    {
      message,
      unique_id,
      recurring,
      scheduled,
      expire,
      retries = 2,
      priority = 0,
      delay = 0
    } = {}
  ) {
    if (type == null) {
      throw new Error('type is required');
    }

    this._db = plugins.db;

    if (typeof type !== 'string' && type.id) {
      this._data = type;
      return;
    }

    const data = this._db.createJob();

    this._data = data;

    data.type = type;
    data.message = message;
    data.unique_id = unique_id;
    data.recurring = recurring || null;
    data.scheduled = scheduled || data.scheduled;
    if (recurring && !scheduled) {
      data.scheduled = getNextOccurrence(recurring);
    }
    if (delay) {
      const delay_scheduled = date.add(new Date(), delay, 'seconds');
      data.scheduled = date.max(data.scheduled, delay_scheduled);
    }
    data.expire = expire || null;
    data.retries = retries;
    data.priority = priority;
    data.client = client;
  }

  /**
   * Update the job's lock timeout
   * @param {number} seconds - The number of seconds to lock the job
   */
  async updateTimeout(seconds) {
    if (this.isComplete) {
      throw new Error("Can't update timeout for completed job");
    }

    if (this.hasTimedOut) {
      throw new Error("Can't update timeout for timed-out job");
    }

    const now = new Date();
    const timeout = date.add(now, seconds, 'seconds');

    const data = await this._db.updateRunningJob(job, { timeout });

    this._data = data;

    debug(
      'Job type "%s" id "%s" timeout updated to %d seconds',
      data.type,
      data.id,
      seconds
    );
  }

  /**
   * Write to the job's log
   * @param {string} level=info - The log level
   * @param {any} message - The message to log
   */
  async log(level, message) {
    if (message == null) {
      message = level;
      level = 'info';
    }

    await this._db.writeJobLog(this.id, level, message);

    debug(
      'Job type "%s" id "%s" wrote log level "%s":',
      this._data.type,
      this._data.id,
      level
    );
    debug('%j', message);
  }

  /**
   * Write to the job's log with level = "error"
   * @param {any} message - The message to log
   */
  async error(message) {
    await this.log('error', message);
  }

  /**
   * Write to the job's log with level = "warn"
   * @param {any} message - The message to log
   */
  async warn(message) {
    await this.log('warn', message);
  }

  /**
   * Write to the job's log with level = "info"
   * @param {any} message - The message to log
   */
  async info(message) {
    await this.log('info', message);
  }

  /**
   * Write to the job's log with level = "debug"
   * @param {any} message - The message to log
   */
  async debug(message) {
    await this.log('debug', message);
  }

  /**
   * Retrieve the job's log from the database
   * @param {number} skip=0 - The number of log messages to skip
   * @param {number} limit=100 - The maximum number of log messages to return
   */
  async readLog(skip = 0, limit = 100) {
    return await this._db.readJobLog(this.id, skip, limit);
  }

  /**
   * Retrieve the job's result from the database
   */
  async readResult() {
    return await this._db.readJobResult(this.id);
  }

  /**
   * Load a Job from the database using the job's ID
   * @param {string} id - Job ID of the job to be loaded
   * @returns {Job}
   */
  static async load(id) {
    debug('Begin load job id "%s"', id);

    const data = await this._db.findJobById(id);

    debug('End load job type "%s" id "%s"', data.type, data.id);

    return new Job(data);
  }

  async _save() {
    debug('Begin save job type "%s" id "%s"', this._data.type, this._data.id);

    await this._data.save();

    debug('End save job type "%s" id "%s"', this._data.type, this._data.id);
  }

  async _complete(result) {
    if (this.isComplete) {
      throw new Error('Job has already been completed');
    }

    if (this.hasTimedOut) {
      throw new Error("Can't complete timed-out job");
    }

    const now = new Date();
    const _id = this._data._id;
    const stopwatches = {
      waiting:
        this.acquired && this.scheduled
          ? this.acquired.getTime() - this.scheduled.getTime()
          : null,
      running: this.acquired ? now.getTime() - this.acquired.getTime() : null,
      completed: this.scheduled
        ? now.getTime() - this.scheduled.getTime()
        : null
    };

    const update = {
      timeout: null,
      modified: now,
      stopwatches
    };

    if (this.recurring) {
      Object.assign(update, {
        status: 'waiting',
        scheduled: getNextOccurrence(this.recurring),
        acquired: null,
        try: 0
      });
    } else {
      Object.assign(update, {
        status: 'completed',
        completed: now
      });
    }

    const data = await this._db.updateRunningJob(job, update);

    this._data = data;

    if (result != null) {
      await this._db.writeJobResult(this.id, result);
    }

    debug(
      'Job type "%s" id "%s" completed in %dms with result:',
      data.type,
      data.id,
      stopwatches.running
    );
    debug('%j', result);
  }

  async _expire() {
    const now = new Date();

    const update = {
      status: 'expired',
      completed: now,
      modified: now
    };

    const data = await this._db.updateJobById(this.id, update);

    this._data = data;

    debug(
      'Job type "%s" id "%s" timeout extended by %d seconds',
      data.type,
      data.id,
      seconds
    );
  }

  async _fail() {
    const now = new Date();

    const update = {
      status: 'failed',
      modified: now,
      try: this._data.try - 1
    };

    if (this.recurring) {
      Object.assign(update, {
        scheduled: getNextOccurrence(this.recurring),
        acquired: null,
        timeout: null,
        try: 0
      });
    }

    const data = await this._db.updateJobById(this.id, update);

    this._data = data;

    debug('Job type "%s" id "%s" failed', data.type, data.id);
  }
}

module.exports = Job;
