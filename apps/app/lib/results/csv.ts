/**
 * CSV writer with spreadsheet formula-injection protection: a text cell that starts with = + - @ (or a tab
 * or carriage return, which some spreadsheets strip before evaluating) is prefixed with a single quote,
 * so Excel/Sheets/Numbers show it as text instead of running it.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" ? String(v) : String(v);
  if (typeof v !== "number" && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",") + "\r\n";
}

export function toCsv(header: string[], rows: Iterable<unknown[]>): string {
  let out = csvRow(header);
  for (const r of rows) out += csvRow(r);
  return out;
}
