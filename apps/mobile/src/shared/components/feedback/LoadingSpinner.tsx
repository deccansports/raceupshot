import { ActivityIndicator, View } from 'react-native';

import { useTheme } from '@/core/theme';

export type LoadingSpinnerProps = {
  size?: 'small' | 'large';
  label?: string;
  fullscreen?: boolean;
};

/** Themed loading indicator. */
export function LoadingSpinner({
  size = 'large',
  label = 'Loading',
  fullscreen,
}: LoadingSpinnerProps) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={
        fullscreen
          ? { flex: 1, alignItems: 'center', justifyContent: 'center' }
          : { alignItems: 'center', justifyContent: 'center', padding: theme.spacing.base }
      }>
      <ActivityIndicator size={size} color={theme.colors.accent} />
    </View>
  );
}
