const { JobQueue, Job } = require('../packages/oddjob');

const jobQueue = new JobQueue('mongodb://localhost', {
  idleSleep: 5000,
  timeout: 1
});

jobQueue.handle('test', async (job, onCancel) => {
  let canceled = false;

  onCancel(() => {
    console.log('canceled!');
    canceled = true;
  });

  while (!canceled) {
    await wait(1000);
  }

  if (canceled) {
    return;
  }

  await job.log('test');

  return 'test';
});

jobQueue.on('error', (err) => {
  console.log(err);
  process.exit(1);
});

jobQueue.start();

(async () => {
  await jobQueue.push(new Job('test', { message: { test: 'test' } }));
})();

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graceful() {
  jobQueue.stop();
}

process.on('SIGTERM', graceful);
process.on('SIGINT', graceful);
