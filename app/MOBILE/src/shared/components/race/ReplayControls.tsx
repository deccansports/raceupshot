import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/core/theme';

import { ProgressBar } from '../ui/ProgressBar';
import { Text } from '../ui/Text';

export type ReplaySpeed = 1 | 2 | 5 | 10;

export type ReplayControlsProps = {
  playing: boolean;
  speed: ReplaySpeed;
  /** 0..1 scrub position. */
  progress: number;
  onTogglePlay: () => void;
  onChangeSpeed: (speed: ReplaySpeed) => void;
  onScrub?: (progress: number) => void;
};

const SPEEDS: ReplaySpeed[] = [1, 2, 5, 10];

/** Replay transport controls: play/pause, speed (1x–10x), and a scrub position bar. */
export function ReplayControls({
  playing,
  speed,
  progress,
  onTogglePlay,
  onChangeSpeed,
}: ReplayControlsProps) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.sm }}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause replay' : 'Play replay'}
          onPress={onTogglePlay}
          style={[styles.play, { backgroundColor: theme.colors.accent }]}>
          <Text variant="label" style={{ color: theme.colors.onAccent }}>
            {playing ? 'PAUSE' : 'PLAY'}
          </Text>
        </Pressable>
        <View style={styles.speeds}>
          {SPEEDS.map((s) => {
            const active = s === speed;
            return (
              <Pressable
                key={s}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${s}x speed`}
                onPress={() => onChangeSpeed(s)}
                style={[
                  styles.speed,
                  {
                    borderColor: active ? theme.colors.accent : theme.colors.border,
                    backgroundColor: active ? `${theme.colors.accent}1F` : 'transparent',
                    borderRadius: theme.radius.full,
                  },
                ]}>
                <Text variant="label" color={active ? 'accent' : 'textSecondary'}>
                  {s}x
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <ProgressBar progress={progress} accessibilityLabel="Replay position" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  play: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 24 },
  speeds: { flexDirection: 'row', gap: 8, flex: 1 },
  speed: { paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1 },
});
