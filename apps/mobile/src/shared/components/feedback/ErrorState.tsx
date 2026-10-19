import { View } from 'react-native';

import { useTheme } from '@/core/theme';

import { Button } from '../ui/Button';
import { Text } from '../ui/Text';

export type ErrorStateProps = {
  title?: string;
  description?: string;
  onRetry?: () => void;
};

/** Normalized error display with an optional retry action. */
export function ErrorState({
  title = 'Something went wrong',
  description = 'Please try again.',
  onRetry,
}: ErrorStateProps) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="alert"
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        padding: theme.spacing.xl,
        gap: theme.spacing.sm,
      }}>
      <Text variant="headline" color="danger" center>
        {title}
      </Text>
      <Text variant="body" color="textSecondary" center>
        {description}
      </Text>
      {onRetry ? (
        <View style={{ marginTop: theme.spacing.sm }}>
          <Button label="Try again" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}
