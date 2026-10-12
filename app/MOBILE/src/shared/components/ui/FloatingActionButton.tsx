import { Pressable, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { useTheme } from '@/core/theme';
import { usePressScale } from '@/shared/hooks';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type FloatingActionButtonProps = {
  label?: string;
  icon?: IconName;
  onPress?: () => void;
  accessibilityLabel: string;
};

/**
 * Floating action button. Extended (with label) or circular (icon-only).
 * A signature BERGMAN element for primary screen actions.
 */
export function FloatingActionButton({
  label,
  icon = 'arrowRight',
  onPress,
  accessibilityLabel,
}: FloatingActionButtonProps) {
  const theme = useTheme();
  const press = usePressScale();
  const extended = Boolean(label);

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[
        press.style,
        styles.fab,
        theme.shadows.floating,
        {
          backgroundColor: theme.colors.accent,
          borderRadius: theme.radius.full,
          paddingHorizontal: extended ? 20 : 0,
          width: extended ? undefined : 56,
        },
      ]}>
      {label ? (
        <Text variant="label" style={{ color: theme.colors.onAccent }}>
          {label}
        </Text>
      ) : null}
      <Icon name={icon} color="onAccent" size={22} />
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    height: 56,
    minWidth: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
