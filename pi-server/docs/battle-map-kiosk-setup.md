# Battle Map Kiosk Setup (Raspberry Pi)

How to get the 27" table screen showing `battle-map.html` full-screen,
unattended, on the same Pi that already runs the app server. This is a
step-by-step guide for you to run yourself — nothing here is something the
app or I execute remotely; it's OS/hardware setup on the Pi itself, same as
the rest of your Pi infrastructure.

Companion doc: `pi-server/docs/battle map consept.md` (your original brief).
This guide adapts it with one deliberate simplification — see
"Why not start/stop on connect?" below.

## What you're building

A second Chromium window, in kiosk mode, permanently pointed at
`http://localhost:8080/battle-map.html` (adjust the port if yours differs),
driven out the Pi's HDMI port to the 27" screen embedded in the table. It
needs no network beyond `localhost` — it's talking to the server running on
the same machine — so it comes up correctly regardless of Tailscale/Wi-Fi
state.

The existing combat/HP display (`display.html`) is a separate screen/device
with its own setup (however you're already running that today); this guide
is only for the new map screen.

## 1. Hardware

- Pi 4B, 2-4GB RAM (you already have this for the server).
- **Use HDMI0** — the port nearest the USB-C power input. Chromium kiosk
  mode has a known quirk where it can start on the "wrong" HDMI port
  otherwise; HDMI0 is the reliable one.
- Micro-HDMI → HDMI cable to the 27" screen.
- **Cooling matters.** The space behind a TV/in a table vault is often
  enclosed and warm, and the Pi is now running the server *and* decoding
  video for the kiosk at the same time. Use the official 5V/3A supply, a
  heatsink, ideally a small fan. Underpowered/overheated shows up as random
  stutter that's a pain to diagnose after the fact — worth getting right
  up front.
- Consider booting from USB/SSD instead of SD card — cheap insurance against
  corruption from a power cut (a fuse trip is the realistic failure mode
  here, not a graceful shutdown). Keep the browser cache in RAM regardless
  (`--disk-cache-dir=/dev/null`, see the Chromium flags below), so cache
  writes aren't hammering the boot media either way.

## 2. OS setup — Raspberry Pi OS Lite + a minimal Wayland compositor

Use **Raspberry Pi OS Lite**, not the full desktop image, plus a minimal
Wayland compositor whose only job is running the kiosk. Reasoning: if the
kiosk process ever dies between sessions, a full desktop environment would
show its desktop underneath — exactly the "stray Pi UI visible on the
table" you don't want. Lite + a minimal compositor means a dead kiosk just
shows black.

Current Pi OS (Bookworm) uses **Wayland/labwc**, not the old X11 stack — the
classic `xset` screen-blanking tricks from older guides don't apply here.

```bash
sudo apt install labwc chromium-browser
```

Kiosk launch command (adjust the URL/port to match your server):

```bash
chromium-browser --kiosk --ozone-platform=wayland \
  --disable-session-crashed-bubble \
  --disable-infobars \
  --noerrdialogs \
  --disable-translate \
  --disk-cache-dir=/dev/null \
  http://localhost:8080/battle-map.html
```

Flag purposes:
- `--kiosk` — full-screen, no browser chrome.
- `--ozone-platform=wayland` — needed on Bookworm's Wayland session; without
  it Chromium tries to run under XWayland compat mode, which is what causes
  the "wrong HDMI port" quirk HDMI0 above works around.
- `--disable-session-crashed-bubble`, `--disable-infobars`, `--noerrdialogs`,
  `--disable-translate` — suppress every popup/prompt Chromium might show
  (crash restore bubble, "Chromium isn't your default browser", translate
  prompts). A kiosk screen has no one to click these away.
- `--disk-cache-dir=/dev/null` — cache lives in RAM, not on the boot media.

## 3. Disable screen blanking (the Wayland-correct way)

`xset s off` / `xset -dpms` do nothing under Wayland/labwc — if you skip
this step the table will go black mid-session with no input to wake it.
Use `wlopm` (Wayland output power management) or labwc's own config instead:

```bash
wlopm --off ""   # check `wlopm --help` for your compositor's exact syntax
```

or configure it directly in labwc's `rc.xml` idle-inhibit settings — exact
syntax depends on your labwc version, worth checking `man labwc` on the Pi
itself since this is one of the areas most likely to have shifted between
OS releases.

## 4. Run it as a systemd service

Don't launch Chromium from a plain shell script at boot — it needs the
graphical session's environment (`WAYLAND_DISPLAY`, `XDG_RUNTIME_DIR`) to
find the compositor, which a bare boot script won't have. Package it as a
**systemd user service** in the graphical session instead:

`~/.config/systemd/user/battle-map-kiosk.service`:

```ini
[Unit]
Description=Battle map kiosk
After=graphical-session.target

[Service]
ExecStart=/usr/bin/chromium-browser --kiosk --ozone-platform=wayland \
  --disable-session-crashed-bubble --disable-infobars --noerrdialogs \
  --disable-translate --disk-cache-dir=/dev/null \
  http://localhost:8080/battle-map.html
Restart=on-failure

[Install]
WantedBy=graphical-session.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now battle-map-kiosk
```

## 5. Why not start/stop on connect?

Your original brief proposed having the *server* start/stop this kiosk
based on whether a player is connected (`systemctl --user start/stop`),
with a 24h inactivity timeout — solving two real problems: a boot-order
race (kiosk loading before the server is up), and Chromium memory/state
creep over a long session.

Recommendation: **skip that for now.** It would require the FastAPI server
to shell out to `systemctl` on its own host — a new class of capability
this app has never had (it has only ever read/written its own database and
static files). Both problems it solves have a simpler fix:

- **Boot race** → the systemd unit above already depends on
  `graphical-session.target`, so it starts after the graphical session is
  up. If the server isn't answering yet, `battle-map.js`'s existing SSE
  reconnect logic (same one `display.js` already relies on) just shows the
  "waiting for battle" empty state until it is — no special-casing needed.
- **Memory creep over a long session** → restart Chromium nightly via cron,
  the same pattern already used for your nightly backup cron
  (`15 4 * * *` style, see `project_pi_migration` notes):

  ```
  30 4 * * * systemctl --user restart battle-map-kiosk >> /home/scorelax/kiosk-restart.log 2>&1
  ```

Net effect: the kiosk just runs always-on, showing the "waiting for battle"
screen when nothing's active — harmless, arguably nicer than a black table
between sessions — for a fraction of the moving parts. If the always-on
idle screen turns out to actually bother you at the table, the original
connect/disconnect design is still there to revisit.

## 6. Verifying it works

- `systemctl --user status battle-map-kiosk` — confirm it's running.
- From another device on the tailnet, hit `/api?route=combat&action=create-session&battleType=pve`
  and add a participant with a position (or use the WIP page's battle-map
  test controls) — the table screen should update within a second or two,
  same as `display.html` already does.
- Reboot the Pi and confirm the kiosk comes back up on its own.
