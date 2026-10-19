import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Secure session storage. Stores ONLY lightweight session metadata (uid, email)
 * — never profile, athlete, event, or tracking data (those belong to React
 * Query). Firebase manages the ID/refresh tokens itself.
 */

const SESSION_KEY = 'raceupshot.session';
const ACCESS_TOKEN_KEY = 'raceupshot.accessToken';

export type SessionMeta = {
  uid: string;
  email: string | null;
  lastLoginAt: number;
};

const isWeb = Platform.OS === 'web';

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* ignore */
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    // Public event and tracking requests must remain usable when iOS Keychain
    // is temporarily unavailable (for example immediately after an app update,
    // restore, or while protected data is locked). Authenticated endpoints will
    // still reject the request normally when no token can be recovered.
    return null;
  }
}

async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function saveSessionMeta(meta: SessionMeta): Promise<void> {
  await setItem(SESSION_KEY, JSON.stringify(meta));
}

export async function getSessionMeta(): Promise<SessionMeta | null> {
  const raw = await getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionMeta;
  } catch {
    return null;
  }
}

export async function clearSessionMeta(): Promise<void> {
  await deleteItem(SESSION_KEY);
}

export async function saveAccessToken(token: string): Promise<void> {
  await setItem(ACCESS_TOKEN_KEY, token);
}

export async function getAccessToken(): Promise<string | null> {
  return getItem(ACCESS_TOKEN_KEY);
}

export async function clearAccessToken(): Promise<void> {
  await deleteItem(ACCESS_TOKEN_KEY);
}
