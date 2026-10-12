"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { formatCutoffDuration, parseCutoffDuration } from '@/lib/cutoff-duration';
import { legacyTicketDefinition, type EventTicketDefinition } from '@/lib/event-ticket-definition';

function id(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }

function CutoffInput({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  const [invalid, setInvalid] = useState(false);
  return <span className="ticket-cutoff-input"><input key={String(value)} defaultValue={formatCutoffDuration(value)} placeholder="HH:MM:SS" inputMode="numeric" aria-invalid={invalid} onChange={() => setInvalid(false)} onBlur={(event) => {
    const raw = event.currentTarget.value.trim();
    if (!raw) { onChange(null); setInvalid(false); return; }
    const parsed = parseCutoffDuration(raw);
    if (parsed == null) { setInvalid(true); return; }
    event.currentTarget.value = formatCutoffDuration(parsed); setInvalid(false); onChange(parsed);
  }} />{invalid ? <small role="alert">Use HH:MM or HH:MM:SS.</small> : null}</span>;
}

export function CategoryForm({ categories, onChange, ticketDefinitions = [], onTicketDefinitionsChange, compact = false }: {
  categories: string[];
  onChange: (categories: string[]) => void;
  ticketDefinitions?: EventTicketDefinition[];
  onTicketDefinitionsChange?: (tickets: EventTicketDefinition[]) => void;
  compact?: boolean;
}) {
  const [name, setName] = useState("");
  const tickets = categories.map((category, index) => ticketDefinitions.find((ticket) => ticket.name === category) ?? legacyTicketDefinition(category, index));
  const updateTicket = (ticket: EventTicketDefinition) => onTicketDefinitionsChange?.([...tickets.filter((item) => item.name !== ticket.name), ticket].sort((a, b) => categories.indexOf(a.name) - categories.indexOf(b.name)));

  function addCategory() {
    const normalized = name.trim();
    if (!normalized || categories.some((category) => category.toLowerCase() === normalized.toLowerCase())) return;
    onChange([...categories, normalized]);
    onTicketDefinitionsChange?.([...tickets, legacyTicketDefinition(normalized, tickets.length)]);
    setName("");
  }

  function removeCategory(category: string) {
    onChange(categories.filter((item) => item !== category));
    onTicketDefinitionsChange?.(tickets.filter((ticket) => ticket.name !== category));
  }

  return <div className={compact ? "category-manager compact" : "category-manager"}>
    <div className="admin-card-head"><div><h2>Event tickets and race flow</h2><p>Define each ticket’s distance, legs, splits and cutoffs, or use its mapped Feibot contest.</p></div><span className="status-pill">{categories.length} configured</span></div>
    <div className="category-add-row"><div className="field"><label>Ticket / category name</label><input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCategory(); } }} placeholder="10K, Half Marathon, Bergman 102…" /></div><button type="button" className="button button-secondary" onClick={addCategory} disabled={!name.trim()}><Plus /> Add ticket</button></div>
    {!tickets.length ? <p className="admin-empty">No event tickets added yet.</p> : <div className="ticket-definition-list">{tickets.map((ticket) => {
      const change = (patch: Partial<EventTicketDefinition>) => updateTicket({ ...ticket, ...patch });
      return <details key={ticket.id} className="ticket-definition-card"><summary><span><b>{ticket.name}</b><small>{ticket.configurationSource === 'FEIBOT' ? 'Feibot race flow' : `${ticket.legs.length} legs · ${ticket.splits.length} splits`}</small></span><button type="button" onClick={(event) => { event.preventDefault(); removeCategory(ticket.name); }} aria-label={`Remove ${ticket.name}`}><Trash2 /></button></summary><div className="ticket-definition-body">
        <div className="form-grid"><label className="field">Participant format<select value={ticket.participationMode} onChange={(event) => { const participationMode = event.target.value as EventTicketDefinition['participationMode']; change({ participationMode, relayTeamSize: participationMode === 'RELAY' ? ticket.relayTeamSize ?? 2 : null }); }}><option value="INDIVIDUAL">Individual · 1 athlete per BIB</option><option value="RELAY">Relay team · shared BIB</option></select></label>{ticket.participationMode === 'RELAY' ? <label className="field">Relay team size<select value={ticket.relayTeamSize ?? 2} onChange={(event) => change({ relayTeamSize: Number(event.target.value) as 2 | 3 })}><option value="2">2 athletes</option><option value="3">3 athletes</option></select><small>Each athlete receives a unique band linked to the shared team BIB.</small></label> : null}<label className="field">Session ID<input value={ticket.sessionId} onChange={(event) => change({ sessionId: event.target.value })} placeholder="morning, evening…" /></label><label className="field">Session name<input value={ticket.sessionName} onChange={(event) => change({ sessionName: event.target.value })} placeholder="Morning session" /></label><label className="field">Scheduled session start<input type="datetime-local" value={ticket.scheduledStartAt} onChange={(event) => change({ scheduledStartAt: event.target.value })} /><small>Used to prevent early check-in when the event policy requires it.</small></label><label className="field">Configuration source<select value={ticket.configurationSource} onChange={(event) => change({ configurationSource: event.target.value as EventTicketDefinition['configurationSource'] })}><option value="MANUAL">Manual ticket setup</option><option value="FEIBOT">Feibot live tracking</option></select></label>{ticket.configurationSource === 'FEIBOT' ? <label className="field">Feibot contest UUID<input value={ticket.providerContestUuid} onChange={(event) => change({ providerContestUuid: event.target.value })} placeholder="Mapped provider contest UUID" /><small>Import legs and splits in Live &amp; mobile → Feibot Sync.</small></label> : <label className="field">Total event distance (km)<input type="number" min="0" step="0.01" value={ticket.totalDistanceKm ?? ''} onChange={(event) => change({ totalDistanceKm: event.target.value ? Number(event.target.value) : null })} /></label>}<label className="field">Overall cutoff<CutoffInput value={ticket.overallCutoffSeconds} onChange={(overallCutoffSeconds) => change({ overallCutoffSeconds })} /></label></div>
        {ticket.configurationSource === 'MANUAL' ? <><div className="ticket-subhead"><div><b>Legs</b><small>Distances drive result pace and speed.</small></div><button type="button" className="button button-secondary" onClick={() => change({ legs: [...ticket.legs, { id: id('leg'), name: `Leg ${ticket.legs.length + 1}`, type: 'RUN', order: ticket.legs.length, distanceKm: null, cutoffSeconds: null }] })}><Plus /> Add leg</button></div><div className="ticket-flow-rows">{ticket.legs.map((leg, index) => <div key={leg.id} className="ticket-flow-row leg"><input aria-label={`${ticket.name} leg ${index + 1} name`} value={leg.name} onChange={(event) => change({ legs: ticket.legs.map((item) => item.id === leg.id ? { ...item, name: event.target.value } : item) })} /><select value={leg.type} onChange={(event) => change({ legs: ticket.legs.map((item) => item.id === leg.id ? { ...item, type: event.target.value as typeof leg.type } : item) })}>{['SWIM', 'BIKE', 'RUN', 'TRANSITION', 'OTHER'].map((type) => <option key={type}>{type}</option>)}</select><input aria-label={`${leg.name} distance`} type="number" min="0" step="0.01" placeholder="Distance km" value={leg.distanceKm ?? ''} onChange={(event) => change({ legs: ticket.legs.map((item) => item.id === leg.id ? { ...item, distanceKm: event.target.value ? Number(event.target.value) : null } : item) })} /><CutoffInput value={leg.cutoffSeconds} onChange={(cutoffSeconds) => change({ legs: ticket.legs.map((item) => item.id === leg.id ? { ...item, cutoffSeconds } : item) })} /><button type="button" onClick={() => change({ legs: ticket.legs.filter((item) => item.id !== leg.id), splits: ticket.splits.filter((split) => split.legId !== leg.id) })} aria-label={`Remove ${leg.name}`}><Trash2 /></button></div>)}</div>
          <div className="ticket-subhead"><div><b>Splits</b><small>Distance and cutoff are cumulative from race start.</small></div><button type="button" className="button button-secondary" disabled={!ticket.legs.length} onClick={() => change({ splits: [...ticket.splits, { id: id('split'), name: `Split ${ticket.splits.length + 1}`, legId: ticket.legs[0].id, order: ticket.splits.length, distanceKm: null, cutoffSeconds: null }] })}><Plus /> Add split</button></div><div className="ticket-flow-rows">{ticket.splits.map((split, index) => <div key={split.id} className="ticket-flow-row split"><input aria-label={`${ticket.name} split ${index + 1} name`} value={split.name} onChange={(event) => change({ splits: ticket.splits.map((item) => item.id === split.id ? { ...item, name: event.target.value } : item) })} /><select value={split.legId} onChange={(event) => change({ splits: ticket.splits.map((item) => item.id === split.id ? { ...item, legId: event.target.value } : item) })}>{ticket.legs.map((leg) => <option key={leg.id} value={leg.id}>{leg.name}</option>)}</select><input aria-label={`${split.name} cumulative distance`} type="number" min="0" step="0.01" placeholder="Cumulative km" value={split.distanceKm ?? ''} onChange={(event) => change({ splits: ticket.splits.map((item) => item.id === split.id ? { ...item, distanceKm: event.target.value ? Number(event.target.value) : null } : item) })} /><CutoffInput value={split.cutoffSeconds} onChange={(cutoffSeconds) => change({ splits: ticket.splits.map((item) => item.id === split.id ? { ...item, cutoffSeconds } : item) })} /><button type="button" onClick={() => change({ splits: ticket.splits.filter((item) => item.id !== split.id) })} aria-label={`Remove ${split.name}`}><Trash2 /></button></div>)}</div></> : <div className="ticket-feibot-note">Feibot is authoritative for this ticket. The mapped contest’s legs, splits, distances and cutoffs are used by live tracking and mobile results.</div>}
      </div></details>;
    })}</div>}
  </div>;
}
