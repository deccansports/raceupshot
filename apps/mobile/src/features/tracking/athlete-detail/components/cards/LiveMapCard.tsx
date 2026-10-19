import { useMemo, useState } from 'react';
import { Pressable, type LayoutChangeEvent, View } from 'react-native';

import { useTheme, type SemanticColors } from '@/core/theme';
import { formatDistanceKm } from '@/core/utils';
import { ReplayControls, Text, type ReplaySpeed } from '@/shared/components';
import {
  buildCumulativePath,
  distanceAtRaceTime,
  distanceToFraction,
  estimatedDistanceKm,
  positionAtFraction,
  replayDurationSec,
  useRaceClock,
} from '@/features/tracking/engine';
import type { AthleteTrack } from '@/features/tracking/mappers';
import { CourseMapView } from '@/features/tracking/course-map/components/CourseMapView';
import type { TrackAthlete } from '@/features/tracking/course-map/components/CourseTrackCanvas';
import type { CourseMapViewModel } from '@/features/tracking/course-map/mappers';
import type { CourseGeometry, LatLng } from '@/core/types';
import {
  CombinedElevationProfile,
  type ElevationAthleteMarker,
} from '@/features/tracking/course-map/components/ElevationProfilePanel';

import { SectionCard } from './primitives';

const LEGEND_COLORS: (keyof SemanticColors)[] = [
  'accentSecondary',
  'success',
  'warning',
  'accent',
  'statusUpcoming',
  'statusFinished',
];

function normalizedLeg(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function athleteInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'A';
}

function ModeButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: theme.radius.full,
        borderWidth: 1,
        borderColor: active ? theme.colors.accent : theme.colors.border,
        backgroundColor: active ? `${theme.colors.accent}1F` : 'transparent',
      }}>
      <Text variant="label" color={active ? 'accent' : 'textSecondary'}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Live course map: the athlete's position is interpolated every second between
 * official timing reads (live) or swept across recorded splits (replay). All
 * interpolation is done by the engine; this component only renders coordinates.
 */
export function LiveMapCard({
  track,
  map,
  athlete,
  liveLocation,
  liveLocationSource,
  geometry,
  geometryLoading = false,
  geometryError = false,
  focused,
  onLayout,
  refreshError = false,
}: {
  track: AthleteTrack;
  map: CourseMapViewModel;
  /** Identity for the avatar marker (photo/initials + bib). */
  athlete: Omit<TrackAthlete, 'position'>;
  liveLocation?: LatLng | null;
  liveLocationSource?: string;
  geometry?: CourseGeometry | null;
  geometryLoading?: boolean;
  geometryError?: boolean;
  focused: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
  refreshError?: boolean;
}) {
  const theme = useTheme();
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(2);

  const durationSec = useMemo(() => replayDurationSec(track.keyframes), [track.keyframes]);
  const cumPath = useMemo(() => buildCumulativePath(map.mergedPath), [map.mergedPath]);

  const { clockSec, setClockSec } = useRaceClock({ mode, focused, playing, speed, durationSec });

  const distanceKm =
    mode === 'live'
      ? estimatedDistanceKm(track.seed, clockSec)
      : distanceAtRaceTime(track.keyframes, clockSec, track.totalKm);
  const fraction = distanceToFraction(distanceKm, track.totalKm);
  const athletePos = liveLocationSource === 'GPS' && liveLocation
    ? liveLocation
    : positionAtFraction(cumPath, fraction);
  const elevationAthlete = useMemo<ElevationAthleteMarker | null>(() => {
    const sportLegs = map.legs.filter((leg) => {
      const identity = normalizedLeg(leg.segment || leg.label);
      return identity === 'bike' || identity === 'cycling' || identity.startsWith('run');
    });
    if (sportLegs.length === 0) return null;

    // Replay can cross multiple legs, so only pin to canonical currentLeg in
    // live mode. Replay resolves the section from its replay distance below.
    const currentLeg = mode === 'live' ? normalizedLeg(track.currentLeg) : '';
    let selectedIndex = sportLegs.findIndex((leg) => {
      const identity = normalizedLeg(leg.segment || leg.label);
      if (currentLeg === 'bike' || currentLeg === 'cycling') {
        return identity === 'bike' || identity === 'cycling';
      }
      if (currentLeg.startsWith('run')) {
        return identity === currentLeg || (currentLeg === 'run' && identity.startsWith('run'));
      }
      return false;
    });

    // If currentLeg is absent, locate the athlete from the same cumulative
    // distance that drives the map marker. This keeps the two visuals aligned.
    if (selectedIndex < 0) {
      let courseOffsetKm = map.legs
        .filter((leg) => normalizedLeg(leg.segment || leg.label) === 'swim')
        .reduce((sum, leg) => sum + Math.max(0, Number(leg.distanceKm) || 0), 0);
      selectedIndex = sportLegs.findIndex((leg) => {
        const legKm = Math.max(0, Number(leg.distanceKm) || 0);
        const withinLeg = distanceKm >= courseOffsetKm && distanceKm <= courseOffsetKm + legKm;
        courseOffsetKm += legKm;
        return withinLeg;
      });
    }
    if (selectedIndex < 0) return null;

    const selectedLeg = sportLegs[selectedIndex];
    const selectedPosition = map.legs.findIndex((leg) => leg.id === selectedLeg.id);
    const precedingKm = map.legs
      .slice(0, selectedPosition)
      .reduce((sum, leg) => sum + Math.max(0, Number(leg.distanceKm) || 0), 0);
    const legDistanceKm = Math.max(0, Number(selectedLeg.distanceKm) || 0);

    return {
      routeSegment: selectedLeg.segment || selectedLeg.label,
      distanceKm: Math.max(0, Math.min(legDistanceKm, distanceKm - precedingKm)),
      label: athleteInitials(athlete.name),
      color: theme.colors.accent,
    };
  }, [athlete.name, distanceKm, map.legs, mode, theme.colors.accent, track.currentLeg]);

  if (!map.hasGeometry || !map.bounds) return null;

  const legend = map.legs.map((leg, index) => ({
    label: leg.label,
    color: LEGEND_COLORS[index % LEGEND_COLORS.length],
  }));

  const enterReplay = () => {
    setMode('replay');
    setClockSec(0);
    setPlaying(true);
  };
  const enterLive = () => {
    setMode('live');
    setPlaying(false);
    setClockSec(0);
  };

  return (
    <SectionCard title="Live Map" titleColor="accentSecondary">
      {refreshError ? (
        <Text variant="caption" color="warning">
          Map refresh failed. Showing the last saved course.
        </Text>
      ) : null}
      <View onLayout={onLayout}>
        <CourseMapView
          map={map}
          athletes={[{ ...athlete, position: athletePos, selected: true }]}
          compact
          showMapControls
        />
      </View>

      <CombinedElevationProfile
        geometry={geometry}
        loading={geometryLoading}
        error={geometryError}
        athlete={elevationAthlete}
      />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md }}>
        {legend.map((l) => (
          <View key={l.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View
              style={{
                width: 10,
                height: 4,
                borderRadius: 2,
                backgroundColor: theme.colors[l.color],
              }}
            />
            <Text variant="caption" color="textMuted">
              {l.label}
            </Text>
          </View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View
            style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.accent }}
          />
          <Text variant="caption" color="textMuted">
            Athlete
          </Text>
        </View>
      </View>

      <Text variant="caption" color="textMuted">
        {mode === 'live' ? 'Estimated position · interpolated each second' : 'Replay'} ·{' '}
        {formatDistanceKm(distanceKm) ?? '0 km'} of {formatDistanceKm(track.totalKm) ?? '—'}
      </Text>

      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <ModeButton label="LIVE" active={mode === 'live'} onPress={enterLive} />
        <ModeButton label="REPLAY" active={mode === 'replay'} onPress={enterReplay} />
      </View>

      {mode === 'replay' ? (
        <ReplayControls
          playing={playing}
          speed={speed}
          progress={durationSec > 0 ? clockSec / durationSec : 0}
          onTogglePlay={() => setPlaying((p) => !p)}
          onChangeSpeed={setSpeed}
          onScrub={(p) => setClockSec(p * durationSec)}
        />
      ) : null}
    </SectionCard>
  );
}
