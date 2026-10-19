export function authorizationForAccessToken(token: string): string {
  const normalized = token.trim();
  if (/^(?:Bearer|Otp)\s+/i.test(normalized)) return normalized;
  return `Otp ${normalized}`;
}

export function firebaseAccessToken(idToken: string): string {
  return `Bearer ${idToken.trim()}`;
}

export function isFirebaseAccessToken(token: string): boolean {
  return /^Bearer\s+/i.test(token.trim());
}
