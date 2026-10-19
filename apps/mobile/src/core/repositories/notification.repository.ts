import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";

import {
  authenticatedJson,
  optionalAuthenticatedJson,
} from "@/core/auth/authenticatedFetch";
import { getFirebaseAuth } from "@/core/auth/firebase";
import { getPersistedPushDeviceId } from "@/core/services/pushDeviceIdentity";

export type NotificationType = "raceAlert" | "athleteUpdate" | "system";

export type NotificationModel = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  timeLabel: string;
  group: "Today" | "Earlier";
  read: boolean;
};

type RawNotification = Partial<NotificationModel> & {
  notificationId?: string | number | null;
  notification_type?: string | null;
  type?: string | null;
  title?: string | null;
  body?: string | null;
  message?: string | null;
  timeLabel?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  read?: boolean | null;
  isRead?: boolean | null;
  readAt?: string | null;
  group?: NotificationModel["group"] | string | null;
};

function toText(value: unknown): string {
  return String(value ?? "").trim();
}

async function loadNotificationsModule() {
  return import("expo-notifications");
}

function normalizeType(value: unknown): NotificationType {
  const text = toText(value).toLowerCase();
  if (text.includes("athlete")) return "athleteUpdate";
  if (text.includes("system")) return "system";
  return "raceAlert";
}

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function normalizeNotification(
  raw: RawNotification,
  index: number,
): NotificationModel {
  const createdAt = raw.createdAt ?? raw.created_at ?? null;
  const date = createdAt ? new Date(createdAt) : null;
  return {
    id: toText(raw.id ?? raw.notificationId) || `notification-${index}`,
    type: normalizeType(raw.type ?? raw.notification_type),
    title: toText(raw.title) || "Notification",
    body: toText(raw.body ?? raw.message),
    timeLabel:
      toText(raw.timeLabel) || (date ? date.toLocaleDateString() : "Now"),
    group:
      raw.group === "Today" || raw.group === "Earlier"
        ? raw.group
        : date && isToday(date)
          ? "Today"
          : "Earlier",
    read: Boolean(raw.read ?? raw.isRead ?? raw.readAt),
  };
}

async function callNotificationAction(
  path: string,
  body?: unknown,
): Promise<void> {
  try {
    await authenticatedJson<void>(
      path,
      body === undefined ? { method: "POST" } : { method: "POST", body },
    );
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      return;
    }
    throw error;
  }
}

/**
 * Notification repository backed by the Mobile API Worker.
 * Permission + device token flow remains local; remote notification state is
 * fetched and updated through authenticated REST endpoints.
 */
export interface INotificationRepository {
  requestPermissions(): Promise<boolean>;
  hasPermissions(): Promise<boolean>;
  getDeviceToken(): Promise<string | null>;
  registerDeviceToken(token: string): Promise<void>;
  getRegistrationIdentity(): Promise<string>;
  onTokenRefresh(callback: () => void): { remove: () => void };
  getNotifications(signal?: AbortSignal): Promise<NotificationModel[]>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
}

export const ProductionNotificationRepository: INotificationRepository = {
  async requestPermissions() {
    try {
      if (Platform.OS === "web" || !Device.isDevice) return false;
      const Notifications = await loadNotificationsModule();
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("live-timing", {
          name: "Live athlete timing",
          importance: Notifications.AndroidImportance.HIGH,
          sound: "default",
          vibrationPattern: [0, 250, 150, 250],
          lockscreenVisibility:
            Notifications.AndroidNotificationVisibility.PUBLIC,
        });
      }
      const { status } = await Notifications.requestPermissionsAsync();
      return status === "granted";
    } catch {
      return false;
    }
  },
  async hasPermissions() {
    try {
      if (Platform.OS === "web" || !Device.isDevice) return false;
      const Notifications = await loadNotificationsModule();
      return (await Notifications.getPermissionsAsync()).status === "granted";
    } catch {
      return false;
    }
  },
  async getDeviceToken() {
    try {
      if (Platform.OS === "web" || !Device.isDevice) return null;
      const Notifications = await loadNotificationsModule();
      const projectId =
        Constants.easConfig?.projectId ??
        Constants.expoConfig?.extra?.eas?.projectId ??
        Constants.expoConfig?.extra?.expoProjectId;
      const token = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined,
      );
      return token.data ? String(token.data) : null;
    } catch {
      return null;
    }
  },
  async registerDeviceToken(token) {
    await optionalAuthenticatedJson("/api/mobile/push/register", {
      method: "POST",
      body: {
        expoPushToken: token,
        platform: Platform.OS,
        deviceId: await getPersistedPushDeviceId(),
        appVersion:
          Constants.expoConfig?.version ??
          Constants.nativeAppVersion ??
          "1.0.0",
        app: "race",
      },
    });
  },
  async getRegistrationIdentity() {
    const auth = await getFirebaseAuth();
    const deviceId = await getPersistedPushDeviceId();
    return `${auth.currentUser?.uid || "guest"}:${deviceId}`;
  },
  onTokenRefresh(callback) {
    if (Platform.OS === "web") {
      return { remove: () => {} };
    }
    try {
      let subscription: { remove: () => void } | null = null;
      void loadNotificationsModule()
        .then((Notifications) => {
          // Expo emits the native APNs/FCM token here. Reacquire the Expo token
          // in the lifecycle service before registering with the Expo sender.
          subscription = Notifications.addPushTokenListener(() => callback());
        })
        .catch(() => {});
      return {
        remove: () => subscription?.remove(),
      };
    } catch {
      return { remove: () => {} };
    }
  },
  async getNotifications(signal) {
    try {
      const res = await authenticatedJson<unknown>("/api/notifications", {
        signal,
      });
      const payload = Array.isArray(res)
        ? res
        : Array.isArray((res as { notifications?: unknown[] }).notifications)
          ? (res as { notifications: unknown[] }).notifications
          : Array.isArray((res as { items?: unknown[] }).items)
            ? (res as { items: unknown[] }).items
            : Array.isArray((res as { data?: unknown[] }).data)
              ? (res as { data: unknown[] }).data
              : [];
      return payload.map((item, index) =>
        normalizeNotification(item as RawNotification, index),
      );
    } catch (error) {
      if ((error as { status?: number }).status === 404) return [];
      throw error;
    }
  },
  async markRead(id) {
    await callNotificationAction(
      `/api/notifications/${encodeURIComponent(id)}/read`,
    );
  },
  async markAllRead() {
    await callNotificationAction("/api/notifications/read-all");
  },
};
