'use client';

import { Check, Clock3, PackageOpen, Pencil, Plus, RefreshCw, Save, UserRound, Users, Utensils } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cateringMetrics, type CateringService, type CateringSnapshot } from '@/lib/catering';

const empty: CateringSnapshot = { services: [], counts: {}, recent: [], volunteerDates: [], volunteerGroups: [] };
const serviceKinds: Array<{ value: CateringService['kind']; label: string }> = [
  { value: 'BREAKFAST', label: 'Breakfast' },
  { value: 'LUNCH', label: 'Lunch' },
  { value: 'DINNER', label: 'Dinner' },
  { value: 'ITEM', label: 'Food / item counter' },
];
const inventoryUnits = ['plate', 'piece', 'packet', 'litre', 'kg', 'serving'];
type CateringTab = 'ATHLETES' | 'VOLUNTEERS' | 'ITEMS';
const cateringTabs: Array<{ id: CateringTab; label: string; icon: typeof UserRound }> = [
  { id: 'ATHLETES', label: 'Athletes', icon: UserRound },
  { id: 'VOLUNTEERS', label: 'Volunteers', icon: Users },
  { id: 'ITEMS', label: 'Items & Counters', icon: PackageOpen },
];

function newService(tab: CateringTab = 'ATHLETES'): CateringService {
  return { id: crypto.randomUUID(), name: '', kind: tab === 'ITEMS' ? 'ITEM' : 'LUNCH', active: true,
    athletesEligible: tab !== 'VOLUNTEERS', volunteersEligible: tab === 'VOLUNTEERS', categories: [],
    startsAt: '', endsAt: '', totalServings: 100, maxPerRecipient: 1,
    inventoryQuantity: 100, unit: tab === 'ITEMS' ? 'piece' : 'plate', purchaseRatePaisa: 0 };
}
function localDate(iso: string) { if (!iso) return ''; const date = new Date(iso); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function formatQuantity(value: number) { return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value); }
function formatMoney(paisa: number) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paisa / 100); }

export function CateringAdmin({ eventId, eventName, categories, events, onEventChange }: {
  eventId: string;
  eventName: string;
  categories: string[];
  events: Array<{ id: string; name: string }>;
  onEventChange: (eventId: string) => void;
}) {
  const [data, setData] = useState(empty);
  const [activeTab, setActiveTab] = useState<CateringTab>('ATHLETES');
  const [draft, setDraft] = useState<CateringService>(() => newService('ATHLETES'));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sortedServices = useMemo(() => data.services
    .filter((service) => activeTab === 'ITEMS' ? service.kind === 'ITEM' : service.kind !== 'ITEM' && (activeTab === 'ATHLETES' ? service.athletesEligible : service.volunteersEligible))
    .toSorted((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)), [activeTab, data.services]);
  const visibleServiceIds = useMemo(() => new Set(sortedServices.map((service) => service.id)), [sortedServices]);
  const visibleIssues = useMemo(() => data.recent.filter((issue) => visibleServiceIds.has(issue.serviceId)
    && (activeTab === 'ITEMS' || issue.recipient.audience === (activeTab === 'ATHLETES' ? 'ATHLETE' : 'VOLUNTEER'))), [activeTab, data.recent, visibleServiceIds]);
  const tabCopy = activeTab === 'ATHLETES'
    ? { title: 'Athlete food', description: 'Configure athlete meal windows and choose the eligible ticket categories.', empty: 'No athlete meal counters configured' }
    : activeTab === 'VOLUNTEERS'
      ? { title: 'Volunteer food', description: 'Configure meals issued to event volunteers through their assigned volunteer bands.', empty: 'No volunteer meal counters configured' }
      : { title: 'Catering item counters', description: 'Create separate counters such as ice cream, hydration, snacks, or merchandise.', empty: 'No item counters configured' };

  function field<K extends keyof CateringService>(key: K, value: CateringService[K]) { setDraft((row) => ({ ...row, [key]: value })); }
  function toggleCategory(category: string) { field('categories', draft.categories.includes(category) ? draft.categories.filter((value) => value !== category) : [...draft.categories, category]); }
  async function load() {
    const response = await fetch(`/api/admin/volunteers/catering?eventId=${encodeURIComponent(eventId)}`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Cannot load catering.');
    setData(payload.data);
  }
  useEffect(() => {
    let live = true;
    if (eventId) void fetch(`/api/admin/volunteers/catering?eventId=${encodeURIComponent(eventId)}`, { cache: 'no-store' })
      .then(async (response) => { const payload = await response.json(); if (!response.ok || !payload.ok) throw new Error(payload.error || 'Cannot load catering.'); if (live) setData(payload.data); })
      .catch((caught) => { if (live) setError(caught instanceof Error ? caught.message : 'Cannot load catering.'); });
    return () => { live = false; };
  }, [eventId]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/admin/volunteers/catering', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId, service: draft }) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Save failed.');
      await load(); setMessage(`${draft.name} saved. Volunteers assigned to Catering / Food & Items can operate it.`); setDraft(newService(activeTab));
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Save failed.'); }
    finally { setBusy(false); }
  }

  return <div className="catering-admin">
    <section className="admin-card catering-builder">
      <header className="catering-heading"><div className="catering-title-icon"><Utensils /></div><div><h2>Catering & food</h2><p>Manage athlete meals, volunteer meals, and additional item counters separately for each event.</p></div></header>
      <nav className="catering-tabs" aria-label="Catering sections">{cateringTabs.map((tab) => { const Icon = tab.icon; return <button key={tab.id} type="button" className={activeTab === tab.id ? 'is-active' : ''} aria-current={activeTab === tab.id ? 'page' : undefined} onClick={() => { setActiveTab(tab.id); setDraft(newService(tab.id)); setMessage(''); setError(''); }}><Icon /><span>{tab.label}</span><b>{data.services.filter((service) => tab.id === 'ITEMS' ? service.kind === 'ITEM' : service.kind !== 'ITEM' && (tab.id === 'ATHLETES' ? service.athletesEligible : service.volunteersEligible)).length}</b></button>; })}</nav>
      <div className="catering-tab-intro"><h3>{tabCopy.title}</h3><p>{tabCopy.description}</p></div>
      {message && <div className="catering-notice is-success" role="status"><Check /> {message}</div>}
      {error && <div className="catering-notice is-error" role="alert">{error}</div>}
      <form onSubmit={save}>
        <div className="catering-field catering-event-field"><label htmlFor="catering-event">Event</label><select id="catering-event" value={eventId} onChange={(event) => onEventChange(event.target.value)} disabled={busy}>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></div>
        <div className="catering-form-grid catering-form-grid-main">
          <div className="catering-field"><label htmlFor="catering-name">Counter / meal name</label><input id="catering-name" value={draft.name} onChange={(event) => field('name', event.target.value)} placeholder="Ice Cream / Race-day lunch" required /></div>
          <div className="catering-field"><label htmlFor="catering-kind">Service type</label><select id="catering-kind" value={draft.kind} onChange={(event) => field('kind', event.target.value as CateringService['kind'])}>{serviceKinds.filter((kind) => activeTab === 'ITEMS' ? kind.value === 'ITEM' : kind.value !== 'ITEM').map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></div>
          <div className="catering-field"><label htmlFor="catering-unit">Inventory unit</label><select id="catering-unit" value={inventoryUnits.includes(draft.unit) ? draft.unit : 'custom'} onChange={(event) => field('unit', event.target.value === 'custom' ? '' : event.target.value)}>{inventoryUnits.map((unit) => <option key={unit} value={unit}>{unit[0].toUpperCase() + unit.slice(1)}</option>)}<option value="custom">Custom unit</option></select></div>
          {!inventoryUnits.includes(draft.unit) && <div className="catering-field"><label htmlFor="catering-custom-unit">Custom unit name</label><input id="catering-custom-unit" value={draft.unit} onChange={(event) => field('unit', event.target.value)} placeholder="scoop / bottle" required /></div>}
        </div>
        <div className="catering-form-grid catering-form-grid-main">
          <div className="catering-field"><label htmlFor="catering-inventory">Total inventory ({draft.unit || 'unit'})</label><input id="catering-inventory" type="number" min="0.001" step="any" value={draft.inventoryQuantity} onChange={(event) => field('inventoryQuantity', Number(event.target.value))} required /></div>
          <div className="catering-field"><label htmlFor="catering-servings">Total servings</label><input id="catering-servings" type="number" min="1" step="1" value={draft.totalServings} onChange={(event) => field('totalServings', Number(event.target.value))} required /></div>
          <div className="catering-field"><label htmlFor="catering-rate">Purchase rate (₹ per {draft.unit || 'unit'})</label><input id="catering-rate" type="number" min="0" step="0.01" value={draft.purchaseRatePaisa / 100} onChange={(event) => field('purchaseRatePaisa', Math.round(Number(event.target.value) * 100))} /></div>
          <div className="catering-field"><label htmlFor="catering-limit">Maximum per recipient</label><input id="catering-limit" type="number" min="1" max="100" step="1" value={draft.maxPerRecipient} onChange={(event) => field('maxPerRecipient', Number(event.target.value))} required /></div>
        </div>
        <div className="catering-window-panel">
          <div className="catering-window-title"><Clock3 /><div><b>Serving window</b><span>Times use {Intl.DateTimeFormat().resolvedOptions().timeZone} and are stored as exact UTC timestamps.</span></div></div>
          <div className="catering-form-grid catering-form-grid-window"><div className="catering-field"><label htmlFor="catering-start">Start</label><input id="catering-start" type="datetime-local" value={localDate(draft.startsAt)} onChange={(event) => field('startsAt', event.target.value ? new Date(event.target.value).toISOString() : '')} required /></div><div className="catering-field"><label htmlFor="catering-end">End</label><input id="catering-end" type="datetime-local" value={localDate(draft.endsAt)} onChange={(event) => field('endsAt', event.target.value ? new Date(event.target.value).toISOString() : '')} required /></div></div>
        </div>
        {activeTab !== 'VOLUNTEERS' && <fieldset className="catering-eligibility">
          <legend>Applicable ticket categories</legend><p>Select specific athlete categories, or leave every category unselected to allow all athletes.</p>
          <label className={`catering-choice-card catering-choice-all ${draft.categories.length === 0 && draft.athletesEligible ? 'is-selected' : ''}`}><input type="checkbox" checked={draft.athletesEligible && draft.categories.length === 0} onChange={(event) => { field('athletesEligible', event.target.checked); if (event.target.checked) field('categories', []); }} /><span><i><Check /></i><b>All athlete ticket categories</b></span></label>
          {categories.length > 0 && <div className="catering-category-grid">{categories.map((category) => <label key={category} className={`catering-choice-card ${draft.categories.includes(category) ? 'is-selected' : ''}`}><input type="checkbox" checked={draft.categories.includes(category)} onChange={() => { if (!draft.athletesEligible) field('athletesEligible', true); toggleCategory(category); }} /><span><i><Check /></i><b>{category}</b></span></label>)}</div>}
          {!categories.length && <div className="catering-empty-inline">No ticket categories are configured for this event. Athlete eligibility applies to every ticket.</div>}
          {activeTab === 'ITEMS' && <label className={`catering-choice-card catering-volunteer-choice ${draft.volunteersEligible ? 'is-selected' : ''}`}><input type="checkbox" checked={draft.volunteersEligible} onChange={(event) => field('volunteersEligible', event.target.checked)} /><span><i><Check /></i><b>Volunteer bands eligible</b></span></label>}
        </fieldset>}
        {activeTab === 'VOLUNTEERS' && <fieldset className="catering-eligibility catering-volunteer-panel"><legend>Volunteer eligibility</legend><p>This meal will be available to event volunteers through their assigned volunteer bands.</p><label className="catering-choice-card catering-choice-all is-selected"><input type="checkbox" checked readOnly /><span><i><Check /></i><b>All assigned event volunteer bands</b></span></label></fieldset>}
        <label className="catering-switch-row"><input type="checkbox" checked={draft.active} onChange={(event) => field('active', event.target.checked)} /><span className="catering-switch" aria-hidden="true" /><span><b>Counter open</b><small>Closed counters remain visible to administrators but cannot issue servings.</small></span></label>
        <div className="catering-actions"><button className="button button-primary" disabled={busy || !eventId} type="submit"><Save /> {busy ? 'Saving…' : data.services.some((service) => service.id === draft.id) ? 'Update counter' : `Add ${activeTab === 'ITEMS' ? 'counter' : 'meal'}`}</button><button className="button button-secondary" type="button" onClick={() => { setDraft(newService(activeTab)); setMessage(''); setError(''); }}><Plus /> New {activeTab === 'ITEMS' ? 'counter' : 'meal'}</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => void load().catch((caught) => setError(caught instanceof Error ? caught.message : 'Cannot refresh catering.'))}><RefreshCw /> Refresh</button></div>
      </form>
    </section>

    <section className="admin-card catering-configured">
      <header className="catering-section-heading"><div><h2>Configured {activeTab === 'ITEMS' ? 'counters' : 'meals'}</h2><p>{eventName || 'Selected event'} · serving totals update from the volunteer app.</p></div><span>{sortedServices.length} {activeTab === 'ITEMS' ? 'counters' : 'meals'}</span></header>
      <div className="catering-service-grid">{sortedServices.map((service) => { const metrics = cateringMetrics(service, data.counts[service.id] || 0); const totalCost = service.inventoryQuantity * service.purchaseRatePaisa; return <article className="catering-service-card" key={service.id}>
        <div className="catering-service-head"><div><h3>{service.name}</h3><p>{serviceKinds.find((kind) => kind.value === service.kind)?.label} · {formatQuantity(metrics.quantityPerServing)} {service.unit} per serving</p></div><span className={`catering-open-pill ${service.active ? '' : 'is-closed'}`}>{service.active ? 'Open' : 'Closed'}</span></div>
        <div className="catering-metrics"><div><b>{metrics.issued}</b><span>Issued</span></div><div><b>{metrics.remaining}</b><span>Remaining</span></div><div><b>{formatQuantity(metrics.consumedQuantity)} {service.unit}</b><span>Used</span></div><div><b>{formatQuantity(metrics.remainingQuantity)} {service.unit}</b><span>Remaining stock</span></div></div>
        <div className="catering-tags"><b>Eligible:</b><span>{service.athletesEligible ? service.categories.length ? service.categories.join(' · ') : 'All athletes' : 'Athletes not eligible'}</span><span>{service.volunteersEligible ? 'Volunteer bands eligible' : 'Volunteers not eligible'}</span></div>
        <div className="catering-accounting"><div>{formatQuantity(service.inventoryQuantity)} {service.unit} = {service.totalServings} servings · {formatQuantity(metrics.quantityPerServing)} {service.unit} each</div><div>Purchase rate {formatMoney(service.purchaseRatePaisa)} per {service.unit} · total {formatMoney(totalCost)}</div><div>Cost used {formatMoney(metrics.consumedCostPaisa)} · remaining {formatMoney(Math.max(0, totalCost - metrics.consumedCostPaisa))}</div></div>
        <button className="button button-secondary" type="button" onClick={() => { setDraft(service); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Pencil /> Edit counter</button>
      </article>; })}</div>
      {!sortedServices.length && <div className="catering-empty-state"><Utensils /><b>{tabCopy.empty}</b><span>Create the first {activeTab === 'ITEMS' ? 'item counter' : 'meal window'} above.</span></div>}
    </section>
    <section className="admin-card catering-log"><header className="catering-section-heading"><div><h2>Recent {activeTab === 'ITEMS' ? 'item issues' : 'serving log'}</h2><p>Latest issues for this tab. Historical issuance remains auditable.</p></div><span>{visibleIssues.length} issues</span></header><div className="table-wrap"><table className="leaderboard"><thead><tr><th>TIME</th><th>SERVICE</th><th>RECIPIENT</th><th>IDENTIFIER</th><th>SERVED BY</th></tr></thead><tbody>{visibleIssues.map((row) => <tr key={row.id}><td>{new Date(row.issuedAt).toLocaleString()}</td><td><b>{row.serviceName}</b><small>{row.kind}</small></td><td>{row.recipient.name}<small>{row.recipient.audience}</small></td><td>{row.recipient.identifier}</td><td>{row.operatorName}</td></tr>)}</tbody></table></div>{!visibleIssues.length && <p className="admin-empty">No issues have been recorded in this section for the selected event.</p>}</section>
  </div>;
}
