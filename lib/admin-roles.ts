import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { KVNamespace } from "@cloudflare/workers-types";
import {
  ADMIN_ROLE_DEFINITIONS,
  type AdminRoleAssignment,
  type AdminRoleId,
  type AdminRoleScope,
  type RoleUser,
} from "./admin-role-contracts";
import { z } from "./zod";

const PREFIX = "raceupshot";
const ASSIGNMENT_INDEX_KEY = `${PREFIX}:admin-role-assignments:index`;
const ASSIGNMENT_KEY_PREFIX = `${PREFIX}:admin-role-assignment:`;
const PROFILE_KEY_PREFIX = `${PREFIX}:athlete-profile:`;

export const adminRoleAssignmentInput = z.object({
  userId: z.string().trim().min(1, "Choose a user."),
  roleId: z.enum(ADMIN_ROLE_DEFINITIONS.map((role) => role.id) as [AdminRoleId, ...AdminRoleId[]]),
  scope: z.enum(["GLOBAL", "EVENT"]),
  eventIds: z.array(z.string().trim().min(1)).max(100).default([]),
}).superRefine((value, context) => {
  if (value.roleId === "SUPER_ADMIN" && value.scope !== "GLOBAL") {
    context.addIssue({ code: "custom", path: ["scope"], message: "Super Admin must have global access." });
  }
  if (value.scope === "EVENT" && value.eventIds.length === 0) {
    context.addIssue({ code: "custom", path: ["eventIds"], message: "Choose at least one event." });
  }
});

export type AdminRoleAssignmentInput = z.infer<typeof adminRoleAssignmentInput>;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function getKv(): Promise<KVNamespace> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.RACEUPSHOT) throw new Error("RACEUPSHOT KV binding is unavailable.");
  return env.RACEUPSHOT;
}

async function getStringIndex(kv: KVNamespace, key: string): Promise<string[]> {
  const value = await kv.get<unknown>(key, "json");
  return Array.isArray(value) ? value.map((item) => clean(item)).filter(Boolean) : [];
}

async function appendIndex(kv: KVNamespace, key: string, id: string) {
  const ids = await getStringIndex(kv, key);
  if (!ids.includes(id)) await kv.put(key, JSON.stringify([...ids, id]));
}

async function removeFromIndex(kv: KVNamespace, key: string, id: string) {
  const ids = await getStringIndex(kv, key);
  if (ids.includes(id)) await kv.put(key, JSON.stringify(ids.filter((item) => item !== id)));
}

async function listKeys(kv: KVNamespace, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix, cursor, limit: 1000 });
    keys.push(...page.keys.map((key) => key.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

function normalizeUser(value: unknown, fallbackId = ""): RoleUser | null {
  const row = record(value);
  if (!row) return fallbackId ? { id: fallbackId, email: fallbackId.includes("@") ? fallbackId : "", name: "" } : null;
  const id = clean(row.uid) || clean(row.userId) || clean(row.id) || fallbackId;
  if (!id) return null;
  return {
    id,
    email: clean(row.email) || clean(row.emailAddress),
    name: clean(row.name) || clean(row.fullName) || clean(row.displayName),
  };
}

export async function listRoleUsers(): Promise<RoleUser[]> {
  const kv = await getKv();
  const indexedUsers = await kv.get<unknown>(`${PREFIX}:users:index`, "json");
  const indexedRows = Array.isArray(indexedUsers) ? indexedUsers : [];
  const profileKeys = await listKeys(kv, PROFILE_KEY_PREFIX);
  const profiles = await Promise.all(profileKeys.map((key) => kv.get<unknown>(key, "json")));
  const resolvedIndexed = await Promise.all(indexedRows.map(async (entry) => {
    const inline = normalizeUser(entry);
    if (inline) return inline;
    const token = clean(entry);
    if (!token) return null;
    const profileUid = token.includes("@")
      ? await kv.get(`${PREFIX}:athlete-profile-email:${token.toLowerCase()}`)
      : token;
    const candidateId = profileUid || token;
    const [profile, user] = await Promise.all([
      kv.get<unknown>(`${PROFILE_KEY_PREFIX}${candidateId}`, "json"),
      kv.get<unknown>(`${PREFIX}:user:${candidateId}`, "json"),
    ]);
    return normalizeUser(profile || user, candidateId);
  }));

  const merged = [...resolvedIndexed, ...profiles.map((profile) => normalizeUser(profile))]
    .filter((user): user is RoleUser => Boolean(user));
  const users = new Map<string, RoleUser>();
  for (const user of merged) {
    const key = user.id || user.email.toLowerCase();
    const current = users.get(key);
    users.set(key, {
      id: user.id,
      email: user.email || current?.email || "",
      name: user.name || current?.name || "",
    });
  }
  return [...users.values()].sort((a, b) =>
    (a.name || a.email || a.id).localeCompare(b.name || b.email || b.id),
  );
}

export async function listRoleAssignments(): Promise<AdminRoleAssignment[]> {
  const kv = await getKv();
  const ids = await getStringIndex(kv, ASSIGNMENT_INDEX_KEY);
  const rows = await Promise.all(ids.map((id) => kv.get<AdminRoleAssignment>(`${ASSIGNMENT_KEY_PREFIX}${id}`, "json")));
  return rows
    .filter((row): row is AdminRoleAssignment => Boolean(row))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

async function writeRoleAudit(kv: KVNamespace, action: string, assignment: AdminRoleAssignment) {
  const id = crypto.randomUUID();
  const row = {
    id,
    action,
    entity: assignment.userEmail || assignment.userName || assignment.userId,
    actor: "Race Upshot admin",
    createdAt: new Date().toISOString(),
    assignmentId: assignment.id,
    userId: assignment.userId,
    roleId: assignment.roleId,
    scope: assignment.scope,
    eventIds: assignment.eventIds,
  };
  await Promise.all([
    kv.put(`${PREFIX}:timing:audit:${id}`, JSON.stringify(row)),
    appendIndex(kv, `${PREFIX}:timing:audit:index`, id),
  ]);
}

export async function saveRoleAssignment(
  input: AdminRoleAssignmentInput,
  allowedEventIds: string[],
): Promise<AdminRoleAssignment> {
  const kv = await getKv();
  const users = await listRoleUsers();
  const user = users.find((item) => item.id === input.userId);
  if (!user) throw new Error("The selected user no longer exists in the KV user index.");

  const role = ADMIN_ROLE_DEFINITIONS.find((item) => item.id === input.roleId);
  if (!role) throw new Error("Choose a valid role.");

  const scope: AdminRoleScope = role.id === "SUPER_ADMIN" ? "GLOBAL" : input.scope;
  const eventIds = scope === "GLOBAL" ? [] : [...new Set(input.eventIds)];
  const invalidEvent = eventIds.find((eventId) => !allowedEventIds.includes(eventId));
  if (invalidEvent) throw new Error("One of the selected events no longer exists.");

  const id = encodeURIComponent(user.id);
  const existing = await kv.get<AdminRoleAssignment>(`${ASSIGNMENT_KEY_PREFIX}${id}`, "json");
  const now = new Date().toISOString();
  const assignment: AdminRoleAssignment = {
    id,
    userId: user.id,
    userEmail: user.email,
    userName: user.name,
    roleId: role.id,
    roleName: role.name,
    scope,
    eventIds,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await Promise.all([
    kv.put(`${ASSIGNMENT_KEY_PREFIX}${id}`, JSON.stringify(assignment)),
    appendIndex(kv, ASSIGNMENT_INDEX_KEY, id),
  ]);
  await writeRoleAudit(kv, existing ? "ROLE_ASSIGNMENT_UPDATED" : "ROLE_ASSIGNMENT_CREATED", assignment);
  return assignment;
}

export async function revokeRoleAssignment(id: string): Promise<AdminRoleAssignment> {
  const kv = await getKv();
  const assignment = await kv.get<AdminRoleAssignment>(`${ASSIGNMENT_KEY_PREFIX}${id}`, "json");
  if (!assignment) throw new Error("Role assignment not found.");
  await Promise.all([
    kv.delete(`${ASSIGNMENT_KEY_PREFIX}${id}`),
    removeFromIndex(kv, ASSIGNMENT_INDEX_KEY, id),
  ]);
  await writeRoleAudit(kv, "ROLE_ASSIGNMENT_REVOKED", assignment);
  return assignment;
}
