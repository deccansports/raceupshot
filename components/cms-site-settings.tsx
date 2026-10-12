"use client";

import type { CmsFooterLink, CmsLoginMedia, CmsSiteSettings } from "@/lib/cms";
import {
  ArrowDown, ArrowUp, ImageIcon, Link2, Pencil, PlusCircle,
  Save, Trash2, UploadCloud, Video, X,
} from "lucide-react";
import Image from "next/image";
import { ChangeEvent, useState } from "react";

async function persist(settings: CmsSiteSettings): Promise<CmsSiteSettings> {
  const response = await fetch("/api/admin/cms/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings),
  });
  const payload = await response.json() as { ok: boolean; data?: CmsSiteSettings; error?: string };
  if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || "Unable to save CMS settings.");
  return payload.data;
}

export function LoginMediaManager({
  settings,
  onSaved,
}: {
  settings: CmsSiteSettings;
  onSaved: (settings: CmsSiteSettings) => void;
}) {
  const [editing, setEditing] = useState<CmsLoginMedia | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save(items: CmsLoginMedia[]) {
    setSaving(true);
    setError("");
    try {
      const saved = await persist({ ...settings, loginMedia: items.map((item, index) => ({ ...item, order: index + 1 })) });
      onSaved(saved);
      setMessage("Login page media saved to RACEUPSHOT KV.");
      setEditing(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save login media.");
    } finally {
      setSaving(false);
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !editing) return;
    const allowed = file.type.startsWith("image/") || file.type === "video/mp4";
    if (!allowed || file.size > 3_000_000) {
      setError("Use an image or MP4 file up to 3 MB, or paste a hosted media URL.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setEditing((current) => current ? {
      ...current,
      type: file.type === "video/mp4" ? "video" : "image",
      src: String(reader.result),
      alt: current.alt || file.name,
    } : null);
    reader.readAsDataURL(file);
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this login page media item?")) return;
    await save(settings.loginMedia.filter((item) => item.id !== id));
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= settings.loginMedia.length) return;
    const next = [...settings.loginMedia];
    [next[index], next[target]] = [next[target], next[index]];
    await save(next);
  }

  async function saveEditing() {
    if (!editing?.src.trim()) {
      setError("Add a source URL or upload a media file.");
      return;
    }
    const exists = settings.loginMedia.some((item) => item.id === editing.id);
    await save(exists
      ? settings.loginMedia.map((item) => item.id === editing.id ? editing : item)
      : [...settings.loginMedia, editing]);
  }

  return (
    <section className="cms-panel">
      <div className="cms-panel-title">
        <div><ImageIcon /><span><h2>Login Page Background Media</h2><p>Manage the background image or video for the athlete login page. Enabled items rotate automatically.</p></span></div>
        <button className="button button-primary" onClick={() => setEditing({
          id: `login-${crypto.randomUUID()}`,
          type: "image",
          src: "",
          alt: "Race Upshot athlete login",
          enabled: true,
          order: settings.loginMedia.length + 1,
        })}><PlusCircle /> Add Media</button>
      </div>
      {message && <div className="success-banner">{message}</div>}
      {error && <div className="success-banner cms-error-banner">{error}</div>}
      {editing && (
        <div className="cms-media-editor">
          <div className="cms-media-preview">
            {editing.src
              ? editing.type === "video"
                ? <video src={editing.src} muted controls />
                : <Image src={editing.src} alt={editing.alt || "Preview"} fill sizes="460px" unoptimized />
              : <div><UploadCloud /><span>Upload or paste a media URL</span></div>}
            <label><UploadCloud /> Choose media<input type="file" accept="image/*,video/mp4" onChange={chooseFile} /></label>
          </div>
          <div className="form-grid">
            <div className="field"><label>Type</label><select value={editing.type} onChange={(event) => setEditing({ ...editing, type: event.target.value as "image" | "video" })}><option value="image">Image</option><option value="video">Video</option></select></div>
            <div className="field"><label>Enabled</label><select value={editing.enabled ? "yes" : "no"} onChange={(event) => setEditing({ ...editing, enabled: event.target.value === "yes" })}><option value="yes">Shown on login</option><option value="no">Hidden</option></select></div>
            <div className="field full"><label>Source URL</label><input value={editing.src} onChange={(event) => setEditing({ ...editing, src: event.target.value })} placeholder="https://… or upload a file" /></div>
            <div className="field full"><label>Alt text</label><input value={editing.alt} onChange={(event) => setEditing({ ...editing, alt: event.target.value })} placeholder="Describe this race image" /></div>
          </div>
          <div className="form-actions"><button className="button" onClick={() => setEditing(null)}><X /> Cancel</button><button className="button button-primary" disabled={saving} onClick={() => void saveEditing()}><Save /> Save media</button></div>
        </div>
      )}
      {!editing && (
        <div className="cms-table-wrap">
          <table className="cms-page-table cms-media-table">
            <thead><tr><th>Order</th><th>Preview</th><th>Type</th><th>Source</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{settings.loginMedia.map((item, index) => (
              <tr key={item.id}>
                <td><div className="cms-order"><button disabled={saving || index === 0} onClick={() => void move(index, -1)}><ArrowUp /></button><button disabled={saving || index === settings.loginMedia.length - 1} onClick={() => void move(index, 1)}><ArrowDown /></button></div></td>
                <td><div className="cms-media-thumb">{item.type === "video" ? <Video /> : <Image src={item.src} alt={item.alt} fill sizes="80px" unoptimized />}</div></td>
                <td><span className="cms-chip">{item.type}</span></td>
                <td><code title={item.src}>{item.src}</code></td>
                <td><span className={`cms-badge ${item.enabled ? "published" : "draft"}`}>{item.enabled ? "Enabled" : "Hidden"}</span></td>
                <td><div className="cms-row-actions"><button onClick={() => setEditing({ ...item })}><Pencil /> Edit</button><button className="delete" onClick={() => void remove(item.id)}><Trash2 /> Delete</button></div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {!editing && !settings.loginMedia.length && <p className="admin-empty">No login media is configured. The default Race Upshot login design will be used.</p>}
    </section>
  );
}

export function FooterManager({
  settings,
  onSaved,
}: {
  settings: CmsSiteSettings;
  onSaved: (settings: CmsSiteSettings) => void;
}) {
  const [draft, setDraft] = useState(settings.footer);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function updateLink(columnId: string, linkId: string, patch: Partial<CmsFooterLink>) {
    setDraft((current) => ({
      ...current,
      columns: current.columns.map((column) => column.id === columnId
        ? { ...column, links: column.links.map((link) => link.id === linkId ? { ...link, ...patch } : link) }
        : column),
    }));
  }

  function addLink(columnId: string) {
    setDraft((current) => ({
      ...current,
      columns: current.columns.map((column) => column.id === columnId
        ? { ...column, links: [...column.links, { id: `link-${crypto.randomUUID()}`, label: "New link", url: "/" }] }
        : column),
    }));
  }

  function removeLink(columnId: string, linkId: string) {
    setDraft((current) => ({
      ...current,
      columns: current.columns.map((column) => column.id === columnId
        ? { ...column, links: column.links.filter((link) => link.id !== linkId) }
        : column),
    }));
  }

  function addColumn() {
    setDraft((current) => ({
      ...current,
      columns: [...current.columns, {
        id: `column-${crypto.randomUUID()}`,
        title: "New column",
        links: [],
      }],
    }));
  }

  function removeColumn(columnId: string) {
    setDraft((current) => ({
      ...current,
      columns: current.columns.filter((column) => column.id !== columnId),
    }));
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const saved = await persist({ ...settings, footer: draft });
      onSaved(saved);
      setDraft(saved.footer);
      setMessage("Footer content saved and published.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save footer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="cms-panel">
      <div className="cms-panel-title"><div><Link2 /><span><h2>Footer</h2><p>Manage footer columns, contact information and public links.</p></span></div><button className="button" disabled={draft.columns.length >= 6} onClick={addColumn}><PlusCircle /> Add column</button></div>
      {message && <div className="success-banner">{message}</div>}
      {error && <div className="success-banner cms-error-banner">{error}</div>}
      <div className="form-grid cms-footer-details">
        <div className="field full"><label>Race Upshot tagline</label><textarea value={draft.tagline} onChange={(event) => setDraft({ ...draft, tagline: event.target.value })} /></div>
        <div className="field"><label>Contact email</label><input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></div>
        <div className="field"><label>Location</label><input value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} /></div>
      </div>
      <div className="cms-footer-grid">
        {draft.columns.map((column) => (
          <div className="cms-footer-column cms-footer-editor-column" key={column.id}>
            <div><input value={column.title} aria-label="Footer column title" onChange={(event) => setDraft((current) => ({ ...current, columns: current.columns.map((item) => item.id === column.id ? { ...item, title: event.target.value } : item) }))} /><span><button onClick={() => addLink(column.id)}><PlusCircle /> Add link</button><button className="cms-footer-remove-column" disabled={draft.columns.length === 1} onClick={() => removeColumn(column.id)}><Trash2 /> Remove</button></span></div>
            {column.links.map((link) => <span key={link.id}><Link2 /><span><input value={link.label} aria-label="Footer link label" onChange={(event) => updateLink(column.id, link.id, { label: event.target.value })} /><input value={link.url} aria-label="Footer link URL" onChange={(event) => updateLink(column.id, link.id, { url: event.target.value })} /></span><button aria-label={`Remove ${link.label}`} onClick={() => removeLink(column.id, link.id)}>×</button></span>)}
          </div>
        ))}
      </div>
      <div className="form-actions"><button className="button button-primary" disabled={saving} onClick={() => void save()}><Save /> {saving ? "Saving…" : "Save footer"}</button></div>
    </section>
  );
}
