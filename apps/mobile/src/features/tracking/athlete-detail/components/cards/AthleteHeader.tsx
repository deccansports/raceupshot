import { View } from 'react-native';

import { useTheme } from '@/core/theme';
import { Avatar, Badge, Card, RaceStatusBadge, Text } from '@/shared/components';
import type { AthleteHeaderView } from '@/features/tracking/mappers';

/** Athlete identity + event context + status. Renders view-model data only. */
export function AthleteHeader({ header }: { header: AthleteHeaderView }) {
  const theme = useTheme();

  const eventLine = [header.eventName, header.eventDate, header.scheduledStart]
    .filter(Boolean)
    .join(' · ');
  const meta = [header.category, header.gender].filter(Boolean).join(' · ');

  return (
    <Card style={{ gap: theme.spacing.md }}>
      {eventLine ? (
        <Text variant="caption" color="textMuted">
          {eventLine}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <Avatar name={header.name} uri={header.photo} size={56} />
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
            <Text variant="headline" style={{ flexShrink: 1 }}>
              {header.name}
            </Text>
            {header.countryFlag ? <Text variant="headline">{header.countryFlag}</Text> : null}
            {header.anonymous ? <Badge label="Anonymous" variant="neutral" /> : null}
          </View>
          <Text variant="bodySmall" color="textMuted">
            Bib {header.bib}
            {header.contest ? ` · ${header.contest}` : ''}
          </Text>
        </View>
        <RaceStatusBadge status={header.status} />
      </View>

      {meta || header.registrationStatus ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {meta ? (
            <Text variant="caption" color="textSecondary">
              {meta}
            </Text>
          ) : null}
          {header.registrationStatus ? (
            <Text variant="caption" color="textSecondary">
              · {header.registrationStatus}
            </Text>
          ) : null}
        </View>
      ) : null}

      {header.club ? (
        <Text variant="caption" color="success">
          Proudly representing {header.club}
        </Text>
      ) : null}

      {header.location ? (
        <Text variant="caption" color="textMuted">
          {header.location}
        </Text>
      ) : null}
    </Card>
  );
}
