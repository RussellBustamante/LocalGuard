"use client";

import { useEffect, useState } from "react";
import { useNodeStatus } from "@/lib/hooks";
import type { InferenceResult } from "@/lib/types";

export default function SparkInference() {
  const { running } = useNodeStatus("/api/spark");
  const [results, setResults] = useState<InferenceResult[]>([]);

  useEffect(() => {
    if (!running) return;

    let active = true;
    async function poll() {
      while (active) {
        try {
          const res = await fetch("/api/spark/results");
          if (res.ok) {
            const data: InferenceResult[] = await res.json();
            if (active) setResults(data);
          }
        } catch {
          // server may not be up yet
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    poll();
    return () => {
      active = false;
    };
  }, [running]);

  const displayResults = [...results].reverse();

  if (!running) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-500">
          Observations
        </h2>
        <div className="border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="font-mono text-xs text-zinc-600">
            Spark offline &mdash; no observations
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-500">
        Observations
      </h2>

      {displayResults.length === 0 ? (
        <div className="border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="font-mono text-xs text-zinc-600">
            Waiting for inference results...
          </p>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-zinc-800/50 border border-zinc-800 bg-zinc-900/50">
          {displayResults.map((r) => (
            <div key={r.id} className="p-4 flex flex-col gap-2">
              {r.status === "processing" ? (
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                  <span className="font-mono text-xs text-amber-400">
                    Processing...
                  </span>
                </div>
              ) : r.status === "error" ? (
                <p className="text-sm text-red-400">{r.output}</p>
              ) : (
                <p className="text-sm text-zinc-300 leading-relaxed">
                  {r.output}
                </p>
              )}
              <div className="flex items-center gap-2 font-mono text-xs text-zinc-600">
                <span>
                  {new Date(r.timestamp * 1000).toLocaleTimeString()}
                </span>
                {r.elapsed != null && <span>&middot; {r.elapsed.toFixed(1)}s</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
