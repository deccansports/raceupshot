import { ActivityIndicator, View } from 'react-native';

import { useTheme } from '@/core/theme';
import { Text } from '@/shared/components';

export type GuidebookPdfViewerProps = {
  uri: string | null;
  page: number;
  viewerKey: number;
  loadProgress: number;
  onLoadProgress: (progress: number) => void;
  onLoadComplete: (pages: number) => void;
  onPageChanged: (page: number, pages: number) => void;
  onError: () => void;
};

export function GuidebookPdfViewer({ loadProgress }: GuidebookPdfViewerProps) {
  const theme = useTheme();

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.sm }}>
      <ActivityIndicator color={theme.colors.accent} />
      <Text variant="bodySmall" color="textMuted">
        Loading Athlete Guidebook...
      </Text>
      {loadProgress > 0 ? (
        <Text variant="caption" color="textMuted">
          {Math.round(loadProgress * 100)}%
        </Text>
      ) : null}
    </View>
  );
}
