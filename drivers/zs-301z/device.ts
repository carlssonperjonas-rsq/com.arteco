'use strict';

import { ZigBeeDevice } from 'homey-zigbeedriver';
import { CLUSTER } from 'zigbee-clusters';

import { TuyaDataTypes, TUYA_CLUSTER_ID, TUYA_CMD } from '../../lib/TuyaCluster';
import { decodeTuyaDpValuesFromZclFrame } from '../../lib/tuyaFrame';
import { clampPercent, rawTemperatureTimes10ToCelsius } from '../../lib/utils';
import {
  clampHumidityCalibration,
  clampIlluminanceCalibration,
  clampSamplingSeconds,
  clampSoilCalibration,
  clampSoilWarning,
  toTuyaTemperatureCalibrationTenths,
} from '../../lib/zs301z';
import {
  DP_HANDLERS,
  DEFAULTS,
  getDpWriteMap,
  isZs300zVariant,
} from '../../lib/zs301zDatapoints';

const DP_SCHEMA_STORE_KEY = 'zs300z_dp_schema_version';
const DP_SCHEMA_VERSION = 2;

module.exports = class ZS301ZDevice extends ZigBeeDevice {

  private tuyaCluster: any = null;
  private pendingSettingsApply = false;
  private endpoint1: any = null;
  private lastWakeHandledAt = 0;
  private lastAnnounceDataQueryAt = 0;
  private wakeHandling = false;
  private pendingMagicPacket = false;

  async onNodeInit({ zclNode }: { zclNode: any }) {
    this.log('ZS-301Z device initialized');

    this.log('Available endpoints:', Object.keys(zclNode.endpoints));
    for (const [endpointId, endpoint] of Object.entries(zclNode.endpoints)) {
      this.log(`Endpoint ${endpointId} clusters:`, Object.keys((endpoint as any).clusters));
    }

    const endpoint = zclNode.endpoints[1];
    if (!endpoint) {
      this.error('Endpoint 1 not found');
      return;
    }
    this.endpoint1 = endpoint;

    const manufacturerName = (this as any).node?.manufacturerName;
    const supportsSoilFertility = ![
      '_TZE284_0ints6wl',
      '_TZE2841000000_0ints6wl',
    ].includes(manufacturerName);

    if (supportsSoilFertility && !this.hasCapability('measure_soil_fertility')) {
      await this.addCapability('measure_soil_fertility').catch(this.error);
    } else if (!supportsSoilFertility && this.hasCapability('measure_soil_fertility')) {
      this.log(`Removing unsupported soil fertility capability for ${manufacturerName}`);
      await this.removeCapability('measure_soil_fertility').catch(this.error);
    }

    const isSleepy = this.isDeviceSleepy();
    const isFirstInit = typeof (this as any).isFirstInit === 'function' ? (this as any).isFirstInit() : false;
    const storedDpSchemaVersion = typeof (this as any).getStoreValue === 'function'
      ? (this as any).getStoreValue(DP_SCHEMA_STORE_KEY)
      : DP_SCHEMA_VERSION;
    const needsDpSchemaMigration = isZs300zVariant(manufacturerName)
      && storedDpSchemaVersion !== DP_SCHEMA_VERSION;
    this.log(`Device is ${isSleepy ? 'sleepy (battery-powered)' : 'always-on'}`);
    if (isSleepy) {
      this.pendingSettingsApply = isFirstInit || needsDpSchemaMigration;
      this.pendingMagicPacket = true;
      if (this.pendingSettingsApply) {
        this.log('Device settings will be synchronized on the next wake-up');
      }
      if (needsDpSchemaMigration) {
        this.log(`Queuing corrected ZS-300Z datapoint settings for ${manufacturerName}`);
      }
    }

    if (isFirstInit && !isSleepy) {
      this.log('First init - sending Tuya magic packet');
      await this.configureMagicPacket(zclNode).catch(this.error);
    }

    this.tuyaCluster = endpoint.clusters['tuya'] || endpoint.clusters[TUYA_CLUSTER_ID];

    if (this.tuyaCluster) {
      this.log('Tuya cluster found!');
      this.setupTuyaListeners();
    } else {
      this.log('Tuya cluster not found, trying to bind...');
      try {
        await endpoint.bind('tuya');
        this.tuyaCluster = endpoint.clusters['tuya'];
        if (this.tuyaCluster) {
          this.log('Tuya cluster bound successfully');
          this.setupTuyaListeners();
        }
      } catch (err) {
        this.log('Could not bind Tuya cluster:', err);
      }
    }

    this.registerRawReportHandler(zclNode);

    if (this.tuyaCluster && !isSleepy) {
      await this.sendDataQuery().catch(this.error);
    }

    if (isSleepy) {
      this.log('Device is sleepy - will apply settings and read battery when device wakes up');
    } else {
      if (this.tuyaCluster) {
        await this.applyDeviceSettings().catch(this.error);
      }
      await this.readBattery(endpoint).catch(this.error);
    }
  }

  private async applyDeviceSettings(): Promise<void> {
    if (!this.tuyaCluster) return;

    const manufacturerName = (this as any).node?.manufacturerName;
    const dpWrite = getDpWriteMap(manufacturerName);
    const soilSampling = clampSamplingSeconds(
      this.getSetting('soil_sampling') ?? DEFAULTS.SAMPLING_SECONDS,
      manufacturerName,
    );
    const soilCalibration = clampSoilCalibration(this.getSetting('soil_calibration') ?? DEFAULTS.CALIBRATION);
    const humidityCalibration = clampHumidityCalibration(this.getSetting('humidity_calibration') ?? DEFAULTS.CALIBRATION);
    const illuminanceCalibration = clampIlluminanceCalibration(
      this.getSetting('illuminance_calibration') ?? DEFAULTS.CALIBRATION,
    );
    const tempCalibration = toTuyaTemperatureCalibrationTenths(this.getSetting('temperature_calibration') ?? DEFAULTS.CALIBRATION);
    const soilWarning = clampSoilWarning(this.getSetting('soil_warning') ?? DEFAULTS.SOIL_WARNING_PERCENT);

    await this.tuyaCluster.setDatapointValue(dpWrite.SOIL_SAMPLING, soilSampling);
    await this.tuyaCluster.setDatapointValue(dpWrite.SOIL_CALIBRATION, soilCalibration);
    await this.tuyaCluster.setDatapointValue(dpWrite.HUMIDITY_CALIBRATION, humidityCalibration);
    await this.tuyaCluster.setDatapointValue(dpWrite.ILLUMINANCE_CALIBRATION, illuminanceCalibration);
    await this.tuyaCluster.setDatapointValue(dpWrite.TEMP_CALIBRATION, tempCalibration);
    await this.tuyaCluster.setDatapointValue(dpWrite.SOIL_WARNING, soilWarning);

    if (isZs300zVariant(manufacturerName) && typeof (this as any).setStoreValue === 'function') {
      await (this as any).setStoreValue(DP_SCHEMA_STORE_KEY, DP_SCHEMA_VERSION);
    }

    this.log('Applied device settings', {
      manufacturerName,
      soilSampling,
      soilCalibration,
      humidityCalibration,
      illuminanceCalibration,
      tempCalibration,
      soilWarning,
    });
  }

  private setupTuyaListeners() {
    if (!this.tuyaCluster) return;

    this.tuyaCluster.on('reporting', (args: any) => {
      this.log('Tuya reporting event:', args);
      this.processTuyaReport(args);
    });

    this.tuyaCluster.on('response', (args: any) => {
      this.log('Tuya response event:', args);
      this.processTuyaReport(args);
    });

    this.tuyaCluster.on('datapoint', (args: any) => {
      this.log('Tuya datapoint event:', args);
      this.processTuyaReport(args);
    });
  }

  private registerRawReportHandler(zclNode: any) {
    const endpoint = zclNode.endpoints[1];
    if (!endpoint) return;

    const originalHandleFrame = endpoint.handleFrame?.bind(endpoint);
    if (originalHandleFrame) {
      endpoint.handleFrame = (clusterId: number, frame: Buffer, meta: any) => {
        if (clusterId === TUYA_CLUSTER_ID) {
          this.log('Raw Tuya frame received, cluster:', clusterId);
          this.log('Frame data:', frame.toString('hex'));
          this.parseRawTuyaFrame(frame);
        }
        return originalHandleFrame(clusterId, frame, meta);
      };
      this.log('Registered raw frame handler for Tuya cluster');
    }
  }

  private parseRawTuyaFrame(frame: Buffer) {
    try {
      const decoded = decodeTuyaDpValuesFromZclFrame(frame);
      if (decoded.commandId === TUYA_CMD.MCU_GATEWAY_CONNECTION_STATUS) {
        this.respondToGatewayConnectionStatus().catch(this.error);
      }
      if (this.pendingSettingsApply) {
        this.applyPendingSettingsFromRawFrame().catch(this.error);
      }
      if (decoded.dpValues.length === 0) return;

      this.log(
        `Decoded Tuya frame: cmd=${decoded.commandId} status=${decoded.status} transid=${decoded.transid} dpCount=${decoded.dpValues.length}`,
      );

      for (const dpValue of decoded.dpValues) {
        this.processDataPoint(dpValue.dp, dpValue.datatype, dpValue.data);
      }
    } catch (error) {
      this.error('Error parsing raw Tuya frame:', error);
    }
  }

  private processTuyaReport(args: any) {
    if (!args) return;
    this.log('Processing Tuya report:', JSON.stringify(args));
    const { dp, datatype, data } = args;
    if (typeof dp === 'number' && data) {
      this.processDataPoint(dp, datatype || 0, Buffer.isBuffer(data) ? data : Buffer.from([data]));
    }
  }

  private parseDpValue(datatype: number, data: Buffer): number | boolean {
    switch (datatype) {
      case TuyaDataTypes.BOOL:
        return data.readUInt8(0) !== 0;
      case TuyaDataTypes.VALUE:
        if (data.length >= 4) return data.readInt32BE(0);
        if (data.length >= 2) return data.readInt16BE(0);
        return data.readUInt8(0);
      case TuyaDataTypes.ENUM:
        return data.readUInt8(0);
      default:
        if (data.length >= 4) return data.readInt32BE(0);
        if (data.length >= 2) return data.readUInt16BE(0);
        if (data.length >= 1) return data.readUInt8(0);
        throw new Error(`Unknown datatype ${datatype} or empty data`);
    }
  }

  private processDataPoint(dp: number, datatype: number, data: Buffer) {
    const mapping = DP_HANDLERS[dp];
    if (!mapping) {
      this.log(`Unknown DP ${dp} (type: ${datatype})`);
      return;
    }

    const rawValue = this.parseDpValue(datatype, data);
    const value = mapping.divideBy && typeof rawValue === 'number'
      ? rawValue / mapping.divideBy
      : rawValue;

    this.log(`Processing DP ${dp} = ${value} (handler: ${mapping.handler})`);

    switch (mapping.handler) {
      case 'temperature':
        if (typeof rawValue === 'number') {
          const tempC = rawTemperatureTimes10ToCelsius(rawValue);
          this.log(`Setting temperature to ${tempC}°C`);
          if (this.hasCapability('measure_temperature')) {
            this.setCapabilityValue('measure_temperature', tempC).catch(this.error);
          }
        }
        break;

      case 'soilMoisture':
        if (typeof value === 'number') {
          const soilMoisture = clampPercent(value);
          this.log(`Setting soil moisture to ${soilMoisture}%`);
          if (this.hasCapability('measure_soil_moisture')) {
            this.setCapabilityValue('measure_soil_moisture', soilMoisture).catch(this.error);
          }
          if (this.hasCapability('alarm_water')) {
            const threshold = this.getSetting('soil_warning') ?? DEFAULTS.SOIL_WARNING_PERCENT;
            const alarm = soilMoisture < threshold;
            this.log(`Setting water alarm to ${alarm} (moisture ${soilMoisture}% vs threshold ${threshold}%)`);
            this.setCapabilityValue('alarm_water', alarm).catch(this.error);
          }
        }
        break;

      case 'humidity':
        if (typeof value === 'number') {
          const humidity = clampPercent(value);
          this.log(`Setting humidity to ${humidity}%`);
          if (this.hasCapability('measure_humidity')) {
            this.setCapabilityValue('measure_humidity', humidity).catch(this.error);
          }
        }
        break;

      case 'illuminance':
        if (typeof value === 'number') {
          this.log(`Setting illuminance to ${value} lx`);
          if (this.hasCapability('measure_luminance')) {
            this.setCapabilityValue('measure_luminance', value).catch(this.error);
          }
        }
        break;

      case 'battery':
        if (typeof value === 'number') {
          if (datatype === TuyaDataTypes.ENUM) {
            const batteryState = ['low', 'middle', 'high'][value] ?? `unknown (${value})`;
            this.log(`Battery state from Tuya DP 14: ${batteryState}; keeping percentage from PowerConfiguration`);
            break;
          }
          const battery = clampPercent(value);
          this.log(`Setting battery to ${battery}%`);
          if (this.hasCapability('measure_battery')) {
            this.setCapabilityValue('measure_battery', battery).catch(this.error);
          }
        }
        break;

      case 'soilFertility':
        if (typeof value === 'number') {
          this.log(`Setting soil fertility to ${value} mg/kg`);
          if (this.hasCapability('measure_soil_fertility')) {
            this.setCapabilityValue('measure_soil_fertility', value).catch(this.error);
          }
        }
        break;

      case 'waterWarning': {
        let alarm: boolean;
        if (typeof value === 'boolean') {
          alarm = value;
        } else if (typeof value === 'number') {
          alarm = value !== 0;
        } else {
          break;
        }
        this.log(`Setting water alarm to ${alarm}`);
        if (this.hasCapability('alarm_water')) {
          this.setCapabilityValue('alarm_water', alarm).catch(this.error);
        }
        break;
      }

      case 'setting':
        this.log(`Setting DP ${dp} confirmed: ${value}`);
        break;
    }
  }

  private async readBattery(endpoint: any) {
    if (!endpoint.clusters[CLUSTER.POWER_CONFIGURATION.NAME]) {
      this.log('PowerConfiguration cluster not available');
      return;
    }
    try {
      const batteryStatus = await endpoint.clusters[CLUSTER.POWER_CONFIGURATION.NAME].readAttributes(['batteryPercentageRemaining']);
      if (batteryStatus.batteryPercentageRemaining !== undefined) {
        const battery = Math.round(batteryStatus.batteryPercentageRemaining / 2);
        this.log('Battery level from PowerConfiguration:', battery, '%');
        if (this.hasCapability('measure_battery')) {
          await this.setCapabilityValue('measure_battery', battery);
        }
      }
    } catch (err) {
      this.log('Could not read battery (device may be sleeping):', err);
    }
  }

  private async sendDataQuery(): Promise<void> {
    if (!this.tuyaCluster) return;

    this.log('Sending Tuya dataQuery for current datapoint values');
    await this.tuyaCluster.sendFrame({
      frameControl: ['clusterSpecific', 'disableDefaultResponse'],
      cmdId: TUYA_CMD.DATA_QUERY,
      data: Buffer.alloc(0),
    });
    this.log('Sent Tuya dataQuery');
  }

  private async respondToGatewayConnectionStatus(): Promise<void> {
    if (!this.tuyaCluster) return;

    this.log('Responding to Tuya MCU gateway connection status request');
    await this.tuyaCluster.sendFrame({
      frameControl: ['clusterSpecific', 'disableDefaultResponse'],
      cmdId: TUYA_CMD.MCU_GATEWAY_CONNECTION_STATUS,
      data: Buffer.from([0x00, 0x01, 0x01]),
    });
  }

  private async applyPendingSettingsFromRawFrame(): Promise<void> {
    if (!this.pendingSettingsApply || this.wakeHandling) return;

    this.wakeHandling = true;
    try {
      this.log('Tuya frame confirms the sleepy device is awake; applying pending settings immediately');
      await this.applyDeviceSettings();
      this.pendingSettingsApply = false;
      this.log('Pending device settings applied from the active Tuya receive window');
    } catch (error) {
      this.error('Failed to apply pending settings from Tuya frame; will retry on next wake-up:', error);
    } finally {
      this.wakeHandling = false;
    }
  }

  async onSettings({ oldSettings, newSettings, changedKeys }: {
    oldSettings: Record<string, any>;
    newSettings: Record<string, any>;
    changedKeys: string[];
  }): Promise<void> {
    this.log('Settings changed:', changedKeys);

    const isSleepy = this.isDeviceSleepy();
    const manufacturerName = (this as any).node?.manufacturerName;
    const dpWrite = getDpWriteMap(manufacturerName);

    if (isSleepy) {
      this.log('Device is sleepy - queueing settings for next wake-up');
      this.pendingSettingsApply = true;
    } else if (this.tuyaCluster) {
      for (const key of changedKeys) {
        const value = newSettings[key];
        try {
          if (key === 'soil_sampling') {
            await this.tuyaCluster.setDatapointValue(
              dpWrite.SOIL_SAMPLING,
              clampSamplingSeconds(value ?? DEFAULTS.SAMPLING_SECONDS, manufacturerName),
            );
          }
          if (key === 'soil_calibration') {
            await this.tuyaCluster.setDatapointValue(dpWrite.SOIL_CALIBRATION, clampSoilCalibration(value ?? DEFAULTS.CALIBRATION));
          }
          if (key === 'humidity_calibration') {
            await this.tuyaCluster.setDatapointValue(dpWrite.HUMIDITY_CALIBRATION, clampHumidityCalibration(value ?? DEFAULTS.CALIBRATION));
          }
          if (key === 'illuminance_calibration') {
            await this.tuyaCluster.setDatapointValue(
              dpWrite.ILLUMINANCE_CALIBRATION,
              clampIlluminanceCalibration(value ?? DEFAULTS.CALIBRATION),
            );
          }
          if (key === 'temperature_calibration') {
            await this.tuyaCluster.setDatapointValue(dpWrite.TEMP_CALIBRATION, toTuyaTemperatureCalibrationTenths(value ?? DEFAULTS.CALIBRATION));
          }
          if (key === 'soil_warning') {
            await this.tuyaCluster.setDatapointValue(dpWrite.SOIL_WARNING, clampSoilWarning(value ?? DEFAULTS.SOIL_WARNING_PERCENT));
          }
        } catch (err) {
          this.error('Failed to apply setting to device:', err);
        }
      }
    }
  }

  async onDeleted() {
    this.log('ZS-301Z device deleted');
  }

  async onEndDeviceAnnounce(): Promise<void> {
    this.log('Device announced (woke up from sleep)');
    const hadPendingSettings = this.pendingSettingsApply;
    if (hadPendingSettings) {
      this.log('Prioritizing pending settings while the Tuya radio is awake');
      await this.onDeviceAwake();
    }

    const now = Date.now();
    const DATA_QUERY_COOLDOWN_MS = 10 * 60 * 1000;
    if (this.tuyaCluster && now - this.lastAnnounceDataQueryAt >= DATA_QUERY_COOLDOWN_MS) {
      this.lastAnnounceDataQueryAt = now;
      try {
        await this.sendDataQuery();
      } catch (error) {
        this.error('Failed to query current datapoints after device announce:', error);
      }
    }

    if (this.pendingMagicPacket) {
      try {
        await this.configureMagicPacket({ endpoints: { 1: this.endpoint1 } });
        this.pendingMagicPacket = false;
        this.log('Tuya magic packet sent successfully while device was awake');
      } catch (error) {
        this.error('Failed to send Tuya magic packet; will retry on next wake-up:', error);
      }
    }

    if (!hadPendingSettings) {
      await this.onDeviceAwake();
    }
  }

  private async configureMagicPacket(zclNode: any): Promise<void> {
    const endpoints = Object.values(zclNode.endpoints || {}) as any[];
    const candidates = endpoints.filter((e) => e?.clusters?.[CLUSTER.BASIC.NAME]);
    for (const endpoint of candidates) {
      try {
        const attributeIds = [
          0x0004, // manufacturerName
          0x0000, // zclVersion
          0x0001, // appVersion
          0x0005, // modelId
          0x0007, // powerSource
          0xfffe, // Tuya-specific initialization attribute
        ];
        const payload = Buffer.alloc(attributeIds.length * 2);
        attributeIds.forEach((attributeId, index) => {
          payload.writeUInt16LE(attributeId, index * 2);
        });
        await endpoint.clusters[CLUSTER.BASIC.NAME].sendFrame({
          frameControl: [],
          cmdId: 0x00,
          data: payload,
        });
        this.log('Sent Tuya configureMagicPacket including attribute 0xFFFE');
        return;
      } catch (err) {
        this.log('Tuya configureMagicPacket failed on endpoint, trying next:', err);
      }
    }
    throw new Error('No Basic cluster accepted the Tuya magic packet');
  }

  private isDeviceSleepy(): boolean {
    return (this as any).node?.receiveWhenIdle === false;
  }

  private async onDeviceAwake(): Promise<void> {
    if (this.wakeHandling) {
      this.log('Skipping wake handling while a previous wake-up is still being processed');
      return;
    }

    const now = Date.now();
    const DEBOUNCE_MS = 5000;

    if (now - this.lastWakeHandledAt < DEBOUNCE_MS) {
      this.log('Skipping duplicate wake handling (debounce)');
      return;
    }
    this.lastWakeHandledAt = now;
    this.wakeHandling = true;

    try {
      this.log('Handling device wake-up');
      await this.setAvailable().catch(this.error);

      if (this.pendingSettingsApply) {
        this.log('Applying pending user settings...');
        try {
          await this.applyDeviceSettings();
          this.pendingSettingsApply = false;
          this.log('Pending device settings applied successfully');
        } catch (err) {
          this.error('Failed to apply pending device settings; will retry on next wake-up:', err);
        }
      }

      if (this.endpoint1) {
        await this.readBattery(this.endpoint1).catch(this.error);
      }
    } finally {
      this.wakeHandling = false;
    }
  }

};
