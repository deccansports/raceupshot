import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '@/core/theme/ThemeProvider';

type FullScreenMessageProps = {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

/**
 * Minimal themed full-screen message used by the error boundary and other
 * foundation states. Product feedback components arrive in Milestone 2.
 */
export function FullScreenMessage({
  title,
  description,
  actionLabel,
  onAction,
}: FullScreenMessageProps) {
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text style={[theme.typography.headline, { color: theme.colors.textPrimary }]}>{title}</Text>
      {description ? (
        <Text
          style={[
            theme.typography.body,
            { color: theme.colors.textSecondary, textAlign: 'center', marginTop: theme.spacing.sm },
          ]}>
          {description}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={onAction}
          style={[
            styles.action,
            {
              backgroundColor: theme.colors.accent,
              borderRadius: theme.radius.medium,
              marginTop: theme.spacing.xl,
            },
          ]}>
          <Text style={[theme.typography.label, { color: theme.colors.onAccent }]}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  action: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
});
