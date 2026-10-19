import { createElement } from 'react';

import { useTheme } from '@/core/theme';

import type { GuidebookPdfViewerProps } from './GuidebookPdfViewer';

export function GuidebookPdfViewer({ uri, viewerKey }: GuidebookPdfViewerProps) {
  const theme = useTheme();

  return createElement('iframe', {
    key: viewerKey,
    src: uri ?? '',
    title: 'Athlete Guidebook PDF',
    style: {
      border: '0',
      flex: 1,
      width: '100%',
      minHeight: 520,
      backgroundColor: theme.colors.surface,
    },
  });
}
