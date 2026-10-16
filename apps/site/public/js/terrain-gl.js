/* WebGL terrain fields (three.js r186). Locked from mockup 81. */
/* The home page's three fields (hero, pipeline, final). The shaders and the Field class live in terrain-field.js,
   shared with the React pages. */
import * as THREE from 'three';
import { Field, calmField } from './terrain-field.js';
const SIG = window.SIG, T = window.TER, still = SIG.still;

// JS mirror of the vertex height (for survey markers)
const heroH = (x, z) => { const P = T.sm(-4.6, 2.6, x); let h = T.rough(x, z, P) * (1 - T.sm(0, .92, P)) * .78; h *= .35 + .65 * T.sm(6.5, 2.5, z); return h; };

const fields = [];
try {
  /* ---- hero: a panorama; survey markers stand on the highest peaks ---- */
  const ptr = { x: 0, y: 0, cx: 0, cy: 0, hz: -99, ha: 0 };
  addEventListener('pointermove', e => { ptr.x = (e.clientX / innerWidth - .5) * 2; ptr.y = (e.clientY / innerHeight - .5) * 2; ptr.px = e.clientX; ptr.py = e.clientY; }, { passive: true });
  const heroEl = document.getElementById('tHero');
  const small = () => innerWidth <= 960;
  // pick six peaks across the rough side
  const anchors = [];
  for (let i = 0; i < 6; i++) {
    const xc = -6.9 + i * 2.55; let best = [xc, -7, -9];
    for (let x = xc - .35; x <= xc + .35; x += .05) for (let z = -9.5; z <= -5.5; z += .1) { const h = heroH(x, z); if (h > best[2] + .002) best = [x, z, h]; }
    anchors.push(best);
  }
  // a narrower set for the mobile camera
  const anchorsM = [-4.1, -1.9, .2].map(xc => { let best = [xc, -7, -9]; for (let x = xc - .3; x <= xc + .3; x += .05) for (let z = -9; z <= -5.5; z += .1) { const h = heroH(x, z); if (h > best[2] + .002) best = [x, z, h]; } return best; });
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  const hero = new Field(heroEl, {
    still, mode: 0, fov: 30, W: 22, D: 28, sx: 340, sz: 340, cz: -4, spacing: .17, scale: .78, far: 26, sig0: -4.3,
    update(f, dt) {
      const k = 1 - Math.exp(-dt / .8);
      ptr.cx += (ptr.x - ptr.cx) * k; ptr.cy += (ptr.y - ptr.cy) * k;
      const sc = SIG.hero.scroll || 0, mob = small();
      f.cam.position.set(ptr.cx * .35 + (mob ? -1.2 : 0), (mob ? 2.1 : 1.55) + sc * 1.4 - ptr.cy * .12, mob ? 10.5 : 8.6);
      f.cam.lookAt(mob ? -1.2 : 0, .15 - sc * .6, -4);
      f.u.uOn.value = SIG.hero.on;
      // the row under the pointer lights up
      if (ptr.px != null && !mob) {
        const r = heroEl.getBoundingClientRect(); const nx = ((ptr.px - r.left) / r.width) * 2 - 1, ny = -((ptr.py - r.top) / r.height) * 2 + 1;
        if (ny > -1 && ny < 1) { ray.setFromCamera({ x: nx, y: ny }, f.cam); if (ray.ray.intersectPlane(plane, hit) && hit.z < 5 && hit.z > -16) { ptr.hz = Math.round(hit.z / .17) * .17; ptr.ha += (1 - ptr.ha) * k * 2; } else ptr.ha *= .9; } else ptr.ha *= .9;
      }
      f.u.uHiZ.value = ptr.hz; f.u.uHiA.value = Math.min(1, ptr.ha) * .8;
      // survey markers
      const n = mob ? 3 : 6;
      SIG.marks.forEach((m, i) => {
        if (i >= n) { m.el.style.display = 'none'; return; }
        m.el.style.display = '';
        const [x, z, h] = mob ? anchorsM[i] : anchors[i];
        const [sx, sy] = f.project(x, h * SIG.hero.on, z), ox = heroEl.offsetLeft, oy = heroEl.offsetTop;
        const len = (mob ? [40, 72, 52] : [64, 112, 78, 124, 70, 104])[i];
        m.el.style.transform = `translate(${(sx + ox).toFixed(1)}px,${(sy + oy).toFixed(1)}px)`;
        m.el.style.opacity = m.a; m.line.style.height = (len * m.a) + 'px'; m.lab.style.bottom = (len * m.a) + 'px';
      });
      return false;
    },
  });
  fields.push(hero);

  /* ---- pipeline: a flyover; the ground flattens stage by stage into one clean wave ---- */
  let flow = 0, lastPP = -1;
  const pipe = new Field(document.getElementById('tPipe'), {
    still, mode: 1, fov: 34, W: 24, D: 30, sx: 340, sz: 320, cz: -8, spacing: .18, scale: .9, far: 30, sig0: -3,
    update(f, dt) {
      const P = SIG.pipe.P, mob = small();
      flow += dt * (.55 * (1 - T.sm(.55, .95, P)) + .02);
      f.u.uFlow.value = flow; f.u.uP.value = P; f.u.uOn.value = SIG.pipe.on;
      const lift = T.sm(.4, 1, P);
      f.cam.position.set(0, (mob ? 2.6 : 1.9) + lift * 1.6, mob ? 11 : 8.5);
      f.cam.lookAt(0, f.cam.position.y - (mob ? 1.7 : 1.12), -4);
      const ch = P !== lastPP; lastPP = P; return ch;
    },
  });
  fields.push(pipe);

  /* ---- final: calm water-like field; keystrokes ripple outward like the logo's rings ---- */
  const fin = calmField(document.getElementById('tFinal'), SIG.final, { still, small });
  fields.push(fin);
} catch (err) { console.warn('Terrain unavailable', err); }

let last = performance.now();
gsap.ticker.add(() => {
  const now = performance.now(), dt = still ? 0 : Math.min(.05, (now - last) / 1000); last = now;
  for (const f of fields) f.frame(dt, now / 1000);
  for (const l of SIG.loops) if ((still || l.vis()) && !document.hidden) l.tick(dt || (still ? 0 : .016));
});
