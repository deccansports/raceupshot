import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { ApiError, apiRequest } from './src/api';
import { clearVolunteerToken, getVolunteerToken } from './src/auth';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import type { VolunteerSession } from './src/types';
import volunteerLogo from './RACE UPSHOT VOLUYNTEER APP LOGO.png';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<VolunteerSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [athleteProfileAvailable, setAthleteProfileAvailable] = useState(false);

  const webProfileRequest = useCallback(async (method: 'GET' | 'POST' = 'GET') => {
    const token = await getVolunteerToken();
    const response = await fetch('/api/auth/profiles', {
      method,
      headers: {
        ...(token ? { authorization: `Volunteer ${token}` } : {}),
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify({ target: 'ATHLETE' }) } : {}),
      cache: 'no-store',
    });
    const body = await response.json() as { ok?: boolean; data?: { athlete?: unknown }; error?: string };
    if (!response.ok || !body.ok) throw new Error(body.error || 'Unable to change profile.');
    return body.data;
  }, []);

  const loadAssignment = useCallback(async () => {
    setLoading(true);
    try {
      if (!await getVolunteerToken()) {
        setSession(null);
        setError(null);
        setAthleteProfileAvailable(false);
        return;
      }
      const next = await apiRequest<VolunteerSession>('/api/mobile/volunteer/assignment');
      if (!next.assignments.length) throw new Error('No active event is assigned to this volunteer account.');
      setSession(next);
      setError(null);
      if (Platform.OS === 'web') {
        void webProfileRequest().then((profiles) => setAthleteProfileAvailable(Boolean(profiles?.athlete))).catch(() => setAthleteProfileAvailable(false));
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) await clearVolunteerToken();
      setSession(null);
      setAthleteProfileAvailable(false);
      setError(caught instanceof Error ? caught.message : 'Volunteer access is unavailable.');
    } finally {
      setLoading(false);
    }
  }, [webProfileRequest]);

  useEffect(() => {
    const initial = setTimeout(() => void loadAssignment(), 0);
    return () => clearTimeout(initial);
  }, [loadAssignment]);

  return <SafeAreaProvider>
    <StatusBar style="light" />
    {loading ? <View style={styles.loading}><Image source={volunteerLogo} alt="Race Upshot Volunteer logo" style={styles.loadingLogo} /><ActivityIndicator size="large" color="#00a651" /><Text style={styles.loadingText}>Loading race operations…</Text></View>
      : session ? <DashboardScreen session={session} onRefreshSession={loadAssignment} onOpenAthleteProfile={Platform.OS === 'web' && athleteProfileAvailable ? async () => { await webProfileRequest('POST'); globalThis.location.assign('/athlete'); } : undefined} onLogout={async () => { await clearVolunteerToken(); setSession(null); setError(null); setAthleteProfileAvailable(false); }} />
        : error ? <View style={styles.error}><Image source={volunteerLogo} alt="Race Upshot Volunteer logo" style={styles.errorLogo} /><Text style={styles.title}>Access unavailable</Text><Text style={styles.copy}>{error}</Text><Pressable style={styles.button} onPress={() => void loadAssignment()}><Text style={styles.buttonText}>Check again</Text></Pressable><Pressable onPress={async () => { await clearVolunteerToken(); setError(null); }}><Text style={styles.link}>Use another account</Text></Pressable></View>
          : <LoginScreen onSignedIn={loadAssignment} />}
  </SafeAreaProvider>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: '#080b0e', alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingLogo: { width: 92, height: 92, borderRadius: 22, marginBottom: 6 },
  loadingText: { color: '#9da7ad', fontSize: 13, fontWeight: '700' },
  error: { flex: 1, backgroundColor: '#080b0e', alignItems: 'center', justifyContent: 'center', padding: 30 },
  errorLogo: { width: 92, height: 92, borderRadius: 22 },
  title: { color: '#fff', fontSize: 26, fontWeight: '900', marginTop: 20 },
  copy: { color: '#aeb7bc', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 10, marginBottom: 24 },
  button: { backgroundColor: '#ff6b21', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14 },
  buttonText: { color: '#fff', fontWeight: '900' },
  link: { color: '#aeb7bc', fontWeight: '800', marginTop: 20 },
});
