'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function loadWithHomeyStub(request, parent, isMain) {
  if (request === 'homey') {
    return {
      Device: function Device() {},
      Driver: function Driver() {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const ZS301ZDevice = require('../.homeybuild/drivers/zs-301z/device');
const {
  DP_WRITE,
  DP_WRITE_ZS300Z,
  DP_WRITE_ZS301Z,
  getDpWriteMap,
} = require('../.homeybuild/lib/zs301zDatapoints');

Module._load = originalLoad;

test('ZS-301Z writes calibration to DP 103 and report interval to DP 104', () => {
  assert.equal(DP_WRITE.SOIL_CALIBRATION, 103);
  assert.equal(DP_WRITE.SOIL_SAMPLING, 104);
  assert.equal(DP_WRITE_ZS301Z.SOIL_CALIBRATION, 103);
  assert.equal(DP_WRITE_ZS301Z.SOIL_SAMPLING, 104);
});

test('0ints6wl ZS-300Z writes report interval to DP 103 and calibration to DP 104', () => {
  assert.equal(DP_WRITE_ZS300Z.SOIL_SAMPLING, 103);
  assert.equal(DP_WRITE_ZS300Z.SOIL_CALIBRATION, 104);
  assert.equal(getDpWriteMap('_TZE2841000000_0ints6wl'), DP_WRITE_ZS300Z);
  assert.equal(getDpWriteMap('_TZE284_o9ofysmo'), DP_WRITE_ZS301Z);
});

function createDeviceHarness({ sleepy, firstInit = false, dpSchemaVersion = 2 }) {
  const calls = {
    applyDeviceSettings: 0,
    configureMagicPacket: 0,
    readBattery: 0,
    sendDataQuery: 0,
  };

  const tuyaCluster = {
    on() {},
  };

  const device = {
    node: {
      manufacturerName: '_TZE2841000000_0ints6wl',
      receiveWhenIdle: !sleepy,
    },
    pendingSettingsApply: false,
    pendingMagicPacket: false,
    endpoint1: null,
    lastWakeHandledAt: 0,
    lastAnnounceDataQueryAt: 0,
    wakeHandling: false,
    tuyaCluster: null,
    log() {},
    error() {},
    hasCapability() {
      return false;
    },
    isFirstInit() {
      return firstInit;
    },
    getStoreValue() {
      return dpSchemaVersion;
    },
    async setStoreValue() {
      return undefined;
    },
    isDeviceSleepy() {
      return sleepy;
    },
    setupTuyaListeners() {},
    registerRawReportHandler() {},
    async sendDataQuery() {
      calls.sendDataQuery += 1;
    },
    async configureMagicPacket() {
      calls.configureMagicPacket += 1;
    },
    async applyDeviceSettings() {
      calls.applyDeviceSettings += 1;
    },
    async readBattery() {
      calls.readBattery += 1;
    },
    async setAvailable() {
      return undefined;
    },
  };

  const zclNode = {
    endpoints: {
      1: {
        clusters: {
          tuya: tuyaCluster,
        },
      },
    },
  };

  return { calls, device, zclNode };
}

test('sleepy device queues settings for its next wake-up and is not queried while asleep', async () => {
  const { calls, device, zclNode } = createDeviceHarness({ sleepy: true, firstInit: true });

  await ZS301ZDevice.prototype.onNodeInit.call(device, { zclNode });

  assert.equal(device.pendingSettingsApply, true);
  assert.equal(device.pendingMagicPacket, true);
  assert.equal(calls.sendDataQuery, 0);
  assert.equal(calls.configureMagicPacket, 0);
  assert.equal(calls.applyDeviceSettings, 0);
  assert.equal(calls.readBattery, 0);
});

test('always-on device is queried and configured during initialization', async () => {
  const { calls, device, zclNode } = createDeviceHarness({ sleepy: false, firstInit: true });

  await ZS301ZDevice.prototype.onNodeInit.call(device, { zclNode });

  assert.equal(device.pendingSettingsApply, false);
  assert.equal(calls.sendDataQuery, 1);
  assert.equal(calls.applyDeviceSettings, 1);
  assert.equal(calls.readBattery, 1);
});

test('sleepy device does not rewrite settings after an ordinary app restart', async () => {
  const { calls, device, zclNode } = createDeviceHarness({ sleepy: true, firstInit: false });

  await ZS301ZDevice.prototype.onNodeInit.call(device, { zclNode });

  assert.equal(device.pendingSettingsApply, false);
  assert.equal(device.pendingMagicPacket, true);
  assert.equal(calls.applyDeviceSettings, 0);
});

test('existing 0ints6wl device queues the corrected datapoint schema once', async () => {
  const { calls, device, zclNode } = createDeviceHarness({
    sleepy: true,
    firstInit: false,
    dpSchemaVersion: 1,
  });

  await ZS301ZDevice.prototype.onNodeInit.call(device, { zclNode });

  assert.equal(device.pendingSettingsApply, true);
  assert.equal(calls.applyDeviceSettings, 0);
});

test('successful wake-up settings sync clears the pending flag', async () => {
  const { calls, device } = createDeviceHarness({ sleepy: true });
  device.pendingSettingsApply = true;

  await ZS301ZDevice.prototype.onDeviceAwake.call(device);

  assert.equal(calls.applyDeviceSettings, 1);
  assert.equal(device.pendingSettingsApply, false);
});

test('failed wake-up settings sync remains queued for the next wake-up', async () => {
  const { calls, device } = createDeviceHarness({ sleepy: true });
  device.pendingSettingsApply = true;
  device.applyDeviceSettings = async () => {
    calls.applyDeviceSettings += 1;
    throw new Error('device went back to sleep');
  };

  await ZS301ZDevice.prototype.onDeviceAwake.call(device);

  assert.equal(calls.applyDeviceSettings, 1);
  assert.equal(device.pendingSettingsApply, true);
});

test('concurrent wake-up handling does not start a second settings sync', async () => {
  const { calls, device } = createDeviceHarness({ sleepy: true });
  device.pendingSettingsApply = true;

  let finishSettingsSync;
  device.applyDeviceSettings = () => {
    calls.applyDeviceSettings += 1;
    return new Promise((resolve) => {
      finishSettingsSync = resolve;
    });
  };

  const firstWake = ZS301ZDevice.prototype.onDeviceAwake.call(device);
  await new Promise((resolve) => setImmediate(resolve));
  device.lastWakeHandledAt = 0;
  await ZS301ZDevice.prototype.onDeviceAwake.call(device);

  assert.equal(calls.applyDeviceSettings, 1);
  finishSettingsSync();
  await firstWake;
});

test('end-device announce queries immediately, sends the pending magic packet, then handles wake-up', async () => {
  const { calls, device } = createDeviceHarness({ sleepy: true });
  device.tuyaCluster = {};
  device.endpoint1 = { clusters: { basic: {} } };
  device.pendingMagicPacket = true;
  const events = [];
  device.onDeviceAwake = async () => {
    events.push('wake-handled');
  };
  device.sendDataQuery = async () => {
    calls.sendDataQuery += 1;
    events.push('data-query');
  };
  device.configureMagicPacket = async () => {
    calls.configureMagicPacket += 1;
    events.push('magic-packet');
  };

  await ZS301ZDevice.prototype.onEndDeviceAnnounce.call(device);

  assert.deepEqual(events, [
    'data-query',
    'magic-packet',
    'wake-handled',
  ]);
  assert.equal(calls.sendDataQuery, 1);
  assert.equal(calls.configureMagicPacket, 1);
  assert.equal(device.pendingMagicPacket, false);
});

test('end-device announce applies pending settings before any other outgoing command', async () => {
  const { calls, device } = createDeviceHarness({ sleepy: true });
  device.tuyaCluster = {};
  device.endpoint1 = { clusters: { basic: {} } };
  device.pendingSettingsApply = true;
  device.pendingMagicPacket = true;
  const events = [];
  device.onDeviceAwake = async () => {
    events.push('settings');
    device.pendingSettingsApply = false;
  };
  device.sendDataQuery = async () => {
    calls.sendDataQuery += 1;
    events.push('data-query');
  };
  device.configureMagicPacket = async () => {
    calls.configureMagicPacket += 1;
    events.push('magic-packet');
  };

  await ZS301ZDevice.prototype.onEndDeviceAnnounce.call(device);

  assert.deepEqual(events, ['settings', 'data-query', 'magic-packet']);
});

test('repeated end-device announces query at most once per ten minutes', async () => {
  const { calls, device } = createDeviceHarness({ sleepy: true });
  device.tuyaCluster = {};
  device.lastAnnounceDataQueryAt = Date.now();
  device.onDeviceAwake = async () => {};

  await ZS301ZDevice.prototype.onEndDeviceAnnounce.call(device);

  assert.equal(calls.sendDataQuery, 0);
});

test('Tuya magic packet uses a raw Basic-cluster read including attribute 0xFFFE', async () => {
  const frames = [];
  const basicCluster = {
    async sendFrame(frame) {
      frames.push(frame);
    },
  };
  const device = {
    log() {},
  };
  const zclNode = {
    endpoints: {
      1: {
        clusters: {
          basic: basicCluster,
        },
      },
    },
  };

  await ZS301ZDevice.prototype.configureMagicPacket.call(device, zclNode);

  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0].frameControl, []);
  assert.equal(frames[0].cmdId, 0x00);
  assert.deepEqual(
    [...frames[0].data],
    [0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x05, 0x00, 0x07, 0x00, 0xfe, 0xff],
  );
});

test('0ints6wl settings apply the ZS-300Z datapoints and persist the migration', async () => {
  const writes = [];
  const stored = [];
  const settings = {
    soil_sampling: 600,
    soil_calibration: 0,
    humidity_calibration: 0,
    illuminance_calibration: 0,
    temperature_calibration: 0,
    soil_warning: 30,
  };
  const device = {
    node: { manufacturerName: '_TZE2841000000_0ints6wl' },
    tuyaCluster: {
      async setDatapointValue(dp, value) {
        writes.push([dp, value]);
      },
    },
    getSetting(key) {
      return settings[key];
    },
    async setStoreValue(key, value) {
      stored.push([key, value]);
    },
    log() {},
  };

  await ZS301ZDevice.prototype.applyDeviceSettings.call(device);

  assert.deepEqual(writes, [
    [103, 600],
    [104, 0],
    [105, 0],
    [106, 0],
    [107, 0],
    [110, 30],
  ]);
  assert.deepEqual(stored, [['zs300z_dp_schema_version', 2]]);
});

test('gateway connection status response reports the Homey gateway online', async () => {
  const frames = [];
  const device = {
    tuyaCluster: {
      async sendFrame(frame) {
        frames.push(frame);
      },
    },
    log() {},
  };

  await ZS301ZDevice.prototype.respondToGatewayConnectionStatus.call(device);

  assert.equal(frames.length, 1);
  assert.equal(frames[0].cmdId, 0x25);
  assert.deepEqual(frames[0].frameControl, ['clusterSpecific', 'disableDefaultResponse']);
  assert.deepEqual([...frames[0].data], [0x00, 0x01, 0x01]);
});

test('a real Tuya frame can apply one queued migration without starting general wake handling', async () => {
  const calls = [];
  const device = {
    pendingSettingsApply: true,
    wakeHandling: false,
    async applyDeviceSettings() {
      calls.push('settings');
    },
    log() {},
    error() {},
  };

  await ZS301ZDevice.prototype.applyPendingSettingsFromRawFrame.call(device);

  assert.deepEqual(calls, ['settings']);
  assert.equal(device.pendingSettingsApply, false);
  assert.equal(device.wakeHandling, false);
});

test('raw Tuya datapoint parsing triggers the queued migration path', async () => {
  let migrations = 0;
  const device = {
    pendingSettingsApply: true,
    applyPendingSettingsFromRawFrame() {
      migrations += 1;
      return Promise.resolve();
    },
    processDataPoint() {},
    log() {},
    error() {},
  };
  const soilMoistureFrame = Buffer.from('0900020053030200040000003b', 'hex');

  ZS301ZDevice.prototype.parseRawTuyaFrame.call(device, soilMoistureFrame);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(migrations, 1);
});

test('failed raw-frame migration remains queued for the next receive window', async () => {
  const device = {
    pendingSettingsApply: true,
    wakeHandling: false,
    async applyDeviceSettings() {
      throw new Error('radio slept');
    },
    log() {},
    error() {},
  };

  await ZS301ZDevice.prototype.applyPendingSettingsFromRawFrame.call(device);

  assert.equal(device.pendingSettingsApply, true);
  assert.equal(device.wakeHandling, false);
});
