# Race Upshot RU5600 local bridge

This bridge calls the vendor's documented `SWHidApi` functions. It is required because the SDK exposes the RU5600 HID protocol through native libraries and does not document the raw HID report/command format needed for a safe WebHID implementation.

The bridge binds to `127.0.0.1` only, requires a bearer token, restricts browser origins, serializes operations, and appends write outcomes to a local JSONL audit. It never reports a write as verified without an exact EPC inventory read-back.

## Supported SDK hosts

- Windows x64: vendor `SWHidApi.dll` from `Python/X64/USB`.
- Windows x86: vendor `SWHidApi.dll` from `Python/X86/USB` with matching 32-bit Python.
- Linux x64 and ARM/Raspberry Pi: corresponding vendor `libSWHidApi.so`.
- macOS Intel/Apple Silicon: unsupported by the supplied SDK. No `.dylib`, macOS source, or documented raw HID command protocol is supplied.

Do not use the Linux `.so` or Windows `.dll` on macOS.

## Windows x64 start

Install 64-bit Python 3.10 or newer, then run PowerShell with values appropriate to the machine:

```powershell
$env:RU5600_SDK_LIBRARY = "C:\RU5600\SWHidApi.dll"
$env:RU5600_BRIDGE_TOKEN = "generate-a-random-token-with-at-least-24-characters"
$env:RU5600_TRUSTED_ORIGINS = "https://raceupshot.hidden-limit-41e6.workers.dev,http://localhost:3001"
python .\tools\ru5600-bridge\bridge.py
```

The Visual C++ 2008 Redistributable required by the vendor library may also need to be installed. Keep the bearer token private; enter it only in the authenticated Race Upshot RFID Reader Settings screen.

## API

All endpoints require `Authorization: Bearer <RU5600_BRIDGE_TOKEN>`.

- `GET /v1/status`
- `GET /v1/devices`
- `POST /v1/connect` with `{ "index": 0 }`
- `POST /v1/disconnect`
- `POST /v1/read-once`
- `POST /v1/inventory/start`
- `GET /v1/inventory/poll`
- `POST /v1/inventory/stop`
- `POST /v1/write-epc` with `{ "currentEpc": "...", "requestedEpc": "...", "accessPassword": "00000000" }`

Access passwords are used in memory only and deliberately excluded from audit records.
