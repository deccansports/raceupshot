# Race Upshot RU5600 local bridge

Race Upshot uses an isolated macOS LaunchAgent (`com.raceupshot.rfid-bridge`) bound only to `127.0.0.1:8766`. It does not share BERGMAN ports, Keychain services, logs, pairing tokens, or data.

The native probe accepts whole-word EPCs from 2 through 42 bytes, reads the Stored PC word and 12-byte TID, rejects multiple tags, preserves the reader's original work mode, and uses only the RU5600 vendor HID interface (VID `1A86`, PID `E010`, usage page `FF00`, usage `1`). It never writes TID. Length changes stage EPC data before changing the Stored PC length bits and require same-TID EPC/PC read-back.

## Install and maintain

```sh
node tools/rfid-bridge-macos/setup.mjs
node tools/rfid-bridge-macos/update.mjs
node tools/rfid-bridge-macos/diagnostics.mjs
node tools/rfid-bridge-macos/diagnostics.mjs --read-one
node tools/rfid-bridge-macos/update-origins.mjs https://trusted.raceupshot.com
node tools/rfid-bridge-macos/rotate-pairing.mjs
node tools/rfid-bridge-macos/uninstall.mjs --confirm-raceupshot-rfid-uninstall
```

Default allowed origins are `https://raceupshot.com`, `https://www.raceupshot.com`, `https://raceupshot.hidden-limit-41e6.workers.dev`, and `http://localhost:3001`. Add only exact trusted origins.

Automatic Admin pairing creates a 24-character, origin-bound code valid for two minutes. Browser tokens are persisted only as hashes. Retrying a successful redemption during that two-minute window returns the same token, allowing recovery when the first HTTP response is lost. The Admin verifies that token through authenticated `/status` before displaying success and can revoke it through `/unpair`.

## Guarded writing

Writing remains disabled after installation. First complete an approved physical same-TID EPC/PC write, read-back, interrupted-write review, multiple-tag rejection, and USB reconnect test using a designated test tag. Then configure the same server-only secret in Cloudflare and Keychain without printing it:

```sh
npx wrangler secret put RACEUPSHOT_RFID_SIGNING_SECRET
RACEUPSHOT_RFID_SIGNING_SECRET='use-the-same-32-plus-character-secret' \
  node tools/rfid-bridge-macos/enable-local-write.mjs --accept-physical-write-validation
launchctl kickstart -k "gui/$(id -u)/com.raceupshot.rfid-bridge"
```

The Admin performs a signing preflight before reserving an EPC. A physical write then requires an authenticated admin, a fresh EPC/PC/TID scan, one reader and one tag, an atomic backend reservation, a short-lived HMAC permit, explicit confirmation, and same-TID EPC/PC read-back. A missing or uncertain response stays unresolved and must be reviewed with the same physical tag; it is never automatically retried.

## Validation without writing

```sh
clang -Wall -Wextra -Werror -O2 -framework IOKit -framework CoreFoundation \
  tools/rfid-bridge-macos/hid_probe.c -o /private/tmp/raceupshot-rfid-hid-probe
/private/tmp/raceupshot-rfid-hid-probe --self-test
node --test tools/rfid-bridge-macos/bridge-pairing.contract.test.mjs
```

Neither command writes a physical tag. Do not set `RACEUPSHOT_RFID_HARDWARE_TEST_EPC`, enable the write-validation marker, or deploy backend changes without explicit authorization.
