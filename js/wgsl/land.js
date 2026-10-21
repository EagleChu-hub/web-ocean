// Beach, headlands and seagulls.
//   SHORE_WGSL  terrain height + shore helpers, shared by the ocean, the height probe and LAND
//   LAND        sand beach, dunes and the two headlands of the cove
//   GULLS       a few seagulls gliding and flapping over the beach
//   PALMS       photographed coconut palms on billboards along both sides of the beach
//   LIGHTHOUSE  a photographed lighthouse on an islet in the bay with a rotating beam (BEAM)
//   SCENERY     photographed coast mountains and a far coastline on the horizon
//   CRABS       little crabs scuttling sideways across the sand
import { FRAME_WGSL, ATMO_CORE_WGSL, ENV_MIPS } from './common.js';
import { SKY_RENDER_FUNCS } from './sky.js';
import { ASSET_META } from '../assets.js';

// The camera starts on the sand looking out to sea (-Z). The waterline crosses the view
// SHORE_Z metres from the origin and curves seaward on both sides into a bay; a near headland
// on the left and a farther one on the right close the cove ~460 m out to sea.
// F.windP[1] = (swell angular frequency, swash amplitude, beach on/off, breaker height).
// Requires NOISE_WGSL (gnoise) and F.
export const SHORE_WGSL = /* wgsl */ `
const SHORE_Z: f32 = -14.0;
// slightly left of the sunset and narrow enough in angle to stay in a phone's portrait view
const ISLET: vec2f = vec2f(-110.0, -480.0);
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
  // low wooded points; the real mountains behind them are the photo backdrop (SCENERY)
  let hill = reach * smoothstep(-60.0, 120.0, u) *
    (14.0 + 6.0 * gnoise(p * 0.004) + 3.0 * gnoise(p * 0.03));
  // a small rocky islet out in the bay, just awash: the lighthouse photo carries the rocks
  let di = distance(p, ISLET);
  let islet = 18.0 * smoothstep(40.0, 8.0, di) * (0.9 + 0.1 * gnoise(p * 0.08)) - 16.5;
  return max(h + hill, islet);
}

// The open-sea (FFT) waves fade out in the shallows; the breaking waves below take over.
fn shoreDamp(depth: f32) -> f32 { return smoothstep(0.5, 9.0, depth); }

// Phase of the swell arriving at the beach. In water of depth d a wave travels at sqrt(g d),
// so the crests slow down and crowd together as they come in (travel time to the waterline
// integrated over the 1:22 beach).
// The crests are not ruler-straight: along the beach they arrive a little earlier or later.
fn shorePhase(depth: f32, xz: vec2f) -> f32 {
  let wobble = 1.1 * gnoise(vec2f(xz.x * 0.018, 3.7)) + 0.35 * gnoise(xz * vec2f(0.06, 0.02) + 11.0);
  return F.windP[1].x * (F.camPos.w + 2.0 * sqrt(max(depth, 0.0)) / (BEACH_SLOPE * 3.132)) + wobble;
}
// Waves come in sets, and are bigger in some stretches of the beach than in others.
fn setSize(xz: vec2f) -> f32 {
  return (0.8 + 0.2 * sin(F.windP[1].x * F.camPos.w * 0.137)) * (0.8 + 0.4 * gnoise(vec2f(xz.x * 0.025, 9.1)));
}

// Breaking waves: they grow and steepen as the water shoals, break where the depth is about
// 1.3 times their height (F.windP[1].w), and run on to the sand as a lower, foaming bore.
// h = height, dhdd = d(height)/d(depth), crest = 0..1 position in the wave (1 = crest),
// broken = how far into the surf zone (0 before breaking, 1 well inside it).
struct Surf { h: f32, dhdd: f32, crest: f32, broken: f32 };
fn surf(depth: f32, xz: vec2f) -> Surf {
  var o: Surf;
  let H = F.windP[1].w * setSize(xz);
  let dB = 1.3 * H;
  let ph = shorePhase(depth, xz);
  // skewed so the shoreward face is steep and the back gentle, with long flat troughs
  let sk = ph + 0.55 * cos(ph);
  let p = 0.5 + 0.5 * sin(sk);
  // (on the sand itself only the swash runs up: the bore has spent itself by then)
  let amp = H * select(0.3 + 0.7 * max(depth, 0.0) / dB, 1.0 - smoothstep(dB, 14.0, depth), depth > dB) * smoothstep(0.0, 0.4, depth);
  o.h = amp * (p * p * p - 0.2);
  let dpdd = F.windP[1].x / (BEACH_SLOPE * 3.132 * sqrt(max(depth, 0.05)));
  o.dhdd = amp * 1.5 * p * p * cos(sk) * (1.0 - 0.55 * sin(ph)) * dpdd * step(0.0, depth);
  o.crest = p;
  o.broken = smoothstep(dB * 1.35, dB * 0.85, depth);
  return o;
}

// Run-up and backwash: the water level in the shallows and on the sand rises and falls.
fn swash(depth: f32, xz: vec2f) -> f32 {
  let w = 1.0 - smoothstep(0.0, 2.5, depth);
  // the swash is one sheet of water moving together, so it takes the phase at the waterline
  return F.windP[1].y * setSize(xz) * sin(shorePhase(0.0, xz)) * w;
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
// Photographed sand (dry and wet) and an atlas of shells, starfish and pebbles cut out of a
// photo; rects are (u, v, w, h) in the atlas, sizes the object's longest side in metres.
const SHELL_N = ASSET_META.shellRects.length;
const LAND_TEX = /* wgsl */ `
@group(0) @binding(6) var sandDry: texture_2d<f32>;
@group(0) @binding(7) var sandWet: texture_2d<f32>;
@group(0) @binding(8) var shellTex: texture_2d<f32>;
@group(0) @binding(9) var sampT: sampler;
const SHELL_RECT = array<vec4f, ${SHELL_N}>(${ASSET_META.shellRects.map((r) => `vec4f(${r.slice(0, 4).join(', ')})`).join(', ')});
const SHELL_SIZE = array<f32, ${SHELL_N}>(${ASSET_META.shellRects.map((r) => r[4].toFixed(4)).join(', ')});
`;
export const LAND = FRAME_WGSL + ATMO_CORE_WGSL + LAND_BINDINGS + LAND_TEX + SKY_RENDER_FUNCS + SHORE_WGSL + LAND_LIGHT + /* wgsl */ `
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

// Things lying on the sand, one per 0.55 m cell at most: shells, starfish and pebbles from the
// photo atlas, each turned at random, with a soft shadow on the side away from the sun; more
// of them along the wrack line. fp is the pixel footprint in metres, used to pick the mip
// level and to fade out objects smaller than a pixel.
struct Decal { col: vec3f, cov: f32, ao: f32 };
fn shellAt(lu: vec2f, r: vec4f, lod: f32) -> vec4f {
  if (any(lu < vec2f(0.0)) || any(lu > vec2f(1.0))) { return vec4f(0.0); }
  return textureSampleLevel(shellTex, sampT, r.xy + lu * r.zw, lod);
}
fn beachDecal(p: vec2f, density: f32, fp: f32) -> Decal {
  var o: Decal;
  let cs = 0.55;
  let c = vec2i(floor(p / cs));
  if (hashC(c, 1u) > density) { return o; }
  let centre = (vec2f(c) + 0.25 + 0.5 * vec2f(hashC(c, 2u), hashC(c, 3u))) * cs;
  let ang = hashC(c, 4u) * 6.2831853;
  let i = min(u32(hashC(c, 5u) * f32(${SHELL_N})), ${SHELL_N - 1}u);
  let r = SHELL_RECT[i];
  let m = SHELL_SIZE[i] * (0.75 + 0.5 * hashC(c, 6u));
  let ext = vec2f(r.z, r.w) / max(r.z, r.w) * m;          // footprint of the object in metres
  let lu = rot2(p - centre, ang) / ext + 0.5;
  if (any(lu < vec2f(-0.4)) || any(lu > vec2f(1.4))) { return o; }
  let lod = log2(max(fp / (ext.x / (r.z * 1024.0)), 1.0));
  let s = shellAt(lu, r, lod);
  let sh = shellAt(rot2(p + F.sunDir.xz * m * 0.3 - centre, ang) / ext + 0.5, r, lod + 1.5).a;
  let fade = 1.0 - smoothstep(m * 0.3, m * 1.0, fp);
  o.col = s.rgb;
  o.cov = s.a * fade;
  o.ao = sh * 0.45 * fade;
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

  // photographed sand at two scales and angles, so the tiling does not show
  let uv1 = p / 1.1;
  let uv2 = rot2(p, 0.7) / 3.3;
  let mixK = 0.35 + 0.3 * smoothstep(-0.3, 0.3, gnoise(p * 0.25));
  let dryT = mix(textureSample(sandDry, sampT, uv1).rgb, textureSample(sandDry, sampT, uv2).rgb, mixK);
  let wetT = mix(textureSample(sandWet, sampT, uv1).rgb, textureSample(sandWet, sampT, uv2).rgb, mixK);

  // sand on gentle low ground, scrubby grass higher up, rock on the steep headland faces
  let grain = gnoise(p * 0.9) * 0.5 + gnoise(p * 0.21) * 0.5;
  var alb = dryT * (0.94 + 0.1 * grain);
  let grass = smoothstep(4.0, 9.0, h + 3.0 * gnoise(p * 0.05)) * smoothstep(0.55, 0.8, n.y);
  alb = mix(alb, vec3f(0.12, 0.16, 0.08), grass);
  let rock = 1.0 - smoothstep(0.45, 0.7, n.y);
  alb = mix(alb, vec3f(0.22, 0.2, 0.18) * (0.8 + 0.3 * gnoise(p * 0.7)), rock);

  // wet sand below the reach of the swash: darker and glossy, mirroring the sunset
  let reachUp = F.windP[1].y * 1.2;
  let wet = 1.0 - smoothstep(reachUp * 0.4, reachUp * 1.4, h);
  let sandy = (1.0 - grass) * (1.0 - rock) * (1.0 - smoothstep(4.0, 8.0, h));

  // freshly washed sand: at the waterline the water level is A sin(w t). Sand at height h was
  // last uncovered when the falling water passed it; it keeps a shiny film of water for a few
  // seconds after, and the top of each run-up leaves a line of foam bubbles that fades
  let A = max(F.windP[1].y * setSize(p), 1e-3);
  let w = max(F.windP[1].x, 1e-3);
  let off = 3.14159265 - asin(clamp(h / A, -1.0, 1.0));
  let since = fract((shorePhase(0.0, p) - off) / 6.2831853) * 6.2831853 / w;
  let reached = (1.0 - smoothstep(A * 0.95, A * 1.05, h)) * sandy;
  let film = reached * exp(-since / 2.5);
  let laceN = smoothstep(0.05, 0.35, gnoise(p * 9.0) + 0.5 * gnoise(p * 23.0));
  let lace = reached * smoothstep(A * 0.6, A * 0.95, h) * exp(-since / 6.0) * laceN;
  let wetAll = max(wet, film);
  alb = mix(alb, wetT, wetAll * sandy);

  // close-up detail on the beach: wind ripples, a line of washed-up seaweed at the high-water
  // mark, shells, starfish, pebbles and footprints
  let pixAng = 2.0 * length(F.camUp.xyz) * F.screen.w;
  let fp = dist * pixAng / max(abs(dot(n, V)), 0.2);
  var nd = n;
  if (dist < 45.0 && sandy > 0.0) {
    let dry = 1.0 - wet;
    let ripA = 1.0 - smoothstep(0.012, 0.03, fp);
    // soft, irregular ripples in patches rather than a regular corduroy
    let ph = dot(p, vec2f(0.8, 0.6)) * 70.0 + gnoise(p * 0.6) * 12.0 + gnoise(p * 2.3) * 3.0;
    let patchy = smoothstep(-0.2, 0.4, gnoise(p * 0.15 + 7.0));
    nd = normalize(nd + vec3f(0.8, 0.0, 0.6) * cos(ph) * 0.045 * patchy * ripA * dry * sandy);
    let wrack = smoothstep(reachUp * 1.3, reachUp * 1.7, h) * (1.0 - smoothstep(reachUp * 2.0, reachUp * 2.6, h));
    let weed = smoothstep(0.42, 0.55, gnoise(p * vec2f(1.3, 4.0)) + gnoise(p * 6.0) * 0.4) * wrack;
    alb = mix(alb, vec3f(0.16, 0.14, 0.07), weed * 0.5 * sandy);
    let d = beachDecal(p, 0.13 + 0.3 * wrack + 0.1 * wet, fp);
    alb = mix(alb * (1.0 - d.ao * sandy), d.col, d.cov * sandy);
    // footprints: pressed-in sand, with the wall facing away from the sun in shadow
    let dep = footprints(p, fp) * dry * sandy;
    if (dep > 0.0) {
      let lit = footprints(p + F.sunDir.xz * 0.03, fp);
      alb *= 1.0 - 0.2 * dep - 0.45 * dep * (1.0 - lit);
    }
  }
  alb *= 1.0 - 0.45 * wet * (1.0 - sandy);
  alb = mix(alb, vec3f(0.8, 0.82, 0.82), lace * 0.8);

  let amb = skyAmbient(n);
  var col = alb * (sunE * max(dot(nd, Ld), 0.0) * 0.318 + amb * 0.9);
  // damp sand has a soft sheen; the water film left by the backwash is a mirror for the sky
  // and the low sun
  let gloss = max(wet * 0.55, film) * (1.0 - lace);
  if (gloss > 0.0) {
    let nW = normalize(mix(n, vec3f(0.0, 1.0, 0.0), 0.7));
    var R = reflect(-V, nW);
    R.y = abs(R.y);
    let refl = textureSampleLevel(envCube, sampC, R, mix(2.5, 0.5, film)).rgb;
    let glint = sunE * pow(max(dot(R, Ld), 0.0), 600.0) * film * 4.0;
    col += (refl + glint) * fresnelW(dot(nW, V)) * gloss;
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

// Coconut palms: photographed trees (green-screen cut-outs, backlit by a low sun) on
// billboards parallel to the screen, anchored at the trunk base, flipped so each leans in
// towards the middle of the beach, and swaying more towards the crown.
const PALM_N = ASSET_META.palmLean.length;
export const PALM_COUNT = 18, PALM_VERTS = 6;
export const PALMS = FRAME_WGSL + ATMO_CORE_WGSL + LAND_BINDINGS + SKY_RENDER_FUNCS + SHORE_WGSL + LAND_LIGHT + /* wgsl */ `
@group(0) @binding(6) var palmTex: texture_2d_array<f32>;
@group(0) @binding(7) var sampT: sampler;
const QUAD = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
const PALM_BASE_U = array<f32, ${PALM_N}>(${ASSET_META.palmBaseU.join(', ')});
const PALM_LEAN = array<f32, ${PALM_N}>(${ASSET_META.palmLean.map((x) => x.toFixed(1)).join(', ')});
const PALM_ASPECT: f32 = ${ASSET_META.palmAspect};
fn hash1(i: u32) -> f32 { return f32(pcgHash(i)) / 4294967296.0; }

struct VO {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,
  @location(1) uv: vec2f,
  @location(2) @interpolate(flat) layer: u32,
};
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  // alternate sides of the beach, leaving the middle (and the sun, slightly right) open
  let side = select(-1.0, 1.0, (ii & 1u) == 1u);
  let k = f32(ii >> 1u);
  // the nearest pair stands right by the water so they frame the view even from close to the
  // sea; the rest line the beach further out, each a little further up the sand
  let x = side * (5.0 + k * 7.0 + 1.5 * hash1(ii * 5u)) + select(0.0, 1.5, side > 0.0);
  let z = shoreZ(x) + 2.5 + 4.0 * hash1(ii * 5u + 1u) + k * 1.5;
  let base = vec3f(x, terrainH(vec2f(x, z)) - 0.1, z);
  // the near pair are young, shorter palms, so their crowns stay in view close up
  let height = select(8.5 + 5.0 * hash1(ii * 5u + 2u), 5.5 + 1.5 * hash1(ii * 5u + 2u), ii < 2u);
  let layer = (ii + u32(hash1(ii * 5u + 3u) * 3.0)) % ${PALM_N}u;
  let flip = PALM_LEAN[layer] != -side;
  let baseU = select(PALM_BASE_U[layer], 1.0 - PALM_BASE_U[layer], flip);

  let c = QUAD[vi];
  let right = normalize(vec3f(F.camRight.x, 0.0, F.camRight.z));
  let t = F.camPos.w;
  let ph = hash1(ii * 5u + 4u) * 6.2831853;
  let sway = (0.25 * sin(t * 0.55 + ph) + 0.08 * sin(t * 1.3 + ph * 2.0)) * (0.5 + 0.06 * F.windP[0].z) * c.y * c.y;
  let world = base + right * ((c.x - baseU) * height * PALM_ASPECT + sway) + vec3f(0.0, c.y * height, 0.0);
  var o: VO;
  o.rel = world - F.camPos.xyz;
  o.pos = F.viewProj * vec4f(o.rel, 1.0);
  o.uv = vec2f(select(c.x, 1.0 - c.x, flip), 1.0 - c.y);
  o.layer = layer;
  return o;
}
@fragment fn fs(in: VO) -> @location(0) vec4f {
  let s = textureSample(palmTex, sampT, in.uv, in.layer);
  // the photo already carries the backlit sunset look: scale it to the scene's light level
  let lum = vec3f(0.2126, 0.7152, 0.0722);
  let k = dot(skyAmbient(vec3f(0.0, 1.0, 0.0)), lum) * 1.3 + dot(sunIlluminance() * sunVis[0], lum) * 0.05;
  return vec4f(aerial(s.rgb * k, in.rel), smoothstep(0.2, 0.7, s.a));
}
`;

// The lighthouse on the islet: a photographed lighthouse and its rocks on a billboard facing
// the camera. The lamp in the photo flashes whenever the rotating beam sweeps past the camera;
// BEAM is the beam itself, drawn additively after the sky.
export const LIGHTHOUSE_VERTS = 6;
export const BEAM_VERTS = 2 * 8 * 3;
const LH_COMMON = /* wgsl */ `
const QUAD = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
const LH_H: f32 = 46.0;                   // billboard height (m), rocks and tower
const LH_ASPECT: f32 = ${ASSET_META.lighthouseAspect};
const LH_LAMP = vec2f(${ASSET_META.lighthouseLamp.join(', ')});
fn lhBase() -> vec3f { return vec3f(ISLET.x, -2.0, ISLET.y); }
fn lampPos() -> vec3f { return lhBase() + vec3f(0.0, LH_H * (1.0 - LH_LAMP.y), 0.0); }
// horizontal direction of the beam; one turn every 12 s
fn beamDir() -> vec3f { let a = F.camPos.w * 0.5236; return vec3f(cos(a), 0.0, sin(a)); }
// how strongly the beam stands out: hardly in daylight, clearly once the sun is low or down
fn duskK() -> f32 { return 0.25 + 0.75 * (1.0 - smoothstep(-0.03, 0.15, F.sunDir.y)); }
fn flashK() -> f32 {
  let toCam = normalize(vec3f(F.camPos.x, 0.0, F.camPos.z) - vec3f(lampPos().x, 0.0, lampPos().z));
  let c = dot(beamDir(), toCam);
  return pow(max(c, 0.0), 60.0) + pow(max(-c, 0.0), 60.0);   // two opposite beams
}
`;
export const LIGHTHOUSE = FRAME_WGSL + ATMO_CORE_WGSL + LAND_BINDINGS + SKY_RENDER_FUNCS + SHORE_WGSL + LAND_LIGHT + LH_COMMON + /* wgsl */ `
@group(0) @binding(6) var lhTex: texture_2d<f32>;
@group(0) @binding(7) var sampT: sampler;
struct VO {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,
  @location(1) uv: vec2f,
};
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VO {
  let c = QUAD[vi];
  let right = normalize(vec3f(F.camRight.x, 0.0, F.camRight.z));
  let world = lhBase() + right * (c.x - 0.5) * LH_H * LH_ASPECT + vec3f(0.0, c.y * LH_H, 0.0);
  var o: VO;
  o.rel = world - F.camPos.xyz;
  o.pos = F.viewProj * vec4f(o.rel, 1.0);
  o.uv = vec2f(c.x, 1.0 - c.y);
  return o;
}
@fragment fn fs(in: VO) -> @location(0) vec4f {
  let s = textureSample(lhTex, sampT, in.uv);
  let lum = vec3f(0.2126, 0.7152, 0.0722);
  let k = dot(skyAmbient(vec3f(0.0, 1.0, 0.0)), lum) * 1.2 + dot(sunIlluminance() * sunVis[0], lum) * 0.04;
  var col = s.rgb * k;
  // the lamp: a steady glow, much brighter while the beam faces us
  let d = (in.uv - LH_LAMP) * vec2f(LH_ASPECT, 1.0);
  col += vec3f(1.0, 0.82, 0.5) * exp(-dot(d, d) / 0.0006) * (3.0 + 50.0 * flashK()) * duskK();
  return vec4f(aerial(col, in.rel), smoothstep(0.2, 0.7, s.a));
}

// The beam: two long cones from the lamp, added on top of the scene. Where the cone surface
// faces the viewer we look through the most of it, so that is where it is brightest; it fades
// along its length.
struct BO {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,
  @location(1) along: f32,
  @location(2) nrm: vec3f,
};
@vertex fn vsBeam(@builtin(vertex_index) vi: u32) -> BO {
  let beam = vi / 24u;
  let j = vi % 24u;
  let k = j % 3u;
  let seg = f32(j / 3u) + select(0.0, 1.0, k == 1u);
  let ax = beamDir() * select(1.0, -1.0, beam == 1u);
  let up = vec3f(0.0, 1.0, 0.0);
  let side = cross(ax, up);
  let a = seg / 8.0 * 6.2831853;
  let L = 420.0;
  let radial = side * cos(a) + up * sin(a);
  var p = lampPos();
  var along = 0.0;
  if (k != 2u) {
    p += ax * L + radial * 16.0 - vec3f(0.0, 6.0, 0.0);
    along = 1.0;
  }
  var o: BO;
  o.rel = p - F.camPos.xyz;
  o.pos = F.viewProj * vec4f(o.rel, 1.0);
  o.along = along;
  o.nrm = radial;
  return o;
}
@fragment fn fsBeam(in: BO) -> @location(0) vec4f {
  let V = normalize(in.rel);
  let face = pow(abs(dot(normalize(in.nrm), V)), 2.0);
  let k = face * (1.0 - in.along) * (1.0 - in.along) * duskK();
  return vec4f(vec3f(1.0, 0.86, 0.6) * k * 0.35, 0.0);
}
`;

// Little crabs on the beach, each scuttling sideways between two spots, resting in between.
// Body (a domed fan), eight two-segment legs and two claws; all flat triangles.
const CRAB_BODY = 10 * 3, CRAB_LEGS = 8 * 2 * 6, CRAB_CLAWS = 2 * 4 * 3;
export const CRAB_COUNT = 9, CRAB_VERTS = CRAB_BODY + CRAB_LEGS + CRAB_CLAWS;
export const CRABS = FRAME_WGSL + ATMO_CORE_WGSL + LAND_BINDINGS + SKY_RENDER_FUNCS + SHORE_WGSL + LAND_LIGHT + /* wgsl */ `
const QUAD = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
fn hash1(i: u32) -> f32 { return f32(pcgHash(i)) / 4294967296.0; }

struct VO {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,
  @location(1) nrm: vec3f,
  @location(2) part: f32,      // 0 body, 1 legs, 2 claws
};
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  let t = F.camPos.w;
  let s = ii * 11u;
  // most crabs on the sand a few metres up from the water, a few right down by it
  let nearCam = ii < 6u;
  let hx = -6.0 + 12.0 * hash1(s);
  let hz = select(shoreZ(hx) + 2.0 + 6.0 * hash1(s + 1u), shoreZ(hx) + 4.0 + 7.0 * hash1(s + 1u), nearCam);
  let a = hash1(s + 2u) * 6.2831853;
  let dir = vec2f(cos(a), sin(a));
  // ping-pong between two spots: a quick dash, then a rest of a few seconds
  let period = 5.0 + 5.0 * hash1(s + 3u);
  let cyc = t / period + hash1(s + 4u) * 10.0;
  let phase = fract(cyc);
  let dash = smoothstep(0.0, 0.18, phase);
  let odd = (u32(floor(cyc)) & 1u) == 1u;
  let x01 = select(dash, 1.0 - dash, odd);
  let dist = 0.6 + 1.4 * hash1(s + 5u);
  let xz = vec2f(hx, hz) + dir * (x01 - 0.5) * dist;
  let moving = step(phase, 0.18);
  let ground = terrainH(xz);
  let scale = 1.8 * (0.8 + 0.4 * hash1(s + 6u));

  // crabs walk sideways: the body's right axis is the direction of travel
  let R = vec3f(dir.x, 0.0, dir.y);
  let Fw = vec3f(-dir.y, 0.0, dir.x);
  let U = vec3f(0.0, 1.0, 0.0);
  var lp: vec3f;
  var n = U;
  var part = 0.0;
  if (vi < ${CRAB_BODY}u) {
    let k = vi % 3u;
    let a0 = (f32(vi / 3u) + select(0.0, 1.0, k == 1u)) / 10.0 * 6.2831853;
    lp = select(vec3f(cos(a0) * 0.055, 0.03, sin(a0) * 0.04), vec3f(0.0, 0.05, 0.0), k == 2u);
    n = normalize(vec3f(cos(a0) * 0.6, 1.0, sin(a0) * 0.6));
  } else if (vi < ${CRAB_BODY + CRAB_LEGS}u) {
    let j = vi - ${CRAB_BODY}u;
    let leg = j / 12u;
    let segN = (j % 12u) / 6u;
    let c = QUAD[j % 6u];
    let sideS = select(-1.0, 1.0, leg >= 4u);
    let li = f32(leg % 4u);
    let fwd = (li - 1.5) * 0.022;
    // legs on alternate sides step in opposite phase while the crab runs
    let stepA = moving * sin(t * 40.0 + li * 1.7 + sideS) * 0.012;
    let root = vec3f(sideS * 0.045, 0.03, fwd);
    let knee = vec3f(sideS * 0.085, 0.055, fwd * 1.5 + stepA);
    let tip = vec3f(sideS * 0.12, -0.03, fwd * 2.0 - stepA);
    let a0 = select(root, knee, segN == 1u);
    let b0 = select(knee, tip, segN == 1u);
    let w = vec3f(0.0, 0.0, 0.006);
    lp = mix(a0, b0, c.x) + w * (c.y * 2.0 - 1.0);
    part = 1.0;
  } else {
    let j = vi - ${CRAB_BODY + CRAB_LEGS}u;
    let claw = j / 12u;
    let k = j % 3u;
    let sideS = select(-1.0, 1.0, claw == 1u);
    let a0 = (f32((j % 12u) / 3u) + select(0.0, 1.0, k == 1u)) / 4.0 * 6.2831853;
    let centre = vec3f(sideS * 0.035, 0.035, 0.075);
    lp = select(centre + vec3f(cos(a0) * 0.022, 0.0, sin(a0) * 0.016), centre + vec3f(0.0, 0.012, 0.0), k == 2u);
    part = 2.0;
  }
  lp *= scale;
  let world = vec3f(xz.x, ground, xz.y) + R * lp.x + U * lp.y + Fw * lp.z;
  var o: VO;
  o.rel = world - F.camPos.xyz;
  o.pos = F.viewProj * vec4f(o.rel, 1.0);
  o.nrm = n;
  o.part = part;
  return o;
}
@fragment fn fs(in: VO) -> @location(0) vec4f {
  let n = normalize(in.nrm);
  let sunE = sunIlluminance() * sunVis[0];
  var alb = vec3f(0.72, 0.36, 0.18);
  if (in.part > 0.5) { alb = vec3f(0.8, 0.5, 0.3); }
  if (in.part > 1.5) { alb = vec3f(0.85, 0.4, 0.2); }
  let col = alb * (sunE * max(dot(n, F.sunDir.xyz), 0.0) * 0.318 + skyAmbient(n) * 0.9);
  return vec4f(aerial(col, in.rel), 1.0);
}
`;

// Far scenery from photos: the coast mountains on the left and a far coastline on the right,
// each a strip on an arc around the bay, so it sits on the horizon from anywhere on the beach.
// The strips reach a little below sea level; the sea in front hides their bottom edge.
export const SCENERY_SEGS = 48, SCENERY_VERTS = SCENERY_SEGS * 6;
const DEG = Math.PI / 180;
// centre x, z, radius, start and end angle (rad, 0 = straight out to sea, + to the right), height
const ARC = (r, a0, a1, aspect, vScale) => [0, 5, r, a0 * DEG, a1 * DEG, r * (a1 - a0) * DEG / aspect * vScale];
const ARCS = [ARC(6000, -64, -16, ASSET_META.mountainsAspect, 0.85), ARC(9000, 14, 52, ASSET_META.coastAspect, 1.0)];
export const SCENERY = FRAME_WGSL + ATMO_CORE_WGSL + LAND_BINDINGS + SKY_RENDER_FUNCS + LAND_LIGHT + /* wgsl */ `
@group(0) @binding(6) var mountainTex: texture_2d<f32>;
@group(0) @binding(7) var coastTex: texture_2d<f32>;
@group(0) @binding(8) var sampT: sampler;
const QUAD = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
const ARCS = array<array<f32, 6>, 2>(${ARCS.map((a) => `array<f32, 6>(${a.map((v) => v.toFixed(5)).join(', ')})`).join(', ')});
struct VO {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,
  @location(1) uv: vec2f,
  @location(2) @interpolate(flat) which: u32,
};
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VO {
  let a = ARCS[ii];
  let c = QUAD[vi % 6u];
  let u = (f32(vi / 6u) + c.x) / ${SCENERY_SEGS}.0;
  let th = mix(a[3], a[4], u);
  let world = vec3f(a[0] + a[2] * sin(th), -8.0 + c.y * a[5], a[1] - a[2] * cos(th));
  var o: VO;
  o.rel = world - F.camPos.xyz;
  o.pos = F.viewProj * vec4f(o.rel, 1.0);
  o.uv = vec2f(u, 1.0 - c.y);
  o.which = ii;
  return o;
}
@fragment fn fs(in: VO) -> @location(0) vec4f {
  let m = textureSample(mountainTex, sampT, in.uv);
  let c = textureSample(coastTex, sampT, in.uv);
  let s = select(m, c, in.which == 1u);
  // the photos carry their own haze; scale them to the light of the horizon behind them and
  // let a little of the scene's own atmosphere over them
  let hz = normalize(vec3f(in.rel.x, 0.01, in.rel.z));
  let sky = skyAtmo(hz);
  let k = dot(sky, vec3f(0.2126, 0.7152, 0.0722)) * 0.9;
  let col = mix(s.rgb * k, sky, 0.15);
  return vec4f(col, smoothstep(0.1, 0.6, s.a));
}
`;
