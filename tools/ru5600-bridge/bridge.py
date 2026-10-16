#!/usr/bin/env python3
"""Authenticated localhost bridge for the INVETON RU5600 SWHidApi SDK.

The process binds to loopback only. It never emulates a reader and reports a
write as VERIFIED only after an exact EPC inventory read-back.
"""

from __future__ import annotations

import ctypes
import hashlib
import hmac
import json
import os
import platform
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ADDRESS = 0xFF
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
MAX_BODY = 32 * 1024


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def clean_hex(value: Any, field: str, exact_bytes: int | None = None) -> str:
    text = "".join(str(value or "").split()).upper()
    if not text or any(character not in "0123456789ABCDEF" for character in text):
        raise ValueError(f"{field} must be hexadecimal.")
    if len(text) % 2:
        raise ValueError(f"{field} must contain an even number of hexadecimal characters.")
    if exact_bytes is not None and len(text) != exact_bytes * 2:
        raise ValueError(f"{field} must be exactly {exact_bytes * 2} hexadecimal characters.")
    return text


class ReaderError(RuntimeError):
    pass


class Ru5600Native:
    def __init__(self, library_path: str):
        self.library_path = str(Path(library_path).expanduser().resolve())
        if not Path(self.library_path).is_file():
            raise ReaderError(f"SDK library not found: {self.library_path}")
        if platform.system() == "Windows":
            self.lib = ctypes.WinDLL(self.library_path)
        else:
            self.lib = ctypes.CDLL(self.library_path)
        self.connected = False
        self.device_index: int | None = None
        self.inventory_active = False
        self._configure_functions()

    def _configure_functions(self) -> None:
        u8p = ctypes.POINTER(ctypes.c_ubyte)
        self.lib.SWHid_GetUsbCount.argtypes = []
        self.lib.SWHid_GetUsbCount.restype = ctypes.c_int
        self.lib.SWHid_GetUsbInfo.argtypes = [ctypes.c_ushort, u8p]
        self.lib.SWHid_GetUsbInfo.restype = ctypes.c_bool
        self.lib.SWHid_OpenDevice.argtypes = [ctypes.c_ushort]
        self.lib.SWHid_OpenDevice.restype = ctypes.c_bool
        self.lib.SWHid_CloseDevice.argtypes = []
        self.lib.SWHid_CloseDevice.restype = ctypes.c_bool
        self.lib.SWHid_GetDeviceSystemInfo.argtypes = [ctypes.c_ubyte, u8p]
        self.lib.SWHid_GetDeviceSystemInfo.restype = ctypes.c_bool
        self.lib.SWHid_SetDeviceOneParam.argtypes = [ctypes.c_ubyte, ctypes.c_ubyte, ctypes.c_ubyte]
        self.lib.SWHid_SetDeviceOneParam.restype = ctypes.c_bool
        self.lib.SWHid_StopRead.argtypes = [ctypes.c_ubyte]
        self.lib.SWHid_StopRead.restype = ctypes.c_bool
        self.lib.SWHid_StartRead.argtypes = [ctypes.c_ubyte]
        self.lib.SWHid_StartRead.restype = ctypes.c_bool
        self.lib.SWHid_ClearTagBuf.argtypes = []
        self.lib.SWHid_ClearTagBuf.restype = ctypes.c_bool
        self.lib.SWHid_GetTagBuf.argtypes = [u8p, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int)]
        self.lib.SWHid_GetTagBuf.restype = ctypes.c_ubyte
        self.lib.SWHid_InventoryG2.argtypes = [ctypes.c_ubyte, u8p, ctypes.POINTER(ctypes.c_ushort), ctypes.POINTER(ctypes.c_ushort)]
        self.lib.SWHid_InventoryG2.restype = ctypes.c_bool
        self.lib.SWHid_WriteEPCG2.argtypes = [ctypes.c_ubyte, u8p, u8p, ctypes.c_ubyte]
        self.lib.SWHid_WriteEPCG2.restype = ctypes.c_bool
        self.lib.SWHid_ReadCardG2.argtypes = [ctypes.c_ubyte, u8p, ctypes.c_ubyte, ctypes.c_ubyte, ctypes.c_ubyte, u8p]
        self.lib.SWHid_ReadCardG2.restype = ctypes.c_bool

    def devices(self) -> list[dict[str, Any]]:
        count = max(0, int(self.lib.SWHid_GetUsbCount()))
        result = []
        for index in range(count):
            info = (ctypes.c_ubyte * 256)()
            ok = bool(self.lib.SWHid_GetUsbInfo(index, info))
            raw = bytes(info).split(b"\0", 1)[0]
            result.append({"index": index, "sdkInfo": raw.decode("utf-8", "replace") if ok else "", "available": ok})
        return result

    def connect(self, index: int) -> dict[str, Any]:
        if self.connected:
            self.disconnect()
        if index < 0 or index >= int(self.lib.SWHid_GetUsbCount()):
            raise ReaderError("Selected RU5600 device is unavailable.")
        if not self.lib.SWHid_OpenDevice(index):
            raise ReaderError("SWHid_OpenDevice returned failure.")
        self.connected = True
        self.device_index = index
        info = (ctypes.c_ubyte * 128)()
        if not self.lib.SWHid_GetDeviceSystemInfo(ADDRESS, info):
            self.disconnect()
            raise ReaderError("Connected, but SWHid_GetDeviceSystemInfo returned failure.")
        firmware = f"{info[0] >> 4}.{info[0] & 0x0F}"
        hardware = f"{info[1] >> 4}.{info[1] & 0x0F}"
        serial = bytes(info[2:9]).hex().upper()
        return {"index": index, "model": "INVETON RU5600", "firmwareVersion": firmware, "hardwareVersion": hardware, "serialNumber": serial}

    def disconnect(self) -> None:
        if self.connected:
            try:
                if self.inventory_active:
                    self.lib.SWHid_StopRead(ADDRESS)
                self.lib.SWHid_CloseDevice()
            finally:
                self.connected = False
                self.device_index = None
                self.inventory_active = False

    def require_connected(self) -> None:
        if not self.connected:
            raise ReaderError("Reader disconnected.")

    @staticmethod
    def _parse_packets(buffer: Any, total: int, count: int) -> list[dict[str, Any]]:
        tags: list[dict[str, Any]] = []
        offset = 0
        detected = now()
        for _ in range(count):
            if offset >= total:
                raise ReaderError("SDK returned a truncated inventory packet.")
            packet_length = int(buffer[offset])
            end = offset + 1 + packet_length
            if packet_length < 4 or end > total:
                raise ReaderError("SDK returned an invalid inventory packet length.")
            payload = bytes(buffer[offset + 1:end])
            has_timestamp = bool(payload[0] & 0x80)
            id_end = packet_length - 7 if has_timestamp else packet_length - 1
            if id_end < 2:
                raise ReaderError("SDK returned an invalid EPC packet.")
            tags.append({
                "epc": payload[2:id_end].hex().upper(),
                "antenna": int(payload[1]),
                "rssi": int(payload[id_end]),
                "type": int(payload[0]),
                "readAt": detected,
            })
            offset = end
        return tags

    def read_once(self) -> list[dict[str, Any]]:
        self.require_connected()
        if self.inventory_active:
            raise ReaderError("Stop continuous inventory before a single read.")
        if not self.lib.SWHid_SetDeviceOneParam(ADDRESS, 2, 0):
            raise ReaderError("Could not place reader in answer mode.")
        buffer = (ctypes.c_ubyte * 9182)()
        total = ctypes.c_ushort(0)
        count = ctypes.c_ushort(0)
        if not self.lib.SWHid_InventoryG2(ADDRESS, buffer, ctypes.byref(total), ctypes.byref(count)):
            raise ReaderError("SWHid_InventoryG2 returned failure.")
        return self._parse_packets(buffer, int(total.value), int(count.value))

    def start_inventory(self) -> None:
        self.require_connected()
        if not self.lib.SWHid_SetDeviceOneParam(ADDRESS, 2, 1):
            raise ReaderError("Could not place reader in active mode.")
        self.lib.SWHid_ClearTagBuf()
        if not self.lib.SWHid_StartRead(ADDRESS):
            raise ReaderError("SWHid_StartRead returned failure.")
        self.inventory_active = True

    def poll_inventory(self) -> list[dict[str, Any]]:
        self.require_connected()
        if not self.inventory_active:
            raise ReaderError("Continuous inventory is not active.")
        buffer = (ctypes.c_ubyte * 9182)()
        total = ctypes.c_int(0)
        count = ctypes.c_int(0)
        self.lib.SWHid_GetTagBuf(buffer, ctypes.byref(total), ctypes.byref(count))
        return self._parse_packets(buffer, int(total.value), int(count.value)) if count.value else []

    def stop_inventory(self) -> None:
        self.require_connected()
        if self.inventory_active and not self.lib.SWHid_StopRead(ADDRESS):
            raise ReaderError("SWHid_StopRead returned failure.")
        self.inventory_active = False

    def read_tid(self, password_hex: str, words: int) -> str | None:
        password = (ctypes.c_ubyte * 4).from_buffer_copy(bytes.fromhex(password_hex))
        data = (ctypes.c_ubyte * (words * 2))()
        ok = self.lib.SWHid_ReadCardG2(ADDRESS, password, 2, 0, words, data)
        return bytes(data).hex().upper() if ok else None

    def write_epc(self, current_epc: str, requested_epc: str, password_hex: str) -> dict[str, Any]:
        self.require_connected()
        if self.inventory_active:
            self.stop_inventory()
        requested = clean_hex(requested_epc, "requestedEpc")
        current = clean_hex(current_epc, "currentEpc")
        before = self.read_once()
        unique = {tag["epc"] for tag in before}
        if len(unique) != 1:
            raise ReaderError(f"Exactly one chip is required; detected {len(unique)} unique EPCs.")
        observed = next(iter(unique))
        if observed != current:
            raise ReaderError(f"Current EPC mismatch. Expected {current}, read {observed}.")
        password = (ctypes.c_ubyte * 4).from_buffer_copy(bytes.fromhex(password_hex))
        epc_bytes = bytes.fromhex(requested)
        epc = (ctypes.c_ubyte * len(epc_bytes)).from_buffer_copy(epc_bytes)
        transaction_id = str(uuid.uuid4())
        started_at = now()
        if not self.lib.SWHid_WriteEPCG2(ADDRESS, password, epc, len(epc_bytes) // 2):
            return {"transactionId": transaction_id, "status": "FAILED", "originalEpc": observed, "requestedEpc": requested, "startedAt": started_at, "completedAt": now(), "sdkResponse": "SWHid_WriteEPCG2=0", "error": "SDK memory write failure."}
        time.sleep(float(os.environ.get("RU5600_VERIFY_DELAY_SECONDS", "0.35")))
        try:
            after = self.read_once()
        except Exception as error:
            return {"transactionId": transaction_id, "status": "UNKNOWN_OUTCOME", "originalEpc": observed, "requestedEpc": requested, "startedAt": started_at, "completedAt": now(), "sdkResponse": "SWHid_WriteEPCG2=1", "error": f"Write returned success but verification could not run: {error}"}
        verified = {tag["epc"] for tag in after}
        if verified == {requested}:
            tid = self.read_tid(password_hex, int(os.environ.get("RU5600_TID_WORDS", "6")))
            return {"transactionId": transaction_id, "status": "VERIFIED", "originalEpc": observed, "requestedEpc": requested, "verifiedEpc": requested, "tid": tid, "startedAt": started_at, "completedAt": now(), "sdkResponse": "SWHid_WriteEPCG2=1; exact inventory read-back", "verificationResult": "MATCH"}
        return {"transactionId": transaction_id, "status": "UNKNOWN_OUTCOME", "originalEpc": observed, "requestedEpc": requested, "verifiedEpc": next(iter(verified), ""), "startedAt": started_at, "completedAt": now(), "sdkResponse": "SWHid_WriteEPCG2=1", "verificationResult": "MISMATCH", "error": "Write returned success but exact EPC read-back did not match."}


class BridgeState:
    def __init__(self):
        token = os.environ.get("RU5600_BRIDGE_TOKEN", "")
        if len(token) < 24:
            raise SystemExit("RU5600_BRIDGE_TOKEN must contain at least 24 characters.")
        library = os.environ.get("RU5600_SDK_LIBRARY", "")
        if not library:
            raise SystemExit("RU5600_SDK_LIBRARY must point to SWHidApi.dll or libSWHidApi.so.")
        self.token = token
        self.allowed_origins = {origin.strip() for origin in os.environ.get("RU5600_TRUSTED_ORIGINS", "https://raceupshot.hidden-limit-41e6.workers.dev,http://localhost:3001").split(",") if origin.strip()}
        self.reader = Ru5600Native(library)
        self.lock = threading.Lock()
        self.audit_path = Path(os.environ.get("RU5600_AUDIT_LOG", str(Path.home() / ".raceupshot" / "ru5600-audit.jsonl"))).expanduser()
        self.audit_path.parent.mkdir(parents=True, exist_ok=True)

    def audit(self, action: str, result: dict[str, Any]) -> None:
        safe = {key: value for key, value in result.items() if key not in {"accessPassword", "token"}}
        with self.audit_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"at": now(), "action": action, **safe}, separators=(",", ":")) + "\n")


STATE: BridgeState


class Handler(BaseHTTPRequestHandler):
    server_version = "RaceUpshotRU5600Bridge/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[{now()}] {self.address_string()} {fmt % args}")

    def _origin(self) -> str:
        return self.headers.get("Origin", "")

    def _origin_allowed(self) -> bool:
        origin = self._origin()
        return not origin or origin in STATE.allowed_origins

    def _cors(self) -> None:
        origin = self._origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        if not self._origin_allowed():
            status = 403
            payload = {"ok": False, "error": "Origin not allowed."}
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        supplied = self.headers.get("Authorization", "").removeprefix("Bearer ")
        return bool(supplied) and hmac.compare_digest(hashlib.sha256(supplied.encode()).digest(), hashlib.sha256(STATE.token.encode()).digest())

    def _body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0 or length > MAX_BODY:
            raise ValueError("Request body is too large.")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_OPTIONS(self) -> None:
        self.send_response(204 if self._origin_allowed() else 403)
        self._cors()
        self.send_header("Access-Control-Allow-Headers", "authorization,content-type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self) -> None:
        if not self._authorized():
            return self._send(401, {"ok": False, "error": "Bridge authentication required."})
        try:
            with STATE.lock:
                if self.path == "/v1/status":
                    return self._send(200, {"ok": True, "data": {"bridgeVersion": "1.0", "sdk": "SWHidApi", "connected": STATE.reader.connected, "inventoryActive": STATE.reader.inventory_active, "deviceIndex": STATE.reader.device_index, "platform": platform.platform()}})
                if self.path == "/v1/devices":
                    return self._send(200, {"ok": True, "data": STATE.reader.devices()})
                if self.path == "/v1/inventory/poll":
                    return self._send(200, {"ok": True, "data": STATE.reader.poll_inventory()})
            return self._send(404, {"ok": False, "error": "Unknown bridge endpoint."})
        except (ReaderError, ValueError) as error:
            return self._send(409, {"ok": False, "error": str(error)})
        except Exception as error:
            return self._send(500, {"ok": False, "error": f"Bridge operation failed: {error}"})

    def do_POST(self) -> None:
        if not self._authorized():
            return self._send(401, {"ok": False, "error": "Bridge authentication required."})
        try:
            body = self._body()
            with STATE.lock:
                if self.path == "/v1/connect":
                    result = STATE.reader.connect(int(body.get("index", 0)))
                elif self.path == "/v1/disconnect":
                    STATE.reader.disconnect(); result = {"connected": False}
                elif self.path == "/v1/read-once":
                    result = {"tags": STATE.reader.read_once()}
                elif self.path == "/v1/inventory/start":
                    STATE.reader.start_inventory(); result = {"inventoryActive": True}
                elif self.path == "/v1/inventory/stop":
                    STATE.reader.stop_inventory(); result = {"inventoryActive": False}
                elif self.path == "/v1/write-epc":
                    password = clean_hex(body.get("accessPassword", "00000000"), "accessPassword", 4)
                    result = STATE.reader.write_epc(body.get("currentEpc", ""), body.get("requestedEpc", ""), password)
                    STATE.audit("WRITE_EPC", result)
                else:
                    return self._send(404, {"ok": False, "error": "Unknown bridge endpoint."})
            return self._send(200, {"ok": True, "data": result})
        except (ReaderError, ValueError, json.JSONDecodeError) as error:
            STATE.audit("OPERATION_REJECTED", {"path": self.path, "error": str(error)})
            return self._send(409, {"ok": False, "error": str(error)})
        except Exception as error:
            STATE.audit("OPERATION_ERROR", {"path": self.path, "error": str(error)})
            return self._send(500, {"ok": False, "error": f"Bridge operation failed: {error}"})


def main() -> None:
    global STATE
    STATE = BridgeState()
    host = os.environ.get("RU5600_BRIDGE_HOST", DEFAULT_HOST)
    if host not in {"127.0.0.1", "::1", "localhost"}:
        raise SystemExit("RU5600 bridge must bind to loopback only.")
    port = int(os.environ.get("RU5600_BRIDGE_PORT", str(DEFAULT_PORT)))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Race Upshot RU5600 bridge listening on http://{host}:{port}")
    print(f"Trusted origins: {', '.join(sorted(STATE.allowed_origins))}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        STATE.reader.disconnect()
        server.server_close()


if __name__ == "__main__":
    main()
