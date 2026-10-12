# Shared results notifications

WhatsApp uses the AiSensy campaign `results` by default with exactly:
1. Athlete name
2. Category
3. Event name
4. Category (repeated in the approved template)
5. BIB
6. Finish time
7. Available leg durations, joined with ` • `

The approved provider template contains the provisional notice. No result
rank or URL is substituted into these seven positions. Email stays on Bergtecno.
No provider credentials are stored in templates.

## Activation

In an event's Live Tracking Hub > Notifications enable Notifications,
Finisher notifications and WhatsApp, and save. Existing disabled switches
are preserved. An optional AiSensy API campaign override defaults to `results`.
No deployment or production configuration change is performed by these edits.

Successful result-upload API completion and canonical publication with finishers
schedule background processing. Separate `result-notifications:<eventId>`
instances of the existing CanonicalChangeHub class provide alarm-driven batches;
the browser is not needed. No new binding or migration is required. Notification
scheduling failures are logged, not allowed to fail timing publication or import.
This is not a lossless notification outbox: failure to schedule requires a later
publication or operator batch. Canonical KV visibility and contact readiness can
also delay eligibility until a later trigger. Provider delivery is not guaranteed.

Uploaded result rows and canonical finishers are merged by the shared
contest+BIB delivery identity, so a partial result upload cannot hide live
finishers. Canonical FINISHED status, positive elapsed time, and configured final
split evidence are required. Contacts use the same validated unique-BIB
registration enrichment used by the Feibot roster; uploaded registration rows
remain separate from and hidden in the canonical timing roster. Event-wide split
configuration must correctly describe the athlete's race; missing/ambiguous
configuration is skipped.
Leg times use imported `legTimes` or complete configured canonical section
durations. Missing splits are stated as unavailable, never invented.

## Duplicate and failure behavior

Event/category/BIB/channel form the new send claim, shared by upload and
canonical sources. Category spelling and BIB formatting must match across
sources; aliases are not guessed. Duplicate race identities are skipped.
Existing result-ID/channel KV logs are preserved and checked before sending.
Historical cross-source sends that used different IDs are not automatically
backfilled into claims; review existing delivery history before activation.

Claims are persisted before provider calls. A crash/timeout can leave SENDING
or failed/unconfirmed; no automatic retry of such a provider attempt occurs.
This prioritizes avoiding duplicate congratulations over guaranteed delivery.
Manual retry of a failed attempt can duplicate a message accepted by a provider
before a timeout, so check the provider dashboard first. Acceptance is not delivery.
This change does not modify finish detection, timing, rankings, or manual statuses.
