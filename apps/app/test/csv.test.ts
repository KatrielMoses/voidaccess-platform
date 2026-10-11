import { describe, expect, it } from "vitest";
import { csvCell, csvRow, toCsv } from "@/lib/results/csv";

describe("CSV formula injection guard", () => {
  it.each(["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\t=1", "\r=1"])("prefixes %j with a quote", (v) => {
    expect(csvCell(v).replace(/^"|"$/g, "")).toMatch(/^'/);
  });
  it("leaves ordinary text, numbers and empty cells alone", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell(0.9)).toBe("0.9");
    expect(csvCell(-1)).toBe("-1"); // a real number we generated is not a formula
    expect(csvCell(null)).toBe("");
    expect(csvCell(true)).toBe("true");
  });
  it("quotes commas, quotes and newlines, and still guards the start", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
  });
  it("guards every cell of a row", () => {
    expect(csvRow(["ok", "=2*2", "-9"])).toBe("ok,'=2*2,'-9\r\n");
    expect(toCsv(["h"], [["@x"]])).toBe("h\r\n'@x\r\n");
  });
});
