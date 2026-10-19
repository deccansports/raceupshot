import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardSafeScrollView } from './KeyboardSafeScrollView';
import { RoleErrorBoundary } from './RoleErrorBoundary';
import {
  ActivityIndicator, Alert, Image, Keyboard, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, View,
} from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { apiRequest } from '../api';
import { mergeTimingRefresh } from '../manualTimingRefresh';
import type { Assignment, ContestGunStart, ManualTimingStamp, Participant, ParticipantSearch, VolunteerBandTarget, VolunteerModule, VolunteerOperationsOverview, VolunteerOperationsOverviewLog, VolunteerSession } from '../types';
import { CutoffTimeScreen } from './CutoffTimeScreen';
import { FinishLineScreen } from './FinishLineScreen';
import { CateringScreen } from './CateringScreen';
import volunteerLogo from '../../RACE UPSHOT VOLUYNTEER APP LOGO.png';

const moduleCopy: Record<VolunteerModule, { label: string; icon: string; detail: string }> = {
  ATHLETE_LOOKUP: { label: 'Athlete Lookup', icon: '⌕', detail: 'Search and verify athlete identity.' },
  WAIVER_CHECK_IN: { label: 'Waiver & Athlete Band', icon: '✓', detail: 'Verify identity and waiver, assign the athlete band, then complete check-in.' },
  ATHLETE_CHECK_IN: { label: 'Waiver & Athlete Band', icon: '✓', detail: 'Verify identity and waiver, assign the athlete band, then complete check-in.' },
  BIKE_CHECK_IN: { label: 'Bike Check-In', icon: '▱', detail: 'Record bike/rack entry. Helmet status is optional.' },
  BIKE_CHECK_OUT: { label: 'Bike Check-Out', icon: '↗', detail: 'Release only a currently checked-in bike.' },
  MEDAL_COUNTER: { label: 'Finisher Medal / Goodies', icon: '★', detail: 'Record one medal / goodies bundle per athlete.' },
  FOOD_COUNTER: { label: 'Catering / Food & Items', icon: '◉', detail: 'Serve athletes and volunteers with scheduled meals, item stock and serving logs.' },
  PAID_FOOD_COUNTER: { label: 'Paid Food Redemption', icon: '₹', detail: 'Find purchased food by coupon, order, mobile or email and redeem it once.' },
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
type WaiverSearchMode = 'BIB Number' | 'Registration ID' | 'Athlete Band' | 'Name / Email' | 'Mobile';
type ChipSearchMode = 'BIB Number' | 'Athlete Band';
type OperationsLogKey = 'check-in' | 'bike-in' | 'bike-out' | 'chip';
type ChipReturnMethod = 'CAMERA' | 'RFID' | 'MANUAL' | 'OVERRIDE';
const CHIP_RETURN_REASONS = ['Chip Lost', 'Chip Damaged', 'Chip Not Available', 'Chip Already Collected', 'Other'] as const;
const RFID_READER_SETTLE_MS = 500;

type PaidFoodCoupon = { code: string; orderId: string; buyerName: string; buyerEmail: string; buyerMobile: string; itemName: string; amountPaisa: number; status: 'ISSUED' | 'REDEEMED'; redeemedAt: string | null; redeemedByName: string | null };

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

function usbReaderChipCode(value: string): string {
  return value.replace(/\D/g, '').slice(-5);
}

function usbReaderValues(value: string): string[] {
  return [...new Set(value
    .split(/[\r\n,;|\t]+/)
    .map((entry) => entry.trim().replace(/\s+/g, '').toUpperCase())
    .filter(Boolean))];
}

function isLikelyRfidEpc(value: string): boolean {
  const compact = value.trim().replace(/\s+/g, '').toUpperCase();
  return compact.length >= 16 && /^[0-9A-F]+$/.test(compact);
}

function returnedChipCode(value: string, method: ChipReturnMethod | null): string {
  const raw = value.trim();
  if (!raw || method === 'OVERRIDE') return '';
  return method === 'RFID' || isLikelyRfidEpc(raw) ? usbReaderChipCode(raw) : raw.replace(/\s+/g, '').toUpperCase();
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

function PaidFoodScreen({ eventId }: { eventId: string }) {
  const [query, setQuery] = useState('');
  const [coupons, setCoupons] = useState<PaidFoodCoupon[]>([]);
  const [loading, setLoading] = useState(false);
  const [redeeming, setRedeeming] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  async function search() {
    if (!query.trim()) { setFeedback({ ok: false, message: 'Enter a coupon code, order ID, mobile number or email.' }); return; }
    setLoading(true); setFeedback(null);
    try {
      const result = await apiRequest<{ coupons: PaidFoodCoupon[] }>(`/api/mobile/volunteer/paid-food?eventId=${encodeURIComponent(eventId)}&query=${encodeURIComponent(query.trim())}`);
      setCoupons(result.coupons); if (!result.coupons.length) setFeedback({ ok: false, message: 'No paid-food order matched this event and search.' });
    } catch (caught) { setFeedback({ ok: false, message: caught instanceof Error ? caught.message : 'Paid-food search failed.' }); }
    finally { setLoading(false); }
  }

  async function redeem(coupon: PaidFoodCoupon) {
    setRedeeming(coupon.code); setFeedback(null);
    try {
      const updated = await apiRequest<PaidFoodCoupon>('/api/mobile/volunteer/paid-food', { method: 'POST', body: JSON.stringify({ eventId, code: coupon.code }) });
      setCoupons((current) => current.map((row) => row.code === updated.code ? updated : row));
      setFeedback({ ok: true, message: `${updated.itemName} redeemed for ${updated.buyerName}.` });
    } catch (caught) { setFeedback({ ok: false, message: caught instanceof Error ? caught.message : 'Coupon redemption failed.' }); }
    finally { setRedeeming(''); }
  }

  return <View>
    <View style={styles.searchRow}><TextInput value={query} onChangeText={(value) => setQuery(isLikelyRfidEpc(value) ? '' : value)} onSubmitEditing={() => void search()} showSoftInputOnFocus autoCapitalize="characters" placeholder="Coupon, order, mobile or email" placeholderTextColor="#7c898f" style={styles.searchInput} /><Pressable disabled={loading} onPress={() => void search()} style={[styles.searchButton, loading && styles.disabled]}>{loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.searchButtonText}>FIND</Text>}</Pressable></View>
    {feedback ? <Text style={feedback.ok ? styles.success : styles.errorText}>{feedback.message}</Text> : null}
    {coupons.map((coupon) => <View key={coupon.code} style={styles.athleteCard}><View style={styles.athleteTop}><View style={styles.bibBox}><Text style={styles.bibLabel}>COUPON</Text><Text style={styles.bibValue}>{coupon.code}</Text></View><View style={styles.athleteIdentity}><Text style={styles.athleteName}>{coupon.buyerName}</Text><Text style={styles.athleteMeta}>Order {coupon.orderId}{coupon.buyerMobile ? ` · ${coupon.buyerMobile}` : coupon.buyerEmail ? ` · ${coupon.buyerEmail}` : ''}</Text></View><Text style={[styles.status, coupon.status === 'REDEEMED' && styles.statusDone]}>{coupon.status}</Text></View><View style={styles.facts}><Text style={styles.fact}>Item: {coupon.itemName}</Text><Text style={styles.fact}>Paid: ₹{(coupon.amountPaisa / 100).toFixed(2)}</Text>{coupon.redeemedAt ? <Text style={[styles.fact, styles.factConfirmed]}>Redeemed {formatted(coupon.redeemedAt)}{coupon.redeemedByName ? ` · ${coupon.redeemedByName}` : ''}</Text> : null}</View><Pressable disabled={coupon.status === 'REDEEMED' || redeeming === coupon.code} onPress={() => Alert.alert('Redeem paid food?', `${coupon.itemName} · ${coupon.buyerName} · coupon ${coupon.code}`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Redeem', onPress: () => void redeem(coupon) }])} style={[styles.actionButton, coupon.status === 'REDEEMED' && styles.doneButton, (coupon.status === 'REDEEMED' || redeeming === coupon.code) && styles.disabled]}>{redeeming === coupon.code ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionButtonText}>{coupon.status === 'REDEEMED' ? 'ALREADY REDEEMED' : 'REDEEM PURCHASED ITEM'}</Text>}</Pressable></View>)}
  </View>;
}

export function DashboardScreen({ session, onRefreshSession, onOpenAthleteProfile, onLogout }: { session: VolunteerSession; onRefreshSession: () => Promise<void>; onOpenAthleteProfile?: () => Promise<void>; onLogout: () => Promise<void> }) {
  const searchInputRef = useRef<TextInput>(null);
  const chipSearchInputRef = useRef<TextInput>(null);
  const chipCodeInputRef = useRef<TextInput>(null);
  const chipReturnInputRef = useRef<TextInput>(null);
  const readerCaptureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chipReturnCaptureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assignmentCodeRef = useRef('');
  const chipReturnCodeRef = useRef('');
  const readerAssignmentInFlightRef = useRef(false);
  const rejectNonChipReaderInputUntilRef = useRef(0);
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
  const [scannerMode, setScannerMode] = useState<'athlete-search' | 'assignment-code' | 'waiver-band-code' | 'chip-return-code'>('athlete-search');
  const [assignmentCode, setAssignmentCode] = useState('');
  const [chipAssignmentMethod, setChipAssignmentMethod] = useState<'MANUAL' | 'QR' | 'RFID_READER'>('MANUAL');
  const [chipReturnMethod, setChipReturnMethod] = useState<ChipReturnMethod | null>(null);
  const [chipReturnCode, setChipReturnCode] = useState('');
  const [chipReturnReason, setChipReturnReason] = useState('');
  const [readerCaptureComplete, setReaderCaptureComplete] = useState(false);
  const [chipReturnCaptureComplete, setChipReturnCaptureComplete] = useState(false);
  const [chipBibKeypadOpen, setChipBibKeypadOpen] = useState(false);
  const [bikeBibKeypadOpen, setBikeBibKeypadOpen] = useState(false);
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
  const timingRefreshGeneration = useRef(0);
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
  const [customCounterId, setCustomCounterId] = useState(assignment?.customCounters?.[0]?.id || '');
  const deviceTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Device local time', []);

  function updateNonChipInput(value: string, setter: (next: string) => void): boolean {
    if (Date.now() < rejectNonChipReaderInputUntilRef.current) {
      setter('');
      return false;
    }
    if (isLikelyRfidEpc(value)) {
      rejectNonChipReaderInputUntilRef.current = Date.now() + 750;
      setter('');
      setMessage(null);
      setError('RFID ignored here. RFID is accepted only in the Timing Chip Assignment chip-code field.');
      return false;
    }
    setter(value);
    return true;
  }

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

  useEffect(() => () => {
    if (readerCaptureTimerRef.current) clearTimeout(readerCaptureTimerRef.current);
    if (chipReturnCaptureTimerRef.current) clearTimeout(chipReturnCaptureTimerRef.current);
  }, []);

  useEffect(() => {
    const eventId = assignment?.eventId;
    const generation = ++timingRefreshGeneration.current;
    if (module !== 'MANUAL_TIMING' || !eventId) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setRecentTiming([]);
      setRecentTimingLoading(true);
      try {
        const data = await apiRequest<{ recent: ManualTimingStamp[]; contestGunStarts: ContestGunStart[] }>(`/api/mobile/volunteer/manual-timing?eventId=${encodeURIComponent(eventId)}`);
        if (active && generation === timingRefreshGeneration.current) {
          setRecentTiming(data.recent);
          setContestGunStarts(data.contestGunStarts || []);
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Recent timing stamps could not be loaded.');
      } finally {
        if (active) setRecentTimingLoading(false);
      }
    })();
    return () => { active = false; ++timingRefreshGeneration.current; };
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
    if (chipAssignmentMethod === 'RFID_READER' && !readerCaptureComplete) return;
    const code = chipAssignmentMethod === 'RFID_READER' ? usbReaderChipCode(assignmentCode) : assignmentCode.trim();
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
  }, [assignment?.eventId, assignmentCode, chipAssignmentMethod, module, readerCaptureComplete]);

  const roles = useMemo(() => [...new Set((assignment?.modules || []).map((role) => role === 'WAIVER_CHECK_IN' ? 'ATHLETE_CHECK_IN' : role))], [assignment]);
  if (!assignment) return <View style={styles.center}><Text style={styles.errorText}>No active event assignment.</Text></View>;
  const selectedTimingPointId = assignment.timingPointIds.includes(timingPointId) ? timingPointId : assignment.timingPointIds[0] || '';
  const searchedRelayTeam = searchData?.participants.find((participant) => participant.relayTeam)?.relayTeam;
  const displayedSearchParticipants = (() => {
    const participants = searchData?.participants || [];
    if ((module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') && searchedRelayTeam) return participants.filter((participant) => participant.participationMode !== 'RELAY');
    if (module !== 'BIKE_CHECK_IN' && module !== 'BIKE_CHECK_OUT') return participants;
    const seenRelayTeams = new Set<string>();
    return participants.filter((participant) => {
      if (participant.participationMode !== 'RELAY') return true;
      const teamKey = participant.relayTeamId || `bib:${participant.bib}`;
      const normalizedRole = (participant.relayMemberRole || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
      if (['cycling', 'cyclist', 'cycle', 'bike', 'biking'].includes(normalizedRole)) return true;
      const hasCyclist = participants.some((member) => (member.relayTeamId || `bib:${member.bib}`) === teamKey && ['cycling', 'cyclist', 'cycle', 'bike', 'biking'].includes((member.relayMemberRole || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ')));
      if (hasCyclist || seenRelayTeams.has(teamKey)) return false;
      seenRelayTeams.add(teamKey);
      return true;
    });
  })();
  const displayedChipParticipants = (() => {
    const participants = searchData?.participants || [];
    const selected: Participant[] = [];
    const relayGroups = new Map<string, Participant[]>();
    for (const participant of participants) {
      if (participant.participationMode !== 'RELAY') selected.push(participant);
      else {
        const key = participant.relayTeamId || `bib:${participant.bib}`;
        relayGroups.set(key, [...(relayGroups.get(key) || []), participant]);
      }
    }
    for (const members of relayGroups.values()) selected.push(members.find((member) => Boolean(member.chipCode)) || members.sort((left, right) => (left.relayMemberNumber ?? 99) - (right.relayMemberNumber ?? 99))[0]);
    return selected;
  })();

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
    if (readerCaptureTimerRef.current) clearTimeout(readerCaptureTimerRef.current);
    if (chipReturnCaptureTimerRef.current) clearTimeout(chipReturnCaptureTimerRef.current);
    assignmentCodeRef.current = '';
    chipReturnCodeRef.current = '';
    chipSearchInputRef.current?.blur();
    chipCodeInputRef.current?.blur();
    setAssignmentId(next.id);
    setModule(next.modules[0] || 'ATHLETE_LOOKUP');
    setChipAssignmentMethod('MANUAL');
    setBikeBibKeypadOpen(false);
    setRoleMenuOpen(false);
    setTimingPointId(next.timingPointIds[0] || '');
    setCustomCounterId(next.customCounters?.[0]?.id || '');
    setQuery(''); setSearchData(null); setAssignmentCode(''); setReaderCaptureComplete(false); setChipReturnMethod(null); setChipReturnCode(''); setChipReturnCaptureComplete(false); setChipReturnReason(''); setMessage(null); setError(null); setWaiverOtpParticipantId(null); setWaiverOtp(''); setSelectedRegistrationIds([]); setSignerName(''); setSignerRelationship(''); setBikeRack(''); setOperationsOverview(null); setExpandedLog(null);
  }

  async function search(value = query, trustedCameraScan = false) {
    const normalized = value.trim();
    if (!normalized) {
      setError(module === 'TIMING_CHIP_ASSIGNMENT_COUNTER'
        ? 'Enter a BIB or scan the athlete band.'
        : module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN'
          ? 'Enter a BIB number, name, email or mobile.'
          : 'Enter or scan a BIB, athlete band, chip, name, email or participant ID.');
      return;
    }
    if (!trustedCameraScan && module !== 'TIMING_CHIP_ASSIGNMENT_COUNTER' && isLikelyRfidEpc(normalized)) {
      setQuery('');
      setError('RFID ignored here. RFID is accepted only for Timing Chip Assignment.');
      return;
    }
    if (module === 'TIMING_CHIP_ASSIGNMENT_COUNTER') {
      chipSearchInputRef.current?.blur();
      Keyboard.dismiss();
      if (!trustedCameraScan && chipAssignmentMethod === 'RFID_READER' && normalized.replace(/[^0-9A-F]/gi, '').length >= 12) {
        setQuery('');
        setError('RFID input is ignored in BIB search. Enter the BIB, tap Search, then read the chip only in the timing-chip field.');
        return;
      }
      if (readerCaptureTimerRef.current) clearTimeout(readerCaptureTimerRef.current);
      setAssignmentCode(''); setReaderCaptureComplete(false); setChipOwner(null); setChipOwnerLoading(false);
    }
    if (chipReturnCaptureTimerRef.current) clearTimeout(chipReturnCaptureTimerRef.current);
    chipReturnCodeRef.current = '';
    setSearching(true); setError(null); setMessage(null); setBikeRack(''); setChipReturnMethod(null); setChipReturnCode(''); setChipReturnCaptureComplete(false); setChipReturnReason('');
    try {
      const bikeRackQuery = module === 'BIKE_CHECK_IN' || module === 'BIKE_CHECK_OUT' ? '&rack=1' : '';
      const waiverSearchModeQuery = module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN'
        ? `&mode=${encodeURIComponent({ 'BIB Number': 'BIB', 'Registration ID': 'REGISTRATION_ID', 'Athlete Band': 'ATHLETE_BAND', 'Name / Email': 'NAME_EMAIL', Mobile: 'MOBILE' }[waiverSearchMode])}`
        : '';
      const data = await apiRequest<ParticipantSearch>(`/api/mobile/volunteer/participants?eventId=${encodeURIComponent(assignment.eventId)}&query=${encodeURIComponent(normalized)}${waiverSearchModeQuery}${bikeRackQuery}`);
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
      else if (module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' && data.participants.some((participant) => !participant.chipCode)) {
        setReaderCaptureComplete(false);
        if (chipAssignmentMethod === 'QR') {
          setMessage('Athlete selected. Opening the camera for the timing chip.');
          setScannerMode('assignment-code');
          setTimeout(() => setScannerOpen(true), 180);
        } else {
          setMessage(chipAssignmentMethod === 'RFID_READER'
            ? 'Athlete selected. Present one chip to the reader, wait for confirmation, then press Assign Chip.'
            : 'Athlete selected. Enter the five-digit chip code, then press Assign Chip.');
          setTimeout(() => chipCodeInputRef.current?.focus(), 180);
        }
      }
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

  async function assignEquipment(participant: Participant, scannedCode = assignmentCode) {
    const kind = module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' ? 'chip' : 'athlete-band';
    const readerAssignment = kind === 'chip' && chipAssignmentMethod === 'RFID_READER';
    if (readerAssignment && !readerCaptureComplete) { setError('Complete the reader scan with Enter or leave the chip field before assigning.'); return; }
    if (readerAssignment && readerAssignmentInFlightRef.current) return;
    const effectiveCode = scannedCode.trim();
    if (!effectiveCode) { setError(`Scan or enter the ${kind === 'chip' ? 'timing chip' : 'athlete band'} code.`); return; }
    if (readerAssignment) readerAssignmentInFlightRef.current = true;
    setBusyId(participant.id); setError(null); setMessage(null);
    try {
      const updated = await apiRequest<Participant>('/api/mobile/volunteer/equipment-assignment', {
        method: 'POST', body: JSON.stringify({ eventId: assignment.eventId, participantId: participant.id, kind, code: effectiveCode, ...(kind === 'chip' ? { assignmentMethod: chipAssignmentMethod } : {}) }),
      });
      if (kind === 'chip' && participant.participationMode === 'RELAY') {
        const refreshed = await apiRequest<ParticipantSearch>(`/api/mobile/volunteer/participants?eventId=${encodeURIComponent(assignment.eventId)}&query=${encodeURIComponent(participant.bib)}`);
        setSearchData(refreshed);
      } else replaceParticipant(updated);
      setAssignmentCode(''); setReaderCaptureComplete(false); setChipOwner(null); setChipOwnerLoading(false);
      if (module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') {
        setBandAssignmentOpen(false);
        setBandAssignmentParticipant(null);
      }
      const assignmentSubject = kind === 'chip' && participant.participationMode === 'RELAY' ? participant.relayTeamName || `Relay Team ${participant.bib}` : participant.name;
      const equipmentLabel = kind === 'chip'
        ? participant.participationMode === 'RELAY' ? 'team timing chip' : 'timing chip'
        : 'athlete band';
      setMessage(`${assignmentSubject}: ${equipmentLabel} ${kind === 'chip' ? updated.chipCode : updated.athleteBandCode} assigned.`);
      void refreshOperationsOverview(assignment.eventId, true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The assignment could not be saved.');
    } finally {
      if (readerAssignment) readerAssignmentInFlightRef.current = false;
      setBusyId(null);
    }
  }

  function updateChipCode(value: string) {
    if (module !== 'TIMING_CHIP_ASSIGNMENT_COUNTER') return;
    if (chipAssignmentMethod === 'RFID_READER') {
      if (readerCaptureComplete) return;
      assignmentCodeRef.current = value;
      const reads = usbReaderValues(value);
      if (reads.length > 1) {
        if (readerCaptureTimerRef.current) clearTimeout(readerCaptureTimerRef.current);
        setAssignmentCode('');
        setReaderCaptureComplete(true);
        setChipOwner(null);
        setChipOwnerLoading(false);
        setMessage(null);
        setError('Multiple RFID tags were detected. Keep one chip near the reader, then tap Read Chip Again.');
        chipCodeInputRef.current?.blur();
        return;
      }
      // Keep the native field uncontrolled while HID keystrokes arrive.
      // Re-rendering a controlled field per character can move the iOS cursor
      // and transpose a fast reader frame (for example 29289 -> 28928).
      if (readerCaptureTimerRef.current) clearTimeout(readerCaptureTimerRef.current);
      readerCaptureTimerRef.current = setTimeout(() => finishReaderCapture(assignmentCodeRef.current, true), RFID_READER_SETTLE_MS);
      return;
    }
    const code = chipAssignmentMethod === 'MANUAL' ? value.replace(/\D/g, '').slice(0, 5) : value.trim();
    setAssignmentCode(code);
    setChipOwner(null);
    setChipOwnerLoading(code.length >= 2);
  }

  function finishReaderCapture(value = assignmentCodeRef.current || assignmentCode, settled = false) {
    if (readerCaptureTimerRef.current) clearTimeout(readerCaptureTimerRef.current);
    if (chipAssignmentMethod !== 'RFID_READER') {
      Keyboard.dismiss();
      return;
    }
    if (readerCaptureComplete) return;
    assignmentCodeRef.current = value;
    if (!settled) {
      readerCaptureTimerRef.current = setTimeout(() => finishReaderCapture(assignmentCodeRef.current, true), RFID_READER_SETTLE_MS);
      setMessage('Reading timing chip…');
      setError(null);
      return;
    }
    const reads = usbReaderValues(value);
    const code = usbReaderChipCode(reads[0] || value);
    if (reads.length > 1) {
      setAssignmentCode('');
      setReaderCaptureComplete(true);
      setChipOwner(null);
      setChipOwnerLoading(false);
      setMessage(null);
      setError('Multiple RFID tags were detected. Keep one chip near the reader, then tap Read Chip Again.');
      chipCodeInputRef.current?.blur();
      return;
    }
    if (code.length !== 5) {
      setMessage(null);
      setError('The RFID reader did not return a valid five-digit chip code. Tap the chip-code field and read one chip again.');
      return;
    }
    setAssignmentCode(code);
    assignmentCodeRef.current = code;
    chipCodeInputRef.current?.setNativeProps({ text: code });
    setReaderCaptureComplete(true);
    setChipOwner(null);
    setChipOwnerLoading(true);
    setError(null);
    setMessage(`Chip ${code} read. Press Assign Chip to save it.`);
  }

  function readChipAgain() {
    if (readerCaptureTimerRef.current) clearTimeout(readerCaptureTimerRef.current);
    setAssignmentCode('');
    assignmentCodeRef.current = '';
    chipCodeInputRef.current?.setNativeProps({ text: '' });
    setReaderCaptureComplete(false);
    setChipOwner(null);
    setChipOwnerLoading(false);
    setMessage('Tap the chip-code field, present one chip to the reader, then press Assign Chip.');
    setError(null);
    setTimeout(() => chipCodeInputRef.current?.focus(), 50);
  }

  function updateChipReturnCode(value: string) {
    chipReturnCodeRef.current = value;
    if (chipReturnCaptureComplete) setChipReturnCaptureComplete(false);
    if (chipReturnCaptureTimerRef.current) clearTimeout(chipReturnCaptureTimerRef.current);
    chipReturnCaptureTimerRef.current = setTimeout(() => finishChipReturnCapture(chipReturnCodeRef.current, true), RFID_READER_SETTLE_MS);
  }

  function finishChipReturnCapture(value = chipReturnCodeRef.current || chipReturnCode, settled = false) {
    if (chipReturnCaptureTimerRef.current) clearTimeout(chipReturnCaptureTimerRef.current);
    chipReturnCodeRef.current = value;
    if (!settled) {
      chipReturnCaptureTimerRef.current = setTimeout(() => finishChipReturnCapture(chipReturnCodeRef.current, true), RFID_READER_SETTLE_MS);
      setMessage('Reading returned timing chip…');
      setError(null);
      return;
    }
    const reads = usbReaderValues(value);
    if (reads.length > 1) {
      setChipReturnCode('');
      chipReturnCodeRef.current = '';
      setChipReturnCaptureComplete(false);
      setMessage(null);
      setError('Multiple RFID tags were detected. Keep only the returned chip near the reader and scan again.');
      return;
    }
    const code = usbReaderChipCode(reads[0] || value);
    if (code.length !== 5) {
      setChipReturnCaptureComplete(false);
      setMessage(null);
      setError('The RFID reader did not return a complete five-digit chip code. Keep the chip in place and scan again.');
      return;
    }
    setChipReturnCode(code);
    chipReturnCodeRef.current = code;
    chipReturnInputRef.current?.setNativeProps({ text: code });
    setChipReturnCaptureComplete(true);
    setError(null);
    setMessage(`Returned chip ${code} read. Confirm the code before bike checkout.`);
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

  async function runAction(participant: Participant, action: ActionName, confirmedHelmetCheck = helmetChecked, chipReturn?: { method: ChipReturnMethod; code?: string; reason?: string }) {
    setBusyId(participant.id); setError(null); setMessage(null);
    try {
      const updated = await apiRequest<Participant>('/api/mobile/volunteer/actions', {
        method: 'POST',
        body: JSON.stringify({ eventId: assignment.eventId, participantId: participant.id, action, helmetChecked: confirmedHelmetCheck, bikeRack: action === 'BIKE_IN' ? participant.assignedBikeRack || bikeRack : bikeRack, lockerNumber, ...(action === 'BIKE_OUT' ? { chipReturnMethod: participant.chipCode ? chipReturn?.method : 'NO_CHIP_ASSIGNED', scannedChipCode: chipReturn?.code, chipReturnReason: chipReturn?.reason } : {}) }),
      });
      replaceParticipant(updated);
      setMessage(`${participant.name}: ${action.replace(/_/g, ' ').toLowerCase()} recorded.`);
      if (action === 'BIKE_IN') { setHelmetChecked(false); setBikeRack(''); }
      if (action === 'BIKE_OUT') { setChipReturnMethod(null); setChipReturnCode(''); setChipReturnReason(''); }
      if (action === 'LOCKER_ASSIGN') setLockerNumber('');
      void refreshOperationsOverview(assignment.eventId, true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The action could not be recorded.'); }
    finally { setBusyId(null); }
  }

  async function runCustomCounterAction(participant: Participant) {
    const counter = assignment.customCounters?.find((row) => row.id === customCounterId) || assignment.customCounters?.[0];
    if (!counter) { setError('No custom counter is assigned.'); return; }
    setBusyId(participant.id); setError(null); setMessage(null);
    try {
      await apiRequest('/api/mobile/volunteer/custom-counters', { method: 'POST', body: JSON.stringify({ eventId: assignment.eventId, counterId: counter.id, participantId: participant.id }) });
      setMessage(`${participant.name}: ${counter.itemName} recorded at ${counter.name}.`);
      setSearchData(null); setQuery('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The custom counter action could not be recorded.'); }
    finally { setBusyId(null); }
  }

  async function sendWaiverOtp(participant: Participant) {
    setBusyId(participant.id); setError(null); setMessage(null);
    try {
      const selectedForProfile = selectedRegistrationIds.filter((id) => searchData?.participants.some((row) => row.participantId === participant.participantId && row.registrationId === id));
      const result = await apiRequest<{ sent: boolean; email: string; destination: string; channel: 'BOTH' | 'WHATSAPP' | 'EMAIL'; expiresInSeconds: number; message: string }>('/api/mobile/volunteer/waiver-otp/request', {
        method: 'POST', body: JSON.stringify({ eventId: assignment.eventId, participantId: participant.id, registrationIds: selectedForProfile.length ? selectedForProfile : [participant.registrationId] }),
      });
      if (!result.sent) throw new Error(result.message || 'The waiver OTP was not accepted. The athlete remains unchecked-in.');
      setWaiverOtpParticipantId(participant.id);
      setWaiverOtp('');
      setSignerName(participant.name);
      setSignerRelationship('SELF');
      setMessage(result.message);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The waiver OTP could not be sent.'); }
    finally { setBusyId(null); }
  }

  async function verifyWaiverOtp(participant: Participant) {
    if (!/^\d{6}$/.test(waiverOtp)) { setError('Enter the complete six-digit OTP sent to the athlete.'); return; }
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
      setMessage(`${participant.name}: waiver signed and check-in completed for ${result.coveredRegistrationIds.length} registration${result.coveredRegistrationIds.length === 1 ? '' : 's'}.`);
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
    const subject = participant.participationMode === 'RELAY'
      ? `${participant.relayTeamName || 'Relay team'} · Team BIB ${participant.bib || '—'}\nCycling member: ${participant.name}`
      : `${participant.name} · BIB ${participant.bib || '—'}`;
    if (participant.state.bikeCheckedInAt) {
      Alert.alert('Bike check-in already completed', `${subject} already has a bike check-in record. Only an administrator can reset it.`);
      return;
    }
    Alert.alert('Check bike in?', `${subject}\nRack: ${participant.assignedBikeRack || bikeRack.trim() || 'Not assigned'}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => void runAction(participant, 'BIKE_IN') },
    ]);
  }

  function confirmBikeCheckout(participant: Participant) {
    const subject = participant.participationMode === 'RELAY'
      ? `${participant.relayTeamName || 'Relay team'} · Team BIB ${participant.bib || '—'}\nCycling member: ${participant.name}`
      : `${participant.name} · BIB ${participant.bib || '—'}`;
    if (!participant.state.bikeCheckedInAt) {
      Alert.alert('Bike entry required', `${subject} has no bike check-in recorded for this event. Record or reconcile bike entry before checkout.`);
      return;
    }
    if (participant.state.bikeCheckedOutAt) {
      Alert.alert('Bike already checked out', `${subject} has already collected the bike.`);
      return;
    }
    const normalizedAssigned = participant.chipCode.trim().toUpperCase();
    const normalizedReturned = returnedChipCode(chipReturnCode, chipReturnMethod);
    if (normalizedAssigned && chipReturnMethod !== 'OVERRIDE' && !normalizedReturned) {
      Alert.alert('Chip return required', 'Scan the assigned chip or select No Chip to Return.');
      return;
    }
    if (normalizedAssigned && chipReturnMethod !== 'OVERRIDE' && normalizedReturned !== normalizedAssigned) {
      Alert.alert('Chip mismatch', `Assigned chip ${normalizedAssigned}; scanned chip ${normalizedReturned || '—'}. Checkout is blocked.`);
      return;
    }
    if (normalizedAssigned && chipReturnMethod === 'OVERRIDE' && !chipReturnReason) {
      Alert.alert('Reason required', 'Select why the chip was not returned.');
      return;
    }
    const returnSummary = !normalizedAssigned ? 'No timing chip was assigned.' : chipReturnMethod === 'OVERRIDE' ? `Chip not returned · ${chipReturnReason}` : `Return chip ${normalizedReturned}`;
    Alert.alert('Confirm bike checkout', `${subject}\n${returnSummary}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm return & checkout', onPress: () => void runAction(participant, 'BIKE_OUT', helmetChecked, { method: chipReturnMethod || 'OVERRIDE', code: chipReturnCode, reason: chipReturnReason }) },
    ]);
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
    const generation = ++timingRefreshGeneration.current;
    if (!silent) setRecentTimingLoading(true);
    try {
      const data = await apiRequest<{ recent: ManualTimingStamp[]; contestGunStarts: ContestGunStart[] }>(`/api/mobile/volunteer/manual-timing?eventId=${encodeURIComponent(eventId)}`);
      if (generation !== timingRefreshGeneration.current) return;
      setContestGunStarts(data.contestGunStarts || []);
      setRecentTiming(current => mergeTimingRefresh(current, data.recent));
    } catch (caught) {
      if (!silent) setError(caught instanceof Error ? caught.message : 'Recent timing stamps could not be loaded.');
    }
    finally { if (!silent) setRecentTimingLoading(false); }
  }

  async function stampManualTiming(replaceExisting = false) {
    const bib = query.trim();
    if (!bib) { setError('Enter a BIB number.'); return; }
    if (assignment.timingScope !== 'AUTO' && !selectedTimingPointId) { setError('Choose an assigned timing point.'); return; }
    const duplicate = recentTiming.find((row) => row.bib.toUpperCase() === bib.toUpperCase() && (!selectedTimingPointId || row.timingPointName === assignment.timingPointNames[assignment.timingPointIds.indexOf(selectedTimingPointId)]));
    if (duplicate && !duplicate.canReset) { setError('This stamp is locked. Ask an administrator to reset or correct it in the web logs.'); return; }
    if (duplicate && !replaceExisting) {
      Alert.alert('Replace existing stamp?', `BIB ${bib} already has an active stamp at ${duplicate.timingPointName || 'this timing point'}. The original will remain in the audit log as reset.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Replace', style: 'destructive', onPress: () => void stampManualTiming(true) }]);
      return;
    }
    const deviceCapturedAt = new Date().toISOString();
    ++timingRefreshGeneration.current;
    setBusyId('manual-timing'); setError(null); setMessage(null);
    try {
      const result = await apiRequest<{ id: string; participant: Participant; timingPointName: string; capturedAt: string; timingMode: 'GUN' | 'TIMING_POINT'; gunTime: string | null; elapsedTime: string | null; elapsedStartSource: 'CHIP' | 'GUN' | null }>('/api/mobile/volunteer/manual-timing', {
        method: 'POST',
        body: JSON.stringify({ eventId: assignment.eventId, participantId: bib, ...(selectedTimingPointId ? { timingPointId: selectedTimingPointId } : {}), capturedAt: deviceCapturedAt, deviceTimeZone, replaceExisting }),
      });
      setQuery('');
      const confirmedStamp: ManualTimingStamp = {
        id: result.id,
        canReset: true,
        bib: result.participant.bib || bib,
        athleteName: result.participant.name,
        timingPointName: result.timingPointName,
        timingMode: result.timingMode,
        gunTime: result.gunTime,
        elapsedTime: result.elapsedTime,
        elapsedStartSource: result.elapsedStartSource,
        capturedAt: result.capturedAt,
        status: result.elapsedTime ? 'RECORDED' : 'RECORDED · START REQUIRED',
      };
      ++timingRefreshGeneration.current;
      setRecentTiming((current) => [confirmedStamp, ...current.filter((row) => row.id !== confirmedStamp.id).map(row => ({ ...row, canReset: false }))].slice(0, 50));
      setMessage(`BIB ${result.participant.bib || bib} stamped at ${timeOfDay(new Date(result.capturedAt))}${result.elapsedTime ? ` · ${result.elapsedStartSource === 'CHIP' ? 'Chip' : 'Gun fallback'} ${result.elapsedTime}` : ' · Start pending'}`);
      void refreshRecentTiming(assignment.eventId, true);
      setTimeout(() => searchInputRef.current?.focus(), 0);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Timing read could not be recorded.'); }
    finally { setBusyId(null); }
  }

  function confirmResetTiming(row: ManualTimingStamp) {
    if (!row.canReset || busyId || resettingTimingId) return;
    Alert.alert('Reset timing stamp?', `BIB ${row.bib || '—'} · ${timeOfDay(new Date(row.capturedAt))}\nThe original audit record will be preserved.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => void resetTiming(row) },
    ]);
  }

  async function resetTiming(row: ManualTimingStamp) {
    if (!row.canReset || busyId || resettingTimingId) return;
    ++timingRefreshGeneration.current;
    setResettingTimingId(row.id); setError(null); setMessage(null);
    try {
      await apiRequest(`/api/mobile/volunteer/manual-timing?eventId=${encodeURIComponent(assignment.eventId)}&operationId=${encodeURIComponent(row.id)}`, { method: 'DELETE' });
      ++timingRefreshGeneration.current;
      setRecentTiming((current) => current.filter((item) => item.id !== row.id).map(item => ({ ...item, canReset: false })));
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
      ? [['CHIP ASSIGNMENT TARGETS', overview?.chipAssignmentTargets], ['BIKE-IN RECORDED', overview?.bikesEverCheckedIn], ['CHIPS ASSIGNED TO BIKE-INS', overview?.chipsAssignedToBikeEntries], ['BIKE-INS NEEDING CHIP', overview?.remainingToAssignFromBikeEntries]] as const
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
      if (participant.state.checkedInAt) return <View style={styles.checkInComplete}><Text style={styles.checkInCompleteText}>✓ CHECKED IN</Text></View>;
      if (assignment.waiverRequired && !participant.state.waiverVerifiedAt) {
        if (waiverOtpParticipantId !== participant.id) return <Pressable disabled={pending} style={[styles.actionButton, pending && styles.disabled]} onPress={() => void sendWaiverOtp(participant)}><Text style={styles.actionButtonText}>SEND OTP BY EMAIL & WHATSAPP</Text></Pressable>;
        return <View style={styles.waiverOtpPanel}>
          <Text style={styles.waiverOtpHelp}>Ask the participant to use Copy Code in WhatsApp or read the six-digit code. Verification signs the selected waiver and completes check-in.</Text>
          {searchData?.event.waiverPolicy.requireGuardianSignatureForMinors && isMinorAtEvent(participant, assignment.eventDate) ? <><TextInput value={signerName} onChangeText={(value) => updateNonChipInput(value, setSignerName)} showSoftInputOnFocus placeholder="Parent / guardian full name" placeholderTextColor="#84939c" style={styles.waiverOtpInput} /><TextInput value={signerRelationship} onChangeText={(value) => updateNonChipInput(value, setSignerRelationship)} showSoftInputOnFocus placeholder="Relationship to participant" placeholderTextColor="#84939c" style={styles.waiverOtpInput} /></> : null}
          <TextInput autoFocus keyboardType="number-pad" maxLength={6} value={waiverOtp} onChangeText={(value) => setWaiverOtp(value.replace(/\D/g, '').slice(0, 6))} showSoftInputOnFocus placeholder="6-digit OTP" placeholderTextColor="#84939c" style={styles.waiverOtpInput} />
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
      return <><View style={styles.inlineInput}><View style={styles.helmetLabel}><Text style={[styles.inlineLabel, helmetConfirmed && styles.factConfirmedText]}>{helmetConfirmed ? '✓ ' : ''}Helmet checked (optional)</Text><Text style={styles.optionalHelp}>Bike check-in works whether this is on or off.</Text></View><Pressable accessibilityRole="switch" accessibilityLabel="Helmet checked" accessibilityState={{ checked: helmetConfirmed }} onPress={() => setHelmetChecked((current) => !current)} style={[styles.helmetSwitch, helmetConfirmed && styles.helmetSwitchOn]}>{helmetConfirmed ? <><Text style={[styles.helmetSwitchText, styles.helmetSwitchTextOn]}>ON</Text><View style={[styles.helmetSwitchThumb, styles.helmetSwitchThumbOn]} /></> : <><View style={styles.helmetSwitchThumb} /><Text style={styles.helmetSwitchText}>OFF</Text></>}</Pressable></View>{!participant.assignedBikeRack ? <TextInput value={bikeRack} onChangeText={(value) => updateNonChipInput(value, setBikeRack)} showSoftInputOnFocus placeholder="Rack / bay (optional — no range assigned)" placeholderTextColor="#7c898f" style={styles.smallInput} /> : null}<Pressable disabled={pending} style={[styles.actionButton, pending && styles.disabled]} onPress={() => confirmBikeEntry(participant)}><Text style={styles.actionButtonText}>Record bike entry</Text></Pressable></>;
    }
    if (module === 'BIKE_CHECK_OUT') {
      const assigned = participant.chipCode.trim().toUpperCase();
      const scanned = chipReturnMethod === 'RFID' && !chipReturnCaptureComplete
        ? ''
        : returnedChipCode(chipReturnCode, chipReturnMethod);
      const mismatch = Boolean(assigned && scanned && scanned !== assigned);
      const completed = Boolean(participant.state.bikeCheckedOutAt);
      const returnReady = !assigned || chipReturnMethod === 'OVERRIDE'
        ? !assigned || Boolean(chipReturnReason)
        : chipReturnMethod === 'RFID'
          ? chipReturnCaptureComplete && Boolean(scanned)
          : Boolean(scanned);
      return <>
        <View style={styles.chipReturnPanel}>
          <Text style={styles.chipReturnTitle}>RFID CHIP RETURN</Text>
          <View style={styles.chipReturnFacts}><Text style={styles.chipReturnFact}>Assigned chip: {assigned || 'N/A'}</Text><Text style={styles.chipReturnFact}>Returned chip: {participant.state.returnedChipCode || scanned || 'N/A'}</Text><Text style={[styles.chipReturnFact, participant.state.chipReturnStatus === 'RETURNED' && styles.factConfirmedText, mismatch && styles.factWarning]}>Status: {completed ? participant.state.chipReturnStatus.replaceAll('_', ' ') : mismatch ? 'CHIP MISMATCH' : assigned ? 'PENDING RETURN' : 'NO CHIP ASSIGNED'}</Text></View>
          {!completed && assigned ? <>
            <View style={styles.chipReturnMethods}>
              <Pressable onPress={() => { if (chipReturnCaptureTimerRef.current) clearTimeout(chipReturnCaptureTimerRef.current); chipReturnCodeRef.current = ''; setChipReturnMethod('CAMERA'); setChipReturnCode(''); setChipReturnCaptureComplete(false); setChipReturnReason(''); setScannerMode('chip-return-code'); setScannerOpen(true); }} style={[styles.chipReturnMethod, chipReturnMethod === 'CAMERA' && styles.chipReturnMethodActive]}><Text style={[styles.chipReturnMethodText, chipReturnMethod === 'CAMERA' && styles.chipReturnMethodTextActive]}>CAMERA</Text></Pressable>
              <Pressable onPress={() => { if (chipReturnCaptureTimerRef.current) clearTimeout(chipReturnCaptureTimerRef.current); chipReturnCodeRef.current = ''; setChipReturnMethod('RFID'); setChipReturnCode(''); setChipReturnCaptureComplete(false); setChipReturnReason(''); setMessage('Keep one returned chip near the reader until the five-digit code is confirmed.'); setError(null); setTimeout(() => chipReturnInputRef.current?.focus(), 150); }} style={[styles.chipReturnMethod, chipReturnMethod === 'RFID' && styles.chipReturnMethodActive]}><Text style={[styles.chipReturnMethodText, chipReturnMethod === 'RFID' && styles.chipReturnMethodTextActive]}>RFID READER</Text></Pressable>
              <Pressable onPress={() => { if (chipReturnCaptureTimerRef.current) clearTimeout(chipReturnCaptureTimerRef.current); chipReturnCodeRef.current = ''; setChipReturnMethod('MANUAL'); setChipReturnCode(''); setChipReturnCaptureComplete(false); setChipReturnReason(''); setMessage('Enter the five-digit code printed on the returned timing chip.'); setError(null); setTimeout(() => chipReturnInputRef.current?.focus(), 150); }} style={[styles.chipReturnMethod, chipReturnMethod === 'MANUAL' && styles.chipReturnMethodActive]}><Text style={[styles.chipReturnMethodText, chipReturnMethod === 'MANUAL' && styles.chipReturnMethodTextActive]}>MANUAL</Text></Pressable>
              <Pressable onPress={() => { if (chipReturnCaptureTimerRef.current) clearTimeout(chipReturnCaptureTimerRef.current); chipReturnCodeRef.current = ''; setChipReturnMethod('OVERRIDE'); setChipReturnCode(''); setChipReturnCaptureComplete(false); }} style={[styles.chipReturnMethod, chipReturnMethod === 'OVERRIDE' && styles.chipReturnMethodDanger]}><Text style={[styles.chipReturnMethodText, chipReturnMethod === 'OVERRIDE' && styles.chipReturnMethodTextActive]}>NO CHIP</Text></Pressable>
            </View>
            {chipReturnMethod === 'RFID' ? <TextInput ref={chipReturnInputRef} onChangeText={updateChipReturnCode} onSubmitEditing={({ nativeEvent }) => finishChipReturnCapture(nativeEvent.text || chipReturnCodeRef.current)} onBlur={() => { if (chipReturnCodeRef.current.trim() && !chipReturnCaptureComplete) finishChipReturnCapture(); }} autoCapitalize="characters" autoCorrect={false} autoComplete="off" spellCheck={false} showSoftInputOnFocus={false} placeholder={chipReturnCaptureComplete ? 'Returned chip captured' : 'Present one chip to RFID reader'} placeholderTextColor="#7c898f" style={[styles.chipCodeInput, chipReturnCaptureComplete && styles.chipCodeInputLocked]} /> : null}
            {chipReturnMethod === 'MANUAL' ? <TextInput ref={chipReturnInputRef} value={chipReturnCode} onChangeText={(value) => { const code = value.replace(/\D/g, '').slice(0, 5); chipReturnCodeRef.current = code; setChipReturnCode(code); setMessage(code.length === 5 ? `Manual chip ${code} ready. Confirm it before checkout.` : 'Enter all five digits from the timing chip.'); setError(null); }} keyboardType="number-pad" inputMode="numeric" maxLength={5} showSoftInputOnFocus autoCorrect={false} placeholder="Enter 5-digit chip code" placeholderTextColor="#7c898f" style={styles.chipCodeInput} /> : null}
            {chipReturnMethod === 'OVERRIDE' ? <View style={styles.chipReturnReasons}>{CHIP_RETURN_REASONS.map((reason) => <Pressable key={reason} onPress={() => setChipReturnReason(reason)} style={[styles.chipReturnReason, chipReturnReason === reason && styles.chipReturnReasonActive]}><Text style={[styles.chipReturnReasonText, chipReturnReason === reason && styles.chipReturnReasonTextActive]}>{reason}</Text></Pressable>)}</View> : null}
            {mismatch ? <Text style={styles.chipMismatch}>Chip mismatch. Assigned {assigned}; scanned {scanned}. Checkout is blocked.</Text> : null}
          </> : null}
        </View>
        <Pressable disabled={pending || completed || !participant.state.bikeCheckedInAt || mismatch || !returnReady} style={[styles.actionButton, (pending || completed || !participant.state.bikeCheckedInAt || mismatch || !returnReady) && styles.disabled]} onPress={() => confirmBikeCheckout(participant)}><Text style={styles.actionButtonText}>{completed ? 'BIKE CHECKED OUT' : 'CONFIRM RETURN & BIKE CHECKOUT'}</Text></Pressable>
        {!participant.state.bikeCheckedInAt ? <Text style={styles.athleteMeta}>Bike checkout requires a recorded bike entry.</Text> : null}
      </>;
    }
    if (module === 'MEDAL_COUNTER') return <Pressable disabled={pending || Boolean(participant.state.medalIssuedAt)} style={[styles.actionButton, participant.state.medalIssuedAt && styles.doneButton, participant.state.medalIssuedAt && styles.disabled]} onPress={() => confirmAction(participant, 'MEDAL_ISSUE', 'Issue finisher medal / goodies?')}><Text style={styles.actionButtonText}>{participant.state.medalIssuedAt ? 'Medal / goodies issued' : 'Issue medal / goodies'}</Text></Pressable>;
    if (module === 'FOOD_COUNTER') return <Pressable disabled={pending || Boolean(participant.state.foodIssuedAt)} style={[styles.actionButton, participant.state.foodIssuedAt && styles.doneButton]} onPress={() => confirmAction(participant, 'FOOD_ISSUE', 'Issue food?')}><Text style={styles.actionButtonText}>{participant.state.foodIssuedAt ? 'Food issued' : 'Issue food'}</Text></Pressable>;
    if (module === 'LOCKER_COUNTER') return <><TextInput value={lockerNumber} onChangeText={(value) => updateNonChipInput(value, setLockerNumber)} showSoftInputOnFocus placeholder="Locker number" placeholderTextColor="#7c898f" style={styles.smallInput} /><Pressable disabled={pending || !lockerNumber.trim()} style={[styles.actionButton, !lockerNumber.trim() && styles.disabled]} onPress={() => confirmAction(participant, 'LOCKER_ASSIGN', 'Assign locker?')}><Text style={styles.actionButtonText}>Assign locker</Text></Pressable></>;
    if (module === 'COUNTER' && assignment.customCounters?.length) { const counter = assignment.customCounters.find((row) => row.id === customCounterId) || assignment.customCounters[0]; return <Pressable disabled={pending} style={[styles.actionButton, pending && styles.disabled]} onPress={() => Alert.alert(counter.name, `${counter.actionLabel} ${counter.itemName} to ${participant.name} · BIB ${participant.bib || '—'}?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', onPress: () => void runCustomCounterAction(participant) }])}><Text style={styles.actionButtonText}>{counter.actionLabel.toUpperCase()} {counter.itemName.toUpperCase()}</Text></Pressable>; }
    if (module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' || module === 'ATHLETE_BAND_ASSIGNMENT_COUNTER') return <Pressable disabled={pending || !assignmentCode.trim()} style={[styles.actionButton, !assignmentCode.trim() && styles.disabled]} onPress={() => void assignEquipment(participant)}><Text style={styles.actionButtonText}>ASSIGN {module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' ? 'TIMING CHIP' : 'ATHLETE BAND'}</Text></Pressable>;
    return null;
  }

  return <SafeAreaView style={styles.safe} edges={['top']}>
    <KeyboardSafeScrollView key={`${assignment.id}:${module}`} refreshControl={<RefreshControl refreshing={refreshing} tintColor="#ff6b21" onRefresh={async () => { setRefreshing(true); await Promise.all([onRefreshSession(), refreshOperationsOverview(assignment.eventId, true)]); setRefreshing(false); }} />} keyboardShouldPersistTaps="handled">
      <View style={styles.header}><View style={styles.brandRow}><Image source={volunteerLogo} alt="Race Upshot Volunteer logo" style={styles.brandLogo} /><View><Text style={styles.brand}>RACE UPSHOT</Text><Text style={styles.volunteer}>Volunteer Operations</Text></View></View><View style={styles.headerActions}>{onOpenAthleteProfile ? <Pressable onPress={() => void openAthleteProfile()}><Text style={styles.changeProfile}>ATHLETE</Text></Pressable> : null}<Pressable onPress={() => void onLogout()}><Text style={styles.logout}>SIGN OUT</Text></Pressable></View></View>
      <View style={styles.welcome}><Text style={styles.eyebrow}>SIGNED IN VOLUNTEER</Text><Text style={styles.welcomeTitle}>{session.volunteer.name}</Text><Text style={styles.welcomeCopy}>Only assigned events, roles and timing points are available.</Text></View>

      {session.assignments.length > 1 ? <View style={styles.section}><Text style={styles.sectionLabel}>SELECT EVENT</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>{session.assignments.map((item) => <Pressable key={item.id} onPress={() => chooseAssignment(item)} style={[styles.eventChip, item.id === assignment.id && styles.eventChipActive]}><Text style={[styles.eventChipText, item.id === assignment.id && styles.eventChipTextActive]}>{item.eventName}</Text></Pressable>)}</ScrollView></View> : null}

      <View style={styles.eventCard}><Text style={styles.eventLive}>ACTIVE ASSIGNMENT</Text><Text style={styles.eventName}>{assignment.eventName}</Text><Text style={styles.eventMeta}>{assignment.eventLocation || 'Race venue'}{assignment.eventDate ? ` · ${new Date(assignment.eventDate).toLocaleDateString('en-IN', { dateStyle: 'medium' })}` : ''}</Text><Text style={styles.eventScope}>{roles.length} function{roles.length === 1 ? '' : 's'} · {assignment.timingScope === 'AUTO' ? assignment.manualGunFallback ? 'Manual gun finish' : 'Automatic finish point' : `${assignment.timingPointIds.length} timing point${assignment.timingPointIds.length === 1 ? '' : 's'}`}</Text></View>

      <View style={styles.roleSection}><Text style={styles.sectionLabel}>{roles.length > 1 ? 'SELECT ASSIGNED ROLE' : 'ASSIGNED ROLE'}</Text><Pressable accessibilityRole="button" accessibilityState={{ expanded: roleMenuOpen }} onPress={() => roles.length > 1 && setRoleMenuOpen((current) => !current)} style={styles.roleTrigger}><View style={styles.roleTriggerIdentity}><Text style={styles.roleTriggerIcon}>{moduleCopy[module].icon}</Text><Text style={styles.roleTriggerText}>{moduleCopy[module].label}</Text></View>{roles.length > 1 ? <Text style={styles.roleChevron}>{roleMenuOpen ? '⌃' : '⌄'}</Text> : null}</Pressable>{roleMenuOpen ? <View style={styles.roleMenu}>{roles.map((role, index) => <Pressable key={role} onPress={() => { Keyboard.dismiss(); chipSearchInputRef.current?.blur(); chipCodeInputRef.current?.blur(); setModule(role); setChipAssignmentMethod('MANUAL'); setReaderCaptureComplete(false); setBikeBibKeypadOpen(false); setExpandedLog(null); setRoleMenuOpen(false); setQuery(''); setSearchData(null); setAssignmentCode(''); setChipOwner(null); setChipOwnerLoading(false); setWaiverOtpParticipantId(null); setWaiverOtp(''); setBikeRack(''); setHelmetChecked(false); setError(null); setMessage(null); }} style={[styles.roleOption, index < roles.length - 1 && styles.roleOptionBorder, module === role && styles.roleOptionActive]}><Text style={styles.roleOptionIcon}>{moduleCopy[role].icon}</Text><Text style={[styles.roleOptionText, module === role && styles.roleOptionTextActive]}>{moduleCopy[role].label}</Text>{module === role ? <Text style={styles.roleCheck}>✓</Text> : null}</Pressable>)}</View> : null}</View>

      <RoleErrorBoundary key={`${assignment.id}:${module}`}><View style={styles.workspace}>
        <Text style={[styles.workspaceTitle, module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' && styles.chipWorkspaceTitle]}>{moduleCopy[module].label}</Text><Text style={[styles.workspaceCopy, module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' && styles.chipWorkspaceCopy]}>{moduleCopy[module].detail}</Text>
        {(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') && assignment.waiverRequired ? <Text style={styles.waiverNote}>Event waiver {assignment.waiverVersion ? `version ${assignment.waiverVersion}` : 'is configured'} will be verified as part of athlete check-in.</Text> : null}
        {module === 'COUNTER' && assignment.customCounters?.length ? <View style={styles.pointSection}><Text style={styles.inputLabel}>ASSIGNED CUSTOM COUNTER</Text><View style={styles.pointGrid}>{assignment.customCounters.map((counter) => <Pressable key={counter.id} onPress={() => setCustomCounterId(counter.id)} style={[styles.pointChip, (customCounterId || assignment.customCounters[0]?.id) === counter.id && styles.pointChipActive]}><Text style={[styles.pointText, (customCounterId || assignment.customCounters[0]?.id) === counter.id && styles.pointTextActive]}>{counter.name}</Text><Text style={[styles.athleteMeta, (customCounterId || assignment.customCounters[0]?.id) === counter.id && styles.pointTextActive]}>{counter.itemName}</Text></Pressable>)}</View></View> : null}
        {operationsOverviewPanel()}
        {module === 'MANUAL_TIMING' ? <View style={styles.pointSection}><View style={styles.eventClock}><Text style={styles.eventClockLabel}>EVENT TIME OF DAY · DEVICE CLOCK</Text><Text style={styles.eventClockTime}>{timeOfDay(deviceNow)}</Text><Text style={styles.eventClockMeta}>{calendarDay(deviceNow)} · {deviceTimeZone}</Text><Text style={styles.eventClockSource}>The exact device timestamp is captured when “Stamp now” is pressed.</Text></View><View style={styles.gunStartPanel}><View style={styles.gunStartHeader}><Text style={styles.gunStartTitle}>FEIBOT CONTEST GUN TIMES</Text><Text style={styles.gunStartZone}>IST</Text></View>{contestGunStarts.length ? contestGunStarts.map((contest) => <View key={contest.uuid} style={styles.gunStartRow}><Text style={styles.gunStartName}>{contest.name}</Text><Text style={styles.gunStartTime}>{feibotGunTime(contest.gunStartAt)}</Text></View>) : <Text style={styles.gunStartEmpty}>No Feibot contest gun times are stored. Import timing rules in the admin panel.</Text>}</View><Text style={styles.inputLabel}>{assignment.timingScope === 'AUTO' ? 'AUTOMATIC TIMING MODE' : 'ASSIGNED TIMING POINT'}</Text><View style={styles.pointGrid}>{assignment.timingPointIds.map((id, index) => <Pressable key={id} onPress={() => setTimingPointId(id)} style={[styles.pointChip, selectedTimingPointId === id && styles.pointChipActive]}><Text style={[styles.pointText, selectedTimingPointId === id && styles.pointTextActive]}>{assignment.timingPointNames[index] || id}</Text></Pressable>)}</View>{assignment.timingScope === 'AUTO' ? <Text style={styles.autoTimingNote}>{assignment.manualGunFallback ? 'No provider point is required. Elapsed time uses the athlete’s chip start, with gun or configured start as fallback.' : 'This assignment follows the event FINISH point and uses chip start first, then gun or configured start.'}</Text> : null}</View> : null}
        {module === 'FINISH_LINE_VOLUNTEER'
          ? <FinishLineScreen eventId={assignment.eventId} />
          : module === 'CUTOFF_TIME_VOLUNTEER'
            ? <CutoffTimeScreen eventId={assignment.eventId} />
          : module === 'PAID_FOOD_COUNTER'
            ? <PaidFoodScreen eventId={assignment.eventId} />
          : module === 'FOOD_COUNTER'
            ? <CateringScreen key={assignment.eventId} eventId={assignment.eventId} operatorId={session.volunteer.id} />
          : module === 'MANUAL_TIMING' ? <>
          <View style={styles.bibKeyboardRow}><Text style={styles.bibKeyboardHint}>BIB keyboard</Text><Pressable onPress={() => { setBibKeyboard('numeric'); setTimeout(() => searchInputRef.current?.focus(), 0); }} style={[styles.bibKeyboardOption, bibKeyboard === 'numeric' && styles.bibKeyboardOptionActive]}><Text style={[styles.bibKeyboardOptionText, bibKeyboard === 'numeric' && styles.bibKeyboardOptionTextActive]}>123</Text></Pressable><Pressable onPress={() => { setBibKeyboard('text'); setTimeout(() => searchInputRef.current?.focus(), 0); }} style={[styles.bibKeyboardOption, bibKeyboard === 'text' && styles.bibKeyboardOptionActive]}><Text style={[styles.bibKeyboardOptionText, bibKeyboard === 'text' && styles.bibKeyboardOptionTextActive]}>ABC</Text></Pressable></View>
          <View style={styles.manualStampRow}><TextInput key={bibKeyboard} ref={searchInputRef} value={query} onChangeText={(value) => { if (updateNonChipInput(value, setQuery) && /[A-Za-z]/.test(value)) setBibKeyboard('text'); }} onSubmitEditing={() => void stampManualTiming()} showSoftInputOnFocus keyboardType={bibKeyboard === 'numeric' ? 'number-pad' : 'default'} returnKeyType="done" autoCapitalize="characters" placeholder="Enter BIB" placeholderTextColor="#7c898f" style={styles.searchInput} /><Pressable disabled={!query.trim() || busyId === 'manual-timing'} onPress={() => void stampManualTiming()} style={[styles.manualStampButton, (!query.trim() || busyId === 'manual-timing') && styles.disabled]}>{busyId === 'manual-timing' ? <ActivityIndicator color="#fff" /> : <Text style={styles.manualStampButtonText}>STAMP</Text>}</Pressable></View>
          {message ? <Text style={styles.success}>{message}</Text> : null}{error ? <Text style={styles.errorText}>{error}</Text> : null}
          <View style={styles.recentTimingHeader}><Text style={styles.recentTimingTitle}>RECENT STAMPS</Text><Pressable disabled={recentTimingLoading} onPress={() => void refreshRecentTiming()} style={styles.recentRefresh}><Text style={styles.recentRefreshText}>{recentTimingLoading ? 'LOADING…' : 'REFRESH'}</Text></Pressable></View>
          {recentTimingLoading && recentTiming.length === 0 ? <ActivityIndicator color="#d9233f" style={styles.cardLoader} /> : recentTiming.length === 0 ? <Text style={styles.recentTimingEmpty}>No active Timekeeper stamps for this event.</Text> : recentTiming.map((row) => <View key={row.id} style={styles.recentTimingCard}><View style={styles.recentTimingMain}><Text style={styles.recentTimingBib}>BIB {row.bib || '—'}</Text><Text style={styles.recentTimingName}>{row.athleteName || 'Athlete'}</Text><Text style={styles.recentTimingMeta}>{row.timingPointName || 'Manual Finish'} · {timeOfDay(new Date(row.capturedAt))}{row.elapsedTime ? ` · ${row.elapsedStartSource === 'CHIP' ? 'Chip' : 'Gun fallback'} ${row.elapsedTime}` : row.gunTime ? ` · Gun ${row.gunTime}` : ''}{row.overallRank ? ` · Overall #${row.overallRank}` : ''}{row.categoryRank ? ` · Category #${row.categoryRank}` : ''}{row.genderRank ? ` · Gender #${row.genderRank}` : ''}{row.ageGroupRank ? ` · Age #${row.ageGroupRank}` : ''}</Text>{row.clockWarning ? <Text style={styles.errorText}>{row.clockWarning}</Text> : null}</View><Pressable disabled={!row.canReset || Boolean(busyId) || Boolean(resettingTimingId)} onPress={() => confirmResetTiming(row)} style={[styles.resetTimingButton, (!row.canReset || Boolean(busyId) || Boolean(resettingTimingId)) && styles.disabled]}>{resettingTimingId === row.id ? <ActivityIndicator color="#9b2730" /> : <Text style={styles.resetTimingText}>{row.canReset ? 'RESET' : 'ADMIN ONLY'}</Text>}</Pressable></View>)}
        </>
          : module === 'VOLUNTEER_BAND_ASSIGNMENT_COUNTER' ? <>
          <View style={styles.searchRow}><TextInput value={volunteerQuery} onChangeText={(value) => updateNonChipInput(value, setVolunteerQuery)} onSubmitEditing={() => void searchVolunteerTargets()} showSoftInputOnFocus placeholder="Volunteer name, email or mobile" placeholderTextColor="#7c898f" style={styles.searchInput} /><Pressable onPress={() => void searchVolunteerTargets()} disabled={searching} style={styles.searchButton}>{searching ? <ActivityIndicator color="#fff" /> : <Text style={styles.searchButtonText}>SEARCH</Text>}</Pressable></View>
          <View style={styles.searchRow}><TextInput autoCapitalize="characters" value={assignmentCode} onChangeText={(value) => updateNonChipInput(value, setAssignmentCode)} showSoftInputOnFocus placeholder="Volunteer band code" placeholderTextColor="#7c898f" style={styles.searchInput} /><Pressable onPress={() => { setScannerMode('assignment-code'); setScannerOpen(true); }} style={styles.searchButton}><Text style={styles.searchButtonText}>SCAN BAND</Text></Pressable></View>
          {message ? <Text style={styles.success}>{message}</Text> : null}{error ? <Text style={styles.errorText}>{error}</Text> : null}
          {volunteerTargets.map((target) => <View key={target.id} style={styles.athleteCard}><View style={styles.athleteIdentity}><Text style={styles.athleteName}>{target.name}</Text><Text style={styles.athleteMeta}>{target.email}{target.mobile ? ` · ${target.mobile}` : ''}</Text></View><View style={styles.facts}><Text style={styles.fact}>Volunteer band: {target.bandCode || 'Not assigned'}</Text></View>{busyId === target.id ? <ActivityIndicator color="#ff6b21" style={styles.cardLoader} /> : <Pressable disabled={!assignmentCode.trim()} style={[styles.actionButton, !assignmentCode.trim() && styles.disabled]} onPress={() => void saveVolunteerBand(target)}><Text style={styles.actionButtonText}>ASSIGN VOLUNTEER BAND</Text></Pressable>}</View>)}
        </> : module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' ? <>
          <Text style={styles.inputLabel}>CHIP ASSIGNMENT METHOD</Text>
          <View style={styles.chipModeRow}>{(['MANUAL', 'QR', 'RFID_READER'] as const).map((method) => <Pressable key={method} onPress={() => { if (readerCaptureTimerRef.current) clearTimeout(readerCaptureTimerRef.current); setChipAssignmentMethod(method); setAssignmentCode(''); setReaderCaptureComplete(false); setChipOwner(null); setChipOwnerLoading(false); setError(null); setMessage(method === 'RFID_READER' ? 'USB reader ready for mobile OTG and PC keyboard/HID mode. Select the athlete, tap only the chip-code field, read one chip, then press Assign Chip.' : null); }} style={[styles.chipModeButton, chipAssignmentMethod === method && styles.chipModeButtonActive]}><Text style={[styles.chipModeButtonText, chipAssignmentMethod === method && styles.chipModeButtonTextActive]}>{method === 'RFID_READER' ? 'RFID Reader' : method === 'QR' ? 'QR / Barcode' : 'Manual'}</Text></Pressable>)}</View>
          <View style={styles.chipModeRow}>{(['BIB Number', 'Athlete Band'] as ChipSearchMode[]).map((mode) => <Pressable key={mode} onPress={() => { setChipSearchMode(mode); setChipBibKeypadOpen(false); setQuery(''); setSearchData(null); setAssignmentCode(''); setReaderCaptureComplete(false); setChipOwner(null); setChipOwnerLoading(false); setMessage(null); setError(null); }} style={[styles.chipModeButton, chipSearchMode === mode && styles.chipModeButtonActive]}><Text style={[styles.chipModeButtonText, chipSearchMode === mode && styles.chipModeButtonTextActive]}>{mode}</Text></Pressable>)}</View>
          <View style={styles.chipSearchRow}><TextInput ref={chipSearchInputRef} value={query} onChangeText={(value) => { if (value.replace(/[^0-9A-F]/gi, '').length >= 12) { rejectNonChipReaderInputUntilRef.current = Date.now() + 750; setQuery(''); chipSearchInputRef.current?.blur(); Keyboard.dismiss(); setError('RFID ignored in BIB search. Enter the BIB and tap Search first.'); return; } if (Date.now() < rejectNonChipReaderInputUntilRef.current) { setQuery(''); return; } setQuery(value); }} onSubmitEditing={() => { chipSearchInputRef.current?.blur(); Keyboard.dismiss(); void search(); }} blurOnSubmit showSoftInputOnFocus inputMode="text" keyboardType="default" autoCapitalize="characters" placeholder={chipSearchMode === 'BIB Number' ? 'Enter BIB number' : 'Enter athlete band'} placeholderTextColor="#7c898f" style={styles.chipSearchInput} /><Pressable onPress={() => { chipSearchInputRef.current?.blur(); Keyboard.dismiss(); void search(); }} disabled={searching} style={[styles.chipSearchButton, searching && styles.disabled]}>{searching ? <ActivityIndicator color="#071722" /> : <Text style={styles.chipSearchButtonText}>Search</Text>}</Pressable></View>
          {Platform.OS === 'ios' && chipSearchMode === 'BIB Number' ? <>
            <Pressable focusable={false} onPress={() => { chipSearchInputRef.current?.blur(); Keyboard.dismiss(); setChipBibKeypadOpen((current) => !current); }} style={styles.chipKeypadToggle}><Text style={styles.chipKeypadToggleText}>⌨  {chipBibKeypadOpen ? 'Hide BIB Keypad' : 'Open BIB Keypad'}</Text></Pressable>
            {chipBibKeypadOpen ? <View style={styles.chipBibKeypad}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => <Pressable focusable={false} key={digit} onPress={() => setQuery((current) => `${current}${digit}`)} style={styles.chipBibKey}><Text style={styles.chipBibKeyText}>{digit}</Text></Pressable>)}
              <Pressable focusable={false} onPress={() => setQuery('')} style={styles.chipBibKey}><Text style={styles.chipBibKeyAction}>CLEAR</Text></Pressable>
              <Pressable focusable={false} onPress={() => setQuery((current) => `${current}0`)} style={styles.chipBibKey}><Text style={styles.chipBibKeyText}>0</Text></Pressable>
              <Pressable focusable={false} onPress={() => setQuery((current) => current.slice(0, -1))} style={styles.chipBibKey}><Text style={styles.chipBibKeyText}>⌫</Text></Pressable>
              <Pressable focusable={false} disabled={!query.trim() || searching} onPress={() => { setChipBibKeypadOpen(false); void search(); }} style={[styles.chipBibKeySearch, (!query.trim() || searching) && styles.disabled]}><Text style={styles.chipBibKeySearchText}>{searching ? 'SEARCHING…' : 'SEARCH BIB'}</Text></Pressable>
            </View> : null}
          </> : null}
          <Pressable focusable={false} onPress={() => { setScannerMode('athlete-search'); setScannerOpen(true); }} style={styles.chipScanButton}><Text style={styles.chipScanButtonText}>▣  Scan Athlete Band</Text></Pressable>
          {message ? <Text style={styles.success}>{message}</Text> : null}{error ? <Text style={styles.errorText}>{error}</Text> : null}
          {displayedChipParticipants.map((participant) => {
            const waiverVerified = Boolean(participant.state.waiverVerifiedAt) || !assignment.waiverRequired;
            const pending = busyId === participant.id;
            const chipCodeReady = chipAssignmentMethod === 'RFID_READER'
              ? readerCaptureComplete && usbReaderChipCode(assignmentCode).length === 5
              : chipAssignmentMethod === 'MANUAL'
                ? /^\d{5}$/.test(assignmentCode)
                : Boolean(assignmentCode.trim());
            return <View key={participant.id} style={styles.chipResultBlock}>
              <View style={styles.chipAthleteCard}>
                <View style={styles.chipIdentityRow}><View style={styles.chipInitialsCircle}><Text style={styles.chipInitialsText}>{initials(participant.participationMode === 'RELAY' ? participant.relayTeamName || participant.name : participant.name)}</Text></View><Text style={styles.chipAthleteName}>{participant.participationMode === 'RELAY' ? participant.relayTeamName || `Relay Team ${participant.bib}` : participant.name}</Text></View>
                <View style={styles.chipCardDivider} />
                <View style={styles.chipFactsGrid}>
                  <View style={styles.chipFactCell}><Text style={styles.chipFactLabel}>BIB:</Text><Text style={styles.chipFactAccent}>{participant.bib || '—'}</Text></View>
                  <View style={styles.chipFactCell}><Text style={styles.chipFactLabel}>Category:</Text><Text style={styles.chipFactValue}>{participant.category || 'Not assigned'}</Text></View>
                  <View style={styles.chipFactCell}><Text style={styles.chipFactLabel}>Gender:</Text><Text style={styles.chipFactValue}>{participant.gender || 'Not recorded'}</Text></View>
                  <View style={styles.chipFactCell}><Text style={styles.chipFactLabel}>Waiver:</Text><Text style={[styles.chipFactValue, waiverVerified ? styles.chipWaiverVerified : styles.chipWaiverPending]}>{waiverVerified ? '✓ WAIVER SIGNED' : '✕ WAIVER NOT VERIFIED'}</Text></View>
                  <View style={styles.chipFactCell}><Text style={styles.chipFactLabel}>{participant.participationMode === 'RELAY' ? 'Team Timing Chip:' : 'Timing Chip:'}</Text><Text style={[styles.chipFactValue, participant.chipCode ? styles.chipFactAssigned : undefined]}>{participant.chipCode || 'Not Assigned'}</Text></View>
                </View>
              </View>
              {participant.chipCode ? <View style={styles.chipAssignedPanel}>
                <Text style={styles.chipAssignedTitle}>✓ Chip Already Assigned</Text>
                <Text style={styles.chipAssignedCopy}>{participant.chipCode}. Replacement requires an authorized administrator.</Text>
              </View> : <>
                <Text style={styles.chipAssignmentPrompt}>{participant.participationMode === 'RELAY' ? 'Assign one timing chip to the complete relay team' : 'Scan or enter the timing chip code'}</Text>
                <TextInput ref={chipCodeInputRef} editable={chipAssignmentMethod !== 'QR'} showSoftInputOnFocus={chipAssignmentMethod !== 'RFID_READER'} inputMode={chipAssignmentMethod === 'MANUAL' ? 'numeric' : 'text'} keyboardType={chipAssignmentMethod === 'MANUAL' ? 'number-pad' : 'default'} maxLength={chipAssignmentMethod === 'MANUAL' ? 5 : undefined} autoCapitalize="characters" autoCorrect={false} autoComplete="off" spellCheck={false} returnKeyType="done" value={chipAssignmentMethod === 'RFID_READER' ? undefined : assignmentCode} onChangeText={updateChipCode} onSubmitEditing={({ nativeEvent }) => finishReaderCapture(nativeEvent.text || assignmentCodeRef.current)} onBlur={() => { if (chipAssignmentMethod === 'RFID_READER' && !readerCaptureComplete && assignmentCodeRef.current.trim()) finishReaderCapture(); }} placeholder={chipAssignmentMethod === 'RFID_READER' ? readerCaptureComplete ? 'Chip captured' : 'Tap here, then read one timing chip' : chipAssignmentMethod === 'QR' ? 'Scan the chip QR below' : 'Enter 5-digit timing chip code'} placeholderTextColor="#84939c" style={[styles.chipCodeInput, readerCaptureComplete && styles.chipCodeInputLocked]} />
                {chipAssignmentMethod === 'RFID_READER' && assignmentCode.trim() ? <Text style={styles.chipAvailable}>Reader chip code: {assignmentCode}</Text> : null}
                {chipOwnerLoading ? <View style={styles.chipOwnerPanel}><ActivityIndicator color="#a05b08" /><Text style={styles.chipOwnerLoading}>Checking previous chip assignment…</Text></View> : chipOwner ? <View style={styles.chipOwnerPanel}><Text style={styles.chipOwnerTitle}>CHIP ALREADY ASSIGNED</Text><Text style={styles.chipOwnerName}>{chipAssignmentMethod === 'RFID_READER' ? usbReaderChipCode(assignmentCode) : assignmentCode.trim().toUpperCase()} · {chipOwner.name}</Text><Text style={styles.chipOwnerMeta}>BIB {chipOwner.bib || '—'} · {chipOwner.category || 'Category not recorded'}</Text></View> : assignmentCode.trim().length >= 2 ? <Text style={styles.chipAvailable}>✓ No previous athlete assignment found for this chip.</Text> : null}
                {chipAssignmentMethod === 'RFID_READER' ? <>
                  <Pressable focusable={false} onPress={readChipAgain} style={styles.chipScanButton}><Text style={styles.chipScanButtonText}>{readerCaptureComplete ? '↻  Read Timing Chip Again' : '▣  Scan Timing Chip'}</Text></Pressable>
                  <Pressable focusable={false} onPress={() => { if (readerCaptureTimerRef.current) clearTimeout(readerCaptureTimerRef.current); chipCodeInputRef.current?.blur(); setChipAssignmentMethod('QR'); setAssignmentCode(''); setReaderCaptureComplete(false); setChipOwner(null); setChipOwnerLoading(false); setError(null); setMessage(null); setScannerMode('assignment-code'); setScannerOpen(true); }} style={styles.chipScanButton}><Text style={styles.chipScanButtonText}>▣  Scan Chip QR / Barcode</Text></Pressable>
                </> : <Pressable focusable={false} onPress={() => { setChipAssignmentMethod('QR'); setReaderCaptureComplete(false); setScannerMode('assignment-code'); setScannerOpen(true); }} style={styles.chipScanButton}><Text style={styles.chipScanButtonText}>▣  Scan Chip QR / Barcode</Text></Pressable>}
                <Pressable focusable={false} disabled={pending || chipOwnerLoading || Boolean(chipOwner) || !chipCodeReady} onPress={() => void assignEquipment(participant)} style={[styles.chipAssignButton, (pending || chipOwnerLoading || Boolean(chipOwner) || !chipCodeReady) && styles.chipAssignButtonDisabled]}>{pending ? <ActivityIndicator color="#fff" /> : <Text style={styles.chipAssignButtonText}>Assign Chip</Text>}</Pressable>
              </>}
            </View>;
          })}
        </> : <>
          {module === 'ATHLETE_BAND_ASSIGNMENT_COUNTER' ? <View style={styles.searchRow}><TextInput autoCapitalize="characters" value={assignmentCode} onChangeText={(value) => updateNonChipInput(value, setAssignmentCode)} showSoftInputOnFocus placeholder="Athlete band code to assign" placeholderTextColor="#7c898f" style={styles.searchInput} /><Pressable onPress={() => { setScannerMode('assignment-code'); setScannerOpen(true); }} style={styles.searchButton}><Text style={styles.searchButtonText}>SCAN BAND</Text></Pressable></View> : null}
          {(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') ? <View style={styles.searchModeRow}>{(['BIB Number', 'Registration ID', 'Athlete Band', 'Name / Email', 'Mobile'] as WaiverSearchMode[]).map((mode) => <Pressable key={mode} onPress={() => { setWaiverSearchMode(mode); setQuery(''); setSearchData(null); setSelectedRegistrationIds([]); setMessage(null); setError(null); }} style={[styles.searchModeChip, waiverSearchMode === mode && styles.searchModeChipActive]}><Text style={[styles.searchModeText, waiverSearchMode === mode && styles.searchModeTextActive]}>{mode}</Text></Pressable>)}</View> : null}
          <View style={styles.searchRow}><TextInput value={query} onChangeText={(value) => updateNonChipInput(value, setQuery)} onSubmitEditing={() => void search()} showSoftInputOnFocus keyboardType={(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') && waiverSearchMode === 'Mobile' ? 'phone-pad' : 'default'} autoCapitalize={(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') && waiverSearchMode === 'Name / Email' ? 'none' : 'sentences'} placeholder={module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN' ? waiverSearchMode === 'Name / Email' ? 'Enter name or email' : `Enter ${waiverSearchMode.toLowerCase()}` : 'BIB, band, name or email'} placeholderTextColor="#7c898f" style={styles.searchInput} /><Pressable onPress={() => void search()} disabled={searching} style={styles.searchButton}>{searching ? <ActivityIndicator color="#fff" /> : <Text style={styles.searchButtonText}>SEARCH</Text>}</Pressable></View>
          {Platform.OS === 'ios' && (module === 'BIKE_CHECK_IN' || module === 'BIKE_CHECK_OUT') ? <>
            <Pressable focusable={false} onPress={() => { Keyboard.dismiss(); setBikeBibKeypadOpen((current) => !current); }} style={styles.chipKeypadToggle}><Text style={styles.chipKeypadToggleText}>⌨  {bikeBibKeypadOpen ? 'Hide BIB Keypad' : 'Open BIB Keypad'}</Text></Pressable>
            {bikeBibKeypadOpen ? <View style={styles.chipBibKeypad}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => <Pressable focusable={false} key={digit} onPress={() => setQuery((current) => `${current}${digit}`)} style={styles.chipBibKey}><Text style={styles.chipBibKeyText}>{digit}</Text></Pressable>)}
              <Pressable focusable={false} onPress={() => setQuery('')} style={styles.chipBibKey}><Text style={styles.chipBibKeyAction}>CLEAR</Text></Pressable>
              <Pressable focusable={false} onPress={() => setQuery((current) => `${current}0`)} style={styles.chipBibKey}><Text style={styles.chipBibKeyText}>0</Text></Pressable>
              <Pressable focusable={false} onPress={() => setQuery((current) => current.slice(0, -1))} style={styles.chipBibKey}><Text style={styles.chipBibKeyText}>⌫</Text></Pressable>
              <Pressable focusable={false} disabled={!query.trim() || searching} onPress={() => { setBikeBibKeypadOpen(false); void search(); }} style={[styles.chipBibKeySearch, (!query.trim() || searching) && styles.disabled]}><Text style={styles.chipBibKeySearchText}>{searching ? 'SEARCHING…' : 'SEARCH BIB'}</Text></Pressable>
            </View> : null}
          </> : null}
          {(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') && waiverSearchMode === 'Athlete Band' ? <Pressable onPress={() => { setScannerMode('athlete-search'); setScannerOpen(true); }} style={styles.scanButton}><Text style={styles.scanButtonText}>▣  SCAN ATHLETE BAND</Text></Pressable> : null}
          {module !== 'WAIVER_CHECK_IN' && module !== 'ATHLETE_CHECK_IN' ? <Pressable onPress={() => { setScannerMode('athlete-search'); setScannerOpen(true); }} style={styles.scanButton}><Text style={styles.scanButtonText}>▣  SCAN ATHLETE BAND / BIB</Text></Pressable> : null}
          {message ? <Text style={styles.success}>{message}</Text> : null}{error ? <Text style={styles.errorText}>{error}</Text> : null}
          {(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') && !searchedRelayTeam && searchData?.participantProfiles?.length ? <View style={styles.multiRegistrationPanel}>
            <Text style={styles.multiRegistrationTitle}>{searchData.participantProfiles.length > 1 ? 'MULTIPLE PARTICIPANTS FOUND' : searchData.participantProfiles[0].registrations.length > 1 ? 'MULTIPLE REGISTRATIONS FOUND' : 'PARTICIPANT REGISTRATION'}</Text>
            {searchData.participantProfiles.map((profile) => <View key={profile.participantId} style={styles.profileGroup}>
              <Text style={styles.profileName}>{profile.name}</Text><Text style={styles.profileMeta}>{profile.email || profile.mobile || profile.participantId} · {profile.registrations.length} registration{profile.registrations.length === 1 ? '' : 's'}</Text>
              {profile.registrations.map((registration) => { const selected = selectedRegistrationIds.includes(registration.registrationId); const eligible = !registration.state.waiverVerifiedAt; return <Pressable key={registration.registrationId} disabled={!eligible} onPress={() => setSelectedRegistrationIds((current) => selected ? current.filter((id) => id !== registration.registrationId) : searchData.event.waiverPolicy.consolidatedWaiverEnabled ? [...current.filter((id) => profile.registrations.some((item) => item.registrationId === id)), registration.registrationId] : [registration.registrationId])} style={[styles.registrationChoice, selected && styles.registrationChoiceSelected, !eligible && styles.registrationChoiceDisabled]}>
                <Text style={styles.registrationCheckbox}>{eligible ? selected ? '☑' : '☐' : '✓'}</Text><View style={styles.registrationChoiceText}><Text style={styles.registrationName}>{registration.category || 'Registration'}{registration.sessionName ? ` · ${registration.sessionName}` : ''}</Text><Text style={styles.registrationMeta}>ID {registration.registrationId} · BIB {registration.bib || '—'} · Waiver {registration.state.waiverVerifiedAt ? 'Signed' : 'Pending'} · Check-in {registration.state.checkedInAt ? 'Checked in' : 'Pending'}</Text></View>
              </Pressable>; })}
              {searchData.event.waiverPolicy.consolidatedWaiverEnabled && profile.registrations.filter((registration) => !registration.state.waiverVerifiedAt).length > 1 ? <Pressable onPress={() => setSelectedRegistrationIds(profile.registrations.filter((registration) => !registration.state.waiverVerifiedAt).map((registration) => registration.registrationId))} style={styles.selectAllButton}><Text style={styles.selectAllText}>SELECT ALL ELIGIBLE REGISTRATIONS</Text></Pressable> : null}
            </View>)}
          </View> : null}
          {searchedRelayTeam ? <View style={styles.relayTeamPanel}>
            <Text style={styles.relayTeamEyebrow}>RELAY TEAM · BIB {searchedRelayTeam.bib}</Text>
            <Text style={styles.relayTeamName}>{searchedRelayTeam.name}</Text>
            <Text style={styles.relayTeamMeta}>{searchData?.participants[0]?.category || 'Relay contest'} · {searchedRelayTeam.size} registered athletes</Text>
            <Text style={[styles.relayTeamStat, searchedRelayTeam.teamChipCode && styles.relayTeamComplete]}>TEAM TIMING CHIP · {searchedRelayTeam.teamChipCode || 'NOT ASSIGNED'}</Text>
            <View style={styles.relayTeamStats}><Text style={styles.relayTeamStat}>{searchedRelayTeam.assignedBands} assigned bands</Text><Text style={styles.relayTeamStat}>{searchedRelayTeam.remainingBands} remaining</Text><Text style={[styles.relayTeamStat, searchedRelayTeam.teamWaiverCompleted && styles.relayTeamComplete]}>{searchedRelayTeam.teamWaiverCompleted ? '✓ Team waiver completed' : `${searchedRelayTeam.waiverCompletedMembers}/${searchedRelayTeam.size} waivers signed`}</Text><Text style={[styles.relayTeamStat, searchedRelayTeam.fullyCheckedIn && styles.relayTeamComplete]}>{searchedRelayTeam.fullyCheckedIn ? '✓ Team fully checked in' : `${searchedRelayTeam.checkedInMembers}/${searchedRelayTeam.size} checked in`}</Text></View>
            {searchedRelayTeam.members.map((member) => { const relayParticipant = searchData?.participants.find((participant) => participant.id === member.id); return <View key={member.id} style={styles.relayMemberCard}>
              <View style={styles.relayMemberHeader}><View style={styles.relayMemberIdentity}><Text style={styles.relayMemberName}>{member.memberNumber ? `${member.memberNumber}. ` : ''}{member.name}</Text><Text style={styles.relayMemberRole}>{member.memberRole || 'Relay athlete'}</Text></View><View style={styles.relayMemberShirt}><Text style={styles.relayMemberShirtLabel}>T-SHIRT</Text><Text style={styles.relayMemberShirtValue}>{member.tshirtSize || '—'}</Text></View></View>
              <View style={styles.relayMemberState}><Text style={styles.relayMemberBand}>{member.athleteBandCode || 'Band pending'}</Text><Text style={[styles.relayMemberStatus, member.chipCode && styles.relayMemberDone]}>{member.chipCode ? `✓ Team chip ${member.chipCode}` : 'Team chip pending'}</Text><Text style={[styles.relayMemberStatus, member.waiverVerified && styles.relayMemberDone]}>{member.waiverVerified ? `✓ Waiver signed${member.waiverVerifiedAt ? ` · ${formatted(member.waiverVerifiedAt)}` : ''}` : 'Waiver pending'}</Text><Text style={[styles.relayMemberStatus, member.checkedIn && styles.relayMemberDone]}>{member.checkedIn ? '✓ Checked in' : 'Check-in pending'}</Text></View>
              {(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') && relayParticipant ? <><Pressable disabled={assignment.waiverRequired && !member.waiverVerified} style={[styles.assignBandCardButton, assignment.waiverRequired && !member.waiverVerified && styles.disabled]} onPress={() => openBandAssignment(relayParticipant)}><Text style={styles.assignBandCardButtonText}>{member.athleteBandCode ? 'Replace Athlete Band' : `Assign Athlete Band ${member.memberNumber || ''}`}</Text></Pressable>{busyId === relayParticipant.id ? <ActivityIndicator color="#ff6b21" style={styles.cardLoader} /> : actionControl(relayParticipant)}</> : null}
            </View>; })}
          </View> : null}
          {displayedSearchParticipants.map((participant) => {
            const status = activeStatus(participant, module);
            return <View key={participant.id} style={styles.athleteCard}>
              {(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') ? <View style={styles.waiverIdentity}><View style={styles.initialsCircle}><Text style={styles.initialsText}>{initials(participant.name)}</Text></View><View style={styles.waiverIdentityText}><Text style={styles.waiverAthleteName}>{participant.name}</Text><Text style={styles.athleteMeta}>{participant.email || participant.mobile || 'Registered athlete'}</Text></View></View> : <View style={styles.athleteTop}><View style={styles.bibBox}><Text style={styles.bibLabel}>BIB</Text><Text style={styles.bibValue}>{participant.bib || '—'}</Text></View><View style={styles.athleteIdentity}><Text style={styles.athleteName}>{participant.name}</Text><Text style={styles.athleteMeta}>{participant.category || 'Unassigned category'} · {[participant.gender, participant.ageGroup].filter(Boolean).join(' ') || 'Open'}</Text></View><Text style={[styles.status, status.done && styles.statusDone]}>{status.done ? `✓ ${status.label}` : status.label}</Text></View>}
              {(module === 'WAIVER_CHECK_IN' || module === 'ATHLETE_CHECK_IN') ? (() => { const relayWaiverPending = participant.participationMode === 'RELAY' && assignment.waiverRequired && !participant.state.waiverVerifiedAt; return <><View style={styles.tshirtPanel}><Text style={styles.counterPanelLabel}>{participant.participationMode === 'RELAY' ? `TEAM MEMBER ${participant.relayMemberNumber ?? '—'}${participant.relayMemberRole ? ` · ${participant.relayMemberRole.toUpperCase()}` : ''}` : 'T-SHIRT SIZE'}</Text><Text style={styles.tshirtValue}>{participant.tshirtSize || 'NOT RECORDED'}</Text></View><View style={styles.bandPanel}><View style={styles.bandPanelText}><Text style={styles.counterPanelLabel}>ATHLETE BAND NUMBER</Text><Text style={styles.bandValue}>{participant.athleteBandCode || 'NOT ASSIGNED'}</Text></View><Pressable disabled={relayWaiverPending} style={[styles.assignBandCardButton, relayWaiverPending && styles.disabled]} onPress={() => openBandAssignment(participant)}><Text style={styles.assignBandCardButtonText}>{participant.athleteBandCode ? 'Replace Athlete Band' : participant.participationMode === 'RELAY' ? `${participant.relayMemberNumber === 1 ? 'Assign Band 1' : `+ Add Relay Band ${participant.relayMemberNumber ?? ''}`}` : 'Assign Athlete Band'}</Text></Pressable></View>{relayWaiverPending ? <Text style={styles.waiverRequiredWarning}>Complete this athlete’s individual waiver before assigning a wristband.</Text> : null}</>; })() : null}
              {module === 'ATHLETE_LOOKUP' ? <View style={styles.lookupBandPanel}><Text style={styles.counterPanelLabel}>ATHLETE BAND NUMBER</Text><Text style={styles.lookupBandValue}>{participant.athleteBandCode || 'NOT ASSIGNED'}</Text></View> : null}
              {(module === 'BIKE_CHECK_IN' || module === 'BIKE_CHECK_OUT') && participant.participationMode === 'RELAY' ? <Text style={styles.relayBikeOwner}>TEAM BIKE · CYCLING MEMBER: {participant.name.toUpperCase()}</Text> : null}
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
    <Modal visible={bandAssignmentOpen} transparent animationType="fade" onRequestClose={() => setBandAssignmentOpen(false)}><KeyboardSafeScrollView contentContainerStyle={styles.modalBackdrop}><View style={styles.bandModal}><Text style={styles.bandModalTitle}>Assign Athlete Band</Text><Text style={styles.bandModalAthlete}>{bandAssignmentParticipant?.name || 'Athlete'} · BIB {bandAssignmentParticipant?.bib || '—'}</Text><TextInput autoCapitalize="characters" value={assignmentCode} onChangeText={(value) => updateNonChipInput(value, setAssignmentCode)} showSoftInputOnFocus placeholder="Scan or enter athlete band" placeholderTextColor="#7c898f" style={styles.bandModalInput} /><Pressable style={styles.bandModalScan} onPress={() => { setBandAssignmentOpen(false); setScannerMode('waiver-band-code'); setScannerOpen(true); }}><Text style={styles.bandModalScanText}>▣  SCAN ATHLETE BAND</Text></Pressable><View style={styles.bandModalActions}><Pressable style={styles.bandModalCancel} onPress={() => { setBandAssignmentOpen(false); setBandAssignmentParticipant(null); setAssignmentCode(''); }}><Text style={styles.bandModalCancelText}>Cancel</Text></Pressable><Pressable disabled={!assignmentCode.trim() || !bandAssignmentParticipant || Boolean(busyId)} style={[styles.bandModalConfirm, (!assignmentCode.trim() || !bandAssignmentParticipant || Boolean(busyId)) && styles.disabled]} onPress={() => bandAssignmentParticipant ? void assignEquipment(bandAssignmentParticipant) : undefined}><Text style={styles.bandModalConfirmText}>{busyId ? 'SAVING…' : 'ASSIGN BAND'}</Text></Pressable></View></View></KeyboardSafeScrollView></Modal>
    <Modal visible={scannerOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => { setScannerOpen(false); if (scannerMode === 'waiver-band-code') setBandAssignmentOpen(true); }}><Scanner title={scannerMode === 'chip-return-code' ? 'Scan returned timing chip' : scannerMode === 'assignment-code' ? module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' ? 'Scan timing chip' : 'Scan assignment code' : scannerMode === 'waiver-band-code' ? 'Scan athlete band' : module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' ? 'Scan athlete band or BIB' : 'Scan athlete band, chip or BIB'} onClose={() => { setScannerOpen(false); if (scannerMode === 'waiver-band-code') setBandAssignmentOpen(true); }} onScanned={(value) => { setScannerOpen(false); if (scannerMode === 'chip-return-code') { setChipReturnMethod('CAMERA'); setChipReturnCode(value.trim()); setChipReturnReason(''); } else if (scannerMode === 'assignment-code') { const code = value.trim(); if (module === 'TIMING_CHIP_ASSIGNMENT_COUNTER') { setChipAssignmentMethod('QR'); setReaderCaptureComplete(false); } setAssignmentCode(code); setChipOwner(null); setChipOwnerLoading(module === 'TIMING_CHIP_ASSIGNMENT_COUNTER' && code.length >= 2); } else if (scannerMode === 'waiver-band-code') { setAssignmentCode(value.trim()); setBandAssignmentOpen(true); } else { setQuery(value); setTimeout(() => void search(value, true), 250); } }} /></Modal>
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
  chipKeypadToggle: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: '#b8c8cf', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  chipKeypadToggleText: { color: '#071722', fontSize: 13, fontWeight: '900' },
  chipBibKeypad: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, borderRadius: 14, backgroundColor: '#e8eef1', padding: 10, marginTop: 8 },
  chipBibKey: { width: '31%', minHeight: 50, borderRadius: 10, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  chipBibKeyText: { color: '#071722', fontSize: 21, fontWeight: '900' },
  chipBibKeyAction: { color: '#9b2730', fontSize: 10, fontWeight: '900' },
  chipBibKeySearch: { width: '100%', minHeight: 50, borderRadius: 10, backgroundColor: '#071722', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  chipBibKeySearchText: { color: '#fff', fontSize: 13, fontWeight: '900' },
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
  chipCodeInputLocked: { backgroundColor: '#edf3f5', borderColor: '#8eb7c0', color: '#087b91', fontWeight: '900' },
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
  relayTeamPanel: { borderRadius: 15, borderWidth: 1, borderColor: '#7bcbd8', backgroundColor: '#e7f8fb', padding: 14, marginTop: 13 }, relayTeamEyebrow: { color: '#087b91', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 }, relayTeamName: { color: '#071722', fontSize: 19, fontWeight: '900', marginTop: 5 }, relayTeamMeta: { color: '#536873', fontSize: 11, fontWeight: '700', marginTop: 4 }, relayTeamStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 11 }, relayTeamStat: { color: '#36545f', backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7, fontSize: 9, fontWeight: '900' }, relayTeamComplete: { color: '#147a3c', backgroundColor: '#dcf5e5' }, relayBikeOwner: { color: '#087b91', backgroundColor: '#e7f8fb', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8, marginTop: 12, fontSize: 10, fontWeight: '900', letterSpacing: 0.4 },
  relayMemberCard: { borderTopWidth: 1, borderTopColor: '#bfdee4', paddingTop: 11, marginTop: 11 },
  relayMemberHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 }, relayMemberIdentity: { flex: 1, minWidth: 0 }, relayMemberName: { color: '#142d36', fontSize: 13, fontWeight: '900' }, relayMemberRole: { color: '#087b91', fontSize: 10, fontWeight: '900', marginTop: 2, textTransform: 'uppercase' },
  relayMemberShirt: { minWidth: 58, borderRadius: 9, backgroundColor: '#ffbf26', paddingHorizontal: 10, paddingVertical: 7, alignItems: 'center' }, relayMemberShirtLabel: { color: '#65400a', fontSize: 7, fontWeight: '900' }, relayMemberShirtValue: { color: '#2b1705', fontSize: 17, fontWeight: '900', marginTop: 1 },
  relayMemberDetails: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 9 }, relayMemberDetail: { width: '47%', flexGrow: 1, color: '#49636d', backgroundColor: '#fff', borderRadius: 7, padding: 7, fontSize: 8, fontWeight: '700' }, relayMemberDetailWide: { width: '100%', color: '#49636d', backgroundColor: '#fff', borderRadius: 7, padding: 7, fontSize: 8, fontWeight: '700' },
  relayMemberState: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginTop: 8 }, relayMemberBand: { color: '#087b91', fontSize: 9, fontWeight: '900' }, relayMemberStatus: { color: '#9a5c0a', fontSize: 8, fontWeight: '800' }, relayMemberDone: { color: '#147a3c' },
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
  chipReturnPanel: { borderRadius: 14, borderWidth: 1, borderColor: '#9bc7d1', backgroundColor: '#f1fbfd', padding: 12, marginTop: 12 }, chipReturnTitle: { color: '#075f70', fontSize: 11, fontWeight: '900', letterSpacing: 1 }, chipReturnFacts: { gap: 6, marginTop: 9 }, chipReturnFact: { color: '#334b55', fontSize: 11, fontWeight: '800' }, chipReturnMethods: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 11 }, chipReturnMethod: { flexGrow: 1, minHeight: 40, borderRadius: 10, backgroundColor: '#dce8ec', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9 }, chipReturnMethodActive: { backgroundColor: '#087b91' }, chipReturnMethodDanger: { backgroundColor: '#a23232' }, chipReturnMethodText: { color: '#3f555e', fontSize: 9, fontWeight: '900' }, chipReturnMethodTextActive: { color: '#fff' }, chipReturnReasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }, chipReturnReason: { borderRadius: 9, borderWidth: 1, borderColor: '#d4a7a7', backgroundColor: '#fff', paddingHorizontal: 9, paddingVertical: 8 }, chipReturnReasonActive: { backgroundColor: '#8f2424', borderColor: '#8f2424' }, chipReturnReasonText: { color: '#7a3434', fontSize: 9, fontWeight: '800' }, chipReturnReasonTextActive: { color: '#fff' }, chipMismatch: { color: '#9b2730', backgroundColor: '#ffe5e7', borderRadius: 9, padding: 9, fontSize: 10, fontWeight: '900', marginTop: 9 },
  waiverOtpPanel: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#d6c184', backgroundColor: '#fff9e9' }, waiverOtpHelp: { color: '#5f4d20', fontSize: 11, lineHeight: 16, fontWeight: '700' }, waiverOtpInput: { height: 48, borderRadius: 10, borderWidth: 1, borderColor: '#c8d0d4', backgroundColor: '#fff', color: '#111518', paddingHorizontal: 12, fontSize: 20, fontWeight: '900', letterSpacing: 6, textAlign: 'center', marginTop: 10 }, waiverOtpResend: { alignItems: 'center', paddingVertical: 10 }, waiverOtpResendText: { color: '#8a4b00', fontSize: 11, fontWeight: '900' },
  inlineInput: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12 }, helmetLabel: { flex: 1, minWidth: 0 }, helmetSwitch: { width: 68, height: 36, flexShrink: 0, borderRadius: 18, borderWidth: 1, borderColor: '#7d898f', backgroundColor: '#e1e6e8', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }, helmetSwitchOn: { borderColor: '#148044', backgroundColor: '#148044' }, helmetSwitchDisabled: { opacity: 0.72 }, helmetSwitchThumb: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', borderWidth: 1, borderColor: '#aeb8bc' }, helmetSwitchThumbOn: { borderColor: '#fff' }, helmetSwitchText: { color: '#435159', fontSize: 9, fontWeight: '900', marginHorizontal: 2 }, helmetSwitchTextOn: { color: '#fff' }, inlineLabel: { color: '#263238', fontSize: 12, fontWeight: '900' }, optionalHelp: { color: '#6c7a81', fontSize: 9, marginTop: 2 }, smallInput: { height: 44, borderRadius: 11, borderWidth: 1, borderColor: '#c8d0d4', backgroundColor: '#f8fafb', color: '#111518', paddingHorizontal: 12, fontSize: 12, marginTop: 9 }, actionButton: { minHeight: 44, borderRadius: 12, backgroundColor: '#ff6b21', alignItems: 'center', justifyContent: 'center', marginTop: 11 }, checkInComplete: { minHeight: 48, borderRadius: 12, backgroundColor: '#daf4e3', borderWidth: 1, borderColor: '#72c28c', alignItems: 'center', justifyContent: 'center', marginTop: 11 }, checkInCompleteText: { color: '#147a3c', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 }, timingButton: { minHeight: 48, borderRadius: 12, backgroundColor: '#d9233f', alignItems: 'center', justifyContent: 'center', marginTop: 11 }, actionButtonText: { color: '#fff', fontSize: 11, fontWeight: '900' }, secondaryButton: { backgroundColor: '#e4e9eb' }, secondaryButtonText: { color: '#263238' }, doneButton: { backgroundColor: '#397b4d' }, disabled: { opacity: 0.42 }, cardLoader: { marginTop: 14 },
  bandButton: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: '#087b91', backgroundColor: '#e5f8fb', alignItems: 'center', justifyContent: 'center', marginTop: 11 }, bandButtonText: { color: '#075f70', fontSize: 11, fontWeight: '900' }, proofButton: { minHeight: 40, borderRadius: 10, borderWidth: 1, borderColor: '#59666c', alignItems: 'center', justifyContent: 'center', marginTop: 9 }, proofButtonText: { color: '#263238', fontSize: 10, fontWeight: '900' },
  modalBackdrop: { flexGrow: 1, backgroundColor: 'rgba(0,0,0,.72)', alignItems: 'center', justifyContent: 'center', padding: 20 }, bandModal: { width: '100%', maxWidth: 440, borderRadius: 20, backgroundColor: '#f3f6f7', padding: 18 }, bandModalTitle: { color: '#071722', fontSize: 22, fontWeight: '900' }, bandModalAthlete: { color: '#607078', fontSize: 12, fontWeight: '800', marginTop: 6 }, bandModalInput: { height: 52, borderRadius: 13, borderWidth: 1, borderColor: '#b9c8ce', backgroundColor: '#fff', color: '#111518', paddingHorizontal: 13, fontSize: 14, marginTop: 16 }, bandModalScan: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: '#087b91', alignItems: 'center', justifyContent: 'center', marginTop: 10 }, bandModalScanText: { color: '#087b91', fontSize: 11, fontWeight: '900' }, bandModalActions: { flexDirection: 'row', gap: 9, marginTop: 14 }, bandModalCancel: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: '#dfe6e9', alignItems: 'center', justifyContent: 'center' }, bandModalCancelText: { color: '#34444c', fontSize: 11, fontWeight: '900' }, bandModalConfirm: { flex: 1.5, minHeight: 46, borderRadius: 12, backgroundColor: '#087b91', alignItems: 'center', justifyContent: 'center' }, bandModalConfirmText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  footer: { color: '#657078', fontSize: 9, fontWeight: '900', letterSpacing: 1.1, textAlign: 'center', paddingBottom: 28 },
  scannerShell: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }, scannerTop: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2, paddingHorizontal: 18, paddingBottom: 14, backgroundColor: 'rgba(0,0,0,.72)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, scannerTitle: { color: '#fff', fontSize: 16, fontWeight: '900' }, scannerClose: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9 }, scannerCloseText: { color: '#111518', fontSize: 11, fontWeight: '900' }, scanFrame: { width: 270, height: 270, borderRadius: 28, borderWidth: 4, borderColor: '#ff6b21', backgroundColor: 'transparent' }, scannerHint: { position: 'absolute', bottom: 80, color: '#fff', backgroundColor: 'rgba(0,0,0,.7)', borderRadius: 10, paddingHorizontal: 15, paddingVertical: 10, fontWeight: '800' }, permissionCard: { width: '84%', borderRadius: 20, backgroundColor: '#151a1e', padding: 20 }, permissionTitle: { color: '#fff', fontSize: 19, fontWeight: '900' }, permissionText: { color: '#aeb7bc', fontSize: 13, lineHeight: 19, marginTop: 7 }, primaryButton: { height: 48, backgroundColor: '#ff6b21', borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 17 }, primaryButtonText: { color: '#fff', fontWeight: '900' },
});
