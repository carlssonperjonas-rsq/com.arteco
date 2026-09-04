'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TuyaDataTypes,
  TuyaSpecificCluster,
} = require('../.homeybuild/lib/TuyaCluster');

test('Tuya datapoint writes do not wait for a response from sleepy devices', async () => {
  const calls = [];
  const cluster = {
    async datapoint(args, opts) {
      calls.push({ args, opts });
    },
  };
  const data = Buffer.from([0x00, 0x00, 0x02, 0x58]);

  await TuyaSpecificCluster.prototype.sendDatapoint.call(
    cluster,
    103,
    TuyaDataTypes.VALUE,
    data,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.dp, 103);
  assert.equal(calls[0].args.datatype, TuyaDataTypes.VALUE);
  assert.deepEqual(calls[0].args.data, data);
  assert.deepEqual(calls[0].opts, {
    disableDefaultResponse: true,
    waitForResponse: false,
  });
});
