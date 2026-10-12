import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ env: { AISENSY_API_KEY: 'test-secret-only' } }));
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: async () => ({ env: state.env }) }));
import { normalizeAiSensyPhone, sendAiSensyWhatsApp } from '../lib/aisensy-whatsapp';
const input = { recipientPhone: '+33766541632', userName: 'Athlete', campaignName: 'live_campaign', parameters: ['Athlete', '1001'] };
describe('AiSensy server sender', () => {
  beforeEach(() => { state.env.AISENSY_API_KEY = 'test-secret-only'; });
  afterEach(() => vi.unstubAllGlobals());
  it('preserves international country codes and supports Indian local numbers', () => {
    expect(normalizeAiSensyPhone('+33766541632')).toBe('+33766541632');
    expect(normalizeAiSensyPhone('00919876543210')).toBe('+919876543210');
    expect(normalizeAiSensyPhone('9876543210')).toBe('+919876543210');
    expect(normalizeAiSensyPhone('invalid')).toBe('');
  });
  it('sends ordered campaign params and saved PDF to the fixed endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 })); vi.stubGlobal('fetch', fetcher);
    expect(await sendAiSensyWhatsApp({ ...input, document: { link: 'https://files.example.com/signed.pdf', filename: 'signed.pdf' } })).toMatchObject({ accepted: true });
    expect(fetcher.mock.calls[0][0]).toBe('https://backend.aisensy.com/campaign/t1/api/v2');
    expect(fetcher.mock.calls[0][1].redirect).toBe('manual');
    expect(fetcher.mock.calls[0][1].headers).toMatchObject({ accept: 'application/json', 'content-type': 'application/json' });
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ apiKey: 'test-secret-only', campaignName: 'live_campaign', destination: '+33766541632', userName: 'Athlete', source: 'Race Upshot Volunteer', templateParams: ['Athlete', '1001'], media: { url: 'https://files.example.com/signed.pdf', filename: 'signed.pdf' } });
  });
  it('does not send without a secret or campaign', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await sendAiSensyWhatsApp({ ...input, campaignName: '' })).accepted).toBe(false);
    state.env.AISENSY_API_KEY = '';
    expect((await sendAiSensyWhatsApp(input)).accepted).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not expose provider errors or retry ambiguous failures', async () => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetcher = vi.fn().mockRejectedValue(new Error('test-secret-only')); vi.stubGlobal('fetch', fetcher);
    const networkResult = await sendAiSensyWhatsApp(input);
    expect(networkResult.error).toContain('could not be reached');
    expect(JSON.stringify(networkResult)).not.toContain('test-secret-only');
    expect(JSON.stringify(logger.mock.calls)).not.toContain('test-secret-only');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(new Response(JSON.stringify({ error: 'test-secret-only' }), { status: 200 }));
    const result = await sendAiSensyWhatsApp(input);
    expect(result.accepted).toBe(false); expect(JSON.stringify(result)).not.toContain('test-secret-only');
  });
  it('does not follow provider redirects or resend credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'https://example.com/redirected' },
    }));
    vi.stubGlobal('fetch', fetcher);
    const result = await sendAiSensyWhatsApp(input);
    expect(result).toMatchObject({ accepted: false, status: 302 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].redirect).toBe('manual');
  });
  it('classifies timeouts without retrying or exposing credentials', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetcher = vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')); vi.stubGlobal('fetch', fetcher);
    const result = await sendAiSensyWhatsApp(input);
    expect(result).toMatchObject({ accepted: false });
    expect(result.error).toContain('30 seconds');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('test-secret-only');
  });
});
