import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/core/theme';

export type ProgressBarProps = {
  /** Progress from 0 to 1. */
  progress: number;
  height?: number;
  accessibilityLabel?: string;
};

/** Determinate progress bar with animated fill (reduce-motion aware). */
export function ProgressBar({ progress, height = 8, accessibilityLabel }: ProgressBarProps) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(1, progress));
  const value = useSharedValue(clamped);

  useEffect(() => {
    value.value = reduced ? clamped : withTiming(clamped, { duration: theme.motion.duration.base });
  }, [clamped, reduced, value, theme.motion.duration.base]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${value.value * 100}%` }));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? 'Progress'}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={{
        height,
        borderRadius: height / 2,
        backgroundColor: theme.colors.border,
        overflow: 'hidden',
      }}>
      <Animated.View
        style={[
          { height, borderRadius: height / 2, backgroundColor: theme.colors.accent },
          fillStyle,
        ]}
      />
    </View>
  );
}
