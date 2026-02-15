export interface NodeConfig {
  id: string;
  name: string;
  role: string;
  ip: string;
  apiRoute?: string;
  streamUrl?: string;
  capabilities: ("stream" | "detections" | "inference" | "voice")[];
}

export interface Detection {
  label: string;
  confidence: number;
  bbox: [number, number, number, number];
  depth_m: number;
}

export interface DetectionData {
  fps: number;
  detections: Detection[];
  timestamp?: number;
  source?: string;
  counts?: Record<string, number>;
  person_count?: number;
  nearest_person_m?: number | null;
}

export interface InferenceResult {
  id: string;
  frame_b64?: string;
  output: string | null;
  status: "processing" | "done" | "error";
  timestamp: number;
  elapsed: number | null;
  model?: "fast" | "deep";
  cameras?: string[];
}

export type AlertLevel = "low" | "guarded" | "elevated" | "critical";

export interface ObjectOfInterest {
  label: string;
  count: number;
  max_confidence: number;
  nearest_m: number | null;
}

export interface InsightsSnapshot {
  timestamp: number;
  alert_level: AlertLevel;
  risk_score: number;
  person_count: number;
  nearest_person_m: number | null;
  objects_of_interest: ObjectOfInterest[];
  scene_summary: string;
  sources: {
    jetson: {
      online: boolean;
      fps: number;
      detection_count: number;
      counts: Record<string, number>;
      timestamp: number | null;
    };
    jetson_vlm: {
      online: boolean;
      latest_result_id: string | null;
      latest_status: "processing" | "done" | "error" | "offline";
      latest_timestamp: number | null;
      elapsed: number | null;
    };
    spark: {
      online: boolean;
      latest_result_id: string | null;
      latest_status: "processing" | "done" | "error" | "offline";
      latest_timestamp: number | null;
      elapsed: number | null;
    };
    spark_deep: {
      online: boolean;
      latest_result_id: string | null;
      latest_status: "processing" | "done" | "error" | "offline";
      latest_summary: string | null;
      latest_timestamp: number | null;
      elapsed: number | null;
    };
    voice: {
      online: boolean;
      state: string;
      last_interaction_timestamp: number | null;
    };
  };
  cameras: Array<{
    id: string;
    label: string;
    online: boolean;
    person_count: number;
    scene_summary?: string;
  }>;
}

export type TimelineEventType =
  | "person_count_change"
  | "restricted_object_seen"
  | "proximity_alert"
  | "voice_query";

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  level: AlertLevel;
  message: string;
  timestamp: number;
  details?: Record<string, string | number | boolean | null>;
}

export interface InsightsBrief {
  timestamp: number;
  alert_level: AlertLevel;
  risk_score: number;
  person_count: number;
  nearest_person_m: number | null;
  objects_of_interest: string[];
  scene_summary: string;
  last_event: string | null;
  deep_summary: string | null;
}
