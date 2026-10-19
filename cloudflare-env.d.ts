import type { DurableObjectNamespace, Fetcher, KVNamespace, R2Bucket } from "@cloudflare/workers-types";
import type { BrowserWorker } from "@cloudflare/puppeteer";

declare global {
interface CloudflareEnv {
  RACEUPSHOT: KVNamespace;
  EVENT_MEDIA: R2Bucket;
  ASSETS: Fetcher;
  BROWSER: BrowserWorker;
  CANONICAL_CHANGE_HUB: DurableObjectNamespace;
  VOLUNTEER_OPERATIONS: DurableObjectNamespace;
  RFID_WRITE_COORDINATOR: DurableObjectNamespace;
  APP_ENV: string;
  TRANSACTIONAL_NOTIFICATIONS_LIVE_ENABLED?: string;
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  RACEUPSHOT_RFID_SIGNING_SECRET?: string;
  ATHLETE_SESSION_SECRET?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_STREAM_API_TOKEN?: string;
  STREAM_PROVISIONING_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  KV_TOKEN?: string;
  BERGTECHNO_EMAIL_API_BASE_URL?: string;
  BERGTECNO_EMAIL_API_BASE_URL?: string;
  BERGTECHNO_EMAIL_API_KEY?: string;
  BERGTECNO_EMAIL_API_KEY?: string;
  BERGTECHNO_EMAIL_API_KEY_HEADER?: string;
  BERGTECNO_EMAIL_API_KEY_HEADER?: string;
  BERGTECHNO_EMAIL_RAW_SEND_PATH?: string;
  BERGTECNO_EMAIL_RAW_SEND_PATH?: string;
  BERGTECHNO_EMAIL_TEMPLATE_SEND_PATH?: string;
  BERGTECNO_EMAIL_TEMPLATE_SEND_PATH?: string;
  BERGTECHNO_EMAIL_BULK_SEND_PATH?: string;
  BERGTECNO_EMAIL_BULK_SEND_PATH?: string;
  BERGTECHNO_SENDER_EMAIL?: string;
  BERGTECNO_SENDER_EMAIL?: string;
  BERGTECHNO_SENDER_NAME?: string;
  BERGTECNO_SENDER_NAME?: string;
  BERGTECHNO_WHATSAPP_API_BASE_URL?: string;
  BERGTECHNO_WHATSAPP_API_KEY?: string;
  AISENSY_API_KEY?: string;
  BERGTECHNO_WHATSAPP_API_KEY_HEADER?: string;
  BERGTECHNO_WHATSAPP_SEND_PATH?: string;
}
}

export {};
