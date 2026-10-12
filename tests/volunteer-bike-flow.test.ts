import { describe, expect, it } from 'vitest';
import { assertVolunteerBikeCheckInAvailable, resetVolunteerBikeCheckIn } from '../lib/volunteer-bike-state';

describe('volunteer bike check-in', () => {
  it('clears check-in and checkout together for an administrator', () => {
    expect(resetVolunteerBikeCheckIn({
      bikeCheckedInAt: '2026-10-10T08:00:00.000Z',
      bikeCheckedOutAt: '2026-10-10T14:00:00.000Z',
      helmetChecked: true,
      bikeRack: 'A-12',
      updatedAt: '2026-10-10T14:00:00.000Z',
      updatedBy: 'Volunteer',
    }, '2026-10-10T15:00:00.000Z', 'admin@example.com')).toEqual({
      bikeCheckedInAt: null,
      bikeCheckedOutAt: null,
      helmetChecked: false,
      bikeRack: null,
      updatedAt: '2026-10-10T15:00:00.000Z',
      updatedBy: 'admin@example.com',
    });
  });

  it('rejects reset when no bike was checked in', () => {
    expect(() => resetVolunteerBikeCheckIn({
      bikeCheckedInAt: null,
      bikeCheckedOutAt: null,
      helmetChecked: false,
      bikeRack: null,
      updatedAt: null,
      updatedBy: null,
    }, '2026-10-10T15:00:00.000Z', 'admin@example.com')).toThrow('no bike check-in state');
  });

  it('blocks volunteer recheck-in even after bike checkout', () => {
    expect(() => assertVolunteerBikeCheckInAvailable({ bikeCheckedInAt: '2026-10-10T08:00:00.000Z' }))
      .toThrow('administrator must reset');
    expect(() => assertVolunteerBikeCheckInAvailable({ bikeCheckedInAt: null })).not.toThrow();
  });
});
