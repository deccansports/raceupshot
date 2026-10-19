import { createHmac, timingSafeEqual } from 'node:crypto';

export function rfidSignature(secret: string, payload: string) {
  if (secret.length < 32) throw new Error('Configure the server-only RACEUPSHOT_RFID_SIGNING_SECRET and the same key on the local bridge.');
  return createHmac('sha256', secret).update(payload).digest('hex').toUpperCase();
}
export function verifyRfidSignature(secret: string, payload: string, signature: unknown) {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(rfidSignature(secret, payload), 'hex'));
}
