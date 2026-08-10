'use strict';

export type DpHandler =
  | 'temperature'
  | 'soilMoisture'
  | 'soilFertility'
  | 'humidity'
  | 'illuminance'
  | 'battery'
  | 'waterWarning'
  | 'setting';

export const DP_HANDLERS: Record<number, { handler: DpHandler; divideBy?: number }> = {
  3:   { handler: 'soilMoisture' },
  5:   { handler: 'temperature', divideBy: 10 },
  14:  { handler: 'battery' },
  101: { handler: 'humidity' },
  102: { handler: 'illuminance' },
  103: { handler: 'setting' },   // soil_sampling or calibration, depending on variant
  104: { handler: 'setting' },   // soil_calibration or report interval, depending on variant
  105: { handler: 'setting' },   // humidity_calibration
  106: { handler: 'setting' },   // illuminance_calibration
  107: { handler: 'setting' },   // temperature_calibration
  110: { handler: 'setting' },   // soil_warning threshold
  111: { handler: 'waterWarning' },
  112: { handler: 'soilFertility' },
  114: { handler: 'setting' },   // soil_fertility_warning_setting
  115: { handler: 'setting' },   // soil_fertility_warning
};

export const DP_WRITE_ZS301Z = {
  SOIL_CALIBRATION: 103,
  SOIL_SAMPLING: 104,
  HUMIDITY_CALIBRATION: 105,
  ILLUMINANCE_CALIBRATION: 106,
  TEMP_CALIBRATION: 107,
  SOIL_WARNING: 110,
} as const;

export const DP_WRITE_ZS300Z = {
  SOIL_SAMPLING: 103,
  SOIL_CALIBRATION: 104,
  HUMIDITY_CALIBRATION: 105,
  ILLUMINANCE_CALIBRATION: 106,
  TEMP_CALIBRATION: 107,
  SOIL_WARNING: 110,
} as const;

const ZS300Z_MANUFACTURERS = new Set([
  '_TZE284_k7p2q5d9',
  '_TZE284_65gzcss7',
  '_TZE284_0ints6wl',
  '_TZE284_yzr43ayq',
  '_TZE2841000000_0ints6wl',
]);

export function isZs300zVariant(manufacturerName?: string): boolean {
  return typeof manufacturerName === 'string' && ZS300Z_MANUFACTURERS.has(manufacturerName);
}

export function getDpWriteMap(manufacturerName?: string) {
  return isZs300zVariant(manufacturerName) ? DP_WRITE_ZS300Z : DP_WRITE_ZS301Z;
}

// Backwards-compatible default for the original ZS-301Z fingerprints.
export const DP_WRITE = DP_WRITE_ZS301Z;

export const DEFAULTS = {
  SAMPLING_SECONDS: 600,
  CALIBRATION: 0,
  SOIL_WARNING_PERCENT: 30,
} as const;
