import { NextResponse } from "next/server";
import { getFoundingSeats } from "@/lib/seats";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getFoundingSeats(), { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
}
