import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useTheme } from '@/core/theme';
import { usePressScale } from '@/shared/hooks';

import { Avatar } from '../ui/Avatar';
import { Text } from '../ui/Text';

export type LeaderboardRowProps = {
  rank: number | string;
  name: string;
  time: string;
  countryFlag?: string;
  detail?: string;
  avatarUri?: string | number;
  /** Seed for the deterministic avatar color (athlete id). */
  avatarSeed?: string;
  highlight?: boolean;
  onPress?: () => void;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Single leaderboard entry: rank, athlete, and tabular finish/split time. */
export function LeaderboardRow({
  rank,
  name,
  time,
  countryFlag,
  detail,
  avatarUri,
  avatarSeed,
  highlight = false,
  onPress,
}: LeaderboardRowProps) {
  const theme = useTheme();
  const press = usePressScale(0.99);
  const numericRank = typeof rank === 'number' ? rank : Number(rank);
  const isPodium = Number.isFinite(numericRank) && numericRank <= 3;

  const row = (
    <>
      <Text
        variant="metricSmall"
        numberOfLines={1}
        style={{
          width: 34,
          flexShrink: 0,
          textAlign: 'center',
          color: isPodium ? theme.colors.accent : theme.colors.textMuted,
        }}>
        {rank}
      </Text>
      <Avatar name={name} uri={avatarUri} colorSeed={avatarSeed} size={36} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {countryFlag ? (
            <Text variant="body" numberOfLines={1} ellipsizeMode="tail">
              {countryFlag}
            </Text>
          ) : null}
          <Text variant="body" numberOfLines={1} ellipsizeMode="tail" style={{ flexShrink: 1 }}>
            {name}
          </Text>
        </View>
        {detail ? (
          <Text variant="caption" color="textMuted" numberOfLines={2} ellipsizeMode="tail">
            {detail}
          </Text>
        ) : null}
      </View>
      <Text
        variant="monoMetric"
        color="textPrimary"
        numberOfLines={1}
        style={{ flexShrink: 0, minWidth: 76, textAlign: 'right' }}>
        {time}
      </Text>
    </>
  );

  const style = {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.base,
    backgroundColor: highlight ? `${theme.colors.accent}14` : 'transparent',
    borderRadius: theme.radius.medium,
  };

  if (onPress) {
    return (
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={`Rank ${rank}, ${name}, ${time}`}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[press.style, style]}>
        {row}
      </AnimatedPressable>
    );
  }
  return <View style={style}>{row}</View>;
}
