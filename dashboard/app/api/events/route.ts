import { NextResponse } from "next/server";
import { getTimelineEvents } from "@/lib/insights";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawLimit = searchParams.get("limit");
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : 50;

  try {
    const events = await getTimelineEvents(Number.isFinite(limit) ? limit : 50);
    return NextResponse.json({ events });
  } catch {
    return NextResponse.json({ events: [] });
  }
}
