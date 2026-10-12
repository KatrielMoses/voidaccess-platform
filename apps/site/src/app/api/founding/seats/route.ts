import { NextResponse } from "next/server";
import { getFoundingSeats } from "@/lib/seats";
import { minimalGuard } from "@/lib/site-mode";

export const dynamic = "force-dynamic";

export async function GET() {
  const off = minimalGuard();
  if (off) return off;
  return NextResponse.json(await getFoundingSeats(), { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
}
