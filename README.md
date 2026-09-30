# CHT-IAM (web)

The CHT user management tool: a SvelteKit app implementing [`APP.md`](docs/APP.md) (the design), with
[`docs/api-contract.md`](docs/api-contract.md) (the HTTP API) and
[`docs/frontend-contract.md`](docs/frontend-contract.md) (the screens). It replaces the earlier
Fastify app; that app's README, deployment values and example settings are kept for reference in
[`docs/legacy/`](docs/legacy).

```sh
cp .env.example .env   # fill in the keys and REDIS_URL; DEPLOYMENT_DIR names the deployment's folder
docker run -d --rm --name cht-iam-redis -p 6379:6379 redis:7-alpine redis-server --appendonly yes
npm install
npm run dev            # http://localhost:$PORT (default 3000)
npm test               # unit tests, against an in-memory CHT and a local fake CHT server
REDIS_TEST_URL=redis://localhost:6379 npm test   # also runs the Redis store tests (in their own namespace)
npm run check          # type check
npm run build && npm start
```

`PORT` comes from the environment, or else from `.env`, in development (`npm run dev`, `npm run preview`)
and production (`npm start`, which loads `.env` when it exists) alike. If the port is taken, the server
stops with an error rather than moving to another one.

## Docker

With Compose, the app and its Redis together:

```sh
docker compose up -d --build
```

It reads `.env`, and sets `REDIS_URL` and the container's port itself. The app is published on
`PORT` (3000). Redis stays inside the Compose network, with append-only persistence on the
`redis-data` volume, so it doesn't clash with `docker-compose.redis.yml`'s Redis on 6379. The
deployment, and with it the instances offered, is the folder `DEPLOYMENT_DIR` names in `.env`. To offer
`CHT_DEV_INSTANCE`, which production ignores, start it with `NODE_ENV=development`.

Or the image on its own:

```sh
docker build -t cht-user-management .
docker run -d -p 3000:3000 --env-file .env \
  -v cht-user-management-data:/app/data \
  cht-user-management
```

- **Settings** come from the environment (`--env-file`), as listed in `.env.example`. None are baked
  into the image. `REDIS_URL` must be reachable from the container, for example
  `docker-compose.redis.yml`'s Redis on the same network. `NODE_ENV=production` is set in the image,
  so `CHT_DEV_INSTANCE` is ignored there.
- **Deployment:** the folders in `config/deployments/` are in the image, and `DEPLOYMENT_DIR` names
  one, eg. `config/deployments/chis-ke`. For another deployment, mount its folder and name that.
- **`/app/data`** holds the archives of deleted and merged docs (`ARCHIVE_LOCATION`). Keep it on a
  volume so undoing a delete survives restarts. Job working folders go in `/tmp` (`JOB_WORK_DIR`).
- It runs as the `node` user, on `PORT` (3000). Its health check is `GET /api/v1/config/instances`.
- Background jobs run cht-conf in child processes of the same container, so allow it the memory of
  the largest job (`CHT_CONF_HEAP_MB`, 2 GB by default).

## What's implemented

| Area | Endpoints | Status |
|---|---|---|
| Auth (`APP.md` → Auth) | `GET /api/v1/config/instances`, `POST /api/v1/auth/login`, `POST /api/v1/auth/sso`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/session` | Done |
| Staged list (`APP.md` → Staged list) | `GET/POST/DELETE /api/v1/staged-items`, `GET/PATCH/DELETE /api/v1/staged-items/{id}`, `POST …/{id}/confirm`, `POST …/confirm`, `POST …/upload`, `POST …/csv`, `GET /api/v1/credentials`, `GET /api/v1/credentials/export` | `create` and `replace` items; no event stream yet (the page polls) |
| Config and lookups | `GET /api/v1/config/contact-types`, `GET …/{name}/csv-template?kind=create`, `GET /api/v1/places/search`, `GET /api/v1/places/{id}`, `POST /api/v1/checks/duplicates` | Done |
| Pages | `/login`; `/`, the staged list; `/create` (choose a type, add, `?item=` to edit and fix, or `?person=` for another place for the same person); `/replace` (a new or existing person, all or one place, `?item=` to edit); `/create/csv` (create or replace files). Every page under `src/routes/(app)` requires a session | Done, including one person with several places, from the form or from CSV rows whose person looks the same |
| Create, replace | `PUT /api/v1/places/{placeId}`, `PUT /api/v1/places/{placeId}/primary-contact`, `POST /api/v1/places/batch` | Done: replace follows `APP.md` (new or existing person, `scope`, the new login before the old accounts are retired) |
| Move, merge and delete (hierarchy jobs) | `PUT/GET /api/v1/hierarchy-jobs/{jobId}`, `GET /api/v1/hierarchy-jobs`, `POST …/resume`, `GET …/log`, `GET …/archive`, `POST /api/v1/preview` (`kind: "delete"`) | Done, with cht-conf (see below) |
| Replace lookups | `GET /api/v1/places/{id}` (with who is there now), `GET /api/v1/people/search`, `POST /api/v1/preview` (`kind: "replace"`) | Done |
| Credentials | `GET /api/v1/upload-log` | Early version: to become `/api/v1/credentials` |

## Hierarchy jobs

Moving, merging and deleting places run as background jobs (`src/lib/server/hierarchy/`). Every server runs the job
runner; a Redis lock keeps it to one job at a time per CHT instance. The work is cht-conf's own
(`move-contacts`, `merge-contacts --merge-primary-contacts --disable-users` or
`delete-contacts --disable-users`, then `upload-docs`), run by `scripts/cht-conf-job.cjs` in a
child process per action, in the job's own folder under `JOB_WORK_DIR`, with the CHT session on
standard input. Before anything is deleted, a full copy of every staged doc goes to
`ARCHIVE_LOCATION` (default `data/archives`), downloadable from the job for `ARCHIVE_TTL`. While it's kept, the delete can be undone from the Jobs page: a
`restore` job writes the archive back with cht-conf's `upload-docs`, returns places to accounts that kept a
login, and, if asked, recreates the disabled accounts' logins with new passwords. Jobs wait
while CHT's Sentinel backlog is over `MAX_SENTINEL_BACKLOG`, and ask for sign-in when the session
they carry has expired. cht-conf's known shortcomings are listed in `APP.md` → Deleting places →
Known issues.

## Auth

- **Sign in** with a password (`/auth/login`) or an SSO access token (`/auth/sso`), against one of the
  deployment's instances. Browsers get an `HttpOnly` cookie, `cht_iam_session`; send
  `"deliver": "token"` to get the token in the body instead, for machine clients to send as
  `Authorization: Bearer <token>`.
- **Tokens** are encrypted JWEs (`dir` + `A256GCM`), holding the session record from `APP.md`. The
  CouchDB `AuthSession` inside can't be read or altered. Session and job tokens use separate keys, so
  one can't be used as the other.
- **Sign out** revokes the token in Redis until it would have expired, so a copied token stops working.
- **When CHT rejects the stored session** (an expired or malformed `AuthSession`), any endpoint
  answers `401 SESSION_EXPIRED` and clears the cookie.
- Admission checks: admins (and `ALLOW_ADMIN_LOGIN`), the nine required permissions, a facility,
  and CHT 4.9.0 or later (`MIN_CHT_VERSION` in `src/lib/server/auth/cht-login.ts`).

## Layout

- `src/lib/server/auth/` — sign-in against CHT (`cht-login.ts`), tokens, revocation, and request authentication
- `src/lib/server/settings.ts` — all configuration, validated at startup
- `src/lib/server/runtime.ts` — the shared Redis connection, and the services built on it
- `src/lib/server/places/` — the create, replace and batch operations
- `src/lib/validation/`, `src/lib/config-types.ts` — property validators and the contact-type shape, **shared by the server and the browser**, so both check with exactly the same rules
- `src/lib/server/cht/client.ts` — CHT HTTP client; the `Cht` interface is faked in tests (`testing/fake-cht.ts`)
- `src/lib/server/config.ts` — reads the deployment's folder, named by `DEPLOYMENT_DIR`, at startup:
  its contact types, logo and each type's hooks
- `config/deployments/<deployment>/` — one folder per deployment: `config.json` (contact types),
  `instances.json` (CHT instances, with Kenya's SSO origins), a logo, and the hook scripts its types
  list in `hooks` (Kenya's `hooks/`: unit names, and the facility fields copied onto CHP areas)
- `src/routes/api/v1/` — thin HTTP handlers
