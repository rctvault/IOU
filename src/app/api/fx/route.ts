import { NextResponse } from "next/server";
import { getFxRate } from "@/lib/fx";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json(
      { error: "Missing 'from' or 'to' query parameter" },
      { status: 400 },
    );
  }

  try {
    const result = await getFxRate(from, to);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "FX lookup failed" },
      { status: 502 },
    );
  }
}
