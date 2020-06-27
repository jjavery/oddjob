const { assert } = require('chai');
const uuid = require('uuid');
const { JobQueue, Job } = require('../src/oddjob');

const type = uuid.v4();
let newJob;

const connectionStrings = {
  SQLite: `sqlite://${__dirname}/oddjob_test.db`,
  MongoDB: 'mongodb://localhost:27017/oddjob_test'
};

for (let [connector, uri] of Object.entries(connectionStrings)) {
  describe(`JobQueue w/${connector} connector`, function () {
    it('constructs a job queue', function () {
      const jobQueue = new JobQueue(uri, { connect: false });

      assert.isNotNull(jobQueue);
    });

    it('constructs a job', function () {
      const job = (newJob = new Job(type));

      assert.isObject(job);
    });

    it('pushes a job into a job queue', async function () {
      const jobQueue = new JobQueue(uri);

      try {
        await jobQueue.push(newJob);
      } catch (err) {
        throw err;
      } finally {
        await jobQueue.disconnect();
      }
    });

    it('starts, pauses, and stops a job queue', async function () {
      const jobQueue = new JobQueue(uri);

      try {
        jobQueue.start();

        jobQueue.pause();
      } catch (err) {
        throw err;
      } finally {
        jobQueue.stop();
      }
    });

    it('handles a job', async function () {
      const jobQueue = new JobQueue(uri, {
        connectOptions: {
          connectTimeoutMS: 1500
        }
      });

      const promise = new Promise((resolve, reject) => {
        jobQueue.handle(type, async (job) => {
          assert.isObject(job);
          assert.equal(job.id, newJob.id);

          return 'test';
        });

        jobQueue.once('afterRun', (job) => {
          resolve();
        });

        jobQueue.once('error', (err) => {
          reject(err);
        });
      });

      jobQueue.start();

      const result = await promise;

      jobQueue.stop();
    });
  });
}
