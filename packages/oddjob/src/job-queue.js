const os = require('os');
const EventEmitter = require('events');
const debug = require('debug')('oddjob');
const dayjs = require('dayjs');
const Job = require('./job');

const debug_loop = debug.extend('loop');
const debug_poll = debug.extend('poll');
const debug_run = debug.extend('run');

const worker = `${os.hostname()}[${process.pid}]`;

/**
 * Provides access to a job queue
 * @extends EventEmitter
 */
class JobQueue extends EventEmitter {
  /**
   * Emitted when an error is thrown in the constructor or run loop.
   * @event JobQueue#error
   * @type {Error} - The error object that was thrown.
   */

  /**
   * Emitted when an error is thrown by a handler.
   * @event JobQueue#handlerError
   * @type {Error} - The error object that was thrown.
   */

  /**
   * Emitted when the job queue is connected to the database.
   * @event JobQueue#connect
   */

  /**
   * Emitted when the job queue has disconnected from the database.
   * @event JobQueue#disconnect
   */

  /**
   * Emitted when a job has been pushed into the job queue.
   * @event JobQueue#push
   * @type {Job} - Job that was pushed.
   */

  /**
   * Emitted when a job has been passed to a handler.
   * @event JobQueue#handle
   * @type {Object} - Object that describes the handler
   */

  /**
   * Emitted when the job queue starts its run loop.
   * @event JobQueue#start
   */

  /**
   * Emitted when the job queue pauses its run loop.
   * @event JobQueue#pause
   */

  /**
   * Emitted when the job queue stops its run loop.
   * @event JobQueue#stop
   */

  /**
   * Emitted before a job runs.
   * @event JobQueue#beforeRun
   * @type {Job} - Job that is running.
   */

  /**
   * Emitted after a job runs.
   * @event JobQueue#afterRun
   * @type {Job} - Job that is running.
   */

  /**
   * Emitted when a job times out and is canceled.
   * @event JobQueue#timeout
   * @type {Job} - Job that timed out.
   */

  /**
   * Emitted when a job is canceled.
   * @event JobQueue#cancel
   * @type {Job} - Job that was canceled.
   */

  /**
   * Maximum number of jobs that may run concurrently
   * @type {number}
   */
  concurrency;

  /**
   * Seconds to wait before a running job is considered timed-out and eligible for retry or failure
   * @type {number}
   */
  timeout;

  /**
   * Milliseconds to sleep after completing a run loop when no jobs are acquired
   * @type {number}
   */
  idleSleep;

  /**
   * Milliseconds to sleep after completing a run loop when a job is acquired
   * @type {number}
   */
  activeSleep;

  _db;
  _connected = false;
  _handlers = new Map();
  _timer = null;
  _looping = false;
  _running = 0;
  _runningJobs = new Map();
  _workers = new Map();

  /**
   * Number of jobs that are currently running
   * @type {number}
   */
  get running() {
    return this._running;
  }

  /**
   * Whether the number of jobs currently running is equal to the maximum concurrency
   * @type {boolean}
   */
  get isSaturated() {
    return this._running >= this.concurrency;
  }

  /**
   * @param
   * @param {Object} options={} - Optional parameters
   * @param {number} options.concurrency=10 - Maximum number of jobs that may run concurrently
   * @param {number} options.timeout=60 - Seconds to wait before a running job is considered timed-out and eligible for retry or failure
   * @param {number} options.idleSleep=1000 - Milliseconds to sleep after completing a run loop when no jobs are acquired
   * @param {number} options.activeSleep=10 - Milliseconds to sleep after completing a run loop when a job is acquired
   * @param {boolean} options.connect=true - Whether to connect to the database immediately
   * @param {Object} options.connectOptions - Options to pass along to the database connector
   */
  constructor(
    uri,
    {
      concurrency = 10,
      timeout = 60,
      idleSleep = 1000,
      activeSleep = 10,
      connect = true,
      connectOptions
    } = {}
  ) {
    super();

    if (uri == null) {
      throw new Error('Connection URI is required');
    }

    // Parse the connection uri,
    const matches = uri.match(/^[^:+]+/);

    if (matches.length !== 1) {
      throw new Error('Invalid connection URI');
    }

    const protocol = matches[0];

    let Connector;

    try {
      Connector = require(`@jjavery/oddjob-${protocol}`);
    } catch {}

    if (Connector == null) {
      try {
        Connector = require(`oddjob-${protocol}`);
      } catch {}
    }

    if (Connector == null) {
      try {
        Connector = require(`../../oddjob-${protocol}`);
      } catch {
        throw new Error(
          `Couldn't find an oddjob package suitable for ${protocol}. Did you forget to install one?`
        );
      }
    }

    this._db = new Connector(uri, connectOptions);
    this.concurrency = concurrency;
    this.timeout = timeout;
    this.idleSleep = idleSleep;
    this.activeSleep = activeSleep;

    if (connect) {
      this.connect().catch((err) => {
        this.emit('error', err);
      });
    }

    const timer = setInterval(() => this._cancelTimedOutJobs(), 1000);
    timer.unref();
  }

  /**
   * Establish a connection to the database server
   */
  async connect() {
    if (this._connected) {
      return;
    }

    this._connected = true;

    await this._db.connect();

    debug('Connected');

    this.emit('connect');
  }

  /**
   * Disconnect from the database server
   */
  async disconnect() {
    if (!this._connected) {
      return;
    }

    // Tell all the running jobs to cancel
    this._cancelAllRunningJobs();

    // Wait for all running jobs to complete
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (this.running > 0) {
          return;
        }

        clearInterval(timer);

        resolve();
      }, 100);
    });

    this._connected = false;

    await this._db.disconnect();

    debug('Disconnected');

    this.emit('disconnect');
  }

  /**
   * Push a job into the job queue
   * @param {Job} job - The job to push into the queue
   * @returns {boolean} - Returns true if a new job was pushed, or false if the job already exists (based on id or unique_id)
   */
  async push(job) {
    job._set_db(this._db);

    const pushed = await job._save();

    if (pushed) {
      debug(
        'Pushed new job type "%s" id "%s" unique_id "%s"',
        job.type,
        job.id,
        job.unique_id
      );

      this.emit('push', job);
    } else {
      debug(
        'Did not push job type "%s" id "%s" unique_id "%s" because it already exists',
        job.type,
        job.id,
        job.unique_id
      );
    }

    return pushed;
  }

  /**
   * Creates a proxy function that will push a new job when called
   * @param {string} type - The job type. Only jobs of this type will be passed to the handle function.
   * @param {Object} defaultOptions={} - Optional parameters sent to each Job constructor
   * @returns {function}
   */
  proxy(type, defaultOptions = {}) {
    return async (message, options = {}) => {
      const job = new Job(type, message, { ...defaultOptions, ...options });

      return this.push(job);
    };
  }

  /**
   * Cancel a job if it exists in the job queue.
   * Must provide one id or unique_id param. If both are provided, id is used
   * and unique_id is ignored.
   * @param {*} options={} - Optional parameters
   * @param {*} options.id - ID of job to cancel
   * @param {*} options.unique_id - Unique ID of job to cancel
   * @returns {Job}
   */
  async cancel({ id, unique_id }) {
    if (id == null && unique_id == null) {
      throw new Error('id or unique_id param is required');
    }

    const data = await this._db.cancelJob(id, unique_id);

    if (data == null) {
      return;
    }

    const job = new Job(data, null, { _db: this._db });

    this.emit('cancel', job);

    return job;
  }

  /**
   * Configure the job queue to handle jobs of a particular type
   * @param {string} type - The job type. Only jobs of this type will be passed to the handle function.
   * @param {Object} options={} - Optional parameters
   * @param {number} options.concurrency=1 - Maximum number of jobs that this handler may run concurrently
   * @param {Function} fn - An async function that takes a single job as its parameter
   */
  handle(type, options, fn) {
    if (fn == null) {
      fn = options;
      options = null;
    }

    if (this._handlers.has(type)) {
      throw new Error(`A handler for type ${type} already exists`);
    }

    const concurrency = options?.concurrency || 1;

    const handler = { type, fn, concurrency, running: 0 };

    this._handlers.set(type, handler);

    debug('Added a handler for type "%s"', type);
    debug('Handler Count: %d', this._handlers.length);

    this.emit('handle', handler);
  }

  /**
   * Starts the job queue
   */
  start() {
    if (this._looping) {
      return;
    }

    debug_loop('Started looping');

    this.emit('start');

    this._looping = true;

    this._loop().catch((err) => {
      this.emit('error', err);
    });
  }

  /**
   * Pauses the job queue
   */
  pause() {
    this.stop(false);
  }

  /**
   * Stops the job queue
   */
  stop(disconnect = true) {
    this._stop();

    if (disconnect) {
      this.disconnect().catch((err) => {
        this.emit('error', err);
      });

      debug_loop('Stopped looping');

      this.emit('stop');
    } else {
      debug_loop('Paused looping');

      this.emit('pause');
    }
  }

  /**
   * Stop looping
   * @private
   */
  _stop() {
    if (!this._looping) {
      return;
    }

    this._looping = false;

    clearTimeout(this._timer);
    this._timer = null;
  }

  /**
   * The run loop
   * @private
   */
  async _loop() {
    debug_loop('Begin loop');
    debug_loop('Running Count: %d', this._running);

    let job;

    // Get the types that are currently runnable
    const types = this._getRunnableTypes();

    if (this.isSaturated) {
      debug_loop(
        'Not polling; reached maximum concurrency: %d',
        this.concurrency
      );
    } else if (types.length === 0) {
      debug_loop('Not polling; no runnable types');
    } else {
      try {
        // Poll for a job
        job = await this._poll(types);

        if (job) {
          if (job.hasExpired) {
            // Housekeeping: expire jobs that have expired
            await job._expire();

            debug_loop('Updated expired job');
          } else if (!job.canRetry) {
            // Housekeeping: fail jobs that can't be retried
            await job._fail();

            debug_loop('Updated failed job');
          } else {
            // Found a job? Run it
            await this._run(job);
          }
        }
      } catch (err) {
        this.emit('error', err);
      }
    }

    // If one job was found in the queue, there might be more, so don't sleep
    // long. If the queue is empty, can take a longer nap.
    const sleep = job != null ? this.activeSleep : this.idleSleep;

    debug_loop('End loop');

    // Did looping stop while this loop was running? If so, don't start another
    // loop.
    if (!this._looping) {
      return;
    }

    debug_loop('Sleeping for %dms', sleep);

    if (sleep === 0) {
      // setImmediate gives a tighter loop than setTimeout
      setImmediate(() => this._loop());
    } else {
      debug_loop('Sleeping for %dms', sleep);

      // Keep a reference to the timer so it can be canceled with .pause() or .stop()
      this._timer = setTimeout(() => this._loop(), sleep);
    }
  }

  /**
   * Poll for a job to run
   * @param {string[]} types - An array of job types to poll for
   * @returns {Job|undefined} A job with the 'waiting' status, ready to be run, or undefined if no jobs are waiting
   * @private
   */
  async _poll(types) {
    debug_poll('Begin poll');

    // Get the future date and time when the lock will time out
    const timeout = dayjs().add(this.timeout, 'seconds').toDate();

    const data = await this._db.pollForRunnableJob(types, timeout, worker);

    if (!data) {
      debug_poll('End poll; no jobs found');
      return;
    }

    const job = new Job(data, null, { _db: this._db });

    debug_poll('End poll');

    return job;
  }

  /**
   * Run a job
   * @param {Job} job
   * @private
   */
  async _run(job) {
    debug_run('Begin run job type "%s" id "%s"', job.type, job.id);

    this.emit('beforeRun', job);

    // Get the handler for this job type
    const handler = this._getHandler(job.type);

    // Increment counts of currently running jobs for the job queue and handler
    this._running++;
    handler.running++;

    // Add the job to the list of currently running jobs
    const runningJob = this._addRunningJob(job);

    debug_run('Type "%s" Running Count: %d', job.type, handler.running);

    try {
      let result;

      try {
        result = await Promise.resolve(handler.fn(job, runningJob.onCancel));
      } catch (err) {
        debug_run(
          'Error while running job type "%s" id "%s"',
          job.type,
          job.id
        );
        if (err?.message) {
          debug_run('Error: %s', err.message);
        }

        this.emit('handlerError', err);

        await job._error(err);
      }

      if (runningJob.canceled) {
        debug_run(
          'Job type "%s" id "%s" timed out and this run was canceled',
          job.type,
          job.id
        );
      } else if (job.hasError) {
        debug_run(
          'Job type "%s" id "%s" threw an error and did not complete',
          job.type,
          job.id
        );
      } else {
        await job._complete(result);
      }
    } catch (err) {
      debug_run(
        'Error while completing job type "%s" id "%s"',
        job.type,
        job.id
      );
      if (err?.message) {
        debug_run('Error: %s', err.message);
      }

      this.emit('error', err);
    } finally {
      // Remove the job from the list of currently running jobs
      this._removeRunningJob(job);

      // Decrement counts of currently running jobs for the job queue and handler
      this._running--;
      handler.running--;

      debug_run('End run job type "%s" id "%s"', job.type, job.id);

      this.emit('afterRun', job);
    }
  }

  /**
   * Adds a job to the list of currently running jobs and returns an object with an onCancel function to be passed to the job's handler. Handlers can use the onCancel function to register listeners for the cancel event. Job handlers are canceled if they don't complete before the timeout.
   *
   * @param {Job} job - The job to add to the list of running jobs
   * @returns {Object} - An object that describes the running job
   * @private
   */
  _addRunningJob(job) {
    const cancelListeners = [];

    const onCancel = (listener) => {
      if (typeof listener !== 'function') {
        throw new Error('listener must be a function');
      }
      cancelListeners.push(listener);
    };

    const runningJob = { job, cancelListeners, canceled: false, onCancel };

    this._runningJobs.set(job.id, runningJob);

    return runningJob;
  }

  /**
   * Removes a job from the list of currently running jobs
   * @param {Job} job - The job to remove from the list of running jobs
   * @private
   */
  _removeRunningJob(job) {
    this._runningJobs.delete(job.id);
  }

  /**
   * Cancels any running jobs that have timed out
   * @private
   */
  _cancelTimedOutJobs() {
    for (let [key, { job, canceled }] of this._runningJobs) {
      if (canceled || !job.hasTimedOut) {
        continue;
      }

      this._cancelRunningJob(job);

      this.emit('timeout', job);
    }
  }

  /**
   * Cancels all running jobs
   * @private
   */
  _cancelAllRunningJobs() {
    for (let [key, { job }] of this._runningJobs) {
      this._cancelRunningJob(job);
    }
  }

  /**
   * Cancels a currently running job by calling any listeners its handler has added via the onCancel function
   * @param {Job} job - The job to cancel
   * @private
   */
  _cancelRunningJob(job) {
    const runningJob = this._runningJobs.get(job.id);

    if (runningJob.canceled) {
      return;
    }

    const { cancelListeners } = runningJob;

    for (let cancelListener of cancelListeners) {
      try {
        cancelListener();
      } catch (err) {
        this.emit('error', err);
      }
    }

    runningJob.canceled = true;
  }

  /**
   * Gets a handler by type
   * @param {string} type - The type of the handler to get
   * @private
   */
  _getHandler(type) {
    return this._handlers.get(type);
  }

  /**
   * Gets a list of types that are runnable, meaning they have not reached their concurrency limit
   * @returns {string[]} Array of type names
   * @private
   */
  _getRunnableTypes() {
    const types = [];

    for (let [key, handler] of this._handlers) {
      if (handler.running < handler.concurrency) {
        types.push(key);
      }
    }

    return types;
  }

  /**
   * https://nodejs.org/api/events.html#events_emitter_once_eventname_listener
   * @function JobQueue#once
   * @param {string|symbol} eventName - The name of the event.
   * @param {Function} listener - The callback function.
   * @returns {EventEmitter}
   */

  /**
   * https://nodejs.org/api/events.html#events_emitter_on_eventname_listener
   * @function JobQueue#on
   * @param {string|symbol} eventName - The name of the event.
   * @param {Function} listener - The callback function.
   * @returns {EventEmitter}
   */

  /**
   * https://nodejs.org/api/events.html#events_emitter_off_eventname_listener
   * @function JobQueue#off
   * @param {string|symbol} eventName - The name of the event.
   * @param {Function} listener - The callback function.
   * @returns {EventEmitter}
   */
}

module.exports = JobQueue;
