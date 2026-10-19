import { describe, expect, it } from 'vitest';
import { eventInput } from '../lib/event-input';
import { eventTicketDefinitionSchema, legacyTicketDefinition, resolvedTicketDisciplines, type EventTicketDefinition } from '../lib/event-ticket-definition';
import { eventWriteRecord } from '../lib/raceupshot-repository';

const baseEvent = {
  name: 'Test Race', slug: 'test-race', sport: 'Running', date: '2026-10-10', startTime: '06:00',
  city: 'Pune', venue: 'Venue', description: 'A sufficiently detailed race description.', categories: ['10K'],
};

describe('event ticket race flow', () => {
  it('accepts manual legs, splits and cumulative cutoffs', () => {
    const ticket = {
      ...legacyTicketDefinition('10K'),
      totalDistanceKm: 10,
      overallCutoffSeconds: 7_200,
      legs: [{ id: 'run', name: 'Run', type: 'RUN' as const, order: 0, distanceKm: 10, cutoffSeconds: 7_200 }],
      splits: [{ id: 'finish', name: 'Finish', legId: 'run', order: 0, distanceKm: 10, cutoffSeconds: 7_200 }],
    };
    expect(eventTicketDefinitionSchema.parse(ticket)).toEqual(ticket);
    expect(eventInput.safeParse({ ...baseEvent, ticketDefinitions: [ticket] }).success).toBe(true);
  });

  it('rejects a split assigned to a missing leg', () => {
    const ticket = { ...legacyTicketDefinition('10K'), splits: [{ id: 'finish', name: 'Finish', legId: 'missing', order: 0, distanceKm: 10, cutoffSeconds: null }] };
    expect(eventTicketDefinitionSchema.safeParse(ticket).success).toBe(false);
  });

  it('stores structured tickets and derives event categories from them', () => {
    const ticket = { ...legacyTicketDefinition('Half Marathon'), totalDistanceKm: 21.0975 };
    const record = eventWriteRecord({ ...baseEvent, categories: [], ticketDefinitions: [ticket] });
    expect(record.categories).toEqual(['Half Marathon']);
    expect(record.ticketDefinitions).toEqual([ticket]);
  });

  it('stores admin-selected sport combinations per ticket', () => {
    const swimRun: EventTicketDefinition = { ...legacyTicketDefinition('Aquathlon'), enabledDisciplines: ['SWIM', 'RUN'] };
    const bikeRun: EventTicketDefinition = { ...legacyTicketDefinition('Duathlon'), enabledDisciplines: ['BIKE', 'RUN'] };
    expect(eventTicketDefinitionSchema.safeParse(swimRun).success).toBe(true);
    expect(eventTicketDefinitionSchema.safeParse(bikeRun).success).toBe(true);
    expect(resolvedTicketDisciplines(swimRun)).toEqual(['SWIM', 'RUN']);
    expect(resolvedTicketDisciplines(bikeRun)).toEqual(['BIKE', 'RUN']);
  });
});
