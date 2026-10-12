import { Pressable, View } from 'react-native';

import {
  Avatar,
  Badge,
  Card,
  CertificateCard,
  EmptyState,
  Icon,
  ProgressBar,
  ResultCard,
  SectionHeader,
  Skeleton,
  Stat,
  Text,
  type IconName,
} from '@/shared/components';
import { useTheme } from '@/core/theme';
import type {
  AthleteDashboardCertificate,
  AthleteDashboardRegistration,
  AthleteDashboardResult,
  AthleteRankingEntry,
  ClubRankingEntry,
  DashboardMetric,
  Workout,
} from '@/core/repositories';

export function HeaderCard({
  title,
  subtitle,
  imageUri,
  badge,
  meta,
  icon = 'user',
}: {
  title: string;
  subtitle?: string;
  imageUri?: string | null;
  badge?: string | null;
  meta?: string[];
  icon?: IconName;
}) {
  const theme = useTheme();
  return (
    <Card style={{ gap: theme.spacing.md, backgroundColor: theme.colors.surface }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        {imageUri !== undefined ? (
          <Avatar name={title} uri={imageUri ?? undefined} size={72} />
        ) : (
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 28,
              backgroundColor: `${theme.colors.accent}22`,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Icon name={icon} color="accent" size={32} />
          </View>
        )}
        <View style={{ flex: 1, gap: 6 }}>
          {badge ? <Badge label={badge} variant="success" /> : null}
          <Text variant="display" numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="body" color="textMuted" numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {meta && meta.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {meta.filter(Boolean).map((item) => (
            <Badge key={item} label={item} variant="neutral" />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export function MetricGrid({ metrics }: { metrics: DashboardMetric[] }) {
  const theme = useTheme();
  const visible = metrics.filter((metric) => metric.value !== undefined && metric.value !== null);
  if (visible.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
      {visible.map((metric) => (
        <Card key={metric.label} style={{ flexGrow: 1, flexBasis: '45%', minWidth: 150 }}>
          <Stat value={String(metric.value ?? '—')} label={metric.label} color="accent" />
        </Card>
      ))}
    </View>
  );
}

export function ResultList({ title, data }: { title: string; data?: AthleteDashboardResult[] }) {
  const rows = data ?? [];
  return (
    <Section title={title} emptyTitle={`No ${title.toLowerCase()} returned by backend`}>
      {rows.map((result, index) => (
        <ResultCard
          key={result.id ?? `${result.event}-${index}`}
          eventTitle={result.event}
          dateLabel={[result.date, result.contest].filter(Boolean).join(' · ')}
          finishTime={result.chipTime ?? '—'}
          position={
            result.position != null
              ? `${result.position}${result.pointsEarned != null ? ` · ${result.pointsEarned} pts` : ''}`
              : undefined
          }
        />
      ))}
    </Section>
  );
}

export function RegistrationList({
  title,
  data,
}: {
  title: string;
  data?: AthleteDashboardRegistration[];
}) {
  return (
    <Section title={title} emptyTitle={`No ${title.toLowerCase()} returned by backend`}>
      {(data ?? []).map((item, index) => (
        <Card key={item.id ?? `${item.event}-${index}`}>
          <View style={{ gap: 4 }}>
            <Text variant="headline">{item.event}</Text>
            <Text variant="bodySmall" color="textMuted">
              {[item.date, item.contest, item.bib ? `Bib ${item.bib}` : null, item.status]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </Card>
      ))}
    </Section>
  );
}

export function CertificateList({ data }: { data?: AthleteDashboardCertificate[] }) {
  return (
    <Section title="My Certificates" emptyTitle="No certificates returned by backend">
      {(data ?? []).map((certificate) => (
        <CertificateCard
          key={certificate.id}
          title={certificate.title ?? 'Certificate'}
          eventTitle={certificate.event}
          dateLabel={certificate.date ?? '—'}
        />
      ))}
    </Section>
  );
}

export function AthleteRankingCard({
  item,
  onPress,
}: {
  item: AthleteRankingEntry;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const subtitle = [
    item.affiliation ?? item.club,
    item.gender,
    item.ageGroup,
    item.country,
    item.tier,
    item.categoryRank != null ? `Cat #${item.categoryRank}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable onPress={onPress}>
      <Card style={{ gap: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md }}>
          <View
            style={{
              minWidth: 56,
              height: 56,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: `${theme.colors.accent}18`,
            }}>
            <Text variant="metricSmall" color="accent">
              #{item.rank}
            </Text>
          </View>
          <Avatar name={item.name} uri={item.photoUrl ?? undefined} colorSeed={item.id} size={52} />
          <View style={{ flex: 1, gap: 6 }}>
            <Text variant="headline" numberOfLines={1}>
              {item.name}
            </Text>
            <Text variant="bodySmall" color="textMuted" numberOfLines={2}>
              {subtitle || 'Unspecified'}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
              {item.starts != null ? <Badge label={`${item.starts} starts`} variant="neutral" /> : null}
              {item.gender ? <Badge label={item.gender} variant="neutral" /> : null}
              {item.ageGroup ? <Badge label={item.ageGroup} variant="neutral" /> : null}
            </View>
          </View>
          <Stat value={String(item.points ?? '—')} label="Total Pts" align="center" color="accent" />
        </View>
      </Card>
    </Pressable>
  );
}

export function ClubRankingCard({
  item,
  onPress,
}: {
  item: ClubRankingEntry;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const subtitle = [
    item.country,
    item.location,
    item.coachName,
    item.members != null ? `${item.members} members` : null,
    item.races != null ? `${item.races} races` : item.events != null ? `${item.events} events` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable onPress={onPress}>
      <Card style={{ gap: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md }}>
          <View
            style={{
              minWidth: 56,
              height: 56,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: `${theme.colors.accent}18`,
            }}>
            <Text variant="metricSmall" color="accent">
              #{item.rank}
            </Text>
          </View>
          <Avatar name={item.name} uri={item.logoUrl ?? undefined} colorSeed={item.id} size={52} />
          <View style={{ flex: 1, gap: 6 }}>
            <Text variant="headline" numberOfLines={1}>
              {item.name}
            </Text>
            <Text variant="bodySmall" color="textMuted" numberOfLines={2}>
              {subtitle || 'Unspecified'}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
              {item.members != null ? <Badge label={`${item.members} athletes`} variant="neutral" /> : null}
              {item.races != null ? <Badge label={`${item.races} races`} variant="neutral" /> : null}
            </View>
          </View>
          <Stat
            value={String(item.points ?? item.totalPoints ?? '—')}
            label={item.movement != null ? `Pts · ${item.movement}` : 'Total Pts'}
            align="center"
            color="accent"
          />
        </View>
      </Card>
    </Pressable>
  );
}

export function TrainingCard({ item }: { item: Workout }) {
  const theme = useTheme();
  return (
    <Card style={{ gap: theme.spacing.sm }}>
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="headline">{item.title}</Text>
          <Text variant="bodySmall" color="textMuted">
            {[item.sport, item.duration].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Icon name="arrowRight" color="textMuted" />
      </View>
      {item.instructions ? (
        <Text variant="bodySmall" color="textSecondary">
          {item.instructions}
        </Text>
      ) : null}
    </Card>
  );
}

export function ProgressChart({ title, data }: { title: string; data?: DashboardMetric[] }) {
  const theme = useTheme();
  const rows = data ?? [];
  if (rows.length === 0) return null;
  const numeric = rows.map((row) => Number(row.value)).filter((value) => Number.isFinite(value));
  const max = Math.max(...numeric, 1);
  return (
    <Card style={{ gap: theme.spacing.md }}>
      <Text variant="headline">{title}</Text>
      {rows.map((row) => {
        const value = Number(row.value);
        const progress = Number.isFinite(value) ? Math.max(0, Math.min(1, value / max)) : 0;
        return (
          <View key={row.label} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="bodySmall" color="textMuted">
                {row.label}
              </Text>
              <Text variant="bodySmall">{String(row.value ?? '—')}</Text>
            </View>
            <ProgressBar progress={progress} />
          </View>
        );
      })}
    </Card>
  );
}

export function Section({
  title,
  emptyTitle,
  children,
}: {
  title: string;
  emptyTitle: string;
  children: React.ReactNode;
}) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <View style={{ gap: 12 }}>
      <SectionHeader title={title} />
      {rows.length > 0 ? rows : <EmptyState title={emptyTitle} />}
    </View>
  );
}

export function LoadingStack() {
  return (
    <View style={{ gap: 14 }}>
      <Skeleton height={124} radius={24} />
      <Skeleton height={96} radius={20} />
      <Skeleton height={96} radius={20} />
    </View>
  );
}
