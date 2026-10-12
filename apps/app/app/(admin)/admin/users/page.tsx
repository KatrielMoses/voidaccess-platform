import Link from "next/link";
import { Button, Input } from "@voidaccess/ui";
import { adminPage } from "@/lib/admin/guard";
import { searchUsers } from "@/lib/admin/queries";
import { Empty, Page, StateBadge, T, Td, UserLink } from "@/components/admin/ui";
import { fmtDate, int } from "@/components/admin/format";

export default async function AdminUsers({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await adminPage();
  const { q = "", page = "0" } = await searchParams;
  const p = Math.max(0, Number.parseInt(page, 10) || 0);
  const { rows, hasMore } = await searchUsers(q, p);
  const href = (n: number) => `/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(n) })}`;
  return (
    <Page title="Users" subtitle="Search by email (partial) or exact user id.">
      <form method="get" className="flex max-w-xl gap-2" role="search">
        <Input
          name="q"
          defaultValue={q}
          placeholder="email or user id"
          aria-label="Search users"
          data-testid="user-search"
        />
        <Button type="submit">Search</Button>
      </form>
      {rows.length === 0 ? (
        <Empty>No users match.</Empty>
      ) : (
        <T testId="users" head={["Email", "Plan", "Status", "Role", "Credits", "Runs", "Signed up"]}>
          {rows.map((u) => (
            <tr key={u.id}>
              <Td>
                <UserLink id={u.id}>{u.email}</UserLink>
                {!u.emailVerified ? <span className="ml-2 text-xs text-warning">unverified</span> : null}
              </Td>
              <Td>{u.plan}</Td>
              <Td>
                <StateBadge value={u.status} />
              </Td>
              <Td>
                <StateBadge value={u.role} />
              </Td>
              <Td>{int(u.credits)}</Td>
              <Td>{u.investigations}</Td>
              <Td className="whitespace-nowrap">{fmtDate(u.createdAt)}</Td>
            </tr>
          ))}
        </T>
      )}
      <nav className="flex gap-4 text-sm" aria-label="Pages">
        {p > 0 ? <Link href={href(p - 1)}>← Newer</Link> : null}
        {hasMore ? <Link href={href(p + 1)}>Older →</Link> : null}
      </nav>
    </Page>
  );
}
