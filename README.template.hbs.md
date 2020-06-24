# oddjob

A job queue for Node.js applications

_Why use a job queue?_ If your application needs to complete units of work outside of its main process, whether for reliability or scalability or both, it might benefit from a job queue.

_Why use oddjob?_ If your stack already includes Node.js and MongoDB or one of the other supported databases, then oddjob might be a good fit for your project.

_Why not use oddjob?_ It's beta quality! Not yet fully tested or used in production. There are many other high-quality options available.

## Features

- **Distributed** - Multiple workers run from the same job queue, and multiple clients push jobs to the same job queue.
- **Concurrency** - Multiple workers run multiple jobs simultaneously.
- **Persistence** - Jobs run at least once (unless they expire prior to being run).
- **Idempotency** - Under most circumstances, unique jobs run no more than once, even if multiple clients push the same unique job into the queue.
- **Recurrences** - Jobs can be scheduled to run on multiple dates and times using cron expressions.
- **Schedule** - Jobs can be scheduled to run no sooner than a specific date and time.
- **Expiration** - Jobs can be scheduled to run no later than a specific date and time.
- **Delay** - Jobs can be scheduled to run after a time delay.
- **Retries** - Failed jobs are retried a limited number of times.
- **Locking** - Workers lock jobs prior to running them. Jobs that do not complete prior to the timeout are re-run. Workers can update a job's lock to continue to hold it past its initial timeout.
- **Priority** - Jobs can be run before or after other jobs with the same eligiblity.
- **Messages** - Jobs carry application-defined messages from clients to workers.
- **Logging** - Workers can write log messages to a job's log stream.
- **Results** - Workers can return a result to store with a job.
- **Types** - Support for multiple job types in the same job queue.
- **Events** - Job queues are event emitters and emit events when various actions occur.
- **Promises** - Promise-based API (async/await).
- **Metadata** - Jobs record the hostname &amp; PID of clients and workers, and the timing of job events.
- **Plugins** - Pluggable data layer for various database systems (MongoDB, SQLite, etc.)

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
const mongodb = require('@jjavery/oddjob-mongodb');

// Only have to do this once per process
JobQueue.use(mongodb);

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
const mongodb = require('@jjavery/oddjob-mongodb');

// Only have to do this once per process
JobQueue.use(mongodb);

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

{{>main}}

---

Copyright &copy; 2020 James P. Javery [@jjavery](https://github.com/jjavery)
