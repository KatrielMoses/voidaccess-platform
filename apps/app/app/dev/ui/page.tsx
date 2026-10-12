import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { Showcase } from "./showcase";

export const metadata = { title: "UI kit | VoidAccess" };
export const dynamic = "force-dynamic";

/** Reachable only in development, or by a signed-in admin. Everything else gets a 404. */
export default async function DevUiPage() {
  if (process.env.NODE_ENV !== "development") {
    const user = await getSessionUser().catch(() => null);
    if (user?.role !== "admin" || user.status !== "active") notFound();
  }
  return <Showcase />;
}
