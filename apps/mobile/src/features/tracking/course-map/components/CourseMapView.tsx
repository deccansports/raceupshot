import { View, useWindowDimensions } from 'react-native';

import { useTheme } from '@/core/theme';
import { formatCutoffSummary } from '@/core/utils';
import { Card, Icon, Text } from '@/shared/components';

import type { CourseMapViewModel } from '../mappers';
import { CourseTrackCanvas, type TrackAthlete } from './CourseTrackCanvas';

export type MapLayerPreferences = {
  showRoute: boolean;
  showSplitPoints: boolean;
  showDistanceLabels: boolean;
  showAthleteLabels: boolean;
  showAidStations: boolean;
};

export type CourseMapViewProps = {
  map?: CourseMapViewModel;
  athletes?: TrackAthlete[];
  cutoffMinutes?: number | null;
  cutoffs?: Record<string, unknown> | unknown[] | null;
  compact?: boolean;
  fullBleed?: boolean;
  loading?: boolean;
  refreshError?: boolean;
  mapProvider?: 'default' | 'google';
  controlsOffsetTop?: number;
  controlsOffsetRight?: number;
  mapPreferences?: MapLayerPreferences;
  showMapControls?: boolean;
  mapType?: 'standard' | 'satellite' | 'hybrid' | 'terrain';
  onMapTypeChange?: (mapType: 'standard' | 'satellite' | 'hybrid' | 'terrain') => void;
  mapDimension?: '2d' | '3d';
  onMapDimensionChange?: (dimension: '2d' | '3d') => void;
  /** Native map follows the selected athlete until the user pans or zooms. */
  followSelectedAthlete?: boolean;
  onAthletePress?: (athlete: TrackAthlete, index: number) => void;
  onRetry?: () => void;
};

const LEG_ICON_SEQUENCE: ('clock' | 'location' | 'map')[] = ['location', 'map', 'clock'];

function legIcon(segment: string, index: number): 'clock' | 'location' | 'map' {
  const normalized = String(segment ?? '')
    .trim()
    .toLowerCase();
  if (normalized.includes('swim')) return 'location';
  if (normalized.includes('bike') || normalized.includes('cycle')) return 'map';
  if (normalized.includes('run')) return 'clock';
  return LEG_ICON_SEQUENCE[index % LEG_ICON_SEQUENCE.length];
}

/**
 * Course view (default / web). Renders the GPX route + timing/aid/camera markers
 * on a cross-platform SVG canvas when geometry is available, and falls back to a
 * legs + timing-points list otherwise. Native uses CourseMapView.native.tsx
 * (react-native-maps).
 */
export function CourseMapView({
  map,
  athletes = [],
  cutoffMinutes,
  cutoffs,
  compact = false,
  fullBleed = false,
  loading = false,
  refreshError = false,
  controlsOffsetTop,
  controlsOffsetRight,
  mapPreferences,
  showMapControls,
  mapType,
  onMapTypeChange,
  mapDimension,
  onMapDimensionChange,
  onAthletePress,
  onRetry,
}: CourseMapViewProps) {
  const theme = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const cutoffSummary = formatCutoffSummary(cutoffMinutes, cutoffs);

  if (loading) {
    return (
      <Card>
        <Text variant="body" color="textMuted">
          Loading course map…
        </Text>
      </Card>
    );
  }

  if (!map) {
    return (
      <Card style={{ gap: theme.spacing.sm }}>
        <Text variant="body" color="textMuted">
          {refreshError
            ? 'Course map could not be loaded.'
            : 'No course map is configured for this contest.'}
        </Text>
        {refreshError && onRetry ? (
          <Text
            variant="bodySmall"
            color="accent"
            accessibilityRole="button"
            onPress={onRetry}
          >
            Retry course map
          </Text>
        ) : null}
      </Card>
    );
  }

  if (fullBleed) {
    return (
      <View style={{ flex: 1, width: '100%', minHeight: windowHeight }}>
        {map.hasGeometry && map.bounds ? (
          <CourseTrackCanvas
            legs={map.legs}
            markers={map.markers}
            bounds={map.bounds}
            athletes={athletes}
            height={windowHeight}
            controlsDock="top"
            controlsOffsetTop={controlsOffsetTop}
            controlsOffsetRight={controlsOffsetRight}
            mapPreferences={mapPreferences}
            showMapControls={showMapControls}
            mapType={mapType}
            onMapTypeChange={onMapTypeChange}
            mapDimension={mapDimension}
            onMapDimensionChange={onMapDimensionChange}
          />
        ) : (
          <Card style={{ flex: 1, justifyContent: 'center' }}>
            <Text variant="body" color="textMuted">
              {refreshError
                ? 'Course map could not be loaded.'
                : 'No usable GPX route is configured for this contest.'}
            </Text>
            {refreshError && onRetry ? (
              <Text
                variant="bodySmall"
                color="accent"
                accessibilityRole="button"
                onPress={onRetry}
              >
                Retry course map
              </Text>
            ) : null}
          </Card>
        )}
        {refreshError ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: (controlsOffsetTop ?? 12) + 48,
              left: 12,
              right: 12,
              alignItems: 'center',
            }}
          >
            <View
              style={{
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: theme.radius.full,
                backgroundColor: theme.colors.surfaceElevated,
                borderWidth: 1,
                borderColor: theme.colors.warning,
              }}
            >
              <Text variant="caption" color="textSecondary">
                Map refresh failed. Showing the last saved course.
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ gap: theme.spacing.md }}>
      <Card style={{ gap: theme.spacing.sm, paddingBottom: compact ? theme.spacing.sm : undefined }}>
        <Text variant="headline">{map.name}</Text>

        {refreshError ? (
          <Text variant="caption" color="warning">
            Map refresh failed. Showing the last saved course.
          </Text>
        ) : null}

        {map.hasGeometry && map.bounds ? (
          <CourseTrackCanvas
            legs={map.legs}
            markers={map.markers}
            bounds={map.bounds}
            athletes={athletes}
            mapPreferences={mapPreferences}
            showMapControls={showMapControls}
            mapType={mapType}
            onMapTypeChange={onMapTypeChange}
            mapDimension={mapDimension}
            onMapDimensionChange={onMapDimensionChange}
          />
        ) : null}

        {compact ? null : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
            {map.legs.map((leg, index) => (
              <View
                key={leg.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: theme.radius.full,
                  backgroundColor: theme.colors.surfaceSunken,
                }}>
                <Icon name={legIcon(leg.segment, index)} size={14} color="accent" />
                <Text variant="label" color="textSecondary">
                  {leg.label}
                  {leg.distanceLabel ? ` · ${leg.distanceLabel}` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      {compact || cutoffSummary.length === 0 ? null : (
        <Card style={{ gap: theme.spacing.xs, backgroundColor: theme.colors.surfaceElevated }}>
          <Text variant="headline">Cutoff</Text>
          <View style={{ gap: 6 }}>
            {cutoffSummary.map((line) => (
              <Text key={line} variant="bodySmall" color="textSecondary">
                {line}
              </Text>
            ))}
          </View>
        </Card>
      )}
    </View>
  );
}
