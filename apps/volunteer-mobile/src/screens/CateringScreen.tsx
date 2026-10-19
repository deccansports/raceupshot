import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { apiRequest } from '../api';
import type { CateringRecipient, CateringService, CateringSnapshot } from '../../../../lib/catering';

type Data = CateringSnapshot & { recipients: CateringRecipient[] };
const empty: Data = { services: [], counts: {}, recent: [], volunteerDates: [], volunteerGroups: [], recipients: [] };
export function CateringScreen({ eventId, operatorId }: { eventId: string; operatorId: string }) {
  const [data, setData] = useState<Data>(empty), [audience, setAudience] = useState<'ATHLETE' | 'VOLUNTEER'>('ATHLETE');
  const [view, setView] = useState<'SERVE' | 'LOGS'>('SERVE'), [query, setQuery] = useState(''), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false), [scanner, setScanner] = useState(false), [permission, requestPermission] = useCameraPermissions();
  const inFlight = useRef(false), scannerUsed = useRef(false);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  async function load(identifier = '') {
    const result = await apiRequest<Data>(`/api/mobile/volunteer/catering?eventId=${encodeURIComponent(eventId)}&audience=${audience}&query=${encodeURIComponent(identifier)}`);
    setData(result); return result;
  }
  useEffect(() => { let live = true; setData(empty); void apiRequest<Data>(`/api/mobile/volunteer/catering?eventId=${encodeURIComponent(eventId)}`).then(result => { if (live) setData(result); }).catch(error => { if (live) setMessage(error.message); }); return () => { live = false; }; }, [eventId]);
  async function search(identifier = query) {
    if (inFlight.current || !identifier.trim()) return;
    inFlight.current = true; setBusy(true); setMessage(''); setData(current => ({ ...current, recipients: [] }));
    try { const result = await load(identifier.trim()); if (!result.recipients.length) setMessage('No matching recipient in this event. Check the audience and identifier.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Search failed.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function issue(service: CateringService, recipient: CateringRecipient) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setMessage('');
    try {
      const key = JSON.stringify([eventId, service.id, recipient.audience, recipient.id]);
      if (attempt.current?.key !== key) attempt.current = { key, id: `${Date.now()}-${operatorId}-${service.id}`.slice(0, 100) };
      await apiRequest('/api/mobile/volunteer/catering', { method: 'POST', body: JSON.stringify({ requestId: attempt.current.id, eventId, serviceId: service.id, audience: recipient.audience, identifier: query.trim(), recipientId: recipient.id }) });
      attempt.current = null;
      setMessage(`${service.name} served to ${recipient.name}.`);
      setQuery(''); setData(current => ({ ...current, recipients: [] }));
      try { await load(); } catch { setMessage(`${service.name} was recorded. Refresh to update stock totals.`); }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Serving failed.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function scan() { const result = permission?.granted ? permission : await requestPermission(); if (result.granted) { scannerUsed.current = false; setScanner(true); } else setMessage('Camera permission is required to scan. Manual entry is still available.'); }
  async function refresh() { if (inFlight.current) return; inFlight.current = true; setBusy(true); try { await load(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Refresh failed.'); } finally { inFlight.current = false; setBusy(false); } }
  return <View style={styles.panel}>
    <Text style={styles.heading}>Catering / Food & Items</Text>
    <View style={styles.row}>{(['SERVE', 'LOGS'] as const).map(value => <Pressable key={value} onPress={() => setView(value)} style={[styles.button, view === value && styles.selected]}><Text style={styles.buttonText}>{value}</Text></Pressable>)}<Pressable disabled={busy} onPress={() => void refresh()} style={styles.button}><Text style={styles.buttonText}>REFRESH</Text></Pressable></View>
    {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}{busy && <ActivityIndicator />}
    {view === 'SERVE' ? <>
      <View style={styles.row}>{(['ATHLETE', 'VOLUNTEER'] as const).map(value => <Pressable key={value} disabled={busy} onPress={() => { setAudience(value); setQuery(''); setMessage(''); setData(current => ({ ...current, recipients: [] })); }} style={[styles.button, audience === value && styles.selected]}><Text style={styles.buttonText}>{value}</Text></Pressable>)}</View>
      <TextInput editable={!busy} value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} placeholder={audience === 'ATHLETE' ? 'Athlete BIB / band' : 'Assigned volunteer band'} placeholderTextColor="#687780" autoCapitalize="characters" style={styles.input} />
      <View style={styles.row}><Pressable disabled={busy} style={styles.button} onPress={() => void search()}><Text style={styles.buttonText}>SEARCH</Text></Pressable><Pressable disabled={busy} style={styles.button} onPress={() => void scan()}><Text style={styles.buttonText}>SCAN QR / BARCODE</Text></Pressable></View>
      <Text style={styles.text}>Search or scan identifies a person only. Confirm a serving below. Each relay member is served individually.</Text>
      {!data.services.length && <Text style={styles.message}>No catering services configured. Ask an admin to configure meal windows and item stock.</Text>}
      {data.recipients.map(recipient => <View key={recipient.id} style={styles.card}><Text style={styles.heading}>{recipient.name}</Text><Text style={styles.text}>{recipient.identifier} · {recipient.category}</Text>
        {data.services.filter(service => service.active).map(service => {
          const remaining = Math.max(0, service.totalServings - (data.counts[service.id] || 0));
          const now = Date.now(), open = now >= Date.parse(service.startsAt) && now < Date.parse(service.endsAt);
          const eligible = recipient.audience === 'VOLUNTEER' ? service.volunteersEligible : service.athletesEligible && (!service.categories.length || service.categories.some(value => value.toLowerCase() === recipient.category.toLowerCase()));
          return <View key={service.id}><Text style={styles.text}>{service.name} · {remaining} remaining · {new Date(service.startsAt).toLocaleString()} – {new Date(service.endsAt).toLocaleString()}</Text><Pressable disabled={busy || !open || !eligible || !remaining} style={[styles.button, (busy || !open || !eligible || !remaining) && styles.disabled]} onPress={() => Alert.alert('Confirm serving', `${service.name} for ${recipient.name} (${recipient.identifier})?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Serve', onPress: () => void issue(service, recipient) }])}><Text style={styles.buttonText}>{!eligible ? 'NOT ELIGIBLE' : !open ? 'OUTSIDE SERVING WINDOW' : !remaining ? 'OUT OF STOCK' : `SERVE ${service.name}`}</Text></Pressable></View>;
        })}
      </View>)}
    </> : <>
      {data.services.map(service => <Text key={service.id} style={styles.text}>{service.name}: {data.counts[service.id] || 0} served · {Math.max(0, service.totalServings - (data.counts[service.id] || 0))} remaining</Text>)}
      <Text style={styles.text}>Recent 100 servings · {data.recent.filter(row => row.operatorId === operatorId).length} by you in this list</Text>
      {data.recent.map(row => <View key={row.id} style={styles.card}><Text style={styles.heading}>{row.serviceName}</Text><Text style={styles.text}>{row.recipient.audience} · {row.recipient.name} · {row.recipient.identifier}</Text><Text style={styles.text}>{new Date(row.issuedAt).toLocaleString()} · {row.operatorName}</Text></View>)}
    </>}
    <Modal visible={scanner} onRequestClose={() => setScanner(false)}><View style={{ flex: 1 }}><CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13'] }} onBarcodeScanned={({ data: raw }) => { if (scannerUsed.current) return; scannerUsed.current = true; setScanner(false); let value = raw.trim(); try { const url = new URL(value); value = url.searchParams.get(audience === 'ATHLETE' ? 'bib' : 'bandCode') || url.searchParams.get('code') || value; } catch { /* Plain printed identifier. */ } setQuery(value); void search(value); }} /><Pressable style={styles.button} onPress={() => setScanner(false)}><Text style={styles.buttonText}>CLOSE SCANNER</Text></Pressable></View></Modal>
  </View>;
}
const styles = StyleSheet.create({ panel: { gap: 12, padding: 14 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, heading: { color: '#112b38', fontSize: 18, fontWeight: '800' }, text: { color: '#304c5a', marginVertical: 6 }, input: { backgroundColor: '#fff', color: '#112b38', borderWidth: 1, borderColor: '#9baeb7', padding: 14, borderRadius: 8 }, button: { backgroundColor: '#153c4b', padding: 12, borderRadius: 8, marginVertical: 4 }, selected: { backgroundColor: '#007b52' }, buttonText: { color: '#fff', fontWeight: '700' }, message: { color: '#6c3b08', padding: 12, backgroundColor: '#fff1d9' }, card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 8 }, disabled: { opacity: 0.4 } });
