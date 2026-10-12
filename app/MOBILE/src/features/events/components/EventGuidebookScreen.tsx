import { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Share, View } from 'react-native';
import {
  documentDirectory,
  downloadAsync,
  getInfoAsync,
  makeDirectoryAsync,
} from 'expo-file-system/legacy';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/core/theme';
import { Button, Card, EmptyState, Icon, Skeleton, Text } from '@/shared/components';

import { useEvent } from '../hooks/useEvents';
import { GuidebookPdfViewer } from './GuidebookPdfViewer';
import { resolveValidGuidebook } from '../utils/guidebook';
import { safeRouteEventId } from '../utils/eventRoute';

function cacheDirectory(eventId: string): string {
  return `${documentDirectory ?? ''}guidebooks/${encodeURIComponent(eventId)}`;
}

function hashUrl(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function cacheFile(eventId: string, url: string): string {
  return `${cacheDirectory(eventId)}/athlete-guidebook-${hashUrl(url)}.pdf`;
}

export function EventGuidebookScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { eventId, url, title } = useLocalSearchParams<{ eventId: string | string[]; url?: string | string[]; title?: string | string[] }>();
  const id = safeRouteEventId(eventId) ?? '';
  const urlParam = Array.isArray(url) ? url[0] : url;
  const titleParam = Array.isArray(title) ? title[0] : title;
  const { event, isLoading, refetch } = useEvent(id);
  const guidebook = useMemo(
    () => resolveValidGuidebook(urlParam ? { athleteGuidebookUrl: urlParam } : event),
    [event, urlParam],
  );
  const displayTitle = titleParam || `${event?.name ?? 'Event'} Athlete Guidebook`;
  const [failed, setFailed] = useState(false);
  const [viewerKey, setViewerKey] = useState(0);
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'web' || !guidebook?.nativePdfUrl || !id || !documentDirectory) return;

    let cancelled = false;

    async function loadPdf() {
      try {
        await Promise.resolve();
        if (cancelled) return;
        setFailed(false);
        setPdfUri(null);
        setLoadingPdf(true);
        setLoadProgress(0);
        setPage(1);
        setPageCount(0);

        const sourceUrl = guidebook?.nativePdfUrl;
        if (!sourceUrl) return;
        const dir = cacheDirectory(id);
        const dirInfo = await getInfoAsync(dir);
        if (!dirInfo.exists) {
          await makeDirectoryAsync(dir, { intermediates: true });
        }

        const file = cacheFile(id, sourceUrl);
        const existing = await getInfoAsync(file);
        const result = existing.exists ? { uri: file } : await downloadAsync(sourceUrl, file);
        if (!cancelled) {
          setPdfUri(result.uri);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
          setLoadingPdf(false);
        }
      }
    }

    void loadPdf();

    return () => {
      cancelled = true;
    };
  }, [guidebook?.nativePdfUrl, id, viewerKey]);

  const openExternal = async () => {
    if (!guidebook?.originalUrl) return;
    await Linking.openURL(guidebook.originalUrl);
  };

  const shareGuidebook = async () => {
    if (!guidebook?.originalUrl) return;
    await Share.share({
      title: displayTitle,
      message: `${displayTitle}\n${guidebook.originalUrl}`,
      url: guidebook.originalUrl,
    });
  };

  const retry = () => {
    setFailed(false);
    setViewerKey((current) => current + 1);
    void refetch();
  };

  const viewer = guidebook && !failed ? (
    <GuidebookPdfViewer
      uri={Platform.OS === 'web' ? guidebook.viewerUrl : pdfUri}
      page={page}
      viewerKey={viewerKey}
      loadProgress={loadProgress}
      onLoadProgress={(progress) => setLoadProgress(progress)}
      onLoadComplete={(pages) => {
        setPageCount(pages);
        setLoadingPdf(false);
        setFailed(false);
      }}
      onPageChanged={(currentPage, pages) => {
        setPage(currentPage);
        setPageCount(pages);
      }}
      onError={() => {
        setLoadingPdf(false);
        setFailed(true);
      }}
    />
  ) : null;

  if (isLoading && !event && !urlParam) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top', 'left', 'right']}>
        <View style={{ flex: 1, padding: theme.spacing.base, gap: theme.spacing.md }}>
          <Skeleton height={72} radius={theme.radius.large} />
          <Skeleton height={520} radius={theme.radius.large} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top', 'left', 'right']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          paddingHorizontal: theme.spacing.base,
          paddingVertical: theme.spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
        }}>
        <Button label="Back" variant="ghost" size="sm" onPress={() => router.replace(id ? `/event/${id}` : '/events')} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="headline" numberOfLines={1}>
            Athlete Guidebook
          </Text>
          <Text variant="bodySmall" color="textMuted" numberOfLines={1}>
            {displayTitle}
          </Text>
        </View>
        <Icon name="bookOpen" color="accent" size={24} />
      </View>

      <View style={{ flex: 1, padding: theme.spacing.base, paddingBottom: Math.max(theme.spacing.base, insets.bottom) }}>
        {!guidebook ? (
          <Card style={{ flex: 1, justifyContent: 'center' }}>
            <EmptyState
              title="Athlete Guidebook is not available for this event yet."
              description="Please check back closer to race day."
              actionLabel="Retry"
              onAction={() => void refetch()}
            />
          </Card>
        ) : failed ? (
          <Card style={{ flex: 1, gap: theme.spacing.md, justifyContent: 'center' }}>
            <EmptyState
              title="Unable to load the Athlete Guidebook."
              description="Please try again or open it in your browser."
              actionLabel="Retry"
              onAction={retry}
            />
            <Button label="Open in Browser" variant="primary" fullWidth onPress={() => void openExternal()} />
          </Card>
        ) : (
          <Card padded={false} style={{ flex: 1, overflow: 'hidden' }}>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: theme.spacing.sm,
                padding: theme.spacing.sm,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
                backgroundColor: theme.colors.surfaceElevated,
              }}>
              <Button label="Share" variant="secondary" size="sm" onPress={() => void shareGuidebook()} />
              <Button label="Open Externally" variant="ghost" size="sm" onPress={() => void openExternal()} />
              {pageCount > 0 ? (
                <View style={{ justifyContent: 'center', paddingHorizontal: theme.spacing.xs }}>
                  <Text variant="caption" color="textMuted">
                    Page {page} / {pageCount}
                  </Text>
                </View>
              ) : loadingPdf ? (
                <View style={{ justifyContent: 'center', paddingHorizontal: theme.spacing.xs }}>
                  <Text variant="caption" color="textMuted">
                    Loading...
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={{ flex: 1 }}>
              {viewer}
            </View>
          </Card>
        )}
      </View>
    </SafeAreaView>
  );
}

export default EventGuidebookScreen;
