"use client";

import React, { useEffect, useState } from "react";
import type { DetectionData } from "@/lib/types";

interface SourceData {
  data: DetectionData | null;
  error: boolean;
}

function DetectionSource({
  label,
  source,
  showDepth,
}: {
  label: string;
  source: SourceData;
  showDepth: boolean;
}) {
  const { data, error } = source;

  const hasFps = data && data.fps > 0;
  const counts: Record<string, number> = data?.counts
    ? data.counts
    : (data?.detections ?? []).reduce<Record<string, number>>((acc, det) => {
        acc[det.label] = (acc[det.label] ?? 0) + 1;
        return acc;
      }, {});
  const countRows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const personCount = data?.person_count ?? counts.person ?? 0;
  const nearestPerson = showDepth
    ? data?.nearest_person_m ??
      (data?.detections ?? [])
        .filter((d) => d.label === "person")
        .map((d) => d.depth_m)
        .reduce<number | null>(
          (min, v) => (min == null || v < min ? v : min),
          null
        )
    : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {label}
        </span>
        {hasFps && (
          <span className="font-mono text-[10px] text-zinc-600">
            {data.fps.toFixed(1)} FPS
          </span>
        )}
      </div>

      <div className={showDepth ? "grid grid-cols-2 gap-2" : ""}>
        <div className="border border-zinc-800 bg-zinc-900/50 px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            Humans
          </p>
          <p className="font-mono text-lg text-zinc-200 mt-1">{personCount}</p>
        </div>
        {showDepth && (
          <div className="border border-zinc-800 bg-zinc-900/50 px-3 py-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
              Nearest
            </p>
            <p className="font-mono text-lg text-zinc-200 mt-1">
              {nearestPerson == null ? "n/a" : `${nearestPerson.toFixed(2)}m`}
            </p>
          </div>
        )}
      </div>

      <div className="border border-zinc-800 bg-zinc-900/50 divide-y divide-zinc-800/50">
        {error ? (
          <p className="px-4 py-2.5 font-mono text-xs text-zinc-600">
            Endpoint unavailable
          </p>
        ) : !data || countRows.length === 0 ? (
          <p className="px-4 py-2.5 font-mono text-xs text-zinc-600">
            No objects detected
          </p>
        ) : (
          countRows.map(([lbl, count], i) => (
            <div
              key={`${lbl}-${i}`}
              className="flex items-center justify-between px-4 py-2"
            >
              <span className="font-mono text-sm text-zinc-200">{lbl}</span>
              <span className="font-mono text-xs text-zinc-500">{count}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function DetectionPanel() {
  const [jetson, setJetson] = useState<SourceData>({
    data: null,
    error: false,
  });
  const [spark, setSpark] = useState<SourceData>({
    data: null,
    error: false,
  });
  useEffect(() => {
    let active = true;

    async function pollSource(
      url: string,
      setter: React.Dispatch<React.SetStateAction<SourceData>>,
      interval: number
    ) {
      while (active) {
        try {
          const res = await fetch(url);
          const json = await res.json();
          if (active) setter({ data: json, error: false });
        } catch {
          if (active) setter((prev) => ({ ...prev, error: true }));
        }
        await new Promise((r) => setTimeout(r, interval));
      }
    }

    pollSource("/api/detections", setJetson, 500);
    pollSource("/api/spark/detections", setSpark, 500);
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-zinc-400">
        Detections
      </h2>

      <div className="grid grid-cols-2 gap-3">
        <DetectionSource label="Jetson (D435)" source={jetson} showDepth={true} />
        <DetectionSource label="Spark (AKASO)" source={spark} showDepth={false} />
      </div>
    </div>
  );
}
