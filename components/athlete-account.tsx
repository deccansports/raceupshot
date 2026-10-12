"use client";

import { firebaseAuth } from "@/lib/firebase-client";
import { saveAthleteProfileToFirestore } from "@/lib/firebase-athlete-profile-client";
import type { AthleteProfile, AthleteProfileInput } from "@/lib/athlete-profile";
import { COUNTRIES, normalizeCountryCode } from "@/lib/countries";
import type { FirebaseAthleteIdentity } from "@/lib/firebase-auth-server";
import { onAuthStateChanged, sendEmailVerification, signOut, updateProfile, type User } from "firebase/auth";
import { ArrowRight, BadgeCheck, Edit3, Eye, EyeOff, LogOut, MailCheck, Save, Search, ShieldCheck, UserRound, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ProfileImageCropper } from "./profile-image-cropper";
import { AthleteWaivers } from "./athlete-waivers";

type AccountData = FirebaseAthleteIdentity & { profile: AthleteProfile | null };
type AccountEnvelope = { success: true; data: AccountData };

const emptyProfile: AthleteProfileInput = {
  name: "",
  phoneCountryCode: "+91",
  mobileNumber: "",
  country: "IN",
  state: "",
  city: "",
  photoUrl: "",
  trackingVisibility: "PUBLIC",
};

export function AthleteAccount() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [otpSession, setOtpSession] = useState(false);
  const [identity, setIdentity] = useState<AccountData | null>(null);
  const [profile, setProfile] = useState(emptyProfile);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [privacyMessage, setPrivacyMessage] = useState("");
  const [privacyError, setPrivacyError] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const accountMessage = sessionStorage.getItem("raceupshot-account-message");
    if (!accountMessage) return;
    sessionStorage.removeItem("raceupshot-account-message");
    const timer = window.setTimeout(() => setMessage(accountMessage), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => onAuthStateChanged(firebaseAuth, async (currentUser) => {
    if (!currentUser) {
      try {
        const sessionResponse = await fetch("/api/auth/otp/session", { cache: "no-store" });
        const sessionBody = await sessionResponse.json() as { data?: { authenticated?: boolean } };
        if (!sessionResponse.ok || !sessionBody.data?.authenticated) {
          router.replace("/athlete/login");
          return;
        }
        setOtpSession(true);
        const response = await fetch("/api/v1/athlete/me", { cache: "no-store" });
        if (!response.ok) throw new Error("Account verification failed.");
        const body = await response.json() as AccountEnvelope;
        setIdentity(body.data);
        setProfile({
          name: body.data.profile?.name || body.data.name || "",
          phoneCountryCode: body.data.profile?.phoneCountryCode || "+91",
          mobileNumber: body.data.profile?.mobileNumber || "",
          country: normalizeCountryCode(body.data.profile?.country) || "IN",
          state: body.data.profile?.state || "",
          city: body.data.profile?.city || "",
          photoUrl: body.data.profile?.photoUrl || body.data.picture || "",
          trackingVisibility: body.data.profile?.trackingVisibility || "PUBLIC",
        });
      } catch {
        setError("Your OTP session could not be verified. Please sign in again.");
      } finally {
        setLoading(false);
      }
      return;
    }
    try {
      await currentUser.reload();
      const activeUser = firebaseAuth.currentUser || currentUser;
      setUser(activeUser);
      const token = await activeUser.getIdToken(true);
      const response = await fetch("/api/v1/athlete/me", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Account verification failed.");
      const body = await response.json() as AccountEnvelope;
      setIdentity(body.data);
      setProfile({
        name: body.data.profile?.name || body.data.name || currentUser.displayName || "",
        phoneCountryCode: body.data.profile?.phoneCountryCode || "+91",
        mobileNumber: body.data.profile?.mobileNumber || "",
        country: normalizeCountryCode(body.data.profile?.country) || "IN",
        state: body.data.profile?.state || "",
        city: body.data.profile?.city || "",
        photoUrl: body.data.profile?.photoUrl || body.data.picture || activeUser.photoURL || "",
        trackingVisibility: body.data.profile?.trackingVisibility || "PUBLIC",
      });
    } catch {
      setError("Your session could not be verified. Please sign in again.");
    } finally {
      setLoading(false);
    }
  }), [router]);

  async function logOut() {
    if (user) await signOut(firebaseAuth);
    if (otpSession) await fetch("/api/auth/otp/session", { method: "DELETE" });
    router.replace("/athlete/login");
  }

  async function resendVerification() {
    if (!user) return;
    setError("");
    try {
      await user.reload();
      if (user.emailVerified) {
        setUser(firebaseAuth.currentUser);
        setMessage("Your email is already verified.");
        return;
      }
      await sendEmailVerification(user, {
        url: "https://raceupshot.com/athlete?verified=1",
        handleCodeInApp: false,
      });
      setMessage(`Verification email sent to ${user.email || "your email"}. Check Spam or Promotions if it is not in your inbox.`);
    } catch {
      setError("Firebase could not send the verification email. Please wait a minute and try again; also confirm the email address is correct.");
    }
  }

  async function uploadProfileImage(blob: Blob) {
    if (!user && !otpSession) return;
    setUploadingImage(true);
    setError("");
    try {
      const photoUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Unable to read the cropped image."));
        reader.onerror = () => reject(new Error("Unable to read the cropped image."));
        reader.readAsDataURL(blob);
      });
      setProfile((current) => ({ ...current, photoUrl }));
      setMessage("Image cropped. Select Save changes to update your profile.");
    } catch {
      throw new Error("The cropped profile image could not be prepared.");
    } finally {
      setUploadingImage(false);
    }
  }

  async function saveProfile() {
    if (!user && !otpSession) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      if (user) {
        await updateProfile(user, {
          displayName: profile.name.trim(),
          ...(profile.photoUrl?.startsWith("https://") ? { photoURL: profile.photoUrl.trim() } : {}),
        });
        await saveAthleteProfileToFirestore(user, profile);
      }
      const token = user ? await user.getIdToken(true) : "";
      const response = await fetch("/api/v1/athlete/me", {
        method: "PUT",
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify(profile),
      });
      const body = await response.json() as AccountEnvelope | { error?: { message?: string } };
      if (!response.ok || !("success" in body) || !body.success) {
        throw new Error("error" in body ? body.error?.message : "Unable to update account.");
      }
      setIdentity(body.data);
      setProfile({
        name: body.data.profile?.name || profile.name,
        phoneCountryCode: body.data.profile?.phoneCountryCode || profile.phoneCountryCode,
        mobileNumber: body.data.profile?.mobileNumber || profile.mobileNumber,
        country: normalizeCountryCode(body.data.profile?.country || profile.country) || "IN",
        state: body.data.profile?.state || profile.state,
        city: body.data.profile?.city || profile.city,
        photoUrl: body.data.profile?.photoUrl || "",
        trackingVisibility: body.data.profile?.trackingVisibility || profile.trackingVisibility,
      });
      setEditing(false);
      setMessage("Account details updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update account.");
    } finally {
      setSaving(false);
    }
  }

  async function savePrivacy(trackingVisibility: "PUBLIC" | "ANONYMOUS") {
    if ((!user && !otpSession) || privacySaving || profile.trackingVisibility === trackingVisibility) return;
    const previousVisibility = profile.trackingVisibility;
    const saved = identity?.profile;
    const nextProfile: AthleteProfileInput = {
      name: saved?.name || identity?.name || user?.displayName || profile.name,
      phoneCountryCode: saved?.phoneCountryCode || profile.phoneCountryCode,
      mobileNumber: saved?.mobileNumber || profile.mobileNumber,
      country: saved?.country || profile.country,
      state: saved?.state || profile.state,
      city: saved?.city || profile.city,
      photoUrl: saved?.photoUrl || user?.photoURL || profile.photoUrl,
      trackingVisibility,
    };
    setProfile((current) => ({ ...current, trackingVisibility }));
    setPrivacySaving(true);
    setPrivacyMessage("");
    setPrivacyError("");
    try {
      const token = user ? await user.getIdToken(true) : "";
      const response = await fetch("/api/v1/athlete/me", {
        method: "PUT",
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify(nextProfile),
      });
      const body = await response.json() as AccountEnvelope | { error?: { message?: string } };
      if (!response.ok || !("success" in body) || !body.success) {
        throw new Error("error" in body ? body.error?.message : "Unable to update live tracking privacy.");
      }
      setIdentity(body.data);
      if (user) {
        try {
          await saveAthleteProfileToFirestore(user, nextProfile);
        } catch {
          setPrivacyMessage("Live tracking privacy saved. Account profile synchronization is pending.");
          return;
        }
      }
      setPrivacyMessage(trackingVisibility === "PUBLIC"
        ? "Public live tracking enabled."
        : "Anonymous live tracking enabled.");
    } catch (cause) {
      setProfile((current) => ({ ...current, trackingVisibility: previousVisibility }));
      setPrivacyError(cause instanceof Error ? cause.message : "Unable to update live tracking privacy.");
    } finally {
      setPrivacySaving(false);
    }
  }

  if (loading) {
    return <div className="account-loading"><span className="auth-spinner" /> Verifying your secure session…</div>;
  }

  if (!user && !otpSession) return null;
  const displayName = identity?.profile?.name || identity?.name || user?.displayName || "Athlete";
  const initials = displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const verified = identity?.emailVerified ?? user?.emailVerified ?? false;
  const photoUrl = identity?.profile?.photoUrl || user?.photoURL;

  return (
    <div className="athlete-account-grid">
      <section className="athlete-profile-card">
        <div className="athlete-account-avatar">{photoUrl ? <Image src={photoUrl} alt="" width={78} height={78} unoptimized /> : initials || <UserRound />}</div>
        <div>
          <span className="eyebrow">ATHLETE ACCOUNT</span>
          <h1>{displayName}</h1>
          <p>{identity?.email || user?.email}</p>
          <div className={verified ? "account-state verified" : "account-state"}>
            {verified ? <BadgeCheck size={15} /> : <MailCheck size={15} />}
            {verified ? "Email verified" : "Email verification pending"}
          </div>
        </div>
        <button className="account-edit-button" type="button" onClick={() => { setEditing((value) => !value); setError(""); setMessage(""); }}>
          {editing ? <X size={15} /> : <Edit3 size={15} />} {editing ? "Cancel" : "Edit account"}
        </button>
      </section>

      {message && <div className="auth-alert auth-alert-success account-message">{message}</div>}
      {error && <div className="auth-alert auth-alert-error account-message">{error}</div>}
      {editing && (
        <section className="account-edit-card">
          <div className="account-edit-heading"><div><span className="eyebrow">PROFILE DETAILS</span><h2>Edit account</h2></div><small>Your email is managed by Firebase sign-in.</small></div>
          <div className="account-edit-fields">
            <label>Full name<input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} autoComplete="name" required /></label>
            <label>Email address<input value={identity?.email || user?.email || ""} disabled /></label>
            <ProfileImageCropper
              currentUrl={profile.photoUrl || ""}
              initials={profile.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "A"}
              busy={uploadingImage}
              onCropped={uploadProfileImage}
            />
            <div className="account-phone-fields">
              <label>Country code<input value={profile.phoneCountryCode} onChange={(event) => setProfile({ ...profile, phoneCountryCode: event.target.value })} inputMode="tel" placeholder="+91" /></label>
              <label>Mobile number<input value={profile.mobileNumber} onChange={(event) => setProfile({ ...profile, mobileNumber: event.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder="9876543210" /></label>
            </div>
            <label>Country<select value={normalizeCountryCode(profile.country) || "IN"} onChange={(event) => setProfile({ ...profile, country: event.target.value })} autoComplete="country">{COUNTRIES.map((option) => <option key={option.code} value={option.code}>{option.flag} {option.name}</option>)}</select></label>
            <label>State<input value={profile.state} onChange={(event) => setProfile({ ...profile, state: event.target.value })} autoComplete="address-level1" /></label>
            <label>City<input value={profile.city} onChange={(event) => setProfile({ ...profile, city: event.target.value })} autoComplete="address-level2" /></label>
          </div>
          <button className="button button-primary account-save-button" type="button" disabled={saving} onClick={() => void saveProfile()}>
            <Save size={15} /> {saving ? "Saving…" : "Save changes"}
          </button>
        </section>
      )}
      <AthleteWaivers user={user} displayName={displayName} />
      <section className="account-privacy-card">
        <div className="account-privacy-heading">
          <ShieldCheck />
          <div><span className="eyebrow">LIVE TRACKING PRIVACY</span><h2>Choose your visibility</h2><p>This setting saves independently from Edit Account.</p></div>
        </div>
        <div className="account-privacy-toggle" role="radiogroup" aria-label="Live tracking privacy">
          <button
            type="button"
            role="radio"
            aria-checked={profile.trackingVisibility === "PUBLIC"}
            disabled={privacySaving}
            className={profile.trackingVisibility === "PUBLIC" ? "public active" : "public"}
            onClick={() => void savePrivacy("PUBLIC")}
          ><Eye /> Public</button>
          <button
            type="button"
            role="radio"
            aria-checked={profile.trackingVisibility === "ANONYMOUS"}
            disabled={privacySaving}
            className={profile.trackingVisibility === "ANONYMOUS" ? "anonymous active" : "anonymous"}
            onClick={() => void savePrivacy("ANONYMOUS")}
          ><EyeOff /> Anonymous</button>
        </div>
        <div className={profile.trackingVisibility === "PUBLIC" ? "account-privacy-explanation public" : "account-privacy-explanation anonymous"}>
          {profile.trackingVisibility === "PUBLIC" ? <Eye /> : <EyeOff />}
          <div>
            <b>{profile.trackingVisibility === "PUBLIC" ? "Public tracking is selected" : "Anonymous tracking is selected"}</b>
            <p>{profile.trackingVisibility === "PUBLIC"
              ? "Your name, bib, photo and race progress are visible in public live tracking."
              : "Your timing and rank may appear as Anonymous Athlete. Your name, photo and bib are hidden and your bib cannot be found in public search."}</p>
          </div>
        </div>
        {privacySaving && <small className="account-privacy-saving">Saving privacy setting…</small>}
        {privacyMessage && <small className="account-privacy-message">{privacyMessage}</small>}
        {privacyError && <small className="account-privacy-error">{privacyError}</small>}
      </section>
      {!verified && user && (
        <section className="account-notice">
          <MailCheck />
          <div><b>Verify your email</b><p>Verification helps us safely connect registrations and results to your account.</p></div>
          <button type="button" onClick={() => void resendVerification()}>Resend email</button>
        </section>
      )}

      <section className="account-actions-card">
        <div><Search /><span><b>Find a result</b><small>Search by bib or athlete name.</small></span></div>
        <Link href="/results">Search results <ArrowRight /></Link>
      </section>
      <section className="account-actions-card">
        <div><ShieldCheck /><span><b>Privacy protected</b><small>Private timing data requires verified ownership.</small></span></div>
        <Link href="/about">How it works <ArrowRight /></Link>
      </section>

      <button className="account-logout" type="button" onClick={() => void logOut()}><LogOut size={16} /> Log out</button>
    </div>
  );
}
