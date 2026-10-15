import { adminPage } from "@/lib/admin/guard";
import { listBlockedDomains } from "@/lib/admin/queries";
import { ActionForm } from "@/components/admin/action-form";
import { Empty, Num, Page, Section, T, Td } from "@/components/admin/ui";
import { fmtDate } from "@/components/admin/format";

export default async function AdminBlockedDomains() {
  await adminPage();
  const domains = await listBlockedDomains();
  return (
    <Page
      title="Blocked email domains"
      subtitle="Sign-ups from these domains (and their subdomains) are rejected. Every change is audited."
    >
      <div className="max-w-xl">
        <ActionForm
          testId="block-domain"
          title="Block a domain"
          submit="Block domain"
          endpoint="/api/admin/blocked-domains"
          fields={[{ name: "domain", label: "Domain", placeholder: "example.com" }]}
          success="Domain blocked."
        />
      </div>
      <Section title="Blocked" testId="blocked-domains">
        {domains.length === 0 ? (
          <Empty>No blocked domains.</Empty>
        ) : (
          <T head={["Domain", "Reason", "Added by", "Added", "Unblock"]}>
            {domains.map((d) => (
              <tr key={d.domain}>
                <Td>
                  <Num className="text-[14px] text-paper">{d.domain}</Num>
                </Td>
                <Td className="max-w-sm break-words">{d.reason}</Td>
                <Td>
                  <Num className="text-dim">{d.createdBy?.slice(0, 13) ?? "—"}</Num>
                </Td>
                <Td className="whitespace-nowrap">
                  <Num className="text-dim">{fmtDate(d.createdAt, false)}</Num>
                </Td>
                <Td className="min-w-72">
                  <ActionForm
                    testId={`unblock-${d.domain}`}
                    title="Unblock"
                    submit="Unblock"
                    method="DELETE"
                    endpoint="/api/admin/blocked-domains"
                    hidden={{ domain: d.domain }}
                    success="Domain unblocked."
                  />
                </Td>
              </tr>
            ))}
          </T>
        )}
      </Section>
    </Page>
  );
}
