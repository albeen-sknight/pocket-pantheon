// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Terrain is one full screen pass. Every pixel finds its tile, then picks one
// of the biome's palette tones from hillshade, clumped variation and dither,
// so the output never leaves the master palette.

export const TERRAIN_VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const TERRAIN_FRAG = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform usampler2D uTiles;   // r biome, g height hi, b height lo, a flags
uniform sampler2D uPalette;  // 64 x 1
uniform usampler2D uBiomes;  // 32 x 2: tones, then deco shape and density
uniform vec2 uOffset;        // world tile at the top left of the screen
uniform float uScale;        // device pixels per tile
uniform float uArt;          // art pixels per tile: 1, 4 or 32
uniform float uViewH;
uniform ivec2 uSize;
uniform float uSea;
uniform float uTime;
uniform uint uFresh[3];
uniform uint uFoam;
uniform uint uTreeTones;   // biome whose tones colour round trees
uniform uint uPineTones;
uniform uint uTrunkTones;   // its accent is the trunk brown
uniform uint uRockTones;    // stone walls use this biome's greys
uniform uint uRoad[3];      // base, light, dark
uniform uint uFarm[3];      // soil, young crop, ripe crop
uniform float uSeason;      // 0 to 1 through the year, ripens crops
uniform highp usampler2D uOwner;    // kingdom id per tile, 0 for nobody
uniform usampler2D uKingdoms;       // 256 x 1: palette index of each kingdom id % 256

out vec4 outColor;

const uint RIVER = 1u;
const uint LAKE = 2u;
const uint ROAD = 4u;
const uint FARM = 8u;
const uint WALL = 16u;
const uint STONE_WALL = 32u;

// Integer hash of a cell and a salt, in [0, 1). No visible grid patterns.
float hash(vec2 p, uint salt) {
  uvec2 q = uvec2(ivec2(floor(p)) + 65536);
  uint h = q.x * 1597334677u ^ q.y * 3812015801u ^ salt * 2654435769u;
  h ^= h >> 16;
  h *= 0x7feb352du;
  h ^= h >> 15;
  h *= 0x846ca68bu;
  h ^= h >> 16;
  return float(h) / 4294967296.0;
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i, 0u), hash(i + vec2(1, 0), 0u), f.x), mix(hash(i + vec2(0, 1), 0u), hash(i + vec2(1, 1), 0u), f.x), f.y);
}

float bayer(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[q.y * 4 + q.x]) + 0.5) / 16.0 - 0.5;
}

uvec4 tileAt(ivec2 t) {
  return texelFetch(uTiles, clamp(t, ivec2(0), uSize - 1), 0);
}

float heightOf(uvec4 d) {
  return float(d.g * 256u + d.b) / 65535.0;
}

bool isWater(uvec4 d) {
  return heightOf(d) < uSea || (d.a & (RIVER | LAKE)) != 0u;
}

float smoothHeight(vec2 p) {
  vec2 q = p - 0.5;
  ivec2 i = ivec2(floor(q));
  vec2 f = fract(q);
  float a = heightOf(tileAt(i));
  float b = heightOf(tileAt(i + ivec2(1, 0)));
  float c = heightOf(tileAt(i + ivec2(0, 1)));
  float d = heightOf(tileAt(i + ivec2(1, 1)));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec4 pal(uint i) {
  return texelFetch(uPalette, ivec2(int(i), 0), 0);
}

uint ownerAt(ivec2 t) {
  return texelFetch(uOwner, clamp(t, ivec2(0), uSize - 1), 0).r;
}

vec4 kingdomColor(uint id) {
  return pal(texelFetch(uKingdoms, ivec2(int(id % 256u), 0), 0).r);
}

// Kingdom tint and bright border lines, like the continent view in the preview.
vec4 territory(vec4 base, ivec2 home, vec2 wp) {
  uint id = ownerAt(home);
  if (id == 0u) return base;
  vec2 f = fract(wp);
  float edge = uArt >= 32.0 ? 2.0 / uArt : uArt >= 4.0 ? 1.0 / uArt : 1.0;
  bool border =
    (f.x < edge && ownerAt(home - ivec2(1, 0)) != id) || (f.x >= 1.0 - edge && ownerAt(home + ivec2(1, 0)) != id) ||
    (f.y < edge && ownerAt(home - ivec2(0, 1)) != id) || (f.y >= 1.0 - edge && ownerAt(home + ivec2(0, 1)) != id);
  if (border) return kingdomColor(id);
  return mix(base, kingdomColor(id), uArt >= 32.0 ? 0.08 : 0.16);
}

uvec4 tones(uint biome) {
  return texelFetch(uBiomes, ivec2(int(biome), 0), 0);
}

// Decoration shapes drawn inside a tile, in art pixels (32 per tile).
// Returns 0 for nothing, 1 for dark, 2 for base, 3 for light, 4 for accent, 5 for trunk.
int deco(uint shape, vec2 a, vec2 c) {
  vec2 d = a - c;
  if (shape == 1u || shape == 4u || shape == 8u || shape == 9u) {      // round tree, acacia, mushroom, dead
    float r = shape == 4u ? 10.0 : shape == 1u ? 9.0 : 7.0;
    vec2 e = d / vec2(r, shape == 4u ? r * 0.55 : r);
    if (shape != 9u && dot(e, e) < 1.0) {
      float lit = -(e.x + e.y);
      if (shape == 8u) return d.y < 0.0 ? (lit > 0.6 ? 3 : 4) : 2;
      return lit > 0.55 ? 3 : lit < -0.5 ? 1 : 2;
    }
    if (abs(d.x) < 1.5 && d.y > 0.0 && d.y < r + 4.0) return shape == 8u ? 4 : 5;   // trunk or stem
    if (shape == 9u && abs(d.x - d.y * 0.6) < 1.0 && d.y > -6.0 && d.y < 2.0) return 1;
    return 0;
  }
  if (shape == 2u) {                                                   // pine
    float row = d.y + 10.0;
    if (row >= 0.0 && row < 18.0 && abs(d.x) < row * 0.45 + 1.0) return d.x < -1.0 ? 3 : d.x > 2.0 ? 1 : 2;
    if (abs(d.x) < 1.5 && d.y >= 8.0 && d.y < 11.0) return 5;
    return 0;
  }
  if (shape == 3u) {                                                   // palm
    if (abs(d.x - d.y * 0.25) < 1.0 && d.y > -4.0 && d.y < 10.0) return 5;
    vec2 e = (d + vec2(1.0, 5.0)) / vec2(7.0, 3.0);
    return dot(e, e) < 1.0 ? (e.y < 0.0 ? 3 : 2) : 0;
  }
  if (shape == 5u) {                                                   // cactus
    if (abs(d.x) < 2.0 && d.y > -8.0 && d.y < 8.0) return d.x < 0.0 ? 3 : 4;
    if (d.y > -3.0 && d.y < -1.0 && abs(d.x) < 6.0) return 4;
    if (abs(abs(d.x) - 5.0) < 1.0 && d.y > -7.0 && d.y < -1.0) return 4;
    return 0;
  }
  if (shape == 6u || shape == 7u) {                                    // rock, crystal
    vec2 e = d / vec2(5.0, 3.5);
    if (shape == 7u) { e = d / vec2(2.5, 6.0); }
    if (dot(e, e) < 1.0) return shape == 7u ? (d.x < 0.0 ? 3 : 4) : (e.x + e.y < -0.4 ? 3 : 1);
    return 0;
  }
  if (shape == 10u) {                                                  // reeds
    float s = mod(a.x, 3.0);
    return s < 1.0 && d.y > -5.0 && d.y < 4.0 && abs(d.x) < 7.0 ? 1 : 0;
  }
  if (shape == 11u || shape == 12u || shape == 13u) {                  // flowers, coral, lava
    vec2 e = d / 2.0;
    return dot(e, e) < 1.0 ? 4 : 0;
  }
  return 0;
}

void main() {
  vec2 screen = vec2(gl_FragCoord.x, uViewH - gl_FragCoord.y);
  vec2 world = uOffset + screen / uScale;
  vec2 ap = floor(world * uArt);              // this art pixel
  vec2 wp = (ap + 0.5) / uArt;                // its centre, in tiles

  if (wp.x < 0.0 || wp.y < 0.0 || wp.x >= float(uSize.x) || wp.y >= float(uSize.y)) {
    outColor = pal(tones(0u).b) * vec4(0.55, 0.55, 0.65, 1.0);
    return;
  }

  // Wobble the lookup near tile edges so biome borders are soft, never straight.
  vec2 warp = uArt > 1.0 ? (vec2(vnoise(ap * 0.21), vnoise(ap * 0.21 + 17.0)) - 0.5) * 0.7 : vec2(0.0);
  ivec2 t = ivec2(floor(wp + warp));
  ivec2 home = ivec2(floor(wp));
  uvec4 d = tileAt(t);
  uvec4 me = tileAt(home);
  float h = heightOf(me);

  // Up close, shade from a smooth height field so slopes don't show tile seams.
  float hx;
  float hy;
  if (uArt >= 32.0) {
    hx = (smoothHeight(wp + vec2(0.5, 0.0)) - smoothHeight(wp - vec2(0.5, 0.0))) * 2.0;
    hy = (smoothHeight(wp + vec2(0.0, 0.5)) - smoothHeight(wp - vec2(0.0, 0.5))) * 2.0;
  } else {
    hx = heightOf(tileAt(home + ivec2(1, 0))) - heightOf(tileAt(home - ivec2(1, 0)));
    hy = heightOf(tileAt(home + ivec2(0, 1))) - heightOf(tileAt(home - ivec2(0, 1)));
  }
  float shade = clamp((hx + hy) * 14.0, -1.2, 1.2);

  float clump = uArt >= 32.0 ? vnoise(ap * 0.11) - 0.5 : vnoise(ap / max(uArt * 0.35, 1.0)) - 0.5;
  float dither = uArt >= 32.0 ? (hash(floor(ap / 2.0), 5u) - 0.5) * 0.45
               : uArt > 1.0 ? bayer(ap) * 0.55 : (hash(ap, 6u) - 0.5) * 0.25;

  if (isWater(d)) {
    bool fresh = (d.a & (RIVER | LAKE)) != 0u && heightOf(d) >= uSea;
    float depth = uSea - heightOf(d);
    uvec4 tn = tones(d.r);
    uint dark = fresh ? uFresh[2] : tn.b;
    uint base = fresh ? uFresh[0] : tn.r;
    uint light = fresh ? uFresh[1] : tn.g;
    uint c = depth > 0.09 && !fresh ? dark : depth > 0.03 || fresh ? base : light;
    if (!fresh && d.r == 0u && depth > 0.03 && depth < 0.06 && dither > 0.1) c = base;

    vec2 wq = ap / max(uArt / 4.0, 1.0);
    float wave = sin(wq.x * 0.25 + wq.y * 0.45 + uTime) + sin(wq.x * 0.1 - wq.y * 0.2 + uTime * 0.7);
    if (wave > (uArt >= 32.0 ? 1.8 : 1.55)) c = c == dark ? base : light;

    // Shoreline foam: water next to land, pulsing.
    vec2 f = fract(wp);
    float edge = 9.0;
    if (!isWater(tileAt(home + ivec2(1, 0)))) edge = min(edge, 1.0 - f.x);
    if (!isWater(tileAt(home - ivec2(1, 0)))) edge = min(edge, f.x);
    if (!isWater(tileAt(home + ivec2(0, 1)))) edge = min(edge, 1.0 - f.y);
    if (!isWater(tileAt(home - ivec2(0, 1)))) edge = min(edge, f.y);
    float foam = uArt > 1.0 ? 0.18 + 0.1 * sin(uTime * 2.0 + ap.x * 0.3 + ap.y * 0.2) : (sin(uTime * 2.0 + wp.x * 0.6) > 0.2 ? 1.0 : -1.0);
    if (edge < foam) c = fresh ? light : uFoam;
    outColor = pal(c);
    return;
  }

  uvec4 tn = tones(d.r);
  float v = shade + clump * 0.9 + dither;
  uint c = v > 0.5 ? tn.g : v < -0.5 ? tn.b : tn.r;

  // Farms: rows of crops over dark soil, ripening through the year.
  if ((me.a & FARM) != 0u) {
    if (uArt == 1.0) { outColor = territory(pal(uFarm[1]), home, wp); return; }
    float row = mod(ap.y, uArt >= 32.0 ? 6.0 : 2.0);
    bool ripe = hash(vec2(home), 9u) * 0.4 + uSeason > 0.8;
    uint crop = ripe ? uFarm[2] : uFarm[1];
    outColor = territory(pal(row < (uArt >= 32.0 ? 2.0 : 1.0) ? uFarm[0] : crop), home, wp);
    return;
  }

  // Walls: stakes for a palisade, blocks with crenels for stone.
  if ((me.a & WALL) != 0u) {
    bool stone = (me.a & STONE_WALL) != 0u;
    if (uArt == 1.0) { outColor = pal(stone ? tones(uRockTones).g : uRoad[2]); return; }
    vec2 f = fract(wp);
    float q = uArt >= 32.0 ? 8.0 : 2.0;
    vec2 cell = floor(f * q);
    bool dark = stone ? mod(cell.x + floor(cell.y / 2.0) * 0.5, 2.0) < 0.2 || mod(f.y * q, 1.0) < 0.15 : mod(f.x * q * 2.0, 1.0) < 0.2;
    uvec4 rock = tones(uRockTones);
    uint c = stone ? (dark ? rock.b : f.y < 0.25 ? rock.g : rock.r) : (dark ? uRoad[2] : f.y < 0.2 ? uRoad[1] : uRoad[0]);
    outColor = territory(pal(c), home, wp);
    return;
  }

  // Roads: a dirt band through the tile, joining neighbouring road tiles.
  if ((me.a & ROAD) != 0u) {
    if (uArt == 1.0) { outColor = territory(pal(uRoad[0]), home, wp); return; }
    vec2 f = fract(wp) - 0.5;
    float w = 0.24;
    bool on = max(abs(f.x), abs(f.y)) < w;
    if ((tileAt(home + ivec2(1, 0)).a & ROAD) != 0u && f.x > 0.0 && abs(f.y) < w) on = true;
    if ((tileAt(home - ivec2(1, 0)).a & ROAD) != 0u && f.x < 0.0 && abs(f.y) < w) on = true;
    if ((tileAt(home + ivec2(0, 1)).a & ROAD) != 0u && f.y > 0.0 && abs(f.x) < w) on = true;
    if ((tileAt(home - ivec2(0, 1)).a & ROAD) != 0u && f.y < 0.0 && abs(f.x) < w) on = true;
    if (on) {
      float rv = clump * 0.8 + dither;
      outColor = territory(pal(rv > 0.45 ? uRoad[1] : rv < -0.45 ? uRoad[2] : uRoad[0]), home, wp);
      return;
    }
  }

  if (uArt >= 4.0) {
    // Scatter accent pixels (flowers, pebbles) on a few art pixels.
    uvec4 info = texelFetch(uBiomes, ivec2(int(d.r), 1), 0);
    if (hash(ap, 1u) < float(info.g) / 255.0 * 0.04) c = tn.a;

    if (uArt >= 32.0 && info.r != 0u) {
      vec2 tile = vec2(t);
      float roll = hash(tile, 2u);
      if (roll < float(info.g) / 255.0) {
        vec2 centre = vec2(10.0 + hash(tile, 3u) * 12.0, 9.0 + hash(tile, 4u) * 10.0);
        vec2 local = ap - tile * uArt;
        int part = deco(info.r, local, centre);
        if (part == 0) {
          // soft shadow down and to the right
          if (deco(info.r, local - vec2(2.0, 2.0), centre) != 0) c = tn.b;
        } else {
          // Trees borrow the forest or taiga greens, a shade lighter than the
          // ground, so they stand out wherever they grow.
          bool plant = info.r >= 1u && info.r <= 4u;
          uvec4 paint = info.r == 2u ? tones(uPineTones) : tones(uTreeTones);
          if (part == 5) c = tones(uTrunkTones).a;
          else if (!plant) c = part == 1 ? tn.b : part == 2 ? tn.r : part == 3 ? tn.g : tn.a;
          else if (info.r == 2u) c = part == 1 ? paint.b : part == 3 ? paint.g : paint.r;
          else c = part == 1 ? paint.b : part == 3 ? paint.a : paint.g;
        }
      }
    }
  }
  outColor = territory(pal(c), home, wp);
}
`;
