import { Platform } from 'react-native';

export const isIOS = Platform.OS === 'ios';
export const isAndroid = Platform.OS === 'android';
export const isWeb = Platform.OS === 'web';

/** Selects a value based on the current platform. */
export function selectByPlatform<T>(options: { ios: T; android: T; default: T }): T {
  if (isIOS) return options.ios;
  if (isAndroid) return options.android;
  return options.default;
}
