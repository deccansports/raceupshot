import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { motion } from '@/core/theme';

/**
 * Provides a subtle press-scale animation for interactive elements.
 * Respects the OS reduce-motion setting (no scaling when enabled).
 */
export function usePressScale(scale: number = motion.pressScale) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: reduced ? 1 : 1 - pressed.value * (1 - scale) }],
  }));

  const onPressIn = () => {
    pressed.value = withTiming(1, { duration: motion.duration.fast });
  };

  const onPressOut = () => {
    pressed.value = withTiming(0, { duration: motion.duration.fast });
  };

  return { style, onPressIn, onPressOut };
}
