import { ActivityIndicator, View } from 'react-native';
import Pdf from 'react-native-pdf';

import { useTheme } from '@/core/theme';
import { Text } from '@/shared/components';

import type { GuidebookPdfViewerProps } from './GuidebookPdfViewer';

export function GuidebookPdfViewer({
  uri,
  page,
  viewerKey,
  loadProgress,
  onLoadProgress,
  onLoadComplete,
  onPageChanged,
  onError,
}: GuidebookPdfViewerProps) {
  const theme = useTheme();

  const loading = (
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

  if (!uri) return loading;

  return (
    <Pdf
      key={`${viewerKey}-${uri}`}
      source={{ uri }}
      page={page}
      minScale={1}
      maxScale={4}
      spacing={8}
      horizontal={false}
      enableDoubleTapZoom
      showsVerticalScrollIndicator
      trustAllCerts={false}
      renderActivityIndicator={() => loading}
      onLoadProgress={onLoadProgress}
      onLoadComplete={onLoadComplete}
      onPageChanged={onPageChanged}
      onError={onError}
      style={{ flex: 1, backgroundColor: theme.colors.surface }}
    />
  );
}
