import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ env: { AISENSY_API_KEY: 'test-secret-only' } }));
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: async () => ({ env: state.env }) }));
import { normalizeAiSensyPhone, sendAiSensyOtpWhatsApp, sendAiSensyWhatsApp } from '../lib/aisensy-whatsapp';
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
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      apiKey: 'test-secret-only', campaignName: 'live_campaign', destination: '33766541632', userName: 'Race Upshot',
      source: 'new-landing-page form', templateParams: ['Athlete', '1001'], media: { url: 'https://files.example.com/signed.pdf', filename: 'signed.pdf' },
      buttons: [], carouselCards: [], location: {}, attributes: {}, paramsFallbackValue: { FirstName: 'user' },
    });
  });
  it('matches the generated AiSensy bike campaign curl contract', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 })); vi.stubGlobal('fetch', fetcher);
    await sendAiSensyWhatsApp({
      recipientPhone: '+918390288857',
      userName: 'Athlete Name',
      campaignName: 'bikecheckin1',
      parameters: ['Athlete Name', 'Race', '18 Oct 2026', '06:00 pm', 'Race'],
    });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      apiKey: 'test-secret-only',
      campaignName: 'bikecheckin1',
      destination: '918390288857',
      userName: 'Race Upshot',
      templateParams: ['Athlete Name', 'Race', '18 Oct 2026', '06:00 pm', 'Race'],
      source: 'new-landing-page form',
      media: {},
      buttons: [],
      carouselCards: [],
      location: {},
      attributes: {},
      paramsFallbackValue: { FirstName: 'user' },
    });
  });
  it('sends the same generated OTP in the verification body and copy-code button, never the athlete name', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 })); vi.stubGlobal('fetch', fetcher);
    expect(await sendAiSensyOtpWhatsApp({ recipientPhone: '918390288857', recipientName: 'Vaibhav Belgaonkar', otp: '482913' })).toMatchObject({ accepted: true });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(fetcher.mock.calls[0][0]).toBe('https://backend.aisensy.com/campaign/t1/api/v2');
    expect(body).toEqual({
      apiKey: 'test-secret-only',
      campaignName: 'otp',
      destination: '918390288857',
      userName: 'Race Upshot',
      templateParams: ['482913'],
      source: 'Race Upshot OTP',
      media: {},
      buttons: [{ type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: '482913' }] }],
      carouselCards: [],
      location: {},
      attributes: {},
      paramsFallbackValue: {},
    });
  });
  it('preserves leading-zero OTPs and rejects names as verification codes', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 })); vi.stubGlobal('fetch', fetcher);
    await sendAiSensyOtpWhatsApp({ recipientPhone: '918390288857', recipientName: 'Athlete', otp: '001234' });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.templateParams).toEqual(['001234']);
    expect(body.buttons[0].parameters[0].text).toBe('001234');
    expect(await sendAiSensyOtpWhatsApp({ recipientPhone: '918390288857', recipientName: 'Athlete', otp: 'Athlete' })).toMatchObject({ accepted: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
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
  it('turns AiSensy 400 responses into actionable campaign and parameter errors without exposing provider text', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Campaign bikecheckout1 does not exist or is not live' }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Template params length mismatch: secret-provider-detail' }), { status: 400 }));
    vi.stubGlobal('fetch', fetcher);
    const campaign = await sendAiSensyWhatsApp(input);
    expect(campaign).toMatchObject({ accepted: false, status: 400 });
    expect(campaign.error).toContain('generated API curl');
    const parameters = await sendAiSensyWhatsApp(input);
    expect(parameters.error).toContain('2 body parameters');
    expect(JSON.stringify([campaign, parameters])).not.toContain('secret-provider-detail');
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
