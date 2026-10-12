import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useSession } from '@/core/auth/session';
import { adminLiveTestRepository, type LiveTestEvent, type LiveTestSnapshot } from '@/core/repositories/adminLiveTest.repository';
import { useTheme } from '@/core/theme';
import { useMobileProfile } from '@/features/dashboard/hooks/useMobileAggregates';
import { Badge, Button, Card, FullScreenMessage, Screen, Text } from '@/shared/components';

export function AdminLiveTestScreen() {
  const theme = useTheme();
  const router = useRouter();
  const status = useSession((state) => state.status);
  const profileQuery = useMobileProfile(status === 'authenticated');
  const isAdmin = profileQuery.data?.isAdmin === true || profileQuery.data?.role === 'admin';
  const [events, setEvents] = useState<LiveTestEvent[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [snapshot, setSnapshot] = useState<LiveTestSnapshot | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const loadEvents = useCallback(async () => {
    const response = await adminLiveTestRepository.listEvents();
    setEvents(response.events || []);
    setSelectedId((current) => current || response.events?.[0]?.id || '');
  }, []);

  const loadSnapshot = useCallback(async () => {
    if (!selectedId) return;
    try {
      const next = await adminLiveTestRepository.snapshot(selectedId);
      setSnapshot(next);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load simulator status');
    }
  }, [selectedId]);

  useEffect(() => {
    if (!isAdmin) return;
    const timer = setTimeout(() => {
      void loadEvents().catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load test events'));
    }, 0);
    return () => clearTimeout(timer);
  }, [isAdmin, loadEvents]);

  useEffect(() => {
    if (!isAdmin || !selectedId) return;
    let active = true;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (delay = 2_000) => {
      if (!active || AppState.currentState !== 'active') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (!active || inFlight || AppState.currentState !== 'active') return;
      inFlight = true;
      try {
        await loadSnapshot();
      } finally {
        inFlight = false;
        schedule();
      }
    };
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') schedule(0);
      else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    });
    schedule(0);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [isAdmin, loadSnapshot, selectedId]);

  const run = useCallback(async (label: string, operation: () => Promise<unknown>) => {
    setBusy(label);
    setError('');
    try {
      await operation();
      await loadSnapshot();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Simulator action failed');
    } finally {
      setBusy('');
    }
  }, [loadSnapshot]);

  const selectedEvent = useMemo(() => events.find((event) => event.id === selectedId) || null, [events, selectedId]);

  if (status === 'loading' || (status === 'authenticated' && profileQuery.isLoading)) {
    return <FullScreenMessage title="Checking admin access…" description="Loading the protected live tracking console." />;
  }
  if (status !== 'authenticated' || !isAdmin) {
    return <FullScreenMessage title="Admin access only" description="This live tracking test environment is hidden from athletes and the public." actionLabel="Go back" onAction={() => router.back()} />;
  }

  const simulation = snapshot?.simulation;
  const participants = snapshot?.participants || [];
  const finished = snapshot?.results?.rows?.length || 0;
  return (
    <Screen scroll contentStyle={{ gap: theme.spacing.base, paddingBottom: theme.spacing.xxl }}>
      <View style={{ gap: 6 }}>
        <Text variant="display">Live Tracking Test</Text>
        <Text variant="body" color="textMuted">Private admin simulator shared with the BERGMAN web app. Data refreshes every 2 seconds.</Text>
      </View>

      <Card style={{ gap: theme.spacing.sm }}>
        <Text variant="label" color="textMuted">TEST EVENT</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {events.map((event) => (
            <Button key={event.id} label={event.id === selectedId ? `✓ ${event.eventName}` : event.eventName} size="sm" variant={event.id === selectedId ? 'primary' : 'ghost'} onPress={() => { setSelectedId(event.id); setSnapshot(null); }} />
          ))}
        </View>
        {selectedEvent ? <Text variant="caption" color="textMuted">{selectedEvent.id} · {selectedEvent.eventDate}</Text> : null}
      </Card>

      <Card style={{ gap: theme.spacing.base }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}><Text variant="headline">Simulator controls</Text><Text variant="caption" color="textMuted">Tick {simulation?.tickNumber || 0} · {simulation?.speedMultiplier || 1}× speed</Text></View>
          <Badge label={simulation?.status || 'NOT SEEDED'} variant={simulation?.status === 'RUNNING' ? 'live' : 'neutral'} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button label="Seed / Reset Data" size="sm" variant="secondary" loading={busy === 'seed'} onPress={() => void run('seed', async () => { await adminLiveTestRepository.seed(selectedId); })} />
          <Button label="Start" size="sm" loading={busy === 'start'} onPress={() => void run('start', () => adminLiveTestRepository.action(selectedId, 'START'))} />
          <Button label="Pause" size="sm" variant="ghost" loading={busy === 'pause'} onPress={() => void run('pause', () => adminLiveTestRepository.action(selectedId, 'PAUSE'))} />
          <Button label="Resume" size="sm" variant="ghost" loading={busy === 'resume'} onPress={() => void run('resume', () => adminLiveTestRepository.action(selectedId, 'RESUME'))} />
          <Button label="Next Tick" size="sm" variant="secondary" loading={busy === 'tick'} onPress={() => void run('tick', () => adminLiveTestRepository.tick(selectedId))} />
          <Button label="Stop" size="sm" variant="destructive" loading={busy === 'stop'} onPress={() => void run('stop', () => adminLiveTestRepository.action(selectedId, 'STOP'))} />
        </View>
        {error ? <Text variant="bodySmall" style={{ color: theme.colors.danger }}>{error}</Text> : null}
      </Card>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Card style={{ flex: 1, gap: 4 }}><Text variant="caption" color="textMuted">ATHLETES</Text><Text variant="headline">{participants.length}</Text></Card>
        <Card style={{ flex: 1, gap: 4 }}><Text variant="caption" color="textMuted">FINISHED</Text><Text variant="headline">{finished}</Text></Card>
        <Card style={{ flex: 1, gap: 4 }}><Text variant="caption" color="textMuted">TICK</Text><Text variant="headline">{simulation?.tickNumber || 0}</Text></Card>
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="headline">Mobile tracking feed</Text>
        {participants.map((athlete) => {
          const progress = Math.round(Number(athlete.position?.courseProgress || 0) * 100);
          return <Card key={athlete.participantId || athlete.id} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <View style={{ flex: 1 }}><Text variant="headline">{athlete.name || athlete.fullName || 'Test Athlete'}</Text><Text variant="bodySmall" color="textMuted">Bib {athlete.bib || '—'} · {athlete.category || 'Uncategorised'}</Text></View>
              <Badge label={athlete.status || athlete.leg || 'NOT STARTED'} variant={athlete.status === 'FINISHED' ? 'success' : athlete.status === 'NOT_STARTED' ? 'neutral' : 'live'} />
            </View>
            <Text variant="bodySmall">{athlete.currentSplit || 'Waiting for first timing point'} · {progress}% course progress</Text>
            <View style={{ height: 6, borderRadius: 999, backgroundColor: theme.colors.border, overflow: 'hidden' }}><View style={{ height: '100%', width: `${progress}%`, backgroundColor: theme.colors.accent }} /></View>
          </Card>;
        })}
      </View>
    </Screen>
  );
}
