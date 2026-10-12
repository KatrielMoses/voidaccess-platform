import { ResetForm } from "./form";

export const metadata = { title: "Choose a new password | VoidAccess" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  return <ResetForm token={token ?? null} invalid={Boolean(error) || !token} />;
}
