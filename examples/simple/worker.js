// Get a reference to the JobQueue class
const { JobQueue } = require('../../packages/oddjob');

// A module that sends emails
const email = require('./email');

// Create an instance of a JobQueue
const jobQueue = new JobQueue('mongodb://localhost:27017/oddjob_examples');

// Tell the JobQueue to handle jobs of type 'send-email' with the provided
// async function. Concurrency is set to handle up to four jobs of this type
// simultaneously.
jobQueue.handle('send-email', { concurrency: 4 }, async (job, onCancel) => {
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
  console.error(err);
});

// Start the JobQueue
jobQueue.start();
