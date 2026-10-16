"use client";

import { ChevronDown, ClipboardCheck, LayoutDashboard, LogIn, LogOut, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

interface AccountUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

interface VolunteerAccount {
  id: string;
  name: string;
  email: string;
}

interface AthleteAccount {
  uid: string | null;
  name: string | null;
  email: string;
}

interface LinkedProfiles {
  authenticated: boolean;
  activeProfile?: "ATHLETE" | "VOLUNTEER";
  athlete: AthleteAccount | null;
  volunteer: VolunteerAccount | null;
}

const VOLUNTEER_TOKEN_KEY = "raceupshot-volunteer-session";

export function AccountSwitcher() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminReady, setAdminReady] = useState(false);
  const [profiles, setProfiles] = useState<LinkedProfiles>({ authenticated: false, athlete: null, volunteer: null });
  const [profilesReady, setProfilesReady] = useState(false);
  const [profilePhoto, setProfilePhoto] = useState("");
  const [switching, setSwitching] = useState<"ATHLETE" | "VOLUNTEER" | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [switchError, setSwitchError] = useState("");

  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => undefined;

    void Promise.all([
      import("@/lib/firebase-client"),
      import("firebase/auth"),
      import("firebase/firestore"),
    ]).then(([client, authModule, firestoreModule]) => {
      if (!active) return;
      unsubscribe = authModule.onAuthStateChanged(client.firebaseAuth, (currentUser) => {
        if (!active) return;
        setUser(currentUser);
        setAuthReady(true);
        setProfilePhoto("");
        if (currentUser) {
          void firestoreModule.getDoc(firestoreModule.doc(client.firebaseDb, "users", currentUser.uid))
            .then((snapshot) => {
              const photoUrl = snapshot.data()?.photoUrl;
              if (active && typeof photoUrl === "string") setProfilePhoto(photoUrl);
            })
            .catch(() => undefined);
        }
      });
    }).catch(() => {
      if (active) setAuthReady(true);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    let active = true;
    async function syncLinkedProfiles() {
      const volunteerToken = window.localStorage.getItem(VOLUNTEER_TOKEN_KEY);
      let authorization = volunteerToken ? `Volunteer ${volunteerToken}` : "";
      if (user) {
        try {
          authorization = `Bearer ${await user.getIdToken()}`;
        } catch {
          // Fall back to the saved volunteer session or athlete OTP cookie.
        }
      }
      try {
        const response = await fetch("/api/auth/profiles", {
          headers: authorization ? { authorization } : undefined,
          cache: "no-store",
        });
        const body = await response.json() as { ok?: boolean; data?: LinkedProfiles };
        if (active && response.ok && body.ok && body.data) setProfiles(body.data);
        else if (response.status === 401 && volunteerToken) window.localStorage.removeItem(VOLUNTEER_TOKEN_KEY);
      } catch {
        // Keep existing browser sessions intact during a transient profile lookup failure.
      } finally {
        if (active) setProfilesReady(true);
      }
    }
    void syncLinkedProfiles();
    return () => { active = false; };
  }, [authReady, user]);

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { data?: { authenticated?: boolean } }) => {
        if (active) setIsAdmin(body.data?.authenticated === true);
      })
      .catch(() => undefined)
      .finally(() => { if (active) setAdminReady(true); });
    return () => { active = false; };
  }, []);

  async function changeProfile(target: "ATHLETE" | "VOLUNTEER", href: string) {
    setSwitching(target);
    setSwitchError("");
    try {
      if (target === "ATHLETE" && (user || profiles.activeProfile === "ATHLETE")) {
        window.location.assign(href);
        return;
      }
      const volunteerToken = window.localStorage.getItem(VOLUNTEER_TOKEN_KEY);
      let authorization = volunteerToken ? `Volunteer ${volunteerToken}` : "";
      if (user) authorization = `Bearer ${await user.getIdToken()}`;
      const response = await fetch("/api/auth/profiles", {
        method: "POST",
        headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
        body: JSON.stringify({ target }),
        cache: "no-store",
      });
      const body = await response.json() as { ok?: boolean; data?: { sessionToken?: string }; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || "Unable to change profile.");
      if (target === "VOLUNTEER" && body.data?.sessionToken) {
        window.localStorage.setItem(VOLUNTEER_TOKEN_KEY, body.data.sessionToken);
      }
      window.location.assign(href);
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : "Unable to change profile.");
      setSwitching(null);
    }
  }

  async function logout() {
    setLoggingOut(true);
    setSwitchError("");
    try {
      window.localStorage.removeItem(VOLUNTEER_TOKEN_KEY);
      await Promise.allSettled([
        fetch("/api/auth/otp/session", { method: "DELETE", cache: "no-store" }),
        fetch("/api/admin/session", { method: "DELETE", cache: "no-store" }),
        import("@/lib/firebase-client").then(async ({ firebaseAuth }) => {
          const { signOut } = await import("firebase/auth");
          await signOut(firebaseAuth);
        }),
      ]);
      window.location.assign("/login");
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : "Unable to log out.");
      setLoggingOut(false);
    }
  }

  if (authReady && profilesReady && adminReady && !user && !isAdmin && !profiles.authenticated) {
    return (
      <details className="account-switcher">
        <summary className="profile-login-link" aria-label="Open login menu"><UserRound size={19} /></summary>
        <div className="account-switcher-menu">
          <div className="account-switcher-identity"><b>Account</b><small>Sign in to continue</small></div>
          <Link href="/login"><LogIn size={15} /><span><b>Login</b><small>Open your Race Upshot account</small></span></Link>
        </div>
      </details>
    );
  }

  const name = user?.displayName || (isAdmin ? "Race Upshot Admin" : profiles.activeProfile === "VOLUNTEER" ? profiles.volunteer?.name : profiles.athlete?.name) || "Race Upshot account";
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "A";
  const photoUrl = profilePhoto || user?.photoURL;

  return (
    <details className="account-switcher">
      <summary aria-label="Open account menu">
        <span className="profile-menu-avatar">
          {photoUrl ? <Image src={photoUrl} alt="" width={34} height={34} unoptimized /> : initials}
        </span>
        <ChevronDown size={13} />
      </summary>
      <div className="account-switcher-menu">
        <div className="account-switcher-identity">
          <b>{name}</b>
          <small>{user?.email || (isAdmin ? "Administrator" : profiles.volunteer?.email || profiles.athlete?.email || "Account")}</small>
        </div>
        {profiles.athlete && <Link href="/athlete" onClick={(event) => { event.preventDefault(); void changeProfile("ATHLETE", "/athlete"); }}><UserRound size={15} /><span><b>Athlete</b><small>{switching === "ATHLETE" ? "Opening…" : "Account and results"}</small></span></Link>}
        {profiles.volunteer && <Link href="/volunteer" onClick={(event) => { event.preventDefault(); void changeProfile("VOLUNTEER", "/volunteer"); }}><ClipboardCheck size={15} /><span><b>Volunteer</b><small>{switching === "VOLUNTEER" ? "Opening…" : "Authorized race operations"}</small></span></Link>}
        {isAdmin && <Link href="/admin"><LayoutDashboard size={15} /><span><b>Admin</b><small>Control centre</small></span></Link>}
        <button className="account-switcher-logout" type="button" disabled={loggingOut} onClick={() => void logout()}><LogOut size={15} /><span><b>{loggingOut ? "Logging out…" : "Log out"}</b><small>Sign out of this device</small></span></button>
        {switchError && <p className="account-switcher-error" role="alert">{switchError}</p>}
      </div>
    </details>
  );
}
