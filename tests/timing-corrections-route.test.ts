import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), save: vi.fn(), review: vi.fn() }));
vi.mock('@/lib/admin-auth', () => ({ getAuthenticatedAdminEmail: mocks.auth }));
vi.mock('@/lib/timing-corrections', () => ({ saveTimingCorrection: mocks.save, reviewTimingCorrections: mocks.review }));
import { GET, POST } from '@/app/api/v1/admin/events/[eventId]/participants/[participantId]/timing-corrections/route';
const context = { params: Promise.resolve({ eventId: 'event', participantId: 'athlete' }) };
describe('timing correction authorization', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue('admin@example.com'); mocks.save.mockResolvedValue({}); });
  it('requires admin auth for review and mutation', async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(new Request('https://test'), context)).status).toBe(401);
    expect((await POST(new Request('https://test', { method: 'POST', body: '{}' }), context)).status).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('requires a reason', async () => {
    expect((await POST(new Request('https://test', { method: 'POST', body: JSON.stringify({ action: 'DELETE', splitId: 'split' }) }), context)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('takes the actor from the authenticated session', async () => {
    const body = { action: 'DELETE', splitId: 'split', reason: 'Bad read', providerReceivedAt: '2026-10-19T00:00:00.000Z', authorizedBy: 'forged' };
    expect((await POST(new Request('https://test', { method: 'POST', body: JSON.stringify(body) }), context)).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith('event', 'athlete', 'admin@example.com', expect.not.objectContaining({ authorizedBy: 'forged' }));
  });
});
