#!/usr/bin/env bash
# Cold-restart the stand when adb/webview are wedged: kill emulator + adb, boot the AVD, then
# run tv-reset.sh (launch Lampa, dismiss the update dialog, re-forward CDP, wait for Lampa).
ADB="/d/Android/Sdk/platform-tools/adb.exe"; EMU="/d/Android/Sdk/emulator/emulator.exe"
step(){ echo "[$(date +%T)] $1"; }
step "kill emulator + adb"; taskkill //F //IM qemu-system-x86_64.exe >/dev/null 2>&1; taskkill //F //IM emulator.exe >/dev/null 2>&1; timeout 15 "$ADB" kill-server >/dev/null 2>&1; sleep 3
step "boot AVD cherryRoot"; ( cd /d/Android/Sdk/emulator && ./emulator.exe -avd cherryRoot -no-snapshot-save -no-boot-anim -dns-server 8.8.8.8,1.1.1.1 -gpu swiftshader_indirect > /d/tmp/emu-boot.log 2>&1 & )
sleep 8; timeout 20 "$ADB" start-server >/dev/null 2>&1
for i in $(seq 1 40); do S=$(timeout 10 "$ADB" devices 2>/dev/null | grep emulator | awk '{print $2}'); [ "$S" = "device" ] && break; sleep 3; done
[ "$S" = "device" ] || { echo "device never came up (state=$S)"; exit 1; }
step "device up, waiting boot_completed"
for i in $(seq 1 60); do bc=$(timeout 10 "$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r'); [ "$bc" = "1" ] && break; sleep 3; done
[ "$bc" = "1" ] || { echo "boot_completed never set"; exit 1; }
step "boot complete; settle 15s"; sleep 15
exec bash "$(dirname "$0")/tv-reset.sh"
