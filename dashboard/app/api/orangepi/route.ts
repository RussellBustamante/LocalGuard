import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { ORANGEPI_HEALTH_URL, ORANGEPI_URL } from "@/lib/config";

const run = promisify(exec);
const ORANGEPI_HOST = (() => {
  try {
    return new URL(ORANGEPI_URL).hostname;
  } catch {
    return "192.168.50.3";
  }
})();
const SSH_TARGET = process.env.ORANGEPI_SSH_TARGET ?? `ubuntu@${ORANGEPI_HOST}`;
const SSH = `ssh -o ConnectTimeout=3 -o StrictHostKeyChecking=no ${SSH_TARGET}`;
const START_CMD =
  process.env.ORANGEPI_START_CMD ??
  "cd ~/voice-assistant && source ~/voice-assistant-venv/bin/activate && nohup python3 voice_server.py > /tmp/voice_server.log 2>&1 < /dev/null &";
const STOP_CMD = process.env.ORANGEPI_STOP_CMD ?? "pkill -f '[p]ython3 voice_server.py'";

async function isReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    await fetch(ORANGEPI_HEALTH_URL, {
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
    for (let i = 0; i < 20; i++) {
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
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (!(await isReachable()))
        return NextResponse.json({ ok: true, running: false });
    }
    return NextResponse.json({ ok: true, running: false });
  }

  return NextResponse.json({ error: "invalid action" }, { status: 400 });
}
