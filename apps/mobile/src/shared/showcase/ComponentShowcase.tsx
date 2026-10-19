import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { useResolvedColorScheme } from '@/core/hooks/useColorScheme';
import { usePreferencesStore } from '@/core/store';
import { useTheme } from '@/core/theme';
import {
  AthleteCard,
  Avatar,
  Badge,
  BottomSheet,
  Button,
  Card,
  CertificateCard,
  Chip,
  Divider,
  EmptyState,
  ErrorState,
  EventCard,
  FloatingActionButton,
  HeroBanner,
  Input,
  LeaderboardCard,
  ListItem,
  LiveEventCard,
  LoadingSpinner,
  Modal,
  NewsCard,
  OfflineBanner,
  ProgressBar,
  RaceStatusBadge,
  ResultCard,
  Screen,
  SearchBar,
  Skeleton,
  Stat,
  TabBar,
  Text,
} from '@/shared/components';

const IMG_EVENT = 'https://picsum.photos/seed/bergman-run/800/500';
const IMG_LIVE = 'https://picsum.photos/seed/bergman-live/800/500';
const IMG_NEWS = 'https://picsum.photos/seed/bergman-news/800/400';
const IMG_HERO = 'https://picsum.photos/seed/bergman-hero/1000/700';

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm, marginBottom: theme.spacing.xl }}>
      <Text variant="label" color="textMuted">
        {title.toUpperCase()}
      </Text>
      <View style={{ gap: theme.spacing.sm }}>{children}</View>
    </View>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      {children}
    </View>
  );
}

/**
 * Component Showcase — a development-only preview of the BERGMAN design system.
 * It exercises every reusable component in light/dark and is not a product screen.
 */
export function ComponentShowcase() {
  const theme = useTheme();
  const scheme = useResolvedColorScheme();
  const setColorScheme = usePreferencesStore((s) => s.setColorScheme);

  const [search, setSearch] = useState('');
  const [chip, setChip] = useState('all');
  const [tab, setTab] = useState('overall');
  const [modal, setModal] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [offline, setOffline] = useState(true);

  return (
    <Screen scroll>
      <OfflineBanner visible={offline} message="Showcase offline banner" />

      <View style={{ gap: theme.spacing.xs, marginBottom: theme.spacing.lg }}>
        <Text variant="display">BERGMAN Design System</Text>
        <Text variant="body" color="textSecondary">
          Milestone 2 — reusable component library ({scheme} mode)
        </Text>
        <View style={{ marginTop: theme.spacing.sm }}>
          <Button
            label={`Switch to ${scheme === 'dark' ? 'light' : 'dark'} mode`}
            onPress={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')}
          />
        </View>
      </View>

      <Section title="Hero Banner — Live Event">
        <HeroBanner
          eyebrow="🏊 Triathlon"
          title="BERGMAN Mumbai"
          status="live"
          imageUri={IMG_HERO}
          stats={[
            { value: '1,284', label: 'Athletes' },
            { value: '42.2K', label: 'Distance' },
          ]}
          actionLabel="Track Live"
          onAction={() => {}}
        />
      </Section>

      <Section title="Hero Banner — Greeting">
        <HeroBanner
          eyebrow="Good morning, Vaibhav 👋"
          subtitle="NEXT RACE"
          title="BERGMAN Kolhapur"
          stats={[{ value: '12', label: 'Days Remaining' }]}
        />
      </Section>

      <Section title="Race Status">
        <Row>
          <RaceStatusBadge status="live" />
          <RaceStatusBadge status="finished" />
          <RaceStatusBadge status="upcoming" />
          <RaceStatusBadge status="notStarted" />
        </Row>
      </Section>

      <Section title="Event Cards">
        <EventCard
          title="BERGMAN Mumbai"
          dateLabel="Sat, 12 Oct"
          location="Marine Drive, Mumbai"
          discipline="Triathlon"
          status="upcoming"
          imageUri={IMG_EVENT}
          onPress={() => {}}
        />
        <LiveEventCard
          title="BERGMAN Goa Half"
          athleteCount="864"
          imageUri={IMG_LIVE}
          onPress={() => {}}
        />
      </Section>

      <Section title="Athlete & Result Cards">
        <AthleteCard
          name="Elena Bergman"
          subtitle="F35–39 · Bib 1042"
          status="live"
          onPress={() => {}}
        />
        <AthleteCard name="Marcus Vale" subtitle="M40–44 · Bib 88" rank="3" onPress={() => {}} />
        <ResultCard
          eventTitle="BERGMAN Pune Marathon"
          dateLabel="Feb 2026"
          finishTime="3:24:18"
          position="42nd"
          pace="4:51"
          onPress={() => {}}
        />
      </Section>

      <Section title="Certificate & News Cards">
        <CertificateCard
          title="Finisher Certificate"
          eventTitle="BERGMAN Pune Marathon"
          dateLabel="Feb 2026"
          onPress={() => {}}
        />
        <NewsCard
          title="Course record shattered at BERGMAN Mumbai"
          excerpt="A blistering final split rewrote the books on Marine Drive."
          source="BERGMAN"
          dateLabel="2h ago"
          imageUri={IMG_NEWS}
          onPress={() => {}}
        />
      </Section>

      <Section title="Leaderboard">
        <LeaderboardCard
          title="Overall — Live"
          entries={[
            { id: '1', rank: 1, name: 'A. Sharma', time: '2:58:11', detail: 'M30–34' },
            { id: '2', rank: 2, name: 'K. Rao', time: '2:59:47', detail: 'M25–29' },
            { id: '3', rank: 3, name: 'E. Bergman', time: '3:01:22', detail: 'F35–39' },
            { id: '4', rank: 4, name: 'You', time: '3:24:18', detail: 'M40–44', highlight: true },
          ]}
          onEntryPress={() => {}}
        />
      </Section>

      <Section title="Stats & Floating Action">
        <Row>
          <Stat value="1,284" label="Athletes" size="lg" />
          <Stat value="3:24:18" label="Best Time" size="lg" color="accent" />
        </Row>
        <View style={{ height: 12 }} />
        <Row>
          <FloatingActionButton
            label="Track Live"
            onPress={() => {}}
            accessibilityLabel="Track live"
          />
          <FloatingActionButton icon="bell" onPress={() => {}} accessibilityLabel="Notifications" />
        </Row>
      </Section>

      <Section title="Buttons">
        <Row>
          <Button label="Primary" onPress={() => {}} />
          <Button label="Secondary" variant="secondary" onPress={() => {}} />
          <Button label="Ghost" variant="ghost" onPress={() => {}} />
          <Button label="Destructive" variant="destructive" onPress={() => {}} />
        </Row>
        <Row>
          <Button label="Loading" loading onPress={() => {}} />
          <Button label="Disabled" disabled onPress={() => {}} />
        </Row>
      </Section>

      <Section title="Badges & Chips">
        <Row>
          <Badge label="Live" variant="live" />
          <Badge label="Upcoming" variant="upcoming" />
          <Badge label="Finished" variant="finished" />
          <Badge label="Warning" variant="warning" />
        </Row>
        <Row>
          {['all', 'run', 'ride', 'swim'].map((c) => (
            <Chip key={c} label={c} selected={chip === c} onPress={() => setChip(c)} />
          ))}
        </Row>
      </Section>

      <Section title="Card, Avatar & List Item">
        <Card>
          <ListItem
            title="Elena Bergman"
            subtitle="Marathon · Bib 1042"
            leading={<Avatar name="Elena Bergman" />}
            trailing={<Badge label="Live" variant="live" />}
            onPress={() => {}}
          />
          <Divider />
          <ListItem
            title="Marcus Vale"
            subtitle="Half Marathon · Bib 88"
            leading={<Avatar name="Marcus Vale" />}
          />
        </Card>
      </Section>

      <Section title="Inputs">
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search athletes" />
        <Input label="Email" placeholder="you@example.com" keyboardType="email-address" />
        <Input label="Password" placeholder="••••••" secureTextEntry error="Incorrect password" />
      </Section>

      <Section title="Tabs">
        <TabBar
          items={[
            { key: 'overall', label: 'Overall' },
            { key: 'age', label: 'Age Group' },
            { key: 'gender', label: 'Gender' },
          ]}
          activeKey={tab}
          onChange={setTab}
        />
      </Section>

      <Section title="Progress & Loading">
        <ProgressBar progress={0.62} accessibilityLabel="Race progress" />
        <Row>
          <LoadingSpinner size="small" />
          <Skeleton width={120} height={16} />
          <Skeleton width={80} height={16} />
        </Row>
      </Section>

      <Section title="Overlays">
        <Row>
          <Button label="Open Modal" variant="secondary" onPress={() => setModal(true)} />
          <Button label="Open Bottom Sheet" variant="secondary" onPress={() => setSheet(true)} />
          <Button
            label={offline ? 'Hide offline banner' : 'Show offline banner'}
            variant="ghost"
            onPress={() => setOffline((v) => !v)}
          />
        </Row>
      </Section>

      <Section title="Empty & Error States">
        <Card padded={false}>
          <EmptyState
            title="No events yet"
            description="Upcoming BERGMAN races will appear here."
            actionLabel="Refresh"
            onAction={() => {}}
          />
          <Divider />
          <ErrorState description="We couldn't load the leaderboard." onRetry={() => {}} />
        </Card>
      </Section>

      <Modal visible={modal} onClose={() => setModal(false)} title="Modal title">
        <Text variant="body" color="textSecondary">
          Centered modal with backdrop and scale animation.
        </Text>
        <View style={{ marginTop: theme.spacing.base }}>
          <Button label="Close" onPress={() => setModal(false)} fullWidth />
        </View>
      </Modal>

      <BottomSheet visible={sheet} onClose={() => setSheet(false)} title="Filters">
        <Text variant="body" color="textSecondary">
          Drag down to dismiss, or tap the backdrop.
        </Text>
        <View style={{ marginTop: theme.spacing.base }}>
          <Button label="Apply" onPress={() => setSheet(false)} fullWidth />
        </View>
      </BottomSheet>
    </Screen>
  );
}
