#!/bin/bash
# Build the web page and run every Orca scenario against it and against the terminal client (T63).
#   web/at/run-all.sh <out-dir> [--chrome <path>]
# Needs start-stack.sh to have been run in this session (same ZURV_AT_DIR). Exits 1 if any scenario fails.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HARNESS="$(cd "$HERE/../.." && pwd)"
OUT="${1:?usage: run-all.sh <out-dir> [--chrome path]}"; shift
mkdir -p "$OUT"
PAGE="$OUT/zurvival-playable.html"
node "$HARNESS/web/build-web.mjs" "$OUT/bundle.js" --minify >/dev/null
node "$HARNESS/web/build-html.mjs" "$OUT/bundle.js" "$HARNESS/../../content" "$PAGE" >/dev/null
rc=0
for s in web-turn web-dialogs web-dialog-trap web-settings web-run-over; do
  node "$HERE/orca-run.mjs" web "$HERE/scenarios/$s.json" "$OUT/$s.md" --page "$PAGE" "$@" || rc=1
done
node "$HERE/orca-run.mjs" cli "$HERE/scenarios/cli-screen.json" "$OUT/cli-screen.md" --harness "$HARNESS" || rc=1
exit $rc
