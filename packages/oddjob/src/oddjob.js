const dayjs = require('dayjs');
const minMax = require('dayjs/plugin/minMax');
const JobQueue = require('./job-queue');
const Job = require('./job');

dayjs.extend(minMax);

module.exports = {
  JobQueue,
  Job
};
