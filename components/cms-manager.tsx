"use client";

import {
  ArrowDown, ArrowUp, CalendarDays, FileText, House,
  Link2, LogIn, PlusCircle, Save,
} from "lucide-react";
import type { HomepageSlide, RaceEvent } from "@/lib/types";
import type { CmsPageRecord, CmsSiteSettings } from "@/lib/cms";
import { useState } from "react";
import { CmsEditor } from "./cms-editor";
import { HomepageSliderAdmin } from "./homepage-slider-admin";
import { FooterManager, LoginMediaManager } from "./cms-site-settings";

type CmsTab = "site" | "events" | "slider" | "login" | "footer";

const tabs: Array<{ id: CmsTab; label: string; icon: typeof FileText }> = [
  { id: "site", label: "Site Pages", icon: FileText },
  { id: "events", label: "Event Pages", icon: CalendarDays },
  { id: "slider", label: "Homepage Slider", icon: House },
  { id: "login", label: "Login Page Media", icon: LogIn },
  { id: "footer", label: "Footer", icon: Link2 },
];

export function CmsManager({
  events,
  slides,
  sliderEnabled,
  initialPages,
  initialSiteSettings,
}: {
  events: RaceEvent[];
  slides: HomepageSlide[];
  sliderEnabled: boolean;
  initialPages: CmsPageRecord[];
  initialSiteSettings: CmsSiteSettings;
}) {
  const [activeTab, setActiveTab] = useState<CmsTab>("site");
  const [pages, setPages] = useState(initialPages);
  const [siteSettings, setSiteSettings] = useState(initialSiteSettings);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function movePage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    const next = [...pages];
    [next[index], next[target]] = [next[target], next[index]];
    setPages(next);
  }

  async function request<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
    });
    const payload = await response.json() as { ok: boolean; data?: T; error?: string };
    if (!response.ok || !payload.ok || payload.data === undefined) throw new Error(payload.error || "CMS request failed");
    return payload.data;
  }

  async function deletePage(page: CmsPageRecord) {
    if (page.id.startsWith("core-")) {
      window.alert("Core website pages cannot be deleted. Remove their content blocks instead.");
      return;
    }
    if (!window.confirm(`Delete “${page.title}”?`)) return;
    setSaving(true);
    setError("");
    try {
      await request<{ deleted: boolean }>(`/api/admin/cms/pages/${encodeURIComponent(page.id)}`, { method: "DELETE" });
      setPages((current) => current.filter((item) => item.id !== page.id));
      setMessage(`${page.title} deleted.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete page.");
    } finally {
      setSaving(false);
    }
  }

  async function saveEditor(page: CmsPageRecord) {
    setSaving(true);
    setError("");
    try {
      const creating = editingId === "new";
      const saved = await request<CmsPageRecord>(
        creating ? "/api/admin/cms/pages" : `/api/admin/cms/pages/${encodeURIComponent(page.id)}`,
        { method: creating ? "POST" : "PUT", body: JSON.stringify(page) },
      );
      setPages((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return exists ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved];
      });
      setEditingId(null);
      setMessage(`${saved.title} draft saved to Worker KV.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save page.");
      throw reason;
    } finally {
      setSaving(false);
    }
  }

  async function publishPage(page: CmsPageRecord) {
    setSaving(true);
    setError("");
    try {
      const saved = await request<CmsPageRecord>(`/api/admin/cms/pages/${encodeURIComponent(page.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "publish" }),
      });
      setPages((current) => current.map((item) => item.id === saved.id ? saved : item));
      setMessage(`${saved.title} published. Public HTML and CSS are now active.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to publish page.");
    } finally {
      setSaving(false);
    }
  }

  async function savePageOrder() {
    setSaving(true);
    setError("");
    try {
      const saved = await request<CmsPageRecord[]>("/api/admin/cms/pages", {
        method: "PATCH",
        body: JSON.stringify({ action: "reorder", ids: pages.map((page) => page.id) }),
      });
      setPages(saved);
      setMessage("Site page order saved to Worker KV.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save page order.");
    } finally {
      setSaving(false);
    }
  }

  const editingPage = editingId && editingId !== "new" ? pages.find((page) => page.id === editingId) : undefined;

  return (
    <div className="cms-workspace">
      <nav className="cms-tabs" aria-label="CMS sections">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} className={activeTab === id ? "active" : ""} onClick={() => { setActiveTab(id); setEditingId(null); }}>
            <Icon /> {label}
          </button>
        ))}
      </nav>

      {activeTab === "site" && (
        <section className="cms-panel">
          {message && <div className="success-banner">{message}</div>}
          {error && <div className="success-banner cms-error-banner">{error}</div>}
          {editingId ? (
            <>
              <div className="cms-panel-title">
                <div><FileText /><span><h2>{editingId === "new" ? "Create site page" : `Edit ${editingPage?.title}`}</h2><p>Content is sanitized before storage and public rendering.</p></span></div>
              </div>
              <CmsEditor
                initialPage={editingPage ?? {
                  id: "",
                  title: "",
                  slug: "",
                  path: "/",
                  description: "",
                  blocks: [],
                  status: "Draft",
                  access: "Public",
                  placements: [],
                  footerCategory: "Unassigned",
                  order: pages.length + 1,
                  updatedAt: new Date().toISOString(),
                }}
                onSave={saveEditor}
                onCancel={() => setEditingId(null)}
              />
            </>
          ) : (
            <>
              <div className="cms-panel-title">
                <div><FileText /><span><h2>Site Pages</h2><p>Manage public pages, paths, navigation placement and footer categories.</p></span></div>
              </div>
              <div className="cms-list-head">
                <h3>Site Pages</h3>
                <div>
                  <button className="button" disabled={saving || pages.length === 0} onClick={() => void savePageOrder()}><Save /> Save order</button>
                  <button className="button button-primary" onClick={() => { setEditingId("new"); setMessage(""); setError(""); }}><PlusCircle /> Create page</button>
                </div>
              </div>
              <div className="cms-table-wrap">
                <table className="cms-page-table">
                  <thead><tr><th>Title</th><th>Path</th><th>Status</th><th>Access</th><th>Placement</th><th>Footer category</th><th>Order</th><th>Actions</th></tr></thead>
                  <tbody>{pages.map((page, index) => (
                    <tr key={page.id}>
                      <td><b>{page.title}</b></td>
                      <td><code>{page.path}</code></td>
                      <td><span className={`cms-badge ${page.status === "Published" ? "published" : "draft"}`}>{page.status}</span></td>
                      <td><span className="cms-chip">{page.access}</span></td>
                      <td><div className="cms-chip-group">{page.placements.length ? page.placements.map((placement) => <span className="cms-chip" key={placement}>{placement}</span>) : <span className="cms-muted">—</span>}</div></td>
                      <td><span className="cms-category">{page.footerCategory}</span></td>
                      <td><div className="cms-order"><button onClick={() => movePage(index, -1)} disabled={index === 0}><ArrowUp /></button><button onClick={() => movePage(index, 1)} disabled={index === pages.length - 1}><ArrowDown /></button></div></td>
                      <td><div className="cms-row-actions">
                        <button onClick={() => { setEditingId(page.id); setMessage(""); setError(""); }}>Edit</button>
                        {page.status === "Draft" && <button disabled={saving} onClick={() => void publishPage(page)}>Publish</button>}
                        <button className="delete" disabled={saving || page.id.startsWith("core-")} onClick={() => void deletePage(page)}>Delete</button>
                      </div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              {!pages.length && <p className="admin-empty">No site-page CMS index exists in RACEUPSHOT KV. The frontend no longer displays fabricated CMS records.</p>}
            </>
          )}
        </section>
      )}

      {activeTab === "events" && (
        <section className="cms-panel">
          <div className="cms-panel-title"><div><CalendarDays /><span><h2>Event Pages</h2><p>Control public event landing-page content and visibility.</p></span></div></div>
          <div className="cms-table-wrap"><table className="cms-page-table"><thead><tr><th>Event</th><th>Page path</th><th>Status</th><th>Content</th><th>Actions</th></tr></thead><tbody>
            {events.map((event) => <tr key={event.id}><td><b>{event.name}</b></td><td><code>/events/{event.slug}</code></td><td><span className="cms-badge published">{event.status}</span></td><td><span className="cms-chip">{event.description ? "Complete" : "Needs content"}</span></td><td><div className="cms-row-actions"><a className="button" href="/admin/events-registration?tab=event_info#managed-events">Edit event</a></div></td></tr>)}
          </tbody></table></div>
          {!events.length && <p className="admin-empty">No event pages exist in Worker storage.</p>}
        </section>
      )}

      {activeTab === "slider" && <HomepageSliderAdmin events={events} initialSlides={slides} initialEnabled={sliderEnabled} />}

      {activeTab === "login" && (
        <LoginMediaManager settings={siteSettings} onSaved={setSiteSettings} />
      )}

      {activeTab === "footer" && (
        <FooterManager settings={siteSettings} onSaved={setSiteSettings} />
      )}
    </div>
  );
}
