import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppProviders } from '@/core/providers/AppProviders';
import { useAppStore } from '@/core/store';
import { OfflineBanner } from '@/shared/components';

import { useConnectivity } from './useConnectivity';
import { useNotificationDeepLinks } from './useNotificationDeepLinks';

/** Global, non-disruptive offline indicator overlaid at the top of every screen. */
function ConnectivityBanner() {
  const offline = useAppStore((s) => s.isOffline);
  const insets = useSafeAreaInsets();
  if (!offline) return null;
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        paddingTop: insets.top,
        zIndex: 1000,
        pointerEvents: 'none',
      }}>
      <OfflineBanner visible message="You are offline — showing the latest data" />
    </View>
  );
}

/**
 * Root navigator: renders the route stack. Firebase session restore is handled
 * by AuthProvider (onAuthStateChanged) in AppProviders.
 */
function RootNavigator() {
  useNotificationDeepLinks();
  useConnectivity();
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      <ConnectivityBanner />
    </View>
  );
}

/**
 * Application root layout. Composes gesture handling, app providers, status
 * bar, and the root navigator. Consumed by the Expo Router root `_layout`.
 */
export function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppProviders>
        <StatusBar style="auto" />
        <RootNavigator />
      </AppProviders>
    </GestureHandlerRootView>
  );
}
