import { type ReactNode } from 'react';
import { Pressable, View, type PressableProps } from 'react-native';
import Animated from 'react-native-reanimated';

import { useTheme } from '@/core/theme';
import { usePressScale } from '@/shared/hooks';

import { Text } from './Text';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type ListItemProps = {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: PressableProps['onPress'];
};

/** Shared row layout for settings, athletes, events, and search results. */
export function ListItem({ title, subtitle, leading, trailing, onPress }: ListItemProps) {
  const theme = useTheme();
  const press = usePressScale(0.99);

  const content = (
    <>
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body">{title}</Text>
        {subtitle ? (
          <Text variant="bodySmall" color="textMuted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </>
  );

  const rowStyle = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.spacing.md,
    minHeight: 56,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.base,
    backgroundColor: theme.colors.surface,
  };

  if (onPress) {
    return (
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[press.style, rowStyle]}>
        {content}
      </AnimatedPressable>
    );
  }

  return <View style={rowStyle}>{content}</View>;
}
