import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { Platform } from 'react-native';

const { getAuth, initializeAuth } = FirebaseAuth;
type AuthPersistence = NonNullable<
  NonNullable<Parameters<typeof initializeAuth>[1]>['persistence']
>;
const getReactNativePersistence = (
  FirebaseAuth as unknown as {
    getReactNativePersistence: (storage: typeof AsyncStorage) => AuthPersistence;
  }
).getReactNativePersistence;

/**
 * Firebase client bootstrap. Mirrors the web app (project racehub-ao1fu).
 *
 * Config comes from EXPO_PUBLIC_FIREBASE_* env vars, with the public production
 * client config as a built-in fallback. This must be available synchronously:
 * fetching a public config endpoint delayed every cold app launch before auth
 * state restoration could start. No secrets or Admin SDK are used — Client SDK
 * only.
 *
 * Persistence: web uses the SDK default (indexedDB/localStorage). Native uses
 * Firebase's AsyncStorage-backed persistence so background termination and cold
 * starts restore the same Firebase user. Session metadata is also mirrored to
 * Secure Store as a temporary offline UI fallback; Firebase remains the auth
 * authority.
 */
export type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
};

// Only Firebase Auth is used on mobile. Read data flows through the backend
// REST APIs; the app does not talk to non-auth datastores directly.
export type FirebaseServices = {
  app: FirebaseApp;
  auth: Auth;
};

const DEFAULT_FIREBASE_CONFIG: FirebaseConfig = {
  apiKey: 'AIzaSyC3w4uw-OrGHlZqsV5FV387OXXYySm15X4',
  authDomain: 'racehub-ao1fu.firebaseapp.com',
  projectId: 'racehub-ao1fu',
  storageBucket: 'racehub-ao1fu.firebasestorage.app',
  messagingSenderId: '837999546022',
  appId: '1:837999546022:web:9ddc6b719fca31a60fee67',
  measurementId: 'G-JHMNW5ZJD1',
};

function configFromEnv(): FirebaseConfig | null {
  const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.EXPO_PUBLIC_FIREBASE_APP_ID;
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? `${projectId}.appspot.com`,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
    measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
  };
}

let services: FirebaseServices | null = null;
let initPromise: Promise<FirebaseServices> | null = null;

/** Lazily initializes Firebase without a launch-time network dependency. */
export function ensureFirebase(): Promise<FirebaseServices> {
  if (services) return Promise.resolve(services);
  if (!initPromise) {
    initPromise = (async () => {
      const config = configFromEnv() ?? DEFAULT_FIREBASE_CONFIG;
      if (process.env.NODE_ENV !== 'production') {
        console.log('Firebase initialization', {
          projectId: config.projectId,
          existingApps: getApps().length,
        });
      }
      if (!config.apiKey) {
        throw new Error('Firebase config missing apiKey');
      }
      const app = getApps().length ? getApp() : initializeApp(config);
      let auth: Auth;
      if (Platform.OS === 'web') {
        auth = getAuth(app);
      } else {
        try {
          auth = initializeAuth(app, {
            persistence: getReactNativePersistence(AsyncStorage),
          });
        } catch (error) {
          // Fast Refresh or another Firebase consumer may have initialized Auth
          // first. Reuse that exact instance instead of replacing its session.
          if ((error as { code?: string }).code !== 'auth/already-initialized') {
            throw error;
          }
          auth = getAuth(app);
        }
      }
      services = { app, auth };
      return services;
    })();
  }
  return initPromise;
}

export async function getFirebaseAuth(): Promise<Auth> {
  return (await ensureFirebase()).auth;
}

/** Returns the current Firebase ID token when a user is signed in, while
 * keeping public live-tracking requests usable for signed-out spectators. */
export async function getOptionalFirebaseIdToken(forceRefresh = false): Promise<string | null> {
  try {
    const auth = await getFirebaseAuth();
    return auth.currentUser ? await auth.currentUser.getIdToken(forceRefresh) : null;
  } catch {
    return null;
  }
}
