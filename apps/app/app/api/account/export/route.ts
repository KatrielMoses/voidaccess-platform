import { NextResponse } from "next/server";
import { exportAccountData } from "@/lib/account/export";
import { withUserRoute } from "@/lib/account/route-auth";

export const dynamic = "force-dynamic";

export function GET() {
  return withUserRoute(async (user) => {
    const data = await exportAccountData(user.id);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": 'attachment; filename="voidaccess-export.json"',
        "cache-control": "no-store",
      },
    });
  });
}
