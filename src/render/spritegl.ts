// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
// Instanced sprite pass: one draw call for every unit, building and icon.
import type { Atlas } from "./atlas";
import { INST, type Scene } from "./scene";

const VERT = `#version 300 es
in vec2 aPos;      // top left, device pixels
in vec4 aRect;     // atlas x, y, w, h
in vec2 aScaleFlip;
uniform vec2 uView;
uniform vec2 uAtlas;
out vec2 vUV;
void main() {
  const vec2 CORNERS[6] = vec2[6](vec2(0, 0), vec2(1, 0), vec2(0, 1), vec2(0, 1), vec2(1, 0), vec2(1, 1));
  vec2 corner = CORNERS[gl_VertexID];
  vec2 px = aPos + corner * aRect.zw * aScaleFlip.x;
  vec2 c = aScaleFlip.y > 0.5 ? vec2(1.0 - corner.x, corner.y) : corner;
  vUV = (aRect.xy + c * aRect.zw) / uAtlas;
  gl_Position = vec4(px / uView * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
in vec2 vUV;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUV);
  if (c.a < 0.5) discard;
  outColor = c;
}`;

export class SpriteGL {
  private program: WebGLProgram;
  private buf: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private tex: WebGLTexture;
  private inst = new Float32Array(8 * 4096);
  private uView: WebGLUniformLocation | null;
  private uAtlas: WebGLUniformLocation | null;

  constructor(private gl: WebGL2RenderingContext, private atlas: Atlas) {
    this.program = link(gl, VERT, FRAG);
    gl.useProgram(this.program);
    this.uView = gl.getUniformLocation(this.program, "uView");
    this.uAtlas = gl.getUniformLocation(this.program, "uAtlas");
    gl.uniform1i(gl.getUniformLocation(this.program, "uTex"), 3);

    this.tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const attr = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(this.program, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 32, offset);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr("aPos", 2, 0);
    attr("aRect", 4, 8);
    attr("aScaleFlip", 2, 24);
    gl.bindVertexArray(null);
  }

  draw(scene: Scene, viewW: number, viewH: number) {
    const gl = this.gl;
    const n = scene.count;
    if (!n) return;
    if (this.inst.length < n * 8) this.inst = new Float32Array(n * 16);
    const d = scene.data;
    const sprites = this.atlas.sprites;
    for (let i = 0; i < n; i++) {
      const o = i * INST;
      const sp = sprites[d[o + 2]!]!;
      const k = i * 8;
      this.inst[k] = d[o]!;
      this.inst[k + 1] = d[o + 1]!;
      this.inst[k + 2] = sp.x;
      this.inst[k + 3] = sp.y;
      this.inst[k + 4] = sp.w;
      this.inst[k + 5] = sp.h;
      this.inst[k + 6] = d[o + 3]!;
      this.inst[k + 7] = d[o + 4]!;
    }
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform2f(this.uView, viewW, viewH);
    gl.uniform2f(this.uAtlas, this.atlas.canvas.width, this.atlas.canvas.height);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.subarray(0, n * 8), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.bindVertexArray(null);
  }
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
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
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
  return p;
}
