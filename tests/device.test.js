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

Module._load = originalLoad;

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
