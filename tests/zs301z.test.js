'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clampHumidityCalibration,
  clampIlluminanceCalibration,
  clampSamplingSeconds,
  clampSoilCalibration,
  clampSoilFertilityWarning,
  clampSoilWarning,
  toTuyaTemperatureCalibrationTenths,
} = require('../.homeybuild/lib/zs301z');

test('clampHumidityCalibration clamps to -30..30', () => {
  assert.equal(clampHumidityCalibration(0), 0);
  assert.equal(clampHumidityCalibration(30), 30);
  assert.equal(clampHumidityCalibration(-30), -30);
  assert.equal(clampHumidityCalibration(999), 30);
  assert.equal(clampHumidityCalibration(-999), -30);
});

test('clampHumidityCalibration rounds to integer', () => {
  assert.equal(clampHumidityCalibration(5.7), 6);
  assert.equal(clampHumidityCalibration(-5.2), -5);
});

test('clampSamplingSeconds keeps the original ZS-301Z range 30..1200', () => {
  assert.equal(clampSamplingSeconds(30), 30);
  assert.equal(clampSamplingSeconds(1200), 1200);
  assert.equal(clampSamplingSeconds(1), 30);
  assert.equal(clampSamplingSeconds(9999), 1200);
});

test('clampSamplingSeconds uses the ZS-300Z range 5..3600 for 0ints6wl', () => {
  const manufacturerName = '_TZE2841000000_0ints6wl';
  assert.equal(clampSamplingSeconds(5, manufacturerName), 5);
  assert.equal(clampSamplingSeconds(3600, manufacturerName), 3600);
  assert.equal(clampSamplingSeconds(1, manufacturerName), 5);
  assert.equal(clampSamplingSeconds(9999, manufacturerName), 3600);
});

test('clampIlluminanceCalibration clamps to -1000..1000 lx', () => {
  assert.equal(clampIlluminanceCalibration(0), 0);
  assert.equal(clampIlluminanceCalibration(1000), 1000);
  assert.equal(clampIlluminanceCalibration(-1000), -1000);
  assert.equal(clampIlluminanceCalibration(9999), 1000);
});

test('clampSoilCalibration clamps to -30..30', () => {
  assert.equal(clampSoilCalibration(0), 0);
  assert.equal(clampSoilCalibration(30), 30);
  assert.equal(clampSoilCalibration(-30), -30);
  assert.equal(clampSoilCalibration(999), 30);
});

test('clampSoilWarning clamps to 0..100', () => {
  assert.equal(clampSoilWarning(0), 0);
  assert.equal(clampSoilWarning(100), 100);
  assert.equal(clampSoilWarning(-1), 0);
  assert.equal(clampSoilWarning(999), 100);
});

test('clampSoilFertilityWarning clamps to 100..5000 µS/cm', () => {
  assert.equal(clampSoilFertilityWarning(100), 100);
  assert.equal(clampSoilFertilityWarning(5000), 5000);
  assert.equal(clampSoilFertilityWarning(1), 100);
  assert.equal(clampSoilFertilityWarning(9999), 5000);
});

test('toTuyaTemperatureCalibrationTenths maps °C to tenths with clamp', () => {
  assert.equal(toTuyaTemperatureCalibrationTenths(0), 0);
  assert.equal(toTuyaTemperatureCalibrationTenths(1.0), 10);
  assert.equal(toTuyaTemperatureCalibrationTenths(-0.5), -5);
  assert.equal(toTuyaTemperatureCalibrationTenths(99), 20);
  assert.equal(toTuyaTemperatureCalibrationTenths(-99), -20);
});
