"use strict";

const { randomUUID } = require("node:crypto");
const { normalizeEnvelope } = require("./envelope");

function createBrokerState(saved = {}) {
  return {
    sessionId: randomUUID(),
    sequence: 1,
    active: new Map(
      (Array.isArray(saved.active) ? saved.active : [])
        .map((entry) => normalizeEnvelope(entry))
        .filter(Boolean)
        .map((entry) => [entry.subjectKey, entry]),
    ),
    history: (Array.isArray(saved.history) ? saved.history : [])
      .map((entry) => normalizeEnvelope(entry))
      .filter(Boolean),
    audioSequence: Number(saved.audioSequence) || 0,
    deliveredEventIds: new Set(
      (Array.isArray(saved.deliveredEventIds) ? saved.deliveredEventIds : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    ),
    sourceSubjects: new Map(
      Object.entries(
        saved.sourceSubjects && typeof saved.sourceSubjects === "object"
          ? saved.sourceSubjects
          : {},
      ),
    ),
  };
}

function applySignalKNotification(
  state,
  sourcePath,
  notificationValue,
  { historyLimit = 100, now = Date.now() } = {},
) {
  const path = String(sourcePath || "");
  if (!path.startsWith("notifications.")) {
    return { changed: false, audioEvent: null, envelope: null };
  }

  if (notificationValue == null) {
    const subjectKey = state.sourceSubjects.get(path);
    if (!subjectKey) return { changed: false, audioEvent: null, envelope: null };
    state.sourceSubjects.delete(path);
    const changed = resolveSubject(state, subjectKey, {
      historyLimit,
      resolvedAt: new Date(now).toISOString(),
    });
    if (changed) advanceProjection(state);
    return { changed, audioEvent: null, envelope: null };
  }

  const providerExtension = notificationValue?.data?.ajrmMarineNotifications;
  if (providerExtension?.broker === false) {
    return { changed: false, audioEvent: null, envelope: null };
  }
  const stateValue = String(notificationValue?.state || "").toLowerCase();
  const methods = Array.isArray(notificationValue?.method)
    ? notificationValue.method
    : notificationValue?.method
      ? [notificationValue.method]
      : [];
  const isEmptyNormalClear =
    (stateValue === "normal" || stateValue === "nominal") &&
    methods.length === 0 &&
    String(notificationValue?.message || "").trim() === "";
  if (isEmptyNormalClear) {
    const subjectKey =
      state.sourceSubjects.get(path) || providerExtension?.subjectKey || null;
    const changed = subjectKey
      ? resolveSubject(state, subjectKey, {
          historyLimit,
          resolvedAt: new Date(now).toISOString(),
        })
      : false;
    state.sourceSubjects.delete(path);
    if (changed) advanceProjection(state);
    return { changed, audioEvent: null, envelope: null };
  }
  if (
    (stateValue === "normal" || stateValue === "nominal") &&
    (!providerExtension ||
      providerExtension.lifecycle === "active")
  ) {
    const subjectKey = state.sourceSubjects.get(path);
    if (!subjectKey) return { changed: false, audioEvent: null, envelope: null };
    state.sourceSubjects.delete(path);
    const changed = resolveSubject(state, subjectKey, {
      historyLimit,
      resolvedAt: new Date(now).toISOString(),
    });
    if (changed) advanceProjection(state);
    return { changed, audioEvent: null, envelope: null };
  }

  const extension =
    providerExtension || standardEnvelope(sourcePath, notificationValue, now);
  const result = applyEnvelope(state, extension, { historyLimit, now });
  if (result.envelope?.lifecycle === "active") {
    state.sourceSubjects.set(path, result.envelope.subjectKey);
  } else if (
    result.envelope &&
    state.sourceSubjects.get(path) === result.envelope.subjectKey
  ) {
    state.sourceSubjects.delete(path);
  }
  return result;
}

function applyEnvelope(state, rawEnvelope, { historyLimit = 100, now = Date.now() } = {}) {
  const normalized = normalizeEnvelope(rawEnvelope, { now });
  if (!normalized) return { changed: false, audioEvent: null, envelope: null };
  const envelope = withCorrelation(state, normalized);

  let changed = expireActive(state, { historyLimit, now });
  for (const subjectKey of envelope.supersedes) {
    changed =
      resolveSubject(state, subjectKey, {
        historyLimit,
        resolvedAt: envelope.timestamp,
      }) || changed;
  }

  if (envelope.lifecycle === "active") {
    const previous = state.active.get(envelope.subjectKey);
    if (!previous || isNewer(envelope, previous)) {
      state.active.set(envelope.subjectKey, envelope);
      changed = true;
    }
  } else if (envelope.lifecycle === "resolved") {
    changed = resolveSubject(state, envelope.subjectKey, {
      historyLimit,
      resolvedAt: envelope.timestamp,
    });
    if (envelope.history.policy === "always") {
      appendHistory(state, envelope, historyLimit);
      changed = true;
    }
  } else {
    if (state.deliveredEventIds.has(envelope.eventId)) {
      return { changed, audioEvent: null, envelope };
    }
    if (envelope.history.policy === "always") appendHistory(state, envelope, historyLimit);
    rememberDeliveredEventId(state, envelope.eventId);
    changed = true;
  }

  let audioEvent = null;
  if (
    changed &&
    envelope.delivery.audio &&
    envelope.lifecycle !== "resolved" &&
    !isExpired(envelope, now)
  ) {
    state.audioSequence += 1;
    audioEvent = {
      ...envelope,
      audioSequence: state.audioSequence,
      audioExpiresAt: new Date(
        now + envelope.delivery.expiresSeconds * 1000,
      ).toISOString(),
    };
  }

  if (changed) advanceProjection(state);
  return { changed, audioEvent, envelope };
}

function resolveSubject(state, subjectKey, { historyLimit, resolvedAt }) {
  const previous = state.active.get(subjectKey);
  if (!previous) return false;
  state.active.delete(subjectKey);
  if (previous.history.policy === "on-resolve" || previous.history.policy === "always") {
    appendHistory(
      state,
      {
        ...previous,
        lifecycle: "resolved",
        resolvedAt,
      },
      historyLimit,
    );
  }
  return true;
}

function expireActive(state, { historyLimit = 100, now = Date.now() } = {}) {
  let changed = false;
  for (const [subjectKey, envelope] of state.active) {
    if (!isExpired(envelope, now)) continue;
    resolveSubject(state, subjectKey, {
      historyLimit,
      resolvedAt: new Date(now).toISOString(),
    });
    changed = true;
  }
  return changed;
}

function appendHistory(state, envelope, historyLimit) {
  state.history = [
    envelope,
    ...state.history.filter((item) => item.eventId !== envelope.eventId),
  ]
    .sort(compareRecentEnvelopes)
    .slice(0, historyLimit);
}

function brokerProjection(state, { historyLimit = 100, now = Date.now() } = {}) {
  if (expireActive(state, { historyLimit, now })) advanceProjection(state);
  const recentActivity = [...state.history]
    .sort(compareRecentEnvelopes)
    .slice(0, historyLimit);
  return {
    contract: "notifications-plus-projection",
    contractVersion: 1,
    sessionId: state.sessionId,
    sequence: state.sequence,
    serverTime: new Date(now).toISOString(),
    active: [...state.active.values()].sort(compareEnvelopes),
    recentActivity,
    history: recentActivity,
    audioSequence: state.audioSequence,
    updatedAt: new Date(now).toISOString(),
  };
}

function audioDeliveryProjection(state, audioEvent, { now = Date.now() } = {}) {
  if (!audioEvent) return null;
  return {
    contract: "notifications-plus-audio-delivery",
    contractVersion: 1,
    sessionId: state.sessionId,
    sequence: state.audioSequence,
    audioSequence: state.audioSequence,
    serverTime: new Date(now).toISOString(),
    audioRequest: audioRequest(state, audioEvent),
    event: audioEvent,
    lastAudioEvent: audioEvent,
    updatedAt: new Date(now).toISOString(),
  };
}

function serializableState(state) {
  return {
    sessionId: state.sessionId,
    sequence: state.sequence,
    active: [...state.active.values()],
    history: state.history,
    audioSequence: state.audioSequence,
    deliveredEventIds: [...state.deliveredEventIds],
    sourceSubjects: Object.fromEntries(state.sourceSubjects),
  };
}

function clearHistory(state) {
  const cleared = state.history.length;
  state.history = [];
  if (cleared > 0) advanceProjection(state);
  return cleared;
}

function withCorrelation(state, envelope) {
  if (envelope.correlationId) return envelope;
  return {
    ...envelope,
    correlationId: `broker:${state.sessionId}:${envelope.eventId}`,
    correlationOrigin: "broker",
  };
}

function audioRequest(state, envelope) {
  return {
    sequence: state.audioSequence,
    requestId: `${state.sessionId}:${state.audioSequence}`,
    correlationId: envelope.correlationId,
    subjectKey: envelope.subjectKey,
    eventId: envelope.eventId,
    message: envelope.presentation.message,
    priorityScore: envelope.priority.score,
    preempt: envelope.delivery.preempt,
    expiresAt: envelope.audioExpiresAt || envelope.expiresAt || null,
    outputs: {
      localSpeaker: envelope.delivery.localPlayback,
      companion: true,
      stream: envelope.delivery.streamOutput,
    },
  };
}

function advanceProjection(state) {
  state.sequence += 1;
}

function rememberDeliveredEventId(state, eventId) {
  const key = String(eventId || "").trim();
  if (!key) return;
  state.deliveredEventIds.add(key);
  if (state.deliveredEventIds.size <= 500) return;
  state.deliveredEventIds = new Set([...state.deliveredEventIds].slice(-400));
}

function compareEnvelopes(left, right) {
  return (
    Number(right.priority?.score || 0) - Number(left.priority?.score || 0) ||
    Date.parse(right.timestamp || 0) - Date.parse(left.timestamp || 0)
  );
}

function compareRecentEnvelopes(left, right) {
  return (
    Date.parse(right.timestamp || 0) - Date.parse(left.timestamp || 0) ||
    Number(right.priority?.score || 0) - Number(left.priority?.score || 0)
  );
}

function isNewer(candidate, previous) {
  if (candidate.eventId === previous.eventId) return false;
  return (
    Number(candidate.revision || 0) > Number(previous.revision || 0) ||
    (Number(candidate.revision || 0) === Number(previous.revision || 0) &&
      candidate.eventId !== previous.eventId)
  );
}

function standardEnvelope(sourcePath, value, now) {
  const state = String(value?.state || "alert").toLowerCase();
  const level =
    state === "emergency"
      ? "emergency"
      : state === "alarm"
        ? "danger"
        : state === "warn"
          ? "warning"
          : "information";
  const methods = Array.isArray(value?.method) ? value.method.map(String) : [];
  const message = String(value?.message || "").trim();
  const subjectKey = `signalk:${sourcePath}`;
  return {
    schemaVersion: 1,
    provider: "signalk",
    subjectKey,
    eventId: `${subjectKey}:${state}:${methods.sort().join("-")}:${message}`,
    revision: now,
    lifecycle: "active",
    timestamp: new Date(now).toISOString(),
    priority: {
      level,
      score:
        level === "emergency"
          ? 1000
          : level === "danger"
            ? 800
            : level === "warning"
              ? 500
              : 200,
    },
    supersedes: [],
    history: { policy: "on-resolve" },
    delivery: {
      visual: methods.includes("visual"),
      audio: methods.includes("sound"),
      localPlayback: true,
      streamOutput: true,
      repeatSeconds: 0,
      expiresSeconds: 90,
    },
    presentation: {
      title: sourcePath.split(".").at(-1) || "Notification",
      label:
        level === "danger"
          ? "Alarm"
          : level === "warning"
            ? "Warning"
            : level === "emergency"
              ? "Emergency"
              : "Alert",
      message,
      category: sourcePath,
      facts: [],
    },
    actions: [],
    context: { sourcePath },
  };
}

function isExpired(envelope, now) {
  return Boolean(envelope.expiresAt && Date.parse(envelope.expiresAt) <= now);
}

module.exports = {
  audioDeliveryProjection,
  applyEnvelope,
  applySignalKNotification,
  brokerProjection,
  clearHistory,
  compareEnvelopes,
  compareRecentEnvelopes,
  createBrokerState,
  expireActive,
  serializableState,
};
