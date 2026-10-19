// Beach, headlands and seagulls.
//   SHORE_WGSL  terrain height + shore helpers, shared by the ocean, the height probe and LAND
//   LAND        sand beach, dunes and the two headlands of the cove
//   GULLS       a few seagulls gliding and flapping over the beach
//   PALMS       coconut palms along both sides of the beach, swaying in the wind
import { FRAME_WGSL, ATMO_CORE_WGSL, ENV_MIPS } from './common.js';
import { SKY_RENDER_FUNCS } from './sky.js';

// The camera starts on the sand looking out to sea (-Z). The waterline crosses the view
// SHORE_Z metres from the origin and curves seaward on both sides into a bay; a near headland
// on the left and a farther one on the right close the cove ~460 m out to sea. F.windP[1] = (swell angular frequency, swash amplitude,
// beach on/off, -). Requires NOISE_WGSL (gnoise) and F.
export const SHORE_WGSL = /* wgsl */ `
const SHORE_Z: f32 = -14.0;
const BEACH_SLOPE: f32 = 0.045;

fn beachOn() -> bool { return F.windP[1].z > 0.5; }

fn headland(x: f32) -> f32 { return max(smoothstep(-90.0, -420.0, x), smoothstep(260.0, 700.0, x)); }

// z of the waterline at x
fn shoreZ(x: f32) -> f32 {
  return SHORE_Z - min(0.0035 * x * x, 120.0) - 340.0 * headland(x) + 5.0 * gnoise(vec2f(x * 0.012, 3.1));
}

fn terrainH(p: vec2f) -> f32 {
  if (!beachOn()) { return -1.0e4; }
  let reach = headland(p.x);
  let u = p.y - shoreZ(p.x);                           // metres inland of the waterline
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

fn hashC(c: vec2i, k: u32) -> f32 {
  return f32(pcgHash(pcgHash((u32(c.x) * 73856093u) ^ (u32(c.y) * 19349663u)) + k)) / 4294967296.0;
}
fn rot2(q: vec2f, a: f32) -> vec2f { return vec2f(q.x * cos(a) + q.y * sin(a), -q.x * sin(a) + q.y * cos(a)); }

// Things lying on the sand, one per 0.55 m cell at most: pebbles, scallop shells, starfish and
// white shell fragments, more of them along the wrack line. fp is the pixel footprint in
// metres, used for anti-aliasing and to fade out objects smaller than a pixel.
struct Decal { col: vec3f, cov: f32, ao: f32 };
fn beachDecal(p: vec2f, density: f32, fp: f32) -> Decal {
  var o: Decal;
  let cs = 0.55;
  let c = vec2i(floor(p / cs));
  if (hashC(c, 1u) > density) { return o; }
  let centre = (vec2f(c) + 0.25 + 0.5 * vec2f(hashC(c, 2u), hashC(c, 3u))) * cs;
  let q = rot2(p - centre, hashC(c, 4u) * 6.2831853);
  let kind = hashC(c, 5u);
  let size = 0.025 + 0.05 * hashC(c, 6u);
  let tone = hashC(c, 7u);
  var sd = 1.0;
  var col = vec3f(0.0);
  if (kind < 0.4) {
    // pebble: a flattened ellipse, lit from the sun side
    sd = (length(q / vec2f(1.0, 0.7)) - size) * 0.7;
    col = mix(vec3f(0.3, 0.29, 0.27), vec3f(0.62, 0.57, 0.5), tone) * (0.85 + 0.3 * clamp(dot(normalize(q + 1e-5), F.sunDir.xz), 0.0, 1.0));
  } else if (kind < 0.78) {
    // scallop: a ribbed fan opening from its hinge
    let h = q + vec2f(0.0, size * 0.55);
    let a = atan2(h.x, h.y);
    let rr = length(h);
    sd = max(rr - size * (1.0 + 0.05 * cos(a * 20.0)), (abs(a) - 1.0) * rr);
    col = mix(vec3f(0.88, 0.82, 0.72), vec3f(0.86, 0.58, 0.48), tone) * (0.82 + 0.18 * cos(a * 20.0)) * (0.8 + 0.2 * rr / size);
  } else if (kind < 0.88) {
    // starfish: five tapering arms
    let a = atan2(q.y, q.x);
    let arm = pow(abs(cos(2.5 * a)), 4.0);
    sd = (length(q) - size * (0.35 + 0.95 * arm)) * 0.6;
    col = mix(vec3f(0.78, 0.32, 0.12), vec3f(0.85, 0.55, 0.25), tone) * (0.85 + 0.15 * sin(length(q) * 300.0));
  } else {
    // a bleached shell fragment
    sd = (length(q / vec2f(1.0, 0.55)) - size * 0.45) * 0.55;
    col = vec3f(0.9, 0.88, 0.84);
  }
  let fade = 1.0 - smoothstep(size * 0.4, size * 1.2, fp);
  o.col = col;
  o.cov = (1.0 - smoothstep(-fp, fp, sd)) * fade;
  o.ao = (1.0 - smoothstep(0.0, size * 0.35 + fp, sd)) * 0.3 * fade;   // soft contact shadow
  return o;
}

// One footprint, walking towards the sea (-Z): ball of the foot and heel, smoothly joined.
fn footSD(q: vec2f, s: f32) -> f32 {
  let ball = length((q - vec2f(0.0, -0.055 * s)) / vec2f(0.048, 0.07)) - s;
  let heel = length((q - vec2f(0.0, 0.075 * s)) / vec2f(0.04, 0.05)) - s;
  let k = 0.35;
  let hm = clamp(0.5 + 0.5 * (heel - ball) / k, 0.0, 1.0);
  return (mix(heel, ball, hm) - k * hm * (1.0 - hm)) * 0.045;
}

// Two trails of footprints from behind the camera down to the water, a large one and a small
// one beside it. Returns how deep the sand is pressed in at p (0..1).
fn footprints(p: vec2f, fp: f32) -> f32 {
  if (p.y > 40.0 || abs(p.x + 2.2 - 1.3 * sin(p.y * 0.055) - 0.4) > 1.5) { return 0.0; }
  var dep = 0.0;
  for (var trail = 0; trail < 2; trail++) {
    let small = trail == 1;
    let stride = select(0.36, 0.25, small);       // half a step: left, right, left...
    let scale = select(1.0, 0.68, small);
    let k0 = round(p.y / stride);
    for (var dk = -1.0; dk <= 1.0; dk += 1.0) {
      let k = k0 + dk;
      let z = k * stride;
      let path = -2.2 + 1.3 * sin(z * 0.055) + select(0.0, 0.75, small);
      let lr = select(-1.0, 1.0, fract(k * 0.5) > 0.25);
      let q = p - vec2f(path + lr * 0.1 * scale, z);
      dep = max(dep, 1.0 - smoothstep(-fp, fp, footSD(q / scale, 1.0) * scale));
    }
  }
  return dep;
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
  let sandy = (1.0 - grass) * (1.0 - rock) * (1.0 - smoothstep(4.0, 8.0, h));

  // close-up detail on the beach: wind ripples, a line of washed-up seaweed at the high-water
  // mark, shells, starfish, pebbles and footprints
  let pixAng = 2.0 * length(F.camUp.xyz) * F.screen.w;
  let fp = dist * pixAng / max(abs(dot(n, V)), 0.2);
  var nd = n;
  if (dist < 45.0 && sandy > 0.0) {
    let dry = 1.0 - wet;
    let ripA = 1.0 - smoothstep(0.012, 0.03, fp);
    let ph = dot(p, vec2f(0.8, 0.6)) * 70.0 + gnoise(p * 0.6) * 6.0;
    nd = normalize(nd + vec3f(0.8, 0.0, 0.6) * cos(ph) * 0.12 * ripA * dry * sandy);
    let wrack = smoothstep(reachUp * 1.3, reachUp * 1.7, h) * (1.0 - smoothstep(reachUp * 2.0, reachUp * 2.6, h));
    let weed = smoothstep(0.15, 0.35, gnoise(p * vec2f(1.3, 4.0)) + gnoise(p * 6.0) * 0.4) * wrack;
    alb = mix(alb, vec3f(0.16, 0.14, 0.07), weed * 0.85 * sandy);
    let d = beachDecal(p, 0.06 + 0.3 * wrack + 0.1 * wet, fp);
    alb = mix(alb * (1.0 - d.ao * sandy), d.col, d.cov * sandy);
    // footprints: pressed-in sand, with the wall facing away from the sun in shadow
    let dep = footprints(p, fp) * dry * sandy;
    if (dep > 0.0) {
      let lit = footprints(p + F.sunDir.xz * 0.03, fp);
      alb *= 1.0 - 0.12 * dep - 0.35 * dep * (1.0 - lit);
    }
  }
  alb *= 1.0 - 0.45 * wet;

  let amb = skyAmbient(n);
  var col = alb * (sunE * max(dot(nd, Ld), 0.0) * 0.318 + amb * 0.9);
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
  let centre = vec3f(-90.0 + 180.0 * hash1(s), 9.0 + 26.0 * hash1(s + 1u), -10.0 - 110.0 * hash1(s + 2u));
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

// Coconut palms, generated entirely in the vertex shader: a curved, tapering trunk of
// TRUNK_SEGS x TRUNK_SIDES quads and a crown of FRONDS fronds, each a drooping ribbon whose
// leaflets are cut out in the fragment shader (alpha-to-coverage gives them soft edges).
const TRUNK_SEGS = 10, TRUNK_SIDES = 6, FRONDS = 11, FROND_SEGS = 8;
const TRUNK_VERTS = TRUNK_SEGS * TRUNK_SIDES * 6;
export const PALM_COUNT = 18, PALM_VERTS = TRUNK_VERTS + FRONDS * FROND_SEGS * 6;
export const PALMS = FRAME_WGSL + ATMO_CORE_WGSL + LAND_BINDINGS + SKY_RENDER_FUNCS + SHORE_WGSL + LAND_LIGHT + /* wgsl */ `
const QUAD = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
fn hash1(i: u32) -> f32 { return f32(pcgHash(i)) / 4294967296.0; }

struct Palm { base: vec3f, height: f32, lean: vec3f, phase: f32 };
fn palm(ii: u32) -> Palm {
  // alternate sides of the beach, leaving the middle (and the sun, slightly right) open
  let side = select(-1.0, 1.0, (ii & 1u) == 1u);
  let k = f32(ii >> 1u);
  let x = side * (7.0 + k * 9.0 + 4.0 * hash1(ii * 5u)) + select(0.0, 4.0, side > 0.0);
  let z = shoreZ(x) + 10.0 + 14.0 * hash1(ii * 5u + 1u);
  var o: Palm;
  o.base = vec3f(x, terrainH(vec2f(x, z)) - 0.15, z);
  o.height = 7.0 + 5.0 * hash1(ii * 5u + 2u);
  // lean out over the sand towards the sea and a little towards the middle of the beach
  let d = normalize(vec2f(-side * (0.3 + 0.5 * hash1(ii * 5u + 3u)), -1.0));
  o.lean = vec3f(d.x, 0.0, d.y) * o.height * (0.15 + 0.25 * hash1(ii * 5u + 4u));
  o.phase = hash1(ii * 5u + 3u) * 6.2831853;
  return o;
}
fn sway(pm: Palm) -> vec3f {
  let t = F.camPos.w;
  let w = F.windP[0];
  return vec3f(w.x, 0.0, w.y) * (0.18 * sin(t * 0.55 + pm.phase) + 0.07 * sin(t * 1.3 + pm.phase * 2.0)) * (0.5 + 0.06 * w.z);
}
fn trunkAt(pm: Palm, s: f32) -> vec3f {
  return pm.base + vec3f(0.0, s * pm.height, 0.0) + pm.lean * pow(s, 1.7) + sway(pm) * s * s;
}

struct VO {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,
  @location(1) uv: vec2f,      // trunk: (around, height m); frond: (along 0..1, across -1..1)
  @location(2) kind: f32,      // 0 trunk, 1 frond
  @location(3) nrm: vec3f,
};
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  let pm = palm(ii);
  var o: VO;
  var world: vec3f;
  if (vi < ${TRUNK_VERTS}u) {
    let quad = vi / 6u;
    let c = QUAD[vi % 6u];
    let s = (f32(quad / ${TRUNK_SIDES}u) + c.y) / ${TRUNK_SEGS}.0;
    let a = (f32(quad % ${TRUNK_SIDES}u) + c.x) / ${TRUNK_SIDES}.0 * 6.2831853;
    let T = normalize(trunkAt(pm, min(s + 0.02, 1.0)) - trunkAt(pm, max(s - 0.02, 0.0)));
    let B1 = normalize(cross(T, vec3f(0.0, 0.0, 1.0)));
    let B2 = cross(T, B1);
    let r = 0.17 * (1.2 - 0.45 * s) + 0.14 * pow(1.0 - s, 8.0);
    o.nrm = cos(a) * B1 + sin(a) * B2;
    world = trunkAt(pm, s) + o.nrm * r;
    o.uv = vec2f(a, s * pm.height);
    o.kind = 0.0;
  } else {
    let j = vi - ${TRUNK_VERTS}u;
    let f = j / ${FROND_SEGS * 6}u;
    let quad = (j % ${FROND_SEGS * 6}u) / 6u;
    let c = QUAD[j % 6u];
    let t = (f32(quad) + c.x) / ${FROND_SEGS}.0;
    let w = c.y * 2.0 - 1.0;
    let fseed = ii * 31u + f;
    let th = f32(f) / ${FRONDS}.0 * 6.2831853 + hash1(fseed) * 0.5;
    let d = vec3f(cos(th), 0.0, sin(th));
    let len = 3.2 + 1.2 * hash1(fseed + 7u);
    let rise = 0.15 + 0.55 * hash1(fseed + 3u);              // some fronds stand up, most droop
    let tm = F.camPos.w;
    let flutter = 0.12 * t * t * sin(tm * 2.1 + f32(f) * 1.7 + pm.phase);
    let crown = trunkAt(pm, 1.0);
    let centre = crown + d * len * t + vec3f(0.0, len * (rise * t - 0.8 * t * t) + flutter, 0.0) + sway(pm) * 0.5 * t;
    let side = normalize(cross(d, vec3f(0.0, 1.0, 0.0)));
    let width = 0.62 * pow(sin(3.14159 * min(t * 1.1, 1.0)), 0.7) * (1.0 - 0.25 * t);
    world = centre + side * w * width - vec3f(0.0, abs(w) * width * 0.35, 0.0);   // leaflets hang down from the midrib
    let tang = d + vec3f(0.0, rise - 1.6 * t, 0.0);
    o.nrm = normalize(cross(side, tang));
    o.uv = vec2f(t, w);
    o.kind = 1.0;
  }
  o.rel = world - F.camPos.xyz;
  o.pos = F.viewProj * vec4f(o.rel, 1.0);
  return o;
}

@fragment fn fs(in: VO) -> @location(0) vec4f {
  // leaflets: slanted cuts across the frond, ragged towards the tips (computed for every
  // fragment so the derivatives stay in uniform control flow)
  let l = fract(in.uv.x * 34.0 - abs(in.uv.y) * 1.6);
  let aw = fwidth(l) + 0.02;
  let gap = smoothstep(0.6 - aw, 0.6 + aw, l) * smoothstep(0.06, 0.14, abs(in.uv.y));
  let tip = 1.0 - smoothstep(0.82, 1.0, abs(in.uv.y) + 0.12 * sin(in.uv.x * 90.0));
  let leafA = (1.0 - gap) * tip;

  let dist = length(in.rel);
  let V = -in.rel / dist;
  var n = normalize(in.nrm);
  if (dot(n, V) < 0.0) { n = -n; }
  let Ld = F.sunDir.xyz;
  let sunE = sunIlluminance() * sunVis[0];
  var alb: vec3f;
  var a = 1.0;
  var trans = vec3f(0.0);
  if (in.kind < 0.5) {
    let rings = 0.82 + 0.18 * smoothstep(0.25, 0.6, fract(in.uv.y * 3.3 + 0.1 * sin(in.uv.x * 3.0)));
    alb = vec3f(0.3, 0.24, 0.18) * rings;
  } else {
    alb = mix(vec3f(0.12, 0.2, 0.06), vec3f(0.24, 0.27, 0.09), clamp(in.uv.x + 0.2 * in.uv.y, 0.0, 1.0));
    a = leafA;
    // fronds glow gold where the low sun shines through them
    trans = sunE * vec3f(0.3, 0.32, 0.06) * pow(max(dot(Ld, -V), 0.0), 3.0) * 0.4;
  }
  let col = alb * (sunE * max(dot(n, Ld), 0.0) * 0.318 + skyAmbient(n) * 0.85) + trans;
  return vec4f(aerial(col, in.rel), a);
}
`;
