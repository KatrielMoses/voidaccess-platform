/* Page choreography (Lenis + GSAP via motion.js). Locked from mockup 81. */
/* ===================================================================================
   Choreography (Lenis + GSAP via the v3 kit). Shared state lives on window.SIG.
   =================================================================================== */
(() => {
  const g = gsap, still = VA.still, T = window.TER;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const hoverNone = matchMedia('(hover: none)').matches;
  const small = () => innerWidth <= 960;
  const LOW = 'acemnorsuvwxz', HEX = '0123456789abcdef', DIG = '0123456789';
  const SIG = window.SIG = { still, hero: { on: still ? 1 : 0 }, pipe: { P: 0, on: still ? 1 : 0 }, final: { on: still ? 1 : 0, drops: [], lock: -99 } };
  function scr(el, text, o = {}) {
    if (still) { el.textContent = text; return null; }
    return g.to(el, { duration: o.d ?? .9, delay: o.delay || 0, ease: 'power1.inOut', overwrite: true,
      scrambleText: { text, chars: o.chars || LOW, speed: o.speed ?? .45, tweenLength: o.tl ?? true, newClass: o.nc } });
  }
  const nav = $('#nav'); let lastY = 0;
  ScrollTrigger.create({ start: 0, end: 'max', onUpdate: s => { const y = s.scroll(); nav.classList.toggle('solid', y > 12); if (Math.abs(y - lastY) > 6) { nav.classList.toggle('hide', y > lastY && y > 520); lastY = y; } } });
  $$('[data-copy]').forEach(b => b.addEventListener('click', () => {
    const lab = b.querySelector('.cp, span:last-child');
    try { navigator.clipboard && navigator.clipboard.writeText(b.dataset.copy).catch(() => {}); } catch (e) {}
    scr(lab, 'Copied', { d: .5 }); clearTimeout(b._t); b._t = setTimeout(() => scr(lab, 'Copy', { d: .5 }), 1600);
  }));

  /* survey markers (positions are written by the WebGL module) */
  const MK = ['Query', 'Collect', 'Filter', 'Extract', 'Correlate', 'Export'];
  const marks = $('#marks');
  SIG.marks = MK.map((w, i) => { const e = document.createElement('div'); e.className = 'mk'; e.innerHTML = `<i></i><b></b><span><em>${String(i + 1).padStart(2, '0')}</em><u style="text-decoration:none" data-w="${w}">${w}</u></span>`; marks.appendChild(e); return { el: e, line: e.querySelector('i'), lab: e.querySelector('span'), a: still ? 1 : 0 }; });

  /* stack */
  const stackwrap = $('#stackwrap');
  function mountStack() {
    if (stackwrap.firstElementChild) return;
    stackwrap.appendChild($('#stackTpl').content.cloneNode(true));
    // each source row gets a tiny filled ridge profile
    $$('#stackwrap .rw path').forEach(p => { const k = +p.dataset.k; let d = 'M0 22'; for (let i = 0; i <= 100; i++) { const x = i / 100; const h = Math.max(0, .5 + .5 * T.snoise(x * (3 + k * 1.7), k * 3.1)) * (k === 3 ? .6 + .4 * Math.sin(x * 40) : 1) * (k === 2 ? 1 : 1); const y = 21 - (k === 2 ? Math.round(h * 3) / 3 : h) * 17; d += 'L' + (x * 200).toFixed(1) + ' ' + y.toFixed(2); } p.setAttribute('d', d + 'L200 22Z'); });
  }

  VA.ready(() => {
    if (still) { mountStack(); return; }
    const tl = g.timeline({ defaults: { ease: 'expo.out' } });
    tl.fromTo('#nav .pre', { autoAlpha: 0, y: -10 }, { autoAlpha: 1, y: 0, duration: 1.1, stagger: .07 }, .3)
      .fromTo('#tHero', { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.6, ease: 'power2.out' }, 0)
      .to(SIG.hero, { on: 1, duration: 2.6, ease: 'power3.inOut' }, 0);
    SplitText.create('#h1', { type: 'lines', mask: 'lines', linesClass: 'va-line', autoSplit: true,
      onSplit(self) { g.set('#h1', { autoAlpha: 1 }); return g.from(self.lines, { yPercent: 118, duration: 1.4, stagger: .12, ease: 'expo.out', delay: .5 }); } });
    SplitText.create('#lede', { type: 'lines', mask: 'lines', linesClass: 'va-line', autoSplit: true,
      onSplit(self) { g.set('#lede', { autoAlpha: 1 }); return g.from(self.lines, { yPercent: 105, duration: 1.2, stagger: .06, ease: 'expo.out', delay: .85 }); } });
    tl.fromTo('.hside .acts, .hside .hnote', { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 1.2, stagger: .1 }, 1.0)
      .add(() => mountStack(), 1.0)
      .fromTo(stackwrap, { autoAlpha: 0, y: 70 }, { autoAlpha: 1, y: 0, duration: 2 }, 1.05)
      .add(() => { $$('#stackwrap [data-v]').forEach((e, i) => scr(e, e.dataset.v, { d: .9, delay: i * .07, chars: HEX, tl: false })); }, 1.9);
    SIG.marks.forEach((m, i) => { const u = m.el.querySelector('u'); u.textContent = ''; tl.to(m, { a: 1, duration: 1.4, ease: 'expo.out' }, 1.3 + i * .1).add(scr(u, u.dataset.w, { d: .8 }), 1.4 + i * .1); });
    const pst = { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: .7, invalidateOnRefresh: true };
    const k = () => small() ? .3 : 1;
    g.to('#htop', { y: () => -140 * k(), ease: 'none', scrollTrigger: pst });
    g.to('#stackwrap', { y: () => -80 * k(), ease: 'none', scrollTrigger: { ...pst } });
    ScrollTrigger.create({ ...pst, onUpdate: s => { SIG.hero.scroll = s.progress; } });
    VA.magnetic('.mag', .28);
  });
  /* section heads */
  $$('.shead').forEach(h => {
    const n = $('.n span', h), rl = $('.n i', h);
    if (still) return;
    n.textContent = '';
    ScrollTrigger.create({ trigger: h, start: 'top 86%', once: true, onEnter() { g.to(rl, { scaleX: 1, duration: 1.2, ease: 'expo.inOut' }); scr(n, n.dataset.t, { d: .9, delay: .2 }); } });
  });
  VA.ready(() => { VA.lines('.sec h2.split, .xfield h2.split, .final h2.split', { start: 'top 86%', stagger: .1, duration: 1.3 }); VA.reveal('.rv', { y: 22, stagger: .1 }); });

  /* ---------------- channels: hidden-line ridge plots (Canvas 2D) ---------------- */
  const chans = $$('.chan');
  const RS = chans.map((c, i) => {
    const cv = $('canvas', c), ctx = cv.getContext('2d'), st = { cv, ctx, w: 0, h: 0, t: i * 3.3, hov: 0, draw: still ? 1 : 0 };
    const fit = () => { const d = Math.min(2, devicePixelRatio || 1); st.w = cv.clientWidth; st.h = cv.clientHeight; cv.width = Math.round(st.w * d); cv.height = Math.round(st.h * d); ctx.setTransform(d, 0, 0, d, 0, 0); };
    new ResizeObserver(fit).observe(cv); fit();
    c.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') c.classList.add('on'); });
    c.addEventListener('pointerleave', () => c.classList.remove('on'));
    return st;
  });
  const fr = x => x - Math.floor(x);
  const CHH = [
    (x, r, t) => { let s = 0; [.22, .5, .8].forEach((c, k) => { s += Math.exp(-Math.pow((x - c - .03 * Math.sin(t * .5 + k + r * .3)) / .07, 2)) * (.8 + .2 * Math.sin(r * .5 + k)); }); return s * .9 + .04 * T.snoise(x * 12, r + t * .2); },
    (x, r, t) => { let s = .03 * T.snoise(x * 20, r * .7 + t); for (let k = 0; k < 3; k++) { const ph = fr(t * .11 + k * .37 + r * .021), c = fr(.17 + k * .31 + Math.floor(t * .11 + k * .37 + r * .021) * .53); const life = Math.sin(Math.PI * ph); s += Math.exp(-Math.pow((x - c) / .012, 2)) * life * (.7 + .3 * Math.sin(r + k)); } return s; },
    (x, r, t) => { const v = .5 + .5 * T.snoise(x * 2.4 - t * .12, r * .16); const q = Math.floor(v * 4) / 4, f = v * 4 - Math.floor(v * 4); return (q + T.sm(.82, 1, f) * .25) * .85; },
    (x, r, t) => (.5 + .5 * Math.sin(x * 26 - t * 1.4 + r * .35)) * .55 * (.75 + .25 * Math.sin(r * .4)),
    (x, r, t) => { let s = 0, a = .55, f = 2.2; for (let k = 0; k < 5; k++) { s += a * (1 - Math.abs(T.snoise(x * f - t * .08 * (k + 1), r * .22 * f * .4 + k * 7))); a *= .5; f *= 2.1; } return Math.pow(Math.max(0, s - .35), 1.4) * 1.5; },
  ];
  function ridge(i, dt) {
    const st = RS[i], c = chans[i], { ctx, w, h } = st; if (!w) return;
    st.hov += ((c.classList.contains('on') ? 1 : 0) - st.hov) * (1 - Math.exp(-dt / .25));
    st.t += dt * (1 + 1.4 * st.hov);
    ctx.clearRect(0, 0, w, h);
    const R = 13, N = Math.max(40, Math.floor(w / 3));
    for (let r = 0; r < R; r++) {          // back to front: fill hides what is behind
      const depth = r / (R - 1), y0 = 16 + depth * (h - 22), sx = 1 - (1 - depth) * .18, x0 = w * (1 - sx) / 2, amp = (h * .36) * (.55 + .45 * depth);
      const xEnd = st.draw;
      ctx.beginPath();
      let lx = x0, ly = y0;
      for (let k = 0; k <= N; k++) { const u = k / N; if (u > xEnd) break; const x = x0 + u * w * sx, y = y0 - CHH[i](u, r, st.t) * amp * Math.sin(Math.PI * Math.min(1, u * 1.15, (1 - u) * 1.15) * .5 + .0001) ** .3; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); lx = x; ly = y; }
      const fill = ctx.getTransform && true;
      ctx.lineTo(lx, y0 + 2); ctx.lineTo(x0, y0 + 2); ctx.closePath();
      ctx.fillStyle = '#0F0F12'; ctx.fill();
      const front = r === R - 1;
      const al = (.18 + .5 * depth) * (.7 + .3 * st.hov) + (front ? .25 * st.hov : 0);
      ctx.beginPath();
      for (let k = 0; k <= N; k++) { const u = k / N; if (u > xEnd) break; const x = x0 + u * w * sx, y = y0 - CHH[i](u, r, st.t) * amp * Math.sin(Math.PI * Math.min(1, u * 1.15, (1 - u) * 1.15) * .5 + .0001) ** .3; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.strokeStyle = front && st.hov > .05 ? `rgba(106,117,239,${.6 + .4 * st.hov})` : `rgba(216,214,210,${al.toFixed(3)})`;
      ctx.lineWidth = front ? 1.2 : 1; ctx.lineJoin = 'round'; ctx.stroke();
    }
  }
  let chVis = false; new IntersectionObserver(es => es.forEach(e => chVis = e.isIntersecting), { rootMargin: '100px' }).observe($('#chans'));
  SIG.loops = [{ vis: () => chVis, tick: dt => chans.forEach((_, i) => ridge(i, dt)) }];
  if (!still) ScrollTrigger.create({ trigger: '#chans', start: 'top 82%', once: true, onEnter() {
    g.to('.chan .rl', { scaleX: 1, duration: 1.5, stagger: .08, ease: 'expo.inOut' });
    chans.forEach((c, i) => {
      g.fromTo(c.querySelectorAll('.id, h3, p'), { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 1.15, stagger: .06, delay: .1 + i * .08, ease: 'expo.out', clearProps: 'transform,translate,rotate,scale' });
      g.to(RS[i], { draw: 1, duration: 1.8, delay: .25 + i * .1, ease: 'power3.inOut' });
    });
  } });
  if (hoverNone && !still) g.ticker.add(() => {
    const box = $('#chans').getBoundingClientRect(); if (box.bottom < 0 || box.top > innerHeight) return;
    let best = -1, bd = 1e9; const cy = innerHeight * .5;
    chans.forEach((c, i) => { const r = c.getBoundingClientRect(); const d = Math.abs(r.top + r.height / 2 - cy); if (d < bd && d < r.height * .6) { bd = d; best = i; } });
    chans.forEach((c, i) => c.classList.toggle('on', i === best));
  });

  /* ---------------- pipeline ---------------- */
  const STG = [
    ['Refine the query', 'An LLM sharpens your research question before anything is collected.', 0, 0],
    ['Collect in parallel', 'Onion search engines, GitHub, research feeds and curated seeds, all at once.', 0, 0],
    ['Filter', 'Noisy or irrelevant pages are dropped at a mandatory content-safety gate.', 1, 0],
    ['Enrich early indicators', 'The query and first indicators are checked against threat-intelligence sources.', 0, 0],
    ['Discover .onion links', 'Additional links are found and followed recursively.', 0, 0],
    ['Reuse the vector cache', 'Recently processed pages are reused instead of fetched again.', 0, 0],
    ['Fetch through Tor', 'Selected pages only, with response-size limits.', 0, 0],
    ['Persist new content', 'New findings join the shared archive, dated and anonymous.', 0, 0],
    ['Merge intelligence', 'Collected and enriched results come together.', 0, 1],
    ['Extract entities', 'Regex, NER and optional LLM analysis, behind a content-safety gate.', 1, 1],
    ['Cross-reference', 'Against historical and seed datasets.', 0, 1],
    ['Build relationships', 'Communities and infrastructure clusters.', 0, 1],
    ['Summarise and export', 'A final intelligence summary and an export-ready result.', 0, 2],
  ];
  const PH = ['Gather', 'Understand', 'Deliver'];
  const cells = $('#cells'), odo = $('#odo'), ptitle = $('#ptitle'), pdesc = $('#pdesc'), pphase = $('#pphase');
  const mRel = $('#mRel'), mSig = $('#mSig'), mSnr = $('#mSnr'), rfill = $('#rfill'), caret = $('#caret'), ruler = $('#ruler'), prof = $('#prof path');
  const phEls = $$('#phases span');
  STG.forEach((s, i) => { const c = document.createElement('span'); c.innerHTML = String(i + 1).padStart(2, '0') + (s[2] ? '<em>Gate</em>' : ''); cells.appendChild(c); });
  const cellEls = [...cells.children];
  let rs = ''; for (let k = 0; k <= 65; k++) { const x = (k / 65 * 1000).toFixed(2), mj = k % 5 === 0; rs += `<line ${mj ? 'class="mj" ' : ''}x1="${x}" x2="${x}" y1="0" y2="${mj ? 10 : 4}"/>`; } $('#rsvg').innerHTML = rs;
  odo.innerHTML = [0, 1].map(() => '<span class="dg"><span>' + DIG.split('').map(d => '<b>' + d + '</b>').join('') + '</span></span>').join('');
  const odoCols = $$('.dg > span', odo);
  ptitle.innerHTML = '<span class="lit">' + STG[0][0] + '</span>';
  let Pt = 0, Pc = 0, cur = -1, lastP = -1, phase = 0, rw = 0;
  const measure = () => { rw = ruler.clientWidth; }; addEventListener('resize', measure); measure();
  function setStage(i) {
    const prev = cur; cur = i; const n = i + 1;
    odoCols[0].style.transform = `translateY(${-Math.floor(n / 10) * 1.2}em)`;
    odoCols[1].style.transform = `translateY(${-(n % 10) * 1.2}em)`;
    if (prev >= 0) {
      if (still) { ptitle.innerHTML = '<span class="lit">' + STG[i][0] + '</span>'; pdesc.textContent = STG[i][1]; }
      else {
        scr(ptitle, STG[i][0], { d: .8, speed: .6, nc: 'lit' });
        g.timeline().to(pdesc, { autoAlpha: 0, y: -6, duration: .18, ease: 'power2.in', overwrite: true }).add(() => { pdesc.textContent = STG[i][1]; }).fromTo(pdesc, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: .7, ease: 'expo.out' });
      }
    }
    if (STG[i][3] !== phase) { phase = STG[i][3]; scr(pphase, PH[phase], { d: .6 }); phEls.forEach((e, k) => e.classList.toggle('on', k === phase)); }
    cellEls.forEach((c, k) => { c.classList.toggle('past', k < i); c.classList.toggle('on', k === i); c.classList.toggle('passed', k <= i && STG[k][2]); });
  }
  function pipeUI() {
    if (Math.abs(Pc - lastP) < 1e-5) return; lastP = Pc;
    const i = Math.min(12, Math.floor(Pc * 13 + 1e-6)); if (i !== cur) setStage(i);
    const rel = T.relief(Pc), sg = T.sigAmp(Pc);
    mRel.innerHTML = Math.round(rel * 100) + '<i>%</i>';
    mSig.innerHTML = Math.round(sg * 100) + '<i>%</i>';
    const db = 10 * Math.log10(Math.max(.02, sg + .03 * (1 - rel)) / Math.max(.004, rel * .6 + .004));
    mSnr.innerHTML = (db >= 0 ? '+' : '−') + Math.abs(db).toFixed(1) + '<i>dB</i>';
    // the cross-section of the current ground, the same maths the GPU uses
    let d = ''; for (let k = 0; k <= 120; k++) { const u = k / 120, x = -6 + u * 12; const hgt = T.rough(x, -2, Pc) * rel * .55 + sg * .5 * Math.sin(1.6 * x); d += (k ? 'L' : 'M') + (u * 300).toFixed(1) + ' ' + (30 - hgt * 13).toFixed(2); } prof.setAttribute('d', d);
    rfill.style.transform = `scaleX(${Pc.toFixed(4)})`;
    caret.style.transform = `translateX(${(Pc * rw).toFixed(1)}px)`;
    SIG.pipe.P = Pc;
  }
  setStage(0); lastP = -1; pipeUI();
  const stepPx = () => innerHeight * (small() ? .42 : .55);
  ScrollTrigger.create({
    trigger: '#pipeline', start: 'top top', end: () => '+=' + Math.round(stepPx() * 12.5), pin: true, anticipatePin: 1, invalidateOnRefresh: true,
    onUpdate: s => { Pt = s.progress; if (still) { Pc = Pt; pipeUI(); } }, onRefresh: () => { measure(); lastP = -1; pipeUI(); },
  });
  if (!still) {
    g.ticker.add((t, dms) => { const k = 1 - Math.exp(-Math.min(dms, 64) / 1000 / .14); Pc += (Pt - Pc) * k; if (Math.abs(Pt - Pc) < 1e-5) Pc = Pt; pipeUI(); });
    ScrollTrigger.create({ trigger: '#pipeline', start: 'top 70%', once: true, onEnter() {
      g.to(SIG.pipe, { on: 1, duration: 2, ease: 'power3.inOut' });
      g.from('#rsvg line', { scaleY: 0, transformOrigin: '50% 0%', duration: .9, stagger: .006, ease: 'expo.out', delay: .3 });
      g.from('.read > div, .cells span, .phases span', { autoAlpha: 0, y: 8, duration: .9, stagger: .025, ease: 'expo.out', delay: .2 });
    } });
  }

  /* ---------------- entities: contours that relax into the logo's rings ---------------- */
  const ENT = [
    ['LockBitSupp', 'ALPHV', 'Scattered Spider'], ['LockBit 3.0', 'BlackCat', 'Qakbot'], ['CVE-2023-4966', 'CVE-2024-3400', 'CVE-2023-34362'],
    ['bc1q…k7x2', '0x3f…a91c', 'bc1q…9wze'], ['@ransom_ops', 'svc_backup:••••••', '@initial_access'], ['lockbit…[.]onion', '203.0.113[.]42', 'hxxps://198.51.100[.]7'],
  ];
  const ents = $$('.ent');
  ents.forEach((e, i) => {
    const svg = $('svg', e), v = $('.vl', e);
    const RINGS = 6, paths = [];
    for (let r = 0; r < RINGS; r++) { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); svg.appendChild(p); paths.push(p); }
    const st = { k: 0, t: 0 };
    const draw = () => {
      paths.forEach((p, r) => {
        const rr = 102 - r * 16; let d = '';
        for (let a = 0; a <= 96; a++) {
          const th = a / 96 * Math.PI * 2;
          const n = T.snoise(Math.cos(th) * (1.1 + r * .12) + i * 5.3, Math.sin(th) * (1.1 + r * .12) + r * .45 + st.t * .15);
          const rad = rr * (1 + (1 - st.k) * .24 * n);
          const cx = (1 - st.k) * (T.snoise(i * 2.1, r * .3) * 14), cy = (1 - st.k) * (T.snoise(r * .3, i * 1.7) * 10) + st.k * 9 * (r / RINGS);
          d += (a ? 'L' : 'M') + (cx + Math.cos(th) * rad).toFixed(1) + ' ' + (cy + Math.sin(th) * rad * .72).toFixed(1);
        }
        p.setAttribute('d', d + 'Z');
      });
    };
    draw(); e._st = st; e._draw = draw; e._k = 0;
    const next = () => { e._k = (e._k + 1) % 3; scr(v, ENT[i][e._k], { d: .75, chars: HEX, speed: .5 }); };
    const on = () => { if (e.classList.contains('on')) return; e.classList.add('on'); if (!still) { g.to(st, { k: 1, duration: 1.4, ease: 'expo.out', onUpdate: draw, overwrite: 'auto' }); next(); } };
    const off = () => { e.classList.remove('on'); if (!still) g.to(st, { k: 0, duration: 1.6, ease: 'power2.inOut', onUpdate: draw, overwrite: 'auto' }); };
    e.addEventListener('pointerenter', ev => { if (ev.pointerType !== 'touch') on(); });
    e.addEventListener('focus', on); e.addEventListener('pointerleave', off); e.addEventListener('blur', off);
    e.addEventListener('click', () => { if (!still) next(); });
  });
  if (!still) {
    $$('.ent .vl').forEach(v => { v.textContent = ''; });
    ScrollTrigger.create({ trigger: '#ents', start: 'top 82%', once: true, onEnter() {
      g.from('.ent .ix, .ent .ty, .ent b', { autoAlpha: 0, y: 14, duration: 1.1, stagger: .03, ease: 'expo.out', delay: .15 });
      g.from('.ent svg path', { autoAlpha: 0, scale: .6, transformOrigin: '50% 50%', duration: 1.6, stagger: .015, ease: 'expo.out' });
      ents.forEach((e, i) => scr($('.vl', e), ENT[i][0], { d: 1.1, delay: .6 + i * .09, chars: HEX }));
    } });
    // the contours drift very slowly while visible
    let eVis = false; new IntersectionObserver(es => es.forEach(x => eVis = x.isIntersecting), { rootMargin: '60px' }).observe($('#ents'));
    let acc = 0; g.ticker.add((t, dms) => { if (!eVis || document.hidden) return; acc += dms; if (acc < 50) return; ents.forEach(e => { if (e._st.k < .999) { e._st.t += acc / 1000; e._draw(); } }); acc = 0; });
  }
  if (hoverNone && !still) { let tc = -1; g.ticker.add(() => {
    const box = $('#ents').getBoundingClientRect(); if (box.bottom < 0 || box.top > innerHeight) return;
    let best = -1, bd = 1e9; const cy = innerHeight * .5;
    ents.forEach((e, i) => { const r = e.getBoundingClientRect(); const d = Math.abs(r.top + r.height / 2 - cy); if (d < bd && d < r.height * .6) { bd = d; best = i; } });
    if (best === tc) return; tc = best; ents.forEach((e, i) => e.dispatchEvent(new Event(i === best ? 'focus' : 'blur')));
  }); }

  /* ---------------- exports: a ground profile that rises under the format you point at ---------------- */
  const xs = $$('.x'), xp = $('#xprof path'), XP = { c: -1, a: 0 };
  const drawX = () => { let d = ''; for (let k = 0; k <= 180; k++) { const u = k / 180; const base = .12 * (.5 + .5 * T.snoise(u * 7, 3.3)) + .04 * T.snoise(u * 31, 1.1); const bump = XP.a * Math.exp(-Math.pow((u - XP.c) / .035, 2)); d += (k ? 'L' : 'M') + (u * 900).toFixed(1) + ' ' + (40.5 - (base * (1 - XP.a * .7) + bump) * 34).toFixed(2); } xp.setAttribute('d', d); };
  drawX();
  xs.forEach((x, i) => {
    const s = $('small', x);
    x.addEventListener('pointerenter', () => { scr(s, s.dataset.b, { d: .5, speed: .6 }); if (!still) { if (XP.a < .05) XP.c = (i + .5) / 9; g.to(XP, { c: (i + .5) / 9, a: 1, duration: .9, ease: 'expo.out', onUpdate: drawX, overwrite: true }); } });
    x.addEventListener('pointerleave', () => { scr(s, s.dataset.a, { d: .45, speed: .6 }); if (!still) g.to(XP, { a: 0, duration: 1.2, ease: 'power2.inOut', onUpdate: drawX, overwrite: true }); });
  });
  if (!still) ScrollTrigger.create({ trigger: '#xrow', start: 'top 88%', once: true, onEnter() {
    g.to('.xrow .xb', { scaleX: 1, duration: 1.5, ease: 'expo.inOut' });
    g.fromTo('#xprof path', { strokeDasharray: 2000, strokeDashoffset: 2000 }, { strokeDashoffset: 0, duration: 2.2, ease: 'power2.inOut', clearProps: 'strokeDasharray,strokeDashoffset' });
    g.from('.x .vd', { scaleY: 0, duration: 1.1, stagger: .06, ease: 'expo.inOut', delay: .3 });
    g.from('.x .nm span', { yPercent: 110, duration: 1.2, stagger: .05, ease: 'expo.out', delay: .4, clearProps: 'transform' });
    g.from('.x small', { autoAlpha: 0, duration: .8, stagger: .05, delay: .65 });
  } });

  /* ---------------- final ---------------- */
  const q = $('#q'), hunt = $('#hunt');
  q.addEventListener('keydown', e => { if (e.key.length === 1 || e.key === 'Backspace') { const F = SIG.final; F.drops.push({ x: (Math.random() - .5) * 7, z: -1 - Math.random() * 4, t: performance.now() / 1000, a: .22 }); if (F.drops.length > 8) F.drops.shift(); } });
  hunt.addEventListener('submit', () => {
    // A hunt opens a new investigation in the app with the query filled in; signed-out visitors sign in first and land there.
    const qv = q.value.trim().slice(0, 500), app = (document.querySelector('meta[name="va-app"]') || {}).content || 'https://app.voidaccess.pro';
    const go = app.replace(/\/$/, '') + '/investigations/new' + (qv ? '?q=' + encodeURIComponent(qv) : '');
    setTimeout(() => { location.href = go; }, still ? 0 : 450);
 const F = SIG.final; F.drops.push({ x: 0, z: -2.5, t: performance.now() / 1000, a: .55 }); if (F.drops.length > 8) F.drops.shift(); F.lock = performance.now() / 1000; });
  if (!still) {
    ScrollTrigger.create({ trigger: '#start', start: 'top 70%', once: true, onEnter() { g.to(SIG.final, { on: 1, duration: 2.4, ease: 'power3.inOut', delay: .3 }); } });
    const EX = ['LockBit ransomware', 'A bc1q… wallet cluster', 'CVE-2023-4966 chatter', 'An actor handle across forums', small() ? 'Actor, wallet, CVE or onion URL' : 'A threat actor, wallet, malware family or onion URL'];
    if (small()) q.placeholder = EX[4];
    let ei = 0;
    const cycle = () => { if (document.activeElement === q || q.value) { g.delayedCall(2, cycle); return; } const txt = EX[ei++ % EX.length], o = { n: 0 }; g.to(o, { n: txt.length, duration: txt.length * .045, ease: 'none', onUpdate: () => q.placeholder = txt.slice(0, Math.round(o.n)), onComplete: () => g.delayedCall(2.4, cycle) }); };
    ScrollTrigger.create({ trigger: '#start', start: 'top 60%', once: true, onEnter: () => g.delayedCall(2.6, cycle) });
  }
})();
