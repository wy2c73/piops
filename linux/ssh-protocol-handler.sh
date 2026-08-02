#!/bin/bash
# Parses an "ssh://user@host:port" link -- what Settings -> "Open in
# local terminal" -> System default generates -- and opens it in a
# terminal emulator running ssh. Tries a few common ones in order since
# desktop environments vary widely; reorder the list below if you have a
# specific preference.
#
# Without this registered, most Linux desktops have nothing configured
# to handle the "ssh:" scheme at all, so the browser just treats the
# link like a broken/unknown URL -- this is normal, out-of-the-box
# behavior on most distros, not something specific to this dashboard.

set -u

uri="${1:-}"
if [[ -z "$uri" ]]; then
  echo "Usage: $0 ssh://user@host:port" >&2
  exit 1
fi

rest="${uri#ssh://}"
rest="${rest%/}" # strip a trailing slash some browsers add

if [[ "$rest" == *"@"* ]]; then
  user_part="${rest%%@*}"
  host_port="${rest#*@}"
else
  user_part=""
  host_port="$rest"
fi

if [[ "$host_port" == *":"* ]]; then
  host_part="${host_port%%:*}"
  port_part="${host_port#*:}"
else
  host_part="$host_port"
  port_part="22"
fi

if [[ -n "$user_part" ]]; then
  target="$user_part@$host_part"
else
  target="$host_part"
fi

ssh_cmd=(ssh "$target" -p "$port_part")

for term in x-terminal-emulator gnome-terminal tilix konsole xfce4-terminal alacritty kitty xterm; do
  if command -v "$term" >/dev/null 2>&1; then
    case "$term" in
      gnome-terminal|tilix)
        exec "$term" -- "${ssh_cmd[@]}"
        ;;
      *)
        exec "$term" -e "${ssh_cmd[@]}"
        ;;
    esac
  fi
done

# Nothing found -- surface an error instead of failing silently.
msg="No terminal emulator found to run: ${ssh_cmd[*]}"
zenity --error --text="$msg" 2>/dev/null || notify-send "Pi Fleet Dashboard" "$msg" 2>/dev/null || echo "$msg" >&2
exit 1
