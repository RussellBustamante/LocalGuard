import {
  JETSON_DETECTIONS_URL,
  ORANGEPI_STATUS_URL,
  SPARK_RESULTS_URL,
} from "@/lib/config";
import type {
  AlertLevel,
  DetectionData,
  InferenceResult,
  InsightsBrief,
  InsightsSnapshot,
  ObjectOfInterest,
  TimelineEvent,
} from "@/lib/types";

const MAX_EVENTS = 100;
const SNAPSHOT_TTL_MS = 700;
const FETCH_TIMEOUT_MS = 1200;
const PROXIMITY_THRESHOLD_M = 1.5;
const PROXIMITY_EVENT_COOLDOWN_S = 10;
const RESTRICTED_EVENT_COOLDOWN_S = 8;

const RESTRICTED_LABELS = new Set([
  "knife",
  "scissors",
  "baseball bat",
  "gun",
  "pistol",
  "rifle",
]);

const SPARK_RISK_KEYWORDS = [
  "weapon",
  "knife",
  "gun",
  "armed",
  "fight",
  "aggressive",
  "intruder",
  "threat",
  "breaking in",
  "forced entry",
  "mask",
] as const;

interface VoiceInteraction {
  timestamp: number;
  command: string;
}

interface VoiceStatusPayload {
  state: string;
  running: boolean;
  interactions: VoiceInteraction[];
}

interface InsightsState {
  initialized: boolean;
  lastSnapshot: InsightsSnapshot | null;
  lastSnapshotAtMs: number;
  inFlight: Promise<InsightsSnapshot> | null;
  events: TimelineEvent[];
  lastPersonCount: number;
  lastProximityEventAt: number;
  lastRestrictedSeenAt: Map<string, number>;
  lastVoiceInteractionTs: number;
}

const state: InsightsState = {
  initialized: false,
  lastSnapshot: null,
  lastSnapshotAtMs: 0,
  inFlight: null,
  events: [],
  lastPersonCount: 0,
  lastProximityEventAt: 0,
  lastRestrictedSeenAt: new Map<string, number>(),
  lastVoiceInteractionTs: 0,
};

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function mkEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pushEvent(event: Omit<TimelineEvent, "id">): void {
  state.events.unshift({ id: mkEventId(), ...event });
  if (state.events.length > MAX_EVENTS) {
    state.events.length = MAX_EVENTS;
  }
}

async function fetchJsonWithTimeout<T>(
  url: string,
  fallback: T,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return fallback;
    }
    return (await res.json()) as T;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

function truncate(text: string, max = 180): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function buildCounts(detectionData: DetectionData): Record<string, number> {
  if (detectionData.counts && Object.keys(detectionData.counts).length > 0) {
    return detectionData.counts;
  }

  const counts: Record<string, number> = {};
  for (const det of detectionData.detections ?? []) {
    counts[det.label] = (counts[det.label] ?? 0) + 1;
  }
  return counts;
}

function nearestPersonMeters(detectionData: DetectionData): number | null {
  if (typeof detectionData.nearest_person_m === "number") {
    return detectionData.nearest_person_m;
  }

  const personDepths = (detectionData.detections ?? [])
    .filter((d) => d.label === "person")
    .map((d) => d.depth_m)
    .filter((v) => Number.isFinite(v));

  if (personDepths.length === 0) return null;
  return Math.min(...personDepths);
}

function restrictedObjects(detectionData: DetectionData): ObjectOfInterest[] {
  const byLabel = new Map<string, ObjectOfInterest>();

  for (const det of detectionData.detections ?? []) {
    if (!RESTRICTED_LABELS.has(det.label)) continue;

    const existing = byLabel.get(det.label);
    const nearest = Number.isFinite(det.depth_m) ? det.depth_m : null;

    if (!existing) {
      byLabel.set(det.label, {
        label: det.label,
        count: 1,
        max_confidence: det.confidence,
        nearest_m: nearest,
      });
      continue;
    }

    existing.count += 1;
    existing.max_confidence = Math.max(existing.max_confidence, det.confidence);
    if (nearest != null) {
      if (existing.nearest_m == null || nearest < existing.nearest_m) {
        existing.nearest_m = nearest;
      }
    }
  }

  return [...byLabel.values()].sort((a, b) => b.count - a.count);
}

function estimatePeopleFromText(summary: string): number {
  const lower = summary.toLowerCase();
  const exact = lower.match(/\b(\d+)\s+(people|persons|person)\b/);
  if (exact) {
    const parsed = Number.parseInt(exact[1], 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const words: Array<[RegExp, number]> = [
    [/\bone\s+(person|people)\b/, 1],
    [/\btwo\s+(person|people)\b/, 2],
    [/\bthree\s+(person|people)\b/, 3],
    [/\bfour\s+(person|people)\b/, 4],
    [/\bfive\s+(person|people)\b/, 5],
    [/\b(several|multiple)\s+people\b/, 3],
  ];

  for (const [pattern, count] of words) {
    if (pattern.test(lower)) return count;
  }

  if (/\b(person|people|individual)\b/.test(lower)) {
    return 1;
  }

  return 0;
}

function sparkKeywordRisk(summary: string): number {
  const lower = summary.toLowerCase();
  return SPARK_RISK_KEYWORDS.some((word) => lower.includes(word)) ? 20 : 0;
}

function toAlertLevel(score: number): AlertLevel {
  if (score >= 75) return "critical";
  if (score >= 45) return "elevated";
  if (score >= 20) return "guarded";
  return "low";
}

function buildRiskScore(params: {
  personCount: number;
  nearestPerson: number | null;
  objectCount: number;
  sparkSummary: string;
}): number {
  let score = 5;
  score += Math.min(params.personCount * 8, 30);
  score += Math.min(params.objectCount * 22, 44);

  if (params.nearestPerson != null) {
    if (params.nearestPerson < 1.0) score += 35;
    else if (params.nearestPerson < 2.0) score += 22;
    else if (params.nearestPerson < 3.0) score += 10;
  }

  score += sparkKeywordRisk(params.sparkSummary);
  return Math.min(score, 100);
}

function latestSparkResult(results: InferenceResult[]): InferenceResult | null {
  if (!results.length) return null;
  return [...results].sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
}

function latestVoiceInteraction(status: VoiceStatusPayload): VoiceInteraction | null {
  if (!status.interactions?.length) return null;
  return [...status.interactions].sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
}

function emitEvents(snapshot: InsightsSnapshot, latestVoice: VoiceInteraction | null): void {
  const ts = snapshot.timestamp;

  if (!state.initialized) {
    state.lastPersonCount = snapshot.person_count;
    state.lastVoiceInteractionTs = latestVoice?.timestamp ?? 0;
    state.initialized = true;
    return;
  }

  if (snapshot.person_count !== state.lastPersonCount) {
    const delta = snapshot.person_count - state.lastPersonCount;
    pushEvent({
      type: "person_count_change",
      level: snapshot.alert_level,
      message: `People count changed ${state.lastPersonCount} -> ${snapshot.person_count}`,
      timestamp: ts,
      details: {
        from: state.lastPersonCount,
        to: snapshot.person_count,
        delta,
      },
    });
    state.lastPersonCount = snapshot.person_count;
  }

  for (const obj of snapshot.objects_of_interest) {
    const lastSeen = state.lastRestrictedSeenAt.get(obj.label) ?? 0;
    if (ts - lastSeen >= RESTRICTED_EVENT_COOLDOWN_S) {
      pushEvent({
        type: "restricted_object_seen",
        level: "elevated",
        message: `Restricted object seen: ${obj.label} (${obj.count})`,
        timestamp: ts,
        details: {
          label: obj.label,
          count: obj.count,
          nearest_m: obj.nearest_m,
          confidence: Number(obj.max_confidence.toFixed(2)),
        },
      });
      state.lastRestrictedSeenAt.set(obj.label, ts);
    }
  }

  if (
    snapshot.nearest_person_m != null &&
    snapshot.nearest_person_m <= PROXIMITY_THRESHOLD_M &&
    ts - state.lastProximityEventAt >= PROXIMITY_EVENT_COOLDOWN_S
  ) {
    pushEvent({
      type: "proximity_alert",
      level: snapshot.nearest_person_m < 1.0 ? "critical" : "elevated",
      message: `Proximity alert: person at ${snapshot.nearest_person_m.toFixed(2)}m`,
      timestamp: ts,
      details: {
        nearest_person_m: Number(snapshot.nearest_person_m.toFixed(2)),
      },
    });
    state.lastProximityEventAt = ts;
  }

  if (latestVoice && latestVoice.timestamp > state.lastVoiceInteractionTs) {
    pushEvent({
      type: "voice_query",
      level: "guarded",
      message: `Voice query: ${truncate(latestVoice.command, 80)}`,
      timestamp: Math.floor(latestVoice.timestamp),
      details: {
        command: truncate(latestVoice.command, 120),
      },
    });
    state.lastVoiceInteractionTs = latestVoice.timestamp;
  }
}

async function computeInsights(): Promise<InsightsSnapshot> {
  const [jetson, sparkResults, voiceStatus] = await Promise.all([
    fetchJsonWithTimeout<DetectionData>(
      JETSON_DETECTIONS_URL,
      { fps: 0, detections: [] },
      900
    ),
    fetchJsonWithTimeout<InferenceResult[]>(SPARK_RESULTS_URL, [], 1300),
    fetchJsonWithTimeout<VoiceStatusPayload>(
      ORANGEPI_STATUS_URL,
      { state: "offline", running: false, interactions: [] },
      1100
    ),
  ]);

  const counts = buildCounts(jetson);
  const personCount =
    typeof jetson.person_count === "number" ? jetson.person_count : counts.person ?? 0;
  const nearestPerson = nearestPersonMeters(jetson);
  const restricted = restrictedObjects(jetson);
  const sparkLatest = latestSparkResult(sparkResults);
  const sparkSummary = sparkLatest?.output?.trim() ?? "";
  const latestVoice = latestVoiceInteraction(voiceStatus);

  const riskScore = buildRiskScore({
    personCount,
    nearestPerson,
    objectCount: restricted.length,
    sparkSummary,
  });

  const snapshot: InsightsSnapshot = {
    timestamp: nowSec(),
    alert_level: toAlertLevel(riskScore),
    risk_score: riskScore,
    person_count: personCount,
    nearest_person_m: nearestPerson,
    objects_of_interest: restricted,
    scene_summary: truncate(sparkSummary || "No scene summary available", 220),
    sources: {
      jetson: {
        online: jetson.fps > 0 || (jetson.detections?.length ?? 0) > 0,
        fps: jetson.fps ?? 0,
        detection_count: jetson.detections?.length ?? 0,
        counts,
        timestamp:
          typeof jetson.timestamp === "number" && Number.isFinite(jetson.timestamp)
            ? jetson.timestamp
            : null,
      },
      spark: {
        online: sparkLatest != null,
        latest_result_id: sparkLatest?.id ?? null,
        latest_status: sparkLatest?.status ?? "offline",
        latest_timestamp: sparkLatest?.timestamp ?? null,
        elapsed: sparkLatest?.elapsed ?? null,
      },
      voice: {
        online: voiceStatus.running,
        state: voiceStatus.state,
        last_interaction_timestamp: latestVoice?.timestamp ?? null,
      },
    },
    cameras: [
      {
        id: "jetson",
        label: "Jetson RGB-D",
        online: jetson.fps > 0 || (jetson.detections?.length ?? 0) > 0,
        person_count: personCount,
      },
      {
        id: "spark",
        label: "Spark Scene Cam",
        online: sparkLatest != null,
        person_count: sparkSummary ? estimatePeopleFromText(sparkSummary) : 0,
        scene_summary: truncate(sparkSummary || "No scene summary", 120),
      },
    ],
  };

  emitEvents(snapshot, latestVoice);
  state.lastSnapshot = snapshot;
  state.lastSnapshotAtMs = Date.now();

  return snapshot;
}

export async function getInsightsSnapshot(forceRefresh = false): Promise<InsightsSnapshot> {
  const now = Date.now();
  if (
    !forceRefresh &&
    state.lastSnapshot &&
    now - state.lastSnapshotAtMs <= SNAPSHOT_TTL_MS
  ) {
    return state.lastSnapshot;
  }

  if (state.inFlight) {
    return state.inFlight;
  }

  state.inFlight = computeInsights().finally(() => {
    state.inFlight = null;
  });

  return state.inFlight;
}

export async function getInsightsBrief(): Promise<InsightsBrief> {
  const snapshot = await getInsightsSnapshot();
  const lastEvent = state.events[0]?.message ?? null;

  return {
    timestamp: snapshot.timestamp,
    alert_level: snapshot.alert_level,
    risk_score: snapshot.risk_score,
    person_count: snapshot.person_count,
    nearest_person_m: snapshot.nearest_person_m,
    objects_of_interest: snapshot.objects_of_interest.map((obj) => obj.label),
    scene_summary: truncate(snapshot.scene_summary, 140),
    last_event: lastEvent,
  };
}

export async function getTimelineEvents(limit = MAX_EVENTS): Promise<TimelineEvent[]> {
  await getInsightsSnapshot();
  return state.events.slice(0, Math.max(1, Math.min(limit, MAX_EVENTS)));
}
