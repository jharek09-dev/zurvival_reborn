#!/bin/bash
# Boot a real Linux accessibility stack for orca-run.mjs (T63): Xvfb on :99, a session D-Bus, the AT-SPI bus, and
# Orca writing every utterance to $ZURV_AT_DIR/orca-debug.out. Ubuntu 24.04:
#   sudo apt-get install -y --no-install-recommends orca xdotool dbus-x11 at-spi2-core speech-dispatcher \
#     python3-pyatspi gsettings-desktop-schemas xfce4-terminal xvfb
# Orca is launched with python3.12 explicitly: on an image whose /usr/bin/python3 is another minor version, the
# distro's GObject bindings (built for 3.12) fail to import and Orca dies before it starts.
set -e
export LANG=C.UTF-8 LC_ALL=C.UTF-8
AT=${ZURV_AT_DIR:-/tmp/zurv-at}
mkdir -p "$AT"
for p in Xvfb at-spi-bus-launcher at-spi2-registryd speech-dispatcher; do pkill -x "$p" 2>/dev/null || true; done
pkill -f "^python3.12 /usr/bin/orca" 2>/dev/null || true
pkill -f "^script -q -f -c python3.12" 2>/dev/null || true
sleep 1
export DISPLAY=:99
Xvfb :99 -screen 0 1280x900x24 >"$AT/xvfb.log" 2>&1 &
sleep 1
dbus-launch --sh-syntax > "$AT/dbus.env"
. "$AT/dbus.env"
gsettings set org.gnome.desktop.interface toolkit-accessibility true 2>/dev/null || true
gsettings set org.gnome.desktop.a11y.applications screen-reader-enabled true 2>/dev/null || true
/usr/libexec/at-spi-bus-launcher --launch-immediately >"$AT/atspi.log" 2>&1 &
sleep 1
rm -f "$AT/orca-debug.out"
# Orca's own preferences for the run, in a private directory (never the user's). ONE change from Orca's defaults:
# `sayAllOnLoad` off. With the null speech backend a say-all never receives its "finished speaking" callback, so a
# page-load say-all stays active FOREVER and Orca then suppresses focus presentation ("Not presenting text because
# SayAll is active") — a dialog heading that a real listener hears would be silent in the transcript.
mkdir -p "$AT/orca-prefs"
python3 - "$AT/orca-prefs/user-settings.conf" <<'PY'
import json, sys
conf = {"general": {"sayAllOnLoad": False, "pageSummaryOnLoad": True},
        "profiles": {"default": {"profile": ["Default", "default"], "sayAllOnLoad": False}},
        "pronunciations": {}, "keybindings": {}}
json.dump(conf, open(sys.argv[1], "w"), indent=1)
PY
# Orca opens its debug file block-buffered, so an utterance can sit unwritten until the NEXT event produces 8 KB
# more — every transcript then pins speech to the wrong step. Writing to a terminal makes Python line-buffer it:
# run Orca under `script`, debug file /dev/tty, and let `script -f` flush each line into the log.
script -q -f -c "python3.12 /usr/bin/orca -r -u $AT/orca-prefs --debug-file=/dev/tty" "$AT/orca-debug.out" >"$AT/orca.stdout" 2>&1 &
for i in $(seq 1 40); do grep -q "Screen reader on" "$AT/orca-debug.out" 2>/dev/null && break; sleep 0.5; done
grep -q "Screen reader on" "$AT/orca-debug.out" && echo "Orca is up — log: $AT/orca-debug.out" || { echo "Orca did not start — see $AT/orca.stdout"; exit 1; }
