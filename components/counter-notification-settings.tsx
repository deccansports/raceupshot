'use client';

import { useEffect, useState } from 'react';
import { counterActions, counterVariables, emptyCounterTemplate, type CounterTemplate, type CounterVariable } from '@/lib/counter-notification-contract';

type Delivery = { operationId: string; action: string; channel: string; bib: string; status: string; createdAt: string; campaignName?: string; error?: string };
type Channel = 'EMAIL' | 'WHATSAPP';
type TestToast = { tone: 'success' | 'error'; message: string };

const variableLabel = (value: string) => value.replace(/_/g, ' ');

export function CounterNotificationSettings({ events }: { events: Array<{ id: string; name: string }> }) {
  const [eventId, setEventId] = useState(events[0]?.id || '');
  const [action, setAction] = useState<keyof typeof counterActions>('WAIVER_VERIFY');
  const [template, setTemplate] = useState<CounterTemplate>(emptyCounterTemplate);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loaded, setLoaded] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<Channel | ''>('');
  const [testEmail, setTestEmail] = useState('');
  const [testMobile, setTestMobile] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [testToast, setTestToast] = useState<TestToast | null>(null);
  const [revision, setRevision] = useState(0);
  const selection = `${eventId}:${action}`;
  const endpoint = `/api/admin/volunteers/notifications?eventId=${encodeURIComponent(eventId)}&action=${encodeURIComponent(action)}`;

  useEffect(() => {
    const abort = new AbortController();
    void fetch(endpoint, { cache: 'no-store', signal: abort.signal }).then(async (response) => {
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || 'Unable to load templates.');
      if (abort.signal.aborted) return;
      setTemplate(body.data.template); setDeliveries(body.data.deliveries); setLoaded(selection); setError(''); setMessage('');
    }).catch((caught) => { if (!abort.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unable to load templates.'); });
    return () => abort.abort();
  }, [endpoint, selection, revision]);

  useEffect(() => {
    if (!testToast) return;
    const timeout = window.setTimeout(() => setTestToast(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [testToast]);

  async function save() {
    setSaving(true); setMessage(''); setError('');
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(template) });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || 'Unable to save templates.');
      setTemplate(body.data.template);
      setMessage(`${counterActions[action]} notification template saved for all events.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Save failed.'); }
    finally { setSaving(false); }
  }

  async function sendTest(channel: Channel) {
    const recipient = channel === 'EMAIL' ? testEmail.trim() : testMobile.trim();
    if (!recipient) {
      const nextError = `Enter a test ${channel === 'EMAIL' ? 'email address' : 'WhatsApp number'}.`;
      setError(nextError); setTestToast({ tone: 'error', message: nextError }); return;
    }
    setTesting(channel); setMessage(''); setError('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel, recipient, template }) });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || `Unable to send the ${channel === 'EMAIL' ? 'email' : 'WhatsApp'} test.`);
      const nextMessage = `${channel === 'EMAIL' ? 'Email' : 'WhatsApp'} test accepted by the provider for ${recipient}.`;
      setMessage(nextMessage); setTestToast({ tone: 'success', message: nextMessage });
    } catch (caught) {
      const nextError = caught instanceof Error ? caught.message : 'Test delivery failed.';
      setError(nextError); setTestToast({ tone: 'error', message: nextError });
    }
    finally { setTesting(''); }
  }

  function email(update: Partial<CounterTemplate['email']>) { setTemplate((current) => ({ ...current, email: { ...current.email, ...update } })); }
  function whatsapp(update: Partial<CounterTemplate['whatsapp']>) { setTemplate((current) => ({ ...current, whatsapp: { ...current.whatsapp, ...update } })); }
  const variableOptions = () => counterVariables.map((variable) => <option key={variable} value={variable}>{variableLabel(variable)}</option>);
  const disabled = saving || Boolean(testing) || loaded !== selection;

  return <section className="admin-card counter-notifications">
    {testToast && <div className={`counter-test-toast counter-test-toast-${testToast.tone}`} role={testToast.tone === 'error' ? 'alert' : 'status'} aria-live={testToast.tone === 'error' ? 'assertive' : 'polite'}><span aria-hidden="true">{testToast.tone === 'success' ? '✓' : '!'}</span><p><b>{testToast.tone === 'success' ? 'Test accepted' : 'Test failed'}</b>{testToast.message}</p><button type="button" aria-label="Dismiss notification" onClick={() => setTestToast(null)}>×</button></div>}
    <div className="admin-card-head"><div><h2>Counter notification templates</h2><p>Save one shared template for each counter action. The saved template is used automatically for every event.</p></div><span className="status-pill">All events</span></div>
    <div className="counter-global-scope"><b>GLOBAL TEMPLATE · ALL EVENTS</b><span>{counterActions[action]}</span><small>Event and athlete values are filled from the counter action that triggered the notification.</small></div>
    <div className="form-grid counter-template-scope"><label className="field">Counter action<select disabled={saving} value={action} onChange={(event) => setAction(event.target.value as keyof typeof counterActions)}>{Object.entries(counterActions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="field">Test data and recent attempts event<select disabled={saving} value={eventId} onChange={(event) => setEventId(event.target.value)}>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select><small>This event only supplies test values and filters the activity table. It does not change template scope.</small></label></div>
    {error && <p className="error-banner" role="alert">{error}</p>}{message && <p className="success-banner" role="status">{message}</p>}
    <fieldset disabled={disabled} className="counter-template-fieldset">
      <div className="counter-template-grid">
        <article className="counter-template-card">
          <header><div><span>EMAIL TEMPLATE</span><h3>Email after successful action</h3><p>Use a saved provider template or write a simple custom message.</p></div><label className="counter-channel-toggle"><input type="checkbox" checked={template.email.enabled} onChange={(event) => email({ enabled: event.target.checked })} /><span>{template.email.enabled ? 'Enabled' : 'Disabled'}</span></label></header>
          <label className="field">Email format<select value={template.email.mode} onChange={(event) => email({ mode: event.target.value as CounterTemplate['email']['mode'] })}><option value="PROVIDER_TEMPLATE">Saved provider template</option><option value="CUSTOM">Custom subject and message</option></select></label>
          {template.email.mode === 'PROVIDER_TEMPLATE'
            ? <label className="field">Email template name or ID<input value={template.email.templateId} placeholder="Template name or UUID" onChange={(event) => email({ templateId: event.target.value })} /><small>Use the exact template identifier saved with the email provider.</small></label>
            : <div className="counter-custom-email"><label className="field">Subject<input value={template.email.subject} onChange={(event) => email({ subject: event.target.value })} /></label><label className="field">Message<textarea rows={5} value={template.email.body} onChange={(event) => email({ body: event.target.value })} /><small>Use named values such as {'{{name}}'}, {'{{bib}}'} or {'{{event_name}}'}.</small></label></div>}
          <details className="counter-template-advanced"><summary>Template variables ({template.email.mappings.length})</summary><p>Map each name used by the provider template or custom message.</p><div className="counter-parameter-list">{template.email.mappings.map((mapping, index) => <div key={`email-parameter-${index}`}><input aria-label={`Email parameter ${index + 1}`} value={mapping.token} onChange={(event) => email({ mappings: template.email.mappings.map((item, itemIndex) => itemIndex === index ? { ...item, token: event.target.value } : item) })} /><select aria-label={`Email parameter ${index + 1} value`} value={mapping.variable} onChange={(event) => email({ mappings: template.email.mappings.map((item, itemIndex) => itemIndex === index ? { ...item, variable: event.target.value as CounterVariable } : item) })}>{variableOptions()}</select><button type="button" className="button button-secondary" onClick={() => email({ mappings: template.email.mappings.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button></div>)}</div><button type="button" className="button button-secondary" onClick={() => email({ mappings: [...template.email.mappings, { token: `parameter_${template.email.mappings.length + 1}`, variable: 'name' }] })}>Add variable</button></details>
          <label className="counter-attachment-check"><input type="checkbox" checked={template.email.attachWaiver} onChange={(event) => email({ attachWaiver: event.target.checked })} /><span><b>Attach waiver PDF</b><small>Generated automatically from the event waiver and verified athlete details after OTP confirmation.</small></span></label>
          <div className="counter-test-box"><div><b>Test email</b><small>Sends sample athlete values. Waiver attachments are excluded from tests.</small></div><div><input type="email" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="you@example.com" /><button type="button" className="button button-secondary" disabled={Boolean(testing)} onClick={() => void sendTest('EMAIL')}>{testing === 'EMAIL' ? 'Sending…' : 'Send test email'}</button></div></div>
        </article>

        <article className="counter-template-card">
          <header><div><span>WHATSAPP TEMPLATE</span><h3>WhatsApp after successful action</h3><p>Use an approved provider template and keep parameters in its exact order.</p></div><label className="counter-channel-toggle"><input type="checkbox" checked={template.whatsapp.enabled} onChange={(event) => whatsapp({ enabled: event.target.checked })} /><span>{template.whatsapp.enabled ? 'Enabled' : 'Disabled'}</span></label></header>
          <p>Email uses Bergtecno. WhatsApp uses AiSensy. The AISENSY_API_KEY must be stored as a server-only Worker secret, never in a template.</p>
          <label className="field">AiSensy API campaign name<input value={template.whatsapp.campaignName} placeholder="Exact live AiSensy campaign name" onChange={(event) => whatsapp({ campaignName: event.target.value })} /><small>Create and activate an API campaign in AiSensy with the approved template and language. Enter its exact campaign name here; template and language are selected in AiSensy.</small></label>
          <details className="counter-template-advanced"><summary>Body parameters ({template.whatsapp.parameters.length})</summary><p>The order must match the approved template: {'{{1}}'}, {'{{2}}'}, {'{{3}}'}…</p><div className="counter-parameter-list">{template.whatsapp.parameters.map((variable, index) => <div key={`whatsapp-parameter-${index}`}><b>{`{{${index + 1}}}`}</b><select aria-label={`WhatsApp parameter ${index + 1}`} value={variable} onChange={(event) => whatsapp({ parameters: template.whatsapp.parameters.map((item, itemIndex) => itemIndex === index ? event.target.value as CounterVariable : item) })}>{variableOptions()}</select><button type="button" className="button button-secondary" onClick={() => whatsapp({ parameters: template.whatsapp.parameters.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button></div>)}</div><button type="button" className="button button-secondary" onClick={() => whatsapp({ parameters: [...template.whatsapp.parameters, 'name'] })}>Add parameter</button></details>
          <label className="counter-attachment-check"><input type="checkbox" checked={template.whatsapp.attachWaiver} onChange={(event) => whatsapp({ attachWaiver: event.target.checked })} /><span><b>Attach waiver PDF as document header</b><small>The PDF is generated automatically after OTP confirmation. The approved WhatsApp template must include a document header.</small></span></label>
          <div className="counter-test-box"><div><b>Test WhatsApp</b><small>Sends sample athlete values in the configured parameter order. Document-header campaigns include a sample PDF.</small></div><div><input type="tel" value={testMobile} onChange={(event) => setTestMobile(event.target.value)} placeholder="+919999999999" /><button type="button" className="button button-secondary" disabled={Boolean(testing)} onClick={() => void sendTest('WHATSAPP')}>{testing === 'WHATSAPP' ? 'Sending…' : 'Send test WhatsApp'}</button></div></div>
        </article>
      </div>

      {(template.email.attachWaiver || template.whatsapp.attachWaiver) && <div className="counter-waiver-settings counter-waiver-automatic" role="status"><b>Automatic waiver attachment</b><p>After the athlete confirms the email OTP, Race Upshot creates the populated waiver PDF, stores it securely, and attaches that exact document. No PDF field or document origin setup is required.</p></div>}
      <div className="counter-template-save"><div><b>All events</b><span>{counterActions[action]}</span></div><button type="button" className="button button-primary" onClick={() => void save()}>{saving ? 'Saving…' : 'Save shared template'}</button></div>
    </fieldset>

    <div className="admin-card-head counter-attempts-head"><div><h3>Recent notification attempts</h3><p>Provider accepted means submitted for delivery, not confirmed delivered.</p></div><button type="button" className="button button-secondary" disabled={saving} onClick={() => setRevision((current) => current + 1)}>Refresh</button></div>
    <div className="table-wrap"><table className="leaderboard"><thead><tr><th>BIB</th><th>Action</th><th>Channel</th><th>Status</th><th>Details</th></tr></thead><tbody>{deliveries.map((row) => <tr key={`${row.operationId}:${row.channel}`}><td>{row.bib}</td><td>{counterActions[row.action as keyof typeof counterActions] || row.action}</td><td>{row.channel}</td><td>{row.status.replace(/_/g, ' ')}</td><td>{row.error || [row.campaignName, row.createdAt].filter(Boolean).join(' · ')}</td></tr>)}{!deliveries.length && <tr><td colSpan={5}>No notification attempts recorded for this event.</td></tr>}</tbody></table></div>
  </section>;
}
