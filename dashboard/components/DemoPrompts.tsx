"use client";

import { useState } from "react";

interface Prompt {
  label: string;
  text: string;
  category: "intent" | "context" | "premium";
}

const PROMPTS: Prompt[] = [
  { label: "Status",           text: "Security, status.",                          category: "intent" },
  { label: "People Count",     text: "Security, how many people?",                 category: "intent" },
  { label: "Nearest Person",   text: "Security, nearest person?",                  category: "intent" },
  { label: "Restricted",       text: "Security, any restricted objects right now?", category: "context" },
  { label: "Last Event",       text: "Security, what was the last event?",          category: "context" },
  { label: "Scene Summary",    text: "Security, give me a richer scene summary.",   category: "premium" },
];

const CATEGORY_STYLES: Record<Prompt["category"], { label: string; badge: string }> = {
  intent:  { label: "Fast Intent",   badge: "bg-emerald-950/70 text-emerald-300" },
  context: { label: "Context",       badge: "bg-amber-950/70 text-amber-300" },
  premium: { label: "Premium Spark", badge: "bg-violet-950/70 text-violet-300" },
};

export default function DemoPrompts() {
  const [copied, setCopied] = useState<string | null>(null);

  function handleCopy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1200);
    });
  }

  // Group by category
  const groups = (["intent", "context", "premium"] as const).map((cat) => ({
    ...CATEGORY_STYLES[cat],
    category: cat,
    prompts: PROMPTS.filter((p) => p.category === cat),
  }));

  return (
    <div className="border border-zinc-800 bg-zinc-900/50 p-4">
      <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-500 mb-3">
        Demo Prompts
      </h2>

      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group.category}>
            <span className={`inline-block font-mono text-[10px] px-1.5 py-0.5 rounded mb-1.5 ${group.badge}`}>
              {group.label}
            </span>
            <div className="space-y-1.5">
              {group.prompts.map((prompt) => (
                <div
                  key={prompt.label}
                  className="flex items-center justify-between gap-2 bg-zinc-950/50 border border-zinc-800 px-3 py-2 group"
                >
                  <div className="min-w-0">
                    <span className="font-mono text-[11px] text-zinc-500 block">
                      {prompt.label}
                    </span>
                    <span className="text-sm text-zinc-300 block truncate">
                      {prompt.text}
                    </span>
                  </div>
                  <button
                    onClick={() => handleCopy(prompt.text, prompt.label)}
                    className="shrink-0 font-mono text-[10px] uppercase tracking-wider px-2 py-1 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
                  >
                    {copied === prompt.label ? "Done" : "Copy"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
