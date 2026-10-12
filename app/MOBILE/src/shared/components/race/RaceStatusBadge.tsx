import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/core/theme';

import { Text } from '../ui/Text';
import { raceStatusMeta, type RaceStatus } from './RaceStatus';

export type RaceStatusBadgeProps = {
  status: RaceStatus;
  /** Render on a dark/image background (uses inverse text). */
  onImage?: boolean;
};

/** Status pill with a colored dot; the LIVE dot pulses (reduce-motion aware). */
export function RaceStatusBadge({ status, onImage = false }: RaceStatusBadgeProps) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);
  const meta = raceStatusMeta[status];
  const color = theme.colors[meta.color];

  useEffect(() => {
    if (status === 'live' && !reduced) {
      pulse.value = withRepeat(withTiming(0.25, { duration: 700 }), -1, true);
    } else {
      pulse.value = 1;
    }
  }, [status, reduced, pulse]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const bg = onImage ? 'rgba(0,0,0,0.45)' : `${color}1F`;
  const textColor = onImage ? theme.colors.textInverse : color;

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`${meta.label} status`}
      style={[styles.container, { backgroundColor: bg, borderRadius: theme.radius.full }]}>
      <Animated.View style={[styles.dot, { backgroundColor: color }, dotStyle]} />
      <Text variant="label" style={{ color: textColor }}>
        {meta.label.toUpperCase()}
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
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
