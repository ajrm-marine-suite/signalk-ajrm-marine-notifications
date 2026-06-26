"use strict";

const LIFECYCLES = new Set(["active", "resolved", "event"]);
const HISTORY_POLICIES = new Set(["on-resolve", "always", "never"]);
const PRIORITY_LEVELS = new Set(["information", "warning", "danger", "emergency"]);

function normalizeEnvelope(raw, { now = Date.now() } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (Number(raw.schemaVersion) !== 1) return null;

  const provider = clean(raw.provider);
  const subjectKey = clean(raw.subjectKey);
  const eventId = clean(raw.eventId);
  const lifecycle = clean(raw.lifecycle);
  if (!provider || !subjectKey || !eventId || !LIFECYCLES.has(lifecycle)) return null;

  const timestamp = validIso(raw.timestamp) || new Date(now).toISOString();
  const expiresAt = validIso(raw.expiresAt);
  const priorityLevel = PRIORITY_LEVELS.has(clean(raw.priority?.level))
    ? clean(raw.priority.level)
    : "information";
  const priorityScore = clampNumber(raw.priority?.score, defaultPriority(priorityLevel), 0, 1000);
  const historyPolicy = HISTORY_POLICIES.has(clean(raw.history?.policy))
    ? clean(raw.history.policy)
    : lifecycle === "event"
      ? "always"
      : "on-resolve";

  return {
    schemaVersion: 1,
    provider,
    providerSessionId: clean(raw.providerSessionId),
    sourceSequence: clampOptionalInteger(raw.sourceSequence),
    correlationId: clean(raw.correlationId),
    correlationOrigin: clean(raw.correlationOrigin),
    subjectKey,
    eventId,
    revision: clampNumber(raw.revision, Date.parse(timestamp), 0, Number.MAX_SAFE_INTEGER),
    lifecycle,
    timestamp,
    expiresAt,
    priority: {
      level: priorityLevel,
      score: priorityScore,
    },
    supersedes: uniqueStrings(raw.supersedes),
    history: {
      policy: historyPolicy,
    },
    delivery: {
      visual: raw.delivery?.visual !== false,
      audio: raw.delivery?.audio === true,
      preempt: raw.delivery?.preempt !== false,
      localPlayback: raw.delivery?.localPlayback !== false,
      streamOutput: raw.delivery?.streamOutput !== false,
      muteState:
        typeof raw.delivery?.muteState === "boolean"
          ? raw.delivery.muteState
          : null,
      repeatSeconds: clampNumber(raw.delivery?.repeatSeconds, 0, 0, 86400),
      expiresSeconds: clampNumber(raw.delivery?.expiresSeconds, 90, 1, 86400),
    },
    presentation: {
      title: clean(raw.presentation?.title) || "Notification",
      label: clean(raw.presentation?.label) || titleCase(priorityLevel),
      message: clean(raw.presentation?.message),
      audioMessage: clean(raw.presentation?.audioMessage),
      category: clean(raw.presentation?.category),
      facts: Array.isArray(raw.presentation?.facts)
        ? raw.presentation.facts.map(clean).filter(Boolean).slice(0, 12)
        : [],
    },
    actions: Array.isArray(raw.actions)
      ? raw.actions
          .filter((action) => action && typeof action === "object")
          .map((action) => ({
            id: clean(action.id),
            label: clean(action.label),
            command: clean(action.command),
            parameters:
              action.parameters && typeof action.parameters === "object"
                ? action.parameters
                : {},
          }))
          .filter((action) => action.id && action.label && action.command)
      : [],
    context: raw.context && typeof raw.context === "object" ? raw.context : {},
  };
}

function defaultPriority(level) {
  if (level === "emergency") return 1000;
  if (level === "danger") return 800;
  if (level === "warning") return 500;
  return 200;
}

function clean(value) {
  return String(value ?? "").trim();
}

function validIso(value) {
  const text = clean(value);
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : "";
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(clean).filter(Boolean))];
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function clampOptionalInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 ? number : null;
}

function titleCase(value) {
  const text = clean(value);
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

module.exports = {
  HISTORY_POLICIES,
  LIFECYCLES,
  PRIORITY_LEVELS,
  normalizeEnvelope,
};
