# oddjob

A job queue for Node.js applications

_Why use a job queue?_ If your application needs to reliably complete units of work without blocking request handlers or API calls, you might benefit from a job queue.

_Why use oddjob?_ If your stack already includes Node.js and MongoDB or one of the other supported data access layers, then oddjob might be a good fit for your solution.

## Features

- **Distributed** - Multiple worker processes can run from the same job queue, and multiple clients can push jobs to the same job queue.
- **Concurrency** - A worker process can run multiple jobs simultaneously.
- **Persistence** - Jobs will run at least once (except jobs that expire prior to being run).
- **Idempotency** - Jobs can be set to run no more than once, even if multiple clients attempt to push the same job into the queue.
- **Recurrences** - Jobs can be set to run on multiple dates and times using cron expressions.
- **Schedule** - Jobs can be scheduled to run no sooner than a specific date and time.
- **Expiration** - Jobs can be scheduled to run no later than a specific date and time.
- **Delay** - Jobs can set to run after a time delay.
- **Retries** - A failed job can be retried a limited number of times.
- **Locking** - A job queue will lock jobs prior to running them. Jobs that do not complete prior to the lock timeout can be re-run. A worker can update a job's lock to continue to hold it past its initial timeout.
- **Priority** - Jobs can be set to run before other jobs (that are eligible to be run).
- **Messages** - An application-defined message can be included with each job.
- **Logging** - Workers can write log messages to a job's log stream.
- **Results** - Workers can return a result to store with a job.
- **Types** - Support for multiple job types in the same job queue.
- **Events** - Job queues are event emitters and emit events when various actions occur.
- **Promises** - Promise-based API (async/await).
- **Metadata** - Jobs record the hostname &amp; PID of clients and workers, and the timing of job events.
- **Plugins** - Pluggable data access layer for various database systems (MongoDB, SQLite, etc.)

## Installation

Install with NPM

```shell
$ npm install @jjavery/oddjob
$ npm install @jjavery/oddjob-mongodb # or oddjob-sqlite etc.
```

You will also need a compatible database server to store your jobs, logs, results, etc.

## Example

### worker.js:

```javascript
// Get a reference to the JobQueue class
const { JobQueue } = require('@jjavery/oddjob');

// A module that sends emails
const email = require('./email');

// Create an instance of a JobQueue. Connects to localhost by default.
const jobQueue = new JobQueue();

// Tell the JobQueue to handle jobs of type 'send-email' with the provided
// async function. Concurrency is set to handle up to four jobs of this type
// simultaneously.
jobQueue.handle('send-email', { concurrency: 4 }, async (job) => {
  const { message } = job;

  // Send the email. If an exception is thrown, it will be written to the job
  // log for this job.
  const result = await email.send(message);

  // Write to the job log for this job
  job.log(`Email sent`);

  // Return the result. The return value, if any, will be stored with the job.
  return result;
});

// Handle errors
jobQueue.on('error', (err) => {
  console.log(err);
});

// Start the JobQueue
jobQueue.start();
```

### client.js:

```javascript
// Get references to the JobQueue and Job classes
const { JobQueue, Job } = require('@jjavery/oddjob');

// Create an instance of a JobQueue. Connects to localhost by default.
const jobQueue = new JobQueue();

(async () => {
  // Push a new Job into the JobQueue
  await jobQueue.push(
    new Job('send-email', {
      message: {
        from: 'someone@example.com',
        to: 'someoneelse@example.com',
        subject: 'This is an example',
        text: 'Hi Someone, How do you like my example? -Someone Else'
      }
    })
  );

  // Disconnect from the database
  await jobQueue.disconnect();
})();
```

# API Reference


## JobQueue ⇐ EventEmitter
Provides access to a job queue

**Extends**: EventEmitter  

* [JobQueue](#markdown-header-jobqueue-eventemitter) ⇐ EventEmitter
    * [new JobQueue(options)](#markdown-header-new-jobqueueoptions)
    * [.concurrency](#markdown-header-jobqueueconcurrency-number) : number
    * [.timeout](#markdown-header-jobqueuetimeout-number) : number
    * [.idleSleep](#markdown-header-jobqueueidlesleep-number) : number
    * [.activeSleep](#markdown-header-jobqueueactivesleep-number) : number
    * [.running](#markdown-header-jobqueuerunning-number) : number
    * [.isSaturated](#markdown-header-jobqueueissaturated-boolean) : boolean
    * [.connect()](#markdown-header-jobqueueconnect)
    * [.disconnect()](#markdown-header-jobqueuedisconnect)
    * [.push(job)](#markdown-header-jobqueuepushjob)
    * [.handle(type, options, fn)](#markdown-header-jobqueuehandletype-options-fn)
    * [.start()](#markdown-header-jobqueuestart)
    * [.pause()](#markdown-header-jobqueuepause)
    * [.stop()](#markdown-header-jobqueuestop)
    * ["error"](#markdown-header-error)
    * ["handlerError"](#markdown-header-handlererror)
    * ["connect"](#markdown-header-connect)
    * ["disconnect"](#markdown-header-disconnect)
    * ["push"](#markdown-header-push)
    * ["handle"](#markdown-header-handle)
    * ["start"](#markdown-header-start)
    * ["pause"](#markdown-header-pause)
    * ["stop"](#markdown-header-stop)
    * ["beforeRun"](#markdown-header-beforerun)
    * ["afterRun"](#markdown-header-afterrun)
    * ["timeout"](#markdown-header-timeout)

### new JobQueue(options)

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| options | Object | `{}` | Optional parameters |
| options.concurrency | number | `10` | Maximum number of jobs that may run concurrently |
| options.timeout | number | `60` | Seconds to wait before a running job is considered timed-out and eligible for retry or failure |
| options.idleSleep | number | `1000` | Milliseconds to sleep after completing a run loop when no jobs are acquired |
| options.activeSleep | number | `10` | Milliseconds to sleep after completing a run loop when a job is acquired |

### jobQueue.concurrency : number
Maximum number of jobs that may run concurrently

### jobQueue.timeout : number
Seconds to wait before a running job is considered timed-out and eligible for retry or failure

### jobQueue.idleSleep : number
Milliseconds to sleep after completing a run loop when no jobs are acquired

### jobQueue.activeSleep : number
Milliseconds to sleep after completing a run loop when a job is acquired

### jobQueue.running : number
Number of jobs that are currently running

### jobQueue.isSaturated : boolean
Whether the number of jobs currently running is equal to the maximum concurrency

### jobQueue.connect()
Establish a connection to the database server

### jobQueue.disconnect()
Disconnect from the database server

### jobQueue.push(job)
Push a job into the job queue


| Param | Type | Description |
| --- | --- | --- |
| job | Job | The job to push into the queue |

### jobQueue.handle(type, options, fn)
Configure the job queue to handle jobs of a particular type


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| type | string |  | The job type. Only jobs of this type will be passed to the handle function. |
| options | Object | `{}` | Optional parameters |
| options.concurrency | number | `1` | Maximum number of jobs that this handler may run concurrently |
| fn | function |  | An async function that takes a single job as its parameter |

### jobQueue.start()
Starts the job queue

### jobQueue.pause()
Pauses the job queue

### jobQueue.stop()
Stops the job queue

### "error"
Emitted when an error is thrown in the constructor or run loop.

### "handlerError"
Emitted when an error is thrown by a handler.

### "connect"
Emitted when the job queue is connected to the database.

### "disconnect"
Emitted when the job queue has disconnected from the database.

### "push"
Emitted when a job has been pushed into the job queue.

### "handle"
Emitted when a job has been passed to a handler.

### "start"
Emitted when the job queue starts its run loop.

### "pause"
Emitted when the job queue pauses its run loop.

### "stop"
Emitted when the job queue stops its run loop.

### "beforeRun"
Emitted before a job runs.

### "afterRun"
Emitted after a job runs.

### "timeout"
Emitted when a job times out and is canceled.

## Job
Provides access to the properties and methods needed to define a job


* [Job](#markdown-header-job)
    * [new Job(type, options)](#markdown-header-new-jobtype-options)
    * _instance_
        * [.id](#markdown-header-jobid-string) : string
        * [.type](#markdown-header-jobtype-string) : string
        * [.message](#markdown-header-jobmessage-any) : any
        * [.unique_id](#markdown-header-jobunique_id-string) : string
        * [.recurring](#markdown-header-jobrecurring-string) : string
        * [.scheduled](#markdown-header-jobscheduled-date) : Date
        * [.expire](#markdown-header-jobexpire-date) : Date
        * [.retries](#markdown-header-jobretries-number) : number
        * [.try](#markdown-header-jobtry-number) : number
        * [.priority](#markdown-header-jobpriority-number) : number
        * [.acquired](#markdown-header-jobacquired-date) : Date
        * [.timeout](#markdown-header-jobtimeout-date) : Date
        * [.isComplete](#markdown-header-jobiscomplete-boolean) : boolean
        * [.hasTimedOut](#markdown-header-jobhastimedout-boolean) : boolean
        * [.hasExpired](#markdown-header-jobhasexpired-boolean) : boolean
        * [.canRetry](#markdown-header-jobcanretry-boolean) : boolean
        * [.updateTimeout(seconds)](#markdown-header-jobupdatetimeoutseconds)
        * [.log(level, message)](#markdown-header-jobloglevel-message)
        * [.error(message)](#markdown-header-joberrormessage)
        * [.warn(message)](#markdown-header-jobwarnmessage)
        * [.info(message)](#markdown-header-jobinfomessage)
        * [.debug(message)](#markdown-header-jobdebugmessage)
        * [.readLog(skip, limit)](#markdown-header-jobreadlogskip-limit)
        * [.readResult()](#markdown-header-jobreadresult)
    * _static_
        * [.load(id)](#markdown-header-jobloadid-job) ⇒ Job

### new Job(type, options)

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| type | string |  | The job type |
| options | Object | `{}` | Optional parameters |
| options.message | any |  | Application-defined message to pass to the job handler |
| options.unique_id | string |  | Unique ID of the job |
| options.recurring | string |  | Cron expression |
| options.scheduled | Date | `now` | Date and time after which the job will run |
| options.expire | Date |  | Date and time after which the job will no longer run |
| options.retries | number | `2` | Number of times to retry on failure |
| options.priority | number | `0` | Priority of the job |
| options.delay | number | `0` | Number of seconds to delay run |

### job.id : string
Job ID

### job.type : string
Job type

### job.message : any
Application-defined message to pass to the job handler

### job.unique_id : string
Unique ID of the job

### job.recurring : string
Cron expression

### job.scheduled : Date
Date and time after which the job will run

### job.expire : Date
Date and time after which the job will no longer run

### job.retries : number
Number of times to retry on failure

### job.try : number
The current number of times the job has been tried

### job.priority : number
Priority of the job

### job.acquired : Date
Date and time that the job was acquired (locked) by the job queue

### job.timeout : Date
Date and time when the job's lock will expire

### job.isComplete : boolean
Has the handler completed the job?

### job.hasTimedOut : boolean
Has the job's lock timed out?

### job.hasExpired : boolean
Has the job expired?

### job.canRetry : boolean
Is the job eligible to be retried?

### job.updateTimeout(seconds)
Update the job's lock timeout


| Param | Type | Description |
| --- | --- | --- |
| seconds | number | The number of seconds to lock the job |

### job.log(level, message)
Write to the job's log


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| level | string | `"info"` | The log level |
| message | any |  | The message to log |

### job.error(message)
Write to the job's log with level = "error"


| Param | Type | Description |
| --- | --- | --- |
| message | any | The message to log |

### job.warn(message)
Write to the job's log with level = "warn"


| Param | Type | Description |
| --- | --- | --- |
| message | any | The message to log |

### job.info(message)
Write to the job's log with level = "info"


| Param | Type | Description |
| --- | --- | --- |
| message | any | The message to log |

### job.debug(message)
Write to the job's log with level = "debug"


| Param | Type | Description |
| --- | --- | --- |
| message | any | The message to log |

### job.readLog(skip, limit)
Retrieve the job's log from the database


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| skip | number | `0` | The number of log messages to skip |
| limit | number | `100` | The maximum number of log messages to return |

### job.readResult()
Retrieve the job's result from the database

### Job.load(id) ⇒ Job
Load a Job from the database using the job's ID


| Param | Type | Description |
| --- | --- | --- |
| id | string | Job ID of the job to be loaded |


---

Copyright &copy; 2020 James P. Javery [@jjavery](https://github.com/jjavery)
