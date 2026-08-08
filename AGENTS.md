# AGENTS.md

## Project purpose

`garmin-empirbus-ts` is the protocol-facing TypeScript library for Garmin EmpirBus communication. It owns WebSocket transport, EmpirBus telegram creation/parsing, channel state decoding, repository state, and protocol-level operations.

Do not add Node-RED, FlowFuse Dashboard, Alexa, UI, or application-specific business logic to this package.

## Architecture

Keep dependencies pointing inward:

- `domain/` contains protocol-independent domain types such as `Channel`.
- `application/` contains repository contracts, use-case helpers, and result types.
- `infrastructure/` contains WebSocket and Garmin/EmpirBus protocol implementation.
- `shared/` contains small reusable technical helpers.
- `bin/` contains CLI entry points only.

Protocol byte layout and message construction belong in `infrastructure/`.

## Coding style

- Prefer self-explanatory code over comments.
- Use comments only for protocol peculiarities, workarounds, or facts that cannot be expressed clearly in code.
- Use descriptive names and small functions.
- If a function has five or fewer parameters, keep the parameter list on one line in both definitions and calls.
- Do not introduce speculative abstractions.
- Preserve existing public APIs unless a breaking change is explicitly requested.
- Use the existing `Result`/`ResultType` pattern for command success and failure.

## Protocol invariants

### Switch

A Garmin UI Switch uses MFD control `messagecmd = 0`.

- ON is an explicit target-state command.
- OFF is an explicit target-state command.
- `switch()` must always send the requested state.
- Never suppress `switch()` because the cached state already equals the requested state.
- Cache/state is irrelevant for the semantics of `switch()`.

### Toggle

`toggle()` is different from `switch()`:

- Read the currently known state.
- Send the opposite state.
- If the state is unknown, do not send.
- For multi-channel toggle, validate all channels first. Do not partially execute if any state is unknown.

### Momentary/Button

A Garmin UI Button / `SendMomentary` uses MFD control `messagecmd = 1`.

- Press and release are separate telegrams.
- Long press is not a separate protocol command; it is press, wait, release.
- Do not merge momentary semantics into switch semantics.

### Dimmer

Dimmer control uses MFD control `messagecmd = 3`.

This library consumes protocol-level/raw dimmer values. UI-friendly conversion from percent or normalized values belongs in adapters such as the Node-RED package.

### Raw commands

Raw command support must:

- accept only validated byte-oriented telegram objects,
- derive `size` from `data.length` when omitted if the public API allows it,
- reject mismatched `size`,
- avoid mutating caller-owned objects/arrays.

## Channel state

`Channel` keeps both raw and decoded information. Preserve the distinction:

- `rawValue`: protocol/raw value.
- `decodedValue`: decoded user-level value.
- `onOffStatus`: decoded bit-0 power state when applicable.
- `error1`, `error2`, `unavailable`: decoded status flags.

Do not reinterpret values such as 128/129 as range values when they are status bytes. Decode status bits first and preserve the raw value separately.

## Events and subscriptions

Repository event methods return unsubscribe functions. New listener APIs should follow the same pattern.

Reconnect/subscription behavior must remain deterministic and should not create duplicate message listeners.

## Compatibility

The Node-RED package depends on this library. Before changing exported types or behavior, check the downstream usage in `node-red-contrib-garmin-empirbus`.

Do not change switch, toggle, momentary, dimmer, raw-command, or channel-state semantics without updating the downstream specification and tests.

## Verification

For implementation changes:

1. Run the TypeScript build.
2. Verify exported declarations in `dist` are generated.
3. Add or update tests when test infrastructure exists.
4. For protocol changes, compare generated telegrams against known Garmin UI behavior.

## Explicit non-goals

Do not implement:

- FlowFuse Dashboard behavior,
- repeat-while-held UI handling,
- Node-RED message normalization,
- Alexa acknowledgement formats,
- dashboard state machines,
- camper/heating business rules.

Those belong in higher layers.
