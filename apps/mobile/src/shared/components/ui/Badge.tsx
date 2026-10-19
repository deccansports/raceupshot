import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme, type SemanticColors } from '@/core/theme';

import { Text } from './Text';

export type BadgeVariant =
  'live' | 'upcoming' | 'finished' | 'success' | 'warning' | 'danger' | 'neutral';

export type BadgeProps = {
  label: string;
  variant?: BadgeVariant;
};

/** Compact status pill. The `live` variant shows a pulsing dot (reduce-motion aware). */
export function Badge({ label, variant = 'neutral' }: BadgeProps) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (variant === 'live' && !reduced) {
      pulse.value = withRepeat(withTiming(0.3, { duration: 700 }), -1, true);
    } else {
      pulse.value = 1;
    }
  }, [variant, reduced, pulse]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const colorByVariant: Record<BadgeVariant, keyof SemanticColors> = {
    live: 'live',
    upcoming: 'accentSecondary',
    finished: 'textMuted',
    success: 'success',
    warning: 'warning',
    danger: 'danger',
    neutral: 'textSecondary',
  };
  const color = theme.colors[colorByVariant[variant]];

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`${label} status`}
      style={[
        styles.container,
        { backgroundColor: `${color}22`, borderRadius: theme.radius.full },
      ]}>
      {variant === 'live' ? (
        <Animated.View style={[styles.dot, { backgroundColor: color }, dotStyle]} />
      ) : null}
      <Text variant="label" style={{ color }}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
