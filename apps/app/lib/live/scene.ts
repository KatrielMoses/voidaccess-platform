/**
 * The live instrument's marks (P8), drawn on one 2D canvas (GPU-composited) over the terrain, plus a pool of at most
 * MAX_LABELS DOM labels for hosts and masked entity values (textContent only: nothing is ever HTML or a link).
 *
 * What each motion means:
 *  - a dot drifting in from a search engine's row: a URL found (url.found), labelled with its display host;
 *  - the dot moving through the filter gate and on: kept (url.kept); falling into the tray under its reason: dropped;
 *  - from fetch into extract: the page was read; falling into the tray under 404 / timeout / Tor error ...: it wasn't;
 *  - a glyph rising out of a page with its masked value, then flying into the graph: an entity found on that page;
 *    hairlines between graph nodes: entities found on the same page.
 *
 * Particles keep logical stops (zone + stable seeds), not pixels, so a resize simply re-targets them. Motion is an
 * exponential approach (expo.out-like), never linear or bouncy. Settled tray dots are cheap squares.
 */
import { STAGES, type Stage } from "@voidaccess/config";
import { glyphFor, type ShapeName } from "@/lib/results/glyphs";
import { layout, type Geometry } from "./geometry";
import type { Effect, LiveModel, TrayBucket } from "./model";

export const MAX_LABELS = 80;
const HOST_LABEL_MS = 2400;
const ENTITY_LABEL_MS = 1700;
const PAPER = "243,241,236";

type Stop =
  | { z: "spawn" }
  | { z: "stage"; s: number }
  | { z: "gate" }
  | { z: "tray"; b: TrayBucket; k: number }
  | { z: "rise" }
  | { z: "graph" };

interface Particle {
  id: string;
  kind: "url" | "entity";
  x: number;
  y: number;
  stops: Stop[];
  at: Stop;
  hold: number;
  /** stable seeds 0..1 for the position inside a zone */
  u: number;
  v: number;
  alpha: number;
  targetAlpha: number;
  label: HTMLSpanElement | null;
  labelUntil: number;
  shape?: ShapeName;
  /** entity: the page it came from; url: the engine row it was found by */
  ref?: string;
  settled: boolean;
  /** graph layout (entities): normalised position and velocity */
  gx?: number;
  gy?: number;
  vx?: number;
  vy?: number;
  /** entity: how far above its page it rises (px) */
  rise?: number;
  riseFrom?: number;
}

function hash(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

export interface SceneOptions {
  /** mobile: show one URL in `urlSample`, fewer labels */
  urlSample: number;
  hostLabels: number;
  entityLabels: number;
  maxNodes: number;
}

export class LiveScene {
  g: Geometry;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private parts = new Map<string, Particle>();
  private urls: Particle[] = [];
  private nodes: Particle[] = [];
  private edges: [Particle, Particle][] = [];
  private trayCount: Partial<Record<TrayBucket, number>> = {};
  private labels: HTMLSpanElement[] = [];
  private freeLabels: HTMLSpanElement[] = [];
  private hostShown = 0;
  private entityShown = 0;
  private heat = 0;
  private now = 0;
  selected: string | null = null;
  opts: SceneOptions;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly labelLayer: HTMLElement,
    private readonly model: LiveModel,
    width: number,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.g = layout(width);
    this.opts = optionsFor(this.g.small);
    for (let i = 0; i < MAX_LABELS; i++) {
      const el = document.createElement("span");
      el.className = "va-live-label";
      el.style.opacity = "0";
      labelLayer.appendChild(el);
      this.labels.push(el);
      this.freeLabels.push(el);
    }
    this.resize(width);
  }

  resize(width: number): void {
    this.g = layout(width);
    this.opts = optionsFor(this.g.small);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.g.w * this.dpr);
    this.canvas.height = Math.round(this.g.h * this.dpr);
    this.canvas.style.width = `${this.g.w}px`;
    this.canvas.style.height = `${this.g.h}px`;
  }

  get labelCount(): number {
    return MAX_LABELS - this.freeLabels.length;
  }
  get particleCount(): number {
    return this.parts.size;
  }

  // ---- building from the model ------------------------------------------------------------------------------

  private sampled(id: string): boolean {
    return this.opts.urlSample <= 1 || hash(id, 7) < 1 / this.opts.urlSample;
  }

  private make(id: string, kind: Particle["kind"], at: Stop, ref?: string): Particle {
    const p: Particle = {
      id,
      kind,
      x: 0,
      y: 0,
      stops: [],
      at,
      hold: 0,
      u: hash(id, 1),
      v: hash(id, 2),
      alpha: 0,
      targetAlpha: 0.6,
      label: null,
      labelUntil: 0,
      ref,
      settled: false,
    };
    const [x, y] = this.pos(p, at);
    p.x = x;
    p.y = y;
    this.parts.set(id, p);
    return p;
  }

  private trayStop(b: TrayBucket): Stop {
    const k = this.trayCount[b] ?? 0;
    this.trayCount[b] = k + 1;
    return { z: "tray", b, k };
  }

  /** Where a URL rests given its trail (fast-forward and reloads). */
  private restingStop(id: string): Stop {
    const u = this.model.urls.get(id)!;
    if (u.state === "dropped" || u.state === "failed") return this.trayStop(u.dropReason!);
    if (u.state === "kept") return { z: "stage", s: 3 };
    if (u.state === "fetched") return { z: "stage", s: 4 };
    return { z: "stage", s: 1 };
  }

  /** Create marks for everything in the model that has none yet, at rest (no motion). */
  sync(): void {
    for (const id of this.model.urlOrder) {
      if (this.parts.has(id) || !this.sampled(id)) continue;
      const p = this.make(id, "url", this.restingStop(id), this.model.urls.get(id)!.engine ?? undefined);
      p.alpha = p.targetAlpha = this.restAlpha(p);
      p.settled = p.at.z === "tray";
      this.urls.push(p);
    }
    for (const id of this.model.entityOrder) {
      if (this.parts.has(id) || this.nodes.length >= this.opts.maxNodes) continue;
      this.addNode(id, false);
    }
    for (const [a, b] of this.model.edges) this.addEdge(a, b);
  }

  private restAlpha(p: Particle): number {
    if (p.kind === "entity") return 0.95;
    if (p.at.z === "tray") return 0.34;
    if (p.at.z === "stage" && p.at.s === 1) return 0.5;
    if (p.at.z === "stage" && p.at.s === 4) return 0.62;
    return 0.85;
  }

  private addNode(id: string, animate: boolean, pageId?: string): void {
    const e = this.model.entities.get(id);
    if (!e) return;
    const page = pageId ? this.parts.get(pageId) : undefined;
    const p = this.make(id, "entity", animate ? { z: "rise" } : { z: "graph" }, pageId);
    p.shape = glyphFor(e.type).shape;
    // seed the layout near the centre, spread by a golden-angle spiral
    const i = this.nodes.length;
    const a = i * 2.39996;
    const r = 0.06 + 0.32 * Math.sqrt(i / Math.max(40, this.opts.maxNodes));
    p.gx = 0.5 + Math.cos(a) * r;
    p.gy = 0.5 + Math.sin(a) * r;
    p.vx = 0;
    p.vy = 0;
    this.nodes.push(p);
    this.heat = 1;
    if (animate) {
      if (page) {
        p.x = page.x;
        p.y = page.y;
      } else {
        const [x, y] = this.pos(p, { z: "stage", s: 4 });
        p.x = x;
        p.y = y;
      }
      p.stops = [{ z: "graph" }];
      p.targetAlpha = 1;
      // entities from one page rise to stacked rows so their values never sit on top of each other
      const rising = this.nodes.filter((o) => o !== p && o.ref === pageId && o.at.z === "rise").length;
      // only the first few from a page are named and held; the rest rise briefly and go straight to the graph
      const named = rising < 4 && this.entityShown < this.opts.entityLabels;
      p.rise = 14 + Math.min(rising, 3) * 13;
      p.hold = named ? ENTITY_LABEL_MS / 1000 : 0.35;
      if (named) this.attachLabel(p, e.display, ENTITY_LABEL_MS);
    } else {
      p.alpha = p.targetAlpha = 0.95;
      const [x, y] = this.pos(p, { z: "graph" });
      p.x = x;
      p.y = y;
    }
  }

  private addEdge(a: string, b: string): void {
    const pa = this.parts.get(a);
    const pb = this.parts.get(b);
    if (!pa || !pb || pa.kind !== "entity" || pb.kind !== "entity") return;
    this.edges.push([pa, pb]);
    this.heat = Math.max(this.heat, 0.6);
  }

  // ---- effects ----------------------------------------------------------------------------------------------

  apply(fx: Effect[]): void {
    for (const f of fx) {
      switch (f.e) {
        case "url": {
          if (!this.sampled(f.id)) break;
          const u = this.model.urls.get(f.id)!;
          const p = this.make(f.id, "url", { z: "spawn" }, u.engine ?? undefined);
          p.stops = [{ z: "stage", s: 1 }];
          p.targetAlpha = 0.55;
          this.urls.push(p);
          // one in three hosts is named while it arrives: enough to read the stream, never a wall of text
          if (u.host && hash(f.id, 3) < 0.34 && this.hostShown < this.opts.hostLabels)
            this.attachLabel(p, u.host, HOST_LABEL_MS);
          break;
        }
        case "keep": {
          const p = this.parts.get(f.id);
          if (!p) break;
          p.stops = [{ z: "gate" }, { z: "stage", s: 3 }];
          p.targetAlpha = 0.9;
          break;
        }
        case "drop":
        case "fail": {
          const p = this.parts.get(f.id);
          if (!p) break;
          if (this.model.urls.get(f.id)?.safety) this.detachLabel(p); // no host, ever, once the filter removed it
          p.stops = f.e === "drop" ? [{ z: "gate" }, this.trayStop(f.bucket)] : [this.trayStop(f.bucket)];
          p.targetAlpha = 0.34;
          break;
        }
        case "fetched": {
          const p = this.parts.get(f.id);
          if (!p) break;
          p.stops = [{ z: "stage", s: 4 }];
          p.targetAlpha = 0.95;
          break;
        }
        case "entity":
          if (this.nodes.length < this.opts.maxNodes) this.addNode(f.id, true, f.urlId);
          break;
        case "edge":
          this.addEdge(f.a, f.b);
          break;
        case "stage":
          break;
      }
    }
  }

  // ---- labels -----------------------------------------------------------------------------------------------

  private attachLabel(p: Particle, text: string, ms: number): void {
    const el = this.freeLabels.pop();
    if (!el) return;
    el.textContent = text; // text only
    el.dataset.kind = p.kind;
    el.style.opacity = "0";
    p.label = el;
    p.labelUntil = this.now + ms / 1000;
    if (p.kind === "url") this.hostShown++;
    else this.entityShown++;
  }

  private detachLabel(p: Particle): void {
    if (!p.label) return;
    p.label.style.opacity = "0";
    p.label.textContent = "";
    this.freeLabels.push(p.label);
    p.label = null;
    if (p.kind === "url") this.hostShown--;
    else this.entityShown--;
  }

  // ---- positions --------------------------------------------------------------------------------------------

  private engineRowY(engine: string | undefined): number {
    const g = this.g;
    const engines = [...this.model.engines.keys()];
    const i = engine ? engines.indexOf(engine) : -1;
    if (g.small) return g.stage[1]!.y + g.stage[1]!.h / 2;
    const top = g.stage[0]!.y + 92;
    return i < 0 ? top + 60 : top + 8 + i * 16;
  }

  private pos(p: Particle, s: Stop): [number, number] {
    const g = this.g;
    switch (s.z) {
      case "spawn": {
        if (g.small) return [g.stage[1]!.x - 8, g.stage[1]!.y + p.v * g.stage[1]!.h];
        return [g.stage[0]!.x + g.stage[0]!.w + 4, this.engineRowY(p.ref)];
      }
      case "stage": {
        const r = g.stage[s.s]!;
        // collect is a loose cloud; later stages are calmer, tighter bands
        const spread = s.s === 1 ? 1 : 0.8;
        return [r.x + (0.5 + (p.u - 0.5) * spread) * r.w, r.y + (0.5 + (p.v - 0.5) * spread) * r.h];
      }
      case "gate": {
        if (g.small) {
          const r = g.stage[2]!;
          return [r.x + p.u * r.w, r.y + r.h / 2];
        }
        const r = g.stage[2]!;
        return [g.gateX, r.y + (0.12 + p.v * 0.76) * r.h];
      }
      case "tray": {
        const sl = g.slot[s.b];
        const shown = Math.min(s.k, g.stackRows * sl.cols - 1); // stacks stop growing; the tally keeps counting
        return [sl.x + (shown % sl.cols) * 4 + 1, sl.y - 6 - Math.floor(shown / sl.cols) * 4];
      }
      case "rise":
        return [p.x, p.y];
      case "graph": {
        const r = g.graph;
        return [r.x + (p.gx ?? 0.5) * r.w, r.y + (p.gy ?? 0.5) * r.h];
      }
    }
  }

  // ---- simulation -------------------------------------------------------------------------------------------

  private layoutGraph(dt: number): void {
    if (this.heat < 0.01 || this.nodes.length === 0) return;
    const n = this.nodes;
    const aspect = this.g.graph.w / Math.max(1, this.g.graph.h);
    const k = 0.9 / Math.sqrt(Math.max(12, n.length));
    const step = Math.min(dt, 0.05) * this.heat;
    for (let i = 0; i < n.length; i++) {
      const a = n[i]!;
      let fx = (0.5 - a.gx!) * 0.35;
      let fy = (0.5 - a.gy!) * 0.35 * aspect;
      for (let j = 0; j < n.length; j++) {
        if (i === j) continue;
        const b = n[j]!;
        const dx = (a.gx! - b.gx!) * aspect;
        const dy = a.gy! - b.gy!;
        const d2 = dx * dx + dy * dy + 1e-4;
        if (d2 > 0.04) continue;
        const f = (k * k) / d2;
        fx += (dx / aspect) * f * 1.2;
        fy += dy * f * 1.2;
      }
      a.vx = (a.vx! + fx * step) * 0.82;
      a.vy = (a.vy! + fy * step) * 0.82;
    }
    for (const [a, b] of this.edges) {
      const dx = b.gx! - a.gx!;
      const dy = b.gy! - a.gy!;
      const d = Math.sqrt(dx * dx + dy * dy) + 1e-4;
      const f = (d - k * 0.9) * 2.2 * step;
      a.vx! += (dx / d) * f;
      a.vy! += (dy / d) * f;
      b.vx! -= (dx / d) * f;
      b.vy! -= (dy / d) * f;
    }
    for (const a of n) {
      a.gx = Math.min(0.97, Math.max(0.03, a.gx! + a.vx! * step * 4));
      a.gy = Math.min(0.95, Math.max(0.05, a.gy! + a.vy! * step * 4));
    }
    this.heat *= Math.exp(-dt / 2.8);
  }

  /** Advance motion by `dt` seconds. `still`: jump everything to its destination (reduced motion, fast-forward). */
  update(dt: number, now: number, still = false): void {
    this.now = now;
    this.layoutGraph(still ? 0.05 : dt);
    const k = still ? 1 : 1 - Math.exp(-dt / 0.32);
    const ka = still ? 1 : 1 - Math.exp(-dt / 0.4);
    for (const p of this.parts.values()) {
      if (p.hold > 0 && !still) {
        p.hold -= dt;
        if (p.at.z === "rise") {
          // rises out of its page (expo.out-like), then rests while its value is read
          p.riseFrom ??= p.y;
          p.y += (p.riseFrom - (p.rise ?? 14) - p.y) * (1 - Math.exp(-dt / 0.25));
        }
      } else {
        if (still) {
          while (p.stops.length) p.at = p.stops.shift()!;
        }
        const [tx, ty] = this.pos(p, p.at);
        p.x += (tx - p.x) * k;
        p.y += (ty - p.y) * k;
        if (Math.abs(tx - p.x) + Math.abs(ty - p.y) < 2.5 && p.stops.length) {
          p.at = p.stops.shift()!;
          if (p.at.z === "stage" && p.at.s === 3) p.hold = 0;
        }
        if (p.at.z === "tray" && !p.stops.length && Math.abs(ty - p.y) < 0.6) p.settled = true;
      }
      p.alpha += (p.targetAlpha - p.alpha) * ka;
      if (p.label && now > p.labelUntil) this.detachLabel(p);
    }
  }

  // ---- drawing ----------------------------------------------------------------------------------------------

  draw(): void {
    const { ctx, g } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, g.w, g.h);

    // graph edges: hairlines
    if (this.edges.length) {
      ctx.beginPath();
      for (const [a, b] of this.edges) {
        if (a.at.z !== "graph" || b.at.z !== "graph") continue;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.strokeStyle = `rgba(${PAPER},0.2)`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // URL dots, batched by alpha band (one path per band)
    const bands: Particle[][] = [[], [], [], []];
    for (const p of this.urls) bands[Math.min(3, Math.floor(p.alpha * 4))]!.push(p);
    const r = g.dot;
    bands.forEach((list, i) => {
      if (!list.length) return;
      ctx.fillStyle = `rgba(${PAPER},${(i + 0.6) / 4})`;
      ctx.beginPath();
      for (const p of list) {
        if (p.settled) ctx.rect(p.x - 1.1, p.y - 1.1, 2.2, 2.2);
        else {
          ctx.moveTo(p.x + r, p.y);
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    });

    // entity glyphs
    const gr = this.nodes.length > 120 ? 2.5 : 3.2;
    for (const p of this.nodes) drawGlyph(ctx, p.shape ?? "dot", p.x, p.y, gr, p.alpha);

    // the selected item
    const sel = this.selected ? this.parts.get(this.selected) : undefined;
    if (sel) {
      ctx.beginPath();
      ctx.arc(sel.x, sel.y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${PAPER},0.95)`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // labels follow their marks (transform only; at most MAX_LABELS)
    for (const p of this.parts.values()) {
      const el = p.label;
      if (!el) continue;
      const left = p.kind === "url" ? p.x + 6 : p.x + 7;
      el.style.transform = `translate(${left.toFixed(1)}px,${(p.y - 7).toFixed(1)}px)`;
      const fade = Math.min(1, (p.labelUntil - this.now) / 0.5);
      el.style.opacity = String(Math.max(0, Math.min(p.alpha, fade)).toFixed(2));
    }
  }

  /** The item nearest (x, y) within 10px: a URL id or an entity id. */
  hit(x: number, y: number): string | null {
    let best: string | null = null;
    let bd = 100;
    for (const p of this.parts.values()) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = p.id;
      }
    }
    return best;
  }

  /** Frame-independent check used by tests and the perf probe. */
  stageOf(id: string): Stage | "tray" | "graph" | null {
    const p = this.parts.get(id);
    if (!p) return null;
    if (p.at.z === "tray") return "tray";
    if (p.at.z === "graph") return "graph";
    if (p.at.z === "stage") return STAGES[p.at.s] ?? null;
    return null;
  }

  dispose(): void {
    for (const el of this.labels) el.remove();
  }
}

function optionsFor(small: boolean): SceneOptions {
  return small
    ? { urlSample: 3, hostLabels: 4, entityLabels: 4, maxNodes: 120 }
    : { urlSample: 1, hostLabels: 12, entityLabels: 16, maxNodes: 300 };
}

/** The entity glyphs of lib/results/glyphs.ts, on canvas (hollow shapes are filled with the page colour). */
export function drawGlyph(
  ctx: CanvasRenderingContext2D,
  shape: ShapeName,
  x: number,
  y: number,
  r: number,
  alpha: number,
): void {
  const c = `rgba(${PAPER},${alpha.toFixed(3)})`;
  ctx.lineWidth = 1;
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  ctx.beginPath();
  const open = () => {
    ctx.fillStyle = "#0F0F12";
    ctx.fill();
    ctx.stroke();
  };
  switch (shape) {
    case "dot":
      ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      return;
    case "ring":
    case "dashed":
      ctx.arc(x, y, r - 0.5, 0, Math.PI * 2);
      open();
      return;
    case "contour":
      ctx.arc(x, y, r - 0.5, 0, Math.PI * 2);
      open();
      ctx.beginPath();
      ctx.fillStyle = c;
      ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
      return;
    case "square":
      ctx.rect(x - r * 0.86, y - r * 0.86, r * 1.72, r * 1.72);
      ctx.fill();
      return;
    case "squareOpen":
      ctx.rect(x - r * 0.86 + 0.5, y - r * 0.86 + 0.5, r * 1.72 - 1, r * 1.72 - 1);
      open();
      return;
    case "diamond":
    case "diamondOpen": {
      const d = r * 1.2;
      ctx.moveTo(x, y - d);
      ctx.lineTo(x + d, y);
      ctx.lineTo(x, y + d);
      ctx.lineTo(x - d, y);
      ctx.closePath();
      if (shape === "diamond") ctx.fill();
      else open();
      return;
    }
    case "triangle": {
      const R = r * 1.2;
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
        const px = x + Math.cos(a) * R;
        const py = y + 0.2 * R + Math.sin(a) * R;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      return;
    }
  }
}
