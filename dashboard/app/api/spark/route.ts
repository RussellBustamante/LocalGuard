import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { SPARK_HEALTH_URL, SPARK_URL } from "@/lib/config";

const run = promisify(exec);
const SPARK_HOST = (() => {
  try {
    return new URL(SPARK_URL).hostname;
  } catch {
    return "192.168.50.2";
  }
})();
const SSH_TARGET = process.env.SPARK_SSH_TARGET ?? `asus@${SPARK_HOST}`;
const SSH = `ssh -o ConnectTimeout=3 -o StrictHostKeyChecking=no ${SSH_TARGET}`;
const START_CMD =
  process.env.SPARK_START_CMD ??
  "cd ~/cam-inference && source .venv/bin/activate && nohup python3 spark_server.py > /tmp/spark_server.log 2>&1 < /dev/null &";
const STOP_CMD = process.env.SPARK_STOP_CMD ?? "pkill -f '[p]ython3 spark_server.py'";

async function isReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    await fetch(SPARK_HEALTH_URL, {
      signal: controller.signal,
      cache: "no-store",
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  return NextResponse.json({ running: await isReachable() });
}

export async function POST(req: Request) {
  const { action } = await req.json();

  if (action === "start") {
    try {
      await run(`${SSH} -f "${START_CMD}"`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "unknown error";
      return NextResponse.json(
        { ok: false, running: false, error: msg },
        { status: 500 }
      );
    }
    // Poll until server is actually serving (max 15s)
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await isReachable())
        return NextResponse.json({ ok: true, running: true });
    }
    return NextResponse.json({ ok: true, running: false });
  }

  if (action === "stop") {
    try {
      await run(`${SSH} "${STOP_CMD}"`);
    } catch {
      // pkill returns non-zero if no matching process
    }
    // Verify it's actually down (max 3s)
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (!(await isReachable()))
        return NextResponse.json({ ok: true, running: false });
    }
    return NextResponse.json({ ok: true, running: false });
  }

  return NextResponse.json({ error: "invalid action" }, { status: 400 });
}
