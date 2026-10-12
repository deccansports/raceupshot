# Counter notification providers

Email continues to use Bergtecno. Automatic and admin-test WhatsApp counter
notifications use AiSensy; there is no fallback to the Bergtecno email credential.
Other existing WhatsApp workflows are not changed by this counter-specific switch.

## Server-only credential

In the Cloudflare dashboard, select the **Race Upshot application Worker** (not
the timing Worker), then Settings > Variables and Secrets. Add `AISENSY_API_KEY`
as a **Secret**. Do not put its value in source, `wrangler.jsonc`, counter
templates, public environment variables, mobile configuration or chat.
This implementation does not provision or deploy that secret.

## Campaign setup

In AiSensy create a live API campaign using an approved WhatsApp template.
In Volunteers > Counter Notifications enter its exact campaign name and map
the body parameters in order. Template and language are selected in AiSensy.
Existing stored templateName/language fields are retained, but not sent to AiSensy.
Existing internal campaign labels must be replaced with actual live API campaign names.
Shared counter templates and legacy event fallback remain unchanged.

Signed waiver attachments use the saved athlete PDF URL and trusted origin.
The campaign must support a document header and AiSensy must be able to fetch
the URL. Prefer a limited-lived signed URL; do not make the waiver database public.
This change does not generate PDFs or signed URLs.

Provider acceptance is not confirmed recipient delivery. Timeout/network errors
are not retried automatically because their acceptance status is ambiguous.
Errors returned to callers are generic: raw provider responses and credentials
are not logged or persisted. Background dispatch is still best-effort.

API reference: https://wiki.aisensy.com/en/articles/11501889-api-reference-docs
