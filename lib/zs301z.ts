'use strict';

import { clampNumber, clampInt } from './utils';
import { isZs300zVariant } from './zs301zDatapoints';

export function clampSamplingSeconds(seconds: number, manufacturerName?: string): number {
  return isZs300zVariant(manufacturerName)
    ? clampInt(seconds, 5, 3600)
    : clampInt(seconds, 30, 1200);
}

export function clampHumidityCalibration(offset: number): number {
  return clampInt(offset, -30, 30);
}

export function clampSoilCalibration(offset: number): number {
  return clampInt(offset, -30, 30);
}

export function clampIlluminanceCalibration(offsetLux: number): number {
  return clampInt(offsetLux, -1000, 1000);
}

export function toTuyaTemperatureCalibrationTenths(offsetC: number): number {
  return clampInt(offsetC * 10, -20, 20);
}

export function clampSoilWarning(percent: number): number {
  return clampInt(percent, 0, 100);
}

export function clampSoilFertilityWarning(microSiemensPerCm: number): number {
  return clampInt(microSiemensPerCm, 100, 5000);
}
