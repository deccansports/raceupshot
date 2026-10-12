import { escapeEmailHtml } from './bergtecno-email';

type SignedWaiverEmailValues = {
  athleteName: string;
  eventName: string;
  category: string;
  eventDate: string;
  bib: string;
  signedAt: string;
  attachmentIncluded?: boolean;
};

function displayDate(value: string) {
  if (!value.trim()) return 'To be announced';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(date);
}

function displayTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'Asia/Kolkata', timeZoneName: 'short',
  }).format(date);
}

export function signedWaiverConfirmationEmail(values: SignedWaiverEmailValues) {
  const athleteName = escapeEmailHtml(values.athleteName || 'Athlete');
  const eventName = escapeEmailHtml(values.eventName || 'Race Upshot event');
  const category = escapeEmailHtml(values.category || 'Not specified');
  const eventDate = escapeEmailHtml(displayDate(values.eventDate));
  const bib = escapeEmailHtml(values.bib || 'Not assigned');
  const signedAt = escapeEmailHtml(displayTimestamp(values.signedAt));
  const attachmentIncluded = values.attachmentIncluded !== false;

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>Waiver signed | ${eventName}</title></head>
<body style="margin:0;padding:0;background:#07111f;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your Race Upshot waiver is signed.${attachmentIncluded ? ' Your OTP-signed waiver PDF is attached.' : ''}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#07111f;border-collapse:collapse;"><tr><td align="center" style="padding:30px 12px;">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width:100%;max-width:620px;background:#102033;border-radius:16px;overflow:hidden;border-collapse:collapse;">
<tr><td height="5" style="background:#ff6b2c;font-size:0;">&nbsp;</td></tr>
<tr><td align="center" style="background:#0b1828;padding:28px 20px 24px;"><img src="https://raceupshot.com/Race%20Upshot%20logo.png" alt="Race Upshot" width="170" style="border:0;display:block;width:170px;max-width:100%;height:auto;margin:auto;"><p style="margin:14px 0 0;color:#8fb7d9;font-size:10px;font-weight:700;letter-spacing:2px;">PRECISION RACE TIMING</p></td></tr>
<tr><td align="center" style="padding:34px 30px 24px;"><div style="display:inline-block;background:#123c2b;color:#61e294;padding:9px 20px;border-radius:30px;font-size:11px;font-weight:700;letter-spacing:1.4px;">&#10003; WAIVER SIGNED</div><h1 style="margin:22px 0 10px;color:#fff;font-size:30px;line-height:1.15;font-weight:900;">WAIVER VERIFIED</h1><p style="margin:0;color:#ff7a3d;font-size:20px;font-weight:700;">${athleteName}</p><p style="margin:18px 0 0;color:#c4d1df;font-size:14px;line-height:1.8;">Your waiver for <strong style="color:#fff;">${eventName}</strong> has been signed successfully. Check-in remains independent for each registration.</p></td></tr>
<tr><td style="padding:5px 30px 25px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#14283e;border:1px solid #29445f;border-radius:12px;border-collapse:separate;overflow:hidden;"><tr><td colspan="2" style="padding:20px 20px 14px;color:#ff7a3d;font-size:12px;font-weight:800;letter-spacing:1.4px;">ATHLETE DETAILS</td></tr>
${detailRow('Athlete name', athleteName)}${detailRow('Event', eventName)}${detailRow('Race category', category)}${detailRow('Event date', eventDate)}${detailRow('BIB number', bib, '#ff7a3d')}${detailRow('Confirmed at', signedAt, '#61e294', true)}
</table></td></tr>
<tr><td style="padding:0 30px 30px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#102d25;border:1px solid #28634b;border-radius:12px;border-collapse:separate;"><tr><td style="padding:22px;"><p style="margin:0 0 12px;color:#61e294;font-size:14px;font-weight:800;">&#10003; DIGITAL WAIVER SIGNED</p><p style="margin:0;color:#d5e2e0;font-size:13px;line-height:1.85;">Your Athlete Waiver and Liability Agreement was digitally signed using email OTP verification.${attachmentIncluded ? ' Your OTP-verified signed waiver PDF is attached to this email for your records.' : ''}</p><div style="margin-top:18px;padding:12px 15px;background:#174235;border-radius:8px;color:#a2f1c4;font-size:12px;font-weight:700;line-height:1.8;">&#10003; OTP verification completed<br>&#10003; Waiver digitally signed<br>&#8226; Check-in is completed separately per registration</div></td></tr></table></td></tr>
<tr><td align="center" style="padding:0 30px 35px;"><p style="margin:0;color:#fff;font-size:15px;font-weight:700;">ALL SET. RACE READY.</p><p style="margin:12px 0 0;color:#a9b8c7;font-size:13px;line-height:1.8;">We look forward to seeing you at the start line.<br>Wishing you a safe and memorable race.</p><p style="margin:22px 0 0;color:#ff7a3d;font-size:13px;font-weight:800;">TEAM RACE UPSHOT</p></td></tr>
<tr><td align="center" style="background:#091522;padding:24px 20px;border-top:1px solid #29445f;"><p style="margin:0;color:#8293a5;font-size:11px;line-height:1.8;">This automated confirmation was generated after your digital waiver submission. It is not a check-in receipt.</p><p style="margin:10px 0 0;color:#ff7a3d;font-size:11px;font-weight:700;letter-spacing:1px;">RACE UPSHOT</p></td></tr>
<tr><td height="4" style="background:#ff6b2c;font-size:0;">&nbsp;</td></tr></table></td></tr></table></body></html>`;
}

function detailRow(label: string, value: string, color = '#ffffff', last = false) {
  return `<tr><td style="padding:12px 20px;color:#9fb0c1;font-size:13px;${last ? '' : 'border-bottom:1px solid #29445f;'}">${label}</td><td align="right" style="padding:12px 20px;color:${color};font-size:13px;font-weight:700;${last ? '' : 'border-bottom:1px solid #29445f;'}">${value}</td></tr>`;
}
