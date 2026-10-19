import { View } from 'react-native';

import { useTheme } from '@/core/theme';
import { Text } from '@/shared/components';
import type { NextSplitView, PredictedCheckpointView, ProjectedFinishView } from '@/features/tracking/mappers';
import { resolvePredictionTimeLabels } from '@/features/tracking/timing/predictionPresentation';
import { useSharedLiveNow } from '@/features/tracking/timing/sharedLiveClock';
import type { TimelineSplit } from '@/features/tracking/mappers';

import { SectionCard, TileGrid } from './primitives';

/**
 * Prediction card: the "Next Split Prediction (Robust)" checkpoint ETA and,
 * when available, the projected finish/rank. Renders formatted view-model data.
 */
export function PredictionCard({
  nextSplit,
  projected,
  checkpoints = [],
  timeline = [],
  raceStartedAt,
  clockRunning = false,
  noFinishTime = false,
}: {
  nextSplit?: NextSplitView;
  projected?: ProjectedFinishView;
  checkpoints?: PredictedCheckpointView[];
  timeline?: TimelineSplit[];
  raceStartedAt?: number;
  clockRunning?: boolean;
  noFinishTime?: boolean;
}) {
  const theme = useTheme();
  const nowMs = useSharedLiveNow(clockRunning && raceStartedAt != null);
  if (!nextSplit && !projected && checkpoints.length === 0 && !noFinishTime) return null;
  const parseDuration = (value?: string) => {
    const parts = String(value ?? '').trim().split(':').map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  };
  const formatDuration = (seconds: number) => {
    const safe = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const remainder = safe % 60;
    return [hours, minutes, remainder].map((part) => String(part).padStart(2, '0')).join(':');
  };
  const raceElapsedSeconds =
    raceStartedAt != null && Number.isFinite(raceStartedAt) && nowMs >= raceStartedAt
      ? Math.max(0, Math.floor((nowMs - raceStartedAt) / 1_000))
      : null;
  const lastConfirmed = [...timeline]
    .reverse()
    .find((row) => row.state === 'completed' && !/^start$/i.test(row.splitLabel || row.name));
  const nextSplitTimes = resolvePredictionTimeLabels({
    etaClock: nextSplit?.etaClock,
    etaElapsed: nextSplit?.etaElapsed,
  });

  const nextItems = nextSplit
    ? [
        { key: 'checkpoint', label: 'Next Checkpoint', value: nextSplit.checkpoint },
        nextSplitTimes.etaClock
          ? { key: 'etaClock', label: 'Expected at', value: nextSplitTimes.etaClock }
          : null,
        nextSplitTimes.etaElapsed
          ? { key: 'etaElapsed', label: 'Projected Race Time', value: nextSplitTimes.etaElapsed }
          : null,
        nextSplit.etaRemaining
          ? { key: 'etaRemaining', label: 'Estimated remaining', value: nextSplit.etaRemaining }
          : null,
        nextSplit.remaining
          ? { key: 'remaining', label: 'Remaining', value: nextSplit.remaining }
          : null,
      ].filter((v): v is { key: string; label: string; value: string } => v !== null)
    : [];

  const projectedItems = projected
    ? [
        projected.finishTimeLabel
          ? { key: 'finish', label: 'Projected Finish', value: projected.finishTimeLabel }
          : null,
        projected.position
          ? { key: 'position', label: 'Projected Rank', value: projected.position }
          : null,
        projected.paceLabel
          ? { key: 'pace', label: 'Projected Pace', value: projected.paceLabel }
          : null,
        projected.confidenceLabel
          ? { key: 'confidence', label: 'Confidence', value: projected.confidenceLabel }
          : null,
      ].filter((v): v is { key: string; label: string; value: string } => v !== null)
    : [];

  return (
    <SectionCard title="Prediction" titleColor="statusUpcoming">
      {noFinishTime ? (
        <View style={{ gap: 4 }}>
          <Text variant="headline" color="accent" style={{ fontWeight: '900' }}>
            NO FINISH TIME
          </Text>
          <Text variant="bodySmall" color="textMuted">
            The configured cutoff expired before the required timing mat was crossed.
          </Text>
        </View>
      ) : null}

      {lastConfirmed ? (
        <View style={{ gap: 4 }}>
          <Text variant="caption" color="textMuted">LAST CONFIRMED</Text>
          <Text variant="bodySmall" style={{ fontWeight: '900' }}>
            {lastConfirmed.splitLabel || lastConfirmed.name} · {lastConfirmed.elapsedTimeLabel || lastConfirmed.timeLabel}
          </Text>
          {lastConfirmed.timeOfDayLabel ? (
            <Text variant="caption" color="textMuted">Actual crossing {lastConfirmed.timeOfDayLabel}</Text>
          ) : null}
        </View>
      ) : null}

      {nextItems.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" color="textMuted">
            NEXT SPLIT
          </Text>
          <TileGrid items={nextItems} />
          {nextSplit?.pace ? (
            <Text variant="caption" color="textMuted">
              {`Model pace ${nextSplit.pace}`}
            </Text>
          ) : null}
        </View>
      ) : null}

      {projectedItems.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" color="textMuted">
            PROJECTED FINISH
          </Text>
          <TileGrid items={projectedItems} />
        </View>
      ) : null}

      {checkpoints.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="caption" color="textMuted">
            ESTIMATED TIMES (PREDICTED)
          </Text>
          {checkpoints.map((checkpoint) => {
            const etaElapsedSeconds = parseDuration(checkpoint.etaElapsed);
            const deltaSeconds =
              raceElapsedSeconds != null && etaElapsedSeconds != null
                ? etaElapsedSeconds - raceElapsedSeconds
                : null;
            const overdue = deltaSeconds != null && deltaSeconds <= 0;
            return (
            <View
              key={`${checkpoint.checkpoint}-${checkpoint.etaElapsed}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingVertical: 9,
                borderTopWidth: 1,
                borderTopColor: theme.colors.border,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text variant="bodySmall" style={{ fontWeight: '800' }}>
                  {checkpoint.checkpoint}
                </Text>
                <Text variant="caption" color="textMuted">
                  {checkpoint.remaining} from last official point
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="bodySmall" color="statusUpcoming" style={{ fontWeight: '900' }}>
                  {overdue
                    ? `Waiting ${formatDuration(Math.abs(deltaSeconds))}`
                    : deltaSeconds != null
                      ? `ETA in ${formatDuration(deltaSeconds)}`
                      : checkpoint.etaElapsed}
                </Text>
                <Text variant="caption" color="textMuted">
                  {overdue ? `Overdue since ${checkpoint.etaClock}` : checkpoint.etaClock}
                </Text>
              </View>
            </View>
            );
          })}
          <Text variant="caption" color="textMuted">
            Estimated between official timing points. It updates after every official read.
          </Text>
        </View>
      ) : null}
    </SectionCard>
  );
}
