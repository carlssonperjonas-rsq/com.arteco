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
const { DP_WRITE } = require('../.homeybuild/lib/zs301zDatapoints');

Module._load = originalLoad;

test('ZS-301Z writes calibration to DP 103 and report interval to DP 104', () => {
  assert.equal(DP_WRITE.SOIL_CALIBRATION, 103);
  assert.equal(DP_WRITE.SOIL_SAMPLING, 104);
});

function createDeviceHarness({ sleepy }) {
  const calls = {
    applyDeviceSettings: 0,
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
      return false;
    },
    isDeviceSleepy() {
      return sleepy;
    },
    setupTuyaListeners() {},
    registerRawReportHandler() {},
    async sendDataQuery() {
      calls.sendDataQuery += 1;
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
    async waitForTuyaRadioReady() {
      return undefined;
    },
    async waitForFollowupDataQuery() {
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
  const { calls, device, zclNode } = createDeviceHarness({ sleepy: true });

  await ZS301ZDevice.prototype.onNodeInit.call(device, { zclNode });

  assert.equal(device.pendingSettingsApply, true);
  assert.equal(calls.sendDataQuery, 0);
  assert.equal(calls.applyDeviceSettings, 0);
  assert.equal(calls.readBattery, 0);
});

test('always-on device is queried and configured during initialization', async () => {
  const { calls, device, zclNode } = createDeviceHarness({ sleepy: false });

  await ZS301ZDevice.prototype.onNodeInit.call(device, { zclNode });

  assert.equal(device.pendingSettingsApply, false);
  assert.equal(calls.sendDataQuery, 1);
  assert.equal(calls.applyDeviceSettings, 1);
  assert.equal(calls.readBattery, 1);
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

test('end-device announce sends a guarded two-stage data query before wake handling', async () => {
  const { calls, device } = createDeviceHarness({ sleepy: true });
  device.tuyaCluster = {};
  const events = [];
  device.waitForTuyaRadioReady = async () => {
    events.push('radio-ready');
  };
  device.onDeviceAwake = async () => {
    events.push('wake-handled');
  };
  device.sendDataQuery = async () => {
    calls.sendDataQuery += 1;
    events.push('data-query');
  };
  device.waitForFollowupDataQuery = async () => {
    events.push('follow-up-wait');
  };

  await ZS301ZDevice.prototype.onEndDeviceAnnounce.call(device);

  assert.deepEqual(events, [
    'radio-ready',
    'data-query',
    'follow-up-wait',
    'data-query',
    'wake-handled',
  ]);
  assert.equal(calls.sendDataQuery, 2);
});

test('repeated end-device announces query at most once per ten minutes', async () => {
  const { calls, device } = createDeviceHarness({ sleepy: true });
  device.tuyaCluster = {};
  device.lastAnnounceDataQueryAt = Date.now();
  device.onDeviceAwake = async () => {};

  await ZS301ZDevice.prototype.onEndDeviceAnnounce.call(device);

  assert.equal(calls.sendDataQuery, 0);
});
