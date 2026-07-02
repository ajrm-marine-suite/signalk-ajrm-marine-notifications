import test from "node:test";
import assert from "node:assert/strict";
import {
  audioDeliveryProjection,
  applyEnvelope,
  applySignalKNotification,
  brokerProjection,
  clearHistory,
  createBrokerState,
  openCpnMessagesProjection,
} from "../plugin/lib/broker.js";

function envelope(overrides = {}) {
  return {
    schemaVersion: 1,
    provider: "test-provider",
    subjectKey: "test:depth",
    eventId: "depth-1",
    revision: 1,
    lifecycle: "active",
    timestamp: "2026-06-18T18:00:00.000Z",
    priority: { level: "warning", score: 500 },
    history: { policy: "on-resolve" },
    delivery: { visual: true, audio: true, expiresSeconds: 90 },
    presentation: {
      title: "Depth",
      label: "Warning",
      message: "Depth is low.",
      category: "depth",
    },
    ...overrides,
  };
}

test("newer revisions replace the same subject", () => {
  const state = createBrokerState();
  applyEnvelope(state, envelope());
  applyEnvelope(
    state,
    envelope({
      eventId: "depth-2",
      revision: 2,
      presentation: { title: "Depth", label: "Danger", message: "Very low." },
      priority: { level: "danger", score: 800 },
    }),
  );

  const projection = brokerProjection(state);
  assert.equal(projection.active.length, 1);
  assert.equal(projection.active[0].eventId, "depth-2");
  assert.equal(projection.contract, "notifications-plus-projection");
  assert.equal(projection.contractVersion, 1);
  assert.equal(projection.sequence, 3);
  assert.ok(projection.sessionId);
});

test("broker preserves provider correlation and supplies it to audio requests", () => {
  const state = createBrokerState();
  const result = applyEnvelope(
    state,
    envelope({
      providerSessionId: "provider-session",
      sourceSequence: 7,
      correlationId: "provider-correlation",
    }),
  );

  const projection = brokerProjection(state);
  const audio = audioDeliveryProjection(state, result.audioEvent);
  assert.equal(projection.active[0].providerSessionId, "provider-session");
  assert.equal(projection.active[0].sourceSequence, 7);
  assert.equal(projection.active[0].correlationId, "provider-correlation");
  assert.equal(audio.audioRequest.correlationId, "provider-correlation");
  assert.equal(audio.audioRequest.sequence, 1);
  assert.equal(audio.audioRequest.requestId, `${projection.sessionId}:1`);
});

test("broker prefers provider audio message for audio requests", () => {
  const state = createBrokerState();
  const result = applyEnvelope(
    state,
    envelope({
      presentation: {
        title: "Traffic",
        label: "Traffic advisory",
        message: "Traffic advisory. Small craft 235900007 at 1 o'clock.",
        audioMessage: "Traffic advisory. Small craft at 1 o'clock.",
        category: "cpa",
      },
    }),
  );

  const projection = brokerProjection(state);
  const audio = audioDeliveryProjection(state, result.audioEvent);
  assert.equal(
    projection.active[0].presentation.message,
    "Traffic advisory. Small craft 235900007 at 1 o'clock.",
  );
  assert.equal(audio.audioRequest.message, "Traffic advisory. Small craft at 1 o'clock.");
});

test("broker creates a marked correlation identifier for legacy input", () => {
  const state = createBrokerState();
  applyEnvelope(state, envelope());
  const projection = brokerProjection(state);
  assert.match(projection.active[0].correlationId, /^broker:/);
  assert.equal(projection.active[0].correlationOrigin, "broker");
});

test("provider pre-emption policy survives broker normalization", () => {
  const state = createBrokerState();
  const result = applyEnvelope(
    state,
    envelope({
      eventId: "event-no-preempt",
      lifecycle: "event",
      delivery: {
        visual: true,
        audio: true,
        preempt: false,
        expiresSeconds: 90,
      },
    }),
  );

  assert.equal(result.audioEvent.delivery.preempt, false);
});

test("resolved subjects move to history according to provider policy", () => {
  const state = createBrokerState();
  applyEnvelope(state, envelope());
  applyEnvelope(
    state,
    envelope({
      eventId: "depth-clear",
      revision: 2,
      lifecycle: "resolved",
      delivery: { visual: false, audio: false },
    }),
  );

  const projection = brokerProjection(state);
  assert.equal(projection.active.length, 0);
  assert.equal(projection.history.length, 1);
  assert.deepEqual(projection.recentActivity, projection.history);
  assert.equal(projection.history[0].eventId, "depth-1");
  assert.equal(projection.history[0].lifecycle, "resolved");
});

test("supersedes resolves another subject before appending a one-shot event", () => {
  const state = createBrokerState();
  applyEnvelope(
    state,
    envelope({
      subjectKey: "ajrm-marine:traffic:system:gps-lost",
      eventId: "gps-lost-1",
      priority: { level: "danger", score: 900 },
    }),
  );
  applyEnvelope(
    state,
    envelope({
      subjectKey: "ajrm-marine:traffic:system:gps-received",
      eventId: "gps-received-1",
      lifecycle: "event",
      supersedes: ["ajrm-marine:traffic:system:gps-lost"],
      history: { policy: "always" },
      priority: { level: "information", score: 200 },
      delivery: { visual: true, audio: true },
    }),
  );

  const projection = brokerProjection(state);
  assert.equal(projection.active.length, 0);
  assert.deepEqual(
    projection.history.map((item) => item.eventId),
    ["gps-lost-1", "gps-received-1"],
  );
});

test("recent activity is newest first, not priority first", () => {
  const state = createBrokerState();
  applyEnvelope(
    state,
    envelope({
      eventId: "older-danger",
      lifecycle: "event",
      timestamp: "2026-06-18T18:00:00.000Z",
      priority: { level: "danger", score: 800 },
      history: { policy: "always" },
    }),
  );
  applyEnvelope(
    state,
    envelope({
      eventId: "newer-info",
      lifecycle: "event",
      timestamp: "2026-06-18T18:05:00.000Z",
      priority: { level: "information", score: 200 },
      history: { policy: "always" },
    }),
  );

  assert.deepEqual(
    brokerProjection(state).recentActivity.map((item) => item.eventId),
    ["newer-info", "older-danger"],
  );
});

test("priority controls active ordering", () => {
  const state = createBrokerState();
  applyEnvelope(state, envelope());
  applyEnvelope(
    state,
    envelope({
      subjectKey: "test:engine",
      eventId: "engine-1",
      priority: { level: "danger", score: 850 },
    }),
  );
  assert.deepEqual(
    brokerProjection(state).active.map((item) => item.subjectKey),
    ["test:engine", "test:depth"],
  );
});

test("duplicate active event IDs do not redeliver audio", () => {
  const state = createBrokerState();
  const first = applyEnvelope(state, envelope());
  const duplicate = applyEnvelope(state, envelope());
  assert.ok(first.audioEvent);
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.audioEvent, null);
});

test("duplicate one-shot event IDs do not redeliver audio or history", () => {
  const state = createBrokerState();
  const oneShot = envelope({
    eventId: "voyage-start-1",
    lifecycle: "event",
    history: { policy: "always" },
    presentation: {
      title: "AJRM Marine Capture",
      label: "start",
      message: "Voyage recording started.",
      category: "voyage-capture",
    },
  });
  const first = applyEnvelope(state, oneShot);
  const duplicate = applyEnvelope(state, oneShot);

  assert.ok(first.audioEvent);
  assert.equal(duplicate.changed, false);
  assert.equal(duplicate.audioEvent, null);
  assert.deepEqual(
    brokerProjection(state).history.map((item) => item.eventId),
    ["voyage-start-1"],
  );
});

test("standard Signal K null clears the extended active notification", () => {
  const state = createBrokerState();
  applySignalKNotification(
    state,
    "notifications.environment.depth.belowKeel",
    {
      state: "alarm",
      method: ["visual", "sound"],
      message: "Danger. Depth below keel 1.8 metres.",
      data: { ajrmMarineNotifications: envelope() },
    },
  );
  applySignalKNotification(
    state,
    "notifications.environment.depth.belowKeel",
    null,
  );
  const projection = brokerProjection(state);
  assert.equal(projection.active.length, 0);
  assert.equal(projection.history.length, 1);
});

test("standard Signal K notifications work without the extension", () => {
  const state = createBrokerState();
  applySignalKNotification(
    state,
    "notifications.propulsion.port.oilPressure",
    {
      state: "alarm",
      method: ["visual", "sound"],
      message: "Port engine oil pressure low.",
    },
  );
  const projection = brokerProjection(state);
  assert.equal(projection.active.length, 1);
  assert.equal(projection.active[0].provider, "signalk");
  assert.equal(projection.active[0].priority.level, "danger");
  assert.equal(projection.active[0].delivery.audio, true);
});

test("standard normal state resolves an active notification", () => {
  const state = createBrokerState();
  applySignalKNotification(state, "notifications.navigation.gnss", {
    state: "alert",
    method: ["visual"],
    message: "GPS signal lost.",
  });
  applySignalKNotification(state, "notifications.navigation.gnss", {
    state: "normal",
    method: ["visual"],
    message: "GPS signal normal.",
  });
  assert.equal(brokerProjection(state).active.length, 0);
  assert.equal(brokerProjection(state).history.length, 1);
});

test("standard normal state resolves an extended active notification retained by Signal K", () => {
  const state = createBrokerState();
  const activeEnvelope = envelope({
    subjectKey: "ajrm-marine:traffic:vessel:235900004",
    eventId: "collision-1",
  });
  applySignalKNotification(state, "notifications.collision.235900004", {
    state: "alarm",
    method: ["visual", "sound"],
    message: "Collision alarm.",
    data: { ajrmMarineNotifications: activeEnvelope },
  });
  applySignalKNotification(state, "notifications.collision.235900004", {
    state: "normal",
    method: [],
    message: "",
    data: { ajrmMarineNotifications: activeEnvelope },
  });
  const projection = brokerProjection(state);
  assert.equal(projection.active.length, 0);
  assert.equal(projection.history.length, 1);
});

test("blank normal clear with event envelope does not create duplicate audio", () => {
  const state = createBrokerState();
  const eventEnvelope = envelope({
    subjectKey: "ajrm-marine-capture:voyage:start",
    eventId: "voyage-start-1",
    lifecycle: "event",
    history: { policy: "always" },
    priority: { level: "information", score: 100 },
    delivery: {
      visual: true,
      audio: true,
      preempt: false,
      expiresSeconds: 45,
    },
    presentation: {
      title: "AJRM Marine Capture",
      label: "start",
      message: "Voyage recording started.",
      category: "voyage-capture",
    },
  });
  applySignalKNotification(state, "notifications.plugins.voyage.start", {
    state: "alert",
    method: ["visual", "sound"],
    message: "Voyage recording started.",
    data: { ajrmMarineNotifications: eventEnvelope },
  });
  const firstProjection = brokerProjection(state);
  const firstAudio = audioDeliveryProjection(state, firstProjection.history[0]);
  assert.equal(firstAudio.audioRequest.message, "Voyage recording started.");
  assert.equal(firstProjection.audioSequence, 1);

  const result = applySignalKNotification(state, "notifications.plugins.voyage.start", {
    state: "normal",
    method: [],
    message: "",
    data: { ajrmMarineNotifications: eventEnvelope },
  });
  const projection = brokerProjection(state);
  assert.equal(result.audioEvent, null);
  assert.equal(projection.audioSequence, 1);
  assert.equal(
    audioDeliveryProjection(state, firstProjection.history[0]).audioRequest.requestId,
    firstAudio.audioRequest.requestId,
  );
});

test("extended one-shot events may use standard normal state", () => {
  const state = createBrokerState();
  applySignalKNotification(state, "notifications.navigation.gnss", {
    state: "normal",
    method: ["sound"],
    message: "GPS signal received.",
    data: {
      ajrmMarineNotifications: envelope({
        subjectKey: "ajrm-marine:traffic:system:gps-received",
        eventId: "gps-received-1",
        lifecycle: "event",
        history: { policy: "always" },
      }),
    },
  });
  assert.equal(brokerProjection(state).history[0].eventId, "gps-received-1");
});

test("provider can explicitly exclude a compatibility notification from the broker", () => {
  const state = createBrokerState();
  const result = applySignalKNotification(
    state,
    "notifications.navigation.closestApproach",
    {
      state: "alarm",
      method: ["visual"],
      message: "Legacy compatibility notification.",
      data: { ajrmMarineNotifications: { broker: false } },
    },
  );
  assert.equal(result.changed, false);
  assert.deepEqual(brokerProjection(state).active, []);
});

test("clearHistory removes history without changing active notifications", () => {
  const state = createBrokerState();
  applyEnvelope(state, envelope());
  applyEnvelope(
    state,
    envelope({
      eventId: "depth-clear",
      revision: 2,
      lifecycle: "resolved",
      delivery: { visual: false, audio: false },
    }),
  );
  applyEnvelope(
    state,
    envelope({
      subjectKey: "test:engine",
      eventId: "engine-1",
      revision: 3,
    }),
  );

  assert.equal(clearHistory(state), 1);
  const projection = brokerProjection(state);
  assert.deepEqual(projection.history, []);
  assert.equal(projection.active.length, 1);
  assert.equal(projection.active[0].subjectKey, "test:engine");
  assert.equal(projection.sequence, 5);
});

test("OpenCPN projection exposes newest messages first", () => {
  const state = createBrokerState();
  applyEnvelope(
    state,
    envelope({
      eventId: "voyage-start",
      lifecycle: "event",
      timestamp: "2026-06-18T18:00:00.000Z",
      history: { policy: "always" },
      priority: { level: "information", score: 100 },
      presentation: {
        title: "Capture",
        label: "start",
        message: "Voyage recording started.",
        category: "voyage-capture",
      },
    }),
  );
  applyEnvelope(
    state,
    envelope({
      eventId: "collision-1",
      subjectKey: "traffic:235900005",
      timestamp: "2026-06-18T18:05:00.000Z",
      priority: { level: "danger", score: 900 },
      presentation: {
        title: "HARBOUR TUG",
        label: "Collision alarm",
        message: "Collision alarm. Medium vessel HARBOUR TUG at 9 o'clock.",
        category: "collision",
      },
      context: { mmsi: "235900005" },
    }),
  );

  const projection = openCpnMessagesProjection(state);
  assert.equal(projection.contract, "ajrm-marine-opencpn-messages");
  assert.equal(projection.messages.length, 2);
  assert.equal(
    projection.messages[0].message,
    "Collision alarm. Medium vessel HARBOUR TUG at 9 o'clock.",
  );
  assert.equal(projection.messages[0].severity, "danger");
  assert.equal(projection.messages[0].source, "active-alert");
  assert.equal(projection.messages[0].mmsi, "235900005");
  assert.equal(projection.messages[1].message, "Voyage recording started.");
  assert.equal(projection.panelEvents.entries[0].message, projection.messages[0].message);
  assert.equal(projection.announcementLog.entries.length, 2);
});

test("OpenCPN projection orders newer recent messages above older active alerts", () => {
  const state = createBrokerState();
  applyEnvelope(
    state,
    envelope({
      eventId: "older-active",
      subjectKey: "traffic:235900005",
      timestamp: "2026-06-18T18:00:00.000Z",
      priority: { level: "danger", score: 900 },
      presentation: {
        title: "HARBOUR TUG",
        label: "Collision alarm",
        message: "Collision alarm.",
        category: "collision",
      },
    }),
  );
  applyEnvelope(
    state,
    envelope({
      eventId: "newer-event",
      lifecycle: "event",
      timestamp: "2026-06-18T18:10:00.000Z",
      history: { policy: "always" },
      priority: { level: "information", score: 100 },
      presentation: {
        title: "GPS",
        label: "received",
        message: "GPS received.",
        category: "gps",
      },
    }),
  );

  assert.deepEqual(
    openCpnMessagesProjection(state).messages.map((entry) => entry.message),
    ["GPS received.", "Collision alarm."],
  );
});

test("OpenCPN projection removes duplicate message text", () => {
  const state = createBrokerState();
  applyEnvelope(
    state,
    envelope({
      eventId: "depth-active",
      subjectKey: "depth",
      presentation: {
        title: "Depth",
        label: "Warning",
        message: "Depth is low.",
        category: "depth",
      },
    }),
  );
  applyEnvelope(
    state,
    envelope({
      eventId: "depth-event",
      lifecycle: "event",
      history: { policy: "always" },
      presentation: {
        title: "Depth",
        label: "Warning",
        message: "Depth is low.",
        category: "depth",
      },
    }),
  );

  assert.deepEqual(
    openCpnMessagesProjection(state).messages.map((entry) => entry.message),
    ["Depth is low."],
  );
});
