import { DurableObject } from 'cloudflare:workers';
import { volunteerBandIdentifier } from '../lib/volunteer-band-identifier';
import { assertCateringIssue, cateringServiceSchema, cateringMetrics, cateringVolunteerGroupSchema, type CateringService, type CateringRecipient, type CateringIssue, type CateringVolunteerGroup } from '../lib/catering';
import { assertVolunteerBikeWaiverAvailable, completeRegistrationCheckIn, resetVolunteerWaiverCheckIn } from '../lib/volunteer-check-in-state';
import { assertVolunteerBikeCheckInAvailable, resetVolunteerBikeCheckIn } from '../lib/volunteer-bike-state';
import { appendBibPrintAudits, type BibPrintAuditRecord } from '../lib/bib-print-audit';
import { resolveChipReturn, type ChipReturnMethod, type ChipReturnStatus } from '../lib/chip-return';

interface ParticipantState {
  waiverVerifiedAt: string | null;
  waiverId: string | null;
  waiverDocumentUrl: string | null;
  waiverResetAt: string | null;
  emailOtpVerifiedAt: string | null;
  checkedInAt: string | null;
  bikeCheckedInAt: string | null;
  bikeCheckedOutAt: string | null;
  assignedChipCodeAtCheckout: string | null;
  returnedChipCode: string | null;
  returnedChipFullEpc: string | null;
  chipReturnStatus: ChipReturnStatus;
  chipReturnMethod: ChipReturnMethod | null;
  chipReturnReason: string | null;
  chipReturnedAt: string | null;
  bikeCheckoutTransactionId: string | null;
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
  relayTeamParticipantIds?: string[];
  action: OperationAction;
  volunteerName: string;
  waiverRequired: boolean;
  registrationWaiverVerifiedAt?: string | null;
  helmetChecked?: boolean;
  bikeRack?: string;
  lockerNumber?: string;
  capturedAt: string;
  assignedChipCode?: string | null;
  scannedChipCode?: string | null;
  chipReturnMethod?: ChipReturnMethod | null;
  chipReturnReason?: string | null;
}

interface WaiverOtpChallenge {
  challengeId: string;
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
    assignedChipCodeAtCheckout: null,
    returnedChipCode: null,
    returnedChipFullEpc: null,
    chipReturnStatus: 'PENDING_RETURN',
    chipReturnMethod: null,
    chipReturnReason: null,
    chipReturnedAt: null,
    bikeCheckoutTransactionId: null,
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
    if (url.pathname.startsWith('/catering')) {
      try {
        if (url.pathname === '/catering' && request.method === 'GET') {
          const services = await this.ctx.storage.get<CateringService[]>('catering:services') ?? [];
          const counts = services.length ? await this.ctx.storage.get<number>(services.map(row => `catering:count:${row.id}`)) : new Map<string, number>();
          const recent = await this.ctx.storage.list<CateringIssue>({ prefix: 'catering:log:', reverse: true, limit: 500 });
          const volunteerDates = await this.ctx.storage.get<string[]>('catering:volunteer-dates') ?? [];
          const volunteerGroups = await this.ctx.storage.get<CateringVolunteerGroup[]>('catering:volunteer-groups') ?? [];
          return Response.json({ ok: true, data: { services, counts: Object.fromEntries(services.map(row => [row.id, counts.get(`catering:count:${row.id}`) ?? 0])), recent: [...recent.values()], volunteerDates, volunteerGroups } });
        }
        if (url.pathname === '/catering/service' && request.method === 'POST') {
          const service = cateringServiceSchema.parse(await request.json());
          await this.ctx.storage.transaction(async tx => {
            const services = await tx.get<CateringService[]>('catering:services') ?? [];
            const used = await tx.get<number>(`catering:count:${service.id}`) ?? 0;
            const prior = services.find(row => row.id === service.id);
            if (!prior && services.length >= 100) throw new Error('Maximum 100 services per event.');
            if (used && prior && (prior.kind !== service.kind || prior.startsAt !== service.startsAt || prior.endsAt !== service.endsAt || prior.inventoryQuantity !== service.inventoryQuantity || prior.totalServings !== service.totalServings || prior.unit !== service.unit || prior.purchaseRatePaisa !== service.purchaseRatePaisa)) throw new Error('A service with issue history cannot change its window or stock basis. Create another service.');
            await tx.put('catering:services', [...services.filter(row => row.id !== service.id), service]);
          });
          return Response.json({ ok: true, data: service });
        }
        if (url.pathname === '/catering/volunteer-date' && request.method === 'POST') {
          const body = await request.json<{ date?: string; remove?: boolean }>();
          const date = body.date?.trim() || '';
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A valid serving date is required.');
          const dates = await this.ctx.storage.transaction(async tx => {
            const current = await tx.get<string[]>('catering:volunteer-dates') ?? [];
            const next = body.remove ? current.filter(value => value !== date) : [...new Set([...current, date])].sort();
            if (body.remove) {
              const services = await tx.get<CateringService[]>('catering:services') ?? [];
              const matching = services.filter(row => row.volunteersEligible && row.serviceDate === date);
              const issued = matching.length ? await tx.get<number>(matching.map(row => `catering:count:${row.id}`)) : new Map<string, number>();
              if (matching.some(row => (issued.get(`catering:count:${row.id}`) ?? 0) > 0)) throw new Error('A serving date with issued meals cannot be deleted.');
              await tx.put('catering:services', services.filter(row => !row.volunteersEligible || row.serviceDate !== date));
            }
            await tx.put('catering:volunteer-dates', next);
            return next;
          });
          return Response.json({ ok: true, data: dates });
        }
        if (url.pathname === '/catering/volunteer-group' && request.method === 'POST') {
          const parsed = cateringVolunteerGroupSchema.parse(await request.json());
          const group = { ...parsed, bandCodes: [...new Set(parsed.bandCodes.map(volunteerBandIdentifier).filter(Boolean))] };
          await this.ctx.storage.transaction(async tx => {
            const groups = await tx.get<CateringVolunteerGroup[]>('catering:volunteer-groups') ?? [];
            const claimed = new Map(groups.filter(row => row.id !== group.id).flatMap(row => row.bandCodes.map(code => [volunteerBandIdentifier(code), row.name] as const)));
            const duplicate = group.bandCodes.find(code => claimed.has(code));
            if (duplicate) throw new Error(`Band ${duplicate} is already assigned to ${claimed.get(duplicate)}.`);
            await tx.put('catering:volunteer-groups', [...groups.filter(row => row.id !== group.id), group]);
            const prior = groups.find(row => row.id === group.id);
            for (const code of prior?.bandCodes ?? []) if (!group.bandCodes.includes(code)) await tx.delete(`catering:group-band:${volunteerBandIdentifier(code)}`);
            for (const code of group.bandCodes) await tx.put(`catering:group-band:${code}`, group.id);
          });
          return Response.json({ ok: true, data: group });
        }
        if (url.pathname === '/catering/volunteer-group/delete' && request.method === 'POST') {
          const body = await request.json<{ id?: string }>();
          const id = body.id?.trim() || '';
          if (!id) throw new Error('A group ID is required.');
          await this.ctx.storage.transaction(async tx => {
            const groups = await tx.get<CateringVolunteerGroup[]>('catering:volunteer-groups') ?? [];
            const group = groups.find(row => row.id === id);
            if (!group) return;
            await tx.put('catering:volunteer-groups', groups.filter(row => row.id !== id));
            for (const code of group.bandCodes) await tx.delete(`catering:group-band:${volunteerBandIdentifier(code)}`);
          });
          return Response.json({ ok: true });
        }
        if (url.pathname === '/catering/band' && request.method === 'POST') {
          const { code } = await request.json<{ code: string }>();
          const normalized = volunteerBandIdentifier(code);
          const [id, groupId, groups] = await Promise.all([
            this.ctx.storage.get<string>(volunteerBandCodeKey(normalized)),
            this.ctx.storage.get<string>(`catering:group-band:${normalized}`),
            this.ctx.storage.get<CateringVolunteerGroup[]>('catering:volunteer-groups'),
          ]);
          const group = groupId ? (groups ?? []).find(row => row.id === groupId && row.active) ?? null : null;
          return Response.json({ ok: true, data: group ? { id: id ?? null, group } : { id: id ?? null } });
        }
        if (url.pathname === '/catering/issue' && request.method === 'POST') {
          const body = await request.json<{ requestId: string; serviceId: string; recipient: CateringRecipient; operatorId: string; operatorName: string }>();
          const issue = await this.ctx.storage.transaction(async tx => {
            const retryKey = `catering:request:${body.operatorId}:${body.requestId}`;
            const previous = await tx.get<CateringIssue>(retryKey);
            if (previous) {
              if (previous.serviceId !== body.serviceId || previous.recipient.id !== body.recipient.id || previous.recipient.audience !== body.recipient.audience) throw new Error('Request ID belongs to another serving.');
              return previous;
            }
            const services = await tx.get<CateringService[]>('catering:services') ?? [];
            const service = services.find(row => row.id === body.serviceId);
            if (!service) throw new Error('Service not found.');
            const recipientKey = `catering:recipient:${JSON.stringify([service.id, body.recipient.audience, body.recipient.id])}`;
            const countKey = `catering:count:${service.id}`;
            const used = await tx.get<number>(recipientKey) ?? 0;
            const issued = await tx.get<number>(countKey) ?? 0;
            if (body.recipient.audience === 'VOLUNTEER' && body.recipient.groupId) {
              const groups = await tx.get<CateringVolunteerGroup[]>('catering:volunteer-groups') ?? [];
              const group = groups.find(row => row.id === body.recipient.groupId && row.active);
              if (!group || !service.serviceDate || !group.servingDates.includes(service.serviceDate) || service.kind === 'ITEM' || !group.allowedMeals.includes(service.kind)) throw new Error('This volunteer band is not eligible for this meal and serving date.');
            }
            assertCateringIssue(service, body.recipient, body.recipient.groupType === 'ADMIN_TAG' ? 0 : used, issued);
            const metrics = cateringMetrics(service, issued);
            const row: CateringIssue = { id: crypto.randomUUID(), serviceId: service.id, serviceName: service.name, kind: service.kind, recipient: body.recipient, operatorId: body.operatorId, operatorName: body.operatorName, issuedAt: new Date().toISOString(), quantity: metrics.quantityPerServing, unit: service.unit, costPaisa: Math.round(metrics.quantityPerServing * service.purchaseRatePaisa), status: 'ISSUED' };
            await tx.put({ [recipientKey]: used + 1, [countKey]: issued + 1, [`catering:log:${row.issuedAt}:${row.id}`]: row, [`catering:issue:${row.id}`]: row, [retryKey]: row });
            return row;
          });
          return Response.json({ ok: true, data: issue });
        }
        if (url.pathname === '/catering/reset' && request.method === 'POST') {
          const body = await request.json<{ issueId?: string; resetBy?: string }>();
          const issueId = body.issueId?.trim() || '';
          if (!issueId) throw new Error('An issue ID is required.');
          const reset = await this.ctx.storage.transaction(async tx => {
            const issueKey = `catering:issue:${issueId}`;
            let issue = await tx.get<CateringIssue>(issueKey);
            if (!issue) {
              const historical = await tx.list<CateringIssue>({ prefix: 'catering:log:', reverse: true, limit: 500 });
              issue = [...historical.values()].find(row => row.id === issueId);
            }
            if (!issue) throw new Error('Serving record not found.');
            if (issue.status === 'RESET') return issue;
            const recipientKey = `catering:recipient:${JSON.stringify([issue.serviceId, issue.recipient.audience, issue.recipient.id])}`;
            const countKey = `catering:count:${issue.serviceId}`;
            const used = await tx.get<number>(recipientKey) ?? 0;
            const issued = await tx.get<number>(countKey) ?? 0;
            const updated: CateringIssue = { ...issue, status: 'RESET', resetAt: new Date().toISOString(), resetBy: body.resetBy?.trim() || 'Administrator' };
            await tx.put({ [recipientKey]: Math.max(0, used - 1), [countKey]: Math.max(0, issued - 1), [issueKey]: updated, [`catering:log:${updated.issuedAt}:${updated.id}`]: updated });
            return updated;
          });
          return Response.json({ ok: true, data: reset });
        }
        return Response.json({ ok: false, error: 'Unknown catering action.' }, { status: 404 });
      } catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Catering action failed.' }, { status: 400 }); }
    }
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
      const body = await request.json<{ challengeId?: string; participantId?: string; registrationIds?: string[]; waiverVersion?: string; volunteerId?: string; codeHash?: string; now?: number }>();
      const challengeId = body.challengeId?.trim() || '';
      const participantId = body.participantId?.trim() || '';
      const volunteerId = body.volunteerId?.trim() || '';
      const now = Number(body.now);
      const registrationIds = [...new Set((body.registrationIds ?? []).map(String).map((value) => value.trim()).filter(Boolean))].slice(0, 25);
      if (!challengeId || !participantId || !registrationIds.length || !volunteerId || !/^[a-f0-9]{64}$/.test(body.codeHash || '') || !Number.isFinite(now)) {
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
          const next: WaiverOtpChallenge = { challengeId, codeHash: body.codeHash!, createdAt: now, expiresAt: now + WAIVER_OTP_TTL_SECONDS, attempts: 0, requestedBy: volunteerId, registrationIds, waiverVersion: body.waiverVersion?.trim() || '' };
          await transaction.put(key, next);
          return next;
        });
        return Response.json({ ok: true, expiresInSeconds: WAIVER_OTP_TTL_SECONDS, createdAt: challenge.createdAt });
      } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? error.message : 'OTP request rejected.' }, { status: 409 });
      }
    }
    if (request.method === 'POST' && url.pathname === '/waiver-otp/cancel') {
      const body = await request.json<{ challengeId?: string; participantId?: string; volunteerId?: string }>();
      const challengeId = body.challengeId?.trim() || '';
      const participantId = body.participantId?.trim() || '';
      const volunteerId = body.volunteerId?.trim() || '';
      if (!challengeId || !participantId || !volunteerId) {
        return Response.json({ ok: false, error: 'A valid OTP challenge is required.' }, { status: 400 });
      }
      const cancelled = await this.ctx.storage.transaction(async (transaction) => {
        const key = waiverOtpKey(participantId);
        const challenge = await transaction.get<WaiverOtpChallenge>(key);
        if (!challenge || challenge.challengeId !== challengeId || challenge.requestedBy !== volunteerId || challenge.verifiedWaiverId) return false;
        await transaction.delete(key);
        return true;
      });
      return Response.json({ ok: true, cancelled });
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
      const { documentUrl, documentHash, capturedAt } = body;
      const outcome = await this.ctx.storage.transaction(async (transaction) => {
        const pending = await transaction.get<ConsolidatedWaiverRecord>(waiverKey(waiverId));
        if (!pending || pending.participantId !== participantId) throw new Error('The pending waiver was not found.');
        if (pending.registrationIds.length !== registrationIds.length || registrationIds.some((id) => !pending.registrationIds.includes(id))) throw new Error('Waiver coverage does not match the selected registrations.');
        if (pending.status === 'SIGNED') {
          const states: Record<string, ParticipantState> = {};
          for (const registrationId of registrationIds) {
            const current = { ...emptyState(), ...(await transaction.get<ParticipantState>(participantKey(registrationId))) };
            const next = current.checkedInAt ? current : {
              ...current,
              checkedInAt: pending.signedAt,
              updatedAt: pending.signedAt,
              updatedBy: pending.volunteerName,
            };
            if (!current.checkedInAt) await transaction.put(participantKey(registrationId), next);
            states[registrationId] = next;
          }
          return { waiver: pending, states };
        }
        const waiver: ConsolidatedWaiverRecord = { ...pending, status: 'SIGNED', documentUrl, documentHash };
        const states: Record<string, ParticipantState> = {};
        for (const registrationId of registrationIds) {
          const current = { ...emptyState(), ...(await transaction.get<ParticipantState>(participantKey(registrationId))) };
          const next = { ...current, waiverVerifiedAt: capturedAt, waiverId, waiverDocumentUrl: documentUrl, waiverResetAt: null, emailOtpVerifiedAt: capturedAt, checkedInAt: current.checkedInAt || capturedAt, updatedAt: capturedAt, updatedBy: pending.volunteerName };
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
      // Athlete wristbands identify individual people across the whole event,
      // including relay members. Only timing chips may have a timing scope.
      const scope = kind === 'athlete-band' ? '' : body.scope?.trim() || '';
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
      try {
        const bandCode = volunteerBandIdentifier(body.bandCode || '');
        if (!volunteerId) throw new Error('A volunteer is required.');
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
          if (current.returnedChipCode) await transaction.delete(`chip-return:${current.returnedChipCode.toLowerCase()}`);
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
          const participantId = body.participantId.trim();
          const key = participantKey(participantId);
          let current = { ...emptyState(), ...(await transaction.get<ParticipantState>(key)) };
          const isBikeAction = body.action === 'BIKE_IN' || body.action === 'BIKE_OUT';
          const relayParticipantIds = isBikeAction
            ? [...new Set([participantId, ...(body.relayTeamParticipantIds ?? []).map(String).map((id) => id.trim()).filter(Boolean)])].slice(0, 3)
            : [participantId];
          const relayStates = new Map<string, ParticipantState>([[participantId, current]]);
          if (relayParticipantIds.length > 1) {
            for (const memberId of relayParticipantIds) {
              if (memberId !== participantId) relayStates.set(memberId, { ...emptyState(), ...(await transaction.get<ParticipantState>(participantKey(memberId))) });
            }
            const legacyHolder = [...relayStates.entries()]
              .filter(([, state]) => Boolean(state.bikeCheckedInAt))
              .sort(([, left], [, right]) => {
                const activeOrder = Number(Boolean(right.bikeCheckedInAt && !right.bikeCheckedOutAt)) - Number(Boolean(left.bikeCheckedInAt && !left.bikeCheckedOutAt));
                return activeOrder || Date.parse(right.bikeCheckedInAt || '') - Date.parse(left.bikeCheckedInAt || '');
              })[0];
            if (legacyHolder && legacyHolder[0] !== participantId) {
              current = {
                ...current,
                bikeCheckedInAt: legacyHolder[1].bikeCheckedInAt,
                bikeCheckedOutAt: legacyHolder[1].bikeCheckedOutAt,
                assignedChipCodeAtCheckout: legacyHolder[1].assignedChipCodeAtCheckout,
                returnedChipCode: legacyHolder[1].returnedChipCode,
                returnedChipFullEpc: legacyHolder[1].returnedChipFullEpc,
                chipReturnStatus: legacyHolder[1].chipReturnStatus,
                chipReturnMethod: legacyHolder[1].chipReturnMethod,
                chipReturnReason: legacyHolder[1].chipReturnReason,
                chipReturnedAt: legacyHolder[1].chipReturnedAt,
                bikeCheckoutTransactionId: legacyHolder[1].bikeCheckoutTransactionId,
                helmetChecked: legacyHolder[1].helmetChecked,
                bikeRack: legacyHolder[1].bikeRack,
              };
            }
          }
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
            if (!current.bikeCheckedInAt || current.bikeCheckedOutAt) throw new Error('No bike is currently checked in for this athlete or relay team.');
            const chipReturn = resolveChipReturn({ assignedChipCode: body.assignedChipCode, scannedChipCode: body.scannedChipCode, method: body.chipReturnMethod, reason: body.chipReturnReason });
            const transactionId = crypto.randomUUID();
            if (chipReturn.returnedChipCode) {
              const returnKey = `chip-return:${chipReturn.returnedChipCode.toLowerCase()}`;
              const existing = await transaction.get<{ participantId: string; transactionId: string }>(returnKey);
              if (existing) throw new Error('This timing chip has already been returned.');
              await transaction.put(returnKey, { participantId, transactionId, returnedAt: body.capturedAt });
            }
            next.bikeCheckedOutAt = body.capturedAt;
            next.assignedChipCodeAtCheckout = chipReturn.assignedChipCode;
            next.returnedChipCode = chipReturn.returnedChipCode;
            next.returnedChipFullEpc = chipReturn.returnedChipFullEpc;
            next.chipReturnStatus = chipReturn.chipReturnStatus;
            next.chipReturnMethod = chipReturn.chipReturnMethod;
            next.chipReturnReason = chipReturn.chipReturnReason;
            next.chipReturnedAt = body.capturedAt;
            next.bikeCheckoutTransactionId = transactionId;
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
          if (isBikeAction && relayParticipantIds.length > 1) {
            for (const memberId of relayParticipantIds) {
              if (memberId === participantId) continue;
              const memberState = relayStates.get(memberId) || emptyState();
              if (!memberState.bikeCheckedInAt && !memberState.bikeCheckedOutAt && !memberState.bikeRack && !memberState.helmetChecked) continue;
              await transaction.put(participantKey(memberId), {
                ...memberState,
                bikeCheckedInAt: null,
                bikeCheckedOutAt: null,
                helmetChecked: false,
                bikeRack: null,
                assignedChipCodeAtCheckout: null,
                returnedChipCode: null,
                returnedChipFullEpc: null,
                chipReturnStatus: 'PENDING_RETURN',
                chipReturnMethod: null,
                chipReturnReason: null,
                chipReturnedAt: null,
                bikeCheckoutTransactionId: null,
              });
            }
          }
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
