# CHT-IAM Tool

## Auth

The tool has no user store of its own. A user signs in with their account on a CHT instance; the
tool obtains a CouchDB session for that account and makes every CHT call with it. What a user can
do in the tool is therefore exactly what their CHT account can do, and CHT enforces it.

Auth comes down to three things:
1. **Creating** a CHT session, either from a username and password or from an SSO access token.
2. **Admitting** the user: checking that their account is fit to manage users.
3. **Carrying** the session between requests, and using it for CHT calls.

### The session

A session is this record, and nothing else:

| Field | Meaning |
|---|---|
| `instance` | The CHT instance: host (and port), and whether it's reached over http or https |
| `username` | The CHT username |
| `sessionCookie` | CouchDB's `AuthSession=<value>` cookie for that user — the credential used on every CHT call |
| `facilityIds` | The places the user manages, or `["*"]` for an admin |
| `chtVersion` | The instance's CHT version, read at login |

The instances a user may pick from are a fixed list in the deployment configuration (a display
name, host:port, and an http flag), never free text. That stops the server from being pointed at
an arbitrary host. For local development an extra entry for a dev instance can be added, but only
outside production.

### Creating a session with a username and password

1. **Open a CouchDB session.** `POST {instance}/_session` with body `{ "name": username, "password": password }`
   (also send them as HTTP basic auth). A `401` means wrong credentials. On success, take the
   `AuthSession=...` pair from the `Set-Cookie` header. If it's absent, treat the login as failed.
2. **Admit the user** (next section).

The password is used only for this one call and is never stored.

### Creating a session with SSO (OIDC)

For machine clients, or a frontend that already holds an access token from the instance's identity
provider (IdP). The server logs in to CHT itself by following CHT's own OIDC login flow:

1. `GET {instance}/medic/login/oidc/authorize` without following redirects automatically.
2. Follow each redirect by hand (`Location` header, or a URL in the body — some CHT versions send
   it there), up to a fixed limit (12 hops). Keep **two separate cookie jars**, one for the CHT host
   and one for the IdP, and send each only back to its own host.
3. Add `Authorization: Bearer <access token>` **only** on requests to an origin in the configured IdP
   allowlist (`idpOrigins`). Never send the token to CHT or to any other host. If the allowlist is
   empty, SSO is disabled.
4. When a `2xx` response ends the chain, the CHT jar must hold `AuthSession` (the session cookie) and
   `userCtx`, a URL-encoded JSON cookie whose `name` is the username. Anything else — a `4xx`/`5xx`
   along the way, too many hops, or a missing cookie — fails the login.
5. **Admit the user**, exactly as for a password login.

The tool never validates or interprets the access token; the IdP and CHT do.

### Admitting the user

With the new `sessionCookie`, fetch these three documents in parallel (sending `Cookie: <sessionCookie>`):

| Call | Gives |
|---|---|
| `GET {instance}/medic/org.couchdb.user:{username}` | the user-settings doc: `roles`, `facility_id` |
| `GET {instance}/api/v2/monitoring` | `version.app`, the CHT version |
| `GET {instance}/api/v1/settings` | `permissions`: a map of permission name → roles holding it |

Then apply these checks in order, stopping at the first failure:

1. **Admins.** A user with the `admin` or `_admin` role is an admin. Admins can be turned away
   entirely with a setting (`ALLOW_ADMIN_LOGIN=false`); by default they're allowed in.
2. **Permissions.** Non-admins must hold every one of these permissions through at least one of
   their roles:

   `can_create_people`, `can_create_places`, `can_create_users`, `can_delete_contacts`,
   `can_delete_users`, `can_edit`, `can_update_users`, `can_view_contacts`, `can_view_users`

   Admins skip this check.
3. **Facilities.** Admins get `facilityIds = ["*"]`. Otherwise `facility_id` (a string or an array)
   becomes `facilityIds`, and must not be empty.
4. **Version.** The version must parse as semver (coerce values like `4.10.0-beta`). Set a single
   minimum and use it in both the check and the error message.

If every check passes, build the session record.

### Carrying the session between requests

The session is stateless: serialize the record into a token and hand it to the client. The record
contains a live CouchDB credential, so the token must be **encrypted as well as signed** (e.g. a JWE,
or AES-256-GCM over the signed JWT). Holding the token should let a client use the tool, but never
reveal the `AuthSession` cookie inside it. Give each token a unique id (`jti`) and an expiry, so it
can be revoked (see [Session lifetime and logout](#session-lifetime-and-logout)).

Give the token to a browser as a cookie that is `HttpOnly`, `Secure` and `SameSite=Lax` (or
`Strict`). Machine clients get it in the login response body and send it back as
`Authorization: Bearer <token>`. Accept either on the server. Keep tokens out of URLs and logs.

On every protected request:
1. Read the token from the bearer header, falling back to the cookie.
2. Decrypt the token, verify its signature and expiry, check it hasn't been revoked, parse the
   record, and check the required fields are present. Any failure means unauthenticated: a `401`
   for API callers, a redirect to the login page for pages.
3. Make the record available to the request handler, and build the CHT client from it.

Background jobs that outlive a request (hierarchy moves) get their **own** token, signed with a
different key (`WORKER_PRIVATE_KEY`) and a longer lifetime (96 hours). That way a leaked job token
can't be used as a login cookie, and the other way round.

### Session lifetime and logout

A session has two clocks: the tool's token, and the CouchDB session inside it. CouchDB sessions
expire after the instance's session timeout (`[chttpd_auth] timeout`). The tool can't extend or
revoke them, because CouchDB cookies are stateless.

**Lifetime**
- Use **one** lifetime, a single setting (`SESSION_TTL`), for both the token's expiry and the
  cookie's `Expires`/`Max-Age`. A cookie that outlives its token only produces confusing failures.
- Keep `SESSION_TTL` no longer than the instance's CouchDB session timeout. Otherwise the token is
  still valid while the credential inside it isn't.
- If CHT answers `401` to a call made with a valid token, the CouchDB session has ended early (for
  example, after a password change). Treat that as logged out: clear the cookie, and return `401`
  or redirect to login. Don't surface it as a CHT error.
- Optionally make the session sliding: when a CHT response carries a refreshed `AuthSession` in
  `Set-Cookie`, reissue the token with it and a new expiry. Keep an absolute cap from the original
  login, so a session can't be extended forever.

**Logout**
1. Add the token's `jti` to a revocation list in Redis (see [Data storage](#data-storage)) until
   the token's own expiry, so a copied token stops working immediately. Step 2 of every request
   checks this list.
2. Clear the cookie, using the same `Path`, `Domain` and `SameSite` attributes it was set with.
3. Optionally call `DELETE {instance}/_session` with the user's cookie. This only asks CouchDB to
   clear its cookie; it doesn't invalidate the session on the server. That's why step 1, and
   keeping the `AuthSession` encrypted inside the token, are what actually end access.

Machine clients log out the same way, through an endpoint that revokes the presented token.

To log everyone out at once, rotate the token keys. Every issued token then fails verification.

### Using the session

- Send `Cookie: <sessionCookie>` on every CHT request. CHT then applies the user's own permissions.
- Retry transient failures — network errors, and `500`/`502`/`503`/`504`/`511` responses — up to 4
  times, 1 second apart. Don't blindly retry non-idempotent writes such as user creation.
- **Scope by facility.** Before acting on a place, check that the place or one of its ancestors
  (from its `parent` lineage) is in `facilityIds`, or that `facilityIds` is `["*"]`. Don't rely on
  CHT for this: online users can generally read and write outside their own facility through the
  API.

### Errors to report

| Condition | Message to show |
|---|---|
| Empty username/password or access token | Missing username or password / Missing access token |
| `_session` returns `401` | Invalid username or password |
| No `AuthSession` in the response | Failed to obtain a session for {user} at {instance} |
| Host not found | Unable to connect to instance. Please check instance availability. |
| Timeout or connection refused | Connection to {instance} timed out |
| Admin login disabled | User {user} is not allowed to login |
| Missing a required permission | User {user} does not have the required permissions (log which ones server-side, but don't show them to the user) |
| No facility | User {user} does not have a facility_id connected to their user doc |
| Version unparseable / too old | Cannot parse CHT version {v} / CHT must be {minimum} or higher, {instance} runs {v} |
| Anything else | Unexpected error logging in (log the real error server-side) |

### Configuration

| Setting | Purpose |
|---|---|
| `COOKIE_PRIVATE_KEY` | Signs and encrypts session tokens (required); rotating it logs everyone out |
| `WORKER_PRIVATE_KEY` | Signs background-job tokens; must differ from `COOKIE_PRIVATE_KEY` (required) |
| `SESSION_TTL` | Lifetime of the token and its cookie; no longer than the instance's CouchDB session timeout |
| `REDIS_URL` | Where revoked token ids are kept until they expire (see [Data storage](#data-storage)) |
| `ALLOW_ADMIN_LOGIN` | `false` refuses CHT admins (default `true`) |
| instance list | Allowed instances: display name, host:port, http flag |
| `idpOrigins` | IdP origins allowed to receive the SSO access token; empty disables SSO |

Refuse to start if a required secret is missing, or if the two keys are the same.

## Data storage

**Redis is the tool's only datastore.** CHT is the system of record for places, people and users.
Everything the tool keeps itself is short-lived working data: staged items, generated credentials,
revoked tokens, and background jobs.

### Why Redis

- **The job queue needs it anyway.** Hierarchy jobs, CSV validation runs and uploads run in a
  persistent queue, and the standard Node.js queue for this, BullMQ, is built on Redis. Any other
  datastore would be a second one to deploy, back up and monitor.
- **Everything expires.** Every piece of data lives for days, not years. Redis expires keys itself,
  so no cleanup jobs are needed.
- **Shared by every server instance.** The staged list and the live-update stream must look the same
  from any server instance, and to the background workers. A local database file like SQLite would
  tie the tool to a single server.
- **No migrations.** Values are versioned JSON, upgraded when they're read (see
  [changing the format](#changing-the-format)), and old data simply expires.

### What's stored

Keys start with the instance and the user, so one Redis can serve several CHT instances, and one
user's data can never be read through another user's keys. Key names hold only ids; personal data
is only ever in encrypted values.

| Data | Redis type and key | Expires |
|---|---|---|
| **Staged items** | Hash `staged:{instance}:{user}`: item id → encrypted item | Whole list, `STAGED_LIST_TTL` (e.g. 14 days) after its last change |
| **Staged counts** | Hash `staged:{instance}:{user}:counts`: status → number of items | With the list |
| **Credentials record** | Sorted set `credentials:{instance}:{user}`: encrypted entries scored by creation time | Each entry after `CREDENTIALS_TTL` (e.g. 5 days). Entries older than that are removed on every read and write (`ZREMRANGEBYSCORE`), and the whole key expires with its newest entry |
| **Revoked tokens** | String `revoked:{jti}` | When the token itself would have expired |
| **Hierarchy jobs** | A queue per instance, `jobs:{instance}`, holding each job's request, status, progress, result and log | Finished jobs after `JOB_TTL` (e.g. 30 days) |
| **Validation and upload runs** | A queue, `runs:{instance}`, with one job per staged list and run | When the run finishes |
| **Run locks** | String `lock:{instance}:{user}:{validation\|upload}`, set only if absent, with a short expiry that the running worker keeps extending | If the worker dies, the lock lapses and the run can be picked up again |
| **Events** | Stream `events:{instance}:{user}`, capped at the last ~1,000 events | By the cap. This is what lets a reconnecting client catch up from `Last-Event-ID` |

The staged list is one hash per user. A list holds hundreds or a few thousand items, so filtering
it by status, kind or text is done by reading the hash and filtering in memory. There are no
secondary indexes to keep in step; only the counts hash is updated alongside the items.

**Not in Redis:** the archives of deleted docs. They can be large, and they're kept for as long as
`ARCHIVE_TTL` (e.g. 30 days), so they go to disk or object storage (`ARCHIVE_LOCATION`). The job
records where. The indexes built while validating a CSV aren't stored either; they live in the
worker's memory for the length of the run.

### Encryption

Staged items and credentials hold names, phone numbers and passwords, so they're encrypted before
they reach Redis: AES-256-GCM, with a fresh IV per value. Each value is prefixed with the id of the
key that encrypted it (`k1:<iv>:<tag>:<ciphertext>`). That allows rotating `SECRET_KEY`: new values
use the new key, old ones are still readable with the old key, and they expire soon anyway.

### Updating staged items safely

A change to a staged item has to check its `revision`, write the item, and adjust the status counts,
all at once. Do it in one Lua script, which Redis runs atomically. If the stored revision doesn't
match, the script changes nothing, and the API answers `409 REVISION_MISMATCH`. Adding and removing
items go through the same script, so the counts can never drift from the items.

### Changing the format

Every stored value carries a version: `{ "v": 2, … }`. When the format changes:
1. bump `v` for new writes;
2. add a function that upgrades a `v1` value to `v2`, applied whenever an old value is read;
3. delete that function once the longest expiry has passed since the change, since no `v1` values
   can be left by then.

That's the whole migration story: no scripts to run on deploy, and nothing to roll back.

### Running Redis

- **Persistence must be on.** The staged list must survive a restart, so enable the append-only
  file (`appendonly yes`, `appendfsync everysec`), plus the default snapshots for backups. With
  snapshots alone, a crash loses the writes since the last one.
- **Never evict.** Set `maxmemory-policy noeviction`. Under memory pressure Redis then rejects
  writes, which the tool reports, instead of silently dropping staged items or queued jobs. BullMQ
  requires this too.
- **One Redis per deployment**, shared by all server instances and workers. Redis 6.2 or later.
  Require a password, and TLS when it isn't on the same private network.
- **Size:** small. A staged item is a few KB, so even thousands of items per user is a few MB.
- **Losing Redis** loses staged work, the credentials record and the job queue, but never any CHT
  data. Everything already uploaded is safe in CHT. Back up the append-only file as you would any
  service state, but it isn't the system of record.

### Configuration

| Setting | Purpose |
|---|---|
| `REDIS_URL` | Connection, including password and TLS (`rediss://`) |
| `SECRET_KEY` | Encrypts staged items and credentials (required). Earlier keys can be kept to read older values during rotation |
| `STAGED_LIST_TTL` | How long a staged list is kept after its last change |
| `CREDENTIALS_TTL` | How long a generated password can be seen again |
| `JOB_TTL` | How long finished jobs are kept |
| `ARCHIVE_LOCATION`, `ARCHIVE_TTL` | Where delete archives are written, and for how long |

## App Functionality

## Finding places

Every form, CSV row and check finds places by type and name: the parent for a new place, the place
to replace, move, merge or delete, and duplicates. How depends on how many places the type has,
since some types, such as households, run to hundreds of thousands:

- **A type with at most `MAX_PLACES_LOADED` places** (10,000 by default) is read whole, kept for a
  few minutes, and searched in memory. Places the tool creates are added to it straight away.
- **A larger type is never read whole.** Only the places under one parent are read, when they're
  needed, and each parent once per CSV file.

Whether a type is large is checked by counting its places, no further than one past the limit and
without reading the docs, again every few minutes. Nothing is configured per type, so any
deployment's large types are handled the same way. For a large type:

- **Searching it needs the place above.** A search without a parent is refused with
  `PARENT_REQUIRED`, and a form's field for it waits until the field above is filled in.
- **A CSV row finds it under the level above**, so that level must be filled in. The place a row
  acts on is always looked for under the row's parent, whatever the type's size.
- **Duplicate checks look within the parent.** A property `unique` within its parent is only ever
  compared with the parent's places, for every type. One `unique` across all places can only be
  checked within the parent for a large type.
- **Replacing it can't search people across the type**; the place is picked instead.

## Staged list

Nothing goes to CHT straight from a form or a file. Requests are first added to the user's **staged
list**, reviewed once, fixed where needed, and then uploaded. This applies to both the UI and CSV,
and to creating and replacing users, and to moving, merging and deleting places, alike.

Each staged item holds a **complete request**: exactly what the upload will send to the create (or
replace) operation, along with its review state. The list only holds requests. Nothing in CHT
depends on it, and uploading an item is just sending its request, which is idempotent.

### Where it lives

The list is kept in Redis (see [Data storage](#data-storage)), keyed by user and instance,
encrypted, and expiring after some days of inactivity. Not in server memory, where it's lost on
restart and invisible to other server instances. Not only in the browser either: CSV validation
runs in the background and has to keep going when the tab is closed, and the list should survive a
switch of device.

### Items

| Field | Meaning |
|---|---|
| `id` | The item's own id |
| `kind` | `create`, `replace`, `move`, `merge` or `delete` |
| `request` | The complete request, including the `placeId` and `contact.id` chosen when the item was made |
| `source` | The form, or the CSV file name and row number |
| `raw` | For CSV rows, the row as uploaded (hierarchy names as typed), so fixing starts from what the user sent |
| `status` | See below |
| `errors` | Field errors, keyed by field (`place.code`, `hierarchy.SUBCOUNTY`, …) |
| `warnings` | Duplicate warnings not yet confirmed |
| `result` | After upload: the ids and username (the password is in the credentials record), or the failure reason |
| `revision` | Increases on every change. An edit states the revision it started from, so two tabs can't silently overwrite each other |

| Status | Meaning |
|---|---|
| `pending` | Added but not yet validated (CSV rows) |
| `validating` | Validation is running |
| `invalid` | Has field errors, or a hierarchy name couldn't be resolved (not found or ambiguous); must be fixed |
| `needs_confirmation` | Valid, but waiting for the user to accept something: duplicate warnings (`create`), a large move (`move` from a CSV), or the typed name (`merge` and `delete` from a CSV) |
| `ready` | Valid and confirmed; goes in the next upload |
| `uploading` | Being sent |
| `created` | Done (including "already applied") |
| `failed` | The upload failed; the reason is shown, and retrying is safe |

An item moves like this:
- From the form: straight to `ready`, since the form only adds valid, confirmed items.
- From a CSV: `pending` → `validating` → `invalid`, `needs_confirmation` or `ready`.
- On edit: validated again → `invalid`, `needs_confirmation` or `ready`.
- On confirm: `needs_confirmation` → `ready`.
- On upload: `ready` → `uploading` → `created` or `failed`, and back to `uploading` on retry.
- A `move`, `merge` or `delete` item: uploading it schedules a background job. From then on, the
  item shows that [job's status](#job-status) instead of `created`.

### Adding from the form

The create form validates everything before an item can be added: field rules, hierarchy picked
from search, and the duplicate check with any matches confirmed (see
[Creating one user](#creating-one-user-ui)). "Add to list" therefore always adds a `ready` item. The
user can keep adding items before uploading.

### Adding from a CSV: pre-validation

A file can have hundreds of rows, and checking them against CHT takes time. So rows are staged
first and validated in the background:

1. **Check the file** straight away: parse it, and refuse it if a required column is missing.
2. **Stage every row** as a `pending` item with a fresh `placeId` and `contact.id`, so the list
   appears immediately.
3. **Run the local checks immediately**: formats, required fields, roles and select values. They
   need no CHT access, and use the same shared validation code as the form. Rows failing them
   become `invalid` at once.
4. **Run the CHT checks in the background.** These resolve each row's hierarchy names to a parent
   id, and look for duplicates against existing places and between rows. Each item's status
   updates as it finishes.
5. The list shows progress ("120 of 400 validated") and counts per status. The user can start fixing
   `invalid` rows before the rest have finished.

**Making the CHT checks fast.** Checking row by row is slow: hundreds of rows, several hierarchy
levels each, one request per lookup. Instead, work in bulk for each validation run and contact type:
- Fetch all places of each hierarchy level's type once, with
  `GET {instance}/medic/_design/medic-client/_view/contacts_by_type?key=["<type>"]&include_docs=true`,
  and index them by normalized name (case- and accent-insensitive, formatted like a `name` value) and
  by parent.
- Resolve every row's names against that index in memory, from the top level down, so each level is
  looked for only under the parent found above it.
- Fetch the places of the item's own type once, and check duplicates in memory.
- Compare rows with each other in memory. This catches duplicates within the file, and rows whose
  parent is another row, like a unit and the areas under it. Such a row resolves to the other row's
  `placeId` and is uploaded after it.

That makes validation a handful of CHT reads, whatever the file size. It runs as a background job
using the user's own session (the job token from [Auth](#auth)), so it sees only what the user can see and
respects their facilities. Run one validation job per staged list at a time; rows added meanwhile
wait for the next run.

### Reviewing and fixing

- The list shows each item's key fields, status, and errors or warnings, filterable by status.
- **Edit** opens the same form used for creating, filled in from the item, with the same
  validation. For a CSV row whose hierarchy didn't resolve, the typed names are pre-filled as
  search text, with the error shown. Saving replaces the item's request. The item keeps its
  `placeId` and `contact.id`.
- **Confirm** accepts what an item is waiting for. Duplicate warnings (the request gets
  `ignoreWarnings: true`) and large moves can be confirmed one at a time or all at once. A `merge`
  or `delete` is confirmed one at a time, by typing the place's name.
- **Remove** discards an item.

### Uploading

- **Upload** sends every `ready` item and leaves the rest in the list. Items whose parent is another
  item go after it; the rest run in parallel, about 15 at a time. An item whose parent item failed
  is left `ready`, with a note that it's waiting for its parent. `replace` items that update the
  same account, as the incoming or the outgoing person, go one after another.
- Each item is sent as its idempotent request, and the server validates it again. Validation in the
  list is a snapshot, so something may have changed since, such as a duplicate created by someone
  else. That comes back as warnings, and the item returns to `needs_confirmation`.
- A field error from the server means the list's validation and the server's disagree. That's a
  bug: mark the item `invalid`, and report it.
- Successful items become `created` and show the username. Passwords are available from the
  credentials record, and all new credentials can be downloaded together. Failed items show the
  reason, and retrying sends the same request, which resumes safely.
- Once an item has been sent, its ids are fixed. If a failed item is then edited in a way that
  clashes with what was already written (a different parent, for example), the upload reports a
  conflict. The user can then discard the item and make a new one, which gets new ids; the partly
  written place has to be removed from CHT separately.
- Clear `created` items when done, or let them expire.

## 1. Create Users

Creating a user means creating three linked things in CHT at once:

| What | Is | Links to |
|---|---|---|
| **Place** | a contact doc for the place the person serves (e.g. a community health unit) | its parent place, and its primary contact |
| **Primary contact** | a person doc for the person | the place, as its parent |
| **User account** | the CHT login for that person | the person (`contact`) and the place(s) they manage (`place`) |

A create request describes all three completely, and is carried out within that request. It is
also **idempotent**: sending the same request again, after a success, a partial failure or a
timeout, finishes the job rather than creating duplicates. This works because the client chooses
the ids of the new place and person, and every step checks what already exists before writing.

### What drives it: contact types

Everything that varies between deployments comes from the deployment's configuration, as a list
of **contact types**. Each one describes a kind of place the tool manages, usually one that gets a
user:

| Setting | Meaning |
|---|---|
| `name`, `friendly` | Id of the place type (e.g. `c_community_health_unit`) and its display name |
| `contact_type` | Type of the person created as primary contact (usually `person`) |
| `hierarchy` | The parent levels above the place, each with a `level` (1 = direct parent) and the place type expected there |
| `place_properties` | Fields of the place doc |
| `contact_properties` | Fields of the person doc |
| `user_role` | Role(s) the new user may get. With one role it's assigned automatically; with several, the request must choose |
| `username_from_place` | Derive the username from the place's name instead of the person's |
| `can_assign_multiple` | One person and user may serve several places of this type (see [One person, many places](#one-person-many-places)) |
| `actions` | The only actions offered for the type, from `create`, `replace`, `move`, `merge` and `delete`. Every action when left out |
| `hooks` | Scripts in the deployment's folder, run in order on each of the type's places before it's written (see [Deployment hooks](#what-drives-it-contact-types)) |

Every property has a `property_name`, a `friendly_name` (the form label and CSV column), a `type`,
a `required` flag, and optionally a type-specific `parameter`, an `errorDescription` and a
`unique` scope.

**Property types.** Every value is cleaned up (formatted) first, then checked. The stored value is
the formatted one.

| Type | Formatting | Valid when |
|---|---|---|
| `string` | Drop characters other than letters, digits, marks, spaces and `()@./-_'`; collapse spaces; trim | non-empty |
| `name` | As `string`; `.` becomes a space; remove each pattern in `parameter` (case-insensitive regexes, e.g. `"\\sCommunity Health Unit"`); title case, keeping roman numerals upper case | non-empty |
| `regex` | As `string` | matches the `parameter` regex; the error shown is `errorDescription` |
| `phone` | E.164, e.g. `+254712345678` | a valid number for the region in `parameter` (e.g. `KE`) |
| `dob` | ISO date | an ISO date, `d/M/yyyy`, or an age in years; in the past |
| `select_one` | — | one of the keys of the `parameter` map |
| `select_multiple` | — | space-separated keys, all in the `parameter` map |
| `generated` | Rendered from the `parameter` template, e.g. `"{{ contact.name }} Area"` | non-empty if required |
| `none` | — | always |

A `generated` value is never accepted from the client; it's always computed. Its template can use
the other formatted values (`place.*`, `contact.*`) and the names of the places above
(`lineage.<hierarchy property_name>`).

**Uniqueness.** `unique: "all"` means no two places of this type should share the value;
`unique: "parent"` means no two with the same parent should. A duplicate is a **warning**, not an
error, because some duplicates are legitimate (see step 3).

**Actions.** A type that lists `actions` is offered only for those: its forms, CSV templates
and imports appear only for them, and the server refuses any other with `ACTION_NOT_ALLOWED`, from
the form, a CSV or the API. For example, Kenya's households (`e_household`, under a CHP area)
can only be moved. A type that can't be created still needs its `hierarchy` (where its places sit, and where they can move) and a
`replacement_property` (how a CSV row's name is matched to a place).

People are told apart from places by CHT's own settings: CHT's `person` type, and every configured
type CHT marks as a person, such as a household's members. So a move, merge or delete counts them
as people, not places.

**One folder per deployment.** Everything deployment-specific lives in one folder, and the app
is told which folder to use: its contact types, the CHT instances users sign in to, an optional
logo, and any hooks. The app knows no deployment by name, so any folder in that shape works.
It's read once at startup, and a missing or malformed file stops the server.

**Deployment hooks.** A contact type can list `hooks`: scripts in the deployment's folder that
adjust its places before they're written. A type's hooks run in the order listed, each on the place
as the one before left it; a type without any writes its places as validated, and one script can
serve several types. For example, Kenya's units have a hook that appends " Community Health Unit"
to their names, and its CHP areas one that copies the unit's facility and codes onto each new area.
Hooks run at upload, after validation, and receive the CHT client, so they can read related docs.
One that throws refuses the write: the item fails with `HOOK_FAILED` and the hook's own message.
CHT failing while a hook reads from it is reported as a CHT failure, which is safe to retry. Every listed hook is loaded at startup, so a missing
one stops the server. Hooks never reach the browser. A hook is code from the configuration, so
treat the folder as trusted: only the people who deploy the app should be able to change it.

### The request

```json
{
  "contactType": "c_community_health_unit",
  "placeId": "0b6c…",                 // client-chosen id for the new place
  "parentId": "5f1c…",                // id of an existing place (resolved from a name beforehand)
  "place":   { "name": "Kanyakwar", "code": "123456" },
  "contact": { "id": "9ab2…", "properties": { "name": "Jane Doe", "phone": "0712345678" } },
  "user":    { "roles": ["community_health_assistant"] },   // only for types with several roles
  "ignoreWarnings": false
}
```

The request names the parent **by id**, not by name. Finding a place by name (fuzzy, scoped by
the levels above) is a separate read-only lookup that the UI and CSV import do before submitting.
Resolving names inside the write would make it non-idempotent, because the answer changes as places
are added.

### Steps

Each step first checks whether its work is already done, so a repeated request skips what's
finished and resumes at the first step that isn't.

**Document update conflicts** (CouchDB's `409`, which CHT's API sometimes passes on as a `500` with
the same message) are retried automatically, a few times, with a short, growing and randomised
delay. They're never re-sent blindly, because the request body may be out of date:
- **Writing the place or the person:** re-read the doc. If it's the one this request would write,
  the step is done. If it has gone, write it again. If it's something else, stop with a conflict.
- **Creating the user:** look the user up by contact id first. The attempt that conflicted may
  have created it.
- **Adding a place to the user:** re-read the user and work out the place list again. Re-sending
  the old list could drop a place another request has just added.

If the conflicts persist, stop with an upstream error. Sending the same request again resumes it.

1. **Validate.** Format and check every place and contact property as above, including the
   `required` flags. Also reject keys that aren't properties of the type, and attempts to set a
   `generated` property. Resolve the roles: the type's single role, or the requested ones, which
   must all be in `user_role`. Report every problem at once, keyed by field (`place.code`,
   `contact.phone`, `user.roles`), and write nothing.
2. **Check the parent.** It must exist, be of the type at hierarchy level 1, and be within the
   caller's facilities (the parent or one of its ancestors is in `facilityIds`). Read the parent's
   ancestors too; their names feed `lineage.*` in generated properties.
3. **Check for duplicates.** For each `unique` place property, look for existing places of the
   same type with the same value (compared case- and accent-insensitively, within the parent for
   `unique: "parent"`). If any match and `ignoreWarnings` is false, stop and return the warnings;
   the user confirms by re-sending with `ignoreWarnings: true`. Skip this on a replay, where the
   place already exists and would only match itself.
4. **Apply the type's hooks** to the place fields, in order.
5. **Write the place**, if `placeId` doesn't exist, with `PUT {instance}/medic/{placeId}`:
   ```json
   {
     "_id": "0b6c…",
     "type": "contact", "contact_type": "c_community_health_unit",
     "name": "Kanyakwar Community Health Unit", "code": "123456",
     "parent":  { "_id": "5f1c…", "parent": { "_id": "county…" } },
     "contact": { "_id": "9ab2…", "parent": { "_id": "0b6c…", "parent": { "_id": "5f1c…", "parent": { "_id": "county…" } } } },
     "reported_date": 1790000000000,
     "user_attribution": { "tool": "cht-iam-<version>", "username": "<caller>", "created_time": 1790000000000, "warnings": [] }
   }
   ```
   CHT's built-in types (`district_hospital`, `health_center`, `clinic`, `person`) use
   `"type": "<name>"` instead of `"type": "contact"` plus `contact_type`. `parent` is the minified
   lineage: the parent's id, then its parent's, up to the top. If a doc with `placeId` exists but
   has a different type, parent or contact, another request has used that id: stop with a conflict.
   Writing the doc directly, instead of through CHT's `api/v1/places`, is what lets the client
   choose the ids.
6. **Write the person**, if `contact.id` doesn't exist, with `PUT {instance}/medic/{contactId}`:
   the formatted contact properties, `type: "person"`, `parent: { "_id": placeId, "parent": … }`,
   `reported_date` and `user_attribution`.
7. **Create the user**, unless one already exists for the person
   (`GET {instance}/api/v2/users?contact_id={contactId}`), with `POST {instance}/api/v3/users`:
   ```json
   {
     "username": "jane_doe",
     "password": "<generated>",
     "roles": ["community_health_assistant"],
     "place": ["0b6c…"],
     "contact": "9ab2…",
     "fullname": "Jane Doe",
     "phone": "+254712345678",
     "password_change_required": false
   }
   ```
   - **Username:** the person's name (or the place's, with `username_from_place`), with spaces
     turned into `_`, everything but `a–z`, `0–9` and `_` dropped, repeated `_` collapsed, and
     lower-cased.
   - **Password:** 9 characters from `A–Z a–z 0–9 . ,`, from a cryptographically secure random
     source.
   - **`password_change_required`** is true when the contact property `require_password_change`
     is `yes`.

   If CHT replies that the username is already taken, first look the user up by contact id: an
   earlier attempt of this same request may have created it. If not, append a random number 0–99
   and try again. If CHT rejects the password as too weak, generate a new one and retry. After a
   `5xx` or timeout, look the user up by contact id before retrying. Give up after 4 attempts.
8. **Record the credentials**: place, person, phone, username, password, place id and contact id.
   Store them encrypted in Redis, for a limited time (e.g. 5 days), keyed by the calling user (see
   [Data storage](#data-storage)).
   This lets the caller see or export them again, and lets a repeated request return the password.
   A failure to record must not fail the request, since the response is carrying the password.

**Response:** the place id, contact id, username, password and any warnings accepted, plus whether
this request created anything (`created`) or found everything already done (`already_applied`).
The username can differ from what the name alone suggests, because of the collision suffix, so
clients must use the returned one.

### One person, many places

For types with `can_assign_multiple`, one person can serve several places with a single login. There
is no separate operation: create each place with its own `placeId` and the **same** `contact.id`.

- The first request creates the place, the person and the user.
- Each later one finds the person already exists, so it skips steps 6–7. It writes only the new
  place, pointing at that person (the person's parent stays the first place), and adds the new
  place to the user's places with `POST {instance}/api/v1/users/{username}` and
  `{ "place": [<existing ids>, placeId] }`.

`contact.properties` can be left out of the later requests. For types without
`can_assign_multiple`, reusing a person who already belongs to another place is a conflict.

### Creating one user (UI)

1. The user picks a contact type. The form is generated from its configuration: one field per
   property, excluding `generated` ones, using each `friendly_name` as the label. There's a roles
   picker when the type has several roles.
2. Hierarchy fields are search-as-you-type. Each one looks up places of the expected type by name,
   within the levels already chosen above, and stores the chosen place's **id**. A level counts as
   filled only once a search result is picked; typed text alone isn't valid. Only the level-1 id is
   sent.
3. When the form opens, generate the `placeId` and `contact.id` and keep them with the form. They
   stay with the item in the staged list, so every upload attempt sends the same ids.
4. **Validate before adding. The form only ever adds valid data.** Validate each field as the
   user fills it in, with exactly the rules from [Property types](#what-drives-it-contact-types),
   and show the error next to the field. Show `generated` values as a live preview, computed with
   the same template the server uses. Keep "Add to list" disabled until every field is valid.
   The browser and the server must apply identical rules, so implement the formatters and
   validators once, in code both can run, driven by the same contact type configuration. Never keep
   two copies that could drift apart.
5. **Check for duplicates before adding too.** When the `unique` fields are valid, run a
   read-only duplicate check with their values and the chosen parent. If it finds matches, show
   them next to the fields. The user either changes the value or confirms the duplicate, in which
   case the request carries `ignoreWarnings: true`.
6. **Add to the staged list** as a `ready` item. The form resets for the next entry, with fresh ids.
7. **Review and upload** from the [staged list](#staged-list). When an item is created, show its
   username and password with a copy button. The password can be fetched again only from the
   credentials record, and only until it expires.

This same form is the one the staged list opens to edit an item, whether it came from the form or
from a CSV row. Editing an item keeps its ids.

For one person with many places, keep the person section filled in and let the user add
another place. Each place becomes its own item, with its own `placeId` and the same `contact.id`.

A new person entered in the form may be someone already in the staged list, from the form or a CSV.
For types with `can_assign_multiple`, once the person's fields are valid, check the list with the
same matching as for CSV rows (below). If there's a match, ask whether it's the same person before
adding, like a duplicate place:
- **The same person:** the new place shares their `contact.id`, as if the user had kept the person.
- **Someone else:** the entry stays a new person.

The form doesn't match silently, because that would change an id the form chose. The server makes
the same check when an item is added, and refuses a match that hasn't been answered.

**Removing the item that creates a person** hands the person over. The earliest of their other
staged places takes the same `contact.id` and the person's properties, and creates them instead.
The rest of their places now depend on it. Once the item that creates a person is uploaded, the
person is in CHT and removing it changes nothing else.

### Creating many users (CSV)

1. **Template.** For each contact type, offer a CSV with one header row: the `friendly_name` of every
   hierarchy level, place property and contact property (excluding `generated`), plus `Roles` when
   the type has several roles. Columns are matched by header name, so their order doesn't matter.
   Refuse a file missing a required column before reading any rows.
2. **Upload the file to the staged list.** Every row becomes an item with its own `placeId` and
   `contact.id`, and is validated in the background: local checks at once, then CHT checks in
   bulk. The checks cover resolving hierarchy names to parent ids, and duplicates against existing
   places and between rows (see [pre-validation](#adding-from-a-csv-pre-validation)).
   - **One person, many places.** For types with `can_assign_multiple`, rows whose person looks
     the same are one person ([One person, many places](#one-person-many-places)). Two people look
     the same when every contact property and the roles match, once each value is formatted as it
     would be stored, and case, accents and spacing are ignored. So "0712 345 678" and
     "+254712345678" match, but the same name with another phone doesn't. The first such row
     creates the person. The others share its `contact.id`, leave out the person's properties, and
     depend on it. A row whose person fields fail validation is never matched, so it can be fixed on
     its own. Rows are matched against the people already in the staged list too, from the form or
     an earlier file, and those people stay the ones created first.
3. **Fix and confirm in the list.** Rows that failed validation are flagged `invalid`, and are
   fixed in the same form used for creating, with the same validation. Rows with duplicate
   warnings wait for confirmation. Only `ready` rows can be uploaded.
4. **Upload** from the list. Rows whose parent is another row in the same file are uploaded after
   it, and rows sharing a person after the row that creates them, one at a time. Each row succeeds or fails on its own, and the new credentials can be downloaded together.

Every row is an idempotent request with fixed ids, so a failed or interrupted upload is recovered by
fixing what failed and uploading again.

### Errors to report

| Condition | Report |
|---|---|
| Field values invalid | Every field error, keyed by field; nothing written |
| Unknown contact type | Unknown contact type {name} |
| Parent missing / wrong type | Parent {id} was not found / is a {type}, expected {type} |
| Parent outside the caller's facilities | You are not allowed to manage places in this part of the hierarchy |
| Duplicate values | The warnings, with the ids of the matching places; proceed only if confirmed |
| Id reused for something else | Conflict: {id} already exists as a different place or person |
| Person already serves another place (type can't share) | Conflict: {contact} belongs to another place |
| A hook of the type refused the place | The hook's own message; nothing written |
| CHT failed or unreachable | The CHT message, and that sending the same request again resumes it |

## 2. Replace Existing Users

Replacing means someone else takes over a place that already exists, for example when a community
health worker leaves. The place stays; what changes is who is behind it. There are two choices:

- **Who takes over:** a **new person**, created as part of the replace with their own new login, or
  an **existing person**, who keeps their login and adds the place to it.
- **What they take over:** **all** the places the outgoing person serves, or **just this place**,
  which leaves the outgoing person with the rest.

| | All the outgoing person's places | Just this place |
|---|---|---|
| **New person** | A newcomer takes over a leaver's whole workload | A newcomer takes one place off someone who keeps the rest |
| **Existing person** | A colleague absorbs a leaver's whole workload | A colleague takes over one neighbouring place |

Both choices only exist for contact types with `can_assign_multiple`, where one person can serve
several places. For every other type, the outgoing person serves exactly one place, and an existing
person can't take on a second. So a replace is always "a new person takes the place", and the
choices never appear.

Whatever the choices, the same things happen:

| What | Happens |
|---|---|
| **Incoming person** | A new person is created under the place, with a new login. An existing person keeps their record and login, and their account gains the place(s) |
| **Place(s)** | The primary contact switches to the incoming person. Place properties may be updated at the same time, and `generated` ones are recomputed (an area named after its worker gets the new worker's name) |
| **Outgoing accounts** | Lose the place(s). An account left with no places is retired: disabled or deactivated, depending on the contact type |
| **Outgoing person** | Kept, where they are under the place, whatever the contact type: they may have reports, and they're part of the place's history |

A replace request is complete and **idempotent**. The incoming person's id is how a repeated request
recognises its own replacement, even after the outgoing accounts are already retired.

### Settings that apply

Replacing uses the same [contact types](#what-drives-it-contact-types) as creating, plus:

| Setting | Meaning |
|---|---|
| `replacement_property` | The field the UI and CSV use to find the place being replaced by name (e.g. "Outgoing CHP"). Its `parameter` patterns strip words that aren't part of the name, like `"'s Area"` |
| `deactivate_users_on_replace` | `false`: **disable** retired accounts. `true`: **deactivate** them. Either way, the outgoing person is kept |
| `can_assign_multiple` | Enables the two choices above |
| `user_role` | An existing incoming person's account must hold at least one of these roles |

**Disable or deactivate?** Disabling the account (`DELETE {instance}/api/v1/users/{username}`) is
the cleaner removal. Deactivating replaces the account's roles with `deactivated`, a role that
grants nothing (`POST {instance}/api/v1/users/{username}` with `{ "roles": ["deactivated"] }`). The
account, its password and any SSO link are kept, so the person can later be given access again,
and keeping the person doc keeps their history attached to them.

### The request

```json
{
  "contactType": "d_community_health_volunteer_area",
  "placeId": "a41e…",                  // the existing place being taken over
  "contact": { "id": "c0ff…", "properties": { "name": "Grace Owino", "phone": "0744000000" } },
  "scope": "all",                      // or "place"; only for types with can_assign_multiple
  "place":   { },                      // optional: place properties to change at the same time
  "user":    { "roles": ["community_health_volunteer"] }    // new person only, types with several roles
}
```

`contact` follows the same convention as in [Create](#one-person-many-places):
- **with `properties`**, it's a **new person** with a client-chosen `id`;
- **with only an `id`**, it's an **existing person**, taking over with their existing login.

`scope` defaults to `"all"`. Both the place and the person are named **by id**. Finding either by
name is a read-only lookup done before submitting.

There is no duplicate check and no `ignoreWarnings`. A replace only switches who is behind existing
places, so there are no new places to compare against.

### Steps

As with create, each step checks whether its work is already done. A repeated request therefore
resumes at the first step that isn't.

1. **Validate.**
   - A new person's properties follow the [create rules](#steps) in full, and roles resolve as for
     create.
   - An existing person takes no properties or roles.
   - Place properties are optional: only the ones given are checked and written.
   - `generated` properties are recomputed from the new values, the incoming person's values, and
     the place's lineage.

   On any error, report every problem and write nothing.
2. **Check the place.** It must exist, be of the requested type, and be within the caller's
   facilities.
3. **Check the incoming person.**
   - A **new person**: if a doc with `contact.id` already exists, it must be a person under this
     place, left by an earlier attempt of this request. Otherwise stop with a conflict.
   - An **existing person**: the type must have `can_assign_multiple`. The person must exist, be
     within the caller's facilities, and have exactly one account
     (`GET {instance}/api/v2/users?contact_id={contactId}`). That account must be active, and hold
     one of the type's `user_role`s.
4. **Work out where things stand.** The place keeps `previousPrimaryContacts` and a list of
   `replacements` in its `user_attribution` (written in step 7):
   - its contact is already the incoming person, with a matching replacement entry → the switch is
     done; continue at step 8;
   - its contact is already the incoming person, with no entry → if that's an existing person whose
     account already holds the place, there's nothing to do. Otherwise the person was made primary
     some other way: stop with a conflict;
   - the incoming person was primary once, but the place has since been replaced again →
     **overtaken**: stop, and change nothing;
   - otherwise → continue.
5. **Record the outgoing situation** before changing anything. The outgoing person is the place's
   current contact. Look up their accounts (`GET {instance}/api/v2/users?contact_id={outgoingId}`),
   and note the usernames and every other place those accounts hold. With `scope: "all"`, those
   other places are handed over too. This is written in step 7, so clean-up can still finish after
   the outgoing accounts are gone.
6. **Write the new person** (new person only), if `contact.id` doesn't exist, with
   `PUT {instance}/medic/{contactId}`: as when creating, with `parent` set to the place and its
   lineage.
7. **Switch the place** with a read-modify-write of the place doc, retried if CHT reports an
   update conflict:
   - apply the type's hooks to the place changes, then apply the changed and recomputed properties;
   - set `contact` to `{ "_id": contactId, "parent": <the incoming person's lineage> }`. For a new
     person, that's this place and its lineage. An existing person keeps their own, as with
     [one person, many places](#one-person-many-places);
   - append the outgoing person to `user_attribution.previousPrimaryContacts`, and append a
     replacement entry recording the outgoing situation from step 5:
     ```json
     {
       "contact": "c0ff…", "previous_contact": "9ab2…", "scope": "all",
       "affected_places": ["<the other places handed over; empty for scope place>"],
       "outgoing_users": ["mary_atieno"],
       "tool": "cht-iam-<version>", "username": "<caller>", "replaced_time": 1790000000000
     }
     ```

   Add to `user_attribution`; never overwrite what's already there. If the place's contact changed
   since step 4, someone else is replacing it at the same moment: stop with a conflict.
8. **Switch the other places** in `affected_places`. Each one that still points at the outgoing
   person switches to the incoming one, in the same way. A place someone has since changed is left
   alone.
9. **Give the incoming person a login for the places** (`placeId` plus `affected_places`):
   - a **new person** gets a new user, following the [create rules](#steps): username, password,
     retries, look-up before retry. If a user already exists for them, add any missing places;
   - an **existing person**'s account gets any missing places added, with
     `POST {instance}/api/v1/users/{username}`.
10. **Take the places from the outgoing accounts** named in `outgoing_users`. An account that still
    has other places just loses these. An account left with none is retired: disabled or deactivated
    (see above). This comes after step 9, so the places always have a working login. Accounts that
    no longer hold the places are skipped, and other accounts assigned to the place are left alone.
11. **Record the credentials** (new person only), as when creating.

The outgoing person is **never deleted**, even when they no longer serve any place. Their record
stays under the place, so reports about them or created by them still point at a person, and the
place's history, including `previousPrimaryContacts`, still names someone who exists.

**Response:**

```json
{
  "outcome": "replaced",                // or "already_applied", "superseded"
  "placeId": "a41e…",
  "contactId": "c0ff…",
  "previousContactId": "9ab2…",
  "affectedPlaceIds": ["a41e…"],        // every place handed over by this request
  "retiredUsers": ["mary_atieno"],      // outgoing accounts left with no places, now retired
  "username": "grace_owino",
  "places": ["a41e…"],                  // every place the incoming account now holds
  "password": "<generated>"             // new person only; null on a repeat if the credentials record has expired
}
```

An existing person keeps their username and password, so there are no new credentials to record.
Their device picks up the new places' data at its next sync.

**Requests that update the same account must run one after another**, never in parallel. That
means requests with the same existing incoming person, or with the same outgoing person. Otherwise
two updates of one account's place list can overwrite each other. Other requests can run in
parallel.

### Replacing in the UI

There is one replace form. The form follows the [create form](#creating-one-user-ui): same field
generation, validation before adding, and fixed ids, but no duplicate check. It adds only valid
items to the staged list.

1. **Find the place being replaced.** Pick the hierarchy levels above as usual, then search for the
   place itself by name, under the `replacement_property` label. Picking a result gives the
   `placeId`.
2. **Show what's there now**, so the user can eye-check they have the right place: the current
   person's name and phone, their username(s), and any other places they serve.
3. **Choose who takes over.** Offer this only for types with `can_assign_multiple`; otherwise it's
   always a new person.
   - **A new person** (the default): fill in their details, as when creating, with a roles picker
     when the type has several roles.
   - **Someone already here**: search people of the type by name within the caller's facilities.
     Show their name, phone, username and the places they serve now. A person without an active
     account holding the right role can be found but not picked, and the reason is shown.
4. **Choose what they take over**, only when the current person serves more than one place: "All 3
   places (Kanyakwar, Kogony, Kisian)" (the default) or "Just Kanyakwar".
5. **Change place details** if needed. They're optional and pre-filled with the current values;
   only the ones changed are sent. `generated` values show old → new (e.g. "Mary Atieno Area →
   Grace Owino Area").
6. **Say what will happen**, e.g.:
   - "Mary Atieno's account will be disabled; her record stays under Kanyakwar, with her reports";
   - "…deactivated" instead, for types that deactivate;
   - "Mary Atieno keeps Kogony and Kisian".
7. **Add to the staged list** as a `ready` `replace` item. The same form opens when editing it.
   Until the item has been sent, editing may change the place and who takes over; after that, they
   stay fixed, since a retry resumes with them. A handover that would change nothing, such as an
   existing person who already holds the place, isn't added.

### Replacing many (CSV)

1. **Template.** For each contact type, the columns are:
   - the `friendly_name` of each hierarchy level;
   - the `replacement_property`'s `friendly_name` (the place being replaced);
   - for types with `can_assign_multiple`: `Username`, to hand over to an existing person, and
     `Scope` (`all` or `place`; empty means `all`);
   - the contact properties, for a new person;
   - `Roles`, for a new person, when the type has several;
   - the place properties, all optional.

   Leave out `generated` properties. A row fills in either `Username` or the contact properties, not
   both.
2. **Upload to the staged list.** Every row becomes a `replace` item with its own `contact.id` (new
   person) or the account's contact id (existing person). Each goes through the same
   [pre-validation](#adding-from-a-csv-pre-validation) as create rows, plus:
   - Find the place being replaced by name, under the resolved parent, in the same in-memory index
     of places of the item's type.
   - Fetch the current people of all matched places in one request
     (`POST {instance}/medic/_all_docs?include_docs=true` with their ids as `keys`), plus their
     accounts, so each item can show who is being replaced and what happens to them.
   - Read the accounts of every distinct `Username` in one request (the same `_all_docs` call, with
     keys `org.couchdb.user:{username}`). This gives each account's `contact_id`, roles, places and
     whether it's `inactive`. Check them as in step 3.
   - Flag a row as `invalid` when it collides with another row, or with an item already waiting in
     the staged list: the same place, or, with `Scope` `all`, one of the outgoing person's other
     places. Only one handover of a place can happen, and uploading both would have the second undo
     the first. The user removes or corrects one of them.
3. **Fix and upload** in the list, as for create. Replace items have no warnings, so they never wait
   for confirmation. Rows that update the same account upload one after another; the rest run in
   parallel.

### Errors to report

| Condition | Report |
|---|---|
| Field values invalid | Every field error, keyed by field; nothing written |
| Place missing / wrong type | Place {id} was not found / is a {type}, not a {type} |
| Place or incoming person outside the caller's facilities | You are not allowed to manage places in this part of the hierarchy |
| Existing person offered for a type that can't share places | {type} places can only be taken over by a new person |
| Existing person has no account, several accounts, or an inactive account | {person} has no active account to take over with |
| Existing person's account lacks the roles for the type | {username} doesn't have the roles needed for {type} |
| Incoming person is already the primary contact, not through this tool | Conflict: {contact} is already the primary contact of {place} |
| This replacement was overtaken by a later one | Superseded: {place} has been replaced again since; nothing changed |
| Someone else replaced the place at the same moment | Conflict: the place changed while being replaced; review and try again |
| New person's `contact.id` used for something else | Conflict: {id} already exists and isn't a new person for {place} |
| A hook of the type refused the place | The hook's own message; the place isn't switched, and sending the same request again resumes it |
| CHT failed or unreachable | The CHT message, and that sending the same request again resumes it |

### Known issues

**Known issue in CHT.** When an account loses a place but keeps its login (it still serves other
places), CHT stops sending that place, and a device signing in afresh never gets it. But a device
that already synced it keeps its copy. The place is no longer listed, yet it still opens from a link
or a search. The copy is also frozen as it was before the handover, still showing the outgoing
person as its primary contact, until the CHT app's data on that device is cleared. Tested on CHT
5.3.1 with an offline role; whether logging out of the CHT app clears it wasn't tested. The replace preview warns about it
for every outgoing account that keeps a login. Moves have the same effect for accounts above the old
location. It could be fixed in CHT itself, for instance with purge rules that remove places a user
no longer has.

## 3. Hierarchy management

Hierarchy management changes the shape of the hierarchy, rather than who serves a place. These
operations can touch thousands of docs, so they run as **background jobs**: the request schedules
the work, and the user follows its progress. This section covers moving, merging and deleting
places.

### Moving places

Moving a place gives it a new parent. Everything under it moves too: child places, the people in
them, and their reports. For example, a community health unit moves to a different sub-county after
a boundary change. No ids change; only lineage does.

| What | Changes |
|---|---|
| **The place** | Its `parent` becomes the new parent's lineage |
| **Every place and person under it** | Their `parent` lineage, and the lineage in their `contact` field, are rewritten from the moved place up |
| **Places above it** | An ancestor whose primary contact is inside the moved branch gets that contact's new lineage |
| **Reports** | Reports created by any moved contact get the new lineage for their `contact` |
| **User accounts** | Unchanged: every account keeps its places. What changes is who can *see* the moved data. Accounts assigned to the old ancestors lose it at their next sync; accounts assigned to the new ones gain it |

#### The request

```json
{
  "moveId": "3e9a…",                        // client-chosen id for this move
  "contactType": "c_community_health_unit",
  "placeId": "0b6c…",                       // the place being moved
  "newParentId": "5f1c…"                    // the parent it moves under
}
```

As elsewhere, places are named **by id**. Finding them by name is a read-only lookup done
beforehand. Moving is available for every contact type.

The `moveId` makes scheduling **idempotent**: sending the same request again returns the job it
already created, in whatever state that job is in.

#### Checks before scheduling

Checks run when the move is added to the staged list, and again when it's scheduled:

1. **The place** exists, is of the requested type, and is within the caller's facilities.
2. **The new parent** exists, is of the type at the place's hierarchy level 1, and is within the
   caller's facilities. It must also be a parent CHT itself allows for the type: the app settings'
   `contact_types[].parents`.
3. **No loop:** the new parent can't be the place itself, or anything under it.
4. **Primary contacts stay inside their place.** A place's primary contact must be one of its own
   descendants. So a move is refused if it would take the primary contact of one of the place's
   current ancestors out from under that ancestor.
5. **No overlapping job:** refuse the move if another hierarchy job is queued or running for this
   place, any place above it, or any place under it. Two jobs rewriting the same lineage would
   overwrite each other.

A place that already has the new parent isn't an error. The move is still run, because rewriting
lineage only writes docs that are out of date. So it finishes a move that was interrupted earlier,
and writes nothing if that move was complete.

#### Showing the impact

Before the user adds the move, show what it will do, and ask for explicit confirmation:

- **How much moves:** the number of places and people under the place, counted with
  `GET {instance}/medic/_design/medic/_view/contacts_by_depth` over the keys `[placeId, 0]` to
  `[placeId, 20]`. Past a threshold (e.g. 100), say plainly that this is a large move that runs in
  the background and may take hours.
- **Who's affected:**
  - the accounts assigned to the place (`GET {instance}/api/v2/users?facility_id={placeId}`), whose
    devices will re-sync;
  - that accounts at the old ancestors will stop seeing the moved data.
- **Whether they're active:** the most recent sync of those accounts, read from their
  `connected-user-{username}` docs (`POST {instance}/medic-logs/_all_docs?include_docs=true`). A
  sync within the last 60 days means people are using it right now. Only admins can read these
  docs, so for other callers say "last sync unknown"; never present that as "inactive".
- **Old and new locations**, as full lineage names: "Kisumu › Kisumu West › Kanyakwar CHU" →
  "Kisumu › Seme › Kanyakwar CHU".

#### Running the job

Uploading a move from the staged list schedules a job; it doesn't do the move within the request.

- **The queue** is kept in Redis (see [Data storage](#data-storage)), so it survives restarts. It
  runs **one job at a time per CHT instance**. A long move on one instance never holds up another.
- **Wait until the instance can take it.** Before starting, read
  `GET {instance}/api/v2/monitoring` and check `sentinel.backlog`. A move writes many docs, and
  each write queues work for Sentinel, the CHT service that processes changed docs. If the backlog
  is over a limit (`MAX_SENTINEL_BACKLOG`, default 7000), or the instance is down, postpone the
  job. Check again every so often (e.g. every 15 minutes), rather than waiting a fixed several
  hours.
- **Run as the user.** The job carries the user's CHT session, in the separate job token from
  [Auth](#auth). If that session has expired by the time the job runs, don't fail silently: mark
  the job `needs sign-in`. The user signs in again and resumes it, which attaches the new session.
- **Do the move** with cht-conf's hierarchy operations, the same code CHT's own tooling uses,
  rather than reimplementing lineage rewriting:
  1. `move([placeId], newParentId)` works out every changed doc, and stages them in a folder of
     their own for this job;
  2. `upload-docs` writes them to CHT in batches.

  If cht-conf is run as a command, pass the session through the environment or standard input,
  never as a command-line argument, where other processes on the server can read it. Allow a
  generous time limit (e.g. 4 hours), and enough memory for large branches (e.g. 1–2 GB), and keep
  the job's output as its log. Delete the staging folder when the job ends.
- **Check the result:** the place's `parent` is now `newParentId`. Then record the counts that
  cht-conf reports: contacts and reports updated.

**Retrying** a failed or interrupted job re-runs the same move. That's safe for the same reason as
above: only out-of-date docs are written.

#### Job status

Every job has a status the user can see, on its staged item and in a list of jobs:

| Status | Shows |
|---|---|
| `queued` | Its position in the instance's queue |
| `postponed` | Why (Sentinel backlog, instance down), and when it will check again |
| `needs sign-in` | That the user's session expired while it waited |
| `running` | Progress: docs written so far, out of the total |
| `done` | Contacts and reports updated, and how long it took |
| `failed` | The reason and the end of the log; can be retried |

#### Moving in the UI

1. **Find the place to move.** Pick the contact type, then search for the place by name within
   the hierarchy, as elsewhere. Show where it is now, and how much is under it.
2. **Find the new parent**, the way the place was found: a field for each level above the new
   parent (the type's hierarchy above level 1, as the CSV's "New …" columns), top first, then the
   new parent itself, at level 1. Each field searches under the one directly above it, and waits
   until that one is picked, so even a type too large to search whole is found (see
   [Finding places](#finding-places)). The fields start out filled in down to the current
   parent's parent, since most moves stay close: moving within the same unit only takes picking
   the new parent. Changing a level clears the ones below it. Only the caller's facilities are
   searched, and the current parent, the place itself, and anything under it can't be picked.
3. **Show the impact** (above), and have the user confirm it.
4. **Add to the staged list** as a `ready` `move` item. Uploading it schedules the job, and the item
   then shows the job's status.

#### Moving many (CSV)

1. **Template.** For each contact type, the columns are:
   - the `friendly_name` of each hierarchy level, to find the place where it is now;
   - the type's `friendly` name (the place being moved);
   - `New ` + the `friendly_name` of each hierarchy level (e.g. `New Sub County`), naming the new
     parent and the levels above it.
2. **Upload to the staged list.** Each row becomes a `move` item with its own `moveId`. Rows are
   resolved in bulk, in the same in-memory indexes used for other rows (see
   [pre-validation](#adding-from-a-csv-pre-validation)), then checked as above. The impact of each
   row is computed in the background. The list shows the total to be moved. Large moves wait in
   `needs_confirmation` until the user accepts them, individually or all at once.
3. **Flag collisions** as `invalid`: the same place twice, or a move whose new parent is itself
   being moved by another row.
4. **Upload** schedules one job per row. Jobs for overlapping branches (a place, and a place under
   it) run in the order of the file, never at the same time.

#### Errors to report

| Condition | Report |
|---|---|
| Place or new parent missing / wrong type | {id} was not found / is a {type}, expected {type} |
| Outside the caller's facilities | You are not allowed to manage places in this part of the hierarchy |
| CHT doesn't allow the parent type | {type} places can't be placed under a {parent type} |
| New parent is the place or under it | Can't move {place} under itself |
| A primary contact would leave their place | Can't move {place}: {person} is the primary contact of {ancestor} |
| Another job is working on this branch | {place} is already part of a scheduled move, merge or delete |
| Session expired while waiting | Sign in again to resume the move |
| The move failed | The cht-conf error and the end of the log; retrying is safe |

#### Known issues

**Known issues in cht-conf.** Moves use cht-conf as they are: `move-contacts` works out every doc
whose lineage changes, and `upload-docs` writes them. The app adds the checks before scheduling (cht-conf
checks the same constraints again when the job runs), the impact shown, the queue and the job's status.
- **Every moved doc is stamped.** `upload-docs` adds an `imported_date` to each doc it writes.
- **A move can be left half done.** `upload-docs` writes in batches, so a failure partway leaves
  some docs with the new lineage and some with the old. Re-running finishes it, since
  `move-contacts` stages again whatever is still out of date.

### Merging places

Merging folds one place into another of the same type. Everything under the **source** moves to
the **destination**, and the source itself is deleted. For example, two community health units
covering the same villages become one.

| What | Happens |
|---|---|
| **Places and people under the source** | Move under the destination, with their lineage rewritten as in a [move](#moving-places) |
| **The source place** | Deleted. None of its own properties are carried over |
| **The source's primary contact** | Merged into the destination's primary contact: deleted, and reports about them reassigned to the destination's primary contact. If the destination has no primary contact, they move under it as an ordinary person instead |
| **Reports about the source** | Reassigned to the destination: `patient_id`, `patient_uuid`, `place_id` and `place_uuid`, at the top level and in `fields` |
| **Reports created by moved contacts** | Get the new lineage, as in a move |
| **Accounts at the source** | Lose it. An account left with no places is retired (see below) |

#### The request

```json
{
  "mergeId": "71c2…",                       // client-chosen id for this merge
  "contactType": "c_community_health_unit",
  "sourceId": "0b6c…",                      // merged away and deleted
  "destinationId": "a41e…"                  // kept, and receives everything
}
```

As with a move, the client-chosen id makes scheduling idempotent: the same request returns the same
job.

#### Checks before scheduling

1. **Both places** exist, are of the requested type, and are within the caller's facilities.
2. **They're different places**, and the destination isn't under the source.
3. **Primary contacts stay inside their place**, as for a move.
4. **No overlapping job** is queued or running for either place's branch, as for a move.

The two places don't need the same parent. Merging across parents moves the source's contents to
wherever the destination is.

#### Showing the impact

A merge deletes data and can't be undone, so show exactly what it will do, and have the user
confirm by typing the source's name:

- how many places and people move from the source to the destination;
- that the source is deleted, and which of its properties will be lost (e.g. its code), shown next
  to the destination's;
- which primary contact is merged into which, and that the source's primary contact is deleted;
- which accounts at the source lose it, and which of them will be retired;
- when those accounts last synced, as for a move;
- the destination's full location, e.g. "Kisumu › Seme › Kanyakwar CHU".

#### Running the job

It runs as a background job exactly like a [move](#running-the-job): the same queue, waiting for
the instance to have capacity, running with the user's session, and [status](#job-status). What it
does:

1. **Work out the changes** with cht-conf's hierarchy operations:
   `merge([sourceId], destinationId)`, merging primary contacts.
2. **Write them in a safe order**:
   1. rewritten reports;
   2. moved places and people;
   3. the deleted source primary contact;
   4. the deleted source, **last of all**.

   While the source still exists, an interrupted job can simply be re-run. If the source is
   already gone, a re-run finishes by working from what's still recorded under the source's id.
   Every doc keeps its ancestors' ids in its own lineage, so
   `GET {instance}/medic/_design/medic/_view/contacts_by_depth?key=["<sourceId>"]` still finds it.
3. **Then retire accounts** at the source, the same way as in [Replace](#settings-that-apply):
   - remove the source from each account's places;
   - disable or deactivate an account left with none, per `deactivate_users_on_replace`.

   Do this after the docs are written, never before, so a failed job never leaves people locked
   out of a place that still exists.
4. **Record the merge on the destination**: append
   `{ "source": sourceId, "sourceName": …, "sourcePrimaryContact": …, "tool": …, "username": …, "merged_time": … }`
   to its `user_attribution.merges`. That way you can still tell what was merged into it.

### Deleting places

Deleting removes a place, everything under it, and the data about it. For example, a unit set up
by mistake, or one that no longer exists.

| What | Happens |
|---|---|
| **The place, and every place and person under it** | Deleted |
| **Reports about any of them** | Deleted: every report whose subject (`patient_id`, `patient_uuid`, `place_id` or `place_uuid`) is a deleted contact |
| **Reports created by them about others** | Kept, still pointing at the deleted creator |
| **Accounts at any deleted place** | Lose it. An account left with no places is retired (see below) |

#### The request

```json
{
  "deleteId": "c4d1…",                      // client-chosen id for this delete
  "contactType": "c_community_health_unit",
  "placeId": "0b6c…"                        // deleted, with everything under it
}
```

#### Checks before scheduling

1. **The place** exists, is of the requested type, and is within the caller's facilities.
2. **No overlapping job** is queued or running for its branch, as for a move.
3. **No primary contact would be lost from above.** Refuse the delete if one of the place's
   ancestors has a primary contact inside the branch being deleted. That ancestor would be left
   pointing at a deleted person.

#### Showing the impact

Deleting is permanent, so the confirmation step is the strictest in the app:

- the number of places and people to be deleted, and the number of reports (counted from
  `medic-client/reports_by_subject` for the deleted contacts);
- every account assigned to a deleted place, and which of them will be retired;
- when those accounts last synced, since recent syncs mean the place is still in use;
- the place's full location.

The user confirms by typing the place's name.

#### Running the job

It runs as a background job exactly like a [move](#running-the-job). What it does:

1. **Work out the changes** with cht-conf's hierarchy operations: `delete([placeId])` (the
   `delete-contacts` action), which stages a deletion for every doc in the job's own folder.
2. **Keep a copy first.** Before deleting anything, save every staged doc, in full (contacts and
   reports), to an archive on disk or in object storage, recorded on the job and kept for a set time
   (e.g. 30 days, see [Data storage](#data-storage)). CouchDB deletions keep only a tombstone, so
   without this there's no way back from a mistake.
3. **Delete in a safe order**:
   1. reports;
   2. the deepest places and people, working upwards;
   3. the place itself, **last of all**.

   An interrupted job is re-run the same way as a merge: from the place while it exists, and from
   what's still recorded under its id once it's gone.
4. **Then retire accounts** at every deleted place: remove the deleted places from each account,
   and disable or deactivate an account left with none, per `deactivate_users_on_replace`. As with
   a merge, never before the docs are deleted.

#### Undoing a delete

While its archive is kept, a finished delete can be undone. The undo is a job of its own, a
**restore**, in the same queue, with the same wait for Sentinel, the user's session and the same
overlap rule.

1. **Check first.** The delete must be done and its archive still kept. The place it was under must
   still exist. None of the archived ids can be in use again; if one is, restoring would overwrite a
   newer doc.
2. **Confirm.** Show how many contacts and reports come back, and where. List the accounts the
   delete affected:
   - accounts that kept a login, and only lost the deleted places, get them back;
   - disabled accounts can't simply be switched back on, because CHT deleted their login, password
     included. Ask whether to recreate their logins, each time.
3. **Write the docs back** with cht-conf's `upload-docs`, from the archive, each doc as it was but
   without its old revision: the deletion is the doc's latest revision, and a new one goes on top.
4. **Then the accounts.** Give accounts with a login their places back. If asked, recreate each
   disabled account's login from what CHT kept of it (its user settings: roles, places, person,
   name and phone), with a new password in the credentials record, as for a new login. CHT keeps
   the disabled account's settings under its old username, so the new login gets that username
   with a number added, as for any taken username.

The delete records the accounts at its places before anything changes, so the undo knows them. The
restore's id comes from the delete's, so asking to undo again returns the same restore.

#### Merging and deleting in the UI and CSV

Both follow [moving](#moving-in-the-ui): find the place(s) by name, show the impact, confirm, and
add a `merge` or `delete` item to the staged list. Uploading it schedules the job, and the item
then shows the job's status. Because both destroy data, typing the name to confirm is required for
every item, including items from a CSV. Bulk confirmation is not offered for them.

CSV templates:
- **Merge:** the hierarchy columns and the type's `friendly` name for the source, then `Into ` +
  the same columns for the destination (e.g. `Into Sub County`, `Into Community Health Unit`).
- **Delete:** the hierarchy columns and the type's `friendly` name for the place.

Flag rows as `invalid` when they collide: the same place twice, a place both merged and deleted, a
merge whose destination is itself being merged or deleted, or a delete of a place that's the
destination of a merge.

#### Errors to report

| Condition | Report |
|---|---|
| Place missing / wrong type | {id} was not found / is a {type}, expected {type} |
| Outside the caller's facilities | You are not allowed to manage places in this part of the hierarchy |
| Merging a place with itself, or into one under it | Can't merge {source} into {destination} |
| A primary contact would be lost | Can't {merge/delete} {place}: {person} is the primary contact of {ancestor} |
| Another job is working on this branch | {place} is already part of a scheduled move, merge or delete |
| Session expired while waiting | Sign in again to resume |
| The job failed | The cht-conf error and the end of the log; retrying is safe |

#### Known issues

**Known issues in cht-conf, for merges.** Merges use cht-conf as it is: `merge-contacts
--merge-primary-contacts --disable-users` works out every change, and `upload-docs` writes them. The
app adds the checks before scheduling, the impact shown, a copy of every doc the merge changes or
deletes (kept like a delete's archive, before anything is written), recording the merge on the
destination, the queue and the job's status. Until cht-conf changes:
- **No safe order.** The staged changes are written in the order the files are listed. The source
  may be deleted before everything under it has moved.
- **Accounts go first, and are always disabled**, as for deletes.
- **An interrupted merge can't be finished** once the source is gone: `merge-contacts` looks it up
  first. The app finishes the job only when its record shows the upload already ran, and then only
  records the merge.
- **Reports are reassigned by `_id` only**, as for deletes.

**Known issues in cht-conf.** Every hierarchy operation uses cht-conf as it is: `delete-contacts`
works out the deletions, and `upload-docs --disable-users` writes them and handles the accounts. The
app adds only the checks before scheduling, the impact shown, the archive, the queue and the job's
status. So until cht-conf changes, deletes have these issues, and they should be fixed in cht-conf
rather than worked around here:
- **No safe order.** `upload-docs` writes the staged deletions in the order the files are listed,
  not reports first and the place last, as [Running the job](#running-the-job-2) asks.
- **Accounts go first.** `--disable-users` updates and disables the accounts before it writes any
  deletion. A failure partway through leaves people locked out of places that still exist.
- **Accounts are always disabled.** `deactivate_users_on_replace` isn't read, so types that should
  deactivate retired accounts get them disabled.
- **An interrupted delete can't be finished.** `delete-contacts` looks the place up first, and stops
  if it's already gone. So a job that fails after the place is deleted leaves the rest of the branch
  behind. The app finishes the job only when its record shows the upload already ran.
- **Reports are found by `_id` only.** A report whose subject is a person's short code
  (`patient_id`), rather than their `_id`, isn't deleted with them. The impact count uses the same
  rule, so it matches what's deleted.
- **Its summary miscounts.** `delete-contacts` logs "undefined contact(s)"; the app counts from the
  staged docs instead.
- **Report files in its working folder.** `upload-docs` writes `upload-docs.<time>.log.json` to the
  current folder. The app runs each action in the job's own folder, and removes it afterwards.
- **Restored docs aren't quite as they were.** `upload-docs` stamps every doc it writes with an
  `imported_date`, including docs restored from an archive.
- **Logins can't be restored.** Disabling an account deletes its CHT login, but CHT keeps its
  settings, so the old username stays taken. An undo can only recreate the login under a new
  username (the old one with a number added), with a new password. People need to be told their
  new login.
