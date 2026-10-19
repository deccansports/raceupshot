import { View } from 'react-native';

import { useTheme } from '@/core/theme';

import { Card } from '../ui/Card';
import { Divider } from '../ui/Divider';
import { Stat } from '../ui/Stat';
import { Text } from '../ui/Text';

export type ResultCardProps = {
  eventTitle: string;
  dateLabel: string;
  finishTime: string;
  position?: string;
  pace?: string;
  onPress?: () => void;
};

/** Personal result summary with prominent finish time and placing. */
export function ResultCard({
  eventTitle,
  dateLabel,
  finishTime,
  position,
  pace,
  onPress,
}: ResultCardProps) {
  const theme = useTheme();

  return (
    <Card onPress={onPress} style={{ gap: theme.spacing.md }}>
      <View style={{ gap: 2 }}>
        <Text variant="headline" numberOfLines={1}>
          {eventTitle}
        </Text>
        <Text variant="bodySmall" color="textMuted">
          {dateLabel}
        </Text>
      </View>
      <Divider />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Stat value={finishTime} label="Finish" color="textPrimary" />
        {position ? <Stat value={position} label="Position" align="center" color="accent" /> : null}
        {pace ? <Stat value={pace} label="Pace" align="center" /> : null}
      </View>
    </Card>
  );
}
