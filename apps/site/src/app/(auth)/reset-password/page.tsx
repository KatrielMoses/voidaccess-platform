import { redirect } from "next/navigation";

// Sign-in is the only auth page now (the first sign-in creates the account). Old links land there, query kept.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string" && k === "next") q.set(k, v);
  redirect(q.size ? `/sign-in?${q}` : "/sign-in");
}
