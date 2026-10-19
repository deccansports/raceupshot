import { Platform, Pressable, View, type PressableProps, type ViewProps } from 'react-native';
import Animated from 'react-native-reanimated';

import { useTheme } from '@/core/theme';
import { usePressScale } from '@/shared/hooks';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type CardProps = ViewProps & {
  elevated?: boolean;
  padded?: boolean;
  onPress?: PressableProps['onPress'];
};

/** Standard rounded content container with soft elevation. */
export function Card({
  elevated = true,
  padded = true,
  onPress,
  style,
  children,
  ...rest
}: CardProps) {
  const theme = useTheme();
  const press = usePressScale(0.985);

  const base = [
    {
      backgroundColor: elevated ? theme.colors.surfaceElevated : theme.colors.surface,
      borderRadius: theme.radius.large,
      borderColor: theme.colors.border,
      borderWidth: 1,
      padding: padded ? theme.spacing.base : 0,
    },
    elevated && theme.shadows.card,
    style,
  ];

  if (onPress) {
    return (
      <AnimatedPressable
        accessibilityRole={Platform.OS === 'web' ? undefined : 'button'}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[press.style, base]}
        {...rest}>
        {children}
      </AnimatedPressable>
    );
  }

  return (
    <View style={base} {...rest}>
      {children}
    </View>
  );
}
