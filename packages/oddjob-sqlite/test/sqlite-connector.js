const { assert } = require('chai');
const SqliteConnector = require('../src/sqlite-connector');

const uri = `sqlite://${__dirname}/oddjob_test.db`;
const db = new SqliteConnector(uri);

let createdJob;
let runningJob;
let completedJob;

describe('db', function () {
  before(async function () {
    await db.connect();
  });

  after(async function () {
    await db.disconnect();
  });

  it('creates a job', async function () {
    const job = (createdJob = db.createJob({ type: 'test' }));

    assert.isObject(job);
    assert.isString(job.id);
  });

  it('saves a new job', async function () {
    const job = await db.saveJob({ type: 'test' });

    assert.isObject(job);
    assert.isString(job.id);
  });

  it('saves an existing job', async function () {
    const job = await db.saveJob(createdJob);

    assert.isObject(job);
    assert.isString(job.id);
  });

  it('finds a job based on id', async function () {
    const job = await db.findJobById(createdJob.id);

    assert.isObject(job);
    assert.equal(job.id, createdJob.id);
  });

  it('polls for a runnable job', async function () {
    const job = (runningJob = await db.pollForRunnableJob(
      ['test'],
      new Date(0),
      'test'
    ));

    assert.isObject(job);
    assert.equal(job.id, runningJob.id);
  });

  it('updates a running job', async function () {
    const now = new Date();

    const job = (completedJob = await db.updateRunningJob(runningJob, {
      timeout: null,
      modified: now,
      status: 'completed',
      completed: now
    }));

    assert.isObject(job);
    assert.isString(job.id);
    assert.isNull(job.timeout);
    assert.equal(job.modified.getTime(), now.getTime());
    assert.equal(job.status, 'completed');
    assert.equal(job.completed.getTime(), now.getTime());
  });

  it('updates a job based on id', async function () {
    const now = new Date();

    const job = await db.updateJobById(completedJob.id, {
      timeout: now
    });

    assert.isObject(job);
    assert.isString(job.id);
    assert.equal(job.status, 'completed');
    assert.equal(job.timeout.getTime(), now.getTime());
  });

  it('writes a job log message', async function () {
    const log = await db.writeJobLog(runningJob.id, 'info', 'test');

    assert.isObject(log);
    assert.equal(log.level, 'info');
    assert.equal(log.message, 'test');
  });

  it('reads a job log', async function () {
    const log = await db.readJobLog(runningJob.id);

    assert.isArray(log);
    assert.lengthOf(log, 1);
    assert.equal(log[0].level, 'info');
    assert.equal(log[0].message, 'test');
  });

  it('writes a job result', async function () {
    const result = await db.writeJobResult(runningJob.id, 'test');

    assert.isObject(result);
    assert.equal(result.message, 'test');
  });

  it('reads a job result', async function () {
    const result = await db.readJobResult(runningJob.id);

    assert.isObject(result);
    assert.equal(result.message, 'test');
  });
});
