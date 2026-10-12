"use client";

import type { CmsContentBlock, CmsPageRecord } from "@/lib/cms";
import {
  ArrowDown, ArrowUp, Code2, Eye, FileCode2, Heading2, LayoutGrid,
  List, PlusCircle, Save, Trash2, X,
} from "lucide-react";
import { useMemo, useState } from "react";

export type CmsPageDraft = CmsPageRecord;

const previewCss = `
:root{--ink:#07111f;--muted:#617084;--blue:#1b6cff;--line:#dce2e8;--paper:#f4f7fa}
*{box-sizing:border-box}body{margin:0;font-family:Inter,Arial,sans-serif;color:var(--ink);background:#fff}
.cms-public-content{overflow:hidden}.cms-content-hero{padding:72px max(5vw,28px);background:var(--ink);color:#fff}
.cms-content-hero h1{max-width:900px;font-size:clamp(42px,7vw,76px);line-height:.98;letter-spacing:-.065em;margin:18px 0}
.cms-content-hero p{max-width:680px;color:#a9b7c8;font-size:17px;line-height:1.75}
.cms-kicker{display:inline-block;color:#6ea8ff;font-size:11px;font-weight:900;letter-spacing:.16em}
.cms-content-section{padding:72px max(5vw,28px)}.cms-content-heading{display:grid;grid-template-columns:1.3fr 1fr;gap:50px;align-items:end;margin-bottom:42px}
.cms-content-heading h2{font-size:clamp(34px,5vw,58px);line-height:1;letter-spacing:-.055em;margin:14px 0 0}.cms-content-heading p{color:var(--muted);line-height:1.75}
.cms-content-grid{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--line);border-left:1px solid var(--line)}
.cms-content-card{min-height:240px;padding:25px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}
.cms-card-number{font:700 11px monospace;color:var(--blue)}.cms-content-card h3{font-size:20px;margin:72px 0 12px}.cms-content-card p{font-size:13px;line-height:1.7;color:var(--muted)}
.cms-two-column{display:grid;grid-template-columns:1fr 1fr;gap:32px}.cms-callout{padding:28px;border-left:4px solid var(--blue);background:var(--paper)}
.cms-button{display:inline-flex;padding:12px 18px;border:1px solid var(--line);border-radius:5px;color:var(--ink);text-decoration:none;font-weight:800}.cms-button-primary{background:var(--blue);color:#fff;border-color:var(--blue)}
.cms-content-section img{max-width:100%;height:auto;border-radius:8px}.cms-content-section li,.cms-content-section p{line-height:1.75}.cms-muted{color:var(--muted)}
@media(max-width:800px){.cms-content-heading,.cms-two-column{grid-template-columns:1fr}.cms-content-grid{grid-template-columns:1fr 1fr}}
@media(max-width:520px){.cms-content-grid{grid-template-columns:1fr}}
`;

function previewDocument(blocks: CmsContentBlock[]) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${previewCss}</style></head><body><main class="cms-public-content">${blocks.map((block) => block.html).join("\n")}</main></body></html>`;
}

function newBlock(index: number): CmsContentBlock {
  return {
    id: `block-${crypto.randomUUID()}`,
    name: `Content block ${index + 1}`,
    html: `<section class="cms-content-section">
  <span class="cms-kicker">NEW SECTION</span>
  <h2>Add your heading</h2>
  <p>Add your page content here.</p>
</section>`,
  };
}

export function CmsEditor({
  initialPage,
  onSave,
  onCancel,
}: {
  initialPage: CmsPageRecord;
  onSave: (page: CmsPageRecord) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [page, setPage] = useState(initialPage);
  const [activePreview, setActivePreview] = useState<string | null>(null);
  const [pagePreview, setPagePreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fullPreview = useMemo(() => previewDocument(page.blocks), [page.blocks]);

  function updateBlock(id: string, update: Partial<CmsContentBlock>) {
    setPage((current) => ({
      ...current,
      blocks: current.blocks.map((block) => block.id === id ? { ...block, ...update } : block),
    }));
  }

  function addBlock() {
    setPage((current) => ({ ...current, blocks: [...current.blocks, newBlock(current.blocks.length)] }));
  }

  function removeBlock(id: string) {
    setPage((current) => ({ ...current, blocks: current.blocks.filter((block) => block.id !== id) }));
    setActivePreview((current) => current === id ? null : current);
  }

  function moveBlock(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= page.blocks.length) return;
    setPage((current) => {
      const blocks = [...current.blocks];
      [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
      return { ...current, blocks };
    });
  }

  function appendHtml(id: string, html: string) {
    const block = page.blocks.find((item) => item.id === id);
    if (block) updateBlock(id, { html: `${block.html.trim()}\n${html}` });
  }

  async function savePage() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await onSave(page);
      setMessage("Draft saved to Worker KV. HTML was sanitized on the server.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save the page.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="form-card cms-html-editor">
      {message && <div className="success-banner">{message}</div>}
      {error && <div className="success-banner cms-error-banner">{error}</div>}
      <div className="form-grid">
        <div className="field"><label>Page title</label><input value={page.title} onChange={(event) => setPage({ ...page, title: event.target.value })} /></div>
        <div className="field"><label>Slug</label><input value={page.slug} onChange={(event) => setPage({ ...page, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} /></div>
        <div className="field full"><label>SEO description</label><input value={page.description} maxLength={320} onChange={(event) => setPage({ ...page, description: event.target.value })} /></div>
      </div>

      <div className="cms-blocks-heading">
        <div><FileCode2 /><span><h3>Page content</h3><p>Add, remove, reorder and edit HTML content blocks. Use the supported CSS classes shown below.</p></span></div>
        <button type="button" className="button button-primary" onClick={addBlock}><PlusCircle /> Add content block</button>
      </div>

      <div className="cms-class-reference">
        <b>Styled classes:</b>
        {["cms-content-hero", "cms-content-section", "cms-content-heading", "cms-content-grid", "cms-content-card", "cms-kicker", "cms-button", "cms-callout", "cms-two-column"].map((item) => <code key={item}>{item}</code>)}
      </div>

      <div className="cms-html-blocks">
        {page.blocks.map((block, index) => {
          const previewing = activePreview === block.id;
          return (
            <section className="cms-html-block" key={block.id}>
              <header>
                <div className="field">
                  <label>Block name</label>
                  <input value={block.name} onChange={(event) => updateBlock(block.id, { name: event.target.value })} />
                </div>
                <div className="cms-block-actions">
                  <button type="button" onClick={() => moveBlock(index, -1)} disabled={index === 0} aria-label="Move block up"><ArrowUp /></button>
                  <button type="button" onClick={() => moveBlock(index, 1)} disabled={index === page.blocks.length - 1} aria-label="Move block down"><ArrowDown /></button>
                  <button type="button" className="delete" onClick={() => removeBlock(block.id)} aria-label="Remove content block"><Trash2 /> Remove</button>
                </div>
              </header>
              <div className="cms-source-tabs">
                <button type="button" className={!previewing ? "active" : ""} onClick={() => setActivePreview(null)}><Code2 /> HTML</button>
                <button type="button" className={previewing ? "active" : ""} onClick={() => setActivePreview(block.id)}><Eye /> Styled preview</button>
              </div>
              {previewing ? (
                <iframe
                  className="cms-block-preview"
                  title={`${block.name} preview`}
                  sandbox=""
                  srcDoc={previewDocument([block])}
                />
              ) : (
                <>
                  <div className="cms-html-tools">
                    <button type="button" onClick={() => appendHtml(block.id, "\n<h2>Section heading</h2>")}><Heading2 /> Heading</button>
                    <button type="button" onClick={() => appendHtml(block.id, "\n<p>Write your paragraph here.</p>")}><FileCode2 /> Paragraph</button>
                    <button type="button" onClick={() => appendHtml(block.id, "\n<ul><li>First item</li><li>Second item</li></ul>")}><List /> List</button>
                    <button type="button" onClick={() => appendHtml(block.id, '\n<div class="cms-content-grid"><article class="cms-content-card"><h3>Card title</h3><p>Card content.</p></article></div>')}><LayoutGrid /> Card grid</button>
                  </div>
                  <textarea
                    className="cms-html-source"
                    value={block.html}
                    spellCheck={false}
                    onChange={(event) => updateBlock(block.id, { html: event.target.value })}
                    aria-label={`${block.name} HTML source`}
                  />
                </>
              )}
            </section>
          );
        })}
        {!page.blocks.length && <div className="admin-empty">No content blocks. Add a block to start building this page.</div>}
      </div>

      <div className="form-actions">
        {onCancel && <button type="button" className="button" onClick={onCancel}>Cancel</button>}
        <button type="button" className="button" onClick={() => setPagePreview(true)}><Eye /> Preview page</button>
        <button type="button" className="button button-primary" disabled={saving || !page.title.trim()} onClick={() => void savePage()}><Save /> {saving ? "Saving…" : "Save draft"}</button>
      </div>

      {pagePreview && (
        <div className="cms-preview-modal" role="dialog" aria-modal="true" aria-label="Page preview">
          <div className="cms-preview-window">
            <header><div><b>{page.title || "Untitled page"}</b><span>Sandboxed HTML preview</span></div><button type="button" onClick={() => setPagePreview(false)} aria-label="Close preview"><X /></button></header>
            <iframe title={`${page.title} full page preview`} sandbox="" srcDoc={fullPreview} />
          </div>
        </div>
      )}
    </div>
  );
}
