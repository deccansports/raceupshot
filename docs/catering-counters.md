# Catering / Food & Item Counters

Reference: BERGMAN `main` at `eef56a213f34202a230a5a0a70b6e74b95d376d6`.
Inspected `CateringFoodTab`, `CateringItemCounterService`, `cateringItemCounters`,
`volunteerFood`, and the mobile catering workflow. No BERGMAN credentials,
configuration, records or branding were copied. Its working files were not edited.

## Setup and operation

1. Admin → Volunteers → Catering / Food & Items; choose the event.
2. Create one service per meal/date/window or item allocation. Specify athlete
   categories, eligible audiences, stock units, serving count and allowance.
   Times are entered in the administrator browser timezone and stored as UTC.
3. Grant operators the existing `FOOD_COUNTER` permission for that event.
4. Volunteers choose Athlete or Volunteer, search/scan an athlete BIB/band or an
   assigned event volunteer band, select a recipient and confirm a serving.
5. The Logs view shows the last 100 servings; stock totals cover all servings.

Each relay athlete has their own recipient identity. A volunteer must be active
and assigned to the event; an arbitrary band number does not confer eligibility.
Paid-food redemption and existing custom-counter assignments remain separate.

## Persistence and safety

The existing event-scoped VolunteerOperationCoordinator stores new `catering:`
keys. Transactions enforce time windows, audience/category eligibility, individual
allowances and shared stock. Retrying a request ID returns the original receipt.
The backend re-resolves recipient identity and category before every issue.
No catering action changes waiver, race, bike or athlete check-in state.
Issue history is append-only. Stock basis and time windows cannot be rewritten
after issuance; services can still be disabled.

Legacy FOOD_ISSUE and custom-counter logs are NOT migrated or counted against
new services. Do not initialize a new allocation mid-service without reconciling
previous consumption. Older mobile builds still use their legacy food action.

## Adaptation boundaries

This implements the athlete/volunteer serving workflow and configured item stock
inside Race Upshot. It does not introduce BERGMAN's separate admin-plate audience,
volunteer-group band-range allocations, or retroactive serving resets. Those need
explicit mappings to Race Upshot identities and authorization rules. Item services
here are operated by the event's FOOD_COUNTER staff; existing selectively assigned
custom counters remain available in their original module.

## Release and verification

Deploy the backend/admin web app BEFORE publishing the volunteer JavaScript OTA.
No new native dependency or Durable Object namespace/migration was added.
Verify a configured test service, athlete QR, assigned volunteer-band QR, duplicate
scan, simultaneous final-stock requests and offline retry on actual devices before
race-day use. Node tests include a serialized storage double; they do not replace
Cloudflare runtime or device validation. Neither deployment nor OTA is performed
as part of this implementation request.

Validation: 51 targeted catering, tag-assignment, participant-assignment and
waiver-flow tests passed. Application and volunteer-mobile typechecks passed.
The separate strict Worker typecheck now passes after capturing the already
validated waiver evidence in constants before the transaction callback.
