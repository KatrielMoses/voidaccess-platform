import { NextResponse } from "next/server";
import { withUserRoute } from "@/lib/account/route-auth";
import { readBalance } from "@/lib/account/balance";

export const dynamic = "force-dynamic";

export function GET() {
  return withUserRoute(async (user) =>
    NextResponse.json({ total: await readBalance(user.id) }, { headers: { "cache-control": "no-store" } }),
  );
}
