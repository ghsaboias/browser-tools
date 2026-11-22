#!/bin/sh
# Restart browser-tools-browser only when it is genuinely dead.
#
# The old version ran a single 2s DevTools probe and restarted on any failure.
# Under load a healthy-but-busy Chromium misses 2s, so the watchdog restarted it,
# which raised the load, which made the next probe miss too: a restart storm that
# pinned the SD card (mmc_rescan blocked >120s on 2026-09-18).
#
# Rules now: never race systemd's own Restart=, and require two failed probes.
UNIT=browser-tools-browser
CHECK="/usr/bin/node $HOME/agent-tools/browser-tools/browser-start.js --check"

st=$(systemctl --user is-active "$UNIT")

case "$st" in
  activating|deactivating)
    echo "unit is $st, systemd is handling it — skip"
    exit 0
    ;;
  failed)
    # StartLimitBurst tripped. Clearing it is the watchdog's job; nothing else will.
    echo "unit failed, clearing start limit and starting"
    systemctl --user reset-failed "$UNIT"
    systemctl --user start "$UNIT"
    exit 0
    ;;
  inactive)
    echo "unit inactive, starting"
    systemctl --user start "$UNIT"
    exit 0
    ;;
esac

# Active: confirm it is really dead before touching it.
if $CHECK; then
  exit 0
fi
echo "probe 1 failed, retrying in 5s"
sleep 5
if $CHECK; then
  echo "probe 2 ok — was just slow, not dead"
  exit 0
fi

echo "browser dead (unit $st, 2 failed probes), restarting"
systemctl --user restart "$UNIT"
