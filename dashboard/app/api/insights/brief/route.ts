import { NextResponse } from "next/server";
import { getInsightsBrief } from "@/lib/insights";

export async function GET() {
  try {
    const data = await getInsightsBrief();
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
