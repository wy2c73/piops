# Screenshots to capture

The main [README.md](../../README.md) references four images by exact
filename. Drop them in this folder with these exact names and they'll
render automatically on GitHub -- nothing else to wire up.

General tips for all of them:
- A browser window around 1400-1600px wide looks best; the dashboard is
  responsive but the screenshots read better a bit wider than a laptop's
  default window.
- Populate a few real (or made-up but realistic) devices first, in a mix
  of online/offline states if you can arrange it -- an all-green fleet
  looks fine but a more varied one shows off the status indicators better.
- Crop tightly to the browser viewport (no OS chrome/browser tabs) for a
  cleaner look, though either way is fine.
- PNG, not JPEG -- this is UI with text and sharp edges, JPEG compression
  artifacts show.

## card-view.png

The main dashboard in **Card View**, with at least 4-6 devices. Ideally
include:
- At least one device with the power/throttling badge showing (green "OK"
  is fine, but if you can catch a real amber/red one on actual hardware,
  even better -- it's one of this project's more distinctive features)
- A mix of groups if you've set any up, so the group chips are visible
- The top bar with the version number and device/online counts visible

## list-view.png

The same fleet, toggled to **List View**. This shows off the dense table
layout -- CPU/mem/disk/temp/uptime/OS/hardware columns all visible at
once.

## detail-view.png

Click into any device to open its detail drawer. Capture it on the
**Services** tab (shows the sortable table) or the **Ports** tab (shows
the clickable web-port links) -- whichever looks fuller on your actual
fleet. The stat boxes at the top (CPU/Memory/Disk/Temp/Uptime/Load/OS/
Kernel/Hardware/Power) should be visible.

## terminal.png

Open a device's terminal (the "Terminal" button on any card/row) and run
something innocuous (`htop`, `ls`, `uptime`, whatever) so the capture
shows real terminal content rather than an empty black box.

---

Once these four files exist here, no other changes are needed -- the
README's `<img>` tags already point at these exact paths.
