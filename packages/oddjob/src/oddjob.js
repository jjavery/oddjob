const plugins = require('./plugins');
const JobQueue = require('./job-queue');
const Job = require('./job');

function use(plugin, options) {
  plugins.use(plugin, options);
}

module.exports = {
  oddjob: { use },
  JobQueue,
  Job
};
