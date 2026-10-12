import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { apiRequest } from '../api';

type Stage = 'SWIM' | 'T1' | 'BIKE' | 'T2' | 'RUN';
type CutoffStatus = 'SAFE' | 'WATCH' | 'DANGER' | 'OUT OF CUTOFF' | 'DNF' | 'NO CUTOFF';
type Athlete = {
  id: string; bib: string; name: string; category: string; status: string; currentLeg: string; currentSplit: string; nextSplit: string;
  lastTimingAt: string | null; started: boolean; finished: boolean; overallSeconds: number | null; overallRank: number | null;
  cutoff: { label: string; deadline: string | null; remainingSeconds: number | null; status: CutoffStatus };
};
type TimingData = {
  generatedAt: string; message: string;
  overview: { total: number; notStarted: number; started: number; onCourse: number; finished: number; remaining: number; dnf: number; withinCutoff: number; approachingCutoff: number; outOfCutoff: number; courseStages: Stage[]; legCounts: Record<Stage, number> };
  athletes: Athlete[]; approaching: Athlete[]; recentFinishers: Athlete[];
};

function duration(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const seconds = Math.max(0, Math.floor(Math.abs(value)));
  const label = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60].map((part) => String(part).padStart(2, '0')).join(':');
  return value < 0 ? `-${label}` : label;
}

function clock(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ');
}

function AthleteRow({ athlete, cutoffMode = false }: { athlete: Athlete; cutoffMode?: boolean }) {
  const terminal = ['DNF', 'DNS', 'DNQ', 'DSQ', 'OTL'].includes(athlete.status);
  return <View style={styles.athleteCard}>
    <View style={styles.athleteTop}><View style={styles.bib}><Text style={styles.bibText}>{athlete.bib}</Text></View><View style={styles.identity}><Text style={styles.athleteName}>{athlete.name}</Text><Text style={styles.athleteMeta}>{athlete.category}</Text></View><Text style={[styles.status, athlete.finished && styles.statusFinished, athlete.started && !athlete.finished && styles.statusLive, terminal && styles.statusDanger]}>{humanize(athlete.status)}</Text></View>
    <View style={styles.details}>
      <View style={styles.detail}><Text style={styles.detailLabel}>CURRENT LEG</Text><Text style={styles.detailValue}>{humanize(athlete.currentLeg)}</Text></View>
      <View style={styles.detail}><Text style={styles.detailLabel}>LAST SPLIT</Text><Text style={styles.detailValue}>{athlete.currentSplit}</Text></View>
      {cutoffMode ? <><View style={styles.detail}><Text style={styles.detailLabel}>NEXT CUTOFF</Text><Text style={styles.detailValue}>{athlete.cutoff.label}</Text></View><View style={styles.detail}><Text style={styles.detailLabel}>TIME REMAINING</Text><Text style={styles.detailValue}>{duration(athlete.cutoff.remainingSeconds)}</Text></View></> : <><View style={styles.detail}><Text style={styles.detailLabel}>OFFICIAL ELAPSED</Text><Text style={styles.detailValue}>{duration(athlete.overallSeconds)}</Text></View><View style={styles.detail}><Text style={styles.detailLabel}>{athlete.finished ? 'FINISH READ' : 'NEXT SPLIT'}</Text><Text style={styles.detailValue}>{athlete.finished ? clock(athlete.lastTimingAt) : athlete.nextSplit}</Text></View></>}
    </View>
    {cutoffMode ? <Text style={[styles.cutoff, athlete.cutoff.status === 'SAFE' && styles.cutoffSafe, (athlete.cutoff.status === 'WATCH' || athlete.cutoff.status === 'DANGER') && styles.cutoffWatch, (athlete.cutoff.status === 'OUT OF CUTOFF' || athlete.cutoff.status === 'DNF') && styles.cutoffDanger]}>{athlete.cutoff.status}</Text> : null}
  </View>;
}

export function LiveRaceOperationsScreen({ eventId, mode }: { eventId: string; mode: 'finish' | 'cutoff' }) {
  const [data, setData] = useState<TimingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async (manual = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (manual) setRefreshing(true);
    try {
      setData(await apiRequest<TimingData>(`/api/mobile/volunteer/live-timing?eventId=${encodeURIComponent(eventId)}&mode=${mode}`));
      setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Live race timing is unavailable.'); }
    finally { inFlight.current = false; setLoading(false); setRefreshing(false); }
  }, [eventId, mode]);

  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const interval = setInterval(() => void refresh(), 30_000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [refresh]);

  const term = query.trim().toLowerCase();
  const filter = useCallback((athlete: Athlete) => !term || [athlete.bib, athlete.name, athlete.category, athlete.status, athlete.currentLeg, athlete.currentSplit].some((value) => value.toLowerCase().includes(term)), [term]);
  const approaching = useMemo(() => (data?.approaching || []).filter(filter), [data, filter]);
  const finishers = useMemo(() => (data?.recentFinishers || []).filter(filter), [data, filter]);
  const cutoffRows = useMemo(() => (data?.athletes || []).filter((athlete) => athlete.started && !athlete.finished && athlete.cutoff.status !== 'NO CUTOFF' && filter(athlete)).sort((left, right) => (left.cutoff.remainingSeconds ?? Number.MAX_SAFE_INTEGER) - (right.cutoff.remainingSeconds ?? Number.MAX_SAFE_INTEGER)), [data, filter]);

  return <View style={styles.screen}>
    <Text style={styles.title}>{mode === 'finish' ? 'Finish Line Dashboard' : 'Cutoff Time Dashboard'}</Text>
    <Text style={styles.description}>{mode === 'finish' ? 'Athletes approaching the finish and confirmed official finishers.' : 'Official timing compared with configured race cutoffs.'}</Text>
    <View style={styles.toolbar}><TextInput value={query} onChangeText={setQuery} placeholder="Search BIB or athlete" placeholderTextColor="#7c898f" style={styles.search} /><Pressable disabled={refreshing} onPress={() => void refresh(true)} style={[styles.refresh, refreshing && styles.disabled]}>{refreshing ? <ActivityIndicator color="#fff" /> : <Text style={styles.refreshText}>Refresh</Text>}</Pressable></View>
    {error ? <Text style={styles.error}>{error}{data ? '\nShowing the last successfully loaded timing.' : ''}</Text> : null}
    {loading ? <View style={styles.loading}><ActivityIndicator color="#ff6b21" /><Text style={styles.loadingText}>Loading canonical race timing…</Text></View> : null}
    {!loading && data ? <>
      <Text style={styles.updated}>{data.message} Updated {clock(data.generatedAt)} · refreshes every 30 seconds.</Text>
      <Text style={styles.sectionTitle}>Race Status Overview</Text>
      <View style={styles.stats}>{(mode === 'finish' ? [
        ['Total', data.overview.total], ['Not started', data.overview.notStarted], ['On course', data.overview.onCourse], ['Finished', data.overview.finished], ['Remaining', data.overview.remaining], ['DNF', data.overview.dnf],
      ] : [['Within', data.overview.withinCutoff], ['Approaching', data.overview.approachingCutoff], ['Out', data.overview.outOfCutoff], ['DNF', data.overview.dnf]]).map(([label, value]) => <View key={String(label)} style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>)}</View>
      {mode === 'finish' && data.overview.courseStages.length ? <View style={styles.legs}>{data.overview.courseStages.map((stage) => <View key={stage} style={styles.leg}><Text style={styles.legValue}>{data.overview.legCounts[stage]}</Text><Text style={styles.legLabel}>{stage}</Text></View>)}</View> : null}
      {mode === 'finish' ? <><Text style={styles.sectionTitle}>Approaching Finish ({approaching.length})</Text>{!approaching.length ? <Text style={styles.empty}>No athletes are currently approaching the finish line.</Text> : approaching.slice(0, 30).map((athlete) => <AthleteRow key={`approach-${athlete.id}`} athlete={athlete} />)}<Text style={styles.sectionTitle}>Recent Official Finishers ({finishers.length})</Text>{!finishers.length ? <Text style={styles.empty}>No official finishers yet.</Text> : finishers.slice(0, 30).map((athlete) => <AthleteRow key={`finish-${athlete.id}`} athlete={athlete} />)}</> : <><Text style={styles.sectionTitle}>Cutoff Athletes ({cutoffRows.length})</Text>{!cutoffRows.length ? <Text style={styles.empty}>No athletes currently require cutoff monitoring.</Text> : cutoffRows.slice(0, 100).map((athlete) => <AthleteRow key={athlete.id} athlete={athlete} cutoffMode />)}</>}
    </> : null}
  </View>;
}

const styles = StyleSheet.create({
  screen: { marginTop: 18 }, title: { color: '#111518', fontSize: 20, fontWeight: '900' }, description: { color: '#637179', fontSize: 12, lineHeight: 18, marginTop: 5 }, toolbar: { flexDirection: 'row', gap: 8, marginTop: 16 }, search: { flex: 1, height: 50, borderRadius: 13, borderWidth: 1, borderColor: '#c8d0d4', backgroundColor: '#fff', color: '#111518', paddingHorizontal: 13, fontSize: 13 }, refresh: { minWidth: 84, borderRadius: 13, backgroundColor: '#ff6b21', alignItems: 'center', justifyContent: 'center' }, refreshText: { color: '#fff', fontSize: 12, fontWeight: '900' }, disabled: { opacity: .5 }, loading: { minHeight: 130, alignItems: 'center', justifyContent: 'center', gap: 9 }, loadingText: { color: '#637179', fontSize: 11, fontWeight: '800' }, error: { marginTop: 13, borderRadius: 12, borderWidth: 1, borderColor: '#f3a9ad', backgroundColor: '#fff0f1', color: '#a5222c', padding: 12, fontSize: 11, lineHeight: 17 }, updated: { color: '#6f7a80', fontSize: 9, lineHeight: 14, marginTop: 10 }, sectionTitle: { color: '#111518', fontSize: 16, fontWeight: '900', marginTop: 21, marginBottom: 8 }, stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, stat: { width: '30%', minWidth: 84, flexGrow: 1, minHeight: 70, borderRadius: 13, borderWidth: 1, borderColor: '#d2d9dc', backgroundColor: '#fff', justifyContent: 'center', padding: 11 }, statValue: { color: '#111518', fontSize: 23, fontWeight: '900' }, statLabel: { color: '#6f7a80', fontSize: 9, fontWeight: '800', marginTop: 3 }, legs: { flexDirection: 'row', borderRadius: 13, backgroundColor: '#111518', paddingVertical: 11, marginTop: 9 }, leg: { flex: 1, alignItems: 'center' }, legValue: { color: '#ff6b21', fontSize: 17, fontWeight: '900' }, legLabel: { color: '#c7d0d4', fontSize: 8, fontWeight: '900', marginTop: 2 }, empty: { color: '#6f7a80', textAlign: 'center', paddingVertical: 22, fontSize: 11 }, athleteCard: { borderRadius: 14, borderWidth: 1, borderColor: '#d2d9dc', backgroundColor: '#fff', padding: 11, marginTop: 9 }, athleteTop: { flexDirection: 'row', alignItems: 'center' }, bib: { minWidth: 48, height: 48, borderRadius: 11, backgroundColor: '#111518', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }, bibText: { color: '#ff6b21', fontSize: 13, fontWeight: '900' }, identity: { flex: 1, marginLeft: 10 }, athleteName: { color: '#111518', fontSize: 13, fontWeight: '900' }, athleteMeta: { color: '#6f7a80', fontSize: 9, marginTop: 3 }, status: { maxWidth: 88, color: '#875f08', backgroundColor: '#fff0bf', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 5, overflow: 'hidden', fontSize: 8, fontWeight: '900', textAlign: 'center' }, statusFinished: { color: '#23613a', backgroundColor: '#dff3e5' }, statusLive: { color: '#075d70', backgroundColor: '#dff5f9' }, statusDanger: { color: '#9b2730', backgroundColor: '#ffe5e7' }, details: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 }, detail: { width: '47%', flexGrow: 1, borderRadius: 9, backgroundColor: '#eef2f3', padding: 8 }, detailLabel: { color: '#78858b', fontSize: 8, fontWeight: '800' }, detailValue: { color: '#263238', fontSize: 10, fontWeight: '900', marginTop: 3 }, cutoff: { alignSelf: 'flex-start', color: '#59666c', backgroundColor: '#e8edef', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5, marginTop: 8, overflow: 'hidden', fontSize: 8, fontWeight: '900' }, cutoffSafe: { color: '#23613a', backgroundColor: '#dff3e5' }, cutoffWatch: { color: '#875f08', backgroundColor: '#fff0bf' }, cutoffDanger: { color: '#9b2730', backgroundColor: '#ffe5e7' },
});
