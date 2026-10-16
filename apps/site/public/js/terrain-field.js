/* The terrain field shared by the home page (terrain-gl.js) and the React pages (sign-in). Locked from mockup 81.
   The shaders and the Field class were moved here unchanged from terrain-gl.js, so the home page renders exactly as
   before. three.js is imported by URL (not the bare 'three' of the home's import map) so it also loads on pages that
   have no import map; the home's 'three' maps to the same URL, so both get the same module instance. */
/* ===================================================================================
   three.js ridge fields. One displaced plane per scene; the fragment shader draws the
   z-isolines (the ridge lines) with analytic, derivative-based anti-aliasing at a constant
   1px width and fills everything else with the page colour, so nearer ridges hide farther
   ones (hidden-line removal for free). Fades into the page with distance. No glow.
   =================================================================================== */
import * as THREE from '/vendor/three/three.module.min.js';
THREE.ColorManagement.enabled = false;   // page hex colours in, page hex colours out
export { THREE };

const NOISE = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec2 mod289(vec2 x){return x-floor(x*(1./289.))*289.;}
vec3 permute(vec3 x){return mod289(((x*34.)+1.)*x);}
float snoise(vec2 v){
  const vec4 C=vec4(.211324865405187,.366025403784439,-.577350269189626,.024390243902439);
  vec2 i=floor(v+dot(v,C.yy)); vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.,0.):vec2(0.,1.);
  vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1;
  i=mod289(i);
  vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
  vec3 m=max(.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.); m=m*m; m=m*m;
  vec3 x=2.*fract(p*C.www)-1.; vec3 h=abs(x)-.5; vec3 ox=floor(x+.5); vec3 a0=x-ox;
  m*=1.79284291400159-.85373472095314*(a0*a0+h*h);
  vec3 g; g.x=a0.x*x0.x+h.x*x0.y; g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.*dot(m,g);
}
const float S=1./13.;
float relief(float P){ float a=1.; a+=(.62-a)*smoothstep(2.*S,2.2*S,P); a-=.22*smoothstep(2.2*S,9.*S,P); a+=(.12-a)*smoothstep(9.*S,9.2*S,P); a*=1.-smoothstep(9.2*S,12.6*S,P); return a; }
float sigAmp(float P){ return smoothstep(8.6*S,12.4*S,P); }
float rough(vec2 p,float P){
  float s=0.,a=1.,f=.26,nm=0.;
  float CUT[5]=float[5](1.15,.86,.6,.38,.2);
  for(int i=0;i<5;i++){
    float w=1.-smoothstep(CUT[i]-.07,CUT[i]+.07,P);
    float n=snoise(vec2(p.x*f+float(i)*17.3,p.y*f-float(i)*9.1));
    float r=1.-abs(n);
    s+=a*w*(n*.62+(r*r-.45)*.5); nm+=a; a*=.48; f*=2.07;
  }
  return s/nm*1.7;
}`;

const VERT = /* glsl */`
${NOISE}
uniform float uT,uFlow,uP,uMode,uSig0,uSpacing,uScale,uDrop[24],uOn,uHeroX0,uHeroX1;
varying vec3 vW; varying float vSig,vDist;
float height(vec2 p,out float sg){
  float P=uP;
  if(uMode<.5) P=smoothstep(uHeroX0,uHeroX1,p.x);           // hero: noise on the left, a clean line on the right
  float zf=p.y+uFlow;
  float h=rough(vec2(p.x,zf),P)*(uMode<.5?1.-smoothstep(.0,.92,P):relief(P))*uScale;
  float near=smoothstep(6.5,2.5,p.y);                       // the closest rows settle so nothing crowds the type
  h*=mix(.35,1.,near);
  float rowd=(p.y-uSig0)/(uSpacing*.62);
  sg=sigAmp(P)*exp(-rowd*rowd);
  h+=sg*(.4+.3*sin(1.55*p.x-1.25*uT));                      // the wave rides wholly above the ground, so none of it is hidden
  if(uMode>1.5){                                             // final: keystrokes drop ripples on a calm field
    h=.08*sin(.9*p.x-.6*uT)*sin(.5*p.y+.3*uT)*uOn;
    for(int k=0;k<8;k++){
      float dx=p.x-uDrop[k*3],dz=p.y-uDrop[k*3+1],age=uDrop[k*3+2];
      if(age<0.||age>6.) continue;
      float r=sqrt(dx*dx+dz*dz),front=age*2.4;
      h+=.45*exp(-age*.75)*exp(-pow((r-front)/.9,2.))*sin(4.*(r-front));
    }
    sg=0.;
  }
  return h*uOn;
}
void main(){
  vec3 p=position; float sg;
  p.y=height(p.xz,sg);
  vSig=sg; vW=p;
  vec4 mv=modelViewMatrix*vec4(p,1.); vDist=-mv.z;
  gl_Position=projectionMatrix*mv;
}`;

const FRAG = /* glsl */`
precision highp float;
uniform vec3 uBg,uLine,uAcc,uHi;
uniform float uSpacing,uFlow,uDpr,uFar,uSig0,uHiZ,uHiA,uLw,uMode,uP;
varying vec3 vW; varying float vSig,vDist;
float iso(float c,float wpx){
  float fw=max(fwidth(c),1e-4);
  float d=abs(fract(c+.5)-.5)/fw;
  return clamp(wpx*.5+.5-d,0.,1.)*(1.-smoothstep(.22,.5,fw));
}
void main(){
  float zf=vW.z+(uMode>1.5?0.:uFlow);
  float rows=iso(zf/uSpacing,uLw*uDpr);
  float fog=smoothstep(uFar*.86,uFar*.3,vDist);
  float sideFade=smoothstep(9.,5.5,abs(vW.x));
  float quiet=uMode<.5?1.:1.-.45*smoothstep(.75,1.,uP);       // the other rows step back once the signal is clean
  float a=rows*fog*sideFade*(1.-smoothstep(.04,.25,vSig))*quiet;
  // the signal row: one ridge line carrying the clean wave
  float sr=iso((vW.z-uSig0)/uSpacing,1.6*uDpr)*step(abs(vW.z-uSig0),uSpacing*.5)*smoothstep(.05,.4,vSig)*fog;
  // the pointer's row
  float hr=uHiA*step(abs(zf-uHiZ),uSpacing*.5)*rows*fog;
  vec3 c=mix(uBg,uLine,a*.62);
  c=mix(c,uHi,hr*.9);
  c=mix(c,uAcc,sr);
  gl_FragColor=vec4(c,1.);
}`;

const hex = h => new THREE.Color(h);
export class Field {
  constructor(wrap, o) {
    this.wrap = wrap; this.o = o;
    const r = this.r = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(2, devicePixelRatio || 1)); r.setClearColor(hex('#0F0F12'), 1);
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    wrap.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(o.fov || 32, 1, .1, 80);
    const geo = new THREE.PlaneGeometry(o.W || 20, o.D || 26, o.sx || 260, o.sz || 220); geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, o.cz ?? -6);
    this.u = {
      uT: { value: 0 }, uFlow: { value: 0 }, uP: { value: 0 }, uMode: { value: o.mode }, uSig0: { value: o.sig0 ?? -2 }, uSpacing: { value: o.spacing || .26 },
      uScale: { value: o.scale || 1 }, uDrop: { value: new Array(24).fill(-99) }, uOn: { value: 1 }, uHeroX0: { value: -4.6 }, uHeroX1: { value: 2.6 },
      uBg: { value: hex('#0F0F12') }, uLine: { value: hex('#D8D6D2') }, uAcc: { value: hex('#6A75EF') }, uHi: { value: hex('#F3F1EC') },   // line = paper #F3F1EC at 88% over the #0F0F12 page; acc = v-500, the one violet line
      uDpr: { value: r.getPixelRatio() }, uFar: { value: o.far || 30 }, uHiZ: { value: -99 }, uHiA: { value: 0 }, uLw: { value: o.lw || 1 },
    };
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u });
    this.mesh = new THREE.Mesh(geo, this.mat); this.scene.add(this.mesh);
    this.vis = false; this.dirty = true; this.t = o.t0 || 0;
    (this.io = new IntersectionObserver(es => es.forEach(e => { this.vis = e.isIntersecting; this.dirty = true; }), { rootMargin: '100px' })).observe(wrap);
    (this.ro = new ResizeObserver(() => this.resize())).observe(wrap);
    this.resize();
  }
  resize() { const w = this.wrap.clientWidth, h = this.wrap.clientHeight; if (!w || !h) return; this.r.setSize(w, h); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); this.W = w; this.H = h; this.dirty = true; this.o.resize && this.o.resize(this); }
  frame(dt, now) {
    if (!this.vis || document.hidden || !this.W) return;
    this.t += dt; this.u.uT.value = this.t;
    const ch = this.o.update(this, dt, now);
    if (this.o.still && !ch && !this.dirty) return;
    this.dirty = false; this.r.render(this.scene, this.cam);
  }
  dispose() { this.io.disconnect(); this.ro.disconnect(); this.mesh.geometry.dispose(); this.mat.dispose(); this.r.dispose(); this.r.domElement.remove(); }
  project(x, y, z) { const v = new THREE.Vector3(x, y, z).project(this.cam); return [(v.x * .5 + .5) * this.W, (-v.y * .5 + .5) * this.H, v.z]; }
}

/* The calm field (the home's closing section, design.md §7): a quiet water-like surface; every keystroke drops a
   ripple that runs outward like the logo's rings, and a submit drops a bigger one at the centre ("locks" the field).
   F = { on: 0..1, drops: [{ x, z, t, a }] } is the page's state; the newest eight drops are drawn. */
export function calmField(wrap, F, { still = false, small = () => innerWidth <= 960 } = {}) {
  return new Field(wrap, {
    still, mode: 2, fov: 30, W: 26, D: 22, sx: 300, sz: 260, cz: -5, spacing: .17, far: 24,
    update(f, dt, now) {
      const d = f.u.uDrop.value;
      for (let k = 0; k < 8; k++) { const p = F.drops[F.drops.length - 1 - k]; if (p) { d[k * 3] = p.x; d[k * 3 + 1] = p.z; d[k * 3 + 2] = (now - p.t) * (p.a > .4 ? 1 : 1.2); } else d[k * 3 + 2] = -1; }
      f.u.uOn.value = F.on;
      f.cam.position.set(0, small() ? 3.2 : 2.6, 9); f.cam.lookAt(0, -.4, -3);
      return false;
    },
  });
}
