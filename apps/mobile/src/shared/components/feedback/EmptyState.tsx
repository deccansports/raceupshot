import { type ReactNode } from 'react';
import { View, type TextStyle } from 'react-native';

import { useTheme } from '@/core/theme';

import { Button } from '../ui/Button';
import { Text } from '../ui/Text';

export type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  actionLoading?: boolean;
  titleStyle?: TextStyle;
  descriptionStyle?: TextStyle;
};

/** Friendly no-data state with an optional call to action. */
export function EmptyState({ title, description, icon, actionLabel, onAction, actionLoading = false, titleStyle, descriptionStyle }: EmptyStateProps) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="summary"
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.spacing.xl,
        gap: theme.spacing.sm,
      }}>
      {icon}
      <Text variant="headline" center style={titleStyle}>
        {title}
      </Text>
      {description ? (
        <Text variant="body" color="textSecondary" center style={descriptionStyle}>
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: theme.spacing.sm }}>
          <Button label={actionLoading ? 'Refreshing...' : actionLabel} onPress={onAction} variant="secondary" loading={actionLoading} />
        </View>
      ) : null}
    </View>
  );
}
