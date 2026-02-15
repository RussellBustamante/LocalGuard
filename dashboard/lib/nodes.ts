import type { NodeConfig } from "./types";

export const NODES: NodeConfig[] = [
  {
    id: "jetson",
    name: "Jetson Nano",
    role: "Object Detection",
    ip: "192.168.50.4",
    apiRoute: "/api/jetson",
    streamUrl: "http://192.168.50.4:8080/stream",
    capabilities: ["stream", "detections"],
  },
  {
    id: "spark",
    name: "DGX Spark",
    role: "Vision-Language",
    ip: "192.168.50.2",
    apiRoute: "/api/spark",
    streamUrl: "http://192.168.50.2:8090/stream",
    capabilities: ["stream", "inference"],
  },
  {
    id: "orangepi",
    name: "Orange Pi",
    role: "Unassigned",
    ip: "192.168.50.3",
    capabilities: [],
  },
];

export function getNode(id: string): NodeConfig | undefined {
  return NODES.find((n) => n.id === id);
}
