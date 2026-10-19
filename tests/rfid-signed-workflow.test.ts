import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyRfidCommand, emptyRfidLedger, expectedStoredPc } from '../lib/rfid-ledger';
import { rfidSignature, verifyRfidSignature } from '../lib/rfid-signing';
import { Ru5600SignedBridgeAdapter } from '../lib/ru5600-signed-bridge';

const reserve = { action: 'reserve' as const, originalEpc: '000000000000000000000001', originalPc: '3000', requestedEpc: '000000000000000000000002', tid: 'E20000000000000000000001', readerId: 'test-reader' };
describe('signed RFID workflow', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('reserves EPC and TID across simultaneous operator requests', () => {
    const state = emptyRfidLedger();
    applyRfidCommand(state, reserve, 'admin-a', 1000, 'one');
    expect(() => applyRfidCommand(state, { ...reserve, tid: 'E20000000000000000000002' }, 'admin-b', 1001, 'two')).toThrow('unresolved');
    expect(() => applyRfidCommand(state, { ...reserve, requestedEpc: '000000000000000000000003' }, 'admin-b', 1001, 'three')).toThrow('unresolved');
  });
  it('preserves Stored PC flags and changes only the EPC word count', () => {
    expect(expectedStoredPc('3005', '00000001')).toBe('1005');
    expect(expectedStoredPc('1807', '000000000000000000000001')).toBe('3007');
    const state = emptyRfidLedger();
    expect(() => applyRfidCommand(state, { ...reserve, requestedEpc: '00000001' }, 'admin', 1000, 'variable')).not.toThrow();
  });
  it('rejects unsigned or wrong-tag success and retains the reservation', () => {
    const state = emptyRfidLedger(); applyRfidCommand(state, reserve, 'admin', 1000, 'one');
    applyRfidCommand(state, { action: 'settle', transactionId: 'one', epc: reserve.requestedEpc, pc: '3000', tid: reserve.tid, attested: false }, 'admin', 2000);
    expect(state.chips).toHaveLength(0); expect(state.transactions[0].status).toBe('UNKNOWN_OUTCOME');
    expect(() => applyRfidCommand(state, reserve, 'admin', 300000)).toThrow('unresolved');
  });
  it('settles exact signed read-back once without accepting a later downgrade', () => {
    const state = emptyRfidLedger(); applyRfidCommand(state, reserve, 'admin', 1000, 'one');
    const command = { action: 'settle' as const, transactionId: 'one', epc: reserve.requestedEpc, pc: '3000', tid: reserve.tid, attested: true };
    applyRfidCommand(state, command, 'admin', 2000);
    applyRfidCommand(state, command, 'admin', 3000);
    applyRfidCommand(state, { ...command, attested: false }, 'admin', 4000);
    expect(state.chips).toHaveLength(1); expect(state.transactions[0].status).toBe('VERIFIED');
  });
  it('holds an unchanged chip until permit and native write timeout have expired', () => {
    const state = emptyRfidLedger(); applyRfidCommand(state, reserve, 'admin', 1000, 'one');
    const review = { action: 'review' as const, transactionId: 'one', epc: reserve.originalEpc, pc: '3000', tid: reserve.tid, attested: true };
    expect(() => applyRfidCommand(state, review, 'admin', 3000)).toThrow('expire');
    applyRfidCommand(state, review, 'admin', 300000);
    expect(state.transactions[0].status).toBe('FAILED');
    expect(() => applyRfidCommand(state, reserve, 'admin', 300001)).not.toThrow();
  });
  it('binds signatures to transaction, tag, and result', () => {
    const key = 'test-only-secret-'.repeat(3), payload = 'WRITE|one|EPC|TID';
    const signature = rfidSignature(key, payload);
    expect(verifyRfidSignature(key, payload, signature)).toBe(true);
    expect(verifyRfidSignature(key, 'WRITE|two|EPC|TID', signature)).toBe(false);
    expect(verifyRfidSignature(key, payload, 'bad')).toBe(false);
  });
  it('restricts bridge addresses to local origins and prevents unsigned writes', async () => {
    expect(() => new Ru5600SignedBridgeAdapter('https://example.com', 'token')).toThrow('loopback');
    expect(() => new Ru5600SignedBridgeAdapter('http://localhost:8766/other', 'token')).toThrow('loopback');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const bridge = new Ru5600SignedBridgeAdapter('http://127.0.0.1:8766', 'token');
    await expect(bridge.writeEpc()).rejects.toThrow('reservation backend');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses origin-scoped pairing then validates live EPC and TID reads', async () => {
    const token = 'a'.repeat(64);
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ token })).mockResolvedValueOnce(Response.json({ state: 'CONNECTED', availableReaders: 1, canReadEpc: true, canWriteEpc: false })).mockResolvedValueOnce(Response.json({ state: 'CONNECTED', availableReaders: 1, canReadEpc: true, canWriteEpc: false })).mockResolvedValueOnce(Response.json({ tags: [{ epc: reserve.originalEpc, tid: reserve.tid, pc: '3000', readAt: new Date().toISOString() }] }));
    vi.stubGlobal('fetch', fetch);
    expect(await Ru5600SignedBridgeAdapter.pair('http://127.0.0.1:8766', 'local-code')).toBe(token);
    const bridge = new Ru5600SignedBridgeAdapter('http://127.0.0.1:8766', token);
    await bridge.connect();
    expect(await bridge.readOnce()).toHaveLength(1);
    expect(fetch.mock.calls[3][1].headers['X-RFID-Bridge-Key']).toBe(token);
  });
  it('generates and automatically redeems a two-minute macOS pairing code', async () => {
    const token = 'b'.repeat(64);
    const code = 'abcdefghijklmnopqrstuvwx';
    const expiresAt = new Date(Date.now() + 120_000).toISOString();
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ code, expiresAt }))
      .mockResolvedValueOnce(Response.json({ token }))
      .mockResolvedValueOnce(Response.json({ state: 'DISCONNECTED', availableReaders: 0 }));
    vi.stubGlobal('fetch', fetch);
    const onGenerated = vi.fn();
    await expect(Ru5600SignedBridgeAdapter.automaticPair('http://localhost:8766', onGenerated)).resolves.toEqual({ code, expiresAt, token });
    expect(onGenerated).toHaveBeenCalledWith({ code, expiresAt });
    expect(fetch.mock.calls[0][0]).toBe('http://localhost:8766/pair-code');
    expect(fetch.mock.calls[1][0]).toBe('http://localhost:8766/pair');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ code });
  });
  it('keeps generated bridge codes origin-bound, short-lived and idempotent after redemption', () => {
    const source = readFileSync(new URL('../tools/rfid-bridge-macos/bridge.mjs', import.meta.url), 'utf8');
    expect(source).toContain('oneTimePairingLifetimeMs = 2 * 60 * 1000');
    expect(source).toContain('oneTimePairingCodes.set(origin');
    expect(source).toContain('pendingCode.expiresAt > Date.now()');
    expect(source).toContain('pendingCode.token');
    expect(source).toContain('pendingCode.redeemed = true');
  });
  it('keeps the active RFID encoder local and removes cloud inventory UI and loading', () => {
    const source = readFileSync(new URL('../components/rfid-encoder-admin.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('/api/admin/rfid/overview');
    expect(source).not.toContain('Chip inventory');
    expect(source).not.toContain('/api/admin/rfid/export');
    expect(source).not.toContain('SAVE DRAFT PLAN');
  });
  it('requires a signed cloud permit for every physical write', async () => {
    const token = 'a'.repeat(64);
    const shorterEpc = '000000000002';
    const after = { epc: shorterEpc, tid: reserve.tid, pc: '1800', readAt: new Date().toISOString() };
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ state: 'CONNECTED', availableReaders: 1, canReadEpc: true, canWriteEpc: true }))
      .mockResolvedValueOnce(Response.json({ after, attestation: 'B'.repeat(64) }));
    vi.stubGlobal('fetch', fetch);
    const bridge = new Ru5600SignedBridgeAdapter('http://127.0.0.1:8766', token);
    await bridge.connect();
    const permit = { transactionId: 'tx-1', expiresAtMs: Date.now() + 60_000, signature: 'A'.repeat(64) };
    expect(await bridge.writeWithPermit({ epc: reserve.originalEpc, tid: reserve.tid, pc: '3000', readAt: after.readAt }, shorterEpc, permit)).toEqual({ after, attestation: 'B'.repeat(64) });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe('http://127.0.0.1:8766/write');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ currentEpc: reserve.originalEpc, newEpc: shorterEpc, tid: reserve.tid, transactionId: 'tx-1' });
  });
});
