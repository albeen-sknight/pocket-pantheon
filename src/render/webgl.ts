// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { B } from "../world/biomes";
import type { Rect } from "../world/edit";
import type { World } from "../world/types";
import type { Camera } from "./camera";
import { biomeTable, FOAM, FRESH_WATER, paletteRGBA } from "./palette";
import { packTiles, type Renderer } from "./renderer";
import { TERRAIN_FRAG, TERRAIN_VERT } from "./shaders";

export function createWebGLRenderer(canvas: HTMLCanvasElement): Renderer | null {
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: false });
  } catch {
    return null;
  }
  if (!gl) return null;

  const program = link(gl, TERRAIN_VERT, TERRAIN_FRAG);
  if (!program) return null;
  return new WebGLTerrain(gl, program);
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram | null {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (gl.getProgramParameter(p, gl.LINK_STATUS)) return p;
  console.error(gl.getProgramInfoLog(p));
  return null;
}

class WebGLTerrain implements Renderer {
  kind = "webgl2" as const;
  private tiles: WebGLTexture;
  private uni: Record<string, WebGLUniformLocation | null> = {};
  private size = { w: 1, h: 1 };
  private sea = 0.4;

  constructor(private gl: WebGL2RenderingContext, private program: WebGLProgram) {
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    for (const name of ["uTiles", "uPalette", "uBiomes", "uOffset", "uScale", "uArt", "uViewH", "uSize", "uSea", "uTime", "uFresh", "uFoam", "uTreeTones", "uPineTones", "uTrunkTones"]) {
      this.uni[name] = gl.getUniformLocation(program, name);
    }

    this.tiles = this.texture(0, "uTiles");
    this.texture(1, "uPalette");
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 64, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteRGBA());
    this.texture(2, "uBiomes");
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8UI, 32, 2, 0, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, biomeTable());

    gl.uniform1uiv(this.uni.uFresh!, FRESH_WATER);
    gl.uniform1ui(this.uni.uFoam!, FOAM);
    gl.uniform1ui(this.uni.uTreeTones!, B.forest);
    gl.uniform1ui(this.uni.uPineTones!, B.taiga);
    gl.uniform1ui(this.uni.uTrunkTones!, B.savanna);
  }

  private texture(unit: number, uniform: string): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.uni[uniform]!, unit);
    return tex;
  }

  setWorld(world: World) {
    const gl = this.gl;
    this.size = { w: world.w, h: world.h };
    this.sea = world.seaLevel;
    const data = new Uint8Array(world.w * world.h * 4);
    packTiles(world, { x0: 0, y0: 0, x1: world.w, y1: world.h }, data);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tiles);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8UI, world.w, world.h, 0, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, data);
  }

  update(world: World, r: Rect) {
    const gl = this.gl;
    const data = new Uint8Array((r.x1 - r.x0) * (r.y1 - r.y0) * 4);
    packTiles(world, r, data);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tiles);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, data);
  }

  draw(cam: Camera, time: number) {
    const gl = this.gl;
    const u = this.uni;
    gl.viewport(0, 0, cam.viewW, cam.viewH);
    gl.uniform2f(u.uOffset!, cam.x, cam.y);
    gl.uniform1f(u.uScale!, cam.scale);
    gl.uniform1f(u.uArt!, cam.art);
    gl.uniform1f(u.uViewH!, cam.viewH);
    gl.uniform2i(u.uSize!, this.size.w, this.size.h);
    gl.uniform1f(u.uSea!, this.sea);
    gl.uniform1f(u.uTime!, time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
