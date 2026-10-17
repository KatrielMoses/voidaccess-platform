/**
 * Layout of the live instrument (P8), shared by the canvas scene and the DOM overlay so both agree to the pixel.
 *
 * Desktop (>= 960px): eight hairline columns across the width (01 Refine ... 08 Summarize), a flow band where URLs
 * move left to right, the filter gate in column 03, the live graph across columns 07-08, and the discarded tray
 * along the bottom. Mobile: the stages stack as rows (marks in the right 58% of each row) and the tray sits below.
 */
import { STAGES } from "@voidaccess/config";
import { TRAY_BUCKETS, type TrayBucket } from "./model";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Geometry {
  w: number;
  h: number;
  small: boolean;
  /** each stage's area for marks (desktop: the column's flow band; mobile: the row's right part) */
  stage: Rect[];
  /** the whole column / row, for hairlines and labels */
  lane: Rect[];
  header: number;
  gateX: number;
  graph: Rect;
  tray: Rect;
  /** tray slots: where each bucket's dots settle (bottom-left of the stack) and its label sits */
  slot: Record<TrayBucket, { x: number; y: number; w: number; cols: number }>;
  /** tray stacks stop growing after this many rows (the tally keeps counting) */
  stackRows: number;
  /** the terrain starts here: behind the marks, never behind the text columns */
  terrainX: number;
  dot: number;
}

export const SMALL_MAX = 959;
const DESKTOP_H = 520;
const ROW_H = 58;

export function instrumentHeight(width: number): number {
  return width > SMALL_MAX ? DESKTOP_H : STAGES.length * ROW_H + 26 + 40 + 4 * 58;
}

export function layout(w: number): Geometry {
  const small = w <= SMALL_MAX;
  const h = instrumentHeight(w);
  const n = STAGES.length;
  if (!small) {
    const colW = w / n;
    const header = 78;
    const bandY = header + 22;
    const bandH = 232;
    const lane = STAGES.map((_, i) => ({ x: i * colW, y: 0, w: colW, h: bandY + bandH }));
    const stage = STAGES.map((_, i) => ({ x: i * colW + 14, y: bandY, w: colW - 28, h: bandH }));
    const trayY = bandY + bandH + 34;
    const tray = { x: 0, y: trayY, w, h: h - trayY };
    const slotW = w / TRAY_BUCKETS.length;
    const slot = {} as Geometry["slot"];
    TRAY_BUCKETS.forEach(([k], i) => {
      slot[k] = {
        x: i * slotW + 12,
        y: trayY + 82,
        w: slotW - 24,
        cols: Math.max(4, Math.floor((slotW - 24) / 4)),
      };
    });
    return {
      w,
      h,
      small,
      stage,
      lane,
      header,
      gateX: 2 * colW + colW / 2,
      graph: { x: 6 * colW + 16, y: bandY + 6, w: 2 * colW - 32, h: bandH - 12 },
      tray,
      slot,
      stackRows: 5,
      terrainX: colW,
      dot: 1.7,
    };
  }
  const lane = STAGES.map((_, i) => ({ x: 0, y: i * ROW_H, w, h: ROW_H }));
  const markX = Math.round(w * 0.42);
  const stage = STAGES.map((_, i) => ({ x: markX, y: i * ROW_H + 10, w: w - markX - 6, h: ROW_H - 20 }));
  const trayY = n * ROW_H + 26;
  const tray = { x: 0, y: trayY, w, h: h - trayY };
  const per = 4;
  const slotW = w / per;
  const slot = {} as Geometry["slot"];
  TRAY_BUCKETS.forEach(([k], i) => {
    const row = Math.floor(i / per);
    slot[k] = {
      x: (i % per) * slotW + 4,
      y: trayY + 54 + row * 58,
      w: slotW - 8,
      cols: Math.max(3, Math.floor((slotW - 8) / 4)),
    };
  });
  return {
    w,
    h,
    small,
    stage,
    lane,
    header: 0,
    gateX: markX + (w - markX) / 2,
    // the graph assembles across the extract, enrich and graph rows
    graph: { x: markX, y: 4 * ROW_H + 8, w: w - markX - 6, h: 3 * ROW_H - 16 },
    tray,
    slot,
    stackRows: 3,
    terrainX: markX,
    dot: 1.5,
  };
}
