"use client";

import Script from "next/script";

export function ContactTurnstile({ siteKey }: { siteKey: string }) {
  if (!siteKey) {
    return (
      <div className="turnstile-configuration-error">
        Security verification is unavailable because the Turnstile site key is not configured.
      </div>
    );
  }
  return (
    <div className="contact-turnstile">
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      <div
        className="cf-turnstile"
        data-sitekey={siteKey}
        data-action="contact_enquiry"
        data-appearance="interaction-only"
        data-size="flexible"
        data-theme="light"
      />
      <small>Protected by Cloudflare Turnstile. Verification runs automatically.</small>
    </div>
  );
}
