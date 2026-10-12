import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardSafeScrollView } from './KeyboardSafeScrollView';
import { RoleErrorBoundary } from './RoleErrorBoundary';
import {
  ActivityIndicator, Alert, Image, Keyboard, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, View,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { apiRequest } from '../api';
import type { Assignment, ContestGunStart, ManualTimingStamp, Participant, ParticipantSearch, VolunteerBandTarget, VolunteerModule, VolunteerOperationsOverview, VolunteerOperationsOverviewLog, VolunteerSession } from '../types';
import { CutoffTimeScreen } from './CutoffTimeScreen';
import { FinishLineScreen } from './FinishLineScreen';
import volunteerLogo from '../../RACE UPSHOT VOLUYNTEER APP LOGO.png';

const moduleCopy: Record<VolunteerModule, { label: string; icon: string; detail: string }> = {
  ATHLETE_LOOKUP: { label: 'Athlete Lookup', icon: '⌕', detail: 'Search and verify athlete identity.' },
  WAIVER_CHECK_IN: { label: 'Waiver & Athlete Band', icon: '✓', detail: 'Verify identity and waiver, assign the athlete band, then complete check-in.' },
  ATHLETE_CHECK_IN: { label: 'Waiver & Athlete Band', icon: '✓', detail: 'Verify identity and waiver, assign the athlete band, then complete check-in.' },
  BIKE_CHECK_IN: { label: 'Bike Check-In', icon: '▱', detail: 'Record bike/rack entry. Helmet status is optional.' },
  BIKE_CHECK_OUT: { label: 'Bike Check-Out', icon: '↗', detail: 'Release only a currently checked-in bike.' },
  MEDAL_COUNTER: { label: 'Finisher Medal / Goodies', icon: '★', detail: 'Record one medal / goodies bundle per athlete.' },
  FOOD_COUNTER: { label: 'Food Counter', icon: '◉', detail: 'Record one food issuance per athlete.' },
  LOCKER_COUNTER: { label: 'Locker Counter', icon: '▦', detail: 'Assign or update athlete locker number.' },
  COUNTER: { label: 'Counter', icon: '#', detail: 'Scan and identify athletes at your assigned counter station.' },
  FINISH_LINE_VOLUNTEER: { label: 'Finish Line Volunteer', icon: '⚑', detail: 'Monitor athletes racing, course-leg counts and official finish logs.' },
  CUTOFF_TIME_VOLUNTEER: { label: 'Cutoff Time Volunteer', icon: '⌛', detail: 'Monitor athletes within, approaching or outside cutoff, including DNF.' },
  TIMING_CHIP_ASSIGNMENT_COUNTER: { label: 'Timing Chip Assignment', icon: '◌', detail: 'First search by BIB or scan the athlete band. Then scan or type the timing chip code.' },
  ATHLETE_BAND_ASSIGNMENT_COUNTER: { label: 'Athlete Band Assignment', icon: '▭', detail: 'Search the athlete, then scan or enter the athlete band code.' },
  VOLUNTEER_BAND_ASSIGNMENT_COUNTER: { label: 'Volunteer Band Assignment', icon: '◇', detail: 'Search an event volunteer, then scan or enter the volunteer band code.' },
  MANUAL_TIMING: { label: 'Timekeeper', icon: '◷', detail: 'Stamp the finish using the assigned point or automatic manual gun time.' },
};

type ActionName = 'CHECK_IN' | 'BIKE_IN' | 'BIKE_OUT' | 'MEDAL_ISSUE' | 'FOOD_ISSUE' | 'LOCKER_ASSIGN';
type WaiverSearchMode = 'BIB Number' | 'Registration ID' | 'Athlete Band' | 'Name' | 'Email' | 'Mobile';
type ChipSearchMode = 'BIB Number' | 'Athlete Band';
type OperationsLogKey = 'check-in' | 'bike-in' | 'bike-out' | 'chip';

function formatted(value: string | null): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function timeOfDay(value: Date): string {
  const wholeSeconds = value.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return `${wholeSeconds}.${String(value.getMilliseconds()).padStart(3, '0')}`;
}

function calendarDay(value: Date): string {
  return value.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

function feibotGunTime(value: string | null): string {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return 'NOT SET';
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  }).format(date).toUpperCase();
}

function initials(value: string): string {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || 'A';
}

function isMinorAtEvent(participant: Participant, eventDate?: string | null): boolean {
  const birth = new Date(participant.dateOfBirth || '');
  const event = new Date(eventDate || Date.now());
  if (Number.isNaN(birth.getTime()) || Number.isNaN(event.getTime())) return false;
  let age = event.getUTCFullYear() - birth.getUTCFullYear();
  if (event.getUTCMonth() < birth.getUTCMonth() || (event.getUTCMonth() === birth.getUTCMonth() && event.getUTCDate() < birth.getUTCDate())) age -= 1;
  return age < 18;
}

function recordedBikeRack(value: string | null | undefined): string | null {
  const rack = value?.trim() || '';
  return rack && !['no', 'none', 'not assigned', 'n/a', 'na', '-'].includes(rack.toLowerCase()) ? rack : null;
}

function displayedBikeRack(participant: Participant): string | null {
  return participant.assignedBikeRack?.trim() || recordedBikeRack(participant.state.bikeRack);
}

function searchedBandCode(value: string): string {
  const raw = value.trim();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const key of ['athleteBandCode', 'athlete_band_code', 'athleteBand', 'bandCode']) {
      if (typeof parsed[key] === 'string' && parsed[key].trim()) return parsed[key].trim();
    }
  } catch { /* A plain band code or QR URL needs no JSON parsing. */ }
  if (/^https?:\/\//i.test(raw)) {
    try { return decodeURIComponent(raw.split('/').filter(Boolean).at(-1) || raw); }
    catch { return raw; }
  }
  return raw;
}

function activeStatus(participant: Participant, module: VolunteerModule): { label: string; done: boolean } {
  const state = participant.state;
  if (module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') return { label: state.checkedInAt ? 'CHECKED IN' : 'NOT CHECKED IN', done: Boolean(state.checkedInAt) };
  if (module === 'BIKE_CHECK_IN') return { label: state.bikeCheckedInAt ? 'CHECK-IN COMPLETE' : 'BIKE NOT IN', done: Boolean(state.bikeCheckedInAt) };
  if (module === 'BIKE_CHECK_OUT') return { label: state.bikeCheckedOutAt ? 'BIKE OUT' : state.bikeCheckedInAt ? 'READY TO RELEASE' : 'NO BIKE IN', done: Boolean(state.bikeCheckedOutAt) };
  if (module === 'MEDAL_COUNTER') return { label: state.medalIssuedAt ? 'GOODIES ISSUED' : 'READY TO ISSUE', done: Boolean(state.medalIssuedAt) };
  if (module === 'FOOD_COUNTER') return { label: state.foodIssuedAt ? 'FOOD ISSUED' : 'NOT ISSUED', done: Boolean(state.foodIssuedAt) };
  if (module === 'LOCKER_COUNTER') return { label: state.lockerNumber ? `LOCKER ${state.lockerNumber}` : 'NO LOCKER', done: Boolean(state.lockerNumber) };
  if (module === 'ATHLETE_LOOKUP') {
    const status = participant.registrationStatus?.trim().toUpperCase() || 'UNKNOWN';
    return { label: status === 'UNKNOWN' ? 'REGISTRATION UNKNOWN' : status.replace(/_/g, ' '), done: ['ACTIVE', 'CONFIRMED', 'REGISTERED'].includes(status) };
  }
  return { label: participant.raceStatus.replace(/_/g, ' '), done: participant.raceStatus === 'FINISHED' };
}

function isConfirmedFact(participant: Participant, label: string): boolean {
  const state = participant.state;
  switch (label) {
    case 'Waiver status': return Boolean(state.waiverVerifiedAt);
    case 'Check-in': return Boolean(state.checkedInAt);
    case 'Bike check-in': return Boolean(state.bikeCheckedInAt);
    case 'Bike check-out': return Boolean(state.bikeCheckedOutAt);
    case 'Bike status': return Boolean(state.bikeCheckedInAt || state.bikeCheckedOutAt);
    case 'Athlete band': return Boolean(participant.athleteBandCode);
    case 'Timing chip': return Boolean(participant.chipCode);
    case 'Medal / goodies': return Boolean(state.medalIssuedAt);
    default: return false;
  }
}

function Scanner({ title, onScanned, onClose }: { title: string; onScanned: (value: string) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  function scan(result: BarcodeScanningResult) {
    if (locked) return;
    setLocked(true);
    onScanned(result.data);
  }
  return <View style={styles.scannerShell}>
    {permission?.granted ? <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13'] }} onBarcodeScanned={scan} /> : null}
    <View style={[styles.scannerTop, { paddingTop: insets.top + 10 }]}><Text style={styles.scannerTitle}>{title}</Text><Pressable onPress={onClose} style={styles.scannerClose}><Text style={styles.scannerCloseText}>Close</Text></Pressable></View>
    <View style={styles.scanFrame} />
    {!permission?.granted ? <View style={styles.permissionCard}><Text style={styles.permissionTitle}>Camera access required</Text><Text style={styles.permissionText}>Camera access is used only to scan athlete QR and barcode labels.</Text><Pressable style={styles.primaryButton} onPress={() => void requestPermission()}><Text style={styles.primaryButtonText}>Allow camera</Text></Pressable></View> : <Text style={styles.scannerHint}>Hold the code inside the frame</Text>}
  </View>;
}

export function DashboardScreen({ session, onRefreshSession, onOpenAthleteProfile, onLogout }: { session: VolunteerSession; onRefreshSession: () => Promise<void>; onOpenAthleteProfile?: () => Promise<void>; onLogout: () => Promise<void> }) {
  const searchInputRef = useRef<TextInput>(null);
  const [assignmentId, setAssignmentId] = useState(session.assignments[0]?.id || '');
  const assignment = session.assignments.find((item) => item.id === assignmentId) || session.assignments[0];
  const [module, setModule] = useState<VolunteerModule>(assignment?.modules[0] || 'ATHLETE_LOOKUP');
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchData, setSearchData] = useState<ParticipantSearch | null>(null);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<'athlete-search' | 'assignment-code' | 'waiver-band-code'>('athlete-search');
  const [assignmentCode, setAssignmentCode] = useState('');
  const [waiverSearchMode, setWaiverSearchMode] = useState<WaiverSearchMode>('BIB Number');
  const [waiverOtpParticipantId, setWaiverOtpParticipantId] = useState<string | null>(null);
  const [waiverOtp, setWaiverOtp] = useState('');
  const [selectedRegistrationIds, setSelectedRegistrationIds] = useState<string[]>([]);
  const [signerName, setSignerName] = useState('');
  const [signerRelationship, setSignerRelationship] = useState('');
  const [chipSearchMode, setChipSearchMode] = useState<ChipSearchMode>('BIB Number');
  const [bandAssignmentParticipant, setBandAssignmentParticipant] = useState<Participant | null>(null);
  const [bandAssignmentOpen, setBandAssignmentOpen] = useState(false);
  const [volunteerQuery, setVolunteerQuery] = useState('');
  const [volunteerTargets, setVolunteerTargets] = useState<VolunteerBandTarget[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [helmetChecked, setHelmetChecked] = useState(false);
  const [bikeRack, setBikeRack] = useState('');
  const [lockerNumber, setLockerNumber] = useState('');
  const [timingPointId, setTimingPointId] = useState(assignment?.timingPointIds[0] || '');
  const [bibKeyboard, setBibKeyboard] = useState<'numeric' | 'text'>('numeric');
  const [recentTiming, setRecentTiming] = useState<ManualTimingStamp[]>([]);
  const [contestGunStarts, setContestGunStarts] = useState<ContestGunStart[]>([]);
  const [recentTimingLoading, setRecentTimingLoading] = useState(false);
  const [resettingTimingId, setResettingTimingId] = useState<string | null>(null);
  const [operationsOverview, setOperationsOverview] = useState<VolunteerOperationsOverview | null>(null);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [operationsError, setOperationsError] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<OperationsLogKey | 'none' | null>(null);
  const [chipOwner, setChipOwner] = useState<Participant | null>(null);
  const [chipOwnerLoading, setChipOwnerLoading] = useState(false);
  const [deviceNow, setDeviceNow] = useState(() => new Date());
  const deviceTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Device local time', []);

  async function openAthleteProfile() {
    if (!onOpenAthleteProfile) return;
    setError(null);
    try {
      await onOpenAthleteProfile();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to open the athlete profile.');
    }
  }

  useEffect(() => {
    const timer = setInterval(() => setDeviceNow(new Date()), 250);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const eventId = assignment?.eventId;
    if (module !== 'MANUAL_TIMING' || !eventId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setRecentTimingLoading(true);
      try {
        const data = await apiRequest<{ recent: ManualTimingStamp[]; contestGunStarts: ContestGunStart[] }>(`/api/mobile/volunteer/manual-timing?eventId=${encodeURIComponent(eventId)}`);
        if (active) {
          setRecentTiming(data.recent);
          setContestGunStarts(data.contestGunStarts || []);
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Recent timing stamps could not be loaded.');
      } finally {
        if (active) setRecentTimingLoading(false);
      }
    })();
    return () => { active = false; };
  }, [assignment?.eventId, module]);

  const showsOperationsOverview = module === 'WAIVER_CHECK_IN'
    || module === 'ATHLETE_CHECK_IN'
    || module === 'BIKE_CHECK_IN'
    || module === 'BIKE_CHECK_OUT'
    || module === 'TIMING_CHIP_ASSIGNMENT_COUNTER';

  useEffect(() => {
    const eventId = assignment?.eventId;
    if (!eventId || !showsOperationsOverview) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setOperationsLoading(true);
      setOperationsError(null);
      try {
        const data = await apiRequest<VolunteerOperationsOverview>(`/api/mobile/volunteer/operations-overview?eventId=${encodeURIComponent(eventId)}`);
        if (active) setOperationsOverview(data);
      } catch (caught) {
        if (active) setOperationsError(caught instanceof TypeError ? 'Event Operations is not available on the connected server yet. Deploy the latest backend, then refresh.' : caught instanceof Error ? caught.message : 'Operation totals could not be loaded.');
      } finally {
        if (active) setOperationsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [assignment?.eventId, module, showsOperationsOverview]);

  useEffect(() => {
    const eventId = assignment?.eventId;
    const code = assignmentCode.trim();
    if (module !== 'TIMING_CHIP_ASSIGNMENT_COUNTER' || !eventId || code.length < 2) return;
    let active = true;
    const timer = setTimeout(() => {
      setChipOwnerLoading(true);
      void apiRequest<ParticipantSearch>(`/api/mobile/volunteer/participants?eventId=${encodeURIComponent(eventId)}&query=${encodeURIComponent(code)}`)
        .then((data) => {
          if (!active) return;
          setChipOwner(data.participants.find((participant) => participant.chipCode.toUpperCase() === code.toUpperCase()) ?? null);
        })
        .catch(() => { if (active) setChipOwner(null); })
        .finally(() => { if (active) setChipOwnerLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [assignment?.eventId, assignmentCode, module]);

  const roles = useMemo(() => [...new Set((assignment?.modules || []).map((role) => role === 'WAIVER_CHECK_IN' ? 'ATHLETE_CHECK_IN' : role))], [assignment]);
  if (!assignment) return <View style={styles.center}><Text style={styles.errorText}>No active event assignment.</Text></View>;
  const selectedTimingPointId = assignment.timingPointIds.includes(timingPointId) ? timingPointId : assignment.timingPointIds[0] || '';
  const searchedRelayTeam = searchData?.participants.find((participant) => participant.relayTeam)?.relayTeam;

  async function refreshOperationsOverview(eventId = assignment.eventId, silent = false) {
    if (!showsOperationsOverview) return;
    if (!silent) setOperationsLoading(true);
    setOperationsError(null);
    try {
      setOperationsOverview(await apiRequest<VolunteerOperationsOverview>(`/api/mobile/volunteer/operations-overview?eventId=${encodeURIComponent(eventId)}`));
    } catch (caught) {
      if (!silent) setOperationsError(caught instanceof TypeError ? 'Event Operations is not available on the connected server yet. Deploy the latest backend, then refresh.' : caught instanceof Error ? caught.message : 'Operation totals could not be loaded.');
    } finally {
      if (!silent) setOperationsLoading(false);
    }
  }

  function chooseAssignment(next: Assignment) {
    setAssignmentId(next.id);
    setModule(next.modules[0] || 'ATHLETE_LOOKUP');
    setRoleMenuOpen(false);
    setTimingPointId(next.timingPointIds[0] || '');
    setQuery(''); setSearchData(null); setMessage(null); setError(null); setWaiverOtpParticipantId(null); setWaiverOtp(''); setSelectedRegistrationIds([]); setSignerName(''); setSignerRelationship(''); setBikeRack(''); setOperationsOverview(null); setExpandedLog(null);
  }

  async function search(value = query) {
    const normalized = value.trim();
    if (!normalized) {
      setError(module === 'TIMING_CHIP_ASSIGNMENT_COUNTER'
        ? 'Enter a BIB or scan the athlete band.'
        : module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN'
          ? 'Enter a BIB number, name, email or mobile.'
          : 'Enter or scan a BIB, athlete band, chip, name, email or participant ID.');
      return;
    }
    if (module === 'TIMING_CHIP_ASSIGNMENT_COUNTER') { setAssignmentCode(''); setChipOwner(null); setChipOwnerLoading(false); }
    setSearching(true); setError(null); setMessage(null); setBikeRack('');
    try {
      const bikeRackQuery = module === 'BIKE_CHECK_IN' || module === 'BIKE_CHECK_OUT' ? '&rack=1' : '';
      const data = await apiRequest<ParticipantSearch>(`/api/mobile/volunteer/participants?eventId=${encodeURIComponent(assignment.eventId)}&query=${encodeURIComponent(normalized)}${bikeRackQuery}`);
      setSearchData(data);
      const firstProfile = data.participantProfiles?.[0];
      const eligible = (firstProfile?.registrations || data.participants.slice(0, 1)).filter((registration) => !registration.state.waiverVerifiedAt);
      setSelectedRegistrationIds(data.event.waiverPolicy?.consolidatedWaiverEnabled ? eligible.map((registration) => registration.registrationId) : eligible.slice(0, 1).map((registration) => registration.registrationId));
      const exactBandMatch = data.participants.find((participant) => participant.athleteBandCode.toLowerCase() === searchedBandCode(normalized).toLowerCase()) ?? null;
      if (exactBandMatch?.bib) {
        setQuery(exactBandMatch.bib);
        if (module === 'TIMING_CHIP_ASSIGNMENT_COUNTER') setChipSearchMode('BIB Number');
      }
      if (!data.participants.length) setMessage('No athlete matched this assigned event.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Athlete search failed.'); }
    finally { setSearching(false); }
  }

  function replaceParticipant(updated: Participant) {
    setSearchData((current) => current ? { ...current, participants: current.participants.map((item) => item.id === updated.id ? updated : item), participantProfiles: current.participantProfiles.map((profile) => ({ ...profile, registrations: profile.registrations.map((item) => item.id === updated.id ? updated : item) })) } : current);
  }

  function replaceParticipants(updated: Participant[]) {
    const byId = new Map(updated.map((participant) => [participant.id, participant]));
    setSearchData((current) => current ? { ...current, participants: current.participants.map((item) => byId.get(item.id) || item), participantProfiles: current.participantProfiles.map((profile) => ({ ...profile, registrations: profile.registrations.map((item) => byId.get(item.id) || item) })) } : current);
  }

  function openBandAssignment(participant: Participant) {
    setAssignmentCode('');
    setBandAssignmentParticipant(participant);
    setBandAssignmentOpen(true);
    setError(null);
  }

  async function assignEquipment(participant: Participant) {
    const kind = module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' ? 'chip' : 'athlete-band';
    if (!assignmentCode.trim()) { setError(`Scan or enter the ${kind === 'chip' ? 'timing chip' : 'athlete band'} code.`); return; }
    setBusyId(participant.id); setError(null); setMessage(null);
    try {
      const updated = await apiRequest<Participant>('/api/mobile/volunteer/equipment-assignment', {
        method: 'POST', body: JSON.stringify({ eventId: assignment.eventId, participantId: participant.id, kind, code: assignmentCode }),
      });
      replaceParticipant(updated); setAssignmentCode(''); setChipOwner(null); setChipOwnerLoading(false);
      if (module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') {
        setBandAssignmentOpen(false);
        setBandAssignmentParticipant(null);
      }
      setMessage(`${participant.name}: ${kind === 'chip' ? 'timing chip' : 'athlete band'} ${kind === 'chip' ? updated.chipCode : updated.athleteBandCode} assigned.`);
      void refreshOperationsOverview(assignment.eventId, true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The assignment could not be saved.'); }
    finally { setBusyId(null); }
  }

  async function searchVolunteerTargets() {
    const normalized = volunteerQuery.trim();
    if (!normalized) { setError('Enter a volunteer name, email, mobile or ID.'); return; }
    setSearching(true); setError(null); setMessage(null);
    try {
      const data = await apiRequest<{ volunteers: VolunteerBandTarget[] }>(`/api/mobile/volunteer/volunteer-bands?eventId=${encodeURIComponent(assignment.eventId)}&query=${encodeURIComponent(normalized)}`);
      setVolunteerTargets(data.volunteers);
      if (!data.volunteers.length) setMessage('No volunteer matched this assigned event.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Volunteer search failed.'); }
    finally { setSearching(false); }
  }

  async function saveVolunteerBand(target: VolunteerBandTarget) {
    if (!assignmentCode.trim()) { setError('Scan or enter the volunteer band code.'); return; }
    setBusyId(target.id); setError(null); setMessage(null);
    try {
      const updated = await apiRequest<VolunteerBandTarget>('/api/mobile/volunteer/volunteer-bands', {
        method: 'POST', body: JSON.stringify({ eventId: assignment.eventId, volunteerId: target.id, bandCode: assignmentCode }),
      });
      setVolunteerTargets((current) => current.map((row) => row.id === updated.id ? updated : row));
      setAssignmentCode(''); setMessage(`${target.name}: volunteer band ${updated.bandCode} assigned.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Volunteer band assignment failed.'); }
    finally { setBusyId(null); }
  }

  async function runAction(participant: Participant, action: ActionName, confirmedHelmetCheck = helmetChecked) {
    setBusyId(participant.id); setError(null); setMessage(null);
    try {
      const updated = await apiRequest<Participant>('/api/mobile/volunteer/actions', {
        method: 'POST',
        body: JSON.stringify({ eventId: assignment.eventId, participantId: participant.id, action, helmetChecked: confirmedHelmetCheck, bikeRack: action === 'BIKE_IN' ? participant.assignedBikeRack || bikeRack : bikeRack, lockerNumber }),
      });
      replaceParticipant(updated);
      setMessage(`${participant.name}: ${action.replace(/_/g, ' ').toLowerCase()} recorded.`);
      if (action === 'BIKE_IN') { setHelmetChecked(false); setBikeRack(''); }
      if (action === 'LOCKER_ASSIGN') setLockerNumber('');
      void refreshOperationsOverview(assignment.eventId, true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The action could not be recorded.'); }
    finally { setBusyId(null); }
  }

  async function checkInAll(profileParticipantId: string) {
    setBusyId(profileParticipantId); setError(null); setMessage(null);
    try {
      const result = await apiRequest<{ participants: Participant[] }>('/api/mobile/volunteer/actions/check-in-all', { method: 'POST', body: JSON.stringify({ eventId: assignment.eventId, participantId: profileParticipantId }) });
      replaceParticipants(result.participants);
      setMessage(`${result.participants.length} eligible registration${result.participants.length === 1 ? '' : 's'} checked in.`);
      void refreshOperationsOverview(assignment.eventId, true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The registrations could not be checked in.'); }
    finally { setBusyId(null); }
  }

  async function sendWaiverOtp(participant: Participant) {
    setBusyId(participant.id); setError(null); setMessage(null);
    try {
      const selectedForProfile = selectedRegistrationIds.filter((id) => searchData?.participants.some((row) => row.participantId === participant.participantId && row.registrationId === id));
      const result = await apiRequest<{ sent: boolean; email: string; expiresInSeconds: number; message: string }>('/api/mobile/volunteer/waiver-otp/request', {
        method: 'POST', body: JSON.stringify({ eventId: assignment.eventId, participantId: participant.id, registrationIds: selectedForProfile.length ? selectedForProfile : [participant.registrationId] }),
      });
      setWaiverOtpParticipantId(participant.id);
      setWaiverOtp('');
      setSignerName(participant.name);
      setSignerRelationship('SELF');
      setMessage(result.message);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The waiver OTP could not be sent.'); }
    finally { setBusyId(null); }
  }

  async function verifyWaiverOtp(participant: Participant) {
    if (!/^\d{6}$/.test(waiverOtp)) { setError('Enter the complete six-digit OTP from the athlete’s email.'); return; }
    setBusyId(participant.id); setError(null); setMessage(null);
    try {
      const selectedForProfile = selectedRegistrationIds.filter((id) => searchData?.participants.some((row) => row.participantId === participant.participantId && row.registrationId === id));
      const result = await apiRequest<{ waiverId: string; coveredRegistrationIds: string[]; participants: Participant[] }>('/api/mobile/volunteer/waiver-otp/verify', {
        method: 'POST', body: JSON.stringify({ eventId: assignment.eventId, participantId: participant.id, registrationIds: selectedForProfile.length ? selectedForProfile : [participant.registrationId], otp: waiverOtp, signerName: signerName || participant.name, signerRelationship: signerRelationship || 'SELF' }),
      });
      replaceParticipants(result.participants);
      setWaiverOtpParticipantId(null);
      setWaiverOtp('');
      setSelectedRegistrationIds([]);
      setMessage(`${participant.name}: waiver successfully signed for ${result.coveredRegistrationIds.length} registration${result.coveredRegistrationIds.length === 1 ? '' : 's'}. Check-in remains pending for each registration.`);
      void refreshOperationsOverview(assignment.eventId, true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The OTP could not be verified.'); }
    finally { setBusyId(null); }
  }

  function confirmAction(participant: Participant, action: ActionName, label: string) {
    Alert.alert(label, `${participant.name} · BIB ${participant.bib || '—'}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => void runAction(participant, action) },
    ]);
  }

  function confirmBikeEntry(participant: Participant) {
    if (participant.state.bikeCheckedInAt) {
      Alert.alert('Bike check-in already completed', `${participant.name} · BIB ${participant.bib || '—'} already has a bike check-in record. Only an administrator can reset it.`);
      return;
    }
    Alert.alert('Check bike in?', `${participant.name} · BIB ${participant.bib || '—'}\nRack: ${participant.assignedBikeRack || bikeRack.trim() || 'Not assigned'}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => void runAction(participant, 'BIKE_IN') },
    ]);
  }

  function confirmBikeCheckout(participant: Participant) {
    if (!participant.state.bikeCheckedInAt) {
      Alert.alert('Bike entry required', `${participant.name} · BIB ${participant.bib || '—'} has no bike check-in recorded for this event. Record or reconcile bike entry before checkout.`);
      return;
    }
    if (participant.state.bikeCheckedOutAt) {
      Alert.alert('Bike already checked out', `${participant.name} · BIB ${participant.bib || '—'} has already collected the bike.`);
      return;
    }
    confirmAction(participant, 'BIKE_OUT', 'Release checked-in bike?');
  }

  async function openIdProof(participant: Participant) {
    const url = participant.idProofUrl?.trim() || '';
    if (!/^https?:\/\//i.test(url)) { Alert.alert('ID proof unavailable', 'No valid ID proof link is attached to this athlete.'); return; }
    try { await Linking.openURL(url); }
    catch { Alert.alert('Could not open ID proof', 'Check the connection and try again.'); }
  }

  function participantFacts(participant: Participant): Array<[string, string]> {
    const waiverStatus = participant.state.waiverVerifiedAt ? 'Verified' : '✕ NOT VERIFIED';
    const raceStatus = participant.raceStatus.replace(/_/g, ' ') || 'Unknown';
    if (module === 'ATHLETE_LOOKUP') {
      const emergencyContact = [participant.emergencyContactName, participant.emergencyContact].filter(Boolean).join(' · ') || 'Not recorded';
      const address = [participant.address, participant.city, participant.stateName, participant.pincode, participant.country].filter(Boolean).join(', ') || 'Not recorded';
      return [
        ['Registration status', participant.registrationStatus || 'Not recorded'],
        ['Email', participant.email || 'Not recorded'],
        ['Mobile', participant.mobile || 'Not recorded'],
        ['Emergency contact', emergencyContact],
        ['Blood group', participant.bloodGroup || 'Not recorded'],
        ['Address', address],
        ['T-shirt size', participant.tshirtSize || 'Not recorded'],
        ['Athlete band', participant.athleteBandCode || 'Not assigned'],
        ['Timing chip', participant.chipCode || 'Not assigned'],
        ['Waiver status', waiverStatus],
        ['Check-in', participant.state.checkedInAt ? 'Done' : 'Pending'],
        ['Bike status', participant.state.bikeCheckedOutAt ? 'Checked out' : participant.state.bikeCheckedInAt ? `Checked in${participant.state.bikeRack ? ` · ${participant.state.bikeRack}` : ''}` : 'Not checked in'],
        ['Updated', formatted(participant.state.updatedAt)],
      ];
    }
    if (module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') return [
      ['BIB', participant.bib || 'Not assigned'],
      ['Athlete band', participant.athleteBandCode || 'Not assigned'],
      ['Category', participant.category || 'Not assigned'],
      ['Waiver status', waiverStatus],
      ['ID proof', participant.idProofUrl ? 'Available' : 'Not uploaded'],
    ];
    if (module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' || module === 'ATHLETE_BAND_ASSIGNMENT_COUNTER') return [
      ['Athlete band', participant.athleteBandCode || 'Not assigned'],
      ['Timing chip', participant.chipCode || 'Not assigned'],
      ['Category', participant.category || 'Not assigned'],
      ['Race status', raceStatus],
    ];
    if (module === 'BIKE_CHECK_IN' || module === 'BIKE_CHECK_OUT') return [
      ['Event', assignment.eventName],
      ['Category', participant.category || 'Not assigned'],
      ['Waiver status', waiverStatus],
      ['Bike rack', displayedBikeRack(participant) || 'Not assigned'],
      ['Bike check-in', participant.state.bikeCheckedInAt ? `Done · ${formatted(participant.state.bikeCheckedInAt)}` : 'Pending'],
      ['Bike check-out', participant.state.bikeCheckedOutAt ? `Done · ${formatted(participant.state.bikeCheckedOutAt)}` : 'Pending'],
    ];
    if (module === 'MEDAL_COUNTER') return [
      ['T-shirt size', participant.tshirtSize || 'Not recorded'],
      ['Waiver status', waiverStatus],
      ['Race status', raceStatus],
      ['Medal / goodies', participant.state.medalIssuedAt ? `Issued · ${formatted(participant.state.medalIssuedAt)}` : 'Not issued'],
    ];
    return [
      ['Athlete band', participant.athleteBandCode || 'Not assigned'],
      ['Timing chip', participant.chipCode || 'Not assigned'],
      ['Waiver status', waiverStatus],
      ['Check-in', participant.state.checkedInAt ? 'Done' : 'Pending'],
      ['Bike status', participant.state.bikeCheckedOutAt ? 'Checked out' : participant.state.bikeCheckedInAt ? `Checked in${participant.state.bikeRack ? ` · ${participant.state.bikeRack}` : ''}` : 'Not checked in'],
      ['Updated', formatted(participant.state.updatedAt)],
    ];
  }

  async function refreshRecentTiming(eventId = assignment.eventId, silent = false) {
    if (!silent) setRecentTimingLoading(true);
    try {
      const data = await apiRequest<{ recent: ManualTimingStamp[]; contestGunStarts: ContestGunStart[] }>(`/api/mobile/volunteer/manual-timing?eventId=${encodeURIComponent(eventId)}`);
      setContestGunStarts(data.contestGunStarts || []);
      if (silent) {
        setRecentTiming((current) => {
          const refreshedIds = new Set(data.recent.map((row) => row.id));
          return [...data.recent, ...current.filter((row) => !refreshedIds.has(row.id))].slice(0, 50);
        });
      } else {
        setRecentTiming(data.recent);
      }
    } catch (caught) {
      if (!silent) setError(caught instanceof Error ? caught.message : 'Recent timing stamps could not be loaded.');
    }
    finally { if (!silent) setRecentTimingLoading(false); }
  }

  async function stampManualTiming() {
    const bib = query.trim();
    if (!bib) { setError('Enter a BIB number.'); return; }
    if (assignment.timingScope !== 'AUTO' && !selectedTimingPointId) { setError('Choose an assigned timing point.'); return; }
    const deviceCapturedAt = new Date().toISOString();
    setBusyId('manual-timing'); setError(null); setMessage(null);
    try {
      const result = await apiRequest<{ id: string; participant: Participant; timingPointName: string; capturedAt: string; timingMode: 'GUN' | 'TIMING_POINT'; gunTime: string | null }>('/api/mobile/volunteer/manual-timing', {
        method: 'POST',
        body: JSON.stringify({ eventId: assignment.eventId, participantId: bib, ...(selectedTimingPointId ? { timingPointId: selectedTimingPointId } : {}), capturedAt: deviceCapturedAt }),
      });
      setQuery('');
      const confirmedStamp: ManualTimingStamp = {
        id: result.id,
        bib: result.participant.bib || bib,
        athleteName: result.participant.name,
        timingPointName: result.timingPointName,
        timingMode: result.timingMode,
        gunTime: result.gunTime,
        capturedAt: result.capturedAt,
        status: result.gunTime ? 'RECORDED' : result.timingMode === 'GUN' ? 'RECORDED · GUN START REQUIRED' : 'RECORDED',
      };
      setRecentTiming((current) => [confirmedStamp, ...current.filter((row) => row.id !== confirmedStamp.id)].slice(0, 50));
      setMessage(`BIB ${result.participant.bib || bib} stamped at ${timeOfDay(new Date(result.capturedAt))}${result.gunTime ? ` · Gun ${result.gunTime}` : result.timingMode === 'GUN' ? ' · Gun start pending' : ''}`);
      void refreshRecentTiming(assignment.eventId, true);
      setTimeout(() => searchInputRef.current?.focus(), 0);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Timing read could not be recorded.'); }
    finally { setBusyId(null); }
  }

  function confirmResetTiming(row: ManualTimingStamp) {
    Alert.alert('Reset timing stamp?', `BIB ${row.bib || '—'} · ${timeOfDay(new Date(row.capturedAt))}\nThe original audit record will be preserved.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => void resetTiming(row) },
    ]);
  }

  async function resetTiming(row: ManualTimingStamp) {
    setResettingTimingId(row.id); setError(null); setMessage(null);
    try {
      await apiRequest(`/api/mobile/volunteer/manual-timing?eventId=${encodeURIComponent(assignment.eventId)}&operationId=${encodeURIComponent(row.id)}`, { method: 'DELETE' });
      setRecentTiming((current) => current.filter((item) => item.id !== row.id));
      setMessage(`BIB ${row.bib || '—'} timing stamp reset. Original audit record preserved.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Timing stamp could not be reset.'); }
    finally { setResettingTimingId(null); }
  }

  function operationsLogSection(title: string, key: OperationsLogKey, rows: VolunteerOperationsOverviewLog[]) {
    const expanded = expandedLog === key;
    return <View style={styles.operationsLogSection}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpandedLog(expanded ? 'none' : key)} style={styles.operationsLogHeader}>
        <View><Text style={styles.operationsLogTitle}>{title}</Text><Text style={styles.operationsLogCount}>{rows.length} recent record{rows.length === 1 ? '' : 's'}</Text></View>
        <View style={styles.operationsLogButton}><Text style={styles.operationsLogButtonText}>{expanded ? 'HIDE LOGS' : 'SHOW LOGS'}</Text></View>
      </Pressable>
      {expanded ? rows.length === 0 ? <Text style={styles.operationsLogEmpty}>No records for this event yet.</Text> : rows.map((row) => <View key={row.id} style={styles.operationsLogRow}>
        <View style={styles.operationsLogIdentity}><Text style={styles.operationsLogBib}>BIB {row.bib || '—'}</Text><Text style={styles.operationsLogName}>{row.athleteName || 'Athlete'}</Text></View>
        {row.action === 'TIMING_CHIP_ASSIGNED' ? <Text style={styles.operationsLogChip}>Timing chip assigned: {row.status || 'Not recorded'}</Text> : null}
        <Text style={styles.operationsLogMeta}>{formatted(row.capturedAt)}{row.bikeRack ? ` · Rack ${row.bikeRack}` : ''}{row.action !== 'TIMING_CHIP_ASSIGNED' && row.status ? ` · ${row.status}` : ''}{row.volunteerName ? `\n${row.volunteerName}` : ''}</Text>
      </View>) : null}
    </View>;
  }

  function operationsOverviewPanel() {
    if (!showsOperationsOverview) return null;
    const overview = operationsOverview;
    const stats = module === 'TIMING_CHIP_ASSIGNMENT_COUNTER'
      ? [['TOTAL PARTICIPANTS', overview?.totalAthletes], ['BIKE-IN RECORDED', overview?.bikesEverCheckedIn], ['CHIPS ASSIGNED TO BIKE-INS', overview?.chipsAssignedToBikeEntries], ['BIKE-INS NEEDING CHIP', overview?.remainingToAssignFromBikeEntries]] as const
      : module === 'BIKE_CHECK_IN'
        ? [['TOTAL PARTICIPANTS', overview?.totalAthletes], ['WAIVER COMPLETED', overview?.waiverCompletedAthletes], ['BIKES CHECKED IN', overview?.bikesEverCheckedIn], ['WAIVERED BIKES REMAINING', overview?.remainingToBikeCheckIn]] as const
        : module === 'BIKE_CHECK_OUT'
          ? [['BIKES CHECKED IN (TOTAL)', overview?.bikesEverCheckedIn], ['BIKES CHECKED OUT', overview?.bikesCheckedOut], ['REMAINING TO CHECK OUT', overview?.remainingToBikeCheckOut]] as const
          : [['TOTAL PARTICIPANTS', overview?.totalAthletes], ['PARTICIPANTS CHECKED IN', overview?.checkedInAthletes], ['REMAINING TO CHECK IN', overview?.remainingToCheckIn]] as const;
    return <View style={styles.operationsPanel}>
      <View style={styles.operationsPanelHeader}><Text style={styles.operationsPanelTitle}>EVENT OPERATIONS</Text><Pressable disabled={operationsLoading} onPress={() => void refreshOperationsOverview()} style={styles.operationsRefresh}><Text style={styles.operationsRefreshText}>{operationsLoading ? 'LOADING…' : 'REFRESH'}</Text></Pressable></View>
      <View style={styles.operationsStats}>{stats.map(([label, value]) => <View key={label} style={styles.operationsStat}><Text style={styles.operationsStatValue}>{value ?? '—'}</Text><Text style={styles.operationsStatLabel}>{label}</Text></View>)}</View>
      {module === 'BIKE_CHECK_IN' ? <Text style={styles.operationsMetricHint}>Remaining counts waiver-completed athletes who have never recorded a bike entry.</Text> : null}
      {module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' ? <Text style={styles.operationsMetricHint}>Chip counts include every recorded bike entry, including bikes checked out later.</Text> : null}
      {operationsError ? <Text style={styles.operationsError}>{operationsError}</Text> : null}
      {(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') && overview ? operationsLogSection('Check-in logs', 'check-in', overview.checkInLogs) : null}
      {module === 'BIKE_CHECK_IN' && overview ? operationsLogSection('Bike check-in logs', 'bike-in', overview.bikeCheckInLogs) : null}
      {module === 'BIKE_CHECK_OUT' && overview ? operationsLogSection('Bike checkout logs', 'bike-out', overview.bikeCheckOutLogs) : null}
      {module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' && overview ? operationsLogSection('Timing chip assignment logs', 'chip', overview.chipAssignmentLogs) : null}
    </View>;
  }

  function actionControl(participant: Participant) {
    const pending = busyId === participant.id;
    if (module === 'ATHLETE_LOOKUP') return null;
    if (module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') {
      if (participant.state.checkedInAt) return <Pressable disabled style={[styles.actionButton, styles.secondaryButton, styles.disabled]}><Text style={[styles.actionButtonText, styles.secondaryButtonText]}>Registration checked in</Text></Pressable>;
      if (assignment.waiverRequired && !participant.state.waiverVerifiedAt) {
        if (waiverOtpParticipantId !== participant.id) return <Pressable disabled={pending} style={[styles.actionButton, pending && styles.disabled]} onPress={() => void sendWaiverOtp(participant)}><Text style={styles.actionButtonText}>SEND OTP TO ATHLETE EMAIL</Text></Pressable>;
        return <View style={styles.waiverOtpPanel}>
          <Text style={styles.waiverOtpHelp}>Ask the participant to read the six-digit code from their registered email. This signs the selected waiver only; check-in remains separate.</Text>
          {searchData?.event.waiverPolicy.requireGuardianSignatureForMinors && isMinorAtEvent(participant, assignment.eventDate) ? <><TextInput value={signerName} onChangeText={setSignerName} placeholder="Parent / guardian full name" placeholderTextColor="#84939c" style={styles.waiverOtpInput} /><TextInput value={signerRelationship} onChangeText={setSignerRelationship} placeholder="Relationship to participant" placeholderTextColor="#84939c" style={styles.waiverOtpInput} /></> : null}
          <TextInput autoFocus keyboardType="number-pad" maxLength={6} value={waiverOtp} onChangeText={(value) => setWaiverOtp(value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit OTP" placeholderTextColor="#84939c" style={styles.waiverOtpInput} />
          <Pressable disabled={pending || waiverOtp.length !== 6} style={[styles.actionButton, (pending || waiverOtp.length !== 6) && styles.disabled]} onPress={() => void verifyWaiverOtp(participant)}><Text style={styles.actionButtonText}>SIGN CONSOLIDATED WAIVER</Text></Pressable>
          <Pressable disabled={pending} onPress={() => void sendWaiverOtp(participant)} style={styles.waiverOtpResend}><Text style={styles.waiverOtpResendText}>Resend code</Text></Pressable>
        </View>;
      }
      return <>{participant.state.waiverDocumentUrl ? <Pressable style={[styles.actionButton, styles.secondaryButton]} onPress={() => void Linking.openURL(participant.state.waiverDocumentUrl!)}><Text style={[styles.actionButtonText, styles.secondaryButtonText]}>VIEW SIGNED WAIVER</Text></Pressable> : null}<Pressable disabled={pending} style={[styles.actionButton, pending && styles.disabled]} onPress={() => confirmAction(participant, 'CHECK_IN', `Check in ${participant.category}${participant.sessionName ? ` · ${participant.sessionName}` : ''}?`)}><Text style={styles.actionButtonText}>CHECK IN – {participant.category || participant.registrationId}</Text></Pressable></>;
    }
    if (module === 'BIKE_CHECK_IN') {
      if (participant.state.bikeCheckedInAt) return <View style={styles.bikeCheckInComplete}><Text style={styles.bikeCheckInCompleteTitle}>✓ Bike check-in completed</Text><Text style={styles.bikeCheckInCompleteCopy}>{participant.state.bikeCheckedOutAt ? 'The bike was later checked out.' : 'The bike is currently checked in.'} Only an administrator can reset this record.</Text></View>;
      const waiverMissing = assignment.waiverRequired && !participant.state.waiverVerifiedAt;
      if (waiverMissing) return <><Text style={styles.waiverRequiredWarning}>Waiver not signed. Complete waiver verification before checking in the bike.</Text><Pressable disabled style={[styles.actionButton, styles.disabled]}><Text style={styles.actionButtonText}>Bike check-in unavailable</Text></Pressable></>;
      const helmetConfirmed = helmetChecked;
      return <><View style={styles.inlineInput}><View style={styles.helmetLabel}><Text style={[styles.inlineLabel, helmetConfirmed && styles.factConfirmedText]}>{helmetConfirmed ? '✓ ' : ''}Helmet checked (optional)</Text><Text style={styles.optionalHelp}>Bike check-in works whether this is on or off.</Text></View><Pressable accessibilityRole="switch" accessibilityLabel="Helmet checked" accessibilityState={{ checked: helmetConfirmed }} onPress={() => setHelmetChecked((current) => !current)} style={[styles.helmetSwitch, helmetConfirmed && styles.helmetSwitchOn]}>{helmetConfirmed ? <><Text style={[styles.helmetSwitchText, styles.helmetSwitchTextOn]}>ON</Text><View style={[styles.helmetSwitchThumb, styles.helmetSwitchThumbOn]} /></> : <><View style={styles.helmetSwitchThumb} /><Text style={styles.helmetSwitchText}>OFF</Text></>}</Pressable></View>{!participant.assignedBikeRack ? <TextInput value={bikeRack} onChangeText={setBikeRack} placeholder="Rack / bay (optional — no range assigned)" placeholderTextColor="#7c898f" style={styles.smallInput} /> : null}<Pressable disabled={pending} style={[styles.actionButton, pending && styles.disabled]} onPress={() => confirmBikeEntry(participant)}><Text style={styles.actionButtonText}>Record bike entry</Text></Pressable></>;
    }
    if (module === 'BIKE_CHECK_OUT') return <><Pressable disabled={pending} style={[styles.actionButton, pending && styles.disabled]} onPress={() => confirmBikeCheckout(participant)}><Text style={styles.actionButtonText}>Record bike collection</Text></Pressable>{!participant.state.bikeCheckedInAt ? <Text style={styles.athleteMeta}>Bike checkout requires a recorded bike entry.</Text> : null}</>;
    if (module === 'MEDAL_COUNTER') return <Pressable disabled={pending || Boolean(participant.state.medalIssuedAt)} style={[styles.actionButton, participant.state.medalIssuedAt && styles.doneButton, participant.state.medalIssuedAt && styles.disabled]} onPress={() => confirmAction(participant, 'MEDAL_ISSUE', 'Issue finisher medal / goodies?')}><Text style={styles.actionButtonText}>{participant.state.medalIssuedAt ? 'Medal / goodies issued' : 'Issue medal / goodies'}</Text></Pressable>;
    if (module === 'FOOD_COUNTER') return <Pressable disabled={pending || Boolean(participant.state.foodIssuedAt)} style={[styles.actionButton, participant.state.foodIssuedAt && styles.doneButton]} onPress={() => confirmAction(participant, 'FOOD_ISSUE', 'Issue food?')}><Text style={styles.actionButtonText}>{participant.state.foodIssuedAt ? 'Food issued' : 'Issue food'}</Text></Pressable>;
    if (module === 'LOCKER_COUNTER') return <><TextInput value={lockerNumber} onChangeText={setLockerNumber} placeholder="Locker number" placeholderTextColor="#7c898f" style={styles.smallInput} /><Pressable disabled={pending || !lockerNumber.trim()} style={[styles.actionButton, !lockerNumber.trim() && styles.disabled]} onPress={() => confirmAction(participant, 'LOCKER_ASSIGN', 'Assign locker?')}><Text style={styles.actionButtonText}>Assign locker</Text></Pressable></>;
    if (module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' || module === 'ATHLETE_BAND_ASSIGNMENT_COUNTER') return <Pressable disabled={pending || !assignmentCode.trim()} style={[styles.actionButton, !assignmentCode.trim() && styles.disabled]} onPress={() => void assignEquipment(participant)}><Text style={styles.actionButtonText}>ASSIGN {module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' ? 'TIMING CHIP' : 'ATHLETE BAND'}</Text></Pressable>;
    return null;
  }

  return <SafeAreaView style={styles.safe} edges={['top']}>
    <KeyboardSafeScrollView key={`${assignment.id}:${module}`} refreshControl={<RefreshControl refreshing={refreshing} tintColor="#ff6b21" onRefresh={async () => { setRefreshing(true); await Promise.all([onRefreshSession(), refreshOperationsOverview(assignment.eventId, true)]); setRefreshing(false); }} />} keyboardShouldPersistTaps="handled">
      <View style={styles.header}><View style={styles.brandRow}><Image source={volunteerLogo} alt="Race Upshot Volunteer logo" style={styles.brandLogo} /><View><Text style={styles.brand}>RACE UPSHOT</Text><Text style={styles.volunteer}>Volunteer Operations</Text></View></View><View style={styles.headerActions}>{onOpenAthleteProfile ? <Pressable onPress={() => void openAthleteProfile()}><Text style={styles.changeProfile}>ATHLETE</Text></Pressable> : null}<Pressable onPress={() => void onLogout()}><Text style={styles.logout}>SIGN OUT</Text></Pressable></View></View>
      <View style={styles.welcome}><Text style={styles.eyebrow}>SIGNED IN VOLUNTEER</Text><Text style={styles.welcomeTitle}>{session.volunteer.name}</Text><Text style={styles.welcomeCopy}>Only assigned events, roles and timing points are available.</Text></View>

      {session.assignments.length > 1 ? <View style={styles.section}><Text style={styles.sectionLabel}>SELECT EVENT</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>{session.assignments.map((item) => <Pressable key={item.id} onPress={() => chooseAssignment(item)} style={[styles.eventChip, item.id === assignment.id && styles.eventChipActive]}><Text style={[styles.eventChipText, item.id === assignment.id && styles.eventChipTextActive]}>{item.eventName}</Text></Pressable>)}</ScrollView></View> : null}

      <View style={styles.eventCard}><Text style={styles.eventLive}>ACTIVE ASSIGNMENT</Text><Text style={styles.eventName}>{assignment.eventName}</Text><Text style={styles.eventMeta}>{assignment.eventLocation || 'Race venue'}{assignment.eventDate ? ` · ${new Date(assignment.eventDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}` : ''}</Text><Text style={styles.eventScope}>{roles.length} function{roles.length === 1 ? '' : 's'} · {assignment.timingScope === 'AUTO' ? assignment.manualGunFallback ? 'Manual gun finish' : 'Automatic finish point' : `${assignment.timingPointIds.length} timing point${assignment.timingPointIds.length === 1 ? '' : 's'}`}</Text></View>

      <View style={styles.roleSection}><Text style={styles.sectionLabel}>{roles.length > 1 ? 'SELECT ASSIGNED ROLE' : 'ASSIGNED ROLE'}</Text><Pressable accessibilityRole="button" accessibilityState={{ expanded: roleMenuOpen }} onPress={() => roles.length > 1 && setRoleMenuOpen((current) => !current)} style={styles.roleTrigger}><View style={styles.roleTriggerIdentity}><Text style={styles.roleTriggerIcon}>{moduleCopy[module].icon}</Text><Text style={styles.roleTriggerText}>{moduleCopy[module].label}</Text></View>{roles.length > 1 ? <Text style={styles.roleChevron}>{roleMenuOpen ? '⌃' : '⌄'}</Text> : null}</Pressable>{roleMenuOpen ? <View style={styles.roleMenu}>{roles.map((role, index) => <Pressable key={role} onPress={() => { Keyboard.dismiss(); setModule(role); setExpandedLog(null); setRoleMenuOpen(false); setQuery(''); setSearchData(null); setAssignmentCode(''); setChipOwner(null); setChipOwnerLoading(false); setWaiverOtpParticipantId(null); setWaiverOtp(''); setBikeRack(''); setHelmetChecked(false); setError(null); setMessage(null); }} style={[styles.roleOption, index < roles.length - 1 && styles.roleOptionBorder, module === role && styles.roleOptionActive]}><Text style={styles.roleOptionIcon}>{moduleCopy[role].icon}</Text><Text style={[styles.roleOptionText, module === role && styles.roleOptionTextActive]}>{moduleCopy[role].label}</Text>{module === role ? <Text style={styles.roleCheck}>✓</Text> : null}</Pressable>)}</View> : null}</View>

      <RoleErrorBoundary key={`${assignment.id}:${module}`}><View style={styles.workspace}>
        <Text style={[styles.workspaceTitle, module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' && styles.chipWorkspaceTitle]}>{moduleCopy[module].label}</Text><Text style={[styles.workspaceCopy, module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' && styles.chipWorkspaceCopy]}>{moduleCopy[module].detail}</Text>
        {(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') && assignment.waiverRequired ? <Text style={styles.waiverNote}>Event waiver {assignment.waiverVersion ? `version ${assignment.waiverVersion}` : 'is configured'} will be verified as part of athlete check-in.</Text> : null}
        {operationsOverviewPanel()}
        {module === 'MANUAL_TIMING' ? <View style={styles.pointSection}><View style={styles.eventClock}><Text style={styles.eventClockLabel}>EVENT TIME OF DAY · DEVICE CLOCK</Text><Text style={styles.eventClockTime}>{timeOfDay(deviceNow)}</Text><Text style={styles.eventClockMeta}>{calendarDay(deviceNow)} · {deviceTimeZone}</Text><Text style={styles.eventClockSource}>The exact device timestamp is captured when “Stamp now” is pressed.</Text></View><View style={styles.gunStartPanel}><View style={styles.gunStartHeader}><Text style={styles.gunStartTitle}>FEIBOT CONTEST GUN TIMES</Text><Text style={styles.gunStartZone}>IST</Text></View>{contestGunStarts.length ? contestGunStarts.map((contest) => <View key={contest.uuid} style={styles.gunStartRow}><Text style={styles.gunStartName}>{contest.name}</Text><Text style={styles.gunStartTime}>{feibotGunTime(contest.gunStartAt)}</Text></View>) : <Text style={styles.gunStartEmpty}>No Feibot contest gun times are stored. Import timing rules in the admin panel.</Text>}</View><Text style={styles.inputLabel}>{assignment.timingScope === 'AUTO' ? 'AUTOMATIC TIMING MODE' : 'ASSIGNED TIMING POINT'}</Text><View style={styles.pointGrid}>{assignment.timingPointIds.map((id, index) => <Pressable key={id} onPress={() => setTimingPointId(id)} style={[styles.pointChip, selectedTimingPointId === id && styles.pointChipActive]}><Text style={[styles.pointText, selectedTimingPointId === id && styles.pointTextActive]}>{assignment.timingPointNames[index] || id}</Text></Pressable>)}</View>{assignment.timingScope === 'AUTO' ? <Text style={styles.autoTimingNote}>{assignment.manualGunFallback ? 'No provider point is required. The athlete’s official Feibot contest gun time is used automatically.' : 'This assignment follows the event FINISH point and uses the athlete’s official Feibot contest gun time.'}</Text> : null}</View> : null}
        {module === 'FINISH_LINE_VOLUNTEER'
          ? <FinishLineScreen eventId={assignment.eventId} />
          : module === 'CUTOFF_TIME_VOLUNTEER'
            ? <CutoffTimeScreen eventId={assignment.eventId} />
          : module === 'MANUAL_TIMING' ? <>
          <View style={styles.bibKeyboardRow}><Text style={styles.bibKeyboardHint}>BIB keyboard</Text><Pressable onPress={() => { setBibKeyboard('numeric'); setTimeout(() => searchInputRef.current?.focus(), 0); }} style={[styles.bibKeyboardOption, bibKeyboard === 'numeric' && styles.bibKeyboardOptionActive]}><Text style={[styles.bibKeyboardOptionText, bibKeyboard === 'numeric' && styles.bibKeyboardOptionTextActive]}>123</Text></Pressable><Pressable onPress={() => { setBibKeyboard('text'); setTimeout(() => searchInputRef.current?.focus(), 0); }} style={[styles.bibKeyboardOption, bibKeyboard === 'text' && styles.bibKeyboardOptionActive]}><Text style={[styles.bibKeyboardOptionText, bibKeyboard === 'text' && styles.bibKeyboardOptionTextActive]}>ABC</Text></Pressable></View>
          <View style={styles.manualStampRow}><TextInput key={bibKeyboard} ref={searchInputRef} value={query} onChangeText={(value) => { setQuery(value); if (/[A-Za-z]/.test(value)) setBibKeyboard('text'); }} onSubmitEditing={() => void stampManualTiming()} keyboardType={bibKeyboard === 'numeric' ? 'number-pad' : 'default'} returnKeyType="done" autoCapitalize="characters" placeholder="Enter BIB" placeholderTextColor="#7c898f" style={styles.searchInput} /><Pressable disabled={!query.trim() || busyId === 'manual-timing'} onPress={() => void stampManualTiming()} style={[styles.manualStampButton, (!query.trim() || busyId === 'manual-timing') && styles.disabled]}>{busyId === 'manual-timing' ? <ActivityIndicator color="#fff" /> : <Text style={styles.manualStampButtonText}>STAMP</Text>}</Pressable></View>
          {message ? <Text style={styles.success}>{message}</Text> : null}{error ? <Text style={styles.errorText}>{error}</Text> : null}
          <View style={styles.recentTimingHeader}><Text style={styles.recentTimingTitle}>RECENT STAMPS</Text><Pressable disabled={recentTimingLoading} onPress={() => void refreshRecentTiming()} style={styles.recentRefresh}><Text style={styles.recentRefreshText}>{recentTimingLoading ? 'LOADING…' : 'REFRESH'}</Text></Pressable></View>
          {recentTimingLoading && recentTiming.length === 0 ? <ActivityIndicator color="#d9233f" style={styles.cardLoader} /> : recentTiming.length === 0 ? <Text style={styles.recentTimingEmpty}>No active Timekeeper stamps for this event.</Text> : recentTiming.map((row) => <View key={row.id} style={styles.recentTimingCard}><View style={styles.recentTimingMain}><Text style={styles.recentTimingBib}>BIB {row.bib || '—'}</Text><Text style={styles.recentTimingName}>{row.athleteName || 'Athlete'}</Text><Text style={styles.recentTimingMeta}>{row.timingPointName || 'Manual Finish'} · {timeOfDay(new Date(row.capturedAt))}{row.gunTime ? ` · Gun ${row.gunTime}` : ''}</Text></View><Pressable disabled={resettingTimingId === row.id} onPress={() => confirmResetTiming(row)} style={[styles.resetTimingButton, resettingTimingId === row.id && styles.disabled]}>{resettingTimingId === row.id ? <ActivityIndicator color="#9b2730" /> : <Text style={styles.resetTimingText}>RESET</Text>}</Pressable></View>)}
        </>
          : module === 'VOLUNTEER_BAND_ASSIGNMENT_COUNTER' ? <>
          <View style={styles.searchRow}><TextInput value={volunteerQuery} onChangeText={setVolunteerQuery} onSubmitEditing={() => void searchVolunteerTargets()} placeholder="Volunteer name, email or mobile" placeholderTextColor="#7c898f" style={styles.searchInput} /><Pressable onPress={() => void searchVolunteerTargets()} disabled={searching} style={styles.searchButton}>{searching ? <ActivityIndicator color="#fff" /> : <Text style={styles.searchButtonText}>SEARCH</Text>}</Pressable></View>
          <View style={styles.searchRow}><TextInput autoCapitalize="characters" value={assignmentCode} onChangeText={setAssignmentCode} placeholder="Volunteer band code" placeholderTextColor="#7c898f" style={styles.searchInput} /><Pressable onPress={() => { setScannerMode('assignment-code'); setScannerOpen(true); }} style={styles.searchButton}><Text style={styles.searchButtonText}>SCAN BAND</Text></Pressable></View>
          {message ? <Text style={styles.success}>{message}</Text> : null}{error ? <Text style={styles.errorText}>{error}</Text> : null}
          {volunteerTargets.map((target) => <View key={target.id} style={styles.athleteCard}><View style={styles.athleteIdentity}><Text style={styles.athleteName}>{target.name}</Text><Text style={styles.athleteMeta}>{target.email}{target.mobile ? ` · ${target.mobile}` : ''}</Text></View><View style={styles.facts}><Text style={styles.fact}>Volunteer band: {target.bandCode || 'Not assigned'}</Text></View>{busyId === target.id ? <ActivityIndicator color="#ff6b21" style={styles.cardLoader} /> : <Pressable disabled={!assignmentCode.trim()} style={[styles.actionButton, !assignmentCode.trim() && styles.disabled]} onPress={() => void saveVolunteerBand(target)}><Text style={styles.actionButtonText}>ASSIGN VOLUNTEER BAND</Text></Pressable>}</View>)}
        </> : module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' ? <>
          <View style={styles.chipModeRow}>{(['BIB Number', 'Athlete Band'] as ChipSearchMode[]).map((mode) => <Pressable key={mode} onPress={() => { setChipSearchMode(mode); setQuery(''); setSearchData(null); setAssignmentCode(''); setChipOwner(null); setChipOwnerLoading(false); setMessage(null); setError(null); }} style={[styles.chipModeButton, chipSearchMode === mode && styles.chipModeButtonActive]}><Text style={[styles.chipModeButtonText, chipSearchMode === mode && styles.chipModeButtonTextActive]}>{mode}</Text></Pressable>)}</View>
          <View style={styles.chipSearchRow}><TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} autoCapitalize="characters" placeholder={chipSearchMode === 'BIB Number' ? 'Enter BIB number' : 'Enter athlete band'} placeholderTextColor="#7c898f" style={styles.chipSearchInput} /><Pressable onPress={() => void search()} disabled={searching} style={[styles.chipSearchButton, searching && styles.disabled]}>{searching ? <ActivityIndicator color="#071722" /> : <Text style={styles.chipSearchButtonText}>Search</Text>}</Pressable></View>
          <Pressable onPress={() => { setScannerMode('athlete-search'); setScannerOpen(true); }} style={styles.chipScanButton}><Text style={styles.chipScanButtonText}>▣  Scan Athlete Band</Text></Pressable>
          {message ? <Text style={styles.success}>{message}</Text> : null}{error ? <Text style={styles.errorText}>{error}</Text> : null}
          {searchData?.participants.map((participant) => {
            const waiverVerified = Boolean(participant.state.waiverVerifiedAt) || !assignment.waiverRequired;
            const pending = busyId === participant.id;
            return <View key={participant.id} style={styles.chipResultBlock}>
              <View style={styles.chipAthleteCard}>
                <View style={styles.chipIdentityRow}><View style={styles.chipInitialsCircle}><Text style={styles.chipInitialsText}>{initials(participant.name)}</Text></View><Text style={styles.chipAthleteName}>{participant.name}</Text></View>
                <View style={styles.chipCardDivider} />
                <View style={styles.chipFactsGrid}>
                  <View style={styles.chipFactCell}><Text style={styles.chipFactLabel}>BIB:</Text><Text style={styles.chipFactAccent}>{participant.bib || '—'}</Text></View>
                  <View style={styles.chipFactCell}><Text style={styles.chipFactLabel}>Category:</Text><Text style={styles.chipFactValue}>{participant.category || 'Not assigned'}</Text></View>
                  <View style={styles.chipFactCell}><Text style={styles.chipFactLabel}>Gender:</Text><Text style={styles.chipFactValue}>{participant.gender || 'Not recorded'}</Text></View>
                  <View style={styles.chipFactCell}><Text style={styles.chipFactLabel}>Waiver:</Text><Text style={[styles.chipFactValue, waiverVerified ? styles.chipWaiverVerified : styles.chipWaiverPending]}>{waiverVerified ? '✓ WAIVER SIGNED' : '✕ WAIVER NOT VERIFIED'}</Text></View>
                  <View style={styles.chipFactCell}><Text style={styles.chipFactLabel}>Timing Chip:</Text><Text style={[styles.chipFactValue, participant.chipCode ? styles.chipFactAssigned : undefined]}>{participant.chipCode || 'Not Assigned'}</Text></View>
                </View>
              </View>
              {participant.chipCode ? <View style={styles.chipAssignedPanel}>
                <Text style={styles.chipAssignedTitle}>✓ Chip Already Assigned</Text>
                <Text style={styles.chipAssignedCopy}>{participant.chipCode}. Replacement requires an authorized administrator.</Text>
              </View> : <>
                <Text style={styles.chipAssignmentPrompt}>Scan or enter the timing chip code</Text>
                <TextInput autoCapitalize="characters" value={assignmentCode} onChangeText={(value) => { setAssignmentCode(value); setChipOwner(null); setChipOwnerLoading(value.trim().length >= 2); }} placeholder="Enter timing chip code" placeholderTextColor="#84939c" style={styles.chipCodeInput} />
                {chipOwnerLoading ? <View style={styles.chipOwnerPanel}><ActivityIndicator color="#a05b08" /><Text style={styles.chipOwnerLoading}>Checking previous chip assignment…</Text></View> : chipOwner ? <View style={styles.chipOwnerPanel}><Text style={styles.chipOwnerTitle}>CHIP ALREADY ASSIGNED</Text><Text style={styles.chipOwnerName}>{assignmentCode.trim().toUpperCase()} · {chipOwner.name}</Text><Text style={styles.chipOwnerMeta}>BIB {chipOwner.bib || '—'} · {chipOwner.category || 'Category not recorded'}</Text></View> : assignmentCode.trim().length >= 2 ? <Text style={styles.chipAvailable}>✓ No previous athlete assignment found for this chip.</Text> : null}
                <Pressable onPress={() => { setScannerMode('assignment-code'); setScannerOpen(true); }} style={styles.chipScanButton}><Text style={styles.chipScanButtonText}>▣  Scan Chip Barcode</Text></Pressable>
                <Pressable disabled={pending || chipOwnerLoading || Boolean(chipOwner) || !assignmentCode.trim()} onPress={() => void assignEquipment(participant)} style={[styles.chipAssignButton, (pending || chipOwnerLoading || Boolean(chipOwner) || !assignmentCode.trim()) && styles.chipAssignButtonDisabled]}>{pending ? <ActivityIndicator color="#fff" /> : <Text style={styles.chipAssignButtonText}>Assign Chip</Text>}</Pressable>
              </>}
            </View>;
          })}
        </> : <>
          {module === 'ATHLETE_BAND_ASSIGNMENT_COUNTER' ? <View style={styles.searchRow}><TextInput autoCapitalize="characters" value={assignmentCode} onChangeText={setAssignmentCode} placeholder="Athlete band code to assign" placeholderTextColor="#7c898f" style={styles.searchInput} /><Pressable onPress={() => { setScannerMode('assignment-code'); setScannerOpen(true); }} style={styles.searchButton}><Text style={styles.searchButtonText}>SCAN BAND</Text></Pressable></View> : null}
          {(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') ? <View style={styles.searchModeRow}>{(['BIB Number', 'Registration ID', 'Athlete Band', 'Name', 'Email', 'Mobile'] as WaiverSearchMode[]).map((mode) => <Pressable key={mode} onPress={() => { setWaiverSearchMode(mode); setQuery(''); setSearchData(null); setSelectedRegistrationIds([]); setMessage(null); setError(null); }} style={[styles.searchModeChip, waiverSearchMode === mode && styles.searchModeChipActive]}><Text style={[styles.searchModeText, waiverSearchMode === mode && styles.searchModeTextActive]}>{mode}</Text></Pressable>)}</View> : null}
          <View style={styles.searchRow}><TextInput value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} keyboardType={(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') && waiverSearchMode === 'Mobile' ? 'phone-pad' : (module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') && waiverSearchMode === 'Email' ? 'email-address' : 'default'} autoCapitalize={(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') && waiverSearchMode === 'Email' ? 'none' : 'sentences'} placeholder={module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN' ? `Enter ${waiverSearchMode.toLowerCase()}` : 'BIB, band, chip, name or email'} placeholderTextColor="#7c898f" style={styles.searchInput} /><Pressable onPress={() => void search()} disabled={searching} style={styles.searchButton}>{searching ? <ActivityIndicator color="#fff" /> : <Text style={styles.searchButtonText}>SEARCH</Text>}</Pressable></View>
          {(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') && waiverSearchMode === 'Athlete Band' ? <Pressable onPress={() => { setScannerMode('athlete-search'); setScannerOpen(true); }} style={styles.scanButton}><Text style={styles.scanButtonText}>▣  SCAN ATHLETE BAND</Text></Pressable> : null}
          {module !== 'WAIVER_CHECK_IN' && module !== 'ATHLETE_CHECK_IN' ? <Pressable onPress={() => { setScannerMode('athlete-search'); setScannerOpen(true); }} style={styles.scanButton}><Text style={styles.scanButtonText}>▣  SCAN ATHLETE BAND / CHIP / BIB</Text></Pressable> : null}
          {message ? <Text style={styles.success}>{message}</Text> : null}{error ? <Text style={styles.errorText}>{error}</Text> : null}
          {(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') && searchData?.participantProfiles?.length ? <View style={styles.multiRegistrationPanel}>
            <Text style={styles.multiRegistrationTitle}>{searchData.participantProfiles.length > 1 ? 'MULTIPLE PARTICIPANTS FOUND' : searchData.participantProfiles[0].registrations.length > 1 ? 'MULTIPLE REGISTRATIONS FOUND' : 'PARTICIPANT REGISTRATION'}</Text>
            {searchData.participantProfiles.map((profile) => <View key={profile.participantId} style={styles.profileGroup}>
              <Text style={styles.profileName}>{profile.name}</Text><Text style={styles.profileMeta}>{profile.email || profile.mobile || profile.participantId} · {profile.registrations.length} registration{profile.registrations.length === 1 ? '' : 's'}</Text>
              {profile.registrations.map((registration) => { const selected = selectedRegistrationIds.includes(registration.registrationId); const eligible = !registration.state.waiverVerifiedAt; return <Pressable key={registration.registrationId} disabled={!eligible} onPress={() => setSelectedRegistrationIds((current) => selected ? current.filter((id) => id !== registration.registrationId) : searchData.event.waiverPolicy.consolidatedWaiverEnabled ? [...current.filter((id) => profile.registrations.some((item) => item.registrationId === id)), registration.registrationId] : [registration.registrationId])} style={[styles.registrationChoice, selected && styles.registrationChoiceSelected, !eligible && styles.registrationChoiceDisabled]}>
                <Text style={styles.registrationCheckbox}>{eligible ? selected ? '☑' : '☐' : '✓'}</Text><View style={styles.registrationChoiceText}><Text style={styles.registrationName}>{registration.category || 'Registration'}{registration.sessionName ? ` · ${registration.sessionName}` : ''}</Text><Text style={styles.registrationMeta}>ID {registration.registrationId} · BIB {registration.bib || '—'} · Waiver {registration.state.waiverVerifiedAt ? 'Signed' : 'Pending'} · Check-in {registration.state.checkedInAt ? 'Completed' : 'Pending'}</Text></View>
              </Pressable>; })}
              {searchData.event.waiverPolicy.consolidatedWaiverEnabled && profile.registrations.filter((registration) => !registration.state.waiverVerifiedAt).length > 1 ? <Pressable onPress={() => setSelectedRegistrationIds(profile.registrations.filter((registration) => !registration.state.waiverVerifiedAt).map((registration) => registration.registrationId))} style={styles.selectAllButton}><Text style={styles.selectAllText}>SELECT ALL ELIGIBLE REGISTRATIONS</Text></Pressable> : null}
              {searchData.event.waiverPolicy.allowCheckInAll && profile.registrations.some((registration) => registration.state.waiverVerifiedAt && !registration.state.checkedInAt) ? <Pressable disabled={busyId === profile.participantId} onPress={() => void checkInAll(profile.participantId)} style={styles.selectAllButton}><Text style={styles.selectAllText}>CHECK IN ALL ELIGIBLE REGISTRATIONS</Text></Pressable> : null}
            </View>)}
          </View> : null}
          {searchedRelayTeam ? <View style={styles.relayTeamPanel}>
            <Text style={styles.relayTeamEyebrow}>RELAY TEAM · BIB {searchedRelayTeam.bib}</Text>
            <Text style={styles.relayTeamName}>{searchedRelayTeam.name}</Text>
            <Text style={styles.relayTeamMeta}>{searchData?.participants[0]?.category || 'Relay contest'} · {searchedRelayTeam.size} registered athletes</Text>
            <View style={styles.relayTeamStats}><Text style={styles.relayTeamStat}>{searchedRelayTeam.assignedBands} assigned bands</Text><Text style={styles.relayTeamStat}>{searchedRelayTeam.remainingBands} remaining</Text><Text style={[styles.relayTeamStat, searchedRelayTeam.teamWaiverCompleted && styles.relayTeamComplete]}>{searchedRelayTeam.teamWaiverCompleted ? '✓ Team waiver completed' : `${searchedRelayTeam.waiverCompletedMembers}/${searchedRelayTeam.size} waivers signed`}</Text><Text style={[styles.relayTeamStat, searchedRelayTeam.fullyCheckedIn && styles.relayTeamComplete]}>{searchedRelayTeam.fullyCheckedIn ? '✓ Team fully checked in' : `${searchedRelayTeam.checkedInMembers}/${searchedRelayTeam.size} checked in`}</Text></View>
            {searchedRelayTeam.members.map((member) => <View key={member.id} style={styles.relayMemberRow}><View style={styles.relayMemberIdentity}><Text style={styles.relayMemberName}>{member.memberNumber ? `${member.memberNumber}. ` : ''}{member.name}</Text><Text style={styles.relayMemberRole}>{member.memberRole || 'Relay athlete'}{member.email ? ` · ${member.email}` : ''}</Text></View><View><Text style={styles.relayMemberBand}>{member.athleteBandCode || 'Band pending'}</Text><Text style={[styles.relayMemberStatus, member.waiverVerified && styles.relayMemberDone]}>{member.waiverVerified ? `✓ Waiver signed${member.waiverVerifiedAt ? ` · ${formatted(member.waiverVerifiedAt)}` : ''}` : 'Waiver pending'}</Text><Text style={[styles.relayMemberStatus, member.checkedIn && styles.relayMemberDone]}>{member.checkedIn ? '✓ Checked in' : 'Check-in pending'}</Text></View></View>)}
          </View> : null}
          {searchData?.participants.map((participant) => {
            const status = activeStatus(participant, module);
            return <View key={participant.id} style={styles.athleteCard}>
              {(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') ? <View style={styles.waiverIdentity}><View style={styles.initialsCircle}><Text style={styles.initialsText}>{initials(participant.name)}</Text></View><View style={styles.waiverIdentityText}><Text style={styles.waiverAthleteName}>{participant.name}</Text><Text style={styles.athleteMeta}>{participant.email || participant.mobile || 'Registered athlete'}</Text></View></View> : <View style={styles.athleteTop}><View style={styles.bibBox}><Text style={styles.bibLabel}>BIB</Text><Text style={styles.bibValue}>{participant.bib || '—'}</Text></View><View style={styles.athleteIdentity}><Text style={styles.athleteName}>{participant.name}</Text><Text style={styles.athleteMeta}>{participant.category || 'Unassigned category'} · {[participant.gender, participant.ageGroup].filter(Boolean).join(' ') || 'Open'}</Text></View><Text style={[styles.status, status.done && styles.statusDone]}>{status.done ? `✓ ${status.label}` : status.label}</Text></View>}
              {(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') ? (() => { const relayWaiverPending = participant.participationMode === 'RELAY' && assignment.waiverRequired && !participant.state.waiverVerifiedAt; return <><View style={styles.tshirtPanel}><Text style={styles.counterPanelLabel}>{participant.participationMode === 'RELAY' ? `TEAM MEMBER ${participant.relayMemberNumber ?? '—'}${participant.relayMemberRole ? ` · ${participant.relayMemberRole.toUpperCase()}` : ''}` : 'T-SHIRT SIZE'}</Text><Text style={styles.tshirtValue}>{participant.tshirtSize || 'NOT RECORDED'}</Text></View><View style={styles.bandPanel}><View style={styles.bandPanelText}><Text style={styles.counterPanelLabel}>ATHLETE BAND NUMBER</Text><Text style={styles.bandValue}>{participant.athleteBandCode || 'NOT ASSIGNED'}</Text></View><Pressable disabled={relayWaiverPending} style={[styles.assignBandCardButton, relayWaiverPending && styles.disabled]} onPress={() => openBandAssignment(participant)}><Text style={styles.assignBandCardButtonText}>{participant.athleteBandCode ? 'Replace Athlete Band' : participant.participationMode === 'RELAY' ? `${participant.relayMemberNumber === 1 ? 'Assign Band 1' : `+ Add Relay Band ${participant.relayMemberNumber ?? ''}`}` : 'Assign Athlete Band'}</Text></Pressable></View>{relayWaiverPending ? <Text style={styles.waiverRequiredWarning}>Complete this athlete’s individual waiver before assigning a wristband.</Text> : null}</>; })() : null}
              {module === 'ATHLETE_LOOKUP' ? <View style={styles.lookupBandPanel}><Text style={styles.counterPanelLabel}>ATHLETE BAND NUMBER</Text><Text style={styles.lookupBandValue}>{participant.athleteBandCode || 'NOT ASSIGNED'}</Text></View> : null}
              {(module === 'BIKE_CHECK_IN' || module === 'BIKE_CHECK_OUT') ? <View style={styles.bikeRackPanel}><Text style={styles.bikeRackLabel}>{participant.assignedBikeRack ? 'ASSIGNED BIKE RACK' : recordedBikeRack(participant.state.bikeRack) ? 'RECORDED BIKE RACK' : 'BIKE RACK'}</Text><Text style={styles.bikeRackValue}>{displayedBikeRack(participant) || 'NOT ASSIGNED'}</Text><Text style={styles.bikeRackHint}>{displayedBikeRack(participant) ? 'Direct the athlete to this rack' : 'No BIB range covers this athlete yet'}</Text>{participant.assignedBikeRack && recordedBikeRack(participant.state.bikeRack) && participant.assignedBikeRack.toLowerCase() !== recordedBikeRack(participant.state.bikeRack)?.toLowerCase() ? <Text style={styles.bikeRackPrevious}>Previously recorded: {recordedBikeRack(participant.state.bikeRack)}</Text> : null}</View> : null}
              <View style={styles.facts}>{participantFacts(participant).map(([label, value]) => {
                const confirmed = isConfirmedFact(participant, label);
                const warning = label === 'Waiver status' && !confirmed;
                return <Text key={label} style={[styles.fact, confirmed && styles.factConfirmed, confirmed && styles.factConfirmedText, warning && styles.factWarning]}>{confirmed ? '✓ ' : ''}{label}: {value}</Text>;
              })}</View>
              {(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') && participant.idProofUrl ? <Pressable style={styles.proofButton} onPress={() => void openIdProof(participant)}><Text style={styles.proofButtonText}>VIEW ID PROOF</Text></Pressable> : null}
              {busyId === participant.id ? <ActivityIndicator color="#ff6b21" style={styles.cardLoader} /> : actionControl(participant)}
            </View>;
          })}
        </>}
      </View></RoleErrorBoundary>
      <Text style={styles.footer}>RACE UPSHOT · AUTHORIZED RACE OPERATIONS</Text>
    </KeyboardSafeScrollView>
    <Modal visible={bandAssignmentOpen} transparent animationType="fade" onRequestClose={() => setBandAssignmentOpen(false)}><KeyboardSafeScrollView contentContainerStyle={styles.modalBackdrop}><View style={styles.bandModal}><Text style={styles.bandModalTitle}>Assign Athlete Band</Text><Text style={styles.bandModalAthlete}>{bandAssignmentParticipant?.name || 'Athlete'} · BIB {bandAssignmentParticipant?.bib || '—'}</Text><TextInput autoCapitalize="characters" value={assignmentCode} onChangeText={setAssignmentCode} placeholder="Scan or enter athlete band" placeholderTextColor="#7c898f" style={styles.bandModalInput} /><Pressable style={styles.bandModalScan} onPress={() => { setBandAssignmentOpen(false); setScannerMode('waiver-band-code'); setScannerOpen(true); }}><Text style={styles.bandModalScanText}>▣  SCAN ATHLETE BAND</Text></Pressable><View style={styles.bandModalActions}><Pressable style={styles.bandModalCancel} onPress={() => { setBandAssignmentOpen(false); setBandAssignmentParticipant(null); setAssignmentCode(''); }}><Text style={styles.bandModalCancelText}>Cancel</Text></Pressable><Pressable disabled={!assignmentCode.trim() || !bandAssignmentParticipant || Boolean(busyId)} style={[styles.bandModalConfirm, (!assignmentCode.trim() || !bandAssignmentParticipant || Boolean(busyId)) && styles.disabled]} onPress={() => bandAssignmentParticipant ? void assignEquipment(bandAssignmentParticipant) : undefined}><Text style={styles.bandModalConfirmText}>{busyId ? 'SAVING…' : 'ASSIGN BAND'}</Text></Pressable></View></View></KeyboardSafeScrollView></Modal>
    <Modal visible={scannerOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => { setScannerOpen(false); if (scannerMode === 'waiver-band-code') setBandAssignmentOpen(true); }}><Scanner title={scannerMode === 'assignment-code' ? module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' ? 'Scan timing chip' : 'Scan assignment code' : scannerMode === 'waiver-band-code' ? 'Scan athlete band' : module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' ? 'Scan athlete band or BIB' : 'Scan athlete band, chip or BIB'} onClose={() => { setScannerOpen(false); if (scannerMode === 'waiver-band-code') setBandAssignmentOpen(true); }} onScanned={(value) => { setScannerOpen(false); if (scannerMode === 'assignment-code') { const code = value.trim(); setAssignmentCode(code); setChipOwner(null); setChipOwnerLoading(module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' && code.length >= 2); } else if (scannerMode === 'waiver-band-code') { setAssignmentCode(value.trim()); setBandAssignmentOpen(true); } else { setQuery(value); setTimeout(() => void search(value), 250); } }} /></Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080b0e' }, center: { flex: 1, backgroundColor: '#080b0e', alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { minHeight: 72, paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#252c31' }, brandRow: { flexDirection: 'row', alignItems: 'center' }, brandLogo: { width: 44, height: 44, borderRadius: 12, marginRight: 10 }, brand: { color: '#00a651', fontSize: 11, fontWeight: '900', letterSpacing: 1.3 }, volunteer: { color: '#fff', fontSize: 14, fontWeight: '900', marginTop: 2 }, headerActions: { alignItems: 'flex-end', gap: 8 }, changeProfile: { color: '#23b8d1', fontSize: 9, fontWeight: '900' }, logout: { color: '#aeb7bc', fontSize: 10, fontWeight: '900' },
  welcome: { padding: 20, paddingBottom: 8 }, eyebrow: { color: '#ff6b21', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 }, welcomeTitle: { color: '#fff', fontSize: 28, fontWeight: '900', marginTop: 5 }, welcomeCopy: { color: '#98a3a9', fontSize: 12, marginTop: 6 },
  section: { marginTop: 15 }, sectionLabel: { color: '#87939a', fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginHorizontal: 20, marginBottom: 8 }, chipRow: { gap: 8, paddingHorizontal: 20 }, eventChip: { maxWidth: 260, borderRadius: 12, borderWidth: 1, borderColor: '#313a3f', backgroundColor: '#12171a', paddingHorizontal: 14, paddingVertical: 11 }, eventChipActive: { borderColor: '#ff6b21', backgroundColor: '#2a1710' }, eventChipText: { color: '#aeb7bc', fontSize: 12, fontWeight: '800' }, eventChipTextActive: { color: '#fff' },
  eventCard: { margin: 20, marginBottom: 4, borderRadius: 20, backgroundColor: '#151a1e', borderWidth: 1, borderColor: '#2a3237', padding: 18 }, eventLive: { color: '#ff6b21', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 }, eventName: { color: '#fff', fontSize: 21, fontWeight: '900', marginTop: 6 }, eventMeta: { color: '#9ba6ac', fontSize: 12, marginTop: 6 }, eventScope: { color: '#d6dde0', fontSize: 11, fontWeight: '800', marginTop: 12 },
  roleSection: { marginHorizontal: 20, marginTop: 20, zIndex: 3 }, roleTrigger: { minHeight: 60, borderRadius: 17, borderWidth: 1, borderColor: '#3d4850', backgroundColor: '#151a1e', paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, roleTriggerIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center' }, roleTriggerIcon: { width: 39, color: '#ff6b21', fontSize: 22, fontWeight: '900' }, roleTriggerText: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '900' }, roleChevron: { color: '#ff6b21', fontSize: 23, fontWeight: '900' }, roleMenu: { marginTop: 7, borderRadius: 16, borderWidth: 1, borderColor: '#3d4850', backgroundColor: '#151a1e', overflow: 'hidden' }, roleOption: { minHeight: 52, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center' }, roleOptionBorder: { borderBottomWidth: 1, borderBottomColor: '#2b3338' }, roleOptionActive: { backgroundColor: '#2a1710' }, roleOptionIcon: { width: 35, color: '#ff6b21', fontSize: 18 }, roleOptionText: { flex: 1, color: '#c8d0d4', fontSize: 13, fontWeight: '800' }, roleOptionTextActive: { color: '#fff' }, roleCheck: { color: '#ff6b21', fontSize: 17, fontWeight: '900' },
  workspace: { margin: 20, borderRadius: 22, backgroundColor: '#f2f4f5', padding: 17 }, workspaceTitle: { color: '#111518', fontSize: 22, fontWeight: '900' }, workspaceCopy: { color: '#5e696f', fontSize: 12, lineHeight: 18, marginTop: 4 }, waiverNote: { color: '#78500c', backgroundColor: '#fff1ca', borderRadius: 11, padding: 10, fontSize: 11, fontWeight: '800', marginTop: 12 }, waiverRequiredWarning: { color: '#8f2424', backgroundColor: '#fff0f0', borderRadius: 11, padding: 11, fontSize: 11, lineHeight: 16, fontWeight: '800', marginBottom: 10 },
  multiRegistrationPanel: { marginTop: 14, borderRadius: 15, borderWidth: 1, borderColor: '#bccbd1', backgroundColor: '#fff', padding: 12 },
  multiRegistrationTitle: { color: '#d93434', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  profileGroup: { marginTop: 11, borderTopWidth: 1, borderTopColor: '#e3e9ec', paddingTop: 10 },
  profileName: { color: '#10171b', fontSize: 17, fontWeight: '900' }, profileMeta: { color: '#647279', fontSize: 10, marginTop: 3 },
  registrationChoice: { marginTop: 8, borderRadius: 11, borderWidth: 1, borderColor: '#d4dde1', backgroundColor: '#f7f9fa', padding: 10, flexDirection: 'row', alignItems: 'center' },
  registrationChoiceSelected: { borderColor: '#d93434', backgroundColor: '#fff0f1' }, registrationChoiceDisabled: { opacity: 0.7 },
  registrationCheckbox: { width: 28, color: '#d93434', fontSize: 19, fontWeight: '900' }, registrationChoiceText: { flex: 1 },
  registrationName: { color: '#172126', fontSize: 12, fontWeight: '900' }, registrationMeta: { color: '#65747b', fontSize: 9, lineHeight: 14, marginTop: 3 },
  selectAllButton: { marginTop: 9, borderRadius: 9, backgroundColor: '#20272b', padding: 10 }, selectAllText: { color: '#fff', fontSize: 9, fontWeight: '900', textAlign: 'center', letterSpacing: 0.5 },
  chipWorkspaceTitle: { color: '#071722', fontSize: 28, lineHeight: 34 },
  chipWorkspaceCopy: { color: '#657780', fontSize: 14, lineHeight: 20, marginTop: 8 },
  operationsPanel: { marginTop: 16, borderRadius: 16, borderWidth: 1, borderColor: '#c8d5da', backgroundColor: '#fff', padding: 12 },
  operationsPanelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  operationsPanelTitle: { color: '#536873', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 },
  operationsRefresh: { borderRadius: 8, borderWidth: 1, borderColor: '#b6c4ca', paddingHorizontal: 9, paddingVertical: 6 },
  operationsRefreshText: { color: '#43535b', fontSize: 8, fontWeight: '900' },
  operationsStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 10 },
  operationsStat: { flexGrow: 1, flexBasis: '47%', minHeight: 76, borderRadius: 11, backgroundColor: '#eaf0f2', paddingHorizontal: 7, paddingVertical: 10, justifyContent: 'center' },
  operationsStatValue: { color: '#071722', fontSize: 23, fontWeight: '900', textAlign: 'center' },
  operationsStatLabel: { color: '#536873', fontSize: 7, lineHeight: 10, fontWeight: '900', textAlign: 'center', marginTop: 4 },
  operationsMetricHint: { color: '#65757e', fontSize: 9, lineHeight: 13, marginTop: 8 },
  operationsError: { color: '#9b2730', backgroundColor: '#ffe5e7', borderRadius: 9, padding: 9, fontSize: 10, fontWeight: '800', marginTop: 10 },
  operationsLogSection: { borderTopWidth: 1, borderTopColor: '#dce5e9', marginTop: 11, paddingTop: 9 },
  operationsLogHeader: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  operationsLogTitle: { color: '#071722', fontSize: 12, fontWeight: '900' },
  operationsLogCount: { color: '#6b7b83', fontSize: 9, marginTop: 2 },
  operationsLogButton: { borderRadius: 8, backgroundColor: '#071722', paddingHorizontal: 10, paddingVertical: 8 },
  operationsLogButtonText: { color: '#fff', fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  operationsLogEmpty: { color: '#6b7b83', backgroundColor: '#eef3f5', borderRadius: 9, padding: 10, fontSize: 10 },
  operationsLogRow: { borderRadius: 10, backgroundColor: '#eef3f5', padding: 10, marginTop: 6 },
  operationsLogIdentity: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  operationsLogBib: { color: '#087b91', fontSize: 10, fontWeight: '900' },
  operationsLogName: { flex: 1, color: '#071722', fontSize: 11, fontWeight: '900' },
  operationsLogChip: { color: '#168544', fontSize: 12, fontWeight: '900', marginTop: 6 },
  operationsLogMeta: { color: '#64747c', fontSize: 9, lineHeight: 13, marginTop: 4 },
  pointSection: { marginTop: 14 }, inputLabel: { color: '#69757b', fontSize: 9, fontWeight: '900', letterSpacing: 1 }, pointGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 7 }, pointChip: { borderRadius: 10, borderWidth: 1, borderColor: '#c8d0d4', backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 8 }, pointChipActive: { backgroundColor: '#111518', borderColor: '#111518' }, pointText: { color: '#59666c', fontSize: 10, fontWeight: '900' }, pointTextActive: { color: '#fff' },
  autoTimingNote: { color: '#69501a', backgroundColor: '#fff2c7', borderRadius: 9, padding: 9, fontSize: 10, fontWeight: '700', lineHeight: 15, marginTop: 8 },
  eventClock: { alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: '#d9233f', backgroundColor: '#111518', paddingHorizontal: 14, paddingVertical: 15, marginBottom: 14 }, eventClockLabel: { color: '#ff8a9b', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 }, eventClockTime: { color: '#fff', fontSize: 38, fontWeight: '900', fontVariant: ['tabular-nums'], letterSpacing: 1.5, marginTop: 4 }, eventClockMeta: { color: '#b8c1c5', fontSize: 10, fontWeight: '800', marginTop: 4 }, eventClockSource: { color: '#8f9ba1', fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 8 },
  gunStartPanel: { borderRadius: 13, borderWidth: 1, borderColor: '#b9d8c5', backgroundColor: '#f3fff7', padding: 12, marginBottom: 14 }, gunStartHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: '#d5eadc' }, gunStartTitle: { color: '#166534', fontSize: 9, fontWeight: '900', letterSpacing: 1 }, gunStartZone: { color: '#547563', fontSize: 9, fontWeight: '900' }, gunStartRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderBottomWidth: 1, borderBottomColor: '#deeee4' }, gunStartName: { flex: 1, color: '#183526', fontSize: 11, fontWeight: '800' }, gunStartTime: { color: '#087b3e', fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] }, gunStartEmpty: { color: '#6a736e', fontSize: 10, lineHeight: 15, marginTop: 9 },
  searchModeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 16 }, searchModeChip: { borderRadius: 11, backgroundColor: '#dfe8ec', paddingHorizontal: 13, paddingVertical: 10 }, searchModeChipActive: { backgroundColor: '#092235' }, searchModeText: { color: '#61717a', fontSize: 10, fontWeight: '900' }, searchModeTextActive: { color: '#fff' },
  chipModeRow: { flexDirection: 'row', gap: 8, marginTop: 20 },
  chipModeButton: { minHeight: 46, borderRadius: 13, backgroundColor: '#dfe8ec', paddingHorizontal: 17, alignItems: 'center', justifyContent: 'center' },
  chipModeButtonActive: { backgroundColor: '#071722' },
  chipModeButtonText: { color: '#50636d', fontSize: 12, fontWeight: '900' },
  chipModeButtonTextActive: { color: '#fff' },
  chipSearchRow: { flexDirection: 'row', gap: 9, marginTop: 12 },
  chipSearchInput: { flex: 1, height: 58, borderRadius: 14, borderWidth: 1, borderColor: '#bdcbd1', backgroundColor: '#fff', color: '#071722', paddingHorizontal: 15, fontSize: 17 },
  chipSearchButton: { minWidth: 104, height: 58, borderRadius: 14, backgroundColor: '#24bfd5', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  chipSearchButtonText: { color: '#071722', fontSize: 15, fontWeight: '900' },
  chipScanButton: { minHeight: 58, borderRadius: 14, backgroundColor: '#dce7ec', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  chipScanButtonText: { color: '#071722', fontSize: 15, fontWeight: '900' },
  chipResultBlock: { marginTop: 16 },
  chipAthleteCard: { borderRadius: 18, borderWidth: 1, borderColor: '#c8d5da', backgroundColor: '#fff', padding: 16 },
  chipIdentityRow: { flexDirection: 'row', alignItems: 'center' },
  chipInitialsCircle: { width: 70, height: 70, borderRadius: 35, borderWidth: 2, borderColor: '#a9e3eb', backgroundColor: '#e0f5f8', alignItems: 'center', justifyContent: 'center' },
  chipInitialsText: { color: '#087b91', fontSize: 22, fontWeight: '900' },
  chipAthleteName: { flex: 1, color: '#071722', fontSize: 21, fontWeight: '900', marginLeft: 16 },
  chipCardDivider: { height: 1, backgroundColor: '#dce5e9', marginVertical: 17 },
  chipFactsGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 17 },
  chipFactCell: { width: '50%', paddingRight: 10 },
  chipFactLabel: { color: '#536873', fontSize: 11, fontWeight: '900' },
  chipFactValue: { color: '#071722', fontSize: 13, lineHeight: 18, fontWeight: '800', marginTop: 5 },
  chipFactAccent: { color: '#087b91', fontSize: 17, fontWeight: '900', marginTop: 4 },
  chipFactAssigned: { color: '#168247' },
  chipWaiverVerified: { color: '#1d8a48' },
  chipWaiverPending: { color: '#a05b08' },
  chipAssignmentPrompt: { color: '#536873', fontSize: 12, lineHeight: 17, fontWeight: '900', marginTop: 16 },
  chipAssignedPanel: { backgroundColor: '#dcf5e5', borderColor: '#8bd5aa', borderRadius: 16, borderWidth: 1, marginTop: 16, padding: 16 },
  chipAssignedTitle: { color: '#147a3c', fontSize: 16, fontWeight: '900' },
  chipAssignedCopy: { color: '#2f6f49', fontSize: 13, lineHeight: 20, marginTop: 7 },
  chipCodeInput: { height: 58, borderRadius: 14, borderWidth: 1, borderColor: '#bdcbd1', backgroundColor: '#fff', color: '#071722', paddingHorizontal: 15, fontSize: 17, marginTop: 12 },
  chipOwnerPanel: { borderRadius: 12, borderWidth: 1, borderColor: '#e6b75c', backgroundColor: '#fff4d6', padding: 12, marginTop: 9 },
  chipOwnerLoading: { color: '#80550d', fontSize: 11, fontWeight: '800', marginTop: 6 },
  chipOwnerTitle: { color: '#8b4b00', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  chipOwnerName: { color: '#4e2d00', fontSize: 13, fontWeight: '900', marginTop: 4 },
  chipOwnerMeta: { color: '#76551d', fontSize: 10, marginTop: 3 },
  chipAvailable: { color: '#147a3c', backgroundColor: '#dcf5e5', borderRadius: 10, padding: 10, fontSize: 10, fontWeight: '900', marginTop: 9 },
  chipAssignButton: { minHeight: 58, borderRadius: 14, backgroundColor: '#071722', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  chipAssignButtonDisabled: { backgroundColor: '#9ca9af' },
  chipAssignButtonText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  bibKeyboardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 16 }, bibKeyboardHint: { color: '#647985', fontSize: 10, marginRight: 2 }, bibKeyboardOption: { minWidth: 44, borderRadius: 8, borderWidth: 1, borderColor: '#c6d6df', backgroundColor: '#fff', paddingHorizontal: 9, paddingVertical: 6, alignItems: 'center' }, bibKeyboardOptionActive: { borderColor: '#111518', backgroundColor: '#111518' }, bibKeyboardOptionText: { color: '#4e6573', fontSize: 10, fontWeight: '900' }, bibKeyboardOptionTextActive: { color: '#fff' },
  manualStampRow: { flexDirection: 'row', gap: 8, marginTop: 8 }, manualStampButton: { minWidth: 92, borderRadius: 13, backgroundColor: '#d9233f', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 }, manualStampButtonText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  recentTimingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 4 }, recentTimingTitle: { color: '#263238', fontSize: 11, fontWeight: '900', letterSpacing: 1 }, recentRefresh: { borderRadius: 8, borderWidth: 1, borderColor: '#aebbc1', backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 7 }, recentRefreshText: { color: '#43535b', fontSize: 9, fontWeight: '900' }, recentTimingEmpty: { color: '#647078', backgroundColor: '#e6ebed', borderRadius: 11, padding: 12, fontSize: 11, marginTop: 8 }, recentTimingCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 13, borderWidth: 1, borderColor: '#d2d9dc', backgroundColor: '#fff', padding: 12, marginTop: 8 }, recentTimingMain: { flex: 1, paddingRight: 10 }, recentTimingBib: { color: '#d9233f', fontSize: 13, fontWeight: '900' }, recentTimingName: { color: '#111518', fontSize: 12, fontWeight: '900', marginTop: 3 }, recentTimingMeta: { color: '#647078', fontSize: 9, marginTop: 4 }, resetTimingButton: { minWidth: 62, minHeight: 38, borderRadius: 9, borderWidth: 1, borderColor: '#d9233f', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9 }, resetTimingText: { color: '#9b2730', fontSize: 9, fontWeight: '900' },
  searchRow: { flexDirection: 'row', gap: 8, marginTop: 16 }, searchInput: { flex: 1, height: 50, borderRadius: 13, borderWidth: 1, borderColor: '#c8d0d4', backgroundColor: '#fff', color: '#111518', paddingHorizontal: 13, fontSize: 13 }, searchButton: { minWidth: 78, borderRadius: 13, backgroundColor: '#111518', alignItems: 'center', justifyContent: 'center' }, searchButtonText: { color: '#fff', fontSize: 10, fontWeight: '900' }, scanButton: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: '#ff6b21', alignItems: 'center', justifyContent: 'center', marginTop: 9 }, scanButtonText: { color: '#d95616', fontSize: 11, fontWeight: '900' },
  success: { color: '#23613a', backgroundColor: '#dff3e5', borderRadius: 10, padding: 10, fontSize: 11, fontWeight: '800', marginTop: 12 }, errorText: { color: '#9b2730', backgroundColor: '#ffe5e7', borderRadius: 10, padding: 10, fontSize: 11, fontWeight: '800', marginTop: 12 },
  relayTeamPanel: { borderRadius: 15, borderWidth: 1, borderColor: '#7bcbd8', backgroundColor: '#e7f8fb', padding: 14, marginTop: 13 }, relayTeamEyebrow: { color: '#087b91', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 }, relayTeamName: { color: '#071722', fontSize: 19, fontWeight: '900', marginTop: 5 }, relayTeamMeta: { color: '#536873', fontSize: 11, fontWeight: '700', marginTop: 4 }, relayTeamStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 11 }, relayTeamStat: { color: '#36545f', backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7, fontSize: 9, fontWeight: '900' }, relayTeamComplete: { color: '#147a3c', backgroundColor: '#dcf5e5' },
  relayMemberRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTopWidth: 1, borderTopColor: '#bfdee4', paddingTop: 9, marginTop: 9 }, relayMemberIdentity: { flex: 1, minWidth: 0 }, relayMemberName: { color: '#142d36', fontSize: 11, fontWeight: '900' }, relayMemberRole: { color: '#607984', fontSize: 9, marginTop: 2 }, relayMemberBand: { color: '#087b91', fontSize: 10, fontWeight: '900', textAlign: 'right' }, relayMemberStatus: { color: '#9a5c0a', fontSize: 8, fontWeight: '800', textAlign: 'right', marginTop: 2 }, relayMemberDone: { color: '#147a3c' },
  athleteCard: { borderRadius: 17, borderWidth: 1, borderColor: '#d2d9dc', backgroundColor: '#fff', padding: 13, marginTop: 13 }, athleteTop: { flexDirection: 'row', alignItems: 'center' }, bibBox: { minWidth: 52, height: 52, borderRadius: 12, backgroundColor: '#111518', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }, bibLabel: { color: '#8d9ba2', fontSize: 7, fontWeight: '900' }, bibValue: { color: '#ff6b21', fontSize: 15, fontWeight: '900', marginTop: 1 }, athleteIdentity: { flex: 1, marginLeft: 10 }, athleteName: { color: '#111518', fontSize: 14, fontWeight: '900' }, athleteMeta: { color: '#6f7a80', fontSize: 9, lineHeight: 13, marginTop: 3 }, status: { maxWidth: 95, color: '#79570c', backgroundColor: '#fff0bf', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 5, overflow: 'hidden', fontSize: 8, fontWeight: '900', textAlign: 'center' }, statusDone: { color: '#23613a', backgroundColor: '#dff3e5' }, facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 11 }, fact: { width: '47%', flexGrow: 1, color: '#526067', backgroundColor: '#eef2f3', borderRadius: 8, padding: 7, fontSize: 9, fontWeight: '700' }, factConfirmed: { backgroundColor: '#e0f5e8' }, factConfirmedText: { color: '#16743d', fontWeight: '900' }, factWarning: { color: '#b42318', backgroundColor: '#fee4e2', fontWeight: '900' },
  waiverIdentity: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 }, initialsCircle: { width: 58, height: 58, borderRadius: 29, borderWidth: 2, borderColor: '#abe3ec', backgroundColor: '#e0f5f8', alignItems: 'center', justifyContent: 'center' }, initialsText: { color: '#087b91', fontSize: 20, fontWeight: '900' }, waiverIdentityText: { flex: 1, marginLeft: 12 }, waiverAthleteName: { color: '#071722', fontSize: 18, fontWeight: '900' }, tshirtPanel: { borderRadius: 13, borderWidth: 1, borderColor: '#d78a00', backgroundColor: '#ffbf26', paddingHorizontal: 14, paddingVertical: 14 }, counterPanelLabel: { color: '#164657', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 }, tshirtValue: { color: '#2b1705', fontSize: 24, fontWeight: '900', marginTop: 5 }, bandPanel: { flexDirection: 'row', alignItems: 'center', borderRadius: 13, borderWidth: 1, borderColor: '#80d1df', backgroundColor: '#e4f7fa', padding: 13, marginTop: 10 }, bandPanelText: { flex: 1, paddingRight: 8 }, bandValue: { color: '#071722', fontSize: 17, fontWeight: '900', marginTop: 5 }, assignBandCardButton: { minHeight: 44, borderRadius: 11, backgroundColor: '#087b91', paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' }, assignBandCardButtonText: { color: '#fff', fontSize: 10, fontWeight: '900', textAlign: 'center' },
  lookupBandPanel: { borderRadius: 13, borderWidth: 1, borderColor: '#80d1df', backgroundColor: '#e4f7fa', paddingHorizontal: 13, paddingVertical: 12, marginTop: 11 }, lookupBandValue: { color: '#071722', fontSize: 20, fontWeight: '900', marginTop: 5 },
  bikeRackPanel: { borderRadius: 17, borderWidth: 2, borderColor: '#f9a818', backgroundColor: '#071722', paddingHorizontal: 16, paddingVertical: 19, marginTop: 13, alignItems: 'center' },
  bikeRackLabel: { color: '#ffc33c', fontSize: 11, fontWeight: '900', letterSpacing: 1.3, textAlign: 'center' },
  bikeRackValue: { color: '#fff', fontSize: 28, fontWeight: '900', marginTop: 7, textAlign: 'center' },
  bikeRackHint: { color: '#b7c7ce', fontSize: 11, fontWeight: '700', marginTop: 5, textAlign: 'center' },
  bikeRackPrevious: { color: '#f8c66c', fontSize: 9, fontWeight: '800', marginTop: 7, textAlign: 'center' },
  bikeCheckInComplete: { borderRadius: 12, borderWidth: 1, borderColor: '#8bd5aa', backgroundColor: '#dcf5e5', padding: 13, marginTop: 12 },
  bikeCheckInCompleteTitle: { color: '#147a3c', fontSize: 13, fontWeight: '900' },
  bikeCheckInCompleteCopy: { color: '#2f6f49', fontSize: 10, lineHeight: 15, marginTop: 5 },
  waiverOtpPanel: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#d6c184', backgroundColor: '#fff9e9' }, waiverOtpHelp: { color: '#5f4d20', fontSize: 11, lineHeight: 16, fontWeight: '700' }, waiverOtpInput: { height: 48, borderRadius: 10, borderWidth: 1, borderColor: '#c8d0d4', backgroundColor: '#fff', color: '#111518', paddingHorizontal: 12, fontSize: 20, fontWeight: '900', letterSpacing: 6, textAlign: 'center', marginTop: 10 }, waiverOtpResend: { alignItems: 'center', paddingVertical: 10 }, waiverOtpResendText: { color: '#8a4b00', fontSize: 11, fontWeight: '900' },
  inlineInput: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12 }, helmetLabel: { flex: 1, minWidth: 0 }, helmetSwitch: { width: 68, height: 36, flexShrink: 0, borderRadius: 18, borderWidth: 1, borderColor: '#7d898f', backgroundColor: '#e1e6e8', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }, helmetSwitchOn: { borderColor: '#148044', backgroundColor: '#148044' }, helmetSwitchDisabled: { opacity: 0.72 }, helmetSwitchThumb: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', borderWidth: 1, borderColor: '#aeb8bc' }, helmetSwitchThumbOn: { borderColor: '#fff' }, helmetSwitchText: { color: '#435159', fontSize: 9, fontWeight: '900', marginHorizontal: 2 }, helmetSwitchTextOn: { color: '#fff' }, inlineLabel: { color: '#263238', fontSize: 12, fontWeight: '900' }, optionalHelp: { color: '#6c7a81', fontSize: 9, marginTop: 2 }, smallInput: { height: 44, borderRadius: 11, borderWidth: 1, borderColor: '#c8d0d4', backgroundColor: '#f8fafb', color: '#111518', paddingHorizontal: 12, fontSize: 12, marginTop: 9 }, actionButton: { minHeight: 44, borderRadius: 12, backgroundColor: '#ff6b21', alignItems: 'center', justifyContent: 'center', marginTop: 11 }, timingButton: { minHeight: 48, borderRadius: 12, backgroundColor: '#d9233f', alignItems: 'center', justifyContent: 'center', marginTop: 11 }, actionButtonText: { color: '#fff', fontSize: 11, fontWeight: '900' }, secondaryButton: { backgroundColor: '#e4e9eb' }, secondaryButtonText: { color: '#263238' }, doneButton: { backgroundColor: '#397b4d' }, disabled: { opacity: 0.42 }, cardLoader: { marginTop: 14 },
  bandButton: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: '#087b91', backgroundColor: '#e5f8fb', alignItems: 'center', justifyContent: 'center', marginTop: 11 }, bandButtonText: { color: '#075f70', fontSize: 11, fontWeight: '900' }, proofButton: { minHeight: 40, borderRadius: 10, borderWidth: 1, borderColor: '#59666c', alignItems: 'center', justifyContent: 'center', marginTop: 9 }, proofButtonText: { color: '#263238', fontSize: 10, fontWeight: '900' },
  modalBackdrop: { flexGrow: 1, backgroundColor: 'rgba(0,0,0,.72)', alignItems: 'center', justifyContent: 'center', padding: 20 }, bandModal: { width: '100%', maxWidth: 440, borderRadius: 20, backgroundColor: '#f3f6f7', padding: 18 }, bandModalTitle: { color: '#071722', fontSize: 22, fontWeight: '900' }, bandModalAthlete: { color: '#607078', fontSize: 12, fontWeight: '800', marginTop: 6 }, bandModalInput: { height: 52, borderRadius: 13, borderWidth: 1, borderColor: '#b9c8ce', backgroundColor: '#fff', color: '#111518', paddingHorizontal: 13, fontSize: 14, marginTop: 16 }, bandModalScan: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: '#087b91', alignItems: 'center', justifyContent: 'center', marginTop: 10 }, bandModalScanText: { color: '#087b91', fontSize: 11, fontWeight: '900' }, bandModalActions: { flexDirection: 'row', gap: 9, marginTop: 14 }, bandModalCancel: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: '#dfe6e9', alignItems: 'center', justifyContent: 'center' }, bandModalCancelText: { color: '#34444c', fontSize: 11, fontWeight: '900' }, bandModalConfirm: { flex: 1.5, minHeight: 46, borderRadius: 12, backgroundColor: '#087b91', alignItems: 'center', justifyContent: 'center' }, bandModalConfirmText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  footer: { color: '#657078', fontSize: 9, fontWeight: '900', letterSpacing: 1.1, textAlign: 'center', paddingBottom: 28 },
  scannerShell: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }, scannerTop: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2, paddingHorizontal: 18, paddingBottom: 14, backgroundColor: 'rgba(0,0,0,.72)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, scannerTitle: { color: '#fff', fontSize: 16, fontWeight: '900' }, scannerClose: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9 }, scannerCloseText: { color: '#111518', fontSize: 11, fontWeight: '900' }, scanFrame: { width: 270, height: 270, borderRadius: 28, borderWidth: 4, borderColor: '#ff6b21', backgroundColor: 'transparent' }, scannerHint: { position: 'absolute', bottom: 80, color: '#fff', backgroundColor: 'rgba(0,0,0,.7)', borderRadius: 10, paddingHorizontal: 15, paddingVertical: 10, fontWeight: '800' }, permissionCard: { width: '84%', borderRadius: 20, backgroundColor: '#151a1e', padding: 20 }, permissionTitle: { color: '#fff', fontSize: 19, fontWeight: '900' }, permissionText: { color: '#aeb7bc', fontSize: 13, lineHeight: 19, marginTop: 7 }, primaryButton: { height: 48, backgroundColor: '#ff6b21', borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 17 }, primaryButtonText: { color: '#fff', fontWeight: '900' },
});
