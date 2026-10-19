import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NotificationActionFeedback } from "@/components/notification-action-feedback";

const ready = { emailReady: true, whatsappReady: true, busy: "", notice: "", error: "" };
describe("notification action feedback", () => {
  it("shows checking and sending progress accessibly", () => {
    const checking = renderToStaticMarkup(<NotificationActionFeedback {...ready} busy="notify-checking" />);
    expect(checking).toContain("Checking eligible recipients");
    expect(checking).toContain('aria-busy="true"');
    expect(checking).toContain('role="status"');
    const sending = renderToStaticMarkup(<NotificationActionFeedback {...ready} busy="notify-sending" />);
    expect(sending).toContain("Sending notifications");
  });
  it("displays zero-recipient or cancellation explanations after the request ends", () => {
    for (const notice of ["No sendable recipients in this batch.", "Sending cancelled. No notifications were submitted."]) {
      const html = renderToStaticMarkup(<NotificationActionFeedback {...ready} notice={notice} />);
      expect(html).toContain(notice);
      expect(html).toContain('aria-busy="false"');
    }
  });
  it("shows a request error instead of a stale success message", () => {
    const html = renderToStaticMarkup(<NotificationActionFeedback {...ready} error="Provider unavailable" notice="Batch completed" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Provider unavailable");
    expect(html).not.toContain("Batch completed");
  });
  it("explains disabled channels without enabling them", () => {
    const html = renderToStaticMarkup(<NotificationActionFeedback {...ready} emailReady={false} whatsappReady={false} />);
    expect(html).toContain("Email sending is unavailable");
    expect(html).toContain("WhatsApp sending is unavailable");
    expect(html).toContain("then save settings");
  });
});
