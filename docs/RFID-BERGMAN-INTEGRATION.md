# Race Upshot signed RFID bridge integration

Source reference: BERGMAN `19ba84ce4eba48935a61ba69b8d99a74c19a7d2c`.

The native macOS HID probe and Windows CFHidApi bridge are adapted source code, not a copy of BERGMAN credentials, services, participant data, or inventory. Race Upshot uses port 8766, RACEUPSHOT_RFID_* configuration, and its own origin allowlist. Existing SWHidApi sessions remain selectable on port 8765.

## Implemented locally

- macOS browser pairing and signed-protocol reader connection/read UI.
- Reader connection polling, stale selection clearing, serialized scan polling.
- Source for same-TID, same-length, signed-permit native writes and signed reviews.
- Pure reservation/settlement state transitions and signature verification, with regression tests.

## Pending approval

The backend reservation coordinator and inventory migration were blocked by automatic approval review. The state-transition module is not connected to production storage. Signed writes are disabled in the UI and unsigned calls to the signed adapter fail before hardware access. Existing inventory and transaction API behavior has not been migrated.

The auto-start installer was also blocked by automatic approval review. No LaunchAgent, service, pairing key, or signing secret was installed by this integration. No hardware write or cloud deployment was performed.

## Manual macOS development setup

Compile `tools/rfid-bridge-macos/hid_probe.c` with clang, IOKit and CoreFoundation into `tools/rfid-bridge-macos/bin/raceupshot-rfid-hid-probe`. Its `--self-test` mode uses synthetic protocol packets and does not access USB hardware.

Start `node tools/rfid-bridge-macos/bridge.mjs` with a separately generated `RACEUPSHOT_RFID_BRIDGE_KEY` supplied securely in the local environment. The default allowlist includes Race Upshot production origins and localhost:3001. Enter the local pairing code in Admin → RFID Encoder → Reader Settings. Do not use or copy BERGMAN pairing credentials.

Writing additionally requires a separately provisioned `RACEUPSHOT_RFID_SIGNING_SECRET` on both bridge and backend and physical acceptance validation. Do not enable `RACEUPSHOT_RFID_MACOS_WRITE_VALIDATED` until the Race Upshot setup passes single-tag, multi-tag rejection, write/read-back, same-TID, reconnect, and interrupted-write recovery checks.

## Windows

Build `tools/rfid-bridge-windows/RfidBridge.csproj` using .NET 8 on Windows with the vendor x64 CFHidApi.dll installed separately. Configure RACEUPSHOT_RFID_BRIDGE_KEY, RACEUPSHOT_RFID_SIGNING_SECRET and RACEUPSHOT_RFID_ALLOWED_ORIGIN securely on that machine. Use the bridge key in Reader Settings. Writes require RACEUPSHOT_RFID_WINDOWS_WRITE_VALIDATED=1 after physical acceptance. This adapter has not been tested on Windows hardware here.

## Hardware boundary

BERGMAN reports successful tests on one macOS reader/chip. That is reference evidence, not validation of this Race Upshot installation. Mac writes only support 96-bit EPC/TID and identical replacement length. Two tags sharing the same EPC may evade EPC-based inventory separation; physically isolate one tag. Production enablement requires the pending backend integration and operator acceptance tests.
