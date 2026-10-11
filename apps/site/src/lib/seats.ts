import { FOUNDING } from "@voidaccess/config";

export interface Seats {
  available: number;
  total: number;
  source: "static" | "db";
}

/**
 * The single place the founding-seat count is read. Until P0's founding_seats table is merged
 * this returns the configured total with source "static" (no scarcity number is ever invented).
 * To wire the DB later, replace the body only; the route and the page counter don't change.
 */
export async function getFoundingSeats(): Promise<Seats> {
  return { available: FOUNDING.seats, total: FOUNDING.seats, source: "static" };
}
