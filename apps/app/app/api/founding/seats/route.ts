import { NextResponse } from "next/server";
import { FOUNDING } from "@voidaccess/config";
import { availableSeats } from "@voidaccess/db";
import { getEnv } from "@/env";

export const dynamic = "force-dynamic";

/**
 * Public founding-seat counter for the marketing site: { available, total, source: "db" }.
 * `available` counts reopened seats. Read-only, no user data, CORS limited to the site's origin.
 */
export async function GET() {
  const headers = {
    "Access-Control-Allow-Origin": getEnv().SITE_ORIGIN,
    Vary: "Origin",
    "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
  };
  try {
    return NextResponse.json(
      { available: await availableSeats(), total: FOUNDING.seats, source: "db" },
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: "unavailable" },
      { status: 503, headers: { ...headers, "Cache-Control": "no-store" } },
    );
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": getEnv().SITE_ORIGIN,
      "Access-Control-Allow-Methods": "GET",
      Vary: "Origin",
    },
  });
}
