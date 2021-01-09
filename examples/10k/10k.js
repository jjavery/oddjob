const { JobQueue, Job } = require('../../packages/oddjob');

const uri = 'mongodb://localhost:27017/oddjob_examples';
// const uri = `sqlite://${__dirname}/10k.db`;

const jobQueue = new JobQueue(uri, {
  activeSleep: 0
});

jobQueue.start();

jobQueue.handle('10k', { concurrency: 10 }, async (job, onCancel) => {
  process.stdout.write(`${job.message} `);
});

jobQueue.on('error', (err) => {
  console.error(err);
});

for (let i = 0; i < 10000; ++i) {
  jobQueue.push(new Job('10k', i)).catch((err) => {
    console.error(err);
  });
}
