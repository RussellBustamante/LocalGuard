import { NextResponse } from "next/server";
import { SPARK_DETECTIONS_URL } from "@/lib/config";

export async function GET() {
  try {
    const res = await fetch(SPARK_DETECTIONS_URL, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ fps: 0, detections: [] });
  }
}
