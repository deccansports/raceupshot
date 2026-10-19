# INVETON RU5600 SDK compatibility report

Audit source: `INVETON RU5600 SDK(2026-06-23 18_39_25).zip`

SHA-256: `17a66363236b343131af38e47d73207f78985c6dc6031baca80a90ea22936c38`

Audit status: **SDK V3.2 inspected; local bridge implemented; physical hardware validation pending**

No executable or native library from the archive was run during this static audit.

## Package contents

The main package identifies itself as SDK V3.2, released 2020-06-01. It includes C#, C++, Delphi, Visual Basic, Java, Python and Linux examples. The supplied SDK binaries include:

- Windows x86 and x64 `CFHidApi.dll`, `YPDHidApi.dll` and newer `SWHidApi.dll` libraries.
- Linux x86/x64 `libCFHidApi.so`, `libSWHidApi.so`, static libraries, `libusb` and HIDAPI material.
- ARM/Raspberry Pi 32-bit and 64-bit `libSWHidApi.so` libraries in the Python archive.
- No macOS `.dylib`, universal binary, Intel macOS binary, Apple Silicon binary, or macOS example.

The Windows C++ SDK requires the Microsoft Visual C++ 2008 Redistributable according to its README.

## Transport and device identity

The SDK uses USB HID. The Windows library contains the device identity `VID_1A86&PID_E010`. Linux examples link against HIDAPI/libusb. The vendor SDK does not include the raw HID report command protocol used for inventory and EPC writes; those commands are encapsulated inside the native library.

Although the device class is compatible with WebHID discovery in principle, implementing direct WebHID writes would require inventing or reverse-engineering undocumented command packets. Race Upshot therefore uses the documented native API through an authenticated loopback bridge instead of sending unverified browser packets.

## Verified SDK API surface

The vendor header, C# declarations, Python examples, Linux example and DLL guide consistently identify these relevant calls:

| Operation | SDK function |
| --- | --- |
| Enumerate readers | `SWHid_GetUsbCount`, `SWHid_GetUsbInfo` |
| Open/close reader | `SWHid_OpenDevice`, `SWHid_CloseDevice` |
| Firmware/hardware/SN | `SWHid_GetDeviceSystemInfo` |
| Set answer/active mode | `SWHid_SetDeviceOneParam` with parameter address `2` |
| Start/stop active inventory | `SWHid_StartRead`, `SWHid_StopRead` |
| Clear/read active buffer | `SWHid_ClearTagBuf`, `SWHid_GetTagBuf` |
| Answer-mode inventory | `SWHid_InventoryG2` |
| Write EPC | `SWHid_WriteEPCG2` |
| Read EPC/TID/user memory | `SWHid_ReadCardG2` (`Mem`: 0 reserved, 1 EPC, 2 TID, 3 user) |
| General memory write | `SWHid_WriteCardG2` |

The bridge deliberately implements only discovery, device metadata, inventory, EPC/TID read and EPC write. It does not expose reserved memory, passwords, kill, lock, relay, firmware upgrade, frequency or arbitrary memory writes.

The SDK examples use reader address `0xFF`, a four-byte access password, and EPC length expressed in 16-bit words. The example writes 12 EPC bytes as six words. Race Upshot validates even-length hexadecimal input and passes exactly the operator-requested bytes without silent padding or truncation.

## Inventory packet format

The examples document each result as a one-byte packet length followed by tag type, antenna, EPC data and RSSI. If bit `0x80` is set in the type byte, six timestamp bytes follow the RSSI area. The local bridge implements bounds checks and rejects truncated or invalid packets.

## Presence state and six-inch calibration

Continuous inventory responses are raw hardware observations, not accepted scan events. The shared RFID core now maintains presence by TID when available and EPC otherwise:

- `OUT_OF_RANGE` to `IN_RANGE` emits one accepted entry event.
- Further raw reads update presence but are marked `DUPLICATE_IN_RANGE` and do not emit another accepted event.
- A tag must be absent for the configured timeout (default 1,000 ms) before an `EXIT_DETECTED` transition resets it for re-entry.
- Antenna allowlisting and minimum RSSI filtering occur before presence acceptance. Raw decisions remain observable for calibration and diagnostics.

The detection profile exposes desired RF power, antenna IDs, a maximum 15.24 cm target, absence timeout, duplicate suppression, re-entry, RSSI threshold and physical calibration evidence. The audited SDK surface does **not** contain a verified RF-power setter, so the bridge reports `rfPowerApplied: false` and `hardwareRangeGuaranteed: false`. Do not infer distance from RSSI. Use a validated near-field antenna, RF shielding, or a vendor-confirmed power-control API and physically test representative chips at 2, 4, 6, 8 and 12 inches before marking the profile calibrated.

## Race Upshot integration

The bridge source is at `tools/ru5600-bridge/bridge.py`. It:

- binds to loopback only;
- requires a bearer token of at least 24 characters;
- restricts CORS to configured trusted origins;
- serializes reader operations with a process lock;
- uses only the documented `SWHidApi` functions;
- requires exactly one EPC before writing;
- verifies the requested EPC through a fresh inventory read;
- returns `UNKNOWN_OUTCOME` when a write succeeds but verification cannot establish the final state;
- excludes access passwords from local audit logs;
- never presents a mock reader as hardware.

Verified bridge results are recorded through authenticated Race Upshot APIs. A permanent chip inventory row is created only when the requested EPC exactly equals the verified read-back EPC. A cloud duplicate detected after a physical write is retained as an unknown outcome requiring reconciliation.

## Platform status

- **Windows x64/x86:** adapter implemented against the supplied DLL; physical validation pending.
- **Linux x64/x86/ARM:** API-compatible native libraries supplied; bridge implementation is compatible in design; physical validation pending.
- **macOS Intel/Apple Silicon:** unsupported by this SDK. Direct WebHID remains disabled because the raw report protocol is undocumented. Do not claim macOS compatibility.

## Required physical acceptance tests

Before race-day production use, validate on the actual RU5600 and representative timing chips: device enumeration; reconnect; firmware/SN; single and continuous inventory; EPC packet length; RSSI/antenna; exactly-one-tag write gating; default and protected access-password behavior; variable EPC lengths supported by the tag; write/read-back; device removal during write; unknown-outcome reconciliation; repeated physical chip detection by TID; and bulk removal/replacement behavior.

## EPC profiles and volunteer assignment

The shared `@race-technology/rfid-core` package now owns EPC validation, reversible profile-based chip-number encoding/decoding, sequence generation, reader adapter contracts, and common RFID types. Race Upshot keeps inventory, authentication, participants, and timing mappings outside that hardware package.

An EPC profile cannot be used for chip-number encoding unless an operator marks it physically verified and records the sample evidence. Validate at least three printed chip numbers against their complete EPC reads. Unmatched reads display `UNKNOWN EPC FORMAT`; Race Upshot never converts the complete hexadecimal EPC to decimal or strips an unknown prefix.

Volunteer manual and QR assignments resolve through verified Race Upshot inventory and persist both the complete EPC and the human-readable chip number. Reader assignment is visible but remains unavailable on mobile until a trusted administrator-configured HTTPS bridge and authenticated pairing service are available. Arbitrary bridge URLs and pairing tokens are deliberately not accepted in the volunteer app.
