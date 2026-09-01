# PiOps read API

A read-only HTTP API for pulling device stats into something else --
Home Assistant, Grafana, a status page, your own script. Authenticated
with its own tokens, separate from the dashboard password, and
independent of it: a token works whether or not the password gate
(Settings &rarr; Security) is turned on.

This is a different, smaller surface than the API the dashboard itself
uses internally. The internal API isn't documented or versioned -- it
can change at any time. Everything below is the stable, intentional
contract.

## What this can and can't do

- **Read-only.** Nothing here can add, edit, or remove a device, run a
  command, reboot anything, or change a setting. A leaked token exposes
  stats, nothing more.
- **No credentials exposed.** Device objects never include the SSH
  username, password, private key, or passphrase -- encrypted or not.
- **No rate limit** on these endpoints currently (unlike the dashboard's
  login endpoint). Keep that in mind if you're polling frequently from
  several tools at once.

## Creating a token

Settings &rarr; Security &rarr; API tokens &rarr; give it a label (e.g. "Home
Assistant") &rarr; **Create token**.

The token is shown exactly once, right after creation. Copy it
somewhere safe (a password manager, your automation tool's own secrets
store) -- PiOps only ever stores a one-way hash of it after that point,
the same way the dashboard password itself is stored. If you lose a
token, there's no way to retrieve it; revoke it and create a new one.

Revoking a token (the "Revoke" button next to it in that same list)
takes effect immediately.

## Authenticating requests

Send the token as a bearer token in the `Authorization` header:

```
Authorization: Bearer piops_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

A missing or invalid token gets a `401` with a JSON error body. There's
no separate API key parameter or query-string option -- header only.

## Endpoints

All paths are relative to your PiOps URL, e.g.
`http://192.168.1.50:3000/api/v1/devices`.

### `GET /api/v1/devices`

Every device, with its most recently polled stats. Returns an array
even if empty.

```bash
curl -H "Authorization: Bearer piops_xxxx..." \
  http://192.168.1.50:3000/api/v1/devices
```

```json
[
  {
    "id": "369f0efe-1776-40cc-aca2-db1932ee2863",
    "name": "Living Room Pi",
    "host": "192.168.1.104",
    "port": 22,
    "group": "Home Lab",
    "tags": [],
    "status": "online",
    "error": null,
    "cpuUsedPct": 12,
    "memory": { "totalMb": 3748, "usedMb": 812, "availableMb": 2936, "usedPct": 22 },
    "disk": { "size": "29G", "used": "6.6G", "usedPct": 23 },
    "tempC": 47.3,
    "loadAvg": { "1m": 0.15, "5m": 0.22, "15m": 0.19 },
    "uptime": "up 4 days, 15 hours, 20 minutes",
    "os": "Raspbian GNU/Linux 11 (bullseye)",
    "kernel": "5.15.32-v7l+",
    "model": "Raspberry Pi 4 Model B Rev 1.4",
    "throttled": {
      "available": true,
      "raw": "0x0",
      "underVoltageNow": false,
      "freqCappedNow": false,
      "throttledNow": false,
      "tempLimitNow": false,
      "underVoltageOccurred": false,
      "freqCappedOccurred": false,
      "throttledOccurred": false,
      "tempLimitOccurred": false
    },
    "servicesRunning": 33,
    "lastSeen": "2026-08-05T20:17:05.473Z"
  }
]
```

A device that's currently unreachable looks like this instead -- most
fields go `null` rather than being omitted, so consumers can rely on
every key always being present:

```json
{
  "id": "fc2737b3-23a8-43b2-ad2f-b21861fbd6a5",
  "name": "Offline Pi",
  "host": "192.168.1.109",
  "port": 22,
  "group": "Home Lab",
  "tags": [],
  "status": "offline",
  "error": "connect ECONNREFUSED 192.168.1.109:22",
  "cpuUsedPct": null,
  "memory": null,
  "disk": null,
  "tempC": null,
  "loadAvg": null,
  "uptime": null,
  "os": null,
  "kernel": null,
  "model": null,
  "throttled": { "available": false },
  "servicesRunning": null,
  "lastSeen": null
}
```

A device PiOps hasn't polled yet (just added, or the server just
started) has `"status": "unknown"` with the same all-`null` shape.

### `GET /api/v1/devices/:id`

A single device, same shape as one entry from the list above. `404` if
the id doesn't exist.

```bash
curl -H "Authorization: Bearer piops_xxxx..." \
  http://192.168.1.50:3000/api/v1/devices/369f0efe-1776-40cc-aca2-db1932ee2863
```

Find a device's id from the list endpoint above -- it's not shown
anywhere in the dashboard UI itself.

### `GET /api/v1/summary`

Fleet-wide counts, useful for a single at-a-glance widget rather than
pulling every device's full detail.

```bash
curl -H "Authorization: Bearer piops_xxxx..." \
  http://192.168.1.50:3000/api/v1/summary
```

```json
{ "deviceCount": 6, "online": 5, "offline": 1, "unknown": 0 }
```

## Example: Home Assistant REST sensor

Add to `configuration.yaml`, replacing the URL/token and adjusting
`value_template`/`json_attributes` for whichever device you want:

```yaml
sensor:
  - platform: rest
    name: "Living Room Pi CPU"
    resource: http://192.168.1.50:3000/api/v1/devices/369f0efe-1776-40cc-aca2-db1932ee2863
    method: GET
    headers:
      Authorization: !secret piops_api_token
    value_template: "{{ value_json.cpuUsedPct }}"
    unit_of_measurement: "%"
    json_attributes:
      - status
      - tempC
      - uptime
    scan_interval: 30
```

Put the actual `Bearer piops_xxxx...` string in `secrets.yaml` under
`piops_api_token` rather than inline here.

## Field reference

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable across renames; use this, not `name`, if you're saving a reference somewhere |
| `name` | string | |
| `host` | string | |
| `port` | number | |
| `group` | string | |
| `tags` | string[] | |
| `status` | `"online"` \| `"offline"` \| `"unknown"` | `"unknown"` means never successfully polled yet |
| `error` | string \| null | The connection error, when `status` is `"offline"` |
| `cpuUsedPct` | number \| null | 0-100 |
| `memory` | object \| null | `{ totalMb, usedMb, availableMb, usedPct }` |
| `disk` | object \| null | `{ size, used, usedPct }` -- `size`/`used` are strings as reported by `df` (e.g. `"29G"`), `usedPct` is a number |
| `tempC` | number \| null | |
| `loadAvg` | object \| null | `{ "1m", "5m", "15m" }` |
| `uptime` | string \| null | Human-readable, as reported by the device itself |
| `os`, `kernel`, `model` | string \| null | |
| `throttled` | object \| null | `{ available: false }` if the device doesn't support this (non-Pi hardware). Otherwise `{ available: true, raw, underVoltageNow, freqCappedNow, throttledNow, tempLimitNow, underVoltageOccurred, freqCappedOccurred, throttledOccurred, tempLimitOccurred }` -- the `*Now` fields are the current state, the `*Occurred` fields are "has this happened at all since last boot" |
| `servicesRunning` | number \| null | |
| `lastSeen` | string (ISO 8601) \| null | When this poll completed, not "when last online" |

Deliberately not included: SSH username, credentials of any kind, and
anything from Settings/Alerts/Backup configuration -- this is a stats
API, not a mirror of the dashboard's own internal API.
