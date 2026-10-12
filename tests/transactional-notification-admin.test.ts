import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ allowed: false, send: vi.fn(), updateContact: vi.fn() }));
vi.mock('../lib/admin-guard', () => ({ requireAdmin: async () => state.allowed ? null : new Response('Forbidden', { status: 403 }) }));
vi.mock('../lib/admin-auth', () => ({ getAuthenticatedAdminEmail: async () => state.allowed ? 'admin@example.com' : null }));
vi.mock('../lib/result-emails', () => ({
  getFinisherNotificationSummaries: vi.fn(),
  getFinisherNotificationSummary: async () => ({ eventId: 'event', eventName: 'Test', category: 'Run', finishers: [{ resultId: 'result-1', emailStatus: 'PENDING', whatsappStatus: 'PENDING' }] }),
  sendFinisherNotificationBatch: state.send,
}));
vi.mock('../lib/safe-finisher-notifications', () => ({ updateFinisherContact: state.updateContact }));

import { POST } from '../app/api/admin/results/[eventId]/notify/route';
import { PATCH } from '../app/api/admin/results/[eventId]/contact/route';

describe('notification admin mutations', () => {
  it('blocks unauthenticated sends and contact changes', async () => {
    state.allowed = false;
    const request = new Request('https://test.invalid/api', { method: 'POST', body: JSON.stringify({ action: 'send', category: 'Run', channels: ['EMAIL'] }) });
    expect((await POST(request, { params: Promise.resolve({ eventId: 'event' }) })).status).toBe(403);
    expect((await PATCH(new Request('https://test.invalid/api', { method: 'PATCH', body: '{}' }), { params: Promise.resolve({ eventId: 'event' }) })).status).toBe(401);
    expect(state.send).not.toHaveBeenCalled();
    expect(state.updateContact).not.toHaveBeenCalled();
  });
  it('requires an explicit channel and confirmed dry-run token', async () => {
    state.allowed = true; state.send.mockClear();
    const noChannel = new Request('https://test.invalid/api', { method: 'POST', body: JSON.stringify({ action: 'send', category: 'Run' }) });
    expect((await POST(noChannel, { params: Promise.resolve({ eventId: 'event' }) })).status).toBe(400);
    const noConfirmation = new Request('https://test.invalid/api', { method: 'POST', body: JSON.stringify({ action: 'send', category: 'Run', channels: ['EMAIL'] }) });
    expect((await POST(noConfirmation, { params: Promise.resolve({ eventId: 'event' }) })).status).toBe(409);
    expect(state.send).not.toHaveBeenCalled();
  });
});
