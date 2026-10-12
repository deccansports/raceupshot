import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ gate: vi.fn(), claim: vi.fn(), complete: vi.fn(), email: vi.fn(), whatsapp: vi.fn() }));
vi.mock('../lib/live-tracking-hub-config', () => ({ getLiveTrackingHubConfig: async () => ({ notifications: {
  enabled: true, registrationEnabled: true, emailEnabled: true, whatsappEnabled: true,
  registrationEmailTemplateId: 'registration-email', registrationWhatsAppCampaignName: 'registration-whatsapp',
} }) }));
vi.mock('../lib/transactional-notification-gate', () => ({ assertTransactionalSendsEnabled: state.gate }));
vi.mock('../lib/transactional-notification-ledger', () => ({ claimNotification: state.claim, completeNotification: state.complete }));
vi.mock('../lib/bergtecno-email', () => ({ sendBergtecnoEmail: state.email }));
vi.mock('../lib/aisensy-whatsapp', () => ({ normalizeAiSensyPhone: (value: string) => value, sendAiSensyWhatsApp: state.whatsapp }));

import { notifyFinalizedRegistration } from '../lib/registration-transactional-notifications';

const input = { eventId: 'event', contestId: 'contest', participantId: 'participant', eventName: 'Race Upshot Test',
  previous: { registrationStatus: 'PENDING' }, current: { registrationStatus: 'PAID', name: 'Asha', email: 'asha@example.com', mobile: '+919999999999', ticketName: 'Triathlon', bib: '1001' } };

describe('registration finalization notifications', () => {
  beforeEach(() => { vi.clearAllMocks(); state.gate.mockResolvedValue(undefined); state.claim.mockResolvedValue({ token: 'claim' }); state.complete.mockResolvedValue({}); state.email.mockResolvedValue({ sent: true }); state.whatsapp.mockResolvedValue({ accepted: true }); });
  it('does not message a pending or previously finalized registration', async () => {
    expect((await notifyFinalizedRegistration({ ...input, current: { ...input.current, registrationStatus: 'PENDING' } })).attempted).toBe(0);
    expect((await notifyFinalizedRegistration({ ...input, previous: { registrationStatus: 'PAID' } })).attempted).toBe(0);
    expect(state.email).not.toHaveBeenCalled();
  });
  it('claims both channels after a persisted final transition and includes no fabricated invoice', async () => {
    expect((await notifyFinalizedRegistration(input)).attempted).toBe(2);
    expect(state.claim).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'event', contestId: 'contest', participantId: 'participant', kind: 'REGISTRATION', channel: 'EMAIL' }));
    expect(state.email).toHaveBeenCalledWith(expect.objectContaining({ templateId: 'registration-email', variables: { athleteName: 'Asha', eventName: 'Race Upshot Test', ticketName: 'Triathlon', bib: '1001' } }));
    expect(state.whatsapp).toHaveBeenCalledWith(expect.objectContaining({ campaignName: 'registration-whatsapp', parameters: ['Asha', 'Race Upshot Test', 'Triathlon', '1001'] }));
  });
  it('does not call a provider when the live-send gate is closed', async () => {
    state.gate.mockRejectedValueOnce(new Error('disabled'));
    await expect(notifyFinalizedRegistration(input)).rejects.toThrow('disabled');
    expect(state.email).not.toHaveBeenCalled();
  });
});
