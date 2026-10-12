import { DurableObject } from 'cloudflare:workers';
import { assertVolunteerBikeWaiverAvailable, completeRegistrationCheckIn, resetVolunteerWaiverCheckIn } from '../lib/volunteer-check-in-state';
import { assertVolunteerBikeCheckInAvailable, resetVolunteerBikeCheckIn } from '../lib/volunteer-bike-state';
import { appendBibPrintAudits, type BibPrintAuditRecord } from '../lib/bib-print-audit';

interface ParticipantState {
  waiverVerifiedAt: string | null;
  waiverId: string | null;
  waiverDocumentUrl: string | null;
  waiverResetAt: string | null;
  emailOtpVerifiedAt: string | null;
  checkedInAt: string | null;
  bikeCheckedInAt: string | null;
  bikeCheckedOutAt: string | null;
  helmetChecked: boolean;
  bikeRack: string | null;
  medalIssuedAt: string | null;
  foodIssuedAt: string | null;
  lockerNumber: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

type OperationAction = 'CHECK_IN' | 'BIKE_IN' | 'BIKE_OUT' | 'MEDAL_ISSUE' | 'FOOD_ISSUE' | 'LOCKER_ASSIGN';

interface ActionRequest {
  participantId: string;
  action: OperationAction;
  volunteerName: string;
  waiverRequired: boolean;
  registrationWaiverVerifiedAt?: string | null;
  helmetChecked?: boolean;
  bikeRack?: string;
  lockerNumber?: string;
  capturedAt: string;
}

interface WaiverOtpChallenge {
  codeHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  requestedBy: string;
  registrationIds: string[];
  waiverVersion: string;
  verifiedWaiverId?: string;
}

interface ConsolidatedWaiverRecord {
  waiverId: string;
  participantId: string;
  registrationIds: string[];
  waiverVersion: string;
  status: 'PENDING_DOCUMENT' | 'SIGNED';
  signedAt: string;
  signingMethod: 'EMAIL_OTP_VOLUNTEER_ASSISTED';
  signerName: string;
  signerRelationship: string;
  volunteerId: string;
  volunteerName: string;
  documentUrl: string | null;
  documentHash: string | null;
  auditMetadata: Record<string, unknown>;
}

const WAIVER_OTP_TTL_SECONDS = 5 * 60;
const WAIVER_OTP_RESEND_SECONDS = 60;
const WAIVER_OTP_MAX_ATTEMPTS = 5;

function emptyState(): ParticipantState {
  return {
    waiverVerifiedAt: null,
    waiverId: null,
    waiverDocumentUrl: null,
    waiverResetAt: null,
    emailOtpVerifiedAt: null,
    checkedInAt: null,
    bikeCheckedInAt: null,
    bikeCheckedOutAt: null,
    helmetChecked: false,
    bikeRack: null,
    medalIssuedAt: null,
    foodIssuedAt: null,
    lockerNumber: null,
    updatedAt: null,
    updatedBy: null,
  };
}

function participantKey(id: string) {
  return `participant:${id}`;
}

function waiverOtpKey(id: string) {
  return `waiver-otp:${id}`;
}

function waiverKey(id: string) { return `waiver:${id}`; }
function registrationWaiverKey(id: string) { return `waiver-registration:${id}`; }

function matchingOtpHash(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function lockerKey(locker: string) {
  return `locker:${locker.toLowerCase()}`;
}

function equipmentCodeKey(kind: string, code: string, scope = '') {
  const scoped = kind === 'chip' && scope ? `:${encodeURIComponent(scope.toLowerCase())}` : '';
  return `equipment:${kind}:code${scoped}:${code.toLowerCase()}`;
}

interface EquipmentAssignment { code: string; scope: string }

function equipmentParticipantKey(kind: string, participantId: string) {
  return `equipment:${kind}:participant:${participantId}`;
}

function volunteerBandCodeKey(code: string) {
  return `volunteer-band:code:${code.toLowerCase()}`;
}

function volunteerBandVolunteerKey(volunteerId: string) {
  return `volunteer-band:volunteer:${volunteerId}`;
}

export class VolunteerOperationCoordinator extends DurableObject<CloudflareEnv> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/bib-print/audits') {
      const auditKey = 'bib-print:audit:v1';
      if (request.method === 'GET') {
        const records = await this.ctx.storage.get<Array<Record<string, unknown>>>(auditKey) ?? [];
        return Response.json({ ok: true, records });
      }
      if (request.method === 'POST') {
        const body = await request.json<{ records?: BibPrintAuditRecord[]; reprintReason?: string }>();
        if (!Array.isArray(body.records) || !body.records.length || body.records.length > 500) return Response.json({ ok: false, error: 'A valid print batch is required.' }, { status: 400 });
        try {
          const created = await this.ctx.storage.transaction(async (transaction) => {
            const existing = await transaction.get<BibPrintAuditRecord[]>(auditKey) ?? [];
            const { records, created } = appendBibPrintAudits(existing, body.records!, String(body.reprintReason ?? ''), new Date().toISOString(), () => crypto.randomUUID());
            await transaction.put(auditKey, records);
            return created;
          });
          return Response.json({ ok: true, created });
        } catch (error) {
          return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Print audit failed.' }, { status: 409 });
        }
      }
      return new Response('Method Not Allowed', { status: 405 });
    }
    if (url.pathname === '/counter-notifications/template') {
      const action = url.searchParams.get('action')?.trim() || '';
      if (!/^[A-Z_]{2,40}$/.test(action)) return Response.json({ ok: false, error: 'A valid counter action is required.' }, { status: 400 });
      const key = `counter-notification-template:v1:${action}`;
      if (request.method === 'GET') {
        const stored = await this.ctx.storage.get<{ template: unknown; updatedAt: string; updatedBy: string }>(key);
        return Response.json({ ok: true, record: stored ?? null });
      }
      if (request.method === 'PUT') {
        const body = await request.json<{ template?: unknown; updatedAt?: string; updatedBy?: string }>();
        if (!body.template || typeof body.template !== 'object' || !body.updatedAt || !body.updatedBy) {
          return Response.json({ ok: false, error: 'A template and audit details are required.' }, { status: 400 });
        }
        const record = { template: body.template, updatedAt: body.updatedAt, updatedBy: body.updatedBy };
        await this.ctx.storage.put(key, record);
        const saved = await this.ctx.storage.get<typeof record>(key);
        if (!saved || JSON.stringify(saved) !== JSON.stringify(record)) {
          return Response.json({ ok: false, error: 'The template could not be verified after saving.' }, { status: 500 });
        }
        return Response.json({ ok: true, record: saved });
      }
      return new Response('Method Not Allowed', { status: 405 });
    }
    if (request.method === 'POST' && url.pathname === '/waiver-otp/request') {
      const body = await request.json<{ participantId?: string; registrationIds?: string[]; waiverVersion?: string; volunteerId?: string; codeHash?: string; now?: number }>();
      const participantId = body.participantId?.trim() || '';
      const volunteerId = body.volunteerId?.trim() || '';
      const now = Number(body.now);
      const registrationIds = [...new Set((body.registrationIds ?? []).map(String).map((value) => value.trim()).filter(Boolean))].slice(0, 25);
      if (!participantId || !registrationIds.length || !volunteerId || !/^[a-f0-9]{64}$/.test(body.codeHash || '') || !Number.isFinite(now)) {
        return Response.json({ ok: false, error: 'A valid participant, volunteer and OTP challenge are required.' }, { status: 400 });
      }
      await this.ctx.storage.setAlarm(Date.now() + WAIVER_OTP_TTL_SECONDS * 1000);
      try {
        const challenge = await this.ctx.storage.transaction(async (transaction) => {
          const key = waiverOtpKey(participantId);
          const existing = await transaction.get<WaiverOtpChallenge>(key);
          if (existing && existing.expiresAt > now && now - existing.createdAt < WAIVER_OTP_RESEND_SECONDS) {
            const remainingSeconds = WAIVER_OTP_RESEND_SECONDS - (now - existing.createdAt);
            throw new Error(`Please wait ${remainingSeconds} seconds before requesting another OTP.`);
          }
          const next: WaiverOtpChallenge = { codeHash: body.codeHash!, createdAt: now, expiresAt: now + WAIVER_OTP_TTL_SECONDS, attempts: 0, requestedBy: volunteerId, registrationIds, waiverVersion: body.waiverVersion?.trim() || '' };
          await transaction.put(key, next);
          return next;
        });
        return Response.json({ ok: true, expiresInSeconds: WAIVER_OTP_TTL_SECONDS, createdAt: challenge.createdAt });
      } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? error.message : 'OTP request rejected.' }, { status: 409 });
      }
    }
    if (request.method === 'POST' && url.pathname === '/waiver-otp/verify') {
      const body = await request.json<{ participantId?: string; registrationIds?: string[]; volunteerId?: string; volunteerName?: string; signerName?: string; signerRelationship?: string; codeHash?: string; capturedAt?: string; now?: number; deviceSessionId?: string }>();
      const participantId = body.participantId?.trim() || '';
      const volunteerId = body.volunteerId?.trim() || '';
      const volunteerName = body.volunteerName?.trim() || '';
      const capturedAt = body.capturedAt?.trim() || '';
      const now = Number(body.now);
      if (!participantId || !volunteerId || !volunteerName || !/^[a-f0-9]{64}$/.test(body.codeHash || '') || !capturedAt || !Number.isFinite(now)) {
        return Response.json({ ok: false, error: 'A valid athlete, volunteer, timestamp and six-digit OTP are required.' }, { status: 400 });
      }
      const outcome = await this.ctx.storage.transaction(async (transaction) => {
        const challengeKey = waiverOtpKey(participantId);
        const challenge = await transaction.get<WaiverOtpChallenge>(challengeKey);
        if (!challenge || challenge.expiresAt <= now) {
          if (challenge) await transaction.delete(challengeKey);
          return { ok: false as const, error: 'This OTP has expired. Request a new code.' };
        }
        if (challenge.requestedBy !== volunteerId) return { ok: false as const, error: 'This OTP was requested by another volunteer session. Request a new code.' };
        if (challenge.attempts >= WAIVER_OTP_MAX_ATTEMPTS) {
          await transaction.delete(challengeKey);
          return { ok: false as const, error: 'Too many incorrect attempts. Request a new OTP.' };
        }
        const registrationIds = [...new Set((body.registrationIds ?? []).map(String).map((value) => value.trim()).filter(Boolean))];
        if (registrationIds.length !== challenge.registrationIds.length || registrationIds.some((id) => !challenge.registrationIds.includes(id))) return { ok: false as const, error: 'The selected registrations changed. Request a new OTP.' };
        if (!matchingOtpHash(challenge.codeHash, body.codeHash!)) {
          if (challenge.attempts + 1 >= WAIVER_OTP_MAX_ATTEMPTS) await transaction.delete(challengeKey);
          else await transaction.put(challengeKey, { ...challenge, attempts: challenge.attempts + 1 });
          return { ok: false as const, error: challenge.attempts + 1 >= WAIVER_OTP_MAX_ATTEMPTS ? 'Too many incorrect attempts. Request a new OTP.' : 'The OTP is incorrect.' };
        }
        if (challenge.verifiedWaiverId) {
          const existing = await transaction.get<ConsolidatedWaiverRecord>(waiverKey(challenge.verifiedWaiverId));
          if (existing) return { ok: true as const, waiver: existing };
        }
        const waiverId = crypto.randomUUID();
        const waiver: ConsolidatedWaiverRecord = {
          waiverId, participantId, registrationIds, waiverVersion: challenge.waiverVersion,
          status: 'PENDING_DOCUMENT', signedAt: capturedAt,
          signingMethod: 'EMAIL_OTP_VOLUNTEER_ASSISTED', signerName: body.signerName?.trim() || '',
          signerRelationship: body.signerRelationship?.trim() || 'SELF', volunteerId, volunteerName,
          documentUrl: null, documentHash: null,
          auditMetadata: { deviceSessionId: body.deviceSessionId?.trim() || null, otpRequestedAt: challenge.createdAt, otpVerifiedAt: capturedAt },
        };
        await transaction.put(waiverKey(waiverId), waiver);
        await transaction.put(challengeKey, { ...challenge, verifiedWaiverId: waiverId });
        return { ok: true as const, waiver };
      });
      return Response.json(outcome, { status: outcome.ok ? 200 : 409 });
    }
    if (request.method === 'POST' && url.pathname === '/waiver/finalize') {
      const body = await request.json<{ waiverId?: string; participantId?: string; registrationIds?: string[]; documentUrl?: string; documentHash?: string; capturedAt?: string }>();
      const waiverId = body.waiverId?.trim() || '';
      const participantId = body.participantId?.trim() || '';
      const registrationIds = [...new Set((body.registrationIds ?? []).map(String).map((value) => value.trim()).filter(Boolean))];
      if (!waiverId || !participantId || !registrationIds.length || !body.documentUrl || !body.documentHash || !body.capturedAt) return Response.json({ ok: false, error: 'Complete signed waiver evidence is required.' }, { status: 400 });
      const outcome = await this.ctx.storage.transaction(async (transaction) => {
        const pending = await transaction.get<ConsolidatedWaiverRecord>(waiverKey(waiverId));
        if (!pending || pending.participantId !== participantId) throw new Error('The pending waiver was not found.');
        if (pending.registrationIds.length !== registrationIds.length || registrationIds.some((id) => !pending.registrationIds.includes(id))) throw new Error('Waiver coverage does not match the selected registrations.');
        if (pending.status === 'SIGNED') return { waiver: pending, states: Object.fromEntries(await Promise.all(registrationIds.map(async (id) => [id, { ...emptyState(), ...(await transaction.get<ParticipantState>(participantKey(id))) }])) ) };
        const waiver: ConsolidatedWaiverRecord = { ...pending, status: 'SIGNED', documentUrl: body.documentUrl, documentHash: body.documentHash };
        const states: Record<string, ParticipantState> = {};
        for (const registrationId of registrationIds) {
          const current = { ...emptyState(), ...(await transaction.get<ParticipantState>(participantKey(registrationId))) };
          const next = { ...current, waiverVerifiedAt: body.capturedAt, waiverId, waiverDocumentUrl: body.documentUrl, waiverResetAt: null, emailOtpVerifiedAt: body.capturedAt, updatedAt: body.capturedAt, updatedBy: pending.volunteerName };
          await transaction.put(participantKey(registrationId), next);
          await transaction.put(registrationWaiverKey(registrationId), waiverId);
          states[registrationId] = next;
        }
        await transaction.put(waiverKey(waiverId), waiver);
        await transaction.delete(waiverOtpKey(participantId));
        return { waiver, states };
      });
      return Response.json({ ok: true, ...outcome });
    }
    if (request.method === 'POST' && url.pathname === '/equipment-code/claim') {
      const body = await request.json<{ kind?: string; participantId?: string; code?: string; scope?: string }>();
      const kind = body.kind === 'chip' || body.kind === 'athlete-band' ? body.kind : '';
      const participantId = body.participantId?.trim() || '';
      const code = body.code?.trim().replace(/\s+/g, '').toUpperCase() || '';
      const scope = body.scope?.trim() || '';
      if (!kind || !participantId || !/^[A-Z0-9][A-Z0-9._:-]{1,63}$/.test(code)) return Response.json({ ok: false, error: 'A valid participant and assignment code are required.' }, { status: 400 });
      try {
        await this.ctx.storage.transaction(async (transaction) => {
          const assignedTo = await transaction.get<string>(equipmentCodeKey(kind, code, scope));
          if (assignedTo && assignedTo !== participantId) throw new Error(`${kind === 'chip' ? 'Timing chip' : 'Athlete band'} ${code} is already assigned.`);
          const storedPrevious = await transaction.get<string | EquipmentAssignment>(equipmentParticipantKey(kind, participantId));
          const previous = typeof storedPrevious === 'string' ? { code: storedPrevious, scope: '' } : storedPrevious;
          if (previous && previous.code.toLowerCase() !== code.toLowerCase()) await transaction.delete(equipmentCodeKey(kind, previous.code, previous.scope));
          await transaction.put(equipmentCodeKey(kind, code, scope), participantId);
          await transaction.put(equipmentParticipantKey(kind, participantId), { code, scope } satisfies EquipmentAssignment);
        });
        return Response.json({ ok: true, code });
      } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Assignment rejected.' }, { status: 409 });
      }
    }
    if (request.method === 'POST' && url.pathname === '/equipment-code/release') {
      const body = await request.json<{ kind?: string; participantId?: string }>();
      const kind = body.kind === 'chip' || body.kind === 'athlete-band' ? body.kind : '';
      const participantId = body.participantId?.trim() || '';
      if (!kind || !participantId) return Response.json({ ok: false, error: 'A valid participant and assignment kind are required.' }, { status: 400 });
      await this.ctx.storage.transaction(async (transaction) => {
        const participantAssignmentKey = equipmentParticipantKey(kind, participantId);
        const storedPrevious = await transaction.get<string | EquipmentAssignment>(participantAssignmentKey);
        const previous = typeof storedPrevious === 'string' ? { code: storedPrevious, scope: '' } : storedPrevious;
        if (previous) await transaction.delete(equipmentCodeKey(kind, previous.code, previous.scope));
        await transaction.delete(participantAssignmentKey);
      });
      return Response.json({ ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/volunteer-band/states') {
      const body = await request.json<{ volunteerIds?: string[] }>();
      const volunteerIds = [...new Set((body.volunteerIds ?? []).map(String).map((id) => id.trim()).filter(Boolean))].slice(0, 100);
      const stored = await this.ctx.storage.get<string>(volunteerIds.map(volunteerBandVolunteerKey));
      return Response.json({ ok: true, assignments: Object.fromEntries(volunteerIds.map((id) => [id, stored.get(volunteerBandVolunteerKey(id)) ?? null])) });
    }
    if (request.method === 'POST' && url.pathname === '/volunteer-band/assign') {
      const body = await request.json<{ volunteerId?: string; bandCode?: string }>();
      const volunteerId = body.volunteerId?.trim() || '';
      const bandCode = body.bandCode?.trim().replace(/\s+/g, '').toUpperCase() || '';
      if (!volunteerId || !/^[A-Z0-9][A-Z0-9._:-]{1,63}$/.test(bandCode)) return Response.json({ ok: false, error: 'A valid volunteer and band code are required.' }, { status: 400 });
      try {
        await this.ctx.storage.transaction(async (transaction) => {
          const assignedTo = await transaction.get<string>(volunteerBandCodeKey(bandCode));
          if (assignedTo && assignedTo !== volunteerId) throw new Error(`Volunteer band ${bandCode} is already assigned.`);
          const previous = await transaction.get<string>(volunteerBandVolunteerKey(volunteerId));
          if (previous && previous.toLowerCase() !== bandCode.toLowerCase()) await transaction.delete(volunteerBandCodeKey(previous));
          await transaction.put(volunteerBandCodeKey(bandCode), volunteerId);
          await transaction.put(volunteerBandVolunteerKey(volunteerId), bandCode);
        });
        return Response.json({ ok: true, bandCode });
      } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Volunteer band assignment rejected.' }, { status: 409 });
      }
    }
    if (request.method === 'POST' && url.pathname === '/states') {
      const body = await request.json<{ participantIds?: string[] }>();
      const participantIds = [...new Set((body.participantIds ?? []).map(String).map((id) => id.trim()).filter(Boolean))].slice(0, 50);
      const stored = await this.ctx.storage.get<ParticipantState>(participantIds.map(participantKey));
      return Response.json({
        ok: true,
        states: Object.fromEntries(participantIds.map((id) => [id, stored.get(participantKey(id)) ?? emptyState()])),
      });
    }
    if (request.method === 'POST' && url.pathname === '/admin/waiver-check-in/reset') {
      const body = await request.json<{ participantId?: string; adminName?: string; capturedAt?: string; allowRosterOnlyWaiver?: boolean }>();
      const participantId = body.participantId?.trim() || '';
      const adminName = body.adminName?.trim() || '';
      const capturedAt = body.capturedAt?.trim() || '';
      if (!participantId || !adminName || !capturedAt) {
        return Response.json({ ok: false, error: 'A participant, administrator and timestamp are required.' }, { status: 400 });
      }
      try {
        const state = await this.ctx.storage.transaction(async (transaction) => {
          const key = participantKey(participantId);
          const current = { ...emptyState(), ...(await transaction.get<ParticipantState>(key)) };
          const next = { ...resetVolunteerWaiverCheckIn(current, capturedAt, adminName, Boolean(body.allowRosterOnlyWaiver)), waiverId: null, waiverDocumentUrl: null };
          await transaction.put(key, next);
          await transaction.delete(waiverOtpKey(participantId));
          return next;
        });
        return Response.json({ ok: true, state });
      } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Reset rejected.' }, { status: 409 });
      }
    }
    if (request.method === 'POST' && url.pathname === '/admin/bike-check-in/reset') {
      const body = await request.json<{ participantId?: string; adminName?: string; capturedAt?: string }>();
      const participantId = body.participantId?.trim() || '';
      const adminName = body.adminName?.trim() || '';
      const capturedAt = body.capturedAt?.trim() || '';
      if (!participantId || !adminName || !capturedAt) {
        return Response.json({ ok: false, error: 'A participant, administrator and timestamp are required.' }, { status: 400 });
      }
      try {
        const state = await this.ctx.storage.transaction(async (transaction) => {
          const key = participantKey(participantId);
          const current = { ...emptyState(), ...(await transaction.get<ParticipantState>(key)) };
          const next = resetVolunteerBikeCheckIn(current, capturedAt, adminName);
          await transaction.put(key, next);
          return next;
        });
        return Response.json({ ok: true, state });
      } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Reset rejected.' }, { status: 409 });
      }
    }
    if (request.method === 'POST' && url.pathname === '/action') {
      const body = await request.json<ActionRequest>();
      if (!body.participantId?.trim()) return Response.json({ ok: false, error: 'Participant ID is required.' }, { status: 400 });
      if (!['CHECK_IN', 'BIKE_IN', 'BIKE_OUT', 'MEDAL_ISSUE', 'FOOD_ISSUE', 'LOCKER_ASSIGN'].includes(body.action)) return Response.json({ ok: false, error: 'Unsupported volunteer action.' }, { status: 400 });
      try {
        const state = await this.ctx.storage.transaction(async (transaction) => {
          const key = participantKey(body.participantId.trim());
          const current = { ...emptyState(), ...(await transaction.get<ParticipantState>(key)) };
          const next: ParticipantState = { ...current, updatedAt: body.capturedAt, updatedBy: body.volunteerName };
          if (body.action === 'CHECK_IN') {
            Object.assign(next, completeRegistrationCheckIn(current, { waiverRequired: body.waiverRequired, registrationWaiverVerifiedAt: body.registrationWaiverVerifiedAt, capturedAt: body.capturedAt, volunteerName: body.volunteerName }));
          } else if (body.action === 'BIKE_IN') {
            assertVolunteerBikeWaiverAvailable(current, body.waiverRequired, body.registrationWaiverVerifiedAt);
            assertVolunteerBikeCheckInAvailable(current);
            next.bikeCheckedInAt = body.capturedAt;
            next.bikeCheckedOutAt = null;
            next.helmetChecked = Boolean(body.helmetChecked);
            next.bikeRack = body.bikeRack?.trim() || current.bikeRack;
          } else if (body.action === 'BIKE_OUT') {
            if (!current.bikeCheckedInAt || current.bikeCheckedOutAt) throw new Error('No bike is currently checked in for this athlete.');
            next.bikeCheckedOutAt = body.capturedAt;
          } else if (body.action === 'MEDAL_ISSUE') {
            if (current.medalIssuedAt) throw new Error('A medal has already been issued to this athlete.');
            next.medalIssuedAt = body.capturedAt;
          } else if (body.action === 'FOOD_ISSUE') {
            if (current.foodIssuedAt) throw new Error('Food has already been issued to this athlete.');
            next.foodIssuedAt = body.capturedAt;
          } else if (body.action === 'LOCKER_ASSIGN') {
            const locker = body.lockerNumber?.trim();
            if (!locker) throw new Error('Enter a locker number.');
            const assignedTo = await transaction.get<string>(lockerKey(locker));
            if (assignedTo && assignedTo !== body.participantId) throw new Error(`Locker ${locker} is already assigned to another athlete.`);
            if (current.lockerNumber && current.lockerNumber.toLowerCase() !== locker.toLowerCase()) await transaction.delete(lockerKey(current.lockerNumber));
            await transaction.put(lockerKey(locker), body.participantId);
            next.lockerNumber = locker;
          }
          await transaction.put(key, next);
          return next;
        });
        return Response.json({ ok: true, state });
      } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Operation rejected.' }, { status: 409 });
      }
    }
    return new Response('Not Found', { status: 404 });
  }

  async alarm(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const challenges = await this.ctx.storage.list<WaiverOtpChallenge>({ prefix: 'waiver-otp:' });
    let nextExpiry: number | null = null;
    for (const [key, challenge] of challenges) {
      if (challenge.expiresAt <= now) await this.ctx.storage.delete(key);
      else nextExpiry = nextExpiry === null ? challenge.expiresAt : Math.min(nextExpiry, challenge.expiresAt);
    }
    if (nextExpiry !== null) await this.ctx.storage.setAlarm(nextExpiry * 1000);
  }
}
