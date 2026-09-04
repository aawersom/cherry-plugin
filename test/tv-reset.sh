#!/usr/bin/env bash
# Reset the Google-TV stand (every step time-capped so a wedged adb/webview can't hang the run):
# relaunch Lampa, dismiss the native "Update available" dialog, re-forward CDP, wait for Lampa.
ADB="/d/Android/Sdk/platform-tools/adb.exe"; READY="${READY_MJS:-$TEMP/ready.mjs}"
step(){ echo "[$(date +%T)] $1"; }
for i in 1 2 3 4 5 6; do S=$(timeout 10 "$ADB" devices 2>/dev/null | grep emulator | awk '{print $2}'); [ "$S" = "device" ] && break; step "device state: ${S:-none}, waiting"; sleep 3; done
[ "$S" = "device" ] || { echo "NO DEVICE"; exit 1; }
step "force-stop";  timeout 15 "$ADB" shell am force-stop top.rootu.lampa; sleep 2
step "launch";      timeout 25 "$ADB" shell monkey -p top.rootu.lampa -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 10
step "dismiss update dialog (BACK)"; timeout 10 "$ADB" shell input keyevent KEYCODE_BACK; sleep 4
SOCK=$(timeout 10 "$ADB" shell cat /proc/net/unix 2>/dev/null | grep -o 'webview_devtools_remote_[0-9]*' | sort -u | head -1)
[ -z "$SOCK" ] && { echo "no webview socket"; exit 1; }
timeout 10 "$ADB" forward --remove-all >/dev/null 2>&1; timeout 10 "$ADB" forward tcp:9229 localabstract:$SOCK >/dev/null
step "forward → $SOCK"
for i in $(seq 1 20); do sleep 3; R=$(timeout 12 node "$READY" 2>/dev/null); echo "  try $i: $R"; [ "$R" = "object|1" ] && { echo "LAMPA READY"; exit 0; }; done
echo "Lampa did not become ready"; exit 1
