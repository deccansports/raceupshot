import * as SecureStore from "expo-secure-store";
import { Alert, Platform } from "react-native";

import { repositories } from "@/core/repositories/RepositoryFactory";

/**
 * Push notification lifecycle manager (FCM architecture prep):
 *  - request permission + get device token
 *  - register with retry (backoff) and de-duplication (skip unchanged token)
 *  - re-register on token refresh
 *  - cleanup on logout (remove listeners, clear cached token)
 */
let lastRegistrationKey: string | null = null;
let tokenSubscription: { remove: () => void } | null = null;

const TRACKING_NOTIFICATION_PROMPT_KEY =
  "raceupshot.notifications.trackingPrompted";
const TRACKING_NOTIFICATION_ENABLED_KEY =
  "raceupshot.notifications.trackingEnabled";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function getPrompted(): Promise<boolean> {
  try {
    const value =
      Platform.OS === "web"
        ? globalThis.localStorage?.getItem(TRACKING_NOTIFICATION_PROMPT_KEY)
        : await SecureStore.getItemAsync(TRACKING_NOTIFICATION_PROMPT_KEY);
    return value === "true";
  } catch {
    return false;
  }
}

async function setPrompted(): Promise<void> {
  try {
    if (Platform.OS === "web") {
      globalThis.localStorage?.setItem(
        TRACKING_NOTIFICATION_PROMPT_KEY,
        "true",
      );
      return;
    }
    await SecureStore.setItemAsync(TRACKING_NOTIFICATION_PROMPT_KEY, "true");
  } catch {
    /* ignore */
  }
}

async function getEnabled(): Promise<boolean> {
  try {
    const value =
      Platform.OS === "web"
        ? globalThis.localStorage?.getItem(TRACKING_NOTIFICATION_ENABLED_KEY)
        : await SecureStore.getItemAsync(TRACKING_NOTIFICATION_ENABLED_KEY);
    return value === "true";
  } catch {
    return false;
  }
}

async function setEnabled(enabled = true): Promise<void> {
  try {
    if (Platform.OS === "web") {
      globalThis.localStorage?.setItem(
        TRACKING_NOTIFICATION_ENABLED_KEY,
        String(enabled),
      );
      return;
    }
    await SecureStore.setItemAsync(
      TRACKING_NOTIFICATION_ENABLED_KEY,
      String(enabled),
    );
  } catch {
    /* ignore */
  }
}

async function registerWithRetry(
  token: string,
  attempts = 3,
): Promise<boolean> {
  const registrationKey = `${await repositories.notifications.getRegistrationIdentity()}:${token}`;
  if (registrationKey === lastRegistrationKey) return true;
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await repositories.notifications.registerDeviceToken(token);
      lastRegistrationKey = registrationKey;
      return true;
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number | null }).status;
      if (status && status < 500) break;
      await delay(2 ** i * 500);
    }
  }
  console.warn("[push] device registration failed", lastError);
  return false;
}

/** Initialize push registration for either a signed-in user or a guest device. */
export async function initPushRegistration(): Promise<boolean> {
  const granted = await repositories.notifications.requestPermissions();
  if (!granted) return false;

  const token = await repositories.notifications.getDeviceToken();
  if (!token) return false;
  const registered = await registerWithRetry(token);
  if (!registered) return false;

  tokenSubscription?.remove();
  tokenSubscription = repositories.notifications.onTokenRefresh(() => {
    void repositories.notifications.getDeviceToken().then((refreshed) => {
      if (refreshed) return registerWithRetry(refreshed);
    });
  });
  return true;
}

/** Explicitly enable timing pushes from the Live Tracking bell. */
export async function enableTrackedAthleteNotifications(): Promise<boolean> {
  await setPrompted();
  await setEnabled(true);
  return initPushRegistration();
}

export async function trackedAthleteNotificationsEnabled(): Promise<boolean> {
  return (
    (await getEnabled()) && (await repositories.notifications.hasPermissions())
  );
}

export async function promptTrackedAthleteNotifications(): Promise<void> {
  if (await getPrompted()) return;
  await setPrompted();

  const enable = () => {
    void enableTrackedAthleteNotifications();
  };

  if (Platform.OS === "web") {
    const accepted = globalThis.confirm?.(
      "Enable notifications to receive live updates when this athlete starts, reaches a split, finishes, or receives a race-status update.",
    );
    if (accepted) enable();
    return;
  }

  Alert.alert(
    "Enable Notifications",
    "Enable notifications to receive live updates when this athlete starts, reaches a split, finishes, or receives a race-status update.",
    [
      { text: "Not Now", style: "cancel" },
      { text: "Enable Notifications", onPress: enable },
    ],
  );
}

/** Restore a previously accepted notification preference without prompting. */
export async function resumePushRegistrationIfEnabled(): Promise<void> {
  const enabled = await getEnabled();
  const alreadyGranted = await repositories.notifications.hasPermissions();
  if (!enabled && !alreadyGranted) return;
  if (!enabled) await setEnabled();
  await initPushRegistration();
}

/** Cleanup on logout: remove listeners and clear the cached token. */
export function teardownPushRegistration(): void {
  tokenSubscription?.remove();
  tokenSubscription = null;
  lastRegistrationKey = null;
}
