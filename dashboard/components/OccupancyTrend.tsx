"use client";

import { useEffect, useRef, useState } from "react";

interface DataPoint {
  ts: number;
  count: number;
}

const MAX_POINTS = 120; // 2 minutes at 1s intervals
const POLL_INTERVAL_MS = 1000;

export default function OccupancyTrend() {
  const [points, setPoints] = useState<DataPoint[]>([]);
  const pointsRef = useRef<DataPoint[]>([]);

  useEffect(() => {
    let active = true;

    async function poll() {
      while (active) {
        try {
          const res = await fetch("/api/insights");
          if (res.ok) {
            const data = await res.json();
            const now = Date.now();
            const count =
              typeof data.person_count === "number" ? data.person_count : 0;

            const next = [...pointsRef.current, { ts: now, count }];
            if (next.length > MAX_POINTS) next.splice(0, next.length - MAX_POINTS);
            pointsRef.current = next;
            if (active) setPoints([...next]);
          }
        } catch {
          // keep existing data
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    }

    poll();
    return () => { active = false; };
  }, []);

  // Current value
  const current = points.length > 0 ? points[points.length - 1].count : 0;

  // Max in 2min window
  const max2m = points.length > 0 ? Math.max(...points.map((p) => p.count)) : 0;

  // Delta over last 30s
  const now = Date.now();
  const thirtySecsAgo = points.filter((p) => p.ts >= now - 30_000);
  const oldestInWindow = thirtySecsAgo.length > 0 ? thirtySecsAgo[0].count : current;
  const delta30s = current - oldestInWindow;

  // SVG sparkline
  const W = 280;
  const H = 48;
  const PAD = 2;

  let pathD = "";
  if (points.length > 1) {
    const maxVal = Math.max(max2m, 1);
    const xStep = (W - PAD * 2) / (MAX_POINTS - 1);
    const startIdx = MAX_POINTS - points.length;

    pathD = points
      .map((p, i) => {
        const x = PAD + (startIdx + i) * xStep;
        const y = H - PAD - ((p.count / maxVal) * (H - PAD * 2));
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  return (
    <div className="border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Occupancy Trend
        </h2>
        <div className="flex gap-3 items-baseline">
          <span className="font-mono text-lg text-zinc-100">{current}</span>
          <span className="font-mono text-[10px] text-zinc-500 uppercase">
            max {max2m}
          </span>
          <span
            className={`font-mono text-[10px] uppercase ${
              delta30s > 0
                ? "text-red-400"
                : delta30s < 0
                  ? "text-emerald-400"
                  : "text-zinc-600"
            }`}
          >
            {delta30s > 0 ? "+" : ""}
            {delta30s}
            <span className="text-zinc-600 ml-0.5">30s</span>
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-12"
        preserveAspectRatio="none"
      >
        {/* grid lines */}
        <line
          x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2}
          stroke="rgb(63 63 70 / 0.3)" strokeWidth="0.5"
        />
        <line
          x1={PAD} y1={PAD} x2={W - PAD} y2={PAD}
          stroke="rgb(63 63 70 / 0.3)" strokeWidth="0.5"
        />
        {/* sparkline */}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke="rgb(167 139 250)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
      </svg>
    </div>
  );
}
