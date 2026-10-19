import { Pressable, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { useTheme } from '@/core/theme';
import { usePressScale } from '@/shared/hooks';

import { Text } from './Text';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
};

/** Selectable filter chip / tag. */
export function Chip({ label, selected = false, onPress }: ChipProps) {
  const theme = useTheme();
  const press = usePressScale();

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[
        press.style,
        styles.chip,
        {
          borderRadius: theme.radius.full,
          borderWidth: 1,
          borderColor: selected ? theme.colors.accent : theme.colors.border,
          backgroundColor: selected ? `${theme.colors.accent}1F` : theme.colors.surface,
        },
      ]}>
      <Text
        variant="label"
        style={{ color: selected ? theme.colors.accent : theme.colors.textSecondary }}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
});
