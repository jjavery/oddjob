function add(date = new Date(), value = 0, units = 'milliseconds') {
  const milliseconds = getMillisecondsForUnits(units);

  return new Date(date.getTime() + value * milliseconds);
}

function subtract(date = new Date(), value = 0, units = 'milliseconds') {
  const milliseconds = getMillisecondsForUnits(units);

  return new Date(date.getTime() - value * milliseconds);
}

function getMillisecondsForUnits(units) {
  const milliseconds = millisecondsPerUnit[units];

  if (!milliseconds) {
    throw new Error(`Unknown units "${units}"`);
  }

  return milliseconds;
}

function min(...dates) {
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

function max(...dates) {
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

const millisecondsPerUnit = {
  ms: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1000,
  second: 1000,
  seconds: 1000,
  m: 60 * 1000,
  minute: 60 * 1000,
  minutes: 60 * 1000,
  h: 60 * 60 * 1000,
  hour: 60 * 60 * 1000,
  hours: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000
};

module.exports = {
  add,
  subtract,
  min,
  max
};
