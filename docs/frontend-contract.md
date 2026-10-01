# CHT-IAM Frontend Contract

The frontend of the CHT-IAM tool, as a consumer of the API in [`api-contract.md`](api-contract.md).
For each screen, it defines what the user sees, which API calls it makes and in what order, and
how it reacts to each response.

[`APP.md`](APP.md) is the design and owns the rules; the API contract owns the request and
response shapes. Neither is repeated here. This document isn't tied to a framework: it
describes screens, state and calls, not components.

---

## 1. Rules every screen follows

1. **The API is the only backend.** The frontend never calls CHT directly, and keeps no copy of the
   CouchDB session.
2. **Nothing is written from a form.** Every form, for every operation, adds an item to the
   [staged list](#4-staged-list), and writing to CHT happens only when the user uploads from the
   list ([APP.md → Staged list](APP.md#staged-list)).
3. **Validate before adding.** Every field is validated as the user fills it in, with the
   [shared validation module](api-contract.md#4-shared-validation), and "Add to list" stays disabled
   until the whole form is valid. That includes the checks that need CHT data (duplicates, eligible
   people, impact), which run as read-only lookups before adding. A field error coming back from the
   API on an add is a bug: show it next to the field, and report it.
4. **Ids are made in the browser, once.** When a form opens it generates its ids (`placeId`,
   `contact.id` or `jobId`), and they stay with the item from then on. A double click or a retry
   therefore repeats the same request rather than creating a second one.
5. **One config, one version.** Load `GET /config/contact-types` at sign-in, and send its
   `configVersion` as `X-Config-Version` on every write. On `409 CONFIG_CHANGED`, reload the config,
   re-validate the open form, and ask the user to check it before trying again.
6. **Names in, ids out.** Every place or person field is a search box that stores the **id** of the
   result picked. Typed text alone never counts as filled in.

---

## 2. Signing in and out

- **Sign-in screen:** the deployment's logo (`GET /config/logo`, also shown in the header), an
  instance picker (`GET /config/instances`), plus username and password.
  Submit `POST /auth/login` with `deliver: "cookie"`. On success, load
  [the session and config](#3-after-sign-in), and go to the page the user was heading for.
- **Errors** show above the form, using the message for the code in the
  [auth errors](api-contract.md#auth-errors) table. `MISSING_PERMISSIONS` says the account lacks
  permissions to manage users, but not which ones.
- **SSO:** where the deployment signs users in through its identity provider, the frontend passes
  the provider's access token to `POST /auth/sso` with `deliver: "cookie"`, instead of showing the
  password form.
- **Expired sessions:** any `401` (`UNAUTHENTICATED` or `SESSION_EXPIRED`) sends the user to
  sign-in, remembering where they were. Nothing they staged is lost; the staged list lives on the
  server.
- **Sign out:** `POST /auth/logout`, then show the sign-in screen.

## 3. After sign-in

Load in parallel:
- `GET /auth/session`, for the header (user, instance) and to know whether they're an admin;
- `GET /config/contact-types`, for every form;
- `GET /staged-items?limit=1`, for the counts badge;

then open the [event stream](#12-live-updates).

The navigation offers:
- **Staged list** (the home screen, with its counts);
- **Create**, **Replace**, **Move**, **Merge** and **Delete**, each per contact type, listing only
  the types whose `actions` allow it;
- **Import CSV**;
- **Jobs**;
- **Credentials**.

---

## 4. Staged list

The home screen. Everything the user has prepared is reviewed and uploaded here.

**Data:** `GET /staged-items`, filtered by status, kind and text search, paged with `cursor`.
After that, it's kept current by `item` and `item-removed` events.

**Layout:**
- **Counts per status** across the top. Each count filters the list to that status.
- **A row per item:**
  - its kind;
  - its key fields: place name and location, and the person;
  - its status;
  - its errors or what it's waiting for;
  - for created items, the username.

  `replace` items that share an incoming or outgoing person are grouped under that person.
- **A timeline of uploads.** Items are grouped by the upload that sent them (`upload.startedAt`),
  with a rail and a dot per group:
  - **Not uploaded yet** always comes first. It holds everything that isn't `created` or
    `uploading`, including failed items.
  - Then each upload, the latest first: "Uploaded Today, 14:05", with how many it created. While
    it runs, the group reads "Uploading since…" and its dot pulses.
  - Items uploaded before uploads were recorded on items go under "Uploaded earlier", at the end.
  - Each upload group with created items has its own **Download logins** button:
    `GET /credentials/export?upload=<runId>`, or `?upload=earlier`.

  The server sends the items in that order (`uploadGroup` in the shared code), so paged-in items
  continue the last group.
- **Progress bars** while background validation or an upload runs, from `validation` and `upload`
  events: "Validating 120 of 400", "Uploading 12 of 40".

**Per item, by status:**

| Status | Shows | Actions |
|---|---|---|
| `pending`, `validating` | "Checking…" | Remove |
| `invalid` | Each error, next to the field it's about | **Fix** (opens the item's form), Remove |
| `needs_confirmation` | What it's waiting for: the duplicate warnings, the size of a large move, or "type the name to confirm" | **Confirm** (see below), Edit, Remove |
| `ready` | "Ready to upload"; for items waiting on a parent item, which one | Edit, Remove |
| `uploading` | A spinner | — |
| `created` | A key button next to the badge. It opens the username and password, hidden until **Show** (the password comes from the credentials record then), with **Copy login**. For jobs, the [job status](#9-jobs) | Add place (types with `can_assign_multiple`), Clear |
| `failed` | The reason | **Retry**, Edit (if the ids allow), Remove |

**Actions:**
- **Fix / Edit** opens the same form the item was created with, filled in from `item.request`. For a
  CSV row whose place names didn't resolve, the names from `item.raw` are pre-filled as search text.
  Saving sends `PATCH /staged-items/{id}` with the item's `revision`. On `409 REVISION_MISMATCH`,
  reload the item, show what changed, and let the user re-apply their edit.
- **Confirm:**
  - Duplicate warnings and large moves: `POST /staged-items/{id}/confirm`. With a selection, one
    **Confirm selected** (`POST /staged-items/confirm`).
  - Merges and deletes: a dialog showing the item's preview, in which the user types the place's
    name (`confirmation.expected`). Then `POST /staged-items/{id}/confirm` with `confirmName`. These
    are never bulk-confirmed; the bulk call skips them, and the screen says so.
- **Remove:** `DELETE /staged-items/{id}`, after a confirmation when the item came from a file.
- **Upload:** a primary button showing the number of `ready` items, e.g. "Upload 40". It sends
  `POST /staged-items/upload`, and then shows the upload's progress. Items not `ready` are left
  alone, and the screen says how many.
- **Retry failed:** `POST /staged-items/upload` with the failed items' ids.
- **Clear finished:** `DELETE /staged-items?status=created`.
- **Download new credentials:** `GET /credentials/export`, with the created items' place ids.

---

## 5. Shared form parts

Every form is assembled from these parts.

### Property fields
One field per property of the contact type, labelled with its `friendly_name`, and never one for
`generated` properties:

| `type` | Field |
|---|---|
| `string`, `name`, `regex` | Text. For `regex`, show `errorDescription` as a hint before any error |
| `phone` | Telephone. Show the formatted number (`formatValue`) under it once valid |
| `dob` | Date, also accepting an age in years |
| `select_one` | A single choice, with the options from `parameter` |
| `select_multiple` | Multiple choice, with the options from `parameter` |
| `none` | Whatever suits the deployment, e.g. a yes/no toggle |

Each field validates on blur and on every change after the first error (`validateValue`), and shows
its error beneath it. When the contact type has several `user_role`s, add a **Roles** picker.

### Generated preview
Each `generated` property is shown read-only, rendered live with `renderGenerated` from the current
values. When editing an existing place it shows old → new.

### Place search
A search box per hierarchy level, top level first. Each level searches
`GET /places/search?type=<that level's type>&q=…&parentId=<the level above, once picked>`,
debounced by about 250 ms. Results show the name and location; picking one stores its id and
enables the level below. Clearing a level clears everything below it, text included. When a search without a
parent returns `PARENT_REQUIRED` (a type with too many places to search whole), the box waits,
disabled, with "Choose {level above} first", until the level above is picked.

### Person search
For replacing with an existing person: `GET /people/search?type=…&q=…`. Results show the name,
phone, username and current places. Ineligible people are shown but disabled, with the reason
(`reason`: no account, several accounts, inactive account, missing role).

### Impact panel
For replace, move, merge and delete: once the form is complete, call `POST /preview` with the
request it would add, and show the effects. Refresh it when an input it depends on changes.
- Last syncs show "unknown" when `lastSyncKnown` is false, never "inactive".
- Large moves (`large: true`) get a prominent notice: "Runs in the background and may take hours."

### Typed confirmation
For merge and delete: after the impact panel, a text box asking the user to type
`preview.confirmName`. "Add to list" enables only once it matches exactly, and the typed name is
sent as `confirmName`.

---

## 6. Create

Behaviour: [APP.md → Creating one user](APP.md#creating-one-user-ui).

1. **Open** with the chosen contact type. Generate `placeId` and `contact.id`.
2. **Fill in** the parent (place search, down to level 1), the place properties, the person's
   properties, and roles if needed. The generated preview updates as they type.
3. **Check duplicates** once the `unique` place fields and the parent are valid:
   `POST /checks/duplicates`, debounced. Matches show next to the fields, with a **This is
   intended** checkbox. Ticking it sets `ignoreWarnings: true` on the request.
4. **Add to list** enables when the form is valid and every duplicate is accepted.
   `POST /staged-items` with `kind: "create"`. Then:
   - `201`: a short "Added" notice, and the form resets with **new** ids.
   - `409 WARNINGS`: show the new warnings in step 3, and wait for the user to accept them.
5. **Another place for the same person** (types with `can_assign_multiple`): a **Keep person, add
   another place** button in the "Added" notice. It resets only the place section, with a new
   `placeId` and the same `contact.id`, and keeps the hierarchy. The person section becomes a
   read-only summary, with a **Use a new person instead** link. The request sends
   `contact: { id }` without `properties`, and the same roles.
   - The staged list offers the same thing on a create item of such a type: **Add place** opens
     `/create?person=<itemId>`, with that item's person and parent pre-filled.
   - Editing one of the later places shows the person read-only too. Their details are changed on
     the item that creates them.
   - **Is this someone already staged?** For a new person, once their fields are valid:
     `POST /checks/same-person`, debounced. On a match, show "\<name\> is already in your staged
     list, for \<place\>. Is this the same person?", with:
     - **Same person: add this place to their login:** switch to the read-only person, keeping
       the place fields;
     - **Someone else with the same details:** a checkbox, which sends `newPerson: true`.

     **Add to list** waits for an answer. A `409 SAME_PERSON_STAGED` on adding shows the same
     question.

## 7. Replace

Behaviour: [APP.md → Replacing in the UI](APP.md#replacing-in-the-ui). One form for every kind of
handover.

1. **Find the place**: place search for the place itself, labelled with the type's
   `replacement_property` `friendly_name`. Then `GET /places/{placeId}`, and show what's there now:
   the current person, their accounts, and the other places they serve.
2. **Who takes over.** Shown only for types with `can_assign_multiple`, as a choice:
   - **A new person** (the default): the person's property fields, and roles if needed, with a
     `contact.id` generated when this option is chosen;
   - **Someone already here**: person search. The picked person's `id` becomes `contact.id`, and no
     properties are sent.
3. **What they take over.** Shown only when the current person serves several places: **All N
   places** (the default, listing them) or **Just this place**. This sets `scope`.
4. **Place details:** the place fields, pre-filled from the place and optional. Only changed values
   are sent.
5. **Impact panel** with `kind: "replace"`: who is retired and how, which places change hands and
   which stay, and generated old → new.
6. **Add to list:** `POST /staged-items` with `kind: "replace"`.

## 8. Move, merge and delete

Behaviour: [APP.md → Hierarchy management](APP.md#3-hierarchy-management). Each form generates a
`jobId` when it opens.

- **Move:**
  1. Find the place to move, and show where it is.
  2. Find the new parent: a place search per level above the new parent (the type's hierarchy
     levels above 1), top first, then the level-1 type. Each is disabled, with "Choose {level
     above} first", until the one directly above is picked, and searches with `parentId` set to it.
     They start out filled in from the place's current location, down to its parent's parent.
     Changing a level clears those below it. The current parent, the place itself and anything
     under it are excluded from the results.
  3. Show the impact panel.
  4. For a large move, the user ticks "I understand this is a large move".
  5. Add to list.
- **Merge:**
  1. Find the source, which is merged away.
  2. Find the destination, which is kept: place search for the same type, excluding the source.
  3. Show the impact panel, including the source's lost properties next to the destination's, and
     whose primary contact is merged into whose.
  4. Typed confirmation.
  5. Add to list.
- **Delete:**
  1. Find the place.
  2. Show the impact panel: what will be deleted, which accounts are affected, and last syncs.
  3. Typed confirmation.
  4. Add to list.

All three add a `move`, `merge` or `delete` item with `POST /staged-items`. Uploading it schedules
the job, and the item then shows the job's status.

## 9. Jobs

**Data:** `GET /hierarchy-jobs`, kept current by `job` events. Each job's row links to its detail
(`GET /hierarchy-jobs/{jobId}`).

| Status | Shows | Actions |
|---|---|---|
| `queued` | "Waiting (2nd in line)" | — |
| `postponed` | Why, and when it will check again, e.g. "The instance is busy (9,120 changes waiting). Checking again at 14:30" | — |
| `needs_sign_in` | "Your session expired while this waited" | **Sign in and resume**: sign in, then `POST /hierarchy-jobs/{jobId}/resume` |
| `running` | A progress bar from `progress` | — |
| `done` | What changed, and how long it took | For deletes, **Download archive** (`GET …/archive`) while it's kept |
| `failed` | The error and the end of the log | **Retry** (`POST …/resume`), **Full log** (`GET …/log`) |

The staged list shows the same status on the item that scheduled the job, linking here.

## 10. CSV import

Behaviour: [APP.md → pre-validation](APP.md#adding-from-a-csv-pre-validation).

1. **Choose** the kind (create, replace, move, merge, delete) and the contact type, from the types
   that allow that kind. Offer the
   template: `GET /config/contact-types/{name}/csv-template?kind=…`.
2. **Upload** the file: `POST /staged-items/csv`.
   - `400 MISSING_COLUMNS`: list the missing columns; nothing was staged.
   - `202`: go to the staged list, filtered to this file, with the validation progress bar
     running.
3. **Fix and confirm** in the staged list as usual. Rows with errors open in the same form as
   everything else.
4. **Upload** from the staged list.

## 11. Credentials

- **Screen:** `GET /credentials`. It shows place, person, username and each password behind a
  **Show** button, with **Copy** and **Download all** (`GET /credentials/export`). It also says
  when each entry expires, and that the password can't be recovered after that.
- **After an upload**, created `create` and new-person `replace` items link here, and the staged list
  offers to download the new logins together.
- Passwords are never stored in the browser: not in local storage, not in URLs. Once the screen is
  closed, only the API has them, until they expire.

---

## 12. Live updates

- **One connection:** open `GET /events` after sign-in, and keep it for the session.
- **Keeping state current:** apply `item`, `item-removed` and `job` events to what's on screen,
  replacing each resource whole, since every event carries the full resource. `validation` and
  `upload` events drive the progress bars.
- **Reconnecting:** reconnect with `Last-Event-ID`. After a long gap, re-read the list being shown.
- **Without the stream** (it failed, or is blocked): poll the list on screen every 5 seconds while a
  validation or upload runs, and job details every 15 seconds while a job isn't finished.

## 13. Errors

Map error codes to what the user sees. The `message` is the fallback for any code without its own
treatment:

| Code(s) | Shown as |
|---|---|
| `VALIDATION_FAILED` | Each error next to its field. On an add, also report the mismatch as a bug (see [rule 3](#1-rules-every-screen-follows)) |
| `WARNINGS` | The warnings next to their fields, waiting for the user to accept them |
| `CONFIRMATION_REQUIRED` | The typed-confirmation box, highlighted |
| `REVISION_MISMATCH` | "This item changed in another tab", with the new version and **Re-apply my changes** |
| `CONFIG_CHANGED` | "The configuration was updated", with the form re-validated |
| `ITEM_LOCKED`, `IDS_FIXED` | Why the item can't be changed now, and what the user can do instead (remove, and make a new one) |
| `SUPERSEDED`, `ALREADY_PRIMARY`, `CONCURRENT_MODIFICATION`, `IDEMPOTENCY_CONFLICT`, `OVERLAPPING_JOB` | On the item: what happened, with a link to the place or job involved |
| `FORBIDDEN_PLACE` | "You can't manage places in this part of the hierarchy" |
| `UPSTREAM_FAILED`, `INSTANCE_UNREACHABLE` | "CHT couldn't be reached", with **Retry**, which is always safe |
| `UNAUTHENTICATED`, `SESSION_EXPIRED` | Sign-in (see [§2](#2-signing-in-and-out)) |
| anything else | `message`, and "try again or contact support" |
