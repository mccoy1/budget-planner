#!/usr/bin/env bash
# Boot sequence on Render. The disk is wiped on every restart, so the database
# is restored from R2 first and replicated back to it while the app runs.
#
#   1. restore   the latest copy from R2 (if there is one)
#   2. migrate   apply any new migrations to it
#   3. admin     create the first admin from env vars, once
#   4. run       Litestream and gunicorn side by side
#   5. stop      on SIGTERM: stop gunicorn, force a final sync, stop Litestream
#
# set -e makes any failed setup step a failed boot. That is the point: booting
# with an empty database when a real one exists would look healthy and quietly
# start a new history in R2.
set -euo pipefail
cd "$(dirname "$0")"

: "${DB_PATH:?DB_PATH must be set, and must match litestream.yml}"
LITESTREAM=./bin/litestream
CONFIG="${LITESTREAM_CONFIG:-litestream.yml}"
# litestream.yml reads this too. Unix socket paths are limited to ~100
# characters, which is why it's overridable.
export LITESTREAM_SOCKET="${LITESTREAM_SOCKET:-$(dirname "$DB_PATH")/litestream.sock}"

mkdir -p "$(dirname "$DB_PATH")"
rm -f "$LITESTREAM_SOCKET"

echo "start: restoring $DB_PATH"
"$LITESTREAM" restore -config "$CONFIG" -if-db-not-exists -if-replica-exists -integrity-check quick "$DB_PATH"

if [[ ! -f "$DB_PATH" ]]; then
  # Set REQUIRE_REPLICA=1 once the first deploy has written a replica. After
  # that, "no replica" means a wrong bucket, path or key, not a fresh start.
  if [[ "${REQUIRE_REPLICA:-0}" == "1" ]]; then
    echo "start: REQUIRE_REPLICA=1 but no replica was found. Refusing to start with an empty database." >&2
    exit 1
  fi
  echo "start: no replica found; starting a new database"
fi

python manage.py migrate --noinput
python manage.py ensure_admin
python manage.py clearsessions

# Litestream runs beside gunicorn rather than wrapping it with `replicate
# -exec`, because -exec gets the shutdown order wrong: Litestream only picks
# up new writes once a second, and on SIGTERM it stops the app and exits
# without collecting the last ones. A save made in the final second before a
# restart was lost in testing. Here the app stops first, so nothing more can
# be written, then `sync -wait` uploads everything before Litestream stops.
#
# set -m gives each child its own process group, so a signal sent to this
# script's group reaches only this script and the order below still holds.
set -m
"$LITESTREAM" replicate -config "$CONFIG" &
LITESTREAM_PID=$!
gunicorn config.wsgi --bind "0.0.0.0:${PORT:-8000}" --workers 2 --access-logfile - &
APP_PID=$!

stop_all() {
  trap - TERM INT
  echo "start: stopping the app"
  kill -TERM "$APP_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
  if kill -0 "$LITESTREAM_PID" 2>/dev/null; then
    echo "start: final sync"
    "$LITESTREAM" sync -wait -timeout 20 -socket "$LITESTREAM_SOCKET" "$DB_PATH" \
      || echo "start: final sync FAILED; the last second of writes may not be in R2" >&2
    kill -TERM "$LITESTREAM_PID" 2>/dev/null || true
    wait "$LITESTREAM_PID" 2>/dev/null || true
  fi
}

on_signal() {
  stop_all
  exit 0
}
trap on_signal TERM INT

# Serve until a signal arrives or either process dies. `sleep & wait` rather
# than a plain sleep, so a SIGTERM runs the trap immediately.
while kill -0 "$APP_PID" 2>/dev/null && kill -0 "$LITESTREAM_PID" 2>/dev/null; do
  sleep 1 & wait $! || true
done

# One of them died on its own. Without replication every new write would be
# lost at the next restart, so the app must not outlive Litestream. Exit
# non-zero so Render restarts the service.
echo "start: $(kill -0 "$APP_PID" 2>/dev/null && echo litestream || echo gunicorn) exited unexpectedly" >&2
stop_all
exit 1
