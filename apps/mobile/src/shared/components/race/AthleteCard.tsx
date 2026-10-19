import { View } from 'react-native';

import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { Text } from '../ui/Text';
import { Avatar } from '../ui/Avatar';
import { RaceStatusBadge } from './RaceStatusBadge';
import { type RaceStatus } from './RaceStatus';

export type AthleteCardProps = {
  name: string;
  subtitle?: string;
  avatarUri?: string;
  /** Seed for the deterministic avatar color (athlete id). */
  avatarSeed?: string;
  status?: RaceStatus;
  /** Optional rank/position, e.g. "3" or "12th". */
  rank?: string;
  onPress?: () => void;
};

/** Compact athlete summary with avatar, meta, and optional live status/rank. */
export function AthleteCard({
  name,
  subtitle,
  avatarUri,
  avatarSeed,
  status,
  rank,
  onPress,
}: AthleteCardProps) {
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar name={name} uri={avatarUri} colorSeed={avatarSeed} size={48} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="headline" numberOfLines={1}>
            {name}
          </Text>
          {subtitle ? (
            <Text variant="bodySmall" color="textMuted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {rank ? (
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text variant="metricSmall" color="accent">
              {rank}
            </Text>
            <Text variant="caption" color="textMuted">
              RANK
            </Text>
          </View>
        ) : status ? (
          <RaceStatusBadge status={status} />
        ) : (
          <Icon name="chevronRight" color="textMuted" />
        )}
      </View>
    </Card>
  );
}
