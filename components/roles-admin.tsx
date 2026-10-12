"use client";

import {
  ADMIN_ROLE_DEFINITIONS,
  type AdminRoleAssignment,
  type AdminRoleId,
  type AdminRoleScope,
  type RoleUser,
} from "@/lib/admin-role-contracts";
import { Check, LockKeyhole, Pencil, ShieldCheck, Trash2, UserRoundPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";

const permissionColumns = ["events", "imports", "results", "volunteers", "cms", "certificates", "users", "audit"];

type ApiResult<T> = { ok: true; data: T } | { ok: false; error?: string };

export function RolesAdmin({
  storedUserCount,
  initialUsers,
  initialAssignments,
  events,
}: {
  storedUserCount: number;
  initialUsers: RoleUser[];
  initialAssignments: AdminRoleAssignment[];
  events: { id: string; name: string }[];
}) {
  const [assignments, setAssignments] = useState(initialAssignments);
  const [userId, setUserId] = useState(initialUsers[0]?.id || "");
  const [roleId, setRoleId] = useState<AdminRoleId>("VIEWER");
  const [scope, setScope] = useState<AdminRoleScope>("EVENT");
  const [eventIds, setEventIds] = useState<string[]>(events[0]?.id ? [events[0].id] : []);
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const eventNames = useMemo(() => new Map(events.map((event) => [event.id, event.name])), [events]);
  const selectedRole = ADMIN_ROLE_DEFINITIONS.find((role) => role.id === roleId)!;
  const effectiveScope = roleId === "SUPER_ADMIN" ? "GLOBAL" : scope;

  function resetForm() {
    setEditingId("");
    setUserId(initialUsers[0]?.id || "");
    setRoleId("VIEWER");
    setScope("EVENT");
    setEventIds(events[0]?.id ? [events[0].id] : []);
  }

  function editAssignment(assignment: AdminRoleAssignment) {
    setEditingId(assignment.id);
    setUserId(assignment.userId);
    setRoleId(assignment.roleId);
    setScope(assignment.scope);
    setEventIds(assignment.eventIds);
    setMessage("");
    setError("");
    document.getElementById("role-assignment-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function saveAssignment(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, roleId, scope: effectiveScope, eventIds: effectiveScope === "GLOBAL" ? [] : eventIds }),
      });
      const body = await response.json() as ApiResult<AdminRoleAssignment>;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to save role assignment." : body.error || "Unable to save role assignment.");
      setAssignments((current) => [body.data, ...current.filter((item) => item.id !== body.data.id)]);
      setMessage(editingId ? "Role assignment updated." : "Role assigned to the user.");
      resetForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save role assignment.");
    } finally {
      setSaving(false);
    }
  }

  async function revokeAssignment(assignment: AdminRoleAssignment) {
    if (!window.confirm(`Revoke ${assignment.roleName} access from ${assignment.userName || assignment.userEmail || assignment.userId}?`)) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/admin/roles?id=${encodeURIComponent(assignment.id)}`, { method: "DELETE" });
      const body = await response.json() as ApiResult<{ deleted: boolean }>;
      if (!response.ok || !body.ok) throw new Error(body.ok ? "Unable to revoke role assignment." : body.error || "Unable to revoke role assignment.");
      setAssignments((current) => current.filter((item) => item.id !== assignment.id));
      if (editingId === assignment.id) resetForm();
      setMessage("Role assignment revoked.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to revoke role assignment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="admin-grid roles-summary-grid">
        <section className="admin-card">
          <div className="admin-card-head"><h2>Users</h2><Users /></div>
          <div className="metric-grid">
            <div><span>KV USER INDEX</span><strong>{storedUserCount}</strong></div>
            <div><span>ROLE ASSIGNMENTS</span><strong>{assignments.length}</strong></div>
          </div>
          <p className="admin-empty">
            Assign access only to identities already stored in the Race Upshot namespace. Invitations and placeholder users are never fabricated.
          </p>
        </section>
        <section className="admin-card">
          <div className="admin-card-head"><h2>Access policy</h2><LockKeyhole size={18} color="var(--blue)" /></div>
          <p className="roles-policy-copy">Role mutations require a signed HTTP-only admin session. Every assignment, update and revocation writes an audit record.</p>
          <div className="activity-list">
            {["HTTP-only secure sessions", "Signed session expiry", "Server guard on mutations", "Audited role changes"].map((item) => (
              <div className="activity-item" key={item}><i className="activity-icon"><Check /></i><b>{item}</b><span>ENFORCED</span></div>
            ))}
          </div>
        </section>
      </div>

      <section className="admin-card role-assignment-card" id="role-assignment-form">
        <div className="admin-card-head">
          <div><h2>{editingId ? "Edit role assignment" : "Assign a role"}</h2><p>Choose a stored user, permission set and access scope.</p></div>
          <UserRoundPlus size={19} color="var(--blue)" />
        </div>
        {message && <div className="success-banner">{message}</div>}
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={saveAssignment}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="role-user">User</label>
              <select id="role-user" value={userId} onChange={(event) => setUserId(event.target.value)} disabled={Boolean(editingId) || saving}>
                {!initialUsers.length && <option value="">No users found in KV</option>}
                {initialUsers.map((user) => (
                  <option key={user.id} value={user.id}>{user.name || user.email || user.id}{user.email && user.name ? ` · ${user.email}` : ""}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="role-definition">Role</label>
              <select id="role-definition" value={roleId} onChange={(event) => {
                const nextRole = event.target.value as AdminRoleId;
                setRoleId(nextRole);
                if (nextRole === "SUPER_ADMIN") setScope("GLOBAL");
              }} disabled={saving}>
                {ADMIN_ROLE_DEFINITIONS.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="role-scope">Access scope</label>
              <select id="role-scope" value={effectiveScope} onChange={(event) => setScope(event.target.value as AdminRoleScope)} disabled={saving || roleId === "SUPER_ADMIN"}>
                <option value="EVENT">Selected events</option>
                <option value="GLOBAL">All events</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="role-events">Event</label>
              <select
                id="role-events"
                value={eventIds[0] || ""}
                onChange={(event) => setEventIds(event.target.value ? [event.target.value] : [])}
                disabled={saving || effectiveScope === "GLOBAL"}
              >
                {!events.length && <option value="">No events available</option>}
                {events.map((event) => <option value={event.id} key={event.id}>{event.name}</option>)}
              </select>
            </div>
          </div>
          <div className="role-permission-preview">
            <ShieldCheck />
            <span><b>{selectedRole.name}</b> can access {selectedRole.permissions.join(", ")}.</span>
          </div>
          <div className="form-actions">
            {editingId && <button className="button button-secondary" type="button" onClick={resetForm} disabled={saving}>Cancel</button>}
            <button className="button button-primary" type="submit" disabled={saving || !userId || (effectiveScope === "EVENT" && !eventIds.length)}>
              <UserRoundPlus /> {saving ? "Saving…" : editingId ? "Update assignment" : "Assign role"}
            </button>
          </div>
        </form>
      </section>

      <section className="admin-card role-assignment-card">
        <div className="admin-card-head"><div><h2>Current assignments</h2><p>One active role assignment is maintained per user.</p></div><span className="status-pill">{assignments.length} active</span></div>
        {!assignments.length ? (
          <p className="admin-empty">No roles are assigned yet. Use the form above to grant access to a stored user.</p>
        ) : (
          <div className="role-assignment-list">
            {assignments.map((assignment) => (
              <article className="role-assignment-row" key={assignment.id}>
                <div className="role-user-avatar">{(assignment.userName || assignment.userEmail || "U").slice(0, 1).toUpperCase()}</div>
                <div className="role-assignment-identity">
                  <strong>{assignment.userName || assignment.userEmail || assignment.userId}</strong>
                  <span>{assignment.userEmail || assignment.userId}</span>
                </div>
                <div className="role-assignment-access">
                  <b>{assignment.roleName}</b>
                  <span>{assignment.scope === "GLOBAL" ? "All events" : assignment.eventIds.map((id) => eventNames.get(id) || id).join(", ")}</span>
                </div>
                <time>{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(assignment.updatedAt))}</time>
                <div className="role-assignment-actions">
                  <button className="button button-secondary" type="button" onClick={() => editAssignment(assignment)} disabled={saving}><Pencil /> Edit</button>
                  <button className="button button-danger" type="button" onClick={() => void revokeAssignment(assignment)} disabled={saving}><Trash2 /> Revoke</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-card role-definitions-card">
        <div className="admin-card-head"><h2>Available role definitions</h2><span className="status-pill">{ADMIN_ROLE_DEFINITIONS.length} definitions</span></div>
        <table className="permission-table">
          <thead><tr><th>ROLE</th>{permissionColumns.map((item) => <th key={item}>{item}</th>)}</tr></thead>
          <tbody>{ADMIN_ROLE_DEFINITIONS.map((role) => <tr key={role.id}><td><b>{role.name}</b></td>{permissionColumns.map((permission) => <td key={permission}>{role.permissions.includes(permission as never) ? <Check /> : <span>—</span>}</td>)}</tr>)}</tbody>
        </table>
      </section>
    </>
  );
}
