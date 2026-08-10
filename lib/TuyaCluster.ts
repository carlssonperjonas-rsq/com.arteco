'use strict';

import { Cluster, ZCLDataTypes } from 'zigbee-clusters';

const TUYA_CLUSTER_ID = 61184; // 0xEF00

// Tuya datapoint types
const TuyaDataTypes = {
  RAW: 0x00,
  BOOL: 0x01,
  VALUE: 0x02,
  STRING: 0x03,
  ENUM: 0x04,
  BITMAP: 0x05,
};

// Tuya protocol command IDs
export const TUYA_CMD = {
  DATA_QUERY: 0x03,
  MCU_GATEWAY_CONNECTION_STATUS: 0x25,
} as const;

// Tuya magic attribute for waking devices
export const TUYA_MAGIC_ATTRIBUTE = 0xFFFE;

class TuyaSpecificCluster extends Cluster {

  static get ID() {
    return TUYA_CLUSTER_ID;
  }

  static get NAME() {
    return 'tuya';
  }

  static get ATTRIBUTES() {
    return {};
  }

  static get COMMANDS() {
    return {
      datapoint: {
        id: 0x00,
        args: {
          status: ZCLDataTypes.uint8,
          transid: ZCLDataTypes.uint8,
          dp: ZCLDataTypes.uint8,
          datatype: ZCLDataTypes.uint8,
          length: ZCLDataTypes.uint16,
          data: ZCLDataTypes.buffer,
        },
      },
      reporting: {
        id: 0x01,
        args: {
          status: ZCLDataTypes.uint8,
          transid: ZCLDataTypes.uint8,
          dp: ZCLDataTypes.uint8,
          datatype: ZCLDataTypes.uint8,
          length: ZCLDataTypes.uint16,
          data: ZCLDataTypes.buffer,
        },
      },
      response: {
        id: 0x02,
        args: {
          status: ZCLDataTypes.uint8,
          transid: ZCLDataTypes.uint8,
          dp: ZCLDataTypes.uint8,
          datatype: ZCLDataTypes.uint8,
          length: ZCLDataTypes.uint16,
          data: ZCLDataTypes.buffer,
        },
      },
    };
  }

  // Declare the dynamically created command method from COMMANDS
  declare datapoint: (args: {
    status: number;
    transid: number;
    dp: number;
    datatype: number;
    length: number;
    data: Buffer;
  }, opts?: { disableDefaultResponse?: boolean; waitForResponse?: boolean }) => Promise<void>;

  // Send a datapoint command to the device
  async sendDatapoint(dp: number, datatype: number, data: Buffer) {
    const transid = Math.floor(Math.random() * 255);
    // Use the dynamically created datapoint method from COMMANDS
    // disableDefaultResponse: true to avoid waiting for a response that may not come
    return this.datapoint({
      status: 0,
      transid,
      dp,
      datatype,
      length: data.length,
      data,
    }, {
      disableDefaultResponse: true,
      waitForResponse: false,
    });
  }

  // Helper to send a boolean value
  async setDatapointBool(dp: number, value: boolean) {
    const data = Buffer.alloc(1);
    data.writeUInt8(value ? 1 : 0, 0);
    return this.sendDatapoint(dp, TuyaDataTypes.BOOL, data);
  }

  // Helper to send a numeric value (4 bytes)
  async setDatapointValue(dp: number, value: number) {
    const data = Buffer.alloc(4);
    data.writeInt32BE(value, 0);
    return this.sendDatapoint(dp, TuyaDataTypes.VALUE, data);
  }

  // Helper to send an enum value
  async setDatapointEnum(dp: number, value: number) {
    const data = Buffer.alloc(1);
    data.writeUInt8(value, 0);
    return this.sendDatapoint(dp, TuyaDataTypes.ENUM, data);
  }

}

// Register the cluster
Cluster.addCluster(TuyaSpecificCluster);

export { TuyaSpecificCluster, TuyaDataTypes, TUYA_CLUSTER_ID };
