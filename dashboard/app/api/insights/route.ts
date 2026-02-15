import { NextResponse } from "next/server";
import { getInsightsSnapshot } from "@/lib/insights";

export async function GET() {
  try {
    const data = await getInsightsSnapshot();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      {
        error: "insights_unavailable",
      },
      { status: 503 }
    );
  }
}
