/** Shared assignment/lookup normalization; no vendor prefix or band range. */
export function volunteerBandIdentifier(value: string): string {
  let raw = value.trim();
  if (!raw || raw.length > 250 || /[\u0000-\u001f\u007f]/.test(raw)) throw new Error('Scan a non-empty QR tag of at most 250 characters without control characters.');
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const key of ['volunteerBandCode', 'bandCode', 'code']) {
      if (typeof parsed?.[key] === 'string' || typeof parsed?.[key] === 'number') { raw = String(parsed[key]); break; }
    }
  } catch { /* Not a structured QR payload. */ }
  try {
    const url = new URL(raw);
    for (const key of ['volunteerBandCode', 'bandCode', 'code']) {
      const code = url.searchParams.get(key); if (code) { raw = code; break; }
    }
  } catch { /* Plain tag value. */ }
  const code = raw.trim().toUpperCase();
  if (!code || code.length > 250 || /[\u0000-\u001f\u007f]/.test(code)) throw new Error('QR tag value is empty, too long or contains control characters.');
  return code;
}
