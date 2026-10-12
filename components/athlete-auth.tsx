"use client";

import { firebaseAuth, isFirebaseConfigured, loadFirebaseAnalytics } from "@/lib/firebase-client";
import { saveAthleteProfileToFirestore } from "@/lib/firebase-athlete-profile-client";
import { COUNTRIES } from "@/lib/countries";
import { AccountResolutionError, openLinkedAccount } from "@/lib/account-access-client";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

type Mode = "login" | "register";
type LoginMethod = "password" | "otp";

function readableAuthError(error: unknown) {
  if (error instanceof AccountResolutionError) return error.message;
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "The email or password is incorrect.";
  }
  if (code.includes("email-already-in-use")) return "An account already exists for this email.";
  if (code.includes("weak-password")) return "Use a stronger password with at least 6 characters.";
  if (code.includes("popup-closed")) return "Google sign-in was closed before completion.";
  if (code.includes("popup-blocked")) return "Allow pop-ups for this site to continue with Google.";
  if (code.includes("operation-not-allowed")) return "This sign-in method is not enabled yet.";
  if (code.includes("network-request-failed")) return "Check your connection and try again.";
  if (code.includes("too-many-requests")) return "Too many sign-in attempts. Please wait a moment and try again.";
  if (code.includes("user-disabled")) return "This athlete account has been disabled. Contact Race Upshot support.";
  if (code.includes("invalid-api-key") || code.includes("unauthorized-domain")) {
    return "Athlete login is not available from this website address.";
  }
  return "We could not complete sign-in. Please try again.";
}

export function AthleteAuth() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("password");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneCountryCode, setPhoneCountryCode] = useState("+91");
  const [mobileNumber, setMobileNumber] = useState("");
  const [country, setCountry] = useState("IN");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const submitting = useRef(false);

  useEffect(() => {
    void loadFirebaseAnalytics();
    const unsubscribe = firebaseAuth.onAuthStateChanged((user) => {
      if (user && !submitting.current) {
        setBusy(true);
        setError("");
        void openLinkedAccount(user).catch((cause) => {
          setError(readableAuthError(cause));
          setBusy(false);
        });
      }
    });
    return unsubscribe;
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    submitting.current = true;
    let accountMessage = "";
    try {
      if (mode === "login" && loginMethod === "otp") {
        const endpoint = otpSent ? "/api/auth/otp/verify" : "/api/auth/otp/request";
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(otpSent ? { email: email.trim(), otp } : { email: email.trim() }),
        });
        const payload = await response.json() as { ok?: boolean; data?: { message?: string }; error?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to continue with OTP.");
        if (!otpSent) {
          setOtpSent(true);
          setMessage(payload.data?.message || "OTP sent. It is valid for 5 minutes.");
          return;
        }
        router.replace("/athlete");
        return;
      }
      if (mode === "register") {
        if (password !== confirmPassword) throw new Error("PASSWORDS_DO_NOT_MATCH");
        const credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
        await updateProfile(credential.user, { displayName: name.trim() });
        try {
          await sendEmailVerification(credential.user, {
            url: "https://raceupshot.com/athlete?verified=1",
            handleCodeInApp: false,
          });
          accountMessage = `Verification email sent to ${credential.user.email || email.trim()}. Check Spam or Promotions if needed.`;
        } catch {
          accountMessage = "Your account was created, but Firebase could not send verification email. Use Resend email from your account.";
        }
        const athleteProfile = {
          name,
          phoneCountryCode,
          mobileNumber,
          country,
          state,
          city,
          photoUrl: credential.user.photoURL || "",
          trackingVisibility: "PUBLIC" as const,
        };
        await saveAthleteProfileToFirestore(credential.user, athleteProfile);
        const token = await credential.user.getIdToken(true);
        const profileResponse = await fetch("/api/v1/athlete/me", {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(athleteProfile),
        });
        if (!profileResponse.ok) throw new Error("PROFILE_SAVE_FAILED");
        if (accountMessage) sessionStorage.setItem("raceupshot-account-message", accountMessage);
        await openLinkedAccount(credential.user);
        return;
      } else {
        const credential = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
        await openLinkedAccount(credential.user);
        return;
      }
    } catch (cause) {
      if (cause instanceof Error && cause.message === "PASSWORDS_DO_NOT_MATCH") {
        setError("The passwords do not match.");
      } else if (cause instanceof Error && cause.message === "PROFILE_SAVE_FAILED") {
        setError("Your login was created, but the profile details could not be saved. Open your account to complete them.");
      } else {
        setError(readableAuthError(cause));
        if (mode === "login" && loginMethod === "otp" && cause instanceof Error) setError(cause.message);
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim());
      setMessage("If an account exists for that email, a reset link has been sent.");
    } catch (cause) {
      setError(readableAuthError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setBusy(true);
    setError("");
    try {
      const credential = await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
      await openLinkedAccount(credential.user);
    } catch (cause) {
      setError(readableAuthError(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!isFirebaseConfigured) {
    return <div className="auth-alert auth-alert-error">Athlete login is not configured for this environment.</div>;
  }

  return (
    <div className="athlete-auth-card">
      <div className="auth-card-heading">
        <span><ShieldCheck size={15} /> {mode === "login" ? "Secure account access" : "Athlete registration"}</span>
        <h1>{mode === "login" ? "Welcome back." : "Create your athlete account."}</h1>
        <p>{mode === "login" ? (loginMethod === "otp" ? "Use the secure code sent to your registered athlete email." : "Sign in once. We will securely open your linked admin, athlete, or volunteer account.") : "Your account will securely connect your future results and race activity."}</p>
      </div>

      <form onSubmit={submit} className="athlete-auth-form">
        {mode === "register" && (
          <>
            <label>
              Full name
              <div className="auth-input"><span aria-hidden="true">Aa</span><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" minLength={2} required placeholder="Athlete name" /></div>
            </label>
            <div className="auth-form-row auth-phone-row">
              <label>
                Country code
                <div className="auth-input"><input value={phoneCountryCode} onChange={(event) => setPhoneCountryCode(event.target.value)} autoComplete="tel-country-code" inputMode="tel" pattern="\+\d{1,4}" required placeholder="+91" /></div>
              </label>
              <label>
                Mobile number
                <div className="auth-input"><input value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value.replace(/\D/g, ""))} autoComplete="tel-national" inputMode="numeric" pattern="\d{5,15}" required placeholder="9876543210" /></div>
              </label>
            </div>
            <label>
              Country
              <div className="auth-input"><span aria-hidden="true">🌐</span><select value={country} onChange={(event) => setCountry(event.target.value)} autoComplete="country" required>{COUNTRIES.map((option) => <option key={option.code} value={option.code}>{option.flag} {option.name}</option>)}</select></div>
            </label>
            <div className="auth-form-row">
              <label>
                State
                <div className="auth-input"><input value={state} onChange={(event) => setState(event.target.value)} autoComplete="address-level1" minLength={2} required placeholder="State" /></div>
              </label>
              <label>
                City
                <div className="auth-input"><input value={city} onChange={(event) => setCity(event.target.value)} autoComplete="address-level2" minLength={2} required placeholder="City" /></div>
              </label>
            </div>
          </>
        )}
        <label>
          Email address
          <div className="auth-input"><Mail size={17} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="you@example.com" /></div>
        </label>
        {(mode === "register" || loginMethod === "password") && (
          <label>
            Password
            <div className="auth-input">
              <LockKeyhole size={17} />
              <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={6} required placeholder="Minimum 6 characters" />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            </div>
          </label>
        )}
        {mode === "login" && loginMethod === "otp" && otpSent && (
          <label>
            One-time password
            <div className="auth-input">
              <KeyRound size={17} />
              <input value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))} autoComplete="one-time-code" inputMode="numeric" pattern="\d{6}" required placeholder="6-digit OTP" />
            </div>
          </label>
        )}
        {mode === "register" && (
          <label>
            Confirm password
            <div className="auth-input">
              <LockKeyhole size={17} />
              <input type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={6} required placeholder="Enter password again" />
            </div>
          </label>
        )}

        {mode === "login" && loginMethod === "password" && <button className="auth-reset" type="button" onClick={() => void resetPassword()} disabled={busy}>Don&apos;t remember your password?</button>}
        {mode === "login" && (
          <button className="auth-reset" type="button" disabled={busy} onClick={() => {
            setLoginMethod((current) => current === "password" ? "otp" : "password");
            setOtp("");
            setOtpSent(false);
            setError("");
            setMessage("");
          }}>{loginMethod === "password" ? "Log in with OTP" : "Use password instead"}</button>
        )}
        {error && <div role="alert" className="auth-alert auth-alert-error">{error}</div>}
        {message && <div role="status" className="auth-alert auth-alert-success">{message}</div>}

        <button className="button button-primary auth-submit" type="submit" disabled={busy}>
          {busy ? "Please wait…" : mode === "register" ? "Create account" : loginMethod === "otp" ? (otpSent ? "Verify OTP" : "Send OTP") : "Log in"} <ArrowRight size={17} />
        </button>
      </form>

      <div className="auth-divider"><span>or</span></div>
      <button className="auth-google" type="button" onClick={() => void signInWithGoogle()} disabled={busy}>
        <b>G</b> Continue with Google
      </button>

      <p className="auth-switch">
        {mode === "login" ? "New to Race Upshot?" : "Already have an account?"}{" "}
        <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setLoginMethod("password"); setOtpSent(false); setOtp(""); setError(""); setMessage(""); }}>
          {mode === "login" ? "Create account" : "Log in"}
        </button>
      </p>
      <p className="auth-privacy">By continuing, you agree to use this account for Race Upshot timing and result services. <Link href="/about">Learn more</Link>.</p>
    </div>
  );
}
