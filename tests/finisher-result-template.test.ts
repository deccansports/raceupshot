import { describe, expect, it } from 'vitest';
import { DEFAULT_RESULTS_CAMPAIGN, resultWhatsAppParameters, resultRaceBreakdown, resultLegTimes, resultPassageIdentity, validFinishTime } from '../lib/finisher-result-template';
import { defaultLiveTrackingHubConfig } from '../lib/live-tracking-hub-config';
describe('shared AiSensy results template', () => {
  it('keeps the legacy campaign name but disables new event sending until configured', () => {
    expect(DEFAULT_RESULTS_CAMPAIGN).toBe('results');
    expect(defaultLiveTrackingHubConfig('event').notifications).toMatchObject({ whatsappCampaignName: '', whatsappEnabled: false, enabled: false, finishersEnabled: false });
  });
  it('uses the exact approved seven parameter order including repeated category', () => {
    expect(resultWhatsAppParameters({ name: 'Asha', category: 'Triathlon', bib: '001', finishTime: '02:30:00', legTimes: [{ name: 'Swim', time: 1200 }, { name: 'T1', time: 120 }, { name: 'Bike', time: 4800 }, { name: 'T2', time: 60 }, { name: 'Run', time: 2820 }] }, 'Ozar')).toEqual(['Asha', 'Triathlon', 'Ozar', 'Triathlon', '001', '02:30:00', 'Swim: 00:20:00 • T1: 00:02:00 • Bike: 01:20:00 • T2: 00:01:00 • Run: 00:47:00']);
  });
  it('sends finish time without milliseconds and computes triathlon transitions from checkpoint boundaries', () => {
    const legs = ['SWIM', 'BIKE', 'RUN'].map((type, order) => ({ id: type, name: type[0] + type.slice(1).toLowerCase(), type, order }));
    const checkpoints = [
      ['SWIM START', 'SWIM', 0], ['SWIM FINISH', 'SWIM', 167000],
      ['BIKE START', 'BIKE', 874000], ['BIKE FINISH', 'BIKE', 4862000],
      ['RUN START', 'RUN', 6007000], ['FINISH', 'RUN', 11392000],
    ] as const;
    const configured = checkpoints.map(([id, legId], order) => ({ id, legId, order }));
    const recorded = checkpoints.map(([splitId, , officialTimeMs], index) => ({
      splitId, officialTimeMs, sectionTimeMs: officialTimeMs - (checkpoints[index - 1]?.[2] ?? 0),
    }));
    const legTimes = resultLegTimes(legs, configured, recorded);
    expect(legTimes).toEqual([
      { name: 'Swim', time: 167 }, { name: 'T1', time: 707 },
      { name: 'Bike', time: 3988 }, { name: 'T2', time: 1145 }, { name: 'Run', time: 5385 },
    ]);
    expect(resultWhatsAppParameters({ name: 'Vaibhav', category: 'Triathlon', bib: '1003', finishTime: '03:09:52.000', legTimes }, 'New Test'))
      .toEqual(['Vaibhav', 'Triathlon', 'New Test', 'Triathlon', '1003', '03:09:52',
        'Swim: 00:02:47 • T1: 00:11:47 • Bike: 01:06:28 • T2: 00:19:05 • Run: 01:29:45']);
  });
  it('omits an unevidenced transition instead of inventing its duration', () => {
    const legs = ['SWIM', 'BIKE', 'RUN'].map((type, order) => ({ id: type, name: type, type, order }));
    const splits = [
      { id: 'swim-start', legId: 'SWIM', order: 1 }, { id: 'swim-finish', legId: 'SWIM', order: 2 },
      { id: 'bike-start', legId: 'BIKE', order: 3 }, { id: 'bike-finish', legId: 'BIKE', order: 4 },
      { id: 'run-start', legId: 'RUN', order: 5 }, { id: 'finish', legId: 'RUN', order: 6 },
    ];
    const actual = [
      { splitId: 'swim-start', officialTimeMs: 0, sectionTimeMs: 0 },
      { splitId: 'swim-finish', officialTimeMs: 600000, sectionTimeMs: 600000 },
      { splitId: 'bike-finish', officialTimeMs: 4200000, sectionTimeMs: 3600000 },
      { splitId: 'run-start', officialTimeMs: 4320000, sectionTimeMs: 120000 },
      { splitId: 'finish', officialTimeMs: 7920000, sectionTimeMs: 3600000 },
    ];
    expect(resultLegTimes(legs, splits, actual)).toEqual([
      { name: 'SWIM', time: 600 }, { name: 'T2', time: 120 }, { name: 'RUN', time: 3600 },
    ]);
  });
  it.each([['Marathon', ['Run']], ['Duathlon', ['Run 1', 'T1', 'Bike', 'T2', 'Run 2']], ['Bike Run', ['Bike', 'Run']], ['Swimathon', ['Swim']]])('supports %s without unrelated legs', (_sport, names) => {
    expect(resultRaceBreakdown(names.map(name => ({ name, time: 60 })))).toBe(names.map(name => `${name}: 00:01:00`).join(' • '));
  });
  it('does not fabricate missing or zero splits', () => {
    expect(resultRaceBreakdown([])).toBe('Leg splits are not available.');
    expect(resultRaceBreakdown([{ name: 'Run', time: NaN }, { name: 'Swim', time: 0 }])).toBe('Leg splits are not available.');
    for (const value of ['', 'DNF', '00:00:00', '01:70:00', '-1:00:00']) expect(validFinishTime(value)).toBe(false);
    expect(validFinishTime('06:05:53.123')).toBe(true);
  });
  it('separates race identities without removing meaningful BIB characters', () => {
    expect(resultPassageIdentity('001', 'Run')).not.toBe(resultPassageIdentity('001', 'Swim'));
    expect(resultPassageIdentity('001', 'Run')).not.toBe(resultPassageIdentity('1', 'Run'));
    expect(resultPassageIdentity('', 'Run')).toBeNull();
  });
});
