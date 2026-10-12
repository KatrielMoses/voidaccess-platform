/** Formatting helpers. Every number shown comes from @voidaccess/config; nothing is typed in here. */
export const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
export const centsToUsd = (cents: number) => usd(cents / 100);
export const num = (n: number) => n.toLocaleString("en-US");
export const dateFmt = (d: Date | string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "";
