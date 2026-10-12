import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const DEVICE_ID_KEY = "bergman.push.deviceId";

async function getStorageItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function setStorageItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* ignore */
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

/** Stable, non-account device identity shared by guest push and watchlist APIs. */
export async function getPersistedPushDeviceId(): Promise<string> {
  const existing = await getStorageItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const generated =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await setStorageItem(DEVICE_ID_KEY, generated);
  return generated;
}
