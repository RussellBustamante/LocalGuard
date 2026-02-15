"use client";

import { useState } from "react";
import { useNodeStatus } from "@/lib/hooks";

interface CameraFeedProps {
  label: string;
  apiRoute: string;
  streamUrl: string;
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
}: CameraFeedProps) {
  const { running } = useNodeStatus(apiRoute);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-xs uppercase tracking-wider text-zinc-500">
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
    </div>
  );
}
