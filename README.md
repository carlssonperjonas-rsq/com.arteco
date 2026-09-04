# Arteco for Homey

Adds support for Arteco Zigbee devices.

## Supported Devices

### ZS-301Z / ZS-300Z / ZS-SF00 Soil Sensor

A battery-powered Tuya Zigbee soil sensor family. The ZS-SF00 hardware variant
also measures electrical conductivity (EC) as an indication of soil fertility.

**Capabilities:**
- Soil Moisture (0-100%)
- Soil Fertility (0-5000 µS/cm, supported hardware only)
- Low Soil Fertility Alarm (supported hardware only)
- Temperature (°C)
- Air Humidity (0-100%)
- Illuminance (lx)
- Battery Percentage
- Water Shortage Alarm

**Settings:**
- Humidity Calibration (-30 to +30)
- Soil Moisture, Temperature, and Illuminance Calibration
- Report Interval (variant-dependent; 5-3600 seconds on ZS-300Z and ZS-SF00)
- Soil Dryness Threshold
- Low Fertility Threshold (ZS-SF00 only, 100-5000 µS/cm)

**Technical Details:**
- ZS-SF00: Zigbee model `Arteco`, manufacturer `A89G12C`
- ZS-300Z: Tuya model `TS0601`, including `_TZE284*_0ints6wl`
- ZS-301Z: Tuya OEM manufacturers `_TZE284_o9ofysmo` and `_TZE284_xc3vwx5a`
- Protocol: Tuya Zigbee (Cluster 0xEF00)

**Note:** Some hardware revisions emit messages at a very high rate, causing rapid battery drain. Setting a longer report interval may help if the device respects it.

## Installation

1. Install the app from the Homey App Store
2. Add device: Devices → + → Arteco → ZS-301Z Soil Sensor
3. Put the sensor in pairing mode (hold button for 5 seconds until LED blinks)
4. Follow the pairing instructions
