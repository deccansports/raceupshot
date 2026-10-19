import type { Persistence } from "firebase/auth";
import "firebase/auth";

interface ReactNativeAuthStorage {
  setItem(key: string, value: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
}

declare module "firebase/auth" {
  /**
   * Firebase exposes this from its React Native entry point at runtime. This
   * declaration bridges TypeScript's web-first package condition resolution.
   */
  export function getReactNativePersistence(storage: ReactNativeAuthStorage): Persistence;
}
