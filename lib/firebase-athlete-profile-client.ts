"use client";

import type { AthleteProfileInput } from "@/lib/athlete-profile";
import { normalizeCountryCode } from "@/lib/countries";
import { firebaseDb } from "@/lib/firebase-client";
import type { User } from "firebase/auth";
import { Timestamp, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

export async function saveAthleteProfileToFirestore(user: User, profile: AthleteProfileInput) {
  const reference = doc(firebaseDb, "users", user.uid);
  const existing = await getDoc(reference);
  const existingCreatedAt = existing.data()?.createdAt;
  await setDoc(reference, {
    uid: user.uid,
    email: user.email || "",
    name: profile.name.trim(),
    phoneCountryCode: profile.phoneCountryCode.trim(),
    mobileNumber: profile.mobileNumber.trim(),
    country: normalizeCountryCode(profile.country) || profile.country.trim(),
    state: profile.state.trim(),
    city: profile.city.trim(),
    photoUrl: profile.photoUrl?.trim() || "",
    trackingVisibility: profile.trackingVisibility || "PUBLIC",
    signInProvider: user.providerData[0]?.providerId || "password",
    createdAt: existingCreatedAt instanceof Timestamp ? existingCreatedAt : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
