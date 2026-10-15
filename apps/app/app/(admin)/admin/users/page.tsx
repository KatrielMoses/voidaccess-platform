import Link from "next/link";
import { Button, Input } from "@voidaccess/ui";
import { adminPage } from "@/lib/admin/guard";
import { searchUsers } from "@/lib/admin/queries";
import { Empty, Num, Page, StateBadge, T, Td, UserLink } from "@/components/admin/ui";
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
      <form method="get" className="flex max-w-xl gap-2.5" role="search">
        <Input
          name="q"
          defaultValue={q}
          placeholder="email or user id"
          aria-label="Search users"
          data-testid="user-search"
        />
        <Button type="submit" variant="secondary" size="lg">
          Search
        </Button>
      </form>
      {rows.length === 0 ? (
        <Empty>No users match.</Empty>
      ) : (
        <T testId="users" head={["Email", "Plan", "Status", "Role", "Credits", "Runs", "Signed up"]}>
          {rows.map((u) => (
            <tr key={u.id}>
              <Td>
                <UserLink id={u.id}>{u.email}</UserLink>
                {!u.emailVerified ? (
                  <span className="ml-2.5 font-mono text-[12px] text-dim">! unverified</span>
                ) : null}
              </Td>
              <Td>
                <Num className="text-dim">{u.plan}</Num>
              </Td>
              <Td>
                <StateBadge value={u.status} />
              </Td>
              <Td>
                <StateBadge value={u.role} />
              </Td>
              <Td>
                <Num>{int(u.credits)}</Num>
              </Td>
              <Td>
                <Num>{u.investigations}</Num>
              </Td>
              <Td className="whitespace-nowrap">
                <Num className="text-dim">{fmtDate(u.createdAt)}</Num>
              </Td>
            </tr>
          ))}
        </T>
      )}
      <nav className="flex gap-6 text-[15px]" aria-label="Pages">
        {p > 0 ? (
          <Link href={href(p - 1)} className="ul-link">
            ← Newer
          </Link>
        ) : null}
        {hasMore ? (
          <Link href={href(p + 1)} className="ul-link">
            Older →
          </Link>
        ) : null}
      </nav>
    </Page>
  );
}
