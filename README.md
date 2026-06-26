# AJRM Marine Notifications

## Version 1 baseline

`v0.5.1` preserves provider-supplied `presentation.audioMessage` and forwards it
to Audio as the spoken request text when present.

`v0.5.0` updates the diagnostics page to match the split stream model: the
status page shows broker state and audio sequence count, while actual audio
delivery remains a one-shot Signal K event at `plugins.ajrmMarineNotifications.audio`.

`v0.5.0` separates audio delivery from broker display state. The main
`plugins.ajrmMarineNotifications` projection now carries active/recent state and the
audio counter only; new speakable events are published once on
`plugins.ajrmMarineNotifications.audio`. One-shot event IDs are idempotent, so a
replayed provider notification cannot create another audio delivery.

`v0.5.0` keeps active alerts priority-ordered while sorting `recentActivity`
and the compatibility `history` projection newest-first by event timestamp.

`v0.5.0` upgrades the bundled webapp into a broker diagnostics page with
projection health, session/sequence/correlation details, provider counts, audio
delivery projection, active/recent debug cards, and raw projection JSON.

`v0.5.0` is the coordinated AJRM Marine baseline used by Boat Bootstrap before
the diagnostics page refresh.

`v0.5.0` promotes the current provider-neutral, runtime-only notification broker
as the working architecture baseline. It remains compatible with standard
Signal K notifications and does not introduce a behavioral rewrite from
`v0.5.0`.

`v0.5.0` additionally resolves extended active notifications when Signal K
represents a provider clear as standard `state: normal` while retaining the
previous extension. Explicit one-shot and resolved envelopes remain supported.

`v0.5.0` added broker session and projection sequences, canonical
`recentActivity`, structured audio delivery details, and correlation
preservation while retaining the version 1 compatibility aliases.

AJRM Marine Notifications is a broker for provider-authored Signal K notifications.

Providers continue publishing ordinary Signal K notifications:

```text
notifications.<well-known-or-source-mirrored-path>
```

The notification retains the standard `state`, `method`, and `message` fields.
The optional richer envelope is carried at `data.ajrmMarineNotifications`.

Standard Signal K clients can therefore consume the notification without knowing
about Notifications Plus:

- States remain `normal`, `alert`, `warn`, `alarm`, or `emergency`.
- Methods remain `visual` and/or `sound`.
- Active alarms are cleared by publishing `null` at the same notification path.
- Monitored values use a notification path mirroring the source path where practical.
- Well-known branches such as `notifications.collision` remain well-known.

Notifications Plus also accepts standard Signal K notifications that do not
contain the extension. It derives only generic state/method/path behavior and
does not attempt provider-specific interpretation.

The broker owns generic mechanics only:

- Priority ordering.
- Stable-subject replacement.
- Explicit supersession.
- Active, resolved, and one-shot lifecycle.
- Provider-selected history policy.
- Visual and audio delivery projections.
- Expiry, deduplication, and in-session history.
- A broker-owned clear-history operation that leaves active notifications untouched.

It does not inspect message wording, categories, MMSIs, or provider-specific states to decide meaning. A standard Signal K `null` clear resolves the subject previously associated with that notification path.
Compatibility mirrors can explicitly opt out of brokering with
`data.ajrmMarineNotifications.broker: false`; this decision belongs to the provider.

Broker state is deliberately runtime-only. Restarting Notifications Plus or
Signal K clears active, historical, and audio-delivery state. Providers can
republish conditions that are still genuinely active after startup.

Consumers read:

```text
vessels.self.plugins.ajrmMarineNotifications
```

The version 1 projection now carries broker `sessionId`, monotonic `sequence`,
`active`, canonical `recentActivity`, `history` as a compatibility alias,
`audioSequence`, and `updatedAt`.

Audio consumers read one-shot delivery events from:

```text
vessels.self.plugins.ajrmMarineNotifications.audio
```

That delivery event carries `event`, `audioRequest`, `audioSequence`, and the
broker session. It is published only when a new provider-authored event should
be spoken.

Provider `providerSessionId`, `sourceSequence`, and `correlationId` fields are
preserved end to end. For legacy notifications without a correlation ID, the
broker creates an opaque broker-local ID and marks
`correlationOrigin: "broker"`.

Delivery policy includes provider-authored `preempt`. When false, audio consumers must queue the event without interrupting audio already in progress.

Absolute thresholds may also be represented through standard Signal K
`meta.zones` and alarm-method metadata when the source owner controls that
metadata. Notifications Plus does not overwrite sensor metadata. Rate-of-change,
supersession, history, actions, and delivery freshness remain extension features.

This software is an Alpha Release and must not be relied upon for navigation or safety.

## Install

```bash
cd ~/.signalk
npm install git+https://github.com/ajrm-marine-suite/signalk-ajrm-marine-notifications.git#v0.5.1 --omit=dev --no-package-lock
sudo systemctl restart signalk
```

Enable AJRM Marine Notifications before enhanced consumers such as AJRM Marine
Companion and AJRM Marine Audio.


## Public Beta

Priority notification broker for AJRM Marine Suite apps.

Development assistance: OpenAI Codex helped with code generation, refactoring, and automated testing during the beta development cycle.
