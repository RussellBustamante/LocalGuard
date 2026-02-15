"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { JETSON_STREAM_URL } from "@/lib/config";

export default function CameraFeed() {
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const streamKey = useRef(0);

  // Reset connected immediately when server goes down
  useEffect(() => {
    if (!running) setConnected(false);
  }, [running]);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/jetson");
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

  async function toggle() {
    setLoading(true);
    const action = running ? "stop" : "start";
    try {
      const res = await fetch("/api/jetson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      setRunning(data.running);
      if (data.running) streamKey.current++;
      if (!data.running) setConnected(false);
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">
          Jetson YOLO Feed
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

      <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
        {running && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={streamKey.current}
            src={JETSON_STREAM_URL}
            alt="YOLO camera feed"
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
    </div>
  );
}
