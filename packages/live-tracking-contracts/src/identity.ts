function requiredTrimmed(value: string, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${field} must not be empty.`);
  return normalized;
}

export function normalizeEmail(email: string): string {
  return requiredTrimmed(email, 'email').toLocaleLowerCase('en-US');
}

export async function hashNormalizedEmail(email: string): Promise<string> {
  const normalized = normalizeEmail(email);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeBib(value: string): string {
  const normalized = requiredTrimmed(value, 'bib').toLocaleUpperCase('en-US').replace(/\s+/g, '');
  return /^\d+$/.test(normalized) ? normalized.replace(/^0+(?=\d)/, '') : normalized;
}

export function normalizeParticipantUuid(value: string): string {
  return requiredTrimmed(value, 'participantUuid');
}

export function normalizeContestUuid(value: string): string {
  return requiredTrimmed(value, 'contestUuid');
}

export function normalizeAgeGroupKey(value: string): string {
  return requiredTrimmed(value, 'ageGroupKey').toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function normalizeGenderKey(value: string): string {
  const normalized = requiredTrimmed(value, 'genderKey').toLocaleLowerCase('en-US');
  if (['m', 'male', 'men'].includes(normalized)) return 'male';
  if (['f', 'female', 'women'].includes(normalized)) return 'female';
  if (['x', 'non-binary', 'nonbinary', 'other', 'open'].includes(normalized)) return 'open';
  return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function normalizeDisplayName(value: string): string {
  return requiredTrimmed(value, 'displayName').replace(/\s+/gu, ' ');
}
