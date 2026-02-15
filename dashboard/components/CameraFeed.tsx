"use client";

import { useEffect, useState } from "react";
import { useNodeStatus } from "@/lib/hooks";
import type { InferenceResult } from "@/lib/types";

interface CameraFeedProps {
  label: string;
  apiRoute: string;
  streamUrl: string;
  vlmRoute?: string;
}

function VlmRapidAnalysis({ endpoint }: { endpoint: string }) {
  const [output, setOutput] = useState<string | null>(null);
  const [timestamp, setTimestamp] = useState<number | null>(null);
  useEffect(() => {
    let active = true;

    async function poll() {
      while (active) {
        try {
          const res = await fetch(endpoint);
          if (res.ok) {
            const data: InferenceResult[] = await res.json();
            if (active && data.length > 0) {
              const latest = data.reduce((a, b) =>
                b.timestamp > a.timestamp ? b : a
              );
              if (latest.status === "done" && latest.output) {
                setOutput(latest.output);
                setTimestamp(latest.timestamp);
              }
            }
          }
        } catch {
          /* keep last result visible */
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    }

    poll();
    return () => {
      active = false;
    };
  }, [endpoint]);

  return (
    <div className="border border-cyan-900/30 bg-cyan-950/10 px-3 py-2 flex items-start gap-2 min-h-[48px]">
      <span className="font-mono text-[10px] uppercase tracking-wider text-cyan-700 shrink-0 mt-0.5">
        VLM
      </span>
      {output ? (
        <p className="font-mono text-[11px] text-zinc-400 line-clamp-2 flex-1 leading-relaxed">
          {output}
        </p>
      ) : (
        <p className="font-mono text-[11px] text-zinc-600 animate-pulse">
          Awaiting analysis...
        </p>
      )}
      {timestamp != null && (
        <span className="font-mono text-[10px] text-zinc-700 shrink-0">
          {new Date(timestamp * 1000).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}

function LiveStream({ label, streamUrl }: { label: string; streamUrl: string }) {
  const [connected, setConnected] = useState(false);

  return (
    <div className="relative h-full w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={streamUrl}
        alt={label}
        className="h-full w-full object-contain"
        onError={() => setConnected(false)}
        onLoad={() => setConnected(true)}
      />
      {!connected && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="font-mono text-xs text-zinc-600">Connecting...</p>
        </div>
      )}
      {connected && (
        <div className="absolute right-2 top-2 font-mono text-[10px] text-emerald-500">
          LIVE
        </div>
      )}
    </div>
  );
}

export default function CameraFeed({
  label,
  apiRoute,
  streamUrl,
  vlmRoute,
}: CameraFeedProps) {
  const { running } = useNodeStatus(apiRoute);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs font-semibold uppercase tracking-wider text-zinc-400">
          {label}
        </h3>
      </div>

      <div className="relative aspect-video overflow-hidden border border-zinc-800 bg-zinc-950">
        {running ? (
          <LiveStream key={`${label}-${streamUrl}`} label={label} streamUrl={streamUrl} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="font-mono text-xs text-zinc-600">Offline</p>
          </div>
        )}
      </div>

      {vlmRoute && running && <VlmRapidAnalysis endpoint={vlmRoute} />}
    </div>
  );
}
