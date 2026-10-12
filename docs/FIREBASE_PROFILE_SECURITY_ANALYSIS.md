# Firebase athlete profile security analysis

## Application access

- Web and Expo clients authenticate with Firebase Authentication.
- Athlete profiles are written to `users/{firebaseUid}` with `getDoc` and `setDoc(..., { merge: true })`.
- There are no collection queries, `where`, `orderBy`, or `limit` operations for athlete profiles.
- Cropped profile images are compressed to a small JPEG data URL and stored inside the owner-only profile document.
- The profile contains PII: email, phone number, country, state, and city.
- Administrative access uses a separate Cloudflare cookie and does not grant Firestore access.

## Required authorization

- A signed-in user may read and write only the document whose ID equals their Firebase UID.
- No user can write a role, permission, or admin field.
- No profile collection listing or cross-user read is allowed.
- All unrelated Firestore and Storage paths are denied.

## Validation and attack review

- Public reads and collection listing: denied.
- Cross-user reads/writes: denied by UID path ownership.
- UID hijacking: denied on create and update.
- Schema pollution and oversized strings: denied by an allowed-field list and field size limits.
- Missing/invalid fields and type juggling: denied on both create and update.
- `createdAt` modification: denied; `updatedAt` must be the current server request time.
- A one-time owner-only migration path allows incomplete legacy documents to receive immutable `uid` and `createdAt` fields; after that update, the normal immutable-field checks apply.
- Privilege escalation: no role or permission field is accepted.
- Oversized/non-image profiles: denied; the client converts output to JPEG and Firestore validates its type and maximum encoded size.

The live target was verified as the Standard `(default)` Firestore database in `nam5`. Firebase Storage is not provisioned, so the implementation intentionally keeps the compressed avatar in the private profile instead of requiring a paid Storage bucket.
