import { CheckEmail } from "./check-email";

export const metadata = { title: "Check your email | VoidAccess" };

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  return <CheckEmail email={email ?? ""} />;
}
