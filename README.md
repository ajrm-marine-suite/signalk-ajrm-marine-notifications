# AJRM Marine Notifications

AJRM Marine Notifications is the suite's provider-neutral alert-state broker.
Providers publish ordinary Signal K notifications under `notifications.*` and
may attach a richer AJRM envelope at `data.ajrmMarineNotifications`.

The standard notification remains independently useful to Signal K clients:

- `state` is `normal`, `alert`, `warn`, `alarm`, or `emergency`;
- `method` contains `visual` and/or `sound`;
- `message` contains the operator-facing text;
- publishing `null` at the same path clears an active notification.

The optional envelope adds stable subjects, event identity, revisions,
priority, supersession, bounded history, expiry, correlation and explicit
audio-delivery policy. Notifications owns these generic mechanics only. It
does not infer meaning from wording, vessel identity or provider-specific
state.

## Current contracts

Consumers read the broker projection from:

```text
vessels.self.plugins.ajrmMarineNotifications
```

Contract `notifications-plus-projection` version 1 contains the broker
`sessionId`, monotonic `sequence`, priority-ordered `active` entries,
newest-first `recentActivity`, the retained `history` alias, `audioSequence`
and timestamps. The complete projection is republished on a configurable
heartbeat (10 seconds by default), allowing safety consumers to fail closed if
the broker becomes unavailable or stale.

Speakable events are emitted once at:

```text
vessels.self.plugins.ajrmMarineNotifications.audio
```

Contract `notifications-plus-audio-delivery` version 1 carries the normalized
event and an `audioRequest`. AJRM Marine Audio is the delivery authority; this
plugin does not synthesize or play speech.

OpenCPN-style compact message consumers can use:

```text
vessels.self.plugins.ajrmMarineNotifications.openCpnMessages
/plugins/signalk-ajrm-marine-notifications/openCpnMessages
```

The diagnostics HTTP API exposes runtime state only. The normal user interface
is **Console → Alerts**, so this authority does not add a second diagnostics
webapp to the Signal K application menu. Restarting this plugin clears active
and recent broker state; providers must republish conditions that remain
active. Expiring alerts are removed and republished at their deadline even when
no new notification arrives.

## Responsibilities

- Notifications is the sole suite authority for alert lifecycle, ordering,
  deduplication, recent activity and delivery requests.
- Providers remain authoritative for the condition and its standard Signal K
  notification.
- Audio remains authoritative for queuing, rendering and speaker/stream
  delivery.
- Console provides the normal read-only Alerts user interface.

## Install

```bash
cd ~/.signalk
npm install git+https://github.com/ajrm-marine-suite/signalk-ajrm-marine-notifications.git#v0.7.2 --omit=dev --no-package-lock
sudo systemctl restart signalk
```

This software is a beta release and must not be relied upon as the sole means
of navigation or collision avoidance.

Development assistance: OpenAI Codex helped with code generation,
refactoring, and automated testing during the beta development cycle.

## License and commercial use

This software is licensed under the GNU Affero General Public License v3.0 or
later (AGPL-3.0-or-later). You may use, study, share, and modify it under that
licence. If you modify it and make it available to users over a network, the
corresponding source code must also be made available under the AGPL.

Commercial licensing is available by arrangement for organisations that want
different terms.
