import { type ReactNode } from 'react';
import { ScrollView, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '@/core/theme';
import { useResponsive } from '@/shared/hooks';

export type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  /** Center content within a max width on tablets/large screens. */
  centered?: boolean;
  edges?: Edge[];
  contentStyle?: ViewStyle;
};

/**
 * Screen wrapper: safe areas, themed background, optional scrolling, and
 * tablet-aware max-width centering for reading surfaces.
 */
export function Screen({
  children,
  scroll = false,
  padded = true,
  centered = true,
  edges = ['top', 'left', 'right'],
  contentStyle,
}: ScreenProps) {
  const theme = useTheme();
  const { isTablet } = useResponsive();

  const inner: ViewStyle = {
    flexGrow: 1,
    width: '100%',
    padding: padded ? theme.spacing.base : 0,
    maxWidth: centered && isTablet ? theme.maxContentWidth : undefined,
    alignSelf: 'center',
    ...contentStyle,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={inner}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={inner}>{children}</View>
      )}
    </SafeAreaView>
  );
}
