"use client";

import { useEffect, useState } from "react";
import type { InsightsSnapshot } from "@/lib/types";

const LEVEL_STYLES: Record<
  InsightsSnapshot["alert_level"],
  { label: string; border: string; text: string; badge: string }
> = {
  low: {
    label: "Low",
    border: "border-emerald-900/80",
    text: "text-emerald-300",
    badge: "bg-emerald-950/70 text-emerald-300",
  },
  guarded: {
    label: "Guarded",
    border: "border-amber-900/80",
    text: "text-amber-300",
    badge: "bg-amber-950/70 text-amber-300",
  },
  elevated: {
    label: "Elevated",
    border: "border-orange-900/80",
    text: "text-orange-300",
    badge: "bg-orange-950/70 text-orange-300",
  },
  critical: {
    label: "Critical",
    border: "border-red-900/80",
    text: "text-red-300",
    badge: "bg-red-950/70 text-red-300",
  },
};

function formatDistance(distance: number | null): string {
  if (distance == null) return "n/a";
  return `${distance.toFixed(2)}m`;
}

export default function SecurityPosture() {
  const [snapshot, setSnapshot] = useState<InsightsSnapshot | null>(null);

  useEffect(() => {
    let active = true;

    async function poll() {
      while (active) {
        try {
          const res = await fetch("/api/insights");
          if (res.ok) {
            const data: InsightsSnapshot = await res.json();
            if (active) setSnapshot(data);
          }
        } catch {
          // Keep last snapshot visible.
        }
        await new Promise((r) => setTimeout(r, 1200));
      }
    }

    poll();
    return () => {
      active = false;
    };
  }, []);

  const level = snapshot ? LEVEL_STYLES[snapshot.alert_level] : LEVEL_STYLES.low;
  const deepSummary = snapshot?.sources.spark_deep?.latest_summary;
  const deepTimestamp = snapshot?.sources.spark_deep?.latest_timestamp;
  const deepElapsed = snapshot?.sources.spark_deep?.elapsed;

  return (
    <section className={`border ${level.border} bg-zinc-900/70 p-4 md:p-5 h-[24rem] overflow-y-auto`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Security Posture
          </h2>
        </div>
        <div className={`font-mono text-xs px-2 py-1 rounded shrink-0 ${level.badge}`}>
          {level.label}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="border border-zinc-800 bg-zinc-950/70 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            Risk Score
          </div>
          <div className={`font-mono text-lg mt-1 ${level.text}`}>{snapshot?.risk_score ?? "—"}</div>
        </div>
        <div className="border border-zinc-800 bg-zinc-950/70 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            People
          </div>
          <div className="font-mono text-lg mt-1 text-zinc-200">{snapshot?.person_count ?? "—"}</div>
        </div>
        <div className="border border-zinc-800 bg-zinc-950/70 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            Nearest
          </div>
          <div className="font-mono text-lg mt-1 text-zinc-200">
            {snapshot ? formatDistance(snapshot.nearest_person_m) : "—"}
          </div>
        </div>
        <div className="border border-zinc-800 bg-zinc-950/70 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            Objects
          </div>
          <div className="font-mono text-lg mt-1 text-zinc-200">
            {snapshot?.objects_of_interest.length ?? "—"}
          </div>
        </div>
        <div className="border border-zinc-800 bg-zinc-950/70 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">
            Cameras Online
          </div>
          <div className="font-mono text-lg mt-1 text-zinc-200">
            {snapshot ? `${snapshot.cameras.filter((cam) => cam.online).length}/${snapshot.cameras.length}` : "—"}
          </div>
        </div>
      </div>

      {/* Deep Analysis — primary narrative from Cosmos-Reason2-8B */}
      <div className="mt-4 border border-violet-900/40 bg-violet-950/20 p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-violet-400">
            Deep Analysis — Cosmos Reason 8B
          </p>
          {deepTimestamp && (
            <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-600">
              <span>
                {new Date(deepTimestamp * 1000).toLocaleTimeString()}
              </span>
              {deepElapsed != null && (
                <span>&middot; {deepElapsed.toFixed(1)}s</span>
              )}
            </div>
          )}
        </div>
        {deepSummary ? (
          <p className="text-sm text-zinc-300 leading-relaxed">
            {deepSummary}
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-violet-600 animate-pulse" />
            <p className="text-xs text-zinc-600">
              Waiting for deep analysis...
            </p>
          </div>
        )}
      </div>

      {snapshot && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {snapshot.cameras.map((camera) => (
            <div
              key={camera.id}
              className="border border-zinc-800 bg-zinc-950/50 p-3 flex items-start justify-between gap-3"
            >
              <p className="font-mono text-xs font-semibold uppercase tracking-wider text-zinc-400">
                {camera.label}
              </p>
              <div className="text-right shrink-0">
                <p className="font-mono text-[11px] text-zinc-600">
                  {camera.online ? "Online" : "Offline"}
                </p>
                <p className="font-mono text-xs text-zinc-300 mt-1">
                  {camera.person_count} people
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
