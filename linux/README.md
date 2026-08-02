# Linux: making "Open in local terminal" actually open a terminal

By default, most Linux desktops have nothing registered to handle
`ssh://` links at all -- clicking one just does nothing useful, the same
out-of-the-box behavior as Windows without a handler registered (see
`../windows/` for that side). This registers `ssh://` links (what
Settings -> "Open in local terminal" -> **System default** generates) to
open in whichever terminal emulator you have.

## Setup

```bash
# 1. Copy the handler script somewhere permanent and make it executable
mkdir -p ~/.local/bin
cp ssh-protocol-handler.sh ~/.local/bin/
chmod +x ~/.local/bin/ssh-protocol-handler.sh

# 2. Install the .desktop file, editing the Exec path to your actual
#    username/home directory first
mkdir -p ~/.local/share/applications
sed "s#/home/YOURUSERNAME#$HOME#" pi-fleet-ssh-handler.desktop \
  > ~/.local/share/applications/pi-fleet-ssh-handler.desktop

# 3. Refresh the desktop database and register it as the default ssh: handler
update-desktop-database ~/.local/share/applications
xdg-mime default pi-fleet-ssh-handler.desktop x-scheme-handler/ssh
```

Test it directly without even opening the browser:

```bash
xdg-open "ssh://pi@192.168.1.50:22"
```

If a terminal opens and runs `ssh pi@192.168.1.50 -p 22`, it's wired up
correctly -- "Open in local terminal" in the dashboard will now do the
same thing.

## Which terminal opens?

The script tries, in order: `x-terminal-emulator` (Debian/Ubuntu's own
alternatives system -- usually already pointing at whatever your distro
considers default), `gnome-terminal`, `tilix`, `konsole`,
`xfce4-terminal`, `alacritty`, `kitty`, `xterm`. Whichever is first
found and installed wins. Reorder the list in
`ssh-protocol-handler.sh` if you want a different one prioritized.

## Troubleshooting

- **Nothing happens when you click the link**: run the `xdg-open` test
  command above directly in a terminal -- it'll print any error instead
  of failing silently inside the browser.
- **"No terminal emulator found"**: none of the terminals the script
  tries are installed; add yours to the `for term in ...` list in
  `ssh-protocol-handler.sh`.
- **Some other app already claims `ssh://`**: `xdg-mime default` silently
  replaces whatever was registered before. Check the current handler
  with `xdg-mime query default x-scheme-handler/ssh` if you want to
  confirm before overwriting it.
