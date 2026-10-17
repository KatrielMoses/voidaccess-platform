/**
 * The brand terrain behind the live view (design.md §7), ported from apps/site/public/js/terrain-field.js (locked
 * from mockup 81): the same simplex noise, ridged fBm, isoline shader and hidden-line fill, on three.js r186 (the
 * npm build at the site's vendored version, 0.186.1). One live mode is added:
 *
 *  - `clear` (0..1, the share of collected noise discarded) filters the finest octaves out first and lowers the
 *    relief: the more noise removed, the calmer the ground;
 *  - `signal` (0..1, from entities found) raises the one clean travelling wave on a single ridge row, in v-500:
 *    the only violet thing in the view.
 *
 * Decorative (the canvas is aria-hidden). DPR capped at 2; the owner pauses it when the tab is hidden or the
 * instrument is off-screen. Throws if WebGL is unavailable (the caller keeps the plain page colour).
 */
import * as THREE from "three";

THREE.ColorManagement.enabled = false; // page hex colours in, page hex colours out

const NOISE = /* glsl */ `
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

const VERT = /* glsl */ `
${NOISE}
uniform float uT,uFlow,uClear,uSignal,uSig0,uSpacing,uScale,uOn;
varying vec3 vW; varying float vSig,vDist;
void main(){
  vec3 p=position;
  float P=uClear*.92;                                        // fine octaves go first, as on the home page
  float zf=p.z+uFlow;
  float relief=1.-.86*smoothstep(0.,1.,uClear);              // the ground calms as noise is discarded
  float h=rough(vec2(p.x,zf),P)*relief*uScale;
  h*=mix(.35,1.,smoothstep(6.5,2.5,p.z));                    // the closest rows settle
  float rowd=(p.z-uSig0)/(uSpacing*.62);
  float sg=uSignal*exp(-rowd*rowd);
  h+=sg*(.4+.3*sin(1.55*p.x-1.25*uT));                       // the signal rides wholly above the ground
  p.y=h*uOn;
  vSig=sg; vW=p;
  vec4 mv=modelViewMatrix*vec4(p,1.); vDist=-mv.z;
  gl_Position=projectionMatrix*mv;
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform vec3 uBg,uLine,uAcc;
uniform float uSpacing,uFlow,uDpr,uFar,uSig0,uDim,uSignal;
varying vec3 vW; varying float vSig,vDist;
float iso(float c,float wpx){
  float fw=max(fwidth(c),1e-4);
  float d=abs(fract(c+.5)-.5)/fw;
  return clamp(wpx*.5+.5-d,0.,1.)*(1.-smoothstep(.22,.5,fw));
}
void main(){
  float zf=vW.z+uFlow;
  float rows=iso(zf/uSpacing,uDpr);
  float fog=smoothstep(uFar*.86,uFar*.3,vDist);
  float sideFade=smoothstep(10.,6.,abs(vW.x));
  float a=rows*fog*sideFade*(1.-smoothstep(.04,.25,vSig))*uDim;
  float sr=iso((vW.z-uSig0)/uSpacing,1.6*uDpr)*step(abs(vW.z-uSig0),uSpacing*.5)*smoothstep(.05,.4,vSig)*fog;
  vec3 c=mix(uBg,uLine,a*.62);
  c=mix(c,uAcc,sr*smoothstep(0.,.2,uSignal));
  gl_FragColor=vec4(c,1.);
}`;

export class LiveTerrain {
  private r: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam: THREE.PerspectiveCamera;
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private u: Record<string, THREE.IUniform>;
  private W = 0;
  private H = 0;
  private flow = 0;
  /** smoothed values actually drawn */
  private clear = 0;
  private sig = 0;
  target = { clear: 0, signal: 0 };
  small = false;
  private ro: ResizeObserver;

  constructor(private readonly wrap: HTMLElement) {
    const r = (this.r = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.setClearColor(new THREE.Color("#0F0F12"), 1);
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.domElement.setAttribute("aria-hidden", "true");
    r.domElement.style.display = "block";
    wrap.appendChild(r.domElement);
    this.cam = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
    const geo = new THREE.PlaneGeometry(24, 26, 280, 220);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -6);
    this.u = {
      uT: { value: 0 },
      uFlow: { value: 0 },
      uClear: { value: 0 },
      uSignal: { value: 0 },
      uSig0: { value: -3.4 },
      uSpacing: { value: 0.2 },
      uScale: { value: 0.85 },
      uOn: { value: 1 },
      uDim: { value: 0.72 }, // a backdrop: the instrument's marks sit on top
      uBg: { value: new THREE.Color("#0F0F12") },
      uLine: { value: new THREE.Color("#D8D6D2") }, // paper at 88% over the page
      uAcc: { value: new THREE.Color("#6A75EF") }, // v-500: the signal
      uDpr: { value: r.getPixelRatio() },
      uFar: { value: 28 },
    };
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.scene.add(this.mesh);
    (this.ro = new ResizeObserver(() => this.resize())).observe(wrap);
    this.resize();
  }

  resize(): void {
    const w = this.wrap.clientWidth;
    const h = this.wrap.clientHeight;
    if (!w || !h) return;
    this.W = w;
    this.H = h;
    this.small = w <= 959;
    this.r.setSize(w, h);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  }

  /** Jump to the target without easing (fast-forward, reduced motion). */
  settle(): void {
    this.clear = this.target.clear;
    this.sig = this.target.signal;
  }

  frame(dt: number, still = false): void {
    if (!this.W) return;
    const k = still ? 1 : 1 - Math.exp(-dt / 1.4); // slow, expo-like approach: the ground calms, never snaps
    this.clear += (this.target.clear - this.clear) * k;
    this.sig += (this.target.signal - this.sig) * k;
    this.flow += still ? 0 : dt * (0.42 * (1 - 0.8 * this.clear) + 0.03);
    this.u.uT!.value += still ? 0 : dt;
    this.u.uFlow!.value = this.flow;
    this.u.uClear!.value = this.clear;
    this.u.uSignal!.value = this.sig;
    const lift = this.clear * 0.6;
    this.cam.position.set(0, (this.small ? 3 : 2.1) + lift, this.small ? 11 : 9);
    this.cam.lookAt(0, this.cam.position.y - (this.small ? 1.9 : 1.35), -4);
    this.r.render(this.scene, this.cam);
  }

  dispose(): void {
    this.ro.disconnect();
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.r.dispose();
    this.r.domElement.remove();
  }
}
