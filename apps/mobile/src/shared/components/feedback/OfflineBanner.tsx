import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';

import { useAppStore } from '@/core/store';
import { useTheme } from '@/core/theme';

import { Text } from '../ui/Text';

export type OfflineBannerProps = {
  /** Override the connectivity state; defaults to the app store's offline flag. */
  visible?: boolean;
  message?: string;
};

/** Explicit but non-disruptive offline indicator. */
export function OfflineBanner({ visible, message = 'You are offline' }: OfflineBannerProps) {
  const theme = useTheme();
  const storeOffline = useAppStore((s) => s.isOffline);
  const isVisible = visible ?? storeOffline;

  if (!isVisible) return null;

  return (
    <Animated.View
      entering={FadeInUp.duration(theme.motion.duration.base)}
      exiting={FadeOutUp.duration(theme.motion.duration.fast)}
      accessibilityRole="alert"
      accessibilityLabel={message}
      style={{
        backgroundColor: theme.colors.warning,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.base,
        alignItems: 'center',
      }}>
      <Text variant="label" style={{ color: theme.colors.onAccent }}>
        {message}
      </Text>
    </Animated.View>
  );
}
