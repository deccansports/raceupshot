import { View } from 'react-native';

import { useTheme } from '@/core/theme';

import { Card } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { Text } from '../ui/Text';

export type CertificateCardProps = {
  title: string;
  eventTitle: string;
  dateLabel: string;
  onPress?: () => void;
};

/** Finisher certificate entry with a medal motif and open affordance. */
export function CertificateCard({ title, eventTitle, dateLabel, onPress }: CertificateCardProps) {
  const theme = useTheme();

  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: theme.radius.medium,
            backgroundColor: `${theme.colors.accentSecondary}1F`,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Icon name="medal" color="accentSecondary" size={26} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="headline" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="bodySmall" color="textMuted" numberOfLines={1}>
            {eventTitle} · {dateLabel}
          </Text>
        </View>
        <Icon name="chevronRight" color="textMuted" />
      </View>
    </Card>
  );
}
