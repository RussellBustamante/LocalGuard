"use client";

import { useState, useEffect, useCallback } from "react";

export function useNodeStatus(apiRoute?: string) {
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(!!apiRoute);

  useEffect(() => {
    if (!apiRoute) return;
    let active = true;

    const check = async () => {
      try {
        const res = await fetch(apiRoute);
        const data = await res.json();
        if (active) setRunning(data.running);
      } catch {
        if (active) setRunning(false);
      }
      if (active) setLoading(false);
    };

    check();
    const id = setInterval(check, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [apiRoute]);

  const toggle = useCallback(async () => {
    if (!apiRoute) return;
    setLoading(true);
    const action = running ? "stop" : "start";
    try {
      const res = await fetch(apiRoute, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      setRunning(data.running);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [apiRoute, running]);

  return { running, loading, toggle };
}
