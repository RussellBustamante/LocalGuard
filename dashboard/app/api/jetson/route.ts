import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { JETSON_URL } from "@/lib/config";

const run = promisify(exec);
const SSH =
  "ssh -o ConnectTimeout=3 -o StrictHostKeyChecking=no antwon@192.168.50.4";

async function isReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    await fetch(JETSON_URL, { signal: controller.signal, cache: "no-store" });
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
      await run(
        `${SSH} "cd ~/yolo && source .venv/bin/activate && nohup python3 stream.py > /tmp/stream.log 2>&1 &"`
      );
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
      await run(`${SSH} "pkill -f 'python3 stream.py'"`);
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
