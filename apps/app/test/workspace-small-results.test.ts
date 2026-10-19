import { describe, expect, it } from "vitest";
import {
  SMALL_GRAPH_LABEL_ALL,
  THIN_RESULT,
  labelClearance,
  minFitRatio,
  thinResultNote,
} from "@/lib/results/small-results";

describe("small results read as small, not broken", () => {
  it("a fit never stretches a small result across the canvas", () => {
    expect(minFitRatio(1)).toBeGreaterThan(2);
    expect(minFitRatio(5)).toBeGreaterThan(1.5);
    expect(minFitRatio(40)).toBeGreaterThan(1);
    expect(minFitRatio(41)).toBeLessThan(1);
    for (let n = 1; n < 60; n++) expect(minFitRatio(n)).toBeGreaterThanOrEqual(minFitRatio(n + 1));
  });

  it("labels stay clear when values are far enough apart sideways or vertically", () => {
    expect(labelClearance([])).toBe(Infinity);
    // a column: only vertical room is needed (22 px per label line)
    expect(
      labelClearance([
        { x: 0, y: 0 },
        { x: 0, y: 44 },
      ]),
    ).toBe(2);
    // a row: a label's width is needed (130 px)
    expect(
      labelClearance([
        { x: 0, y: 0 },
        { x: 260, y: 0 },
      ]),
    ).toBe(2);
    // the closest pair decides
    expect(
      labelClearance([
        { x: 0, y: 0 },
        { x: 0, y: 220 },
        { x: 13, y: 2 },
      ]),
    ).toBeCloseTo(0.1);
  });

  it("small results label every value; tiny ones get a note", () => {
    expect(SMALL_GRAPH_LABEL_ALL).toBeGreaterThanOrEqual(THIN_RESULT);
  });

  it("explains a thin result plainly", () => {
    expect(thinResultNote(5, 0)).toBe(
      "5 values found. None of them appeared together on the same page, so there are no links to draw.",
    );
    expect(thinResultNote(1, 0)).toMatch(/^1 value found\./);
    expect(thinResultNote(8, 3)).toMatch(/^8 values found\. A small result/);
  });
});
