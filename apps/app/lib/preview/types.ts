/**
 * The preview marker every results payload carries (contract: PREVIEW-COMMON.md). The server decides and redacts;
 * the UI only reads these fields. Pure types and helpers: safe to import from client components.
 */
import type { AccessMarker, PreviewTotals } from "@/lib/access/shared";
import { LOCKED_ERROR } from "@/lib/access/shared";

export type { PreviewTotals };
export type AccessView = AccessMarker;

/** A payload that may carry the marker (payloads from before the preview change carry none: full). */
export interface WithAccess {
  access?: AccessView;
}

/** A placeholder row the server substituted for a locked one. */
export interface LockedFlag {
  locked?: boolean;
}

export const isPreview = (
  a: AccessView | null | undefined,
): a is { level: "preview"; totals: PreviewTotals } => a?.level === "preview";

export const isLockedRow = (r: unknown): boolean =>
  typeof r === "object" && r !== null && (r as LockedFlag).locked === true;

/** The API error code for a locked read (HTTP 402). */
export const PREVIEW_LOCKED = LOCKED_ERROR;

/** True when a fetch answered 402 { error: "preview_locked" }. Reads a clone, so the caller can still read the body. */
export async function isPreviewLockedResponse(res: Response): Promise<boolean> {
  if (res.status !== 402) return false;
  try {
    const body = (await res.clone().json()) as { error?: unknown };
    return body?.error === PREVIEW_LOCKED;
  } catch {
    return false;
  }
}

/** Placeholder text is the block glyph only: the UI draws a grey bar for it and never prints it. */
export const isLockedText = (s: unknown): boolean => typeof s === "string" && /^█+$/.test(s);
