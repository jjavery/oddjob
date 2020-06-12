const { JobQueue, Job } = require('../packages/oddjob-core');

const jobQueue = new JobQueue();

jobQueue.on('error', (err) => {
  console.log(err);
  process.exit(1);
});

(async () => {
  await jobQueue.push(new Job('test', { message: { test: 'test' } }));
  await jobQueue.disconnect();
})();
