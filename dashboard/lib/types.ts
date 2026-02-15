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
}

export interface InferenceResult {
  id: string;
  frame_b64: string;
  output: string | null;
  status: "processing" | "done" | "error";
  timestamp: number;
  elapsed: number | null;
}
