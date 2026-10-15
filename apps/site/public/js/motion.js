/* VoidAccess v3 motion foundation — GSAP 3.15 (all plugins free) + Lenis 1.3.26, wired correctly.
 *
 * Include, in this order, before your own script:
 *   <link rel="stylesheet" href="/vendor/lenis.css">
 *   <script src="/vendor/gsap.min.js"></script>
 *   <script src="/vendor/ScrollTrigger.min.js"></script>
 *   <script src="/vendor/SplitText.min.js"></script>        (optional)
 *   <script src="/vendor/ScrambleTextPlugin.min.js"></script> (optional)
 *   <script src="/vendor/lenis.min.js"></script>
 *   <script src="/js/motion.js"></script>
 * Any other GSAP plugin from the same dist folder works too (Flip, DrawSVGPlugin, MorphSVGPlugin, Observer,
 * CustomEase, InertiaPlugin, Draggable, MotionPathPlugin …) — it is registered automatically if loaded.
 *
 * Exposes window.VA:
 *   VA.still            true under ?static or prefers-reduced-motion. Render final states; no smooth scroll.
 *   VA.lenis            the Lenis instance (null when still).
 *   VA.ease             { out:'expo.out', io:'power3.inOut', soft:'power2.out' } — use these, not linear.
 *   VA.ready(fn)        runs fn after fonts are ready (so SplitText measures real lines).
 *   VA.lines(target, {scroll=true, delay=0, stagger=.08, duration=1.2, start='top 85%'})
 *                       masked line-by-line reveal (SplitText, autoSplit-safe). Returns the SplitText.
 *   VA.reveal(target, {y=24, stagger=.08, start='top 88%'})   batched fade-up reveal.
 *   VA.magnetic(target, strength=.25)                         buttons that lean toward the pointer.
 *   VA.scrollTo(target)                                        smooth (Lenis) or instant when still.
 * All of these degrade to the final state when VA.still is true.
 */
(function () {
  const g = window.gsap;
  if (!g) { console.warn('motion.js: load gsap first'); return; }
  const plugins = ['ScrollTrigger', 'SplitText', 'ScrambleTextPlugin', 'Flip', 'DrawSVGPlugin', 'MorphSVGPlugin',
    'Observer', 'CustomEase', 'InertiaPlugin', 'Draggable', 'MotionPathPlugin', 'ScrollToPlugin', 'TextPlugin'];
  g.registerPlugin(...plugins.map(p => window[p]).filter(Boolean));

  const still = /[?&]static/.test(location.search) || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ST = window.ScrollTrigger;
  const VA = window.VA = { still, lenis: null, ease: { out: 'expo.out', io: 'power3.inOut', soft: 'power2.out' } };

  // Smooth scroll, synced with ScrollTrigger through GSAP's ticker (one RAF loop for everything).
  if (!still && window.Lenis) {
    const lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1, smoothWheel: true, anchors: false });
    VA.lenis = lenis;
    if (ST) lenis.on('scroll', ST.update);
    g.ticker.add(t => lenis.raf(t * 1000));
    g.ticker.lagSmoothing(0);
    document.documentElement.classList.add('va-smooth');
  }
  if (still) {
    document.documentElement.classList.add('va-still');
    g.globalTimeline.timeScale(1000); // anything a page still plays jumps straight to its end state
  }

  VA.scrollTo = (target, opts = {}) => {
    if (VA.lenis) VA.lenis.scrollTo(target, { duration: 1.4, easing: t => 1 - Math.pow(1 - t, 4), ...opts });
    else { const el = typeof target === 'string' ? document.querySelector(target) : target; el && el.scrollIntoView ? el.scrollIntoView() : scrollTo(0, +target || 0); }
  };
  // in-page anchors go through Lenis
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || a.getAttribute('href').length < 2) return;
    const el = document.querySelector(a.getAttribute('href'));
    if (el) { e.preventDefault(); VA.scrollTo(el); }
  });

  VA.ready = fn => (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => requestAnimationFrame(() => fn()));

  const toEls = t => typeof t === 'string' ? [...document.querySelectorAll(t)] : (t.length !== undefined ? [...t] : [t]);

  VA.lines = (target, o = {}) => {
    const els = toEls(target);
    if (!els.length || !window.SplitText) return null;
    if (still) { g.set(els, { autoAlpha: 1 }); return null; }
    const { scroll = true, delay = 0, stagger = 0.08, duration = 1.2, start = 'top 85%' } = o;
    return els.map(el => SplitText.create(el, {
      type: 'lines', mask: 'lines', linesClass: 'va-line', autoSplit: true,
      onSplit(self) {
        g.set(el, { autoAlpha: 1 });
        return g.from(self.lines, {
          yPercent: 110, duration, stagger, delay, ease: 'expo.out',
          scrollTrigger: scroll ? { trigger: el, start, once: true } : undefined,
        });
      },
    }));
  };

  VA.reveal = (target, o = {}) => {
    const els = toEls(target);
    if (!els.length) return;
    if (still || !ST) { g.set(els, { autoAlpha: 1, y: 0 }); return; }
    const { y = 24, stagger = 0.08, start = 'top 88%' } = o;
    g.set(els, { autoAlpha: 0, y });
    ST.batch(els, { start, once: true, onEnter: b => g.to(b, { autoAlpha: 1, y: 0, duration: 1.1, stagger, ease: 'expo.out', overwrite: true }) });
  };

  VA.magnetic = (target, k = 0.25) => {
    if (still || matchMedia('(hover: none)').matches) return;
    toEls(target).forEach(el => {
      const xTo = g.quickTo(el, 'x', { duration: 0.6, ease: 'power3.out' });
      const yTo = g.quickTo(el, 'y', { duration: 0.6, ease: 'power3.out' });
      el.addEventListener('pointermove', e => { const r = el.getBoundingClientRect(); xTo((e.clientX - r.left - r.width / 2) * k); yTo((e.clientY - r.top - r.height / 2) * k); });
      el.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
    });
  };

  // layout can shift after fonts/images: refresh triggers once everything has settled
  if (ST) addEventListener('load', () => ST.refresh());
})();
