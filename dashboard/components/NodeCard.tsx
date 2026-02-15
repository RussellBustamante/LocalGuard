"use client";

import { useNodeStatus } from "@/lib/hooks";
import type { NodeConfig } from "@/lib/types";

export default function NodeCard({ node }: { node: NodeConfig }) {
  const { running, loading, toggle } = useNodeStatus(node.apiRoute);

  const hasApi = !!node.apiRoute;

  const statusLabel = !hasApi
    ? "Unconfigured"
    : loading
      ? running
        ? "Stopping..."
        : "Starting..."
      : running
        ? "Online"
        : "Offline";

  const statusColor = !hasApi
    ? "bg-zinc-600"
    : loading
      ? "bg-amber-500"
      : running
        ? "bg-emerald-500"
        : "bg-zinc-600";

  return (
    <div className="bg-zinc-900 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-mono text-sm font-bold uppercase tracking-wide text-zinc-100">
            {node.name}
          </h3>
          <p className="font-mono text-xs text-zinc-600 mt-0.5">{node.ip}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${statusColor}`}
          />
          <span className="font-mono text-xs text-zinc-400">
            {statusLabel}
          </span>
        </div>
      </div>

      <p className="text-sm text-zinc-500">{node.role}</p>

      {hasApi && (
        <button
          onClick={toggle}
          disabled={loading}
          className={`mt-auto font-mono text-xs uppercase tracking-wider px-3 py-1.5 border transition-colors disabled:opacity-50 cursor-pointer ${
            running
              ? "border-red-900 text-red-400 hover:bg-red-950/50"
              : "border-emerald-900 text-emerald-400 hover:bg-emerald-950/50"
          }`}
        >
          {loading ? "..." : running ? "Stop" : "Start"}
        </button>
      )}
    </div>
  );
}
