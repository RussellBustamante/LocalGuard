"use client";

import { useEffect, useState, useRef } from "react";
import { useNodeStatus } from "@/lib/hooks";

interface CameraFeedProps {
  label: string;
  apiRoute: string;
  streamUrl: string;
}

export default function CameraFeed({
  label,
  apiRoute,
  streamUrl,
}: CameraFeedProps) {
  const { running } = useNodeStatus(apiRoute);
  const [connected, setConnected] = useState(false);
  const streamKey = useRef(0);
  const prevRunning = useRef(false);

  useEffect(() => {
    if (running && !prevRunning.current) {
      streamKey.current++;
    }
    if (!running) {
      setConnected(false);
    }
    prevRunning.current = running;
  }, [running]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs uppercase tracking-wider text-zinc-500">
          {label}
        </h3>
        {running && connected && (
          <span className="font-mono text-xs text-emerald-500">LIVE</span>
        )}
      </div>

      <div className="relative aspect-video overflow-hidden border border-zinc-800 bg-zinc-950">
        {running && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={streamKey.current}
            src={streamUrl}
            alt={label}
            className="h-full w-full object-contain"
            onError={() => setConnected(false)}
            onLoad={() => setConnected(true)}
          />
        )}
        {!connected && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="font-mono text-xs text-zinc-600">
              {running ? "Connecting..." : "Offline"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
