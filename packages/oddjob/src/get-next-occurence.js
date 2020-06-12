const cronParser = require('cron-parser');

function getNextOccurrence(expression) {
  if (recurring == null) {
    return null;
  }

  const start = date.add(new Date(), 1, 'minute');

  const interval = cronParser.parseExpression(expression, {
    currentDate: start
  });
  const next = interval.next();

  return next;
}

module.exports = getNextOccurrence;
