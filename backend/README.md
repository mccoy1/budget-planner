# Budget planner API

A small Django API that stores each account's budgets, so they follow you
between devices. It runs on Render's free tier with a single SQLite file.
Render wipes that disk on every restart, so [Litestream](https://litestream.io)
streams the database to a Cloudflare R2 bucket and restores it on boot.

Accounts are invite-only: there is no signup endpoint. You create accounts in
the Django admin.

## Local development

```bash
cd backend
python3.11 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/python manage.py migrate
venv/bin/python manage.py createsuperuser        # your first account
venv/bin/python manage.py runserver 8500
```

Serve the frontend from the repo root on port 5500, on the **same hostname**
you call the API on (`localhost` and `127.0.0.1` are different sites to a
browser, and the session cookie is not sent across sites):

```bash
python3 -m http.server 5500     # then open http://localhost:5500
```

Dev settings allow `http://localhost:5500` and `http://127.0.0.1:5500` as
origins. Litestream isn't used locally; the database is `backend/db.sqlite3`.

Tests:

```bash
venv/bin/python manage.py test
```

## API

All endpoints except `/health` and `/api/auth/session` need a signed-in
session. Requests that change anything (POST, PATCH, DELETE) must send the
CSRF token as `X-CSRFToken`. The frontend can't read this domain's cookies,
so every `/api/auth/*` response includes the token as `csrfToken`, and
signing in or out rotates it.

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness, including a database query. No sign-in. |
| `GET /api/auth/session` | `{user, csrfToken}`; `user` is `null` when signed out |
| `POST /api/auth/login` | `{email, password}`. 401 if wrong; 429 after 10 failures on one account, for 15 minutes |
| `POST /api/auth/logout` | |
| `POST /api/auth/password` | `{currentPassword, newPassword}` |
| `GET /api/bootstrap` | Everything for the first screen: scenario list, active scenario with its data, color groups |
| `GET, POST /api/scenarios` | List (no data), or create `{name, data}` |
| `GET, PATCH, DELETE /api/scenarios/<id>` | PATCH sends `{version, name?, data?}` and gets **409** with the current copy if `version` is stale |
| `GET, PATCH /api/prefs` | `{colorGroups?, activeScenarioId?}` |
| `POST /api/import` | `{scenarios: [{name, data}], colorGroups?, activeIndex?}`. Uploads a browser's budgets; only allowed while the account has none |

Scenario `data` is the frontend's `state` object, stored as-is (up to 256 KB).
Timestamps are epoch milliseconds. Access is decided in one place,
`Scenario.objects.for_user()`, which is what sharing will extend.

## How the database survives restarts

`start.sh` is Render's start command:

1. **Restore** the latest copy from R2 into `DB_PATH`, with an integrity check.
2. **Migrate**, then create the first admin from env vars if it doesn't exist
   (`ensure_admin`; the free plan has no shell for `createsuperuser`).
3. **Run** Litestream and gunicorn side by side.
4. **On shutdown**, stop gunicorn first, force a final upload with
   `litestream sync -wait`, then stop Litestream.

Step 4 is deliberate. Litestream's own `replicate -exec` wrapper stops the app
and exits without collecting the writes from its last sync interval, about a
second. In a local drill, a save made just before a restart was lost that way,
and kept every time with this order.

If either process dies on its own, the other is stopped and the script exits
non-zero so Render restarts the service. The app never runs without
replication.

## Deploying

Everything here is a one-time setup in accounts only you can reach.

1. **R2.** In Cloudflare, create a bucket (e.g. `budget-planner-db`), then an
   R2 API token with **Object Read & Write on that bucket only**. Note the
   access key ID, secret, and your account's S3 endpoint,
   `https://<account-id>.r2.cloudflarestorage.com`.
2. **Render.** New → Blueprint, pointed at this repo; it reads `render.yaml`.
   Fill in the prompted values: the endpoint, bucket and key pair from step 1,
   and `DJANGO_ADMIN_EMAIL` / `DJANGO_ADMIN_PASSWORD` for your admin account.
3. **DNS.** Add the custom domain `api.budget.msmccoy.com` to the service in
   Render, and the CNAME record it asks for at your DNS provider. The API has
   to be on a subdomain of `msmccoy.com`: the session cookie only works
   same-site, and Safari blocks it from `*.onrender.com`.
4. **Check the boot log** for `start: no replica found; starting a new
   database` on the first boot, then `created admin`.
5. **Add `REQUIRE_REPLICA=1`** in the service's Environment tab. From then on,
   a boot that finds no replica (wrong bucket, path or key) refuses to start
   instead of quietly starting empty.
6. **Prove it survives a restart:** sign in at `/admin/`, create a user, then
   restart the service from the dashboard. The user should still be there.
7. Once the admin exists, you can delete `DJANGO_ADMIN_PASSWORD`.

To invite someone: in the admin, Users → Add, with their email and a temporary
password. They change it from the planner's menu. There's no emailed password
reset; an admin sets a new temporary password.

## Restoring a copy of the data

To inspect or recover the database without touching the running service,
restore it to a local file using the same `litestream.yml` and credentials
Render uses. You need a local `litestream` binary of the pinned version (see
`bin/install-litestream.sh`).

```bash
cd backend
export LITESTREAM_ACCESS_KEY_ID=… LITESTREAM_SECRET_ACCESS_KEY=…
export LITESTREAM_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com LITESTREAM_R2_BUCKET=<bucket>
# DB_PATH is only the config's name for the database; nothing is written there.
export DB_PATH=/opt/render/project/src/backend/data/budget.sqlite3 LITESTREAM_SOCKET=unused
litestream restore -config litestream.yml -o ./budget-copy.sqlite3 -integrity-check full "$DB_PATH"
sqlite3 ./budget-copy.sqlite3 "select name, version, updated_at from budgets_scenario;"
```

Add `-timestamp 2026-09-01T12:00:00Z` for the state at an earlier point
(a week of history is kept).

## Known limits

- **Cold starts:** the free service sleeps after 15 idle minutes. The next
  request waits for it to wake and restore, typically 30–60 seconds.
- **Exactly one instance.** Two would each restore their own copy and
  replicate it to the same place.
- **Deploys overlap briefly:** Render starts the new instance before stopping
  the old one, so an edit saved to the old one in that window can be missing
  from the new one. Deploy when nobody is editing.
- **Free instance hours** (750 a month) are per Render workspace, shared with
  any other free services in it.
