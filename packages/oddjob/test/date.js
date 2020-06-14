const date = require('../src/date');
const { assert } = require('chai');

describe('date', () => {
  describe('.add', () => {
    it('adds milliseconds to a date', () => {
      const date0 = new Date(0);
      const expected = new Date(1000);

      const actual = date.add(date0, 1000, 'ms');

      assert.equal(actual.getTime(), expected.getTime());
    });
  });
});
