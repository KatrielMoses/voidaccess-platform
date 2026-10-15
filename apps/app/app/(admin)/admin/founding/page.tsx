import { FOUNDING } from "@voidaccess/config";
import { adminPage } from "@/lib/admin/guard";
import { getFounding } from "@/lib/admin/queries";
import { Empty, Num, Page, Section, Stat, StatGrid, T, Td, UserLink } from "@/components/admin/ui";
import { fmtDate } from "@/components/admin/format";

export default async function AdminFounding() {
  await adminPage();
  const f = await getFounding();
  return (
    <Page
      title="Founding seats"
      subtitle={`${FOUNDING.seats} seats at $${FOUNDING.monthlyUsd}/mo. Renewal needs ${FOUNDING.renewalMinPaidMonthsInTrailing12} paid months in the last ${FOUNDING.termMonths}; ${FOUNDING.inactivityReleaseMonths} months without an investigation releases the seat.`}
    >
      <StatGrid cols={3}>
        <Stat label="Held" value={f.held.length} testId="founding-held" />
        <Stat label="Available" value={f.available} testId="founding-available" />
        <Stat label="Capacity" value={f.seats} />
      </StatGrid>
      <Section title="Holders" testId="founding-holders">
        {f.held.length === 0 ? (
          <Empty>No seats held yet.</Empty>
        ) : (
          <T
            head={[
              "Seat",
              "Holder",
              "Term start",
              "Anniversary",
              "Paid months (12)",
              "Last investigation",
              "Pending notice",
            ]}
          >
            {f.held.map((h) => (
              <tr key={h.seatNo}>
                <Td>
                  <Num>#{h.seatNo}</Num>
                </Td>
                <Td>
                  <UserLink id={h.userId}>{h.email}</UserLink>
                </Td>
                <Td className="whitespace-nowrap">
                  <Num className="text-dim">{fmtDate(h.termStart, false)}</Num>
                </Td>
                <Td className="whitespace-nowrap">
                  <Num className="text-dim">{fmtDate(h.anniversaryAt, false)}</Num>
                </Td>
                <Td>
                  {h.paidMonths12} of {FOUNDING.renewalMinPaidMonthsInTrailing12} needed
                </Td>
                <Td className="whitespace-nowrap">
                  <Num className="text-dim">{fmtDate(h.lastInvestigationAt, false)}</Num>
                </Td>
                <Td>
                  {h.pendingNotice
                    ? `${h.pendingNotice.kind} on ${fmtDate(h.pendingNotice.scheduledFor, false)}`
                    : "—"}
                </Td>
              </tr>
            ))}
          </T>
        )}
      </Section>
      {f.released.length > 0 ? (
        <Section title="Recently released" hint="Seats that went back to the pool.">
          <T head={["Seat", "Released", "Reason"]}>
            {f.released.map((r) => (
              <tr key={r.seatNo}>
                <Td>
                  <Num>#{r.seatNo}</Num>
                </Td>
                <Td>
                  <Num className="text-dim">{fmtDate(r.releasedAt, false)}</Num>
                </Td>
                <Td>{r.reason ?? "—"}</Td>
              </tr>
            ))}
          </T>
        </Section>
      ) : null}
    </Page>
  );
}
