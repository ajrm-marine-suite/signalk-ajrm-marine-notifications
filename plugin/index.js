"use strict";

const packageInfo = require("../package.json");
const openApi = require("./openApi.json");
const {
  audioDeliveryProjection,
  applyEnvelope,
  applySignalKNotification,
  brokerProjection,
  clearHistory,
  createBrokerState,
  openCpnMessagesProjection,
} = require("./lib/broker");

const PLUGIN_ID = "signalk-ajrm-marine-notifications";
const STATE_PATH = "plugins.ajrmMarineNotifications";
const AUDIO_PATH = "plugins.ajrmMarineNotifications.audio";
const OPENCPN_MESSAGES_PATH = "plugins.ajrmMarineNotifications.openCpnMessages";

module.exports = function ajrmMarineNotifications(app) {
  const plugin = {};
  let options = normalizeOptions({});
  let state = createBrokerState();
  let unsubscribes = [];

  plugin.id = PLUGIN_ID;
  plugin.name = "AJRM Marine Notifications";
  plugin.description =
    "Brokers provider-authored notification priority, lifecycle, supersession, history, and delivery.";

  plugin.schema = {
    type: "object",
    properties: {
      historyLimit: {
        type: "integer",
        title: "Maximum historical notifications",
        default: 100,
        minimum: 10,
        maximum: 1000,
      },
    },
  };

  plugin.start = (pluginOptions = {}) => {
    options = normalizeOptions(pluginOptions);
    state = createBrokerState();
    subscribe();
    publish();
    app.setPluginStatus(`Started v${packageInfo.version}`);
  };

  plugin.stop = () => {
    for (const unsubscribe of unsubscribes) {
      try {
        unsubscribe();
      } catch {
        // Best-effort during shutdown.
      }
    }
    unsubscribes = [];
  };

  plugin.registerWithRouter = (router) => {
    router.get("/status", (_req, res) => {
      res.json({
        ok: true,
        plugin: PLUGIN_ID,
        version: packageInfo.version,
        ...brokerProjection(state, { historyLimit: options.historyLimit }),
      });
    });
    router.get("/openCpnMessages", (_req, res) => {
      res.json(openCpnMessagesProjection(state, { historyLimit: options.historyLimit }));
    });
    router.post("/history/clear", (_req, res) => {
      const cleared = clearHistory(state);
      publish();
      res.json({ ok: true, cleared });
    });
  };
  plugin.getOpenApi = () => openApi;

  return plugin;

  function subscribe() {
    if (!app.subscriptionmanager?.subscribe) return;
    app.subscriptionmanager.subscribe(
      {
        context: "vessels.self",
        subscribe: [
          { path: "notifications", policy: "instant", format: "delta" },
          { path: "notifications.*", policy: "instant", format: "delta" },
        ],
      },
      unsubscribes,
      (error) => app.error(`[${PLUGIN_ID}] subscription error: ${error}`),
      handleDelta,
    );
  }

  function handleDelta(delta) {
    let changed = false;
    const audioEvents = [];
    for (const update of delta?.updates || []) {
      for (const value of update.values || []) {
        if (value.path === "notifications" && value.value && typeof value.value === "object") {
          for (const [sourcePath, notificationValue] of flattenNotificationTree(value.value)) {
            const result = applyNotification(sourcePath, notificationValue);
            changed = result.changed || changed;
            if (result.audioEvent) audioEvents.push(result.audioEvent);
          }
        } else if (value.path?.startsWith("notifications.")) {
          const result = applyNotification(value.path, value.value);
          changed = result.changed || changed;
          if (result.audioEvent) audioEvents.push(result.audioEvent);
        }
      }
    }
    if (changed) publish();
    for (const audioEvent of audioEvents) publishAudio(audioEvent);
  }

  function apply(envelope) {
    const result = applyEnvelope(state, envelope, {
      historyLimit: options.historyLimit,
    });
    return result;
  }

  function applyNotification(sourcePath, value) {
    return applySignalKNotification(state, sourcePath, value, {
      historyLimit: options.historyLimit,
    });
  }

  function publish() {
    const projection = brokerProjection(state, {
      historyLimit: options.historyLimit,
    });
    const openCpnMessages = openCpnMessagesProjection(state, {
      historyLimit: options.historyLimit,
    });
    app.handleMessage(PLUGIN_ID, {
      context: "vessels.self",
      updates: [
        {
          values: [
            { path: STATE_PATH, value: projection },
            { path: OPENCPN_MESSAGES_PATH, value: openCpnMessages },
          ],
        },
      ],
    });
  }

  function publishAudio(audioEvent) {
    const projection = audioDeliveryProjection(state, audioEvent, {
      historyLimit: options.historyLimit,
    });
    if (!projection) return;
    app.handleMessage(PLUGIN_ID, {
      context: "vessels.self",
      updates: [{ values: [{ path: AUDIO_PATH, value: projection }] }],
    });
  }
};

function normalizeOptions(value) {
  const historyLimit = Number.parseInt(value.historyLimit, 10);
  return {
    historyLimit: Number.isFinite(historyLimit)
      ? Math.min(1000, Math.max(10, historyLimit))
      : 100,
  };
}

function flattenNotificationTree(value, prefix = "notifications") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  if (
    Object.hasOwn(value, "state") ||
    Object.hasOwn(value, "method") ||
    Object.hasOwn(value, "message")
  ) {
    return [[prefix, value]];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    flattenNotificationTree(child, `${prefix}.${key}`),
  );
}
