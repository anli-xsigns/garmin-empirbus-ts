# garmin-empirbus-ts — Technical Specification

## 1. Scope

`garmin-empirbus-ts` provides a typed, protocol-facing API for communicating with Garmin EmpirBus systems over WebSocket. It is the lower-level dependency used by integrations such as `node-red-contrib-garmin-empirbus`.

The package is responsible for:

- WebSocket lifecycle management.
- Garmin/EmpirBus telegram transmission and reception.
- EmpirBus subscription requests.
- Channel lookup and state storage.
- MFD status decoding.
- Switch, toggle, momentary/button, dimmer, and raw command operations.
- Connection and channel update events.
- Result-based error reporting.

The package is not responsible for Node-RED message shapes, dashboard widgets, Alexa behavior, or application/business rules.

## 2. Runtime and package contract

Current package metadata:

- Package: `garmin-empirbus-ts`
- Current baseline version: `0.1.27`
- Main entry point: `dist/index.js`
- Type declarations: `dist/index.d.ts`
- TypeScript: 5.x
- Node types: 20.x
- WebSocket implementation: `ws`

The source tree is compiled into `dist/`. Public exports must be made intentionally through the package entry point.

## 3. Architecture

### 3.1 Domain

`src/domain/Channel.ts` defines the central channel representation:

```ts
type Channel = {
    type: number
    channelType: number
    dataItemFormatType: number
    dataType: number
    channelSettingType: number
    id: number
    name: string
    description: string
    rawValue: number | null
    decodedValue: number | boolean | string | null
    onOffStatus: boolean | null
    error1: boolean | null
    error2: boolean | null
    unavailable: boolean | null
    updatedAt: number | null
}
```

The raw and decoded fields have different purposes and must remain separate.

### 3.2 Application

`IChannelRepository` defines the integration-facing repository contract. Operations use `ResultType` for protocol/action outcomes where appropriate.

Existing result objects and failure/success codes are compatibility surfaces. Prefer extending them over introducing ad-hoc return formats.

### 3.3 Infrastructure

`EmpirBusClient` owns WebSocket transport. `EmpirBusChannelRepository` owns EmpirBus-specific command generation, subscriptions, state decoding, and cached channel state.

Protocol knowledge must remain in infrastructure code.

## 4. Telegram model

The generic EmpirBus JSON telegram shape is:

```ts
type Telegram = {
    messagetype: number
    messagecmd: number
    size: number
    data: number[]
}
```

All entries in `data` are bytes in the inclusive range `0..255`.

Channel identifiers are represented as little-endian 16-bit values in telegram data where the Garmin protocol requires them:

```text
low byte  = id & 0xff
high byte = id >> 8
```

## 5. Relevant message types

The implementation currently defines these message types:

| Name | Value |
|---|---:|
| `mfdStatus` | 16 |
| `mfdControl` | 17 |
| `channelInfo` | 32 |
| `channelCmd` | 33 |
| `systemCmd` | 48 |
| `systemReq` | 49 |
| `systemWrite` | 50 |
| `syncCmd` | 64 |
| `alertManagement` | 81 |
| `nmeaMsg` | 82 |
| `subscriptionRequest` | 96 |
| `clientControlCommand` | 112 |
| `acknowledgement` | 128 |

Normal MFD control operations use `messagetype = 17`.

## 6. Switch operation

### 6.1 Garmin UI equivalent

This operation corresponds to a **Switch** in the original Garmin UI, not a momentary button.

### 6.2 Telegram semantics

Switch control uses `messagecmd = 0`.

Known command examples:

```json
{"messagetype":17,"messagecmd":0,"size":3,"data":[27,0,3]}
```

sets the selected channel to ON.

```json
{"messagetype":17,"messagecmd":0,"size":3,"data":[27,0,5]}
```

sets the selected channel to OFF.

The command/status byte is a bit field:

- bit 0: pressed
- bit 1: on
- bit 2: off

Therefore:

- `3` = pressed + on
- `5` = pressed + off

### 6.3 API semantics

`switch(id, state)` is an explicit target-state operation.

Accepted `SwitchState` forms currently include:

```ts
boolean | 0 | 1 | 'ON' | 'OFF' | 'On' | 'Off' | 'on' | 'off'
```

String state matching is case-insensitive conceptually and should remain so if the type is broadened.

Normative rule:

> `switch()` must send every valid request. The repository cache must never suppress transmission because the locally stored state already matches the requested target state.

This rule exists because the command expresses an explicit requested target state and the cache may be stale.

## 7. Toggle operation

Toggle is explicitly state-dependent.

Algorithm:

1. Resolve all requested channels.
2. Verify every channel exists.
3. Verify every channel has a known current state.
4. Determine the current ON/OFF bit.
5. Send an explicit switch command for the opposite state.

If any requested channel state is unknown, the whole multi-channel operation fails before sending anything.

`toggleMany()` must not produce partial changes in this case.

## 8. Momentary/Button operation

### 8.1 Garmin UI equivalent

This corresponds to a **Button** / `SendMomentary` control in the original Garmin UI.

### 8.2 Telegram semantics

Momentary control uses `messagecmd = 1`.

Press:

```json
{"messagetype":17,"messagecmd":1,"size":3,"data":[7,0,1]}
```

Release:

```json
{"messagetype":17,"messagecmd":1,"size":3,"data":[7,0,0]}
```

### 8.3 API operations

The repository exposes or may expose these logical operations:

```ts
press(id)
release(id)
pressFor(id, durationMs, callbacks?)
pressForMany(ids, durationMs, callbacks?)
```

A long press is not a different protocol command. It is implemented as:

```text
press
wait duration
release
```

Do not implement a synthetic protocol-level `longPress` telegram.

## 9. Multi-channel momentary behavior

The low-level repository currently supports multi-channel press/release operations. Higher-level adapters decide whether multiple channels are executed as a parallel-style group or sequentially.

The library must keep individual telegrams per channel. It must never invent a combined multi-channel momentary telegram unless documented by the Garmin protocol.

## 10. Dimmer operation

Dimmer control uses:

```text
messagetype = 17
messagecmd  = 3
```

The repository API receives the protocol-level dimmer value. It generates the appropriate low/high bytes.

Normalization such as:

- percentage `0..100`,
- normalized `0..1`,
- dashboard-specific brightness formats,

belongs in an adapter layer and not in the protocol library.

Invalid values should be rejected at the layer that owns their semantic range. Avoid silent normalization that hides caller errors.

## 11. Raw command operation

`sendRawCommand` is the escape hatch for commands without a specialized high-level operation.

The intended command model is:

```ts
{
    messagetype: number
    messagecmd: number
    size?: number
    data: number[]
}
```

Validation requirements:

- command must be an object,
- `messagetype` is an integer byte,
- `messagecmd` is an integer byte,
- `data` is an array of integer bytes,
- maximum data length is 255,
- omitted `size` may be derived from `data.length`,
- supplied `size` must equal `data.length`,
- input objects and arrays must not be mutated.

The raw API must not invent short-form operations such as `{ type: 'dimmer', ... }`. Specialized APIs already cover such operations.

## 12. Incoming MFD state decoding

The repository receives channel updates and updates the corresponding `Channel` object.

For MFD pulse/momentary/dimmer status bytes, status flags include:

- bit 0 → `onOffStatus`
- bit 1 → `error1`
- bit 3 → `error2`
- bit 7 → `unavailable`

This is a critical protocol invariant.

Examples:

```text
128 = 10000000b → OFF + unavailable
129 = 10000001b → ON  + unavailable
```

`128` and `129` are not generic range values for such status messages.

The repository should preserve the raw byte in `rawValue` while publishing the decoded flag state in the dedicated fields.

## 13. Value decoding

`decodedValue` represents the semantic decoded form when enough metadata is available. `rawValue` remains the original protocol-level value.

Downstream packages may use metadata such as:

- `channelType`,
- `dataItemFormatType`,
- channel name/description,
- decoded status fields,

to derive presentation-oriented state.

The protocol package itself must not introduce Alexa-specific field names such as `brightness`, `thermostatSetPoint`, or `percentage` unless they are part of a separately defined library API.

## 14. Subscriptions and connection lifecycle

On connection, the repository subscribes to EmpirBus updates.

Current behavior includes:

- subscribing to known channel IDs,
- subscription requests for MFD updates,
- N2K subscription setup where applicable,
- state listeners for connection changes.

Connection events are represented by `EmpirBusClientState`.

Repository listener APIs follow this contract:

```ts
onUpdate(fn): Unsubscribe
onState(fn): Unsubscribe
onLog(fn): Unsubscribe
```

A listener registration must be removable through the returned unsubscribe function.

## 15. Result handling

Command methods should use the existing result model rather than throw for ordinary expected domain/protocol failures.

Typical failure cases include:

- requested channel does not exist,
- current state is unknown for toggle,
- command execution fails.

Unexpected programming/transport exceptions may still surface as exceptions where appropriate.

## 16. Public API stability

`node-red-contrib-garmin-empirbus` is a direct downstream consumer.

Before changing:

- `Channel`,
- `SwitchState`,
- repository method names/signatures,
- `ResultType`,
- connection-state enums,
- event semantics,

review downstream usage and preserve compatibility unless a deliberate breaking release is requested.

## 17. Source-code conventions

Required conventions:

- self-documenting code,
- minimal comments,
- descriptive identifiers,
- small focused functions,
- no unnecessary abstractions,
- five or fewer function parameters formatted on one line,
- protocol-specific constants should be named rather than scattered magic values where practical,
- no Node-RED or dashboard dependencies.

## 18. Verification expectations

Changes should be verified by:

1. compiling TypeScript successfully,
2. regenerating `dist`,
3. validating public declaration output,
4. comparing command telegrams with captured Garmin UI behavior for protocol changes,
5. checking downstream Node-RED compatibility for exported API changes.

When tests are added, prioritize deterministic unit tests for:

- switch telegram construction,
- momentary press/release telegram construction,
- toggle unknown-state rejection,
- multi-channel atomic validation,
- dimmer byte encoding,
- raw command validation/copy behavior,
- status flag decoding,
- reconnect/subscription listener behavior.

## 19. Non-goals

The following are intentionally outside this package:

- FlowFuse Dashboard widgets,
- repeated dashboard actions while a UI button is held,
- Node-RED payload parsing,
- UI localization,
- Alexa acknowledgement messages,
- camper/heating control rules,
- automatic UI state machines.

## 20. Rules Codex must not violate

Do not:

- use cached state to suppress an explicit `switch()` command,
- conflate Garmin UI Switch and Garmin UI Button semantics,
- treat momentary long press as a new protocol command,
- treat status bytes 128/129 as generic range values,
- move protocol byte creation into downstream adapters,
- mutate raw command inputs,
- partially execute a multi-channel toggle when one state is unknown,
- add Node-RED-specific concepts to this package.

## Communication observation

The library exposes raw, read-only EmpirBus communication events through `EmpirBusClient.onCommunication()` and `EmpirBusChannelRepository.onCommunication()`.

Each event contains `direction` (`rx` or `tx`), `timestamp`, and a copied raw `message` containing `messagetype`, `messagecmd`, `size`, and `data`. Observation must not change protocol processing or require file logging to be enabled. Heartbeats and subscription/system traffic are included so adapters can decide what to filter.
