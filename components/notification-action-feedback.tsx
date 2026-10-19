import { Loader2 } from "lucide-react";

export function NotificationActionFeedback({ busy, notice, error, emailReady, whatsappReady }: {
  busy: string; notice: string; error: string; emailReady: boolean; whatsappReady: boolean;
}) {
  const pending = busy.startsWith("notify-");
  return <div className="notification-action-feedback" aria-busy={pending}>
    {!emailReady && <p>Email sending is unavailable. Enable notifications, finisher messages and Email, configure the applicable template(s), then save settings.</p>}
    {!whatsappReady && <p>WhatsApp sending is unavailable. Enable notifications, finisher messages and WhatsApp, configure the applicable campaign(s), then save settings.</p>}
    {error ? <div className="notification-action-error" role="alert">{error}</div> : (pending || notice) ? <div role="status" aria-live="polite">
      {pending && <Loader2 className="spin" aria-hidden="true" />}
      <span>{notice || (busy === "notify-sending" ? "Sending notifications…" : "Checking eligible recipients…")}</span>
    </div> : null}
  </div>;
}
