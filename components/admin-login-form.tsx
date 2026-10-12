"use client";

import { Logo } from "@/components/logo";
import { openLinkedAccount } from "@/lib/account-access-client";
import { firebaseAuth } from "@/lib/firebase-client";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { KeyRound, LockKeyhole, Mail } from "lucide-react";
import { FormEvent, useState } from "react";

type LoginMethod = "password" | "otp";

export function AdminLoginForm() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<LoginMethod>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      if (method === "otp") {
        const response = await fetch(otpSent ? "/api/auth/otp/verify" : "/api/auth/otp/request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(otpSent
            ? { email: email.trim(), otp, surface: "ADMIN" }
            : { email: email.trim(), surface: "ADMIN" }),
        });
        const payload = await response.json() as { ok?: boolean; data?: { message?: string; destination?: string }; error?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.error || "Unable to continue with OTP.");
        if (!otpSent) {
          setOtpSent(true);
          setMessage(payload.data?.message || "OTP sent. It is valid for 5 minutes.");
          return;
        }
        window.location.assign(payload.data?.destination || "/admin");
        return;
      }
      const credential = await signInWithEmailAndPassword(
        firebaseAuth,
        email.trim(),
        password,
      );
      await openLinkedAccount(credential.user);
    } catch (cause) {
      const code = typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "";
      setError(code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")
        ? "The email or password is incorrect."
        : cause instanceof TypeError
          ? "The login service could not be reached. Refresh the page and try again."
          : cause instanceof Error ? cause.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function forgotPassword() {
    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim());
      setMessage("If a matching account exists, a password reset link has been sent.");
    } catch (cause) {
      const code = typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "";
      setError(code.includes("invalid-email") ? "Enter a valid email address." : "Unable to send the reset email. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function switchMethod() {
    setMethod((current) => current === "password" ? "otp" : "password");
    setOtp("");
    setOtpSent(false);
    setError("");
    setMessage("");
  }

  return (
    <main className="login-page">
      <section className="login-visual">
        <Logo inverse />
        <blockquote>Race day control, from the first read to the final result.</blockquote>
        <span className="eyebrow blue">SECURE OPERATIONS ACCESS</span>
      </section>
      <section className="login-form-wrap">
        <form className="login-form" onSubmit={submit}>
          <span className="eyebrow">RACE UPSHOT ADMIN</span>
          <h1>Welcome back.</h1>
          <p>{method === "otp" ? "Use the secure code sent to the configured admin email." : "Sign in once. Your verified account roles will be detected automatically."}</p>
          <div className="field">
            <label htmlFor="email">Email address</label>
            <div className="admin-auth-input"><Mail/><input id="email" name="email" type="email" autoComplete="username" value={email} onChange={(event)=>setEmail(event.target.value)} required /></div>
          </div>
          {method === "password" && <div className="field">
            <label htmlFor="password">Password</label>
            <div className="admin-auth-input"><LockKeyhole/><input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event)=>setPassword(event.target.value)} required /></div>
          </div>}
          {method === "otp" && otpSent && <div className="field">
            <label htmlFor="admin-otp">One-time password</label>
            <div className="admin-auth-input"><KeyRound/><input id="admin-otp" value={otp} onChange={(event)=>setOtp(event.target.value.replace(/\D/g,"").slice(0,6))} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" placeholder="6-digit OTP" required /></div>
          </div>}
          <div className="admin-login-links">
            {method === "password" && <button type="button" disabled={busy} onClick={()=>void forgotPassword()}>Forgot password?</button>}
            <button type="button" disabled={busy} onClick={switchMethod}>{method === "password" ? "Login with OTP" : "Use password instead"}</button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          {message && <p className="form-success" role="status">{message}</p>}
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? "Please wait…" : method === "otp" ? (otpSent ? "Verify OTP" : "Send OTP") : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
