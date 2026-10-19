// Beach, headlands and seagulls.
//   SHORE_WGSL  terrain height + shore helpers, shared by the ocean, the height probe and LAND
//   LAND        sand beach, dunes and the two headlands of the cove
//   GULLS       a few seagulls gliding and flapping over the beach
import { FRAME_WGSL, ATMO_CORE_WGSL, ENV_MIPS } from './common.js';
import { SKY_RENDER_FUNCS } from './sky.js';

// The camera starts on the sand looking out to sea (-Z). The waterline runs across the view
// SHORE_Z metres ahead; a near headland on the left and a farther one on the right close the
// cove and reach ~460 m out to sea. F.windP[1] = (swell angular frequency, swash amplitude,
// beach on/off, -). Requires NOISE_WGSL (gnoise) and F.
export const SHORE_WGSL = /* wgsl */ `
const SHORE_Z: f32 = -14.0;
const BEACH_SLOPE: f32 = 0.045;

fn beachOn() -> bool { return F.windP[1].z > 0.5; }

fn terrainH(p: vec2f) -> f32 {
  if (!beachOn()) { return -1.0e4; }
  let reach = max(smoothstep(-90.0, -420.0, p.x), smoothstep(260.0, 700.0, p.x));
  let zs = SHORE_Z - 460.0 * reach + 5.0 * gnoise(vec2f(p.x * 0.012, 3.1));
  let u = p.y - zs;                                    // metres inland of the waterline
  var h = clamp(u * BEACH_SLOPE, -16.0, 3.0);          // gentle sandy beach and seabed
  h += smoothstep(40.0, 160.0, u) * (3.0 + 2.0 * gnoise(p * 0.02));            // dunes
  let hill = reach * smoothstep(-60.0, 120.0, u) *
    (55.0 + 25.0 * gnoise(p * 0.004) + 6.0 * gnoise(p * 0.03));
  return h + hill;
}

// Waves shrink as the water gets shallow, so the sea meets the sand calmly.
fn shoreDamp(depth: f32) -> f32 { return smoothstep(0.2, 7.0, depth); }

// Phase of the swell arriving at the beach: crests move towards shallower water.
fn shorePhase(depth: f32) -> f32 { return F.windP[1].x * F.camPos.w + depth * 1.6; }

// Run-up and backwash: the water level in the shallows and on the sand rises and falls.
fn swash(depth: f32) -> f32 {
  let w = 1.0 - smoothstep(0.0, 2.5, depth);
  return F.windP[1].y * sin(shorePhase(depth)) * w;
}
`;

const LAND_BINDINGS = /* wgsl */ `
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var transLUT: texture_2d<f32>;
@group(0) @binding(2) var skyLUT: texture_2d<f32>;
@group(0) @binding(3) var sampC: sampler;
@group(0) @binding(4) var envCube: texture_cube<f32>;
@group(0) @binding(5) var<storage, read> sunVis: array<f32, 4>;
`;

// Lighting shared by the land and the birds: sun, sky hemisphere, aerial perspective.
const LAND_LIGHT = /* wgsl */ `
const ENV_MAXMIP: f32 = ${ENV_MIPS - 1}.0;
fn skyAmbient(n: vec3f) -> vec3f {
  let up = textureSampleLevel(envCube, sampC, vec3f(0.0, 1.0, 0.0), ENV_MAXMIP).rgb;
  let side = textureSampleLevel(envCube, sampC, normalize(vec3f(n.x, 0.35, n.z) + vec3f(1e-4, 0.0, 0.0)), ENV_MAXMIP - 1.0).rgb;
  return mix(side, up, clamp(n.y, 0.0, 1.0) * 0.6);
}
fn aerial(col: vec3f, rel: vec3f) -> vec3f {
  let dist = length(rel);
  let T = exp(-max(F.fogExt.rgb, vec3f(F.fogExt.w)) * dist);
  let hz = normalize(vec3f(rel.x, 0.002, rel.z) + vec3f(1e-5, 0.0, 0.0));
  return col * T + skyAtmo(hz) * (1.0 - T);
}
`;

// Polar grid around the camera: rings grow geometrically, so detail follows distance.
export const LAND_RINGS = 128, LAND_SEGS = 256;
export const LAND = FRAME_WGSL + ATMO_CORE_WGSL + LAND_BINDINGS + SKY_RENDER_FUNCS + SHORE_WGSL + LAND_LIGHT + /* wgsl */ `
struct VO {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,
  @location(1) xz: vec2f,
};
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VO {
  let ring = f32(vi / ${LAND_SEGS + 1}u);
  let seg = f32(vi % ${LAND_SEGS + 1}u);
  let r = 0.4 * (pow(1.07, ring) - 1.0) / 0.07;
  let a = seg / ${LAND_SEGS}.0 * 6.2831853;
  let xz = F.camPos.xz + r * vec2f(cos(a), sin(a));
  var o: VO;
  o.rel = vec3f(xz.x, terrainH(xz), xz.y) - F.camPos.xyz;
  o.pos = F.viewProj * vec4f(o.rel, 1.0);
  o.xz = xz;
  return o;
}

fn fresnelW(c: f32) -> f32 {
  let x = 1.0 - clamp(c, 0.0, 1.0);
  let x2 = x * x;
  return 0.02 + 0.98 * x2 * x2 * x;
}

@fragment fn fs(in: VO) -> @location(0) vec4f {
  let p = in.xz;
  let dist = length(in.rel);
  let e = max(0.05, dist * 0.004);
  let h = terrainH(p);
  let n = normalize(vec3f(terrainH(p - vec2f(e, 0.0)) - terrainH(p + vec2f(e, 0.0)), 2.0 * e,
                          terrainH(p - vec2f(0.0, e)) - terrainH(p + vec2f(0.0, e))));
  let V = -in.rel / dist;
  let Ld = F.sunDir.xyz;
  let sunE = sunIlluminance() * sunVis[0];

  // sand on gentle low ground, scrubby grass higher up, rock on the steep headland faces
  let grain = gnoise(p * 3.7) * 0.5 + gnoise(p * 17.0) * 0.25;
  var alb = vec3f(0.58, 0.48, 0.36) * (0.92 + 0.12 * grain);
  let grass = smoothstep(4.0, 9.0, h + 3.0 * gnoise(p * 0.05)) * smoothstep(0.55, 0.8, n.y);
  alb = mix(alb, vec3f(0.12, 0.16, 0.08), grass);
  let rock = 1.0 - smoothstep(0.45, 0.7, n.y);
  alb = mix(alb, vec3f(0.22, 0.2, 0.18) * (0.8 + 0.3 * gnoise(p * 0.7)), rock);

  // wet sand below the reach of the swash: darker and glossy, mirroring the sunset
  let reachUp = F.windP[1].y * 1.2;
  let wet = 1.0 - smoothstep(reachUp * 0.4, reachUp * 1.4, h);
  alb *= 1.0 - 0.45 * wet;

  let amb = skyAmbient(n);
  var col = alb * (sunE * max(dot(n, Ld), 0.0) * 0.318 + amb * 0.9);
  if (wet > 0.0) {
    let nW = normalize(mix(n, vec3f(0.0, 1.0, 0.0), 0.7));
    var R = reflect(-V, nW);
    R.y = abs(R.y);
    let refl = textureSampleLevel(envCube, sampC, R, 2.0).rgb;
    col += refl * fresnelW(dot(nW, V)) * wet * 0.9;
  }
  return vec4f(aerial(col, in.rel), 1.0);
}
`;

// Each gull is 8 triangles: a slim body and two wings with an elbow and a swept tip.
// Vertex table: xyz in the bird's frame (x right, y up, z forward), w = joint
// (0 body, 1 elbow, 2 tip) which the flapping rotates.
export const GULL_COUNT = 14, GULL_VERTS = 24;
export const GULLS = FRAME_WGSL + ATMO_CORE_WGSL + LAND_BINDINGS + SKY_RENDER_FUNCS + LAND_LIGHT + /* wgsl */ `
const GV = array<vec4f, ${GULL_VERTS}>(
  vec4f(0.0, 0.0, 0.28, 0.0), vec4f(-0.06, 0.0, 0.0, 0.0), vec4f(0.06, 0.0, 0.0, 0.0),
  vec4f(-0.06, 0.0, 0.0, 0.0), vec4f(0.0, 0.0, -0.32, 0.0), vec4f(0.06, 0.0, 0.0, 0.0),
  vec4f(-0.05, 0.0, 0.1, 0.0), vec4f(-0.05, 0.0, -0.08, 0.0), vec4f(-0.32, 0.0, 0.07, 1.0),
  vec4f(-0.05, 0.0, -0.08, 0.0), vec4f(-0.32, 0.0, -0.07, 1.0), vec4f(-0.32, 0.0, 0.07, 1.0),
  vec4f(-0.32, 0.0, 0.07, 1.0), vec4f(-0.32, 0.0, -0.07, 1.0), vec4f(-0.7, 0.0, -0.12, 2.0),
  vec4f(0.05, 0.0, 0.1, 0.0), vec4f(0.32, 0.0, 0.07, 1.0), vec4f(0.05, 0.0, -0.08, 0.0),
  vec4f(0.05, 0.0, -0.08, 0.0), vec4f(0.32, 0.0, 0.07, 1.0), vec4f(0.32, 0.0, -0.07, 1.0),
  vec4f(0.32, 0.0, 0.07, 1.0), vec4f(0.7, 0.0, -0.12, 2.0), vec4f(0.32, 0.0, -0.07, 1.0),
);

fn hash1(i: u32) -> f32 { return f32(pcgHash(i)) / 4294967296.0; }

struct VO {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,
};
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  let t = F.camPos.w;
  let s = ii * 7u;
  // each gull circles its own spot over the cove, slowly drifting along the beach
  let centre = vec3f(-90.0 + 180.0 * hash1(s), 9.0 + 26.0 * hash1(s + 1u), -25.0 - 110.0 * hash1(s + 2u));
  let radius = 14.0 + 40.0 * hash1(s + 3u);
  let dirSign = select(-1.0, 1.0, hash1(s + 4u) > 0.5);
  let speed = 6.5 + 3.0 * hash1(s + 5u);
  let ang = dirSign * t * speed / radius + 6.2831853 * hash1(s + 6u);
  let drift = vec3f(12.0 * sin(t * 0.021 + f32(ii)), 1.5 * sin(t * 0.37 + f32(ii) * 2.1), 0.0);
  let pos = centre + drift + vec3f(cos(ang) * radius, 0.0, sin(ang) * radius);
  let fwd = normalize(vec3f(-sin(ang), 0.0, cos(ang)) * dirSign);
  let bank = -dirSign * clamp(speed * speed / (9.81 * radius), 0.0, 0.6);   // lean into the turn
  let right0 = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
  let right = right0 * cos(bank) + vec3f(0.0, 1.0, 0.0) * sin(bank);
  let up = cross(right, fwd);

  // glide most of the time with a slight dihedral, now and then a run of wingbeats
  let flapping = smoothstep(0.55, 0.8, sin(t * 0.23 + f32(ii) * 1.7));
  let beat = sin(t * 11.0 + f32(ii) * 3.0);
  let a = 0.12 + flapping * 0.55 * beat;
  let v = GV[vi];
  let side = sign(v.x);
  var lp = v.xyz;
  if (v.w > 0.5) {
    let ax = abs(lp.x);
    lp.y = ax * sin(a);
    lp.x = side * ax * cos(a);
    if (v.w > 1.5) { lp.y -= flapping * 0.12 * beat + 0.04; }   // the hand trails the beat
  }
  let world = pos + right * lp.x + up * lp.y + fwd * lp.z;
  var o: VO;
  o.rel = world - F.camPos.xyz;
  o.pos = F.viewProj * vec4f(o.rel, 1.0);
  return o;
}

@fragment fn fs(in: VO) -> @location(0) vec4f {
  var n = normalize(cross(dpdx(in.rel), dpdy(in.rel)));
  if (dot(n, in.rel) > 0.0) { n = -n; }
  let sunE = sunIlluminance() * sunVis[0];
  // white undersides lit by the sky and the bright sea, grey upper wings
  let alb = select(vec3f(0.45, 0.47, 0.5), vec3f(0.8, 0.8, 0.78), n.y < 0.0);
  let col = alb * (sunE * max(dot(n, F.sunDir.xyz), 0.0) * 0.318 + skyAmbient(n) * 0.8 +
                   skyAmbient(vec3f(0.0, 1.0, 0.0)) * 0.25 * max(-n.y, 0.0));
  return vec4f(aerial(col, in.rel), 1.0);
}
`;
