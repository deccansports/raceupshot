import { useEffect } from 'react';
import { type DimensionValue } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/core/theme';

export type SkeletonProps = {
  width?: DimensionValue;
  height?: number;
  radius?: number;
};

/** Shimmering placeholder for perceived speed (static when reduce-motion is on). */
export function Skeleton({ width = '100%', height = 16, radius }: SkeletonProps) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    if (!reduced) {
      opacity.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
    } else {
      opacity.value = 0.7;
    }
  }, [reduced, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height,
          borderRadius: radius ?? theme.radius.small,
          backgroundColor: theme.colors.border,
        },
        style,
      ]}
    />
  );
}
