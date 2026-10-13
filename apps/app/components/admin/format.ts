export const fmtDate = (d: Date | string | null | undefined, time = true) => {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  const day = x.toISOString().slice(0, 10);
  return time ? `${day} ${x.toISOString().slice(11, 16)}Z` : day;
};
export const usd = (n: number, digits = 4) => `$${n.toFixed(digits)}`;
export const pct = (n: number | null, digits = 1) => (n === null ? "—" : `${(n * 100).toFixed(digits)}%`);
export const int = (n: number) => n.toLocaleString("en-US");
