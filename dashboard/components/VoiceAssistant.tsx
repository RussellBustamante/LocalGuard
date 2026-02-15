"use client";

import { useEffect, useState } from "react";
import { useNodeStatus } from "@/lib/hooks";

interface Interaction {
  timestamp: number;
  command: string;
  response: string;
  llm_time: number;
  tts_time: number;
}

interface VoiceStatus {
  state: string;
  running: boolean;
  wake_word: string;
  interactions: Interaction[];
}

const STATE_LABELS: Record<string, { label: string; color: string }> = {
  idle: { label: "Idle", color: "text-zinc-500" },
  listening: { label: "Listening", color: "text-emerald-400" },
  recording: { label: "Recording", color: "text-amber-400" },
  thinking: { label: "Thinking", color: "text-blue-400" },
  speaking: { label: "Speaking", color: "text-cyan-400" },
  offline: { label: "Offline", color: "text-zinc-600" },
};

export default function VoiceAssistant() {
  const { running } = useNodeStatus("/api/orangepi");
  const [status, setStatus] = useState<VoiceStatus | null>(null);

  useEffect(() => {
    if (!running) return;

    let active = true;
    async function poll() {
      while (active) {
        try {
          const res = await fetch("/api/orangepi/status");
          if (res.ok) {
            const data: VoiceStatus = await res.json();
            if (active) setStatus(data);
          }
        } catch {
          // not up yet
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    poll();
    return () => {
      active = false;
    };
  }, [running]);

  const stateInfo = STATE_LABELS[status?.state ?? "offline"] ?? STATE_LABELS.offline;
  const interactions = status?.interactions ?? [];
  const displayInteractions = [...interactions].reverse();

  if (!running) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Voice Assistant
        </h2>
        <div className="border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="font-mono text-xs text-zinc-600">
            Orange Pi offline &mdash; no voice assistant
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Voice Assistant
        </h2>
        <div className="flex items-center gap-2">
          {status?.state === "listening" && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          )}
          <span className={`font-mono text-xs ${stateInfo.color}`}>
            {stateInfo.label}
          </span>
          {status?.wake_word && (
            <span className="font-mono text-xs text-zinc-600">
              &middot; &ldquo;{status.wake_word}&rdquo;
            </span>
          )}
        </div>
      </div>

      {/* Spark override toggle (not yet wired) */}
      <div className="border border-zinc-800 bg-zinc-900/30 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-zinc-500">
            Override STT/TTS to DGX Spark
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded">
            Coming Soon
          </span>
        </div>
        <button
          disabled
          className="relative inline-flex h-5 w-9 items-center rounded-full bg-zinc-700 cursor-not-allowed opacity-40"
          title="Not yet available — requires STT/TTS deployment on Spark"
        >
          <span className="inline-block h-3.5 w-3.5 rounded-full bg-zinc-400 translate-x-0.5 transition-transform" />
        </button>
      </div>

      <div className="border border-zinc-800 bg-zinc-900/50 divide-y divide-zinc-800/50">
        {displayInteractions.length === 0 ? (
          <div className="p-4">
            <p className="font-mono text-xs text-zinc-600">
              Listening for wake word&hellip; say &ldquo;Security&rdquo; to activate
            </p>
          </div>
        ) : (
          displayInteractions.map((interaction, i) => (
            <div key={i} className="p-4 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <span className="font-mono text-xs text-zinc-500 shrink-0 mt-0.5">
                  Q:
                </span>
                <p className="text-sm text-zinc-300">{interaction.command}</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-mono text-xs text-zinc-500 shrink-0 mt-0.5">
                  A:
                </span>
                <p className="text-sm text-zinc-400 leading-relaxed">
                  {interaction.response}
                </p>
              </div>
              <div className="flex items-center gap-2 font-mono text-xs text-zinc-600">
                <span>
                  {new Date(interaction.timestamp * 1000).toLocaleTimeString()}
                </span>
                <span>&middot; LLM {interaction.llm_time}s</span>
                <span>&middot; TTS {interaction.tts_time}s</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
