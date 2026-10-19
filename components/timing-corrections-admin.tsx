'use client';

import { useState } from 'react';
import type { reviewTimingCorrections } from '@/lib/timing-corrections';

type Review = Awaited<ReturnType<typeof reviewTimingCorrections>>;
export function TimingCorrectionsAdmin({ eventId, participantId, updated }: { eventId: string; participantId: string; updated: () => Promise<void> }) {
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [edit, setEdit] = useState<{ splitId: string; name: string; action: 'EDIT' | 'DELETE' | 'RESTORE'; timestamp: string } | null>(null);
  const [reason, setReason] = useState('');
  const url = `/api/v1/admin/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(participantId)}/timing-corrections`;
  async function load() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not load timing review.');
      setReview(payload.data);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Review failed.'); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!edit || !review) return;
    if (!window.confirm(`${edit.action === 'DELETE' ? 'Exclude' : edit.action === 'RESTORE' ? 'Restore Feibot timing for' : 'Correct'} ${edit.name}? Timing, status and rankings will be recalculated. Original readings are retained.`)) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        action: edit.action, splitId: edit.splitId, reason,
        providerReceivedAt: review.receivedAt,
        ...(edit.action === 'EDIT' ? { readerTimestamp: new Date(edit.timestamp).toISOString() } : {}),
      }) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not save correction.');
      setReview(payload.data); setEdit(null); setReason('');
      await updated(); setMessage('Correction saved. Original provider readings retained.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Save failed.'); }
    finally { setBusy(false); }
  }
  function choose(splitId: string, name: string, action: 'EDIT' | 'DELETE' | 'RESTORE', timestamp: string) {
    const date = new Date(timestamp);
    const local = Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 23) : '';
    setEdit({ splitId, name, action, timestamp: local }); setReason('');
  }
  return <section className="hub-athlete-splits">
    <h3>Admin timing corrections</h3>
    <p>Edit or exclude individual splits. Removing a mandatory split suspends later official results until it is restored; original readings remain in the audit. Race-start deletion is disabled.</p>
    <button className="button" disabled={busy} onClick={() => void load()}>{busy ? 'Working…' : 'Review latest imported Feibot readings'}</button>
    <p>This is a read-only review of the last import, not a new provider fetch. Use Fetch Feibot Results in the event dashboard for fresh data. Automatic imports retain manual corrections.</p>
    {message && <p role="status">{message}</p>}
    {review && <>
      <p>Provider import: {new Date(review.receivedAt).toLocaleString()}</p>
      {review.warning && <p role="alert">New provider readings conflict with manual corrections. Previous corrected timing is retained: {review.warning}</p>}
      <div className="table-wrap"><table><thead><tr><th>Split</th><th>Feibot crossing</th><th>Official crossing</th><th>Actions</th></tr></thead><tbody>
        {review.providerSplits.map(split => {
          const id = split.timingPointKey || '';
          const official = review.officialSplits.find(row => row.timingPointKey === id);
          const start = review.officialSplits.find(row => row.timingPointType === 'START')?.timingPointKey === id;
          return <tr key={id}><td>{split.timingPointName}</td><td>{new Date(split.readerTimestamp).toLocaleString()}</td><td>{official ? new Date(official.readerTimestamp).toLocaleString() : 'Not accepted / excluded'}</td><td>
            <button className="button" disabled={busy || !id} onClick={() => choose(id, split.timingPointName, 'EDIT', official?.readerTimestamp || split.readerTimestamp)}>Edit</button>
            <button className="button" disabled={busy || !id || start || !official} onClick={() => choose(id, split.timingPointName, 'DELETE', split.readerTimestamp)}>Remove split</button>
            <button className="button" disabled={busy || !id} onClick={() => choose(id, split.timingPointName, 'RESTORE', split.readerTimestamp)}>Restore Feibot</button>
          </td></tr>;
        })}
      </tbody></table></div>
      {edit && <div className="hub-chip-editor">
        <b>{edit.action} · {edit.name}</b>
        {edit.action === 'EDIT' && <label>Crossing time (your timezone)<input type="datetime-local" step="0.001" value={edit.timestamp} onChange={e => setEdit({ ...edit, timestamp: e.target.value })} /></label>}
        <label>Reason<input value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
        <button className="button button-primary" disabled={busy || reason.trim().length < 3 || (edit.action === 'EDIT' && !edit.timestamp)} onClick={() => void save()}>Confirm correction</button>
        <button className="button" disabled={busy} onClick={() => setEdit(null)}>Cancel</button>
      </div>}
      <details><summary>Correction audit ({review.corrections.length})</summary><ul>{review.corrections.map(entry => <li key={entry.overrideId}>{entry.action || 'EDIT'} · {entry.timingPointKey} · {entry.authorizedBy} · {new Date(entry.appliedAt).toLocaleString()} · {entry.reason}</li>)}</ul></details>
    </>}
  </section>;
}
