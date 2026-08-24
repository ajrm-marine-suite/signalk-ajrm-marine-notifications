import test from "node:test";
import assert from "node:assert/strict";
import createPlugin from "../plugin/index.js";

function createApp() {
  const published = [];
  const handlers = new Set();
  return {
    published,
    app: {
      subscriptionmanager: {
        subscribe(_subscription, unsubscribes, _onError, callback) {
          handlers.add(callback);
          unsubscribes.push(() => {
            handlers.delete(callback);
          });
        },
      },
      handleMessage(_pluginId, delta) {
        published.push(delta);
      },
      setPluginStatus() {},
      error(message) {
        throw new Error(message);
      },
    },
    emit(delta) {
      assert.ok(handlers.size, "subscription handler is registered");
      for (const handler of handlers) handler(delta);
    },
    subscriberCount() {
      return handlers.size;
    },
  };
}

function valuesFrom(delta) {
  return delta.updates.flatMap((update) => update.values);
}

test("plugin publishes OpenCPN messages projection on its Signal K path", () => {
  const harness = createApp();
  const plugin = createPlugin(harness.app);
  plugin.start({ historyLimit: 20 });

  harness.emit({
    updates: [
      {
        values: [
          {
            path: "notifications.navigation.closestApproach",
            value: {
              state: "alarm",
              method: ["visual", "sound"],
              message: "Collision alarm. Medium vessel HARBOUR TUG at 9 o'clock.",
            },
          },
        ],
      },
    ],
  });

  const openCpnValue = harness.published
    .flatMap(valuesFrom)
    .map((entry) =>
      entry.path === "plugins.ajrmMarineNotifications.openCpnMessages"
        ? entry.value
        : null,
    )
    .filter(Boolean)
    .find((value) => value.messages.length > 0);

  assert.equal(openCpnValue.contract, "ajrm-marine-opencpn-messages");
  assert.equal(openCpnValue.messages.length, 1);
  assert.equal(
    openCpnValue.messages[0].message,
    "Collision alarm. Medium vessel HARBOUR TUG at 9 o'clock.",
  );
  assert.equal(openCpnValue.messages[0].severity, "danger");
});

test("plugin includes deep AJRM Marine Capture voyage-start notifications in OpenCPN messages", () => {
  const harness = createApp();
  const plugin = createPlugin(harness.app);
  plugin.start({ historyLimit: 20 });

  harness.emit({
    updates: [
      {
        values: [
          {
            path: "notifications.plugins.ajrmMarineCapture.voyage20260702.start",
            value: {
              state: "alert",
              method: ["visual", "sound"],
              message: "Voyage recording started.",
              data: {
                ajrmMarineNotifications: {
                  schemaVersion: 1,
                  provider: "ajrm-marine-capture",
                  subjectKey: "ajrm-marine-capture:voyage20260702:start",
                  eventId: "capture-start-1",
                  revision: 1,
                  lifecycle: "event",
                  timestamp: "2026-07-02T10:00:00.000Z",
                  priority: { level: "information", score: 100 },
                  supersedes: [],
                  history: { policy: "always" },
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
                  actions: [],
                  context: { voyageId: "voyage20260702" },
                },
              },
            },
          },
        ],
      },
    ],
  });

  const openCpnValue = harness.published
    .flatMap(valuesFrom)
    .map((entry) =>
      entry.path === "plugins.ajrmMarineNotifications.openCpnMessages"
        ? entry.value
        : null,
    )
    .filter(Boolean)
    .find((value) => value.messages.some((message) => message.message === "Voyage recording started."));

  assert.ok(openCpnValue);
  assert.equal(openCpnValue.messages[0].message, "Voyage recording started.");
  assert.equal(openCpnValue.messages[0].category, "voyage-capture");
});

test("plugin resolves a nested notification cleared in a whole-tree delta", () => {
  const harness = createApp();
  const plugin = createPlugin(harness.app);
  plugin.start({ historyLimit: 20 });
  harness.emit({
    updates: [{ values: [{
      path: "notifications.navigation.depthBelowKeel",
      value: { state: "alarm", method: ["visual"], message: "Depth alarm." },
    }] }],
  });

  harness.emit({
    updates: [{ values: [{
      path: "notifications",
      value: { navigation: { depthBelowKeel: null } },
    }] }],
  });

  const latest = harness.published.at(-1);
  const projection = valuesFrom(latest).find(
    (entry) => entry.path === "plugins.ajrmMarineNotifications",
  ).value;
  assert.equal(projection.active.length, 0);
  assert.equal(projection.recentActivity.length, 1);
  plugin.stop();
});

test("plugin publishes expiry without waiting for another notification", async () => {
  const harness = createApp();
  const plugin = createPlugin(harness.app);
  plugin.start({ historyLimit: 20 });
  harness.emit({
    updates: [{ values: [{
      path: "notifications.test.shortLived",
      value: {
        state: "alert",
        method: ["visual"],
        message: "Short-lived alert.",
        data: {
          ajrmMarineNotifications: {
            schemaVersion: 1,
            provider: "test-provider",
            subjectKey: "test:short-lived",
            eventId: "short-lived-1",
            revision: 1,
            lifecycle: "active",
            timestamp: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 30).toISOString(),
            priority: { level: "information", score: 200 },
            history: { policy: "on-resolve" },
            delivery: { visual: true, audio: false },
            presentation: { message: "Short-lived alert." },
          },
        },
      },
    }] }],
  });

  await new Promise((resolve) => setTimeout(resolve, 80));
  const projections = harness.published
    .flatMap(valuesFrom)
    .filter((entry) => entry.path === "plugins.ajrmMarineNotifications")
    .map((entry) => entry.value);
  assert.equal(projections.at(-1).active.length, 0);
  assert.equal(projections.at(-1).recentActivity.length, 1);
  plugin.stop();
});

test("plugin republishes the complete projection as a freshness heartbeat", async () => {
  const harness = createApp();
  const plugin = createPlugin(harness.app);
  plugin.start({ heartbeatSeconds: 1 });
  const initial = harness.published
    .flatMap(valuesFrom)
    .filter((entry) => entry.path === "plugins.ajrmMarineNotifications");

  await new Promise((resolve) => setTimeout(resolve, 1050));

  const projections = harness.published
    .flatMap(valuesFrom)
    .filter((entry) => entry.path === "plugins.ajrmMarineNotifications");
  assert.ok(projections.length > initial.length);
  assert.equal(projections.at(-1).value.contract, "notifications-plus-projection");
  plugin.stop();
});

test("restarting and stopping the plugin clean up subscriptions", () => {
  const harness = createApp();
  const plugin = createPlugin(harness.app);
  plugin.start({});
  assert.equal(harness.subscriberCount(), 1);
  plugin.start({});
  assert.equal(harness.subscriberCount(), 1);
  plugin.stop();
  assert.equal(harness.subscriberCount(), 0);
});
