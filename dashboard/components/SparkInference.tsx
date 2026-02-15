"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { SPARK_STREAM_URL } from "@/lib/config";

interface InferenceResult {
  id: string;
  frame_b64: string;
  output: string | null;
  status: "processing" | "done" | "error";
  timestamp: number;
  elapsed: number | null;
}

export default function SparkInference() {
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<InferenceResult[]>([]);
  const streamKey = useRef(0);

  // Reset connected and results when server goes down
  useEffect(() => {
    if (!running) {
      setConnected(false);
      setResults([]);
    }
  }, [running]);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/spark");
      const data = await res.json();
      setRunning(data.running);
    } catch {
      setRunning(false);
    }
    setLoading(false);
  }, []);

  // Poll health every 3s
  useEffect(() => {
    checkStatus();
    const id = setInterval(checkStatus, 3000);
    return () => clearInterval(id);
  }, [checkStatus]);

  // Poll inference results while running
  useEffect(() => {
    if (!running) return;
    let active = true;
    async function poll() {
      while (active) {
        try {
          const res = await fetch("/api/spark/results");
          if (res.ok) {
            const data: InferenceResult[] = await res.json();
            setResults(data);
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

  async function toggle() {
    setLoading(true);
    const action = running ? "stop" : "start";
    try {
      const res = await fetch("/api/spark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      setRunning(data.running);
      if (data.running) streamKey.current++;
      if (!data.running) {
        setConnected(false);
        setResults([]);
      }
    } catch {
      // ignore
    }
    setLoading(false);
  }

  const statusColor = loading
    ? "bg-yellow-500"
    : running
      ? connected
        ? "bg-green-500"
        : "bg-yellow-500"
      : "bg-red-500";

  const statusLabel = loading
    ? running
      ? "Stopping..."
      : "Starting..."
    : running
      ? connected
        ? "Live"
        : "Connecting..."
      : "Offline";

  // Show results newest-first (bottom of deque = most recent)
  const displayResults = [...results].reverse();

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">
          Spark Vision (Cosmos-Reason1)
        </h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${statusColor}`}
            />
            <span className="text-zinc-400">{statusLabel}</span>
          </div>
          <button
            onClick={toggle}
            disabled={loading}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors disabled:opacity-50 ${
              running
                ? "bg-red-600 hover:bg-red-700 text-white"
                : "bg-green-600 hover:bg-green-700 text-white"
            }`}
          >
            {loading ? "..." : running ? "Stop" : "Start"}
          </button>
        </div>
      </div>

      {/* Live feed */}
      <div className="relative aspect-video overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
        {running && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={streamKey.current}
            src={SPARK_STREAM_URL}
            alt="Spark camera feed"
            className="h-full w-full object-contain"
            onError={() => setConnected(false)}
            onLoad={() => setConnected(true)}
          />
        )}
        {!connected && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-zinc-500 text-sm text-center px-4">
              {loading
                ? running
                  ? "Stopping stream..."
                  : "Starting stream..."
                : running
                  ? "Connecting to stream..."
                  : "Stream offline — press Start"}
            </p>
          </div>
        )}
      </div>

      {/* Inference results queue */}
      {displayResults.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-zinc-400">
            Inference Results
          </h3>
          <div className="grid gap-3">
            {displayResults.map((r, i) => (
              <div
                key={r.id}
                className={`flex gap-3 rounded-lg border p-3 ${
                  i === 0 && r.status === "processing"
                    ? "border-amber-600/50 bg-amber-950/20"
                    : "border-zinc-800 bg-zinc-900"
                }`}
              >
                {/* Thumbnail */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/jpeg;base64,${r.frame_b64}`}
                  alt="Captured frame"
                  className="h-40 w-56 flex-shrink-0 rounded-md object-cover"
                />

                {/* Text */}
                <div className="flex flex-1 flex-col justify-center gap-1 min-w-0">
                  {r.status === "processing" ? (
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                      <span className="text-sm text-amber-400">
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
                  <div className="flex items-center gap-2 text-xs text-zinc-600">
                    <span>
                      {new Date(r.timestamp * 1000).toLocaleTimeString()}
                    </span>
                    {r.elapsed && <span>· {r.elapsed}s</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
