import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), assignment: vi.fn(), participants: vi.fn(), volunteer: vi.fn(), request: vi.fn() }));
vi.mock('../lib/volunteer-auth', () => ({ requireVolunteer: mocks.auth }));
vi.mock('../lib/volunteer-operations', () => ({ activeAssignment: mocks.assignment, searchVolunteerParticipants: mocks.participants }));
vi.mock('../lib/volunteer-management', () => ({ getVolunteerById: mocks.volunteer }));
vi.mock('../lib/catering-repository', () => ({ cateringRequest: mocks.request }));
import { GET, POST } from '../app/api/mobile/volunteer/catering/route';
const body = { requestId: 'request-1234567890', eventId: 'event', serviceId: 'lunch', audience: 'ATHLETE', identifier: '1001', recipientId: 'athlete' };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ profile: { id: 'operator', name: 'Counter operator' } });
  mocks.assignment.mockReturnValue({ modules: ['FOOD_COUNTER'] });
  mocks.participants.mockResolvedValue({ participants: [{ id: 'athlete', name: 'Server name', bib: '1001', category: 'Sprint' }] });
  mocks.request.mockResolvedValue({ services: [], counts: {}, recent: [] });
});
describe('catering API authorization', () => {
  it('rejects unauthenticated operators', async () => {
    mocks.auth.mockRejectedValue(new Error('VOLUNTEER_AUTH_REQUIRED'));
    expect((await GET(new Request('https://test/catering?eventId=event'))).status).toBe(401);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('rejects unrelated counter permissions', async () => {
    mocks.assignment.mockReturnValue({ modules: ['BIKE_CHECK_IN'] });
    expect((await GET(new Request('https://test/catering?eventId=event'))).status).toBe(403);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('uses resolved identity rather than client names or categories', async () => {
    const response = await POST(new Request('https://test/catering', { method: 'POST', body: JSON.stringify({ ...body, name: 'Forged', category: 'Other' }) }));
    expect(response.status).toBe(200);
    expect(mocks.request).toHaveBeenCalledWith('event', '/catering/issue', expect.objectContaining({ recipient: { id: 'athlete', name: 'Server name', identifier: '1001', category: 'Sprint', audience: 'ATHLETE' }, operatorId: 'operator' }));
  });
  it('rejects an athlete not resolved in the event', async () => {
    mocks.participants.mockResolvedValue({ participants: [] });
    expect((await POST(new Request('https://test/catering', { method: 'POST', body: JSON.stringify(body) }))).status).toBe(400);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('does not serve disabled or cross-event volunteer bands', async () => {
    mocks.request.mockResolvedValue({ id: 'volunteer' });
    mocks.volunteer.mockResolvedValue({ id: 'volunteer', status: 'ACTIVE', assignments: [{ eventId: 'other', active: true }] });
    expect((await POST(new Request('https://test/catering', { method: 'POST', body: JSON.stringify({ ...body, audience: 'VOLUNTEER', recipientId: 'volunteer' }) }))).status).toBe(400);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});
