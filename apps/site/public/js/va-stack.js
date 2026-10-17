/* <va-stack> — the recurring VoidAccess 3D hero component (evolved from mockup 25).
 *
 * A perspective stack of real product windows that eases toward the pointer, flattens / spreads with
 * scroll, and lifts a card on hover. Neutral, realistic shadows. No glow.
 *
 *   <script src="/js/va-stack.js" defer></script>
 *   <va-stack theme="dark" layout="fan" style="height:620px"></va-stack>
 *
 * Attributes
 *   theme   dark | light | paper              window-chrome palette           (default dark)
 *   layout  fan | cascade | tower | row       arrangement                     (default fan)
 *   cards   comma list of: graph, cli                                          (default graph,cli)
 *   labels  comma list overriding the window titles
 *   tilt    pointer-tilt strength 0..2                                         (default 1)
 *   scroll  none | flatten | spread           what scrolling past it does      (default flatten)
 *   chrome  mac | minimal | none              window title-bar style           (default minimal)
 *   rx, ry  resting rotation in degrees        (layout defaults otherwise)
 *   pos     card positions overriding the layout's: "x y z s, x y z s, …" (x,y in card widths, z in px, s scale)
 *   delay   entrance delay in ms                                               (default 150)
 * Or supply your own cards as children: <figure data-label="Title"><img src="…"></figure> (or any element).
 * Custom children are slotted (they stay in the light DOM), so ordinary page CSS styles them.
 *
 * Styling hooks (CSS vars on the element): --vs-radius, --vs-border, --vs-bar, --vs-bar-text, --vs-bg,
 * --vs-shadow, --vs-width (max card width, px number e.g. 600). Parts: ::part(card) ::part(bar) ::part(title).
 * Respects prefers-reduced-motion and ?static (renders the resting pose, no motion).
 */
(function () {
  if (customElements.get('va-stack')) return;

  const SRC = {
    graph: ['/assets/cloud-graph.png', 'Entity graph', 1120 / 623],
    cli:   ['/assets/cloud-summary.png', 'Summary', 1094 / 569],
  };

  // positions in units of card width (x,y) and px (z). s = scale of card width.
  const LAYOUTS = {
    fan:     { rx: 10, ry: -20, rz: 0,   pos: [[-.26,-.30,-170,1],[.14,-.13,-50,1],[-.10,.05,70,1],[.24,.25,190,.62]] },
    cascade: { rx: 8,  ry: -14, rz: 0,   pos: [[-.24,-.24,-180,1],[-.08,-.08,-60,1],[.08,.08,60,1],[.24,.24,180,1]] },
    tower:   { rx: 54, ry: 0,   rz: -32, pos: [[0,-.24,-60,1],[0,-.08,20,1],[0,.08,100,1],[0,.24,180,1]] },
    row:     { rx: 6,  ry: -24, rz: 0,   pos: [[-.96,0,-120,.8],[-.32,0,-40,.8],[.32,0,40,.8],[.96,0,120,.8]] },
  };
  const THEMES = {
    dark:  { bg: '#0c0d12', bar: '#17181f', text: 'rgba(255,255,255,.55)', border: 'rgba(255,255,255,.09)', dot: 'rgba(255,255,255,.16)' },
    light: { bg: '#ffffff', bar: '#f4f4f6', text: 'rgba(17,17,20,.55)',   border: 'rgba(17,17,20,.08)',   dot: 'rgba(17,17,20,.16)' },
    paper: { bg: '#fbfaf7', bar: '#ece9e2', text: 'rgba(17,17,20,.55)',   border: 'rgba(17,17,20,.10)',   dot: 'rgba(17,17,20,.18)' },
  };

  const STATIC = /[?&]static/.test(location.search);
  const RM = matchMedia('(prefers-reduced-motion: reduce)');

  class VaStack extends HTMLElement {
    connectedCallback() {
      if (this._built) return; this._built = true;
      const th = THEMES[this.getAttribute('theme')] || THEMES.dark;
      const base = LAYOUTS[this.getAttribute('layout')] || LAYOUTS.fan;
      const pos = (this.getAttribute('pos') || '').split(',').map(t => t.trim().split(/\s+/).map(Number)).filter(p => p.length === 4 && p.every(Number.isFinite));
      const L = pos.length ? { ...base, pos } : base;
      this._L = L; this._tower = base === LAYOUTS.tower;
      this._rx0 = parseFloat(this.getAttribute('rx') ?? L.rx);
      this._ry0 = parseFloat(this.getAttribute('ry') ?? L.ry);
      this._rz0 = L.rz;
      this._tilt = parseFloat(this.getAttribute('tilt') ?? 1);
      this._scrollMode = this.getAttribute('scroll') || 'flatten';
      const chrome = this.getAttribute('chrome') || 'minimal';
      const delay = parseInt(this.getAttribute('delay') ?? 150, 10);

      // cards: children first, else named set
      // custom cards stay in the light DOM (slotted) so page CSS styles them normally
      let items = [...this.children].filter(el => el.tagName !== 'TEMPLATE' && el.tagName !== 'STYLE' && el.tagName !== 'SCRIPT')
        .map(el => ({ el, label: el.dataset.label || '', slotted: true }));
      if (!items.length) {
        const names = (this.getAttribute('cards') || 'graph,cli').split(',').map(s => s.trim()).filter(n => SRC[n]);
        const labels = (this.getAttribute('labels') || '').split(',').map(s => s.trim());
        items = names.map((n, i) => {
          const img = document.createElement('img');
          img.src = SRC[n][0]; img.alt = ''; img.decoding = 'async';
          img.style.aspectRatio = SRC[n][2];
          return { el: img, label: labels[i] || SRC[n][1] };
        });
      }
      items = items.slice(0, L.pos.length);

      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>
        :host{display:block;position:relative;perspective:1700px;perspective-origin:50% 40%;contain:layout;
          --_bg:var(--vs-bg,${th.bg});--_bar:var(--vs-bar,${th.bar});--_tx:var(--vs-bar-text,${th.text});--_bd:var(--vs-border,${th.border});--_r:var(--vs-radius,12px);
          --_sh:var(--vs-shadow,0 2px 4px rgba(0,0,0,.10),0 24px 48px -12px rgba(0,0,0,.30),0 70px 120px -40px rgba(0,0,0,.45))}
        .deck{position:absolute;inset:0;transform-style:preserve-3d;will-change:transform}
        .card{position:absolute;left:50%;top:50%;transform-style:preserve-3d;transition:transform .9s cubic-bezier(.16,1,.3,1)}
        .card .in{border-radius:var(--_r);overflow:hidden;background:var(--_bg);box-shadow:var(--_sh),0 0 0 1px var(--_bd);
          opacity:0;transform:translate3d(0,90px,-260px) rotateX(-14deg);
          transition:transform 1.4s cubic-bezier(.16,1,.3,1),opacity .9s cubic-bezier(.16,1,.3,1)}
        :host(.on) .card .in{opacity:1;transform:none}
        .bar{display:flex;align-items:center;gap:6px;height:30px;padding:0 12px;background:var(--_bar);border-bottom:1px solid var(--_bd)}
        .bar i{width:8px;height:8px;border-radius:50%;background:${th.dot}}
        .bar span{font:500 11px/1 -apple-system,BlinkMacSystemFont,"Inter","Helvetica Neue",sans-serif;letter-spacing:.01em;color:var(--_tx);margin-left:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .bar.minimal i{display:none}.bar.minimal span{margin-left:0}
        .bar.none{display:none}
        .body{display:block}
        .body>*,.body ::slotted(*){display:block;width:100%;height:auto;margin:0}
        .card:hover{z-index:5}
      </style><div class="deck" part="deck"></div>`;
      const deck = root.querySelector('.deck');
      this._deck = deck;
      this._cards = items.map((it, i) => {
        const c = document.createElement('div'); c.className = 'card'; c.setAttribute('part', 'card');
        const inner = document.createElement('div'); inner.className = 'in';
        inner.style.transitionDelay = (delay + i * 110) + 'ms';
        const bar = document.createElement('div'); bar.className = 'bar ' + chrome; bar.setAttribute('part', 'bar');
        bar.innerHTML = '<i></i><i></i><i></i><span part="title"></span>';
        bar.querySelector('span').textContent = it.label;
        const body = document.createElement('div'); body.className = 'body';
        if (it.slotted) { it.el.slot = 'c' + i; const sl = document.createElement('slot'); sl.name = 'c' + i; body.appendChild(sl); }
        else body.appendChild(it.el);
        inner.append(bar, body); c.appendChild(inner); deck.appendChild(c);
        c.addEventListener('pointerenter', () => { this._hover = i; this._place(); });
        c.addEventListener('pointerleave', () => { if (this._hover === i) { this._hover = -1; this._place(); } });
        return c;
      });
      this._hover = -1;
      this._spread = 0;

      this._ro = new ResizeObserver(() => this._place());
      this._ro.observe(this);

      // pointer + scroll
      this._t = { x: 0, y: 0 }; this._c = { x: 0, y: 0 };
      this._still = STATIC || RM.matches;
      if (!this._still) {
        this._onMove = e => {
          const r = this.getBoundingClientRect();
          if (r.bottom < 0 || r.top > innerHeight) return;
          this._t.x = (e.clientX / innerWidth - .5) * 2;
          this._t.y = (e.clientY / innerHeight - .5) * 2;
          this._kick();
        };
        this._onLeave = () => { this._t.x = 0; this._t.y = 0; this._kick(); };
        this._onScroll = () => this._kick();
        addEventListener('pointermove', this._onMove, { passive: true });
        document.addEventListener('pointerleave', this._onLeave);
        addEventListener('scroll', this._onScroll, { passive: true });
      }
      this._io = new IntersectionObserver(es => es.forEach(e => {
        if (e.isIntersecting) { this.classList.add('on'); }
      }), { threshold: .15 });
      if (this._still) { this.classList.add('on'); this._cards.forEach(c => c.querySelector('.in').style.transition = 'none'); }
      else {
        this._io.observe(this);
        // fallback: IntersectionObserver respects ancestor clip-path, so a parent that wipes in with clip-path
        // can hide the stack from it. Check the real box on scroll and on a short poll until it is revealed.
        this._poll = setInterval(() => this._checkVisible(), 400);
        setTimeout(() => clearInterval(this._poll), 20000);
      }
      this._apply();
    }

    disconnectedCallback() {
      this._ro && this._ro.disconnect(); this._io && this._io.disconnect(); clearInterval(this._poll);
      removeEventListener('pointermove', this._onMove); removeEventListener('scroll', this._onScroll);
      document.removeEventListener('pointerleave', this._onLeave);
      cancelAnimationFrame(this._raf);
    }

    _kick() { if (!this._raf) this._raf = requestAnimationFrame(() => this._tick()); }

    _checkVisible() {
      if (this.classList.contains('on')) { clearInterval(this._poll); return; }
      const r = this.getBoundingClientRect();
      if (r.width && r.bottom > innerHeight * .1 && r.top < innerHeight * .9) { this.classList.add('on'); clearInterval(this._poll); }
    }

    _tick() {
      this._raf = 0;
      this._checkVisible();
      const c = this._c, t = this._t;
      c.x += (t.x - c.x) * .075; c.y += (t.y - c.y) * .075;
      // scroll progress: 0 when the element's top sits at its initial place, 1 when it has left the viewport
      const r = this.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (innerHeight * .5 - (r.top + r.height / 2)) / (innerHeight * .9)));
      const prev = this._spread; this._spread = this._scrollMode === 'none' ? 0 : p;
      this._apply();
      if (Math.abs(t.x - c.x) > .001 || Math.abs(t.y - c.y) > .001) this._kick();
      if (Math.abs(prev - this._spread) > .001) this._place();
    }

    _apply() {
      const k = this._tilt, s = this._spread, c = this._c;
      const flat = this._scrollMode === 'flatten' ? s : 0;
      const rx = this._rx0 * (1 - flat * .8) - c.y * 6 * k;
      const ry = this._ry0 * (1 - flat * .7) + c.x * 9 * k;
      const rz = this._rz0 * (1 - flat * .5);
      this._deck.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg)`;
    }

    _place() {
      const w = this.clientWidth, h = this.clientHeight;
      if (!w) return;
      const maxW = parseFloat(getComputedStyle(this).getPropertyValue('--vs-width')) || 600;
      // fit the whole arrangement inside the element: extents in card-width units (cards are ~0.56 W tall)
      const P = this._L.pos;
      const ex = Math.max(...P.map(([x, , , sc]) => Math.abs(x) + sc / 2)) * 2;
      const ey = Math.max(...P.map(([, y, , sc]) => Math.abs(y) + sc * .3)) * 2;
      const tower = this._tower;
      const W = Math.min(maxW, (w * (tower ? .6 : .9)) / ex, (h * (tower ? .95 : .9)) / ey);
      const spread = this._scrollMode === 'spread' ? 1 + this._spread * .55 : 1;
      this._cards.forEach((card, i) => {
        const [x, y, z, sc] = this._L.pos[i];
        const cw = W * sc;
        card.style.width = cw + 'px';
        const lift = this._hover === i ? 50 : 0;
        const yy = y * W * spread;
        card.style.transform = `translate3d(calc(-50% + ${(x * W * spread).toFixed(1)}px), calc(-50% + ${yy.toFixed(1)}px), ${(z * spread + lift).toFixed(1)}px)`;
      });
    }
  }
  customElements.define('va-stack', VaStack);
})();
