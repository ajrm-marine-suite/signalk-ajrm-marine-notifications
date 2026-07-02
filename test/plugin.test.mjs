import test from "node:test";
import assert from "node:assert/strict";
import createPlugin from "../plugin/index.js";

function createApp() {
  const published = [];
  let handler = null;
  return {
    published,
    app: {
      subscriptionmanager: {
        subscribe(_subscription, unsubscribes, _onError, callback) {
          handler = callback;
          unsubscribes.push(() => {
            handler = null;
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
      assert.ok(handler, "subscription handler is registered");
      handler(delta);
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
