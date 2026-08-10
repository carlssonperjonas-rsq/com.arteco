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
  103: { handler: 'setting' },   // soil_calibration
  104: { handler: 'setting' },   // soil_sampling/report interval
  105: { handler: 'setting' },   // humidity_calibration
  106: { handler: 'setting' },   // illuminance_calibration
  107: { handler: 'setting' },   // temperature_calibration
  110: { handler: 'setting' },   // soil_warning threshold
  111: { handler: 'waterWarning' },
  112: { handler: 'soilFertility' },
  114: { handler: 'setting' },   // soil_fertility_warning_setting
  115: { handler: 'setting' },   // soil_fertility_warning
};

export const DP_WRITE = {
  SOIL_CALIBRATION: 103,
  SOIL_SAMPLING: 104,
  HUMIDITY_CALIBRATION: 105,
  TEMP_CALIBRATION: 107,
  SOIL_WARNING: 110,
} as const;

export const DEFAULTS = {
  SAMPLING_SECONDS: 600,
  CALIBRATION: 0,
  SOIL_WARNING_PERCENT: 30,
} as const;
