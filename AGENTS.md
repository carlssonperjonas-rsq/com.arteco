# AGENTS.md - AI Agent Guide for com.arteco

## Project Overview

- **App id**: `com.arteco`
- **Type**: Homey SDK 3 app for Zigbee devices
- **Language**: TypeScript (compiles to `.homeybuild/`)
- **Target**: Homey Pro (local platform only)
- **Current Device**: ZS-301Z soil sensor (Tuya OEM, manufacturer `A89G12C`, model `Arteco`)

## Development Commands

```bash
npm run build          # Compile TypeScript → .homeybuild/
npm run test           # Build + run unit tests (node --test)
npm run lint           # ESLint
homey app validate     # Full publish-level validation (no device needed)
homey app validate --level debug   # Faster local validation
homey app run          # Deploy to physical Homey Pro (requires LAN + device PAT)
```

### Critical: Running the App

- `homey app run` requires LAN access to a physical Homey Pro and a device-scoped PAT.
- **Always kill previous `homey app run` before starting a new one** or you get:
  ```
  ✖ Error: EACCES: permission denied, rmdir '.homeybuild/node_modules'
  ```
- Kill with: `pkill -f "homey app run"` or Ctrl+C in the terminal.
- `homey app validate` and `homey app build` work without a device and are the primary offline verification steps.

## Architecture

```
drivers/zs-301z/
├── device.ts            # Main device logic, lifecycle handlers
├── driver.ts            # Driver initialization
└── driver.compose.json  # Device metadata, capabilities, settings

lib/
├── TuyaCluster.ts       # Tuya cluster (0xEF00) implementation
├── tuyaFrame.ts         # Tuya protocol frame decoding
├── utils.ts             # Generic value conversion helpers
├── zs301z.ts            # ZS-301Z value clamping functions
└── zs301zDatapoints.ts  # DP → handler mapping, write DPs, defaults

types/
├── homey-zigbeedriver.d.ts  # Type stubs for homey-zigbeedriver
└── zigbee-clusters.d.ts     # Type stubs for zigbee-clusters

tests/
├── tuyaFrame.test.js    # Unit tests for tuyaFrame decoder
└── zs301z.test.js       # Unit tests for zs301z utility functions

.homeycompose/
├── app.json             # App metadata (id, author, URLs)
└── capabilities/
    ├── measure_soil_moisture.json
    └── measure_soil_fertility.json

locales/
├── en.json              # English strings
└── no.json              # Norwegian strings
```

### Dependencies

- `homey-zigbeedriver` — Homey's Zigbee device base class
- `zigbee-clusters` — ZCL cluster definitions and communication

## Critical Patterns and Gotchas

### zigbee-clusters Library

1. **Commands become methods**: Commands defined in `static get COMMANDS()` are automatically exposed as methods on the cluster instance:
   ```typescript
   // In COMMANDS: { datapoint: { id: 0x00, args: {...} } }
   // Use as: this.datapoint({ ...args })
   // NOT: this.writeCommand('datapoint', args)  ← WRONG
   ```

2. **Attribute validation**: `readAttributes()` validates names against known attributes and silently discards unknown ones — the request is never sent.

3. **Bypass validation with sendFrame()**: For manufacturer-specific attributes, use low-level `sendFrame()`:
   ```typescript
   await cluster.sendFrame({
     frameControl: [],   // [] = global, ['clusterSpecific'] = cluster command
     cmdId: 0x00,        // 0x00 = Read Attributes
     data: payload,
   });
   ```

4. **Do NOT pass `0xFFFE` to `readAttributes()`** — it throws `TypeError: X is not a valid attribute of basic`. Use `sendFrame()` instead for the Tuya magic packet.

### Sleepy (Battery-Powered) Devices

Battery-powered Zigbee devices sleep 99% of the time to conserve power and cannot receive commands while sleeping.

1. **Detect sleepy devices**:
   ```typescript
   private isDeviceSleepy(): boolean {
     return this.node?.receiveWhenIdle === false;
   }
   ```

2. **Never send commands in `onNodeInit` to sleepy devices** — queue them instead:
   ```typescript
   if (isSleepy) {
     this.pendingSettingsApply = true;
   } else {
     await this.applyDeviceSettings();
   }
   ```

3. **Handle device wake-up** via `onEndDeviceAnnounce()`:
   ```typescript
   async onEndDeviceAnnounce(): Promise<void> {
     await this.onDeviceAwake();
   }
   ```

4. **Detect first pairing vs app restart**:
   ```typescript
   const isFirstInit = typeof this.isFirstInit === 'function' ? this.isFirstInit() : false;
   ```
   Only send the magic packet on first init.

### Wake Handler Best Practices

- Use a centralized `onDeviceAwake()` called from multiple detection points.
- Implement a 5-second debounce to prevent duplicate wake processing.
- Never call `sendDataQuery()` from the generic/raw-frame wake handler — that
  causes response loops. A real `onEndDeviceAnnounce()` may issue one guarded
  query with a long cooldown.
- Only push settings when the user has changed them (`pendingSettingsApply` flag).

### Tuya Protocol

Tuya devices use a proprietary protocol on cluster `0xEF00` (61184).

1. **Magic Packet**: Read Basic cluster attributes to trigger Tuya reporting cycle. Only on first pairing.

2. **dataQuery Command (0x03)**: Requests device to report all current datapoint values:
   ```typescript
   await this.tuyaCluster.sendFrame({
     frameControl: ['clusterSpecific', 'disableDefaultResponse'],
     cmdId: 0x03,
     data: Buffer.alloc(0),
   });
   ```

3. **Datapoint Encoding**: Numeric values use big-endian int32:
   ```typescript
   const data = Buffer.alloc(4);
   data.writeInt32BE(value, 0);
   ```

4. **Tuya Datapoint Types**:
   | Code | Type   | Size |
   |------|--------|------|
   | 0x00 | RAW    | variable |
   | 0x01 | BOOL   | 1 byte |
   | 0x02 | VALUE  | 4 bytes, signed int32 BE |
   | 0x03 | STRING | variable |
   | 0x04 | ENUM   | 1 byte |
   | 0x05 | BITMAP | variable |

## ZS-301Z Datapoints

| DP  | Name                       | Type  | Handler        | Notes                       |
|-----|----------------------------|-------|----------------|-----------------------------|
| 3   | Soil Moisture              | VALUE | soilMoisture   | 0–100 %                     |
| 5   | Temperature                | VALUE | temperature    | raw / 10 = °C               |
| 14  | Battery                    | VALUE | battery        | 0–100 %                     |
| 101 | Air Humidity               | VALUE | humidity       | 0–100 %                     |
| 102 | Illuminance                | VALUE | illuminance    | lux                         |
| 103 | Soil Calibration           | VALUE | setting (W)    | -30 to +30                  |
| 104 | Reporting Interval         | VALUE | setting (W)    | 30–1200 s                   |
| 105 | Humidity Calibration       | VALUE | setting (W)    | -30 to +30                  |
| 106 | Illuminance Calibration    | VALUE | setting        | read-only                   |
| 107 | Temperature Calibration    | VALUE | setting (W)    | -20 to +20 (tenths of °C)   |
| 110 | Soil Warning Threshold     | VALUE | setting (W)    | 0–100 %                     |
| 111 | Water Warning              | BOOL  | waterWarning   | 0=OK, 1=Alarm               |
| 112 | Soil Fertility             | VALUE | soilFertility  | µS/cm, 0–2000               |
| 114 | Fertility Warning Setting  | VALUE | setting        | read-only                   |
| 115 | Fertility Warning          | BOOL  | setting        | read-only                   |

**(W)** = writable via `DP_WRITE` in `zs301zDatapoints.ts`

## Adding New Capabilities

Custom capabilities must be defined as individual JSON files in `.homeycompose/capabilities/<id>.json`. They cannot be defined only in `app.json`. After adding a capability file, also:
1. Add the capability id to `driver.compose.json` and the driver block in `app.json`.
2. Add strings to `locales/en.json` and `locales/no.json`.
3. To add a capability to already-paired devices without re-pairing, call `addCapability()` in `onNodeInit`.

## Testing

- Unit tests live in `tests/*.test.js` and run with `npm test`.
- Tests require the TypeScript build (`npm run build` runs first automatically).
- Logs from a running app appear as: `[ManagerDrivers] [Driver:zs-301z] [Device:uuid] message`

## Common Errors and Solutions

| Error | Cause | Fix |
|-------|-------|-----|
| `EACCES: permission denied, rmdir .homeybuild/node_modules` | Previous `homey app run` still running | Kill with `pkill -f "homey app run"` |
| `TypeError: X is not a function` on cluster | Wrong method name | Commands from `COMMANDS` become methods; use `this.commandName()` directly |
| `X is not a valid attribute` | zigbee-clusters rejecting unknown attribute | Use `sendFrame()` for manufacturer-specific attributes |
| `drivers.X invalid capability: measure_*` | Custom capability not in `.homeycompose/capabilities/` | Create `.homeycompose/capabilities/<id>.json` |
| `missing array 'energy.batteries'` | `measure_battery` used without declaring battery type | Add `"energy": { "batteries": ["AAA", "AAA"] }` to driver |
| Device not responding / timeout | Battery device is sleeping | Queue commands for `onEndDeviceAnnounce()` |

## External References

- [Zigbee2MQTT ZS-301Z definition](https://www.zigbee2mqtt.io/devices/ZS-301Z.html)
- [zigbee-herdsman-converters Tuya lib](https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/lib/tuya.ts)
- [Homey Zigbee Driver docs](https://apps-sdk-v3.developer.homey.app/tutorial-Zigbee.html)
- [zigbee-clusters source](https://github.com/athombv/node-zigbee-clusters)

## Cursor Cloud Specific

- **Homey CLI** (`homey` v4.x) is installed globally. Authenticates via `HOMEY_PAT` env var.
- **`HOMEY_PAT` is an Apps Store PAT** (`pat-apps-*`) — scoped to app publishing only. `homey app run` requires a general-purpose PAT with device-level access.
- **`homey app validate`** and **`homey app build`** work offline and are the primary CI verification steps, together with `npm run build`, `npm run lint`, and `npm run test`.
