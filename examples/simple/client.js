// Get references to the JobQueue and Job classes
const { JobQueue, Job } = require('../../packages/oddjob');

// Create an instance of a JobQueue
const jobQueue = new JobQueue('mongodb://localhost:27017/oddjob_examples');

async function sendEmail(message) {
  // Push a new Job into the JobQueue
  await jobQueue.push(new Job('send-email', message));
}

async function disconnect() {
  // Disconnect from the database
  await jobQueue.disconnect();
}

sendEmail({
  from: 'someone@example.com',
  to: 'someoneelse@example.com',
  subject: 'This is an example',
  text: 'Hi Someone, How do you like my example? -Someone Else'
})
  .catch((err) => {
    console.error(err);
  })
  .finally(() => disconnect());
