import { describe, expect, it } from 'vitest';
import { assertCateringIssue, cateringBandIdentifier, cateringMetrics, cateringServiceSchema, type CateringRecipient, type CateringService } from '../lib/catering';
const service: CateringService = { id: 'lunch', name: 'Race lunch', kind: 'LUNCH', active: true, athletesEligible: true, volunteersEligible: true, categories: ['Sprint'], startsAt: '2026-10-18T06:00:00.000Z', endsAt: '2026-10-18T10:00:00.000Z', totalServings: 100, maxPerRecipient: 1, inventoryQuantity: 20, unit: 'kg', purchaseRatePaisa: 10000 };
const athlete: CateringRecipient = { id: 'a', name: 'Athlete', identifier: '1001', audience: 'ATHLETE', category: 'Sprint' };
const now = Date.parse('2026-10-18T08:00:00Z');
describe('catering eligibility and stock', () => {
  it('accepts plain, JSON and URL volunteer band QR identifiers', () => {
    expect(cateringBandIdentifier(' bmv01 ')).toBe('BMV01');
    expect(cateringBandIdentifier('{"bandCode":"BMV01"}')).toBe('BMV01');
    expect(cateringBandIdentifier('https://raceupshot.com/band?code=BMV01')).toBe('BMV01');
  });
  it('accepts a valid eligible serving', () => expect(() => assertCateringIssue(service, athlete, 0, 0, now)).not.toThrow());
  it('rejects repeat and sold-out servings', () => {
    expect(() => assertCateringIssue(service, athlete, 1, 1, now)).toThrow(/Already served/);
    expect(() => assertCateringIssue(service, athlete, 0, 100, now)).toThrow(/No servings/);
  });
  it('enforces both time boundaries and disabling', () => {
    expect(() => assertCateringIssue(service, athlete, 0, 0, Date.parse(service.startsAt) - 1)).toThrow(/window/);
    expect(() => assertCateringIssue(service, athlete, 0, 0, Date.parse(service.endsAt))).toThrow(/window/);
    expect(() => assertCateringIssue({ ...service, active: false }, athlete, 0, 0, now)).toThrow(/disabled/);
  });
  it('enforces athlete category and volunteer eligibility separately', () => {
    expect(() => assertCateringIssue(service, { ...athlete, category: 'Olympic' }, 0, 0, now)).toThrow(/category/);
    const volunteer = { ...athlete, audience: 'VOLUNTEER' as const, category: '' };
    expect(() => assertCateringIssue(service, volunteer, 0, 0, now)).not.toThrow();
    expect(() => assertCateringIssue({ ...service, volunteersEligible: false }, volunteer, 0, 0, now)).toThrow(/eligible/);
  });
  it('counts servings separately from kilograms and costs', () => {
    expect(cateringMetrics(service, 25)).toEqual({ issued: 25, remaining: 75, quantityPerServing: 0.2, consumedQuantity: 5, remainingQuantity: 15, consumedCostPaisa: 50000 });
  });
  it('rejects invalid stock and reversed windows', () => {
    expect(cateringServiceSchema.safeParse({ ...service, totalServings: 0 }).success).toBe(false);
    expect(cateringServiceSchema.safeParse({ ...service, endsAt: service.startsAt }).success).toBe(false);
  });
});
