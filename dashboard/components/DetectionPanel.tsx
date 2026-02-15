"use client";

import { useEffect, useState } from "react";
import type { DetectionData, InferenceResult } from "@/lib/types";

export default function DetectionPanel() {
  const [data, setData] = useState<DetectionData | null>(null);
  const [error, setError] = useState(false);
  const [vlm, setVlm] = useState<InferenceResult | null>(null);
  const [vlmError, setVlmError] = useState(false);

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

    async function pollVlm() {
      while (active) {
        try {
          const res = await fetch("/api/jetson/vlm");
          const json: InferenceResult[] = await res.json();
          if (active && json.length > 0) {
            const latest = json.reduce((a, b) =>
              b.timestamp > a.timestamp ? b : a
            );
            setVlm(latest);
            setVlmError(false);
          }
        } catch {
          if (active) setVlmError(true);
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    poll();
    pollVlm();
    return () => {
      active = false;
    };
  }, []);

  const hasFps = data && data.fps > 0;
  const counts: Record<string, number> = data?.counts
    ? data.counts
    : (data?.detections ?? []).reduce<Record<string, number>>((acc, det) => {
        acc[det.label] = (acc[det.label] ?? 0) + 1;
        return acc;
      }, {});
  const countRows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const personCount = data?.person_count ?? counts.person ?? 0;
  const nearestPerson =
    data?.nearest_person_m ??
    (data?.detections ?? [])
      .filter((d) => d.label === "person")
      .map((d) => d.depth_m)
      .reduce<number | null>((min, v) => (min == null || v < min ? v : min), null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Detections
        </h2>
        {hasFps && (
          <span className="font-mono text-xs text-zinc-600">
            {data.fps.toFixed(1)} FPS
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="border border-zinc-800 bg-zinc-900/50 px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            Humans Visible
          </p>
          <p className="font-mono text-lg text-zinc-200 mt-1">{personCount}</p>
        </div>
        <div className="border border-zinc-800 bg-zinc-900/50 px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            Nearest Human
          </p>
          <p className="font-mono text-lg text-zinc-200 mt-1">
            {nearestPerson == null ? "n/a" : `${nearestPerson.toFixed(2)}m`}
          </p>
        </div>
      </div>

      <div className="border border-zinc-800 bg-zinc-900/50 divide-y divide-zinc-800/50">
        {error ? (
          <p className="p-4 font-mono text-xs text-zinc-600">
            Endpoint unavailable
          </p>
        ) : !data || countRows.length === 0 ? (
          <p className="p-4 font-mono text-xs text-zinc-600">
            No objects detected
          </p>
        ) : (
          countRows.map(([label, count], i) => (
            <div
              key={`${label}-${i}`}
              className="flex items-center justify-between px-4 py-2.5"
            >
              <span className="font-mono text-sm text-zinc-200">
                {label}
              </span>
              <span className="font-mono text-xs text-zinc-500">
                {count}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Scene Analysis (Jetson VLM) */}
      <div className="flex flex-col gap-1.5">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Scene Analysis
        </h2>
        <div className="border border-zinc-800 bg-zinc-900/50 px-4 py-3">
          {vlmError ? (
            <p className="font-mono text-xs text-zinc-600">VLM unavailable</p>
          ) : !vlm ? (
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-zinc-600 animate-pulse" />
              <p className="font-mono text-xs text-zinc-600">
                Waiting for scene analysis...
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="font-mono text-sm leading-relaxed text-zinc-300">
                {vlm.output}
              </p>
              <div className="flex items-center gap-3 mt-1">
                {vlm.elapsed != null && (
                  <span className="font-mono text-[10px] text-zinc-600">
                    {vlm.elapsed}s
                  </span>
                )}
                {vlm.status === "error" && (
                  <span className="font-mono text-[10px] text-red-500">
                    error
                  </span>
                )}
                <span className="font-mono text-[10px] text-zinc-700">
                  {new Date(vlm.timestamp * 1000).toLocaleTimeString()}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
