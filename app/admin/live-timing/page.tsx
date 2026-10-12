import { AdminLayout } from "@/components/admin-layout";
import { LiveTrackingHub } from "@/components/live-tracking-hub";
import {
  getFeibotAccountCredentialStatus,
  getFeibotOperationsDashboard,
  type FeibotAccountCredentialStatus,
} from "@/lib/feibot-integration";
import { getAdminEventCourseMaps } from "@/lib/course-maps";
import {
  defaultLiveTrackingHubConfig,
  getLiveTrackingHubConfig,
} from "@/lib/live-tracking-hub-config";
import {
  defaultEventPlatformSettings,
  getEventPlatformSettings,
} from "@/lib/platform-repository";
import { getEvents, getResults } from "@/lib/raceupshot-repository";

export const dynamic = "force-dynamic";
const KV_READ_TIMEOUT_MS = 8_000;

async function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} did not respond in time.`)),
          KV_READ_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const unavailableAccountCredentials: FeibotAccountCredentialStatus = {
  configured: false,
  accountId: "",
  accessKeyMasked: null,
  baseUrl: "https://apicn.feibot.com",
  updatedAt: null,
  lastTestedAt: null,
  connected: null,
  message: null,
};

function retryCard(message: string) {
  return (
    <AdminLayout>
      <main className="admin-content">
        <section className="admin-card" role="alert">
          <div className="admin-card-head">
            <div>
              <h1>Live timing is temporarily unavailable</h1>
              <p>{message}</p>
              <p>Your event, timing and course-map data has not been changed.</p>
            </div>
          </div>
          <form method="get" action="/admin/live-timing">
            <button type="submit" className="button button-primary">Retry loading live timing</button>
          </form>
        </section>
      </main>
    </AdminLayout>
  );
}

export default async function AdminLivePage() {
  const [eventsResult, accountCredentialsResult] = await Promise.allSettled([
    withTimeout(getEvents({ includeUnpublished: true }), "The event store"),
    withTimeout(getFeibotAccountCredentialStatus(), "Account credentials"),
  ]);

  if (eventsResult.status === "rejected") {
    console.error("[AdminLivePage] Event data unavailable:", eventsResult.reason);
    return retryCard("The Cloudflare event store did not respond after bounded retries.");
  }

  const accountCredentials = accountCredentialsResult.status === "fulfilled"
    ? accountCredentialsResult.value
    : unavailableAccountCredentials;
  let degradedReads = accountCredentialsResult.status === "rejected" ? 1 : 0;
  const hubEvents = [];

  // Load one event at a time. A remote development binding has a small local
  // proxy connection pool; fanning every event and every KV read out at once
  // makes an otherwise transient proxy restart take down the whole page.
  for (const event of eventsResult.value) {
    const [settingsResult, configResult, courseMapsResult, resultsResult, operationsResult] = await Promise.allSettled([
      withTimeout(getEventPlatformSettings(event.id), "Event settings"),
      withTimeout(getLiveTrackingHubConfig(event.id), "Live timing configuration"),
      withTimeout(getAdminEventCourseMaps(event.id), "Course maps"),
      withTimeout(getResults(event.id), "Event results"),
      withTimeout(getFeibotOperationsDashboard(event.id), "Live operations"),
    ]);

    const eventFailures = [settingsResult, configResult, courseMapsResult, resultsResult, operationsResult]
      .filter((result) => result.status === "rejected").length;
    degradedReads += eventFailures;
    if (operationsResult.status === "rejected") {
      console.error(`[AdminLivePage] Live operations unavailable for ${event.id}:`, operationsResult.reason);
      continue;
    }
    const settings = settingsResult.status === "fulfilled" && settingsResult.value
      ? settingsResult.value
      : defaultEventPlatformSettings(event);
    const config = configResult.status === "fulfilled" && configResult.value
      ? configResult.value
      : defaultLiveTrackingHubConfig(event.id);
    const courseMaps = courseMapsResult.status === "fulfilled" && courseMapsResult.value
      ? courseMapsResult.value
      : { eventId: event.id, maps: [], updatedAt: null };
    const results = resultsResult.status === "fulfilled"
      ? resultsResult.value.athletes
      : [];
    const operations = operationsResult.value;
    hubEvents.push({
      ...event,
      categories: settings?.timingIntegration?.contestMappings.map((item) => item.contestId).filter(Boolean).length
        ? settings.timingIntegration!.contestMappings.map((item) => item.contestId)
        : event.categories,
      feibot: operations.connection,
      config,
      courseMaps,
      results,
      settings,
      operations,
    });
  }

  if (eventsResult.value.length > 0 && hubEvents.length === 0) {
    return retryCard("Event records loaded, but the event-scoped live operations data is temporarily unreachable.");
  }
  const loadWarning = degradedReads > 0
    ? `${degradedReads} Cloudflare KV read${degradedReads === 1 ? "" : "s"} could not be completed. Safe defaults are shown for optional data; refresh before saving changes.`
    : "";
  return (
    <AdminLayout>
      <main className="admin-content">
        <LiveTrackingHub
          events={hubEvents}
          initialAccountCredentials={accountCredentials}
          loadWarning={loadWarning}
        />
      </main>
    </AdminLayout>
  );
}
