# CHT-IAM API Contract

The HTTP API of the CHT-IAM tool. It covers auth, the staged list, creating and replacing users,
and moving, merging and deleting places.

[`APP.md`](APP.md) is the design: *what* each operation does, in which order, and why. This
document defines the *HTTP surface*: endpoints, request and response shapes, status codes and
error codes. It links to `APP.md` for behaviour instead of repeating it. Where the two disagree,
`APP.md` wins, and this document is the one to fix.

The API has two kinds of client:
- **the frontend** (see [`frontend-contract.md`](frontend-contract.md)), which works through the
  staged list;
- **machine clients** (scripts, other systems), which can call the operations directly. Every
  operation is complete and idempotent, so a machine client never needs the staged list.

---

## 1. Conventions

- **Base path** `/api/v1`. Bodies are JSON, except CSV uploads (`multipart/form-data`) and
  downloads (`text/csv`, `application/zip`).
- **Auth**: send either the session cookie (browsers) or `Authorization: Bearer <token>`
  (machine clients). See [§2](#2-auth).
- **Ids for new things are chosen by the client**: `placeId`, `contact.id`, `jobId`. UUIDs are
  recommended, and required for `jobId`, which names the job's folder and archive on the server:
  anything else is `400 INVALID_REQUEST`. This is what makes writes idempotent: repeating a request with the same ids returns
  the same result, and finishes whatever an earlier attempt left undone. The first successful call
  returns `201` (or `202` for jobs); repeats return `200` with `"outcome": "already_applied"` (or
  the existing job).
- **Place and person properties** go in nested objects keyed by the deployment config's
  `property_name`: `{ "place": { "code": "123456" }, "contact": { "properties": { "name": "…" } } }`.
- **Field errors** are keyed by path, e.g. `place.code`, `contact.phone`, `user.roles`,
  `hierarchy.SUBCOUNTY`.
- **Errors** always use one envelope, with a non-2xx status:
  ```json
  { "error": { "code": "VALIDATION_FAILED", "message": "human-readable summary", "details": {} } }
  ```
  `code` is stable, for clients to branch on. `message` is for people. `details` depends on the code.
- **Optimistic concurrency** for staged items: every item has a `revision`. Changes must send the
  `revision` they started from, or get `409 REVISION_MISMATCH`.
- **Lists** are paginated with `?limit=` (default 50, max 500) and `?cursor=`. The response
  includes `nextCursor` when there's more.
- **Live updates** stream over server-sent events (see [§10](#10-events)). Every resource can also be
  polled.

---

## 2. Auth

Behaviour: [APP.md → Auth](APP.md#auth).

### `GET /_healthz` (no auth)
`200 { "status": "ok" }` while the server is up, for container and Kubernetes probes. Outside
`/api/v1`, and never cached. A server whose settings or deployment folder are broken refuses to
start, so it never answers this.

### `GET /config/instances` (no auth)
The instances a user can sign in to, sorted by host. Hosts aren't exposed.
```json
{ "instances": [ { "id": "ke-prod", "name": "Kenya eCHIS" } ] }
```

### `POST /auth/login` (no auth)
```json
{ "instance": "ke-prod", "username": "alice", "password": "…", "deliver": "cookie" }
```
- `deliver: "cookie"` (default): sets the `HttpOnly`, `Secure`, `SameSite=Lax` session cookie, and
  returns the [session](#get-authsession).
- `deliver: "token"`: returns `{ "token": "…", "expiresAt": "…", "session": { … } }` for machine
  clients, and sets no cookie.

### `POST /auth/sso` (no auth)
```json
{ "instance": "ke-prod", "accessToken": "<IdP access token>", "deliver": "token" }
```
Same response as `/auth/login`. `403 SSO_DISABLED` when the instance has no `idpOrigins`.

### `POST /auth/logout`
Revokes the presented token (cookie or bearer) and clears the cookie. `204`.

### `GET /auth/session`
```json
{
  "instance": { "id": "ke-prod", "name": "Kenya eCHIS", "url": "https://echis.example.org" },   // url: the CHT app, for links to contacts
  "username": "alice",
  "isAdmin": false,
  "facilityIds": ["5f1c…"],
  "chtVersion": "4.18.0",
  "expiresAt": "2026-10-01T12:00:00Z"
}
```
The CouchDB `AuthSession` is never returned.

### Auth errors

| Status | Code | When |
|---|---|---|
| 400 | `MISSING_CREDENTIALS` | Empty username, password or access token |
| 404 | `UNKNOWN_INSTANCE` | `instance` isn't in the configured list |
| 401 | `INVALID_CREDENTIALS` | CHT rejected the username/password |
| 502 | `NO_SESSION_COOKIE` | CHT answered without an `AuthSession` |
| 502 | `SSO_FAILED` | The OIDC redirect chain failed (`details.step`) |
| 504 | `INSTANCE_UNREACHABLE` | Host not found, connection refused or timed out |
| 403 | `ADMIN_LOGIN_DISABLED` | Admin, and `ALLOW_ADMIN_LOGIN=false` |
| 403 | `MISSING_PERMISSIONS` | A required permission is missing (which ones is logged server-side only) |
| 403 | `NO_FACILITY` | Non-admin with no `facility_id` |
| 422 | `UNSUPPORTED_CHT_VERSION` | Version too old or unparseable (`details.minimum`, `details.actual`) |
| 401 | `UNAUTHENTICATED` | Any other endpoint, with no, bad, expired or revoked token |
| 401 | `SESSION_EXPIRED` | CHT rejected the stored CouchDB session. The cookie is cleared; sign in again |

---

## 3. Configuration

### `GET /config/contact-types`
Every contact type of the deployment, exactly as the
[shared validation module](#4-shared-validation) consumes them. See
[APP.md → contact types](APP.md#what-drives-it-contact-types) for the fields.
```json
{
  "configVersion": "sha256:…",
  "contactTypes": [ {
    "name": "c_community_health_unit", "friendly": "Community Health Unit",
    "contact_type": "person", "user_role": ["community_health_assistant"],
    "username_from_place": false, "can_assign_multiple": true, "deactivate_users_on_replace": false,
    "hierarchy": [ { "property_name": "SUBCOUNTY", "friendly_name": "Sub County", "contact_type": "b_sub_county", "level": 1, "type": "name", "required": true } ],
    "replacement_property": { "property_name": "replacement", "friendly_name": "Affected CHU", "type": "name", "required": true },
    "place_properties": [ … ], "contact_properties": [ … ]
  } ]
}
```
Every setting of each type is included except `hooks`, which only the server uses. A type with `actions` (for example `"actions": ["move"]`) allows only those; without it, every
action. Any other action on the type, whether a staged item, a CSV, its template or a direct
request, returns `422 ACTION_NOT_ALLOWED` (`details.action`).

`configVersion` changes whenever the config or the validation module changes. The frontend sends
it as `X-Config-Version` on writes. On a mismatch the server returns `409 CONFIG_CHANGED`, and the
frontend reloads the config, so the two sides never validate with different rules.

### `GET /config/logo`
Public. The deployment's logo, as the image itself (`image/png`, `image/jpeg`, …): the logo file
in the deployment's folder. Browsers cache it and revalidate it by its `ETag` on each use (`304`).
`404 NO_LOGO` when the deployment has none.

### `GET /config/contact-types/{name}/csv-template?kind=create|replace|move|merge|delete`
`text/csv`: one header row, with the columns defined for that kind in `APP.md`. For `replace`, the
`Username` and `Scope` columns are only included for types with `can_assign_multiple`.

---

## 4. Shared validation

Not an endpoint, but part of the contract. Formatting and validation are implemented **once**, as
a module that both the server and the frontend run, driven by the contact-type config above (see
[APP.md → Creating one user](APP.md#creating-one-user-ui)). It exports at least:

| Function | Does |
|---|---|
| `formatValue(property, raw)` | The stored form of a value (e.g. `0712…` → `+254712…`) |
| `validateValue(property, raw, required)` | An error message, or none |
| `renderGenerated(property, { place, contact, lineage })` | The value of a `generated` property |
| `validateRequest(kind, request, contactType)` | Every field error of a create/replace request, keyed by path, without CHT lookups |
| `usernameFor(contactType, request)` | The username the request will aim for (before any collision suffix) |

The server runs the same functions on every write. A field error from the server on something the
frontend already validated means the two copies disagree, which is a bug.

---

## 5. Lookups

All read-only, and all scoped to the caller's facilities.

### `GET /places/search?type={contactType}&q={text}&parentId={id}&limit=20`
Places of `type` whose name matches `q` (case- and accent-insensitive, ranked best first), under
`parentId` if given. Used by every hierarchy field and place picker. With `parentId`, only that
parent's places are read. Without it, a type with more than `MAX_PLACES_LOADED` places returns
`422 PARENT_REQUIRED`: search again with the place above ([APP.md → Finding places](APP.md#finding-places)).
```json
{ "places": [ {
  "id": "0b6c…", "name": "Kanyakwar Community Health Unit", "type": "c_community_health_unit",
  "lineage": [ { "id": "5f1c…", "name": "Kisumu West" }, { "id": "county…", "name": "Kisumu" } ],
  "primaryContact": { "id": "9ab2…", "name": "Jane Doe" }
} ] }
```

### `GET /places/{placeId}`
Everything the replace, move, merge and delete forms show about a place.
```json
{
  "id": "0b6c…", "name": "…", "type": "…", "properties": { "code": "123456" },
  "lineage": [ … ],
  "primaryContact": { "id": "9ab2…", "name": "Jane Doe", "phone": "+254…", "properties": { … } },
  "accounts": [ { "username": "jane_doe", "roles": [ … ], "active": true,
                  "places": [ { "id": "0b6c…", "name": "…" } ], "lastSync": "2026-09-20T08:00:00Z" } ],
  "descendantCount": 42
}
```
`lastSync` is `null` when unknown: always for non-admin callers. `404 PLACE_NOT_FOUND`.

### `GET /people/search?type={contactType}&q={text}&limit=20`
People who could take over a place of `type` in a replace. `422 PARENT_REQUIRED` for a type with
more than `MAX_PLACES_LOADED` places, whose people can't be searched across the type.
```json
{ "people": [ {
  "id": "77d0…", "name": "Paul Oduor", "phone": "+254…",
  "account": { "username": "paul_oduor", "active": true, "roles": [ … ], "places": [ { "id": "…", "name": "…" } ] },
  "eligible": false, "reason": "NO_ACTIVE_ACCOUNT"
} ] }
```
`reason` is one of `NO_ACCOUNT`, `SEVERAL_ACCOUNTS`, `NO_ACTIVE_ACCOUNT`, `MISSING_ROLE`, or absent
when `eligible` is true. People are searched among the primary contacts of the type's places, within
the caller's facilities, since that's who holds an account with the type's roles.

### `POST /checks/duplicates`
The read-only duplicate check that runs before a create is added
([APP.md → Steps, step 3](APP.md#steps)).
```json
// request
{ "contactType": "…", "parentId": "5f1c…", "placeId": "0b6c…", "place": { "name": "Kanyakwar", "code": "123456" } }
// response
{ "warnings": [ { "property": "place.code", "message": "A place with the same \"CHU Code\" already exists", "placeIds": ["old-chu"] } ] }
```

**Warnings** everywhere (`details.warnings` on `409 WARNINGS`, `confirmation.warnings` on staged
items, `warnings` in responses) are `{ "message", "placeIds"? }`. `placeIds` lists the existing
places a warning is about. Clients link each one to `{instance.url}/#/contacts/{id}` in a new tab.
Warnings between items of one batch or file have no `placeIds`. The copy kept on the doc in CHT
(`user_attribution.warnings`) is plain text: the message, then the ids.

### `POST /checks/same-person`
The read-only check the create form runs once a new person's fields are valid. Is this someone
already in the caller's staged list ([APP.md → Creating one user](APP.md#creating-one-user-ui))?
Only for types with `can_assign_multiple`. People are matched as CSV rows are.
```json
// request
{ "contactType": "…", "contact": { "id": "9ab2…", "properties": { "name": "Jane Doe", "phone": "0712345678" } }, "user": { "roles": [ … ] } }
// response: match is null when there's none
{ "match": { "itemId": "…", "contactId": "…", "name": "Jane Doe", "placeTitle": "Kanyakwar", "properties": { … }, "roles": [ … ] } }
```

### `POST /preview`
What an operation *would* do, without doing it. The body is `{ "kind", "request" }`, with
`request` exactly as the operation takes it. The response lists the effects APP.md says to show:
```jsonc
// kind "replace"
{ "outgoing": { "contactId": "9ab2…", "name": "Mary Atieno" },
  "placesHandedOver": [ { "id": "a41e…", "name": "…" } ],
  "placesKept": [ { "id": "…", "name": "Kogony" } ],
  "retiredAccounts": [ { "username": "mary_atieno", "action": "disable" } ],
  "outgoingPerson": "keep",                   // always kept, under the place; null when there was none
  "keptAccounts": [ { "username": "…" } ],     // outgoing accounts that only lose the places
  "incoming": { "kind": "existing", "name": "Paul Oduor", "username": "paul_oduor" },
  "generated": { "place.name": { "from": "Mary Atieno Area", "to": "Grace Owino Area" } } }

// kind "move" | "merge" | "delete"
{ "counts": { "places": 12, "people": 30, "reports": 1840 },   // reports: merge and delete only
  "large": false,
  "accounts": [ { "username": "…", "action": "keep" | "strip" | "disable" | "deactivate", "lastSync": null } ],
  "lastSyncKnown": false,
  "location": { "from": "Kisumu › Kisumu West › Kanyakwar CHU", "to": "Kisumu › Seme › Kanyakwar CHU" },
  "lostProperties": { "code": "123456" },                         // merge: the source's own values
  "primaryContactMerge": { "from": "Jane Doe", "into": "Paul Oduor" },   // merge
  "confirmName": "Kanyakwar Community Health Unit" }              // merge and delete: what must be typed
```
Returns the same validation errors as the operation itself would, so a preview that succeeds means
the operation is expected to succeed.

---

## 6. Staged list

Behaviour: [APP.md → Staged list](APP.md#staged-list). Items belong to the caller, on the
signed-in instance.

### The item
```jsonc
{
  "id": "item-…",
  "kind": "create",                       // create | replace | move | merge | delete
  "request": { … },                       // exactly the operation's request (§7, §8)
  "source": { "type": "csv", "file": "units.csv", "row": 12 },   // or { "type": "form" }
  "raw": { "Sub County": "kisumu west", "CHU Name": "Kanyakwar", … },   // CSV rows only
  "status": "needs_confirmation",         // pending | validating | invalid | needs_confirmation | ready | uploading | created | failed
  "errors": { "hierarchy.SUBCOUNTY": "Found 2 matches for 'Kisumu'" },
  "confirmation": { "reason": "duplicates", "warnings": [ … ] },
                   // or { "reason": "large_move", "counts": { … } }
                   // or { "reason": "typed_name", "expected": "Kanyakwar Community Health Unit" }
  "dependsOn": "item-…",                  // another place for a person this item creates: that item
  "result": { … },                        // the operation's response, once uploaded
  "upload": { "runId": "…", "startedAt": "…" },   // the upload that last sent it
  "job": { "id": "…", "status": "queued" },   // move, merge, delete
  "revision": 3,
  "createdAt": "…", "updatedAt": "…"
}
```

### `GET /staged-items?status=&kind=&q=&limit=&cursor=`
Items not uploaded come first, then each upload's items, the latest upload first. Each uploaded
item carries `upload: { runId, startedAt }`. Within each group, the newest come first; the rows of one
CSV upload were added together, so they stay together in file order. A done item is removed
`DATA_RETENTION_TTL` after it succeeded: after its upload started (so as its passwords expire from
`GET /credentials`), or for a move, merge or delete, after its job finished. After that, it's gone
from the list, the counts, and `GET /staged-items/{id}` (`404 ITEM_NOT_FOUND`). Items that haven't
succeeded never expire.
```json
{ "items": [ … ], "nextCursor": "…",
  "counts": { "pending": 0, "invalid": 3, "needs_confirmation": 1, "ready": 40, "created": 12, "failed": 0 },
  "validation": { "state": "running", "done": 120, "total": 400 },
  "upload": { "state": "idle" } }
```

### `POST /staged-items`
Adds an item from a form. `{ "kind", "request", "confirmName"?, "newPerson"? }`. The server validates it fully:
the shared rules plus the CHT checks (parent exists, place and people eligible, duplicates). The
form already did all of this, so it is expected to succeed:
- `201`: the item, `ready`.
- `422 VALIDATION_FAILED`, `details` = field errors: the item isn't added. A form that validates
  correctly never sees this.
- `409 WARNINGS`, `details.warnings`: new duplicates since the form's check. Re-send with
  `ignoreWarnings: true` once the user confirms.
- `422 CONFIRMATION_REQUIRED`: a `merge` or `delete` without a `confirmName` matching the place's
  name.

**Replace items** (`kind: "replace"`, the request as for
[`PUT /places/{placeId}/primary-contact`](#put-placesplaceidprimary-contact--replace) plus `placeId`)
are checked with the replace's own checks. Each gets `claims`: every place it hands over.
- `409 HANDOVER_ALREADY_STAGED` (`details.itemId`): another waiting replace item hands over one of
  the same places. Only one handover of a place can wait, since the second would undo the first.
- `409 NOTHING_TO_CHANGE`: the existing person already holds the place, as its primary contact and
  in their account.

Editing a replace item may change its place and its incoming person (new or existing) until it has
been sent; after that, `422 IDS_FIXED`.

**Move items** (`kind: "move"`, request `{ jobId, contactType, placeId, newParentId, acceptLarge }`)
are checked as the job will be, and added `ready`. A large move (over 100 places and people) needs
`acceptLarge: true`, otherwise `422 CONFIRMATION_REQUIRED` (`details.large`). A CSV row (the
hierarchy columns, the type's `friendly` name, then `New ` + each hierarchy column) waits in
`needs_confirmation` (`large_move`) instead, and may be confirmed with others. `409
MOVE_ALREADY_STAGED`: another waiting move or delete is for the same place, or for the new parent or
a place above it, or moves something under this place. Uploading schedules the job, as for deletes.

**Merge items** (`kind: "merge"`, request `{ jobId, contactType, sourceId, destinationId, confirmName }`)
are checked as the job will be, including the source's name typed, and added `ready`. A CSV row
(the hierarchy columns and the type's `friendly` name for the source, then `Into ` + the same for
the destination) waits in `needs_confirmation` (`typed_name`). `409 MERGE_ALREADY_STAGED`: the source
is already in another waiting move, merge or delete, or the destination (or a place above it) is
moved, merged away or deleted by one, or one moves something under the source. A waiting merge also
keeps a delete off its destination (`DELETE_ALREADY_STAGED`).

**Delete items** (`kind: "delete"`, request `{ jobId, contactType, placeId, confirmName }`, with
`jobId` chosen by the client) are checked as the job will be, including the typed name, and added
`ready`. Uploading one schedules its job with that `jobId`; the item then carries `job`, the job as
it stands (as in [The job](#the-job)). Delete items can't be edited: remove one and add another.
`409 DELETE_ALREADY_STAGED`: another waiting delete covers this place, or a place under or above it.
CSV rows (`kind: "delete"`: the hierarchy columns and the type's `friendly` name) wait in
`needs_confirmation` (`typed_name`) until each is confirmed on its own.

**Another place for the same person** ([APP.md → One person, many places](APP.md#one-person-many-places)):
send a `create` with the same `contact.id` and no `contact.properties`. If another staged item
creates that person (it has the same `contact.id` and sends the properties), the new item is checked
with that person's details and gets `dependsOn` set to that item. Otherwise the person must already
be in CHT.
- `409 CONTACT_ALREADY_STAGED`: `contact.properties` sent for a person another item already creates.
- `409 CONTACT_ALREADY_ASSIGNED`: the type doesn't have `can_assign_multiple`, or the other item is
  of another type.
- `422 VALIDATION_FAILED` with `contact.properties`: the person is neither staged nor in CHT.
- `409 SAME_PERSON_STAGED`, `details` as `match` in [`/checks/same-person`](#post-checkssame-person):
  a new person who looks like one already staged. Either send the place for that person (their
  `contactId`, no properties), or re-send with `"newPerson": true` if it's someone else.

### `POST /staged-items/csv`
`multipart/form-data`: `file`, `kind` (`create` or `replace`), `contactType`. Parses the file and stages every row
([APP.md → pre-validation](APP.md#adding-from-a-csv-pre-validation)):
- `202`: `{ "staged": 400, "invalid": 3 }`. Local checks are done; CHT checks continue in the
  background (see `validation` on the list, and events).
  `sharedPeople`, when present, is how many people serve several rows. For types with
  `can_assign_multiple`, rows whose person looks the same share one `contact.id`. The first of them
  creates the person, and the rest get `dependsOn` and no `contact.properties`
  ([APP.md → Creating many users](APP.md#creating-many-users-csv)).
- `400 MISSING_COLUMNS`, `details.columns`: nothing staged.
- `400 CSV_UNREADABLE`: not a parseable CSV.

### `PATCH /staged-items/{id}`
`{ "revision", "request" }`. Replaces the item's request, and validates it again (same rules as
`POST /staged-items`). The item's ids (`placeId`, `contact.id`, `jobId`) can't change, which is
`422 IDS_FIXED`. Items that are `uploading` or `created`, or whose job has started, are
`409 ITEM_LOCKED`. An item that creates a person other items depend on must keep
`contact.properties`; editing them updates the person shown on those items.

### `POST /staged-items/{id}/confirm`
`{ "revision", "confirmName"? }`. Accepts what the item is waiting for; the item becomes `ready`.
`confirmName` is required when `confirmation.reason` is `typed_name`.

### `POST /staged-items/confirm`
`{ "ids": [ … ] }`. Bulk confirm, for `duplicates` and `large_move` only. Items waiting for a
typed name are left as they are and returned in `skipped`.

### `DELETE /staged-items/{id}`
Removes an item. `409 ITEM_LOCKED` while it's `uploading`, or while its job is queued or running.
Removing an item that creates a person whose other places are still staged hands the person over:
the earliest of those places gets the person's `contact.properties` and no `dependsOn`, and the rest
get `dependsOn` set to it.

### `DELETE /staged-items?status=created`
Clears finished items.

### `POST /staged-items/upload`
`{ "ids"?: [ … ] }` (default: every `ready` item). Starts uploading in the background, following
[APP.md → Uploading](APP.md#uploading): parents before children, about 15 at a time, and one at
a time for items that update the same account. An item that creates a person goes before that
person's other places. A place whose person item isn't created and isn't in this upload stays
`ready`, with `failure.code` `WAITING_FOR_PERSON`. If the person item fails, the place stays `ready`
with `DEPENDENCY_FAILED`. Returns `202 { "uploading": 40 }`. Progress arrives
through item statuses and events. Failed items go back through this same endpoint (`ids: [ … ]`)
to retry.

---

## 7. User operations

Called by the staged-list upload, and directly by machine clients.

### `PUT /places/{placeId}` — create
Behaviour: [APP.md → Create Users](APP.md#1-create-users). Body as in
[The request](APP.md#the-request), without `placeId`, which comes from the path.

| Status | Body / code |
|---|---|
| 201 / 200 | `{ outcome: "created" \| "already_applied", placeId, contactId, username, password, warnings }`. `password` is `null` on a repeat after the credentials record expired |
| 409 `WARNINGS` | `details.warnings`; re-send with `ignoreWarnings: true` |
| 409 `IDEMPOTENCY_CONFLICT` | `placeId` or `contact.id` already used for something else |
| 409 `CONTACT_ALREADY_ASSIGNED` | The person serves another place, and the type can't share |
| 404 `PARENT_NOT_FOUND` / 422 `PARENT_WRONG_TYPE` | |
| 403 `FORBIDDEN_PLACE` | Parent outside the caller's facilities |
| 422 `VALIDATION_FAILED` | Field errors in `details` |
| 422 `HOOK_FAILED` | A hook of the type refused the place: its message, and `details.hook`, the file. Nothing written |
| 502 `UPSTREAM_FAILED` | CHT failed or was unreachable (`details.chtStatus`); re-send to resume |

### `PUT /places/{placeId}/primary-contact` — replace
Behaviour: [APP.md → Replace Existing Users](APP.md#2-replace-existing-users).
```json
{
  "contactType": "…",
  "contact": { "id": "c0ff…", "properties": { … } },   // no properties: an existing person takes over
  "scope": "all",                                      // or "place"
  "place": { },
  "user": { "roles": [ … ] }
}
```

| Status | Body / code |
|---|---|
| 201 / 200 | `{ outcome: "replaced" \| "already_applied", placeId, contactId, previousContactId, affectedPlaceIds, retiredUsers, username, places, password? }` |
| 409 `SUPERSEDED` | The place was replaced again since; nothing changed |
| 404 `PERSON_NOT_FOUND` | An existing incoming person that doesn't exist |
| 409 `ALREADY_PRIMARY` | The incoming person is already primary, not through this tool |
| 409 `CONCURRENT_MODIFICATION` | Someone else replaced the place at the same moment |
| 422 `HOOK_FAILED` | A hook of the type refused the place (its message, `details.hook`); the place isn't switched |
| 409 `IDEMPOTENCY_CONFLICT` | A new person's `contact.id` is used for something else |
| 422 `EXISTING_PERSON_NOT_ALLOWED` | Existing person offered for a type without `can_assign_multiple` |
| 422 `PERSON_NOT_ELIGIBLE` | Existing person without exactly one active account holding a type role (`details.reason` as in [people search](#get-peoplesearchtypecontacttypeqtextlimit20)) |
| 404 `PLACE_NOT_FOUND` / 422 `PLACE_WRONG_TYPE` | |
| 403 `FORBIDDEN_PLACE` | Place or incoming person outside the caller's facilities |
| 422 `VALIDATION_FAILED`, 502 `UPSTREAM_FAILED` | As for create |

---

## 8. Hierarchy jobs

Behaviour: [APP.md → Hierarchy management](APP.md#3-hierarchy-management).

### `PUT /hierarchy-jobs/{jobId}` — schedule a move, merge or delete
```jsonc
{ "kind": "move",   "contactType": "…", "placeId": "0b6c…", "newParentId": "5f1c…" }
{ "kind": "merge",  "contactType": "…", "sourceId": "0b6c…", "destinationId": "a41e…", "confirmName": "Kanyakwar Community Health Unit" }
{ "kind": "delete", "contactType": "…", "placeId": "0b6c…", "confirmName": "Kanyakwar Community Health Unit" }
```
Merges and deletes must name the place being merged away or deleted, as the UI's typed
confirmation does. That's a guard for machine clients too.

- `202`: the new [job](#the-job). `200`: the existing job, for a repeat with the same `jobId`.
- `409 OVERLAPPING_JOB`, `details.jobId`: another job is working on this branch.
- `422 PARENT_NOT_ALLOWED`, `CIRCULAR_HIERARCHY`, `PRIMARY_CONTACT_WOULD_LEAVE`, `SAME_PLACE`,
  `CONFIRMATION_REQUIRED` (`details.expected`), `PRIMARY_CONTACT_WOULD_BE_LOST` (a delete that would
  leave a place above pointing at a deleted person): the scheduling checks.
- `move`, `merge` and `delete` can be scheduled. A finished merge has `archive`, like a delete: a
  copy of every doc it changed or deleted, as it was before.
- `404 PLACE_NOT_FOUND`, `403 FORBIDDEN_PLACE`, `422 PLACE_WRONG_TYPE`.

### The job
```jsonc
{
  "id": "3e9a…", "kind": "move", "request": { … },
  "status": "postponed",        // queued | postponed | needs_sign_in | running | done | failed
  "position": 2,                // queued
  "postponed": { "reason": "sentinel_backlog", "backlog": 9120, "nextCheckAt": "…" },
  "progress": { "written": 1200, "total": 5400 },                     // running
  "result": { "contacts": 42, "reports": 1840, "durationMs": 360000 }, // done
  "error": { "message": "…", "logTail": [ "…" ] },                    // failed
  "archive": { "available": true, "expiresAt": "…" },                 // delete
  "createdBy": "alice", "createdAt": "…", "updatedAt": "…"
}
```

### `GET /hierarchy-jobs?status=&kind=&limit=&cursor=`
The caller's jobs, newest first.

### `GET /hierarchy-jobs/{jobId}`
One job. `404 JOB_NOT_FOUND`.

### `POST /hierarchy-jobs/{jobId}/resume`
For `needs_sign_in` and `failed` jobs. Attaches the caller's current CHT session, and puts the job
back in the queue. Re-running is safe ([APP.md → Running the job](APP.md#running-the-job)).
`409 NOT_RESUMABLE` for other states.

### `GET /hierarchy-jobs/{jobId}/undo` and `POST /hierarchy-jobs/{jobId}/undo`
Undoing a finished delete, from its archive ([APP.md → Undoing a delete](APP.md#undoing-a-delete)).
- `GET`: what the undo would restore.
  `{ placeName, counts: { contacts, reports }, parent: { id, name }, accounts: [ { username, places, disabled } ], archiveExpiresAt }`.
- `POST { "recreateLogins": false }`: schedules a `restore` job, with id `{jobId}-undo`. It returns
  `202`, or `200` for one already scheduled. The delete gets `undoneBy`. When it's done, the restore's
  `result` has `contacts`, `reports`, `accountsRestored` and `loginsRecreated: [ { username, previousUsername } ]`.
  Their passwords are in the credentials record: `GET /credentials/export?job={restoreJobId}`.
- `409 NOT_UNDOABLE`, `ARCHIVE_NOT_FOUND`, `PARENT_GONE`, `UNDO_CONFLICT` (`details.ids`), `OVERLAPPING_JOB`.

### `GET /hierarchy-jobs/{jobId}/log`
`text/plain`: the job's full output.

### `GET /hierarchy-jobs/{jobId}/archive`
`application/gzip`: every doc a delete job removed, as it was, one JSON doc per line
(`deleted-{jobId}.ndjson.gz`), while the archive is kept. `404 ARCHIVE_NOT_FOUND` for other jobs, or
once the archive has expired.

---

## 9. Credentials

Behaviour: step 8 of [APP.md → Create Users → Steps](APP.md#steps).

### `GET /credentials?placeIds=`
The caller's credentials record on this instance, newest first. Each entry is kept for
`DATA_RETENTION_TTL` after it was made, then forgotten; `expiresAt` says when. Passwords are only
here: done staged items don't carry them.
```json
{ "credentials": [ { "placeId": "…", "contactId": "…", "place": "…", "person": "…", "phone": "…",
                     "username": "…", "password": "…", "createdAt": "…", "expiresAt": "…" } ] }
```

### `GET /credentials/export?placeIds=` or `?upload=`
`text/csv` of the same, for handing out logins. The file is named after the upload, when one is given.
- `upload`: the logins one upload in the staged list created. Pass its `upload.runId`, or
  `earlier` for items uploaded before uploads were recorded on items.
- `placeIds`: those places' logins.
- Neither: everything still kept.

---

## 10. Events

### `GET /events`
`text/event-stream`, for the signed-in user. Every event's `data` is JSON:

| Event | Data |
|---|---|
| `item` | A staged item, after any change to it |
| `item-removed` | `{ "id" }` |
| `validation` | `{ "state", "done", "total" }` of the staged list's background validation |
| `upload` | `{ "state", "done", "total" }` of the current upload |
| `job` | A hierarchy job, after any change to it |

Clients reconnect with `Last-Event-ID` to receive what they missed. Anything missed beyond the
server's buffer is recovered by re-reading `GET /staged-items` and `GET /hierarchy-jobs`.

---

## 11. Status codes

| Status | Used for |
|---|---|
| 200 | Reads; repeats of an idempotent write (`already_applied`); an existing job |
| 201 | A place, person, user or staged item was created by this request |
| 202 | Accepted for background work: CSV staging, uploads, hierarchy jobs |
| 204 | Done, nothing to return |
| 400 | Malformed request: bad JSON, missing CSV columns, unknown fields |
| 401 | Not signed in, or the CHT session expired |
| 403 | Signed in, but not allowed: permissions, or outside the caller's facilities |
| 404 | The instance, contact type, place, item or job doesn't exist |
| 409 | Conflicts with current state: warnings to confirm, ids reused, overtaken, concurrent change, revision mismatch, locked item, overlapping job, changed config |
| 422 | Well-formed, but invalid: field errors, wrong types, rules like "can't merge into itself" |
| 502 / 504 | CHT failed or couldn't be reached; the request can be re-sent |
