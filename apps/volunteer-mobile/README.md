# Race Upshot Volunteer

Expo field-operations app for assigned Race Upshot volunteers.

## Supported operations

- Secure email OTP sign-in
- Multi-event assignment selection
- Role/module and timing-point enforcement
- Athlete search by BIB, name, email, participant ID, QR or barcode
- Waiver verification and athlete check-in
- Bike check-in/check-out with helmet and rack details
- Medal, food and locker counters
- Manual timing capture at assigned timing points

All operational writes are event-scoped. Participant operation state is serialized by a Cloudflare Durable Object so two volunteers cannot issue the same medal, meal or locker at the same time; append-only activity and timing logs remain in Workers KV. The app never writes directly to storage or provider timing data.

## Local setup

1. Copy `.env.example` to `.env.local` if a non-production API is required.
2. Run `npm install`.
3. Run `npm run start:clear`.

From the Race Upshot repository root, use `npm run volunteer:start:clear` for Expo Go or `npm run volunteer:web:clear` for the web build. Do not run `npx expo start` from the repository root because that starts the Next.js workspace instead of this app.
