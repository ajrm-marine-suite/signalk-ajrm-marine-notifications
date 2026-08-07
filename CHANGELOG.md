# Changelog

## 0.7.0

- Expire active broker entries at their deadline even when no new Signal K
  notification or HTTP request arrives.
- Process nested `null` leaves in whole-tree `notifications` deltas as standard
  Signal K clears.
- Reject stale active and resolved envelopes before applying supersession,
  source-path remapping or audio delivery.
- Make repeated `start()` calls release old subscriptions and make `stop()`
  clear both subscriptions and the expiry timer.
- Remove unused saved-state serialization scaffolding and obsolete standalone
  Alert Panel compatibility guidance.
- Remove the redundant broker diagnostics webapp; Console's built-in Alerts
  view is now the single operator-facing notification display.
- Replace the accumulated historical README with the current authority and
  contract boundaries.

## 0.6.2

- Refresh naming, architecture, and installation guidance for the current
  provider-neutral notification broker.

## 0.6.1

- Preserve the provider-owned `delivery.retainUntilDelivered` flag through
  normalized envelopes and one-shot Audio delivery requests.
- Document that retained queued audio remains subject to its provider-defined
  expiry.

## 0.5.9

- Keep the OpenCPN `announcementLog` as an announcement/event log only, so
  OpenCPN message panes do not show constantly recalculated active CPA panel
  rows as if they were new announcements.
- Increase the OpenCPN projection retention to 100 messages while leaving
  compact panel consumers free to show only the top few rows.

## 0.5.8

- Subscribe to deeper notification paths so dynamic provider leaves such as
  AJRM Marine Capture voyage-start events reach broker projections.

## 0.5.7

- Order the OpenCPN message projection newest-first.

## 0.5.6

- Publish a compact OpenCPN message projection at
  `plugins.ajrmMarineNotifications.openCpnMessages`.
- Add `/openCpnMessages` for HTTP polling fallback clients.

## 0.5.5

- Align OpenAPI metadata and install documentation with the package version.

## 0.5.4

- Update public install command to the current release tag.

## 0.5.3

- Update broker regression fixtures to use AJRM Marine Traffic subject keys.

## 0.5.2

- Update broker regression fixtures to use AJRM Marine capture subject keys.

## 0.5.1

- Preserve provider-supplied `presentation.audioMessage` and use it for audio delivery requests when present.

## 0.5.0

- Initial public beta release as AJRM Marine Notifications.
