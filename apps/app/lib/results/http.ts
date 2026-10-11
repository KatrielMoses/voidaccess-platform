import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/dev-session";
import type { EntityQuery, EntitySort } from "./types";

export const json404 = () =>
  NextResponse.json(
    { error: "not_found" },
    { status: 404, headers: { "Cache-Control": "private, no-store" } },
  );
export const json401 = () =>
  NextResponse.json(
    { error: "unauthorized" },
    { status: 401, headers: { "Cache-Control": "private, no-store" } },
  );
export const jsonOk = (body: unknown) =>
  NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });

/** The signed-in user comes from the session only; no route reads a user id from the request. */
export async function sessionUser(): Promise<string | null> {
  return getSessionUserId();
}

const SORTS: readonly EntitySort[] = ["value", "type", "confidence", "firstSeen", "sources", "degree"];
const num = (v: string | null) =>
  v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined;

export function parseEntityQuery(sp: URLSearchParams): EntityQuery {
  const sort = sp.get("sort");
  const dir = sp.get("dir");
  const types = sp.get("types")?.split(",").filter(Boolean);
  return {
    q: sp.get("q")?.slice(0, 200) || undefined,
    types: types?.length ? types.slice(0, 100) : undefined,
    minConfidence: num(sp.get("min")),
    maxConfidence: num(sp.get("max")),
    sensitiveOnly: sp.get("sensitive") === "1",
    sort: SORTS.includes(sort as EntitySort) ? (sort as EntitySort) : undefined,
    dir: dir === "asc" || dir === "desc" ? dir : undefined,
    offset: num(sp.get("offset")),
    limit: num(sp.get("limit")),
  };
}
