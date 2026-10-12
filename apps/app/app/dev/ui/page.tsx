import { notFound } from "next/navigation";
import { Showcase } from "./showcase";

export const metadata = { title: "UI kit | VoidAccess" };
export const dynamic = "force-dynamic";

/** Development only. Closed in production for everyone, admins included: a 404. */
export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Showcase />;
}
