const os = require('os');
const EventEmitter = require('events');
const debug = require('debug')('oddjob');
const { ConnectionString } = require('connection-string');
const dayjs = require('dayjs');
const WorkerPool = require('@jjavery/worker-pool');
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
  _handlers = {};
  _timer = null;
  _looping = false;
  _running = 0;
  _runningJobs = {};

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
   * @param {Object[]} options.workerPools -
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
      workerPools,
      connectOptions
    } = {}
  ) {
    super();

    if (uri == null) {
      throw new Error('Connection uri is required');
    }

    // Parse the connection uri,
    const { protocol } = new ConnectionString(uri);

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

    this._connected = false;

    await this._db.disconnect();

    debug('Disconnected');

    this.emit('disconnect');
  }

  /**
   * Push a job into the job queue
   * @param {Job} job - The job to push into the queue
   */
  async push(job) {
    job._set_db(this._db);

    await job._save();

    debug('Pushed new job type "%s" id "%s"', job.type, job.id);

    this.emit('push', job);
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

    if (this._handlers[type] != null) {
      throw new Error(`A handler for type ${type} already exists`);
    }

    const concurrency = options?.concurrency || 1;

    const handler = { type, fn, concurrency, running: 0 };

    this._handlers[type] = handler;

    debug('Added a handler for type "%s"', type);
    debug('Handler Count: %d', Object.keys(this._handlers).length);

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
    if (disconnect) {
      // setImmediate(() => {
        this.disconnect().catch((err) => {
          this.emit('error', err);
        });
      // });
    }

    if (!this._looping) {
      return;
    }

    this._looping = false;

    clearTimeout(this._timer);
    this._timer = null;

    if (!disconnect) {
      debug_loop('Paused looping');

      this.emit('pause');
    } else {
      debug_loop('Stopped looping');

      this.emit('stop');
    }
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
            this._run(job);
          }
        }
      } catch (err) {
        this.emit('error', err);
      }
    }

    // If one job was found in the queue, there might be more, so don't sleep
    // long. If the queue is empty, can take a longer nap.
    const sleep = job ? this.activeSleep : this.idleSleep;

    debug_loop('End loop');

    debug_loop('Sleeping for %dms', sleep);

    // Keep a reference to the timer so it can be canceled with .pause() or .stop()
    this._timer = setTimeout(this._loop.bind(this), sleep);
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

    const job = new Job(data, { _db: this._db });

    debug_poll('End poll');

    return job;
  }

  /**
   * Run a job
   * @param {Job} job
   * @private
   */
  _run(job) {
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

    const handlerPromise = handler.fn(job, runningJob.onCancel);

    if (handlerPromise == null || typeof handlerPromise.then !== 'function') {
      throw new Error('Handler function must return a promise');
    }

    handlerPromise
      .catch((err) => {
        debug_run(
          'Error while running job type "%s" id "%s"',
          job.type,
          job.id
        );
        if (err?.message) {
          debug_run('Error: %s', err.message);
        }

        this.emit('handlerError', err);

        return job.error(err);
      })
      .then((result) => {
        if (runningJob.canceled) {
          debug_run(
            'Job type "%s" id "%s" timed out and this run was canceled',
            job.type,
            job.id
          );
          return;
        }

        return job._complete(result);
      })
      .catch((err) => {
        debug_run(
          'Error while completing job type "%s" id "%s"',
          job.type,
          job.id
        );
        if (err?.message) {
          debug_run('Error: %s', err.message);
        }

        this.emit('error', err);
      })
      .finally(() => {
        // Remove the job from the list of currently running jobs
        this._removeRunningJob(job);

        // Decrement counts of currently running jobs for the job queue and handler
        this._running--;
        handler.running--;

        debug_run('End run job type "%s" id "%s"', job.type, job.id);

        this.emit('afterRun', job);
      });
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

    this._runningJobs[job.id] = runningJob;

    return runningJob;
  }

  /**
   * Removes a job from the list of currently running jobs
   * @param {Job} job - The job to remove from the list of running jobs
   * @private
   */
  _removeRunningJob(job) {
    delete this._runningJobs[job.id];
  }

  /**
   * Cancels any running jobs that have timed out
   * @private
   */
  _cancelTimedOutJobs() {
    const runningJobs = this._runningJobs;
    const keys = Object.keys(runningJobs);

    for (let key of keys) {
      const { job, canceled } = runningJobs[key];

      if (canceled || !job.hasTimedOut) {
        continue;
      }

      this._cancelRunningJob(job);

      this.emit('timeout', job);
    }
  }

  /**
   * Cancels a currently running job by calling any listeners its handler has added via the onCancel function
   * @param {Job} job - The job to cancel
   * @private
   */
  _cancelRunningJob(job) {
    const runningJob = this._runningJobs[job.id];

    if (runningJob.canceled) {
      return;
    }

    const { cancelListeners } = runningJob;

    for (let cancelListener of cancelListeners) {
      try {
        cancelListener();
      } catch (err) {
        emit('error', err);
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
    return this._handlers[type];
  }

  /**
   * Gets a list of types that are runnable, meaning they have not reached their concurrency limit
   * @returns {string[]} Array of type names
   * @private
   */
  _getRunnableTypes() {
    const types = [];

    const handlers = this._handlers;
    const keys = Object.keys(handlers);

    for (let key of keys) {
      const handler = handlers[key];
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
