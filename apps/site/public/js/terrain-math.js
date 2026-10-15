/* Terrain maths shared by the GPU (mirrored in GLSL) and the DOM. Locked from mockup 81. */
/* ===================================================================================
   Terrain maths, shared by the GPU (mirrored in GLSL) and the DOM (survey markers, meters).
   Height = band-limited ridged fBm (5 octaves of 2D simplex noise). As the pipeline advances,
   the finest octaves are filtered out first, the relief drops in steps at the two safety
   gates, and what remains is one clean travelling wave on a single ridge line.
   =================================================================================== */
(() => {
  // 2D simplex noise (Ashima Arts / Stefan Gustavson, MIT) — same constants as the GLSL copy
  const m289 = x => x - Math.floor(x / 289) * 289, perm = x => m289((x * 34 + 1) * x);
  const C0 = .211324865405187, C1 = .366025403784439, C2 = -.577350269189626, C3 = .024390243902439;
  function snoise(vx, vy) {
    const s = (vx + vy) * C1; let ix = Math.floor(vx + s), iy = Math.floor(vy + s);
    const t = (ix + iy) * C0; const x0 = vx - ix + t, y0 = vy - iy + t;
    const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    const x1 = x0 + C0 - i1, y1 = y0 + C0 - j1, x2 = x0 + C2 + 1 - 1 + C0 * 0 + (C2 - C2), y2 = 0;
    // (written out to mirror the GLSL vector maths exactly)
    const X12 = [x0 + C0 - i1, y0 + C0 - j1, x0 + C2, y0 + C2];
    ix = m289(ix); iy = m289(iy);
    const p = [0, j1, 1].map((d, k) => perm(perm(iy + d) + ix + [0, i1, 1][k]));
    let m = [.5 - (x0 * x0 + y0 * y0), .5 - (X12[0] * X12[0] + X12[1] * X12[1]), .5 - (X12[2] * X12[2] + X12[3] * X12[3])].map(v => Math.max(v, 0));
    m = m.map(v => v * v * v * v);
    const xx = p.map(v => 2 * ((v * C3) - Math.floor(v * C3)) - 1), h = xx.map(v => Math.abs(v) - .5), ox = xx.map(v => Math.floor(v + .5)), a0 = xx.map((v, k) => v - ox[k]);
    m = m.map((v, k) => v * (1.79284291400159 - .85373472095314 * (a0[k] * a0[k] + h[k] * h[k])));
    const gx = a0[0] * x0 + h[0] * y0, gy = a0[1] * X12[0] + h[1] * X12[1], gz = a0[2] * X12[2] + h[2] * X12[3];
    return 130 * (m[0] * gx + m[1] * gy + m[2] * gz);
  }
  const sm = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
  const S = 1 / 13;
  const CUT = [1.15, .86, .6, .38, .2];          // octave i is filtered out around P = CUT[i] (fine detail first)
  const relief = P => { let a = 1; a += (.62 - a) * sm(2 * S, 2.2 * S, P); a -= .22 * sm(2.2 * S, 9 * S, P); a += (.12 - a) * sm(9 * S, 9.2 * S, P); a *= 1 - sm(9.2 * S, 12.6 * S, P); return a; };
  const sigAmp = P => sm(8.6 * S, 12.4 * S, P);
  function rough(x, z, P) {
    let s = 0, a = 1, f = .26, nm = 0;
    for (let i = 0; i < 5; i++) {
      const w = 1 - sm(CUT[i] - .07, CUT[i] + .07, P);
      const n = snoise(x * f + i * 17.3, z * f - i * 9.1);
      const r = 1 - Math.abs(n);
      s += a * w * (n * .62 + (r * r - .45) * .5); nm += a; a *= .48; f *= 2.07;
    }
    return s / nm * 1.7;
  }
  window.TER = { snoise, sm, S, CUT, relief, sigAmp, rough };
})();
