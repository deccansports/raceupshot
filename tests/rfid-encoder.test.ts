import { afterEach, describe, expect, it, vi } from "vitest";
import { generateEpcSequence, MockRu5600Adapter, normalizeEpc, UnavailableRu5600Adapter, validateEpc } from "../lib/rfid-encoder-core";
import { Ru5600LocalBridgeAdapter } from "../lib/ru5600-local-bridge";

afterEach(() => vi.unstubAllGlobals());

describe("RFID EPC validation and allocation", () => {
  it("normalizes whitespace and lowercase without changing content", () => {
    expect(normalizeEpc("30 08 ab cd")).toBe("3008ABCD");
  });

  it("rejects invalid and unexpectedly sized EPC values", () => {
    expect(() => validateEpc("3008-ZZ")).toThrow(/hexadecimal/i);
    expect(() => validateEpc("30080", 6)).toThrow(/16-bit words/i);
    expect(() => validateEpc("3008", 8)).toThrow(/exactly 8/i);
    expect(validateEpc("ABCD")).toBe("ABCD");
    expect(() => validateEpc("AB".repeat(43))).toThrow(/2–42 bytes/i);
  });

  it("generates a unique explicit sequence without truncation", () => {
    expect(generateEpcSequence({ prefix: "3008", startingSequence: "1", digits: 8, increment: 1, total: 4, epcLength: 12 })).toEqual([
      "300800000001", "300800000002", "300800000003", "300800000004",
    ]);
  });

  it("rejects sequence overflow and length mismatches", () => {
    expect(() => generateEpcSequence({ prefix: "30", startingSequence: "99", digits: 2, increment: 1, total: 2, epcLength: 4 })).toThrow(/exceeds/i);
    expect(() => generateEpcSequence({ prefix: "3008", startingSequence: "1", digits: 8, increment: 1, total: 1, epcLength: 24 })).toThrow(/exactly 24/i);
  });
});
describe("RU5600 adapter boundary", () => {
  it("never reports the production placeholder as connected", async () => {
    const adapter = new UnavailableRu5600Adapter();
    expect(adapter.isConnected()).toBe(false);
    expect(adapter.info.simulation).toBe(false);
    await expect(adapter.connect()).rejects.toThrow(/SDK/i);
    expect(adapter.isConnected()).toBe(false);
  });

  it("clearly labels simulation and verifies test writes by read-back", async () => {
    const adapter = new MockRu5600Adapter([{ epc: "300800000001", tid: "E2000011", readAt: "2026-10-16T00:00:00.000Z" }]);
    expect(adapter.info.simulation).toBe(true);
    await adapter.connect();
    const result = await adapter.writeEpc("300800000001", "300800000002");
    expect(result.status).toBe("VERIFIED");
    expect((await adapter.readOnce())[0].epc).toBe("300800000002");
    await adapter.disconnect();
    await expect(adapter.readOnce()).rejects.toThrow(/disconnected/i);
  });

  it("fails a test write when the target tag is absent", async () => {
    const adapter = new MockRu5600Adapter([]);
    await adapter.connect();
    await expect(adapter.writeEpc("300800000001", "300800000002")).resolves.toMatchObject({ status: "FAILED" });
  });

  it("authenticates local bridge requests and exposes a physical, non-simulated reader", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: [{ index: 0, sdkInfo: "VID_1A86&PID_E010", available: true }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { index: 0, model: "INVETON RU5600", serialNumber: "01020304050607", firmwareVersion: "3.2", hardwareVersion: "1.0" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new Ru5600LocalBridgeAdapter("http://127.0.0.1:8765", "test-token-with-at-least-24-characters");
    expect(await adapter.listDevices()).toHaveLength(1);
    const info = await adapter.connect();
    expect(info).toMatchObject({ transport: "LOCAL_BRIDGE", simulation: false, serialNumber: "01020304050607" });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-token-with-at-least-24-characters");
  });
});
