import { NextResponse } from "next/server";
import { JETSON_VLM_RESULTS_URL } from "@/lib/config";

export async function GET() {
  try {
    const res = await fetch(JETSON_VLM_RESULTS_URL, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}
