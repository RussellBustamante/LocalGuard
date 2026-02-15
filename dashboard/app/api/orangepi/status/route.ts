import { NextResponse } from "next/server";
import { ORANGEPI_STATUS_URL } from "@/lib/config";

export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(ORANGEPI_STATUS_URL, {
      signal: controller.signal,
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({
      state: "offline",
      running: false,
      wake_word: "security",
      interactions: [],
    });
  } finally {
    clearTimeout(timeout);
  }
}
