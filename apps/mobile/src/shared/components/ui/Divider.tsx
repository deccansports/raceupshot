import { View } from 'react-native';

import { useTheme } from '@/core/theme';

export type DividerProps = {
  orientation?: 'horizontal' | 'vertical';
  inset?: number;
};

/** Thin separator line using the theme border color. */
export function Divider({ orientation = 'horizontal', inset = 0 }: DividerProps) {
  const theme = useTheme();
  const isHorizontal = orientation === 'horizontal';

  return (
    <View
      accessibilityRole="none"
      style={
        isHorizontal
          ? { height: 1, backgroundColor: theme.colors.border, marginHorizontal: inset }
          : {
              width: 1,
              alignSelf: 'stretch',
              backgroundColor: theme.colors.border,
              marginVertical: inset,
            }
      }
    />
  );
}
