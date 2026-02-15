"use client";

import { useEffect, useState } from "react";
import type { TimelineEvent } from "@/lib/types";

const LEVEL_CLASS: Record<TimelineEvent["level"], string> = {
  low: "text-zinc-500",
  guarded: "text-amber-400",
  elevated: "text-orange-400",
  critical: "text-red-400",
};

const TYPE_LABEL: Record<TimelineEvent["type"], string> = {
  person_count_change: "People",
  restricted_object_seen: "Object",
  proximity_alert: "Proximity",
  voice_query: "Voice",
};

export default function EventTimeline() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);

  useEffect(() => {
    let active = true;

    async function poll() {
      while (active) {
        try {
          const res = await fetch("/api/events?limit=30");
          if (res.ok) {
            const data: { events: TimelineEvent[] } = await res.json();
            if (active) setEvents(data.events ?? []);
          }
        } catch {
          // Keep current list.
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    poll();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-mono text-xs uppercase tracking-wider text-zinc-500">
        Timeline
      </h2>

      <div className="border border-zinc-800 bg-zinc-900/50 divide-y divide-zinc-800/50 max-h-[26rem] overflow-y-auto">
        {events.length === 0 ? (
          <p className="p-4 font-mono text-xs text-zinc-600">No events yet</p>
        ) : (
          events.map((event) => (
            <div key={event.id} className="p-3 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className={`font-mono text-[11px] uppercase tracking-wider ${LEVEL_CLASS[event.level]}`}>
                  {TYPE_LABEL[event.type]}
                </span>
                <span className="font-mono text-[11px] text-zinc-600">
                  {new Date(event.timestamp * 1000).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-sm text-zinc-300 leading-snug">{event.message}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
