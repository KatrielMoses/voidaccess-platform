/**
 * Sigma node program that draws each node as a line-drawn glyph (dot, ring, contour, square, diamond, triangle,
 * dashed ring) chosen per entity family: lib/results/glyphs.ts. One draw call for every shape, so it costs the
 * same as sigma's own circle program.
 *
 * Colour rule (design.md §7): nodes are opaque over the field. A node's colour alpha is its intensity: the shader
 * mixes the colour into the field colour (#0F0F12) and hollow shapes are filled with the field, so edges behind
 * a node are hidden, like the terrain's hidden-line fill.
 */
import type { Attributes } from "graphology-types";
import { NodeProgram, type ProgramInfo } from "sigma/rendering";
import type { NodeDisplayData, RenderParams } from "sigma/types";
import { floatColor } from "sigma/utils";
import { SHAPE, type ShapeName } from "./glyphs";

const VERTEX = /* glsl */ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
attribute float a_shape;
attribute float a_angle;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;
varying float v_shape;

const float bias = 255.0 / 254.0;
// the triangle's incircle is MARGIN x the node radius, so squares, diamonds and triangles fit inside it
const float MARGIN = 1.45;

void main() {
  float radius = a_size * u_correctionRatio / u_sizeRatio * 2.0;
  vec2 diffVector = radius * MARGIN * 2.0 * vec2(cos(a_angle), sin(a_angle));
  vec2 position = a_position + diffVector;
  gl_Position = vec4((u_matrix * vec3(position, 1)).xy, 0, 1);
  v_diffVector = diffVector;
  v_radius = radius;
  v_shape = a_shape;
  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif
  v_color.a *= bias;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;
varying float v_shape;

uniform float u_correctionRatio;

const vec3 FIELD = vec3(15.0, 15.0, 18.0) / 255.0;

float sdCircle(vec2 p, float r) { return length(p) - r; }
float sdBox(vec2 p, float s) {
  vec2 q = abs(p) - vec2(s);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}
float sdDiamond(vec2 p, float d) { return (abs(p.x) + abs(p.y) - d) * 0.7071; }
float sdTriangle(vec2 p, float R) {
  float r = R * 0.8660;
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

void main(void) {
  // p: position in units of the node radius; px: one CSS pixel in the same units
  vec2 p = v_diffVector / v_radius;
  float px = 2.0 * u_correctionRatio / v_radius;
  int shape = int(v_shape + 0.5);

  float outer;
  if (shape == 3 || shape == 4) outer = sdBox(p, 0.86);
  else if (shape == 5 || shape == 6) outer = sdDiamond(p, 1.2);
  else if (shape == 7) outer = sdTriangle(p + vec2(0.0, 0.24), 1.2);
  else outer = sdCircle(p, 1.0);

  #ifdef PICKING_MODE
  // the whole silhouette is clickable, hollow shapes included
  if (outer > 0.0) discard;
  gl_FragColor = v_color;
  #else
  float cover = 1.0 - smoothstep(-0.5 * px, 0.5 * px, outer);
  if (cover <= 0.0) discard;

  // ink: 1 where the glyph is drawn in colour, 0 where the field shows through (inside hollow shapes)
  float ink = 1.0;
  bool hollow = shape == 1 || shape == 2 || shape == 4 || shape == 6 || shape == 8;
  if (hollow) {
    float w = 1.25 * px;
    ink = smoothstep(-w - 0.5 * px, -w + 0.5 * px, outer);
    if (shape == 2) {
      // contour: a ring around a solid core, like the entity cards' innermost ring
      float core = 1.0 - smoothstep(-0.5 * px, 0.5 * px, sdCircle(p, 0.4));
      ink = max(ink, core);
    } else if (shape == 8) {
      float a = atan(p.y, p.x) / 6.2831853;
      ink *= step(0.5, fract(a * 8.0 + 0.25));
    }
  }
  vec3 color = mix(FIELD, v_color.rgb, v_color.a);
  vec3 rgb = mix(FIELD, color, ink);
  gl_FragColor = vec4(rgb * cover, cover);
  #endif
}
`;

const { UNSIGNED_BYTE, FLOAT } = WebGLRenderingContext;
const UNIFORMS = ["u_sizeRatio", "u_correctionRatio", "u_matrix"] as const;

export class NodeGlyphProgram<
  N extends Attributes = Attributes,
  E extends Attributes = Attributes,
  G extends Attributes = Attributes,
> extends NodeProgram<(typeof UNIFORMS)[number], N, E, G> {
  getDefinition() {
    return {
      VERTICES: 3,
      VERTEX_SHADER_SOURCE: VERTEX,
      FRAGMENT_SHADER_SOURCE: FRAGMENT,
      METHOD: WebGLRenderingContext.TRIANGLES,
      UNIFORMS,
      ATTRIBUTES: [
        { name: "a_position", size: 2, type: FLOAT },
        { name: "a_size", size: 1, type: FLOAT },
        { name: "a_shape", size: 1, type: FLOAT },
        { name: "a_color", size: 4, type: UNSIGNED_BYTE, normalized: true },
        { name: "a_id", size: 4, type: UNSIGNED_BYTE, normalized: true },
      ],
      CONSTANT_ATTRIBUTES: [{ name: "a_angle", size: 1, type: FLOAT }],
      CONSTANT_DATA: [[0], [(2 * Math.PI) / 3], [(4 * Math.PI) / 3]],
    };
  }

  processVisibleItem(nodeIndex: number, startIndex: number, data: NodeDisplayData) {
    const array = this.array;
    const shape = (data as NodeDisplayData & { shape?: ShapeName }).shape;
    array[startIndex++] = data.x;
    array[startIndex++] = data.y;
    array[startIndex++] = data.size;
    array[startIndex++] = SHAPE[shape ?? "dot"] ?? 0;
    array[startIndex++] = floatColor(data.color);
    array[startIndex++] = nodeIndex;
  }

  setUniforms(params: RenderParams, { gl, uniformLocations }: ProgramInfo) {
    gl.uniform1f(uniformLocations.u_correctionRatio!, params.correctionRatio);
    gl.uniform1f(uniformLocations.u_sizeRatio!, params.sizeRatio);
    gl.uniformMatrix3fv(uniformLocations.u_matrix!, false, params.matrix);
  }
}
