import { Pressable, View } from 'react-native';

import { useTheme } from '@/core/theme';

import { Icon } from './Icon';
import { Text } from './Text';

export type SectionHeaderProps = {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** Section title with an optional trailing action (e.g. "See all"). */
export function SectionHeader({ title, actionLabel, onAction }: SectionHeaderProps) {
  const theme = useTheme();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: theme.spacing.sm,
      }}>
      <Text variant="headline">{title}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text variant="label" color="accent">
            {actionLabel}
          </Text>
          <Icon name="chevronRight" size={16} color="accent" />
        </Pressable>
      ) : null}
    </View>
  );
}
