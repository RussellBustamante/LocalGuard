"use client";

import { useEffect, useState } from "react";

interface Detection {
  label: string;
  confidence: number;
  bbox: [number, number, number, number];
  depth_m: number;
}

interface DetectionData {
  fps: number;
  detections: Detection[];
}

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
          setData(json);
          setError(false);
        } catch {
          setError(true);
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    poll();
    return () => { active = false; };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Detections</h2>
        {data && (
          <span className="text-sm text-zinc-500">{data.fps} FPS</span>
        )}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        {error ? (
          <p className="text-sm text-zinc-500">
            Detection endpoint unavailable.
          </p>
        ) : !data || data.detections.length === 0 ? (
          <p className="text-sm text-zinc-500">No objects detected.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.detections.map((det, i) => (
              <li
                key={i}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-zinc-200">{det.label}</span>
                <span className="text-zinc-500">
                  {(det.confidence * 100).toFixed(0)}% &middot; {det.depth_m.toFixed(2)}m
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
