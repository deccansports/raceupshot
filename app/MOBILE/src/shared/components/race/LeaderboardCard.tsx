import { Fragment } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/core/theme';

import { Card } from '../ui/Card';
import { Divider } from '../ui/Divider';
import { Text } from '../ui/Text';
import { LeaderboardRow, type LeaderboardRowProps } from './LeaderboardRow';

export type LeaderboardEntry = Omit<LeaderboardRowProps, 'onPress'> & { id: string };

export type LeaderboardCardProps = {
  title?: string;
  entries: LeaderboardEntry[];
  onEntryPress?: (id: string) => void;
};

/** Card wrapping a compact leaderboard with tabular timing. */
export function LeaderboardCard({
  title = 'Leaderboard',
  entries,
  onEntryPress,
}: LeaderboardCardProps) {
  const theme = useTheme();

  return (
    <Card padded={false} style={{ overflow: 'hidden' }}>
      <View style={{ padding: theme.spacing.base, paddingBottom: theme.spacing.sm }}>
        <Text variant="label" color="textMuted">
          {title.toUpperCase()}
        </Text>
      </View>
      <View style={{ paddingHorizontal: theme.spacing.sm, paddingBottom: theme.spacing.sm }}>
        {entries.map((entry, index) => (
          <Fragment key={entry.id}>
            {index > 0 ? <Divider inset={theme.spacing.base} /> : null}
            <LeaderboardRow
              {...entry}
              onPress={onEntryPress ? () => onEntryPress(entry.id) : undefined}
            />
          </Fragment>
        ))}
      </View>
    </Card>
  );
}
