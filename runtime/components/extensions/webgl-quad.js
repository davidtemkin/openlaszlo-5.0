// webgl-quad.js — minimal WebGL1 fullscreen-quad host for <shader> (spec
// 2026-07-06-shader-view-design.md, "Runtime"). UMD like flex-adapter.js: the LZX
// component includes it via <script src>; node tests require() the pure parts.
// On compile/link failure: logs the generated source + infoLog ONCE and returns null
// (the component falls back to bgcolor — the spec's driver-variance path).
(function (global) {

  // ── pure parts (node-tested) ────────────────────────────────────────────────
  function uniformPlan(uniforms) {
    var plan = {};
    for (var i = 0; i < (uniforms || []).length; i++) {
      var u = uniforms[i];
      plan[u.name] = { kind: u.glslType === "vec3" ? "3f" : "1f" };
    }
    return plan;
  }
  function lzColorToVec3(n) {
    n = Number(n) || 0;
    return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
  }

  var VERTEX = "attribute vec2 pos; varying vec2 uv;\n" +
    "void main() { uv = pos * 0.5 + 0.5; gl_Position = vec4(pos, 0.0, 1.0); }";

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      return { error: log };
    }
    return { shader: sh };
  }

  // ── the host ────────────────────────────────────────────────────────────────
  function init(canvas, glsl) {
    var gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return { error: "WebGL unavailable" };
    var v = compile(gl, gl.VERTEX_SHADER, VERTEX);
    if (v.error) { console.error("[shader] vertex compile failed:\n" + VERTEX + "\n" + v.error); return { error: v.error }; }
    var f = compile(gl, gl.FRAGMENT_SHADER, glsl);
    if (f.error) { console.error("[shader] fragment compile failed:\n" + glsl + "\n" + f.error); return { error: f.error }; }
    var prog = gl.createProgram();
    gl.attachShader(prog, v.shader);
    gl.attachShader(prog, f.shader);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(prog);
      console.error("[shader] link failed:\n" + glsl + "\n" + log);
      return { error: log };
    }
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var posLoc = gl.getAttribLocation(prog, "pos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    var locs = {};
    var loc = function (name) {
      if (!(name in locs)) locs[name] = gl.getUniformLocation(prog, name);
      return locs[name];
    };
    return {
      gl: gl,
      setUniform: function (name, kind, value) {
        var l = loc(name);
        if (l == null) return;                       // pruned/unused uniform: fine
        if (kind === "3f") gl.uniform3f(l, value[0], value[1], value[2]);
        else gl.uniform1f(l, Number(value) || 0);
      },
      resize: function (w, h, dpr) {
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";
        gl.viewport(0, 0, canvas.width, canvas.height);
      },
      draw: function () { gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); },
      dispose: function () { try { gl.deleteProgram(prog); gl.deleteBuffer(buf); } catch (e) {} },
    };
  }

  var api = { uniformPlan: uniformPlan, lzColorToVec3: lzColorToVec3, init: init, VERTEX: VERTEX };
  global.LzWebglQuad = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
