import type { NodeConfig } from "./types";
import { JETSON_STREAM_URL, ORANGEPI_URL, SPARK_STREAM_URL } from "./config";

function hostOf(url: string, fallback: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return fallback;
  }
}

export const NODES: NodeConfig[] = [
  {
    id: "orangepi",
    name: "Orange Pi Plus",
    role: "Voice Assistant",
    ip: hostOf(ORANGEPI_URL, "orangepi"),
    apiRoute: "/api/orangepi",
    capabilities: ["voice"],
  },
  {
    id: "spark",
    name: "DGX Spark",
    role: "Vision-Language",
    ip: hostOf(SPARK_STREAM_URL, "spark"),
    apiRoute: "/api/spark",
    streamUrl: SPARK_STREAM_URL,
    capabilities: ["stream", "inference"],
  },
  {
    id: "orangepi-max",
    name: "Orange Pi Max",
    role: "Reasoning",
    ip: "192.168.50.5",
    capabilities: [],
  },
  {
    id: "jetson",
    name: "Jetson Nano",
    role: "Object Detection",
    ip: hostOf(JETSON_STREAM_URL, "jetson"),
    apiRoute: "/api/jetson",
    streamUrl: JETSON_STREAM_URL,
    capabilities: ["stream", "detections"],
  },
];

export function getNode(id: string): NodeConfig | undefined {
  return NODES.find((n) => n.id === id);
}
