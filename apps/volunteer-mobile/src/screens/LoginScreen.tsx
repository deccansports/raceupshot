import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { apiRequest } from '../api';
import { saveVolunteerToken } from '../auth';
import volunteerLogo from '../../RACE UPSHOT VOLUYNTEER APP LOGO.png';

export function LoginScreen({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const scrollRef = useRef<ScrollView>(null);
  const cardTop = useRef(0);
  function revealForm() {
    scrollRef.current?.scrollTo({ y: Math.max(0, cardTop.current - 12), animated: true });
  }
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', revealForm);
    return () => subscription.remove();
  }, []);
  const [method, setMethod] = useState<'password' | 'otp'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!email.trim()) { setError('Enter your assigned volunteer email.'); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      if (method === 'password') {
        if (password.length < 8) throw new Error('Enter your password (minimum 8 characters).');
        const data = await apiRequest<{ sessionToken: string }>('/api/mobile/volunteer/auth/password', { method: 'POST', body: JSON.stringify({ email, password }) }, false);
        await saveVolunteerToken(data.sessionToken);
        await onSignedIn();
      } else if (!sent) {
        const data = await apiRequest<{ requested: boolean; message: string }>('/api/mobile/volunteer/auth/request', { method: 'POST', body: JSON.stringify({ email }) }, false);
        setSent(true); setMessage(data.message);
      } else {
        if (!/^\d{6}$/.test(otp)) throw new Error('Enter the complete six-digit OTP.');
        const data = await apiRequest<{ sessionToken: string }>('/api/mobile/volunteer/auth/verify', { method: 'POST', body: JSON.stringify({ email, otp }) }, false);
        await saveVolunteerToken(data.sessionToken);
        await onSignedIn();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in.');
    } finally { setBusy(false); }
  }

  function changeMethod(next: 'password' | 'otp') {
    setMethod(next); setSent(false); setOtp(''); setPassword(''); setMessage(null); setError(null);
  }

  return <SafeAreaView style={styles.safe}>
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Image source={volunteerLogo} alt="Race Upshot Volunteer logo" style={styles.logo} />
        <Text style={styles.eyebrow}>RACE OPERATIONS</Text>
        <Text style={styles.title}>Race Upshot{`\n`}Volunteer</Text>
        <Text style={styles.subtitle}>Waiver, check-in, bike control, counters and timing—scoped to your assigned event.</Text>
        <View style={styles.card} onLayout={(event) => { cardTop.current = event.nativeEvent.layout.y; }}>
          <View style={styles.methodRow}>
            <Pressable disabled={busy} onPress={() => changeMethod('password')} style={[styles.methodButton, method === 'password' && styles.methodButtonActive]}><Text style={[styles.methodText, method === 'password' && styles.methodTextActive]}>PASSWORD</Text></Pressable>
            <Pressable disabled={busy} onPress={() => changeMethod('otp')} style={[styles.methodButton, method === 'otp' && styles.methodButtonActive]}><Text style={[styles.methodText, method === 'otp' && styles.methodTextActive]}>OTP</Text></Pressable>
          </View>
          <Text style={styles.cardTitle}>{method === 'password' ? 'Sign in with password' : sent ? 'Enter your OTP' : 'Sign in with email and WhatsApp OTP'}</Text>
          <Text style={styles.label}>ASSIGNED EMAIL</Text>
          <TextInput autoCapitalize="none" autoCorrect={false} editable={method === 'password' ? !busy : !sent && !busy} showSoftInputOnFocus keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="volunteer@example.com" placeholderTextColor="#6f7b82" style={styles.input} />
          {method === 'password' ? <><Text style={styles.label}>PASSWORD</Text><TextInput autoCapitalize="none" autoCorrect={false} secureTextEntry editable={!busy} showSoftInputOnFocus value={password} onChangeText={setPassword} onSubmitEditing={() => void submit()} placeholder="Enter your password" placeholderTextColor="#6f7b82" style={styles.input} /></> : null}
          {method === 'otp' && sent ? <><Text style={styles.label}>6-DIGIT OTP</Text><TextInput autoFocus keyboardType="number-pad" maxLength={6} showSoftInputOnFocus value={otp} onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" placeholderTextColor="#6f7b82" style={[styles.input, styles.otp]} /></> : null}
          {message ? <Text style={styles.info}>{message}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable disabled={busy} onPress={() => void submit()} style={[styles.button, busy && styles.disabled]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{method === 'password' ? 'Sign in and continue' : sent ? 'Verify and continue' : 'Send secure OTP'}</Text>}</Pressable>
          {method === 'otp' && sent ? <Pressable disabled={busy} onPress={() => { setSent(false); setOtp(''); setMessage(null); setError(null); }}><Text style={styles.link}>Change email or resend</Text></Pressable> : null}
        </View>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://raceupshot.com/privacy/volunteer')} style={styles.privacyLink}>
          <Text style={styles.privacyLinkText}>Volunteer app privacy policy</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#080b0e' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 26, paddingVertical: 52 },
  logo: { width: 92, height: 92, borderRadius: 22 },
  eyebrow: { color: '#ff6b21', fontSize: 11, fontWeight: '900', letterSpacing: 2, marginTop: 24 },
  title: { color: '#fff', fontSize: 38, lineHeight: 40, fontWeight: '900', fontStyle: 'italic', marginTop: 7 },
  subtitle: { color: '#a5afb5', fontSize: 14, lineHeight: 21, marginTop: 13, maxWidth: 420 },
  card: { backgroundColor: '#13181c', borderWidth: 1, borderColor: '#272f34', borderRadius: 22, padding: 20, marginTop: 30 },
  methodRow: { flexDirection: 'row', padding: 4, borderRadius: 12, backgroundColor: '#0d1114', marginBottom: 18 },
  methodButton: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  methodButtonActive: { backgroundColor: '#ff6b21' },
  methodText: { color: '#8f9aa1', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  methodTextActive: { color: '#fff' },
  cardTitle: { color: '#fff', fontSize: 20, fontWeight: '900', marginBottom: 18 },
  label: { color: '#8f9aa1', fontSize: 10, fontWeight: '900', letterSpacing: 1.1, marginBottom: 7, marginTop: 10 },
  input: { height: 52, borderRadius: 13, borderWidth: 1, borderColor: '#343e44', backgroundColor: '#0d1114', color: '#fff', paddingHorizontal: 14, fontSize: 15 },
  otp: { fontSize: 24, fontWeight: '900', letterSpacing: 8, textAlign: 'center' },
  info: { color: '#b8d9c1', backgroundColor: '#13291a', borderRadius: 10, padding: 11, fontSize: 12, lineHeight: 17, marginTop: 14 },
  error: { color: '#ffc0c4', backgroundColor: '#32161a', borderRadius: 10, padding: 11, fontSize: 12, lineHeight: 17, marginTop: 14 },
  button: { height: 52, borderRadius: 14, backgroundColor: '#ff6b21', alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  link: { color: '#aeb7bc', textAlign: 'center', fontWeight: '800', marginTop: 17 },
  privacyLink: { alignSelf: 'center', padding: 12, marginTop: 8 },
  privacyLinkText: { color: '#aeb7bc', fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },
  disabled: { opacity: 0.55 },
});
