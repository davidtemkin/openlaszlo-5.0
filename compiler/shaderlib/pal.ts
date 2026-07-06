// shaderlib: pal — curated port of dreemgl system/shaderlib/palettelib.js
// (github.com/dreemproject/dreemgl, Apache-2.0). Dialect-clean TS.
// EXCLUSIONS vs upstream (textures are a slice-7 non-goal): fetch, band_with_dither,
// dither, dithercrystal, checker (5 of 16 — all texture.sample/gl_FragCoord based).
// Alias chains split keeping the palN primary names (rainbow/hotcool/… dropped).

export function pal(t: float, a: vec3, b: vec3, c: vec3, d: vec3): vec3 {
  return a + b * cos(6.28318 * (c * t + d));
}

export function pal0(t: float): vec4 {
  return vec4(mix(vec3(0.0), vec3(1.0), t), 1.0);
}
export function pal1(t: float): vec4 {
  return vec4(pal.pal(t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67)), 1.0);
}
export function pal2(t: float): vec4 {
  return vec4(pal.pal(t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.1, 0.2)), 1.0);
}
export function pal3(t: float): vec4 {
  return vec4(pal.pal(t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.3, 0.2, 0.2)), 1.0);
}
export function pal4(t: float): vec4 {
  return vec4(pal.pal(t, vec3(0.5), vec3(0.5), vec3(1.0, 1.0, 0.5), vec3(0.8, 0.9, 0.3)), 1.0);
}
export function pal5(t: float): vec4 {
  return vec4(pal.pal(t, vec3(0.5), vec3(0.5), vec3(1.0, 0.7, 0.4), vec3(0.0, 0.15, 0.2)), 1.0);
}
export function pal6(t: float): vec4 {
  return vec4(pal.pal(t, vec3(0.5), vec3(0.5), vec3(2.0, 1.0, 0.0), vec3(0.5, 0.2, 0.25)), 1.0);
}
export function pal7(t: float): vec4 {
  return vec4(pal.pal(t, vec3(0.8, 0.5, 0.4), vec3(0.2, 0.4, 0.2), vec3(2.0, 1.0, 1.0), vec3(0.0, 0.25, 0.25)), 1.0);
}

export function band_no_dither(y: float, col: vec4): vec4 {
  let f = fract(y);
  let out = col;
  out *= smoothstep(0.49, 0.47, abs(f - 0.5));
  out *= 0.5 + 0.5 * sqrt(4.0 * f * (1.0 - f));
  return out;
}

export function hsv2rgb(hsv: vec3): vec3 {
  return hsv.z * (1.0 + 0.5 * hsv.y * (cos(6.2832 * (hsv.x + vec3(0.0, 0.6667, 0.3333))) - 1.0));
}
