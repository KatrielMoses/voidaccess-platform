/** Server-side: the unlock price for one user, with the same founding rule as Billing (lib/billing/view.ts). */
import { availableSeats, getDatabase, type Database } from "@voidaccess/db";
import { currentSubscription, foundingState } from "@/lib/billing/plan-ops";
import { chooseUnlockOffer, type UnlockOffer } from "./offer";

export async function loadUnlockOffer(
  userId: string,
  database: Database = getDatabase(),
): Promise<UnlockOffer> {
  const [sub, fs, seats] = await Promise.all([
    currentSubscription(userId, database),
    foundingState(userId, database),
    availableSeats({ database }),
  ]);
  return chooseUnlockOffer({ seatsAvailable: seats, holdsSeat: fs.held, hasSubscription: sub !== null });
}
