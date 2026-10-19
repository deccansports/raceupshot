import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import Animated from 'react-native-reanimated';

import { useTheme } from '@/core/theme';
import { usePressScale } from '@/shared/hooks';

import { Text } from './Text';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = Omit<PressableProps, 'style'> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
};

const HEIGHTS: Record<ButtonSize, number> = { sm: 40, md: 48, lg: 56 };

/** Primary interactive button with variants, states, and press feedback. */
export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const { style: pressStyle, onPressIn, onPressOut } = usePressScale();
  const isDisabled = disabled || loading;

  const palette = {
    primary: { bg: theme.colors.accent, fg: theme.colors.onAccent, border: 'transparent' },
    secondary: {
      bg: theme.colors.accentSecondary,
      fg: theme.colors.onAccent,
      border: 'transparent',
    },
    ghost: { bg: 'transparent', fg: theme.colors.accent, border: theme.colors.border },
    destructive: { bg: theme.colors.danger, fg: theme.colors.onAccent, border: 'transparent' },
  }[variant];

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={label}
      disabled={isDisabled}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={[
        pressStyle,
        styles.base,
        {
          height: HEIGHTS[size],
          backgroundColor: palette.bg,
          borderColor: palette.border,
          borderWidth: variant === 'ghost' ? StyleSheet.hairlineWidth * 2 : 0,
          borderRadius: theme.radius.medium,
          opacity: isDisabled ? 0.5 : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
      ]}
      {...rest}>
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={palette.fg} />
        ) : (
          <Text
            variant="label"
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={{ color: palette.fg, flexShrink: 1, textAlign: 'center' }}>
            {label}
          </Text>
        )}
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: { justifyContent: 'center', paddingHorizontal: 20, minWidth: 64 },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minWidth: 0,
  },
});
