"use client";

import { useEffect, useState } from "react";
import type { DetectionData } from "@/lib/types";

export default function DetectionPanel() {
  const [data, setData] = useState<DetectionData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    async function poll() {
      while (active) {
        try {
          const res = await fetch("/api/detections");
          const json = await res.json();
          if (active) {
            setData(json);
            setError(false);
          }
        } catch {
          if (active) setError(true);
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    poll();
    return () => {
      active = false;
    };
  }, []);

  const hasFps = data && data.fps > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-500">
          Detections
        </h2>
        {hasFps && (
          <span className="font-mono text-xs text-zinc-600">
            {data.fps.toFixed(1)} FPS
          </span>
        )}
      </div>

      <div className="border border-zinc-800 bg-zinc-900/50 divide-y divide-zinc-800/50">
        {error ? (
          <p className="p-4 font-mono text-xs text-zinc-600">
            Endpoint unavailable
          </p>
        ) : !data || data.detections.length === 0 ? (
          <p className="p-4 font-mono text-xs text-zinc-600">
            No objects detected
          </p>
        ) : (
          data.detections.map((det, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-4 py-2.5"
            >
              <span className="font-mono text-sm text-zinc-200">
                {det.label}
              </span>
              <span className="font-mono text-xs text-zinc-500">
                {(det.confidence * 100).toFixed(0)}% &middot;{" "}
                {det.depth_m.toFixed(2)}m
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
