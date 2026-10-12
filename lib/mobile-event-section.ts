import { eventSection, type EventLifecycleStatus, type EventSection } from '@/packages/contracts/src';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A completed race, or one whose race window has expired, cannot remain Live. */
export function resolveMobileEventSection(
  lifecycleStatus: EventLifecycleStatus,
  configuredSection: EventSection | 'AUTO',
  startsAt?: string | null,
  endsAt?: string | null,
  nowMs = Date.now(),
): EventSection {
  const lifecycleSection = eventSection(lifecycleStatus);
  if (lifecycleSection === 'PAST') return 'PAST';
  const boundary = endsAt || startsAt;
  const boundaryMs = boundary ? Date.parse(boundary) : NaN;
  if (lifecycleSection === 'LIVE' && Number.isFinite(boundaryMs) && nowMs >= boundaryMs + DAY_MS) {
    return 'PAST';
  }
  return configuredSection === 'AUTO' ? lifecycleSection : configuredSection;
}
