// shaderlib: noise — simplex + cellular noise.
// ORIGINAL WORK: Ian McEwan & Stefan Gustavson, Ashima Arts "webgl-noise"
// (github.com/ashima/webgl-noise, now github.com/stegu/webgl-noise),
// Copyright (C) 2011 Ashima Arts, MIT License — reproduced below as MIT requires.
// The dreemgl file this port descends from (system/shaderlib/noiselib.js,
// "Copyright Teeming Society, Apache-2.0") is a transliteration of that GLSL into
// its JS shader dialect with a name-drop comment only; this port restores the
// attribution. cheapnoise is the classic fract(sin(dot)) one-liner (origin unknown).
//
// MIT License (webgl-noise): Permission is hereby granted, free of charge, to any
// person obtaining a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including without
// limitation the rights to use, copy, modify, merge, publish, distribute,
// sublicense, and/or sell copies of the Software, subject to the above copyright
// notice and this permission notice being included in all copies or substantial
// portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
// ANY KIND.
//
// Dialect-clean TS (see the shader spec):
// AMD unwrapped, var→let, alias chains split keeping the primary name, zero-arg
// constructors expanded, intra-lib calls namespace-qualified.
// CORRECTIONS vs upstream (documented in the spec's "curated port" section):
//   - snoise2(x,y) DROPPED: upstream references an undefined `z` (noiselib.js:27).

export function permute1(x: float): float {
  return mod((34.0 * x + 1.0) * x, 289.0);
}
export function permute3(x: vec3): vec3 {
  return mod((34.0 * x + 1.0) * x, 289.0);
}
export function permute4(x: vec4): vec4 {
  return mod((34.0 * x + 1.0) * x, 289.0);
}
export function isqrtT1(r: float): float {
  return 1.79284291400159 - 0.85373472095314 * r;
}
export function isqrtT4(r: vec4): vec4 {
  return vec4(1.79284291400159) - 0.85373472095314 * r;
}

export function cheapnoise(inp: vec2): float {
  return fract(sin(dot(inp.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

export function snoise2v(v: vec2): float {
  let C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  let i = floor(v + dot(v, C.yy));
  let x0 = v - i + dot(i, C.xx);

  let i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  let x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;

  i = mod(i, 289.0); // Avoid truncation effects in permutation
  let p = noise.permute3(noise.permute3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));

  let m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;

  let x = 2.0 * fract(p * C.www) - 1.0;
  let h = abs(x) - 0.5;
  let ox = floor(x + 0.5);
  let a0 = x - ox;

  m *= (1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h));
  let g = vec3(0.0, 0.0, 0.0);
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

export function snoise3(x: float, y: float, z: float): float {
  return noise.snoise3v(vec3(x, y, z));
}
export function snoise3v(v: vec3): float {
  let C = vec2(0.166666666666667, 0.333333333333333);
  let D = vec4(0.0, 0.5, 1.0, 2.0);

  // First corner
  let i = floor(v + dot(v, C.yyy));
  let x0 = v - i + dot(i, C.xxx);
  let g = step(x0.yzx, x0.xyz);
  let l = 1.0 - g;
  let i1 = min(g.xyz, l.zxy);
  let i2 = max(g.xyz, l.zxy);
  let x1 = x0 - i1 + 1.0 * C.xxx;
  let x2 = x0 - i2 + 2.0 * C.xxx;
  let x3 = x0 - 1.0 + 3.0 * C.xxx;

  // Permutations
  i = mod(i, 289.0);
  let p = noise.permute4(noise.permute4(noise.permute4(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  // ( N*N points uniformly over a square, mapped onto an octahedron.)
  let n_ = 0.142857142857143;
  let ns = n_ * D.wyz - D.xzx;
  let j = p - 49.0 * floor(p * ns.z * ns.z);
  let x_ = floor(j * ns.z);
  let y_ = floor(j - 7.0 * x_);
  let x = x_ * ns.x + ns.yyyy;
  let y = y_ * ns.x + ns.yyyy;
  let h = 1.0 - abs(x) - abs(y);
  let b0 = vec4(x.xy, y.xy);
  let b1 = vec4(x.zw, y.zw);
  let s0 = floor(b0) * 2.0 + 1.0;
  let s1 = floor(b1) * 2.0 + 1.0;
  let sh = -step(h, vec4(0.0, 0.0, 0.0, 0.0));
  let a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  let a1 = b1.xzyw + s1.xzyw * sh.zzww;
  let p0 = vec3(a0.xy, h.x);
  let p1 = vec3(a0.zw, h.y);
  let p2 = vec3(a1.xy, h.z);
  let p3 = vec3(a1.zw, h.w);

  // Normalise gradients
  let norm = noise.isqrtT4(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  // Mix final noise value
  let m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

export function snoise4_g(j: float, ip: vec4): vec4 {
  let p = vec4(0.0, 0.0, 0.0, 0.0);
  p.xyz = floor(fract(vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
  p.w = 1.5 - dot(abs(p.xyz), vec3(1.0, 1.0, 1.0));
  let s = vec4(lessThan(p, vec4(0.0, 0.0, 0.0, 0.0)));
  p.xyz = p.xyz + (s.xyz * 2.0 - 1.0) * s.www;
  return p;
}
export function snoise4(x: float, y: float, z: float, w: float): float {
  return noise.snoise4v(vec4(x, y, z, w));
}
export function snoise4v(v: vec4): float {
  let C = vec4(0.138196601125011, 0.276393202250021, 0.414589803375032, -0.447213595499958);
  // First corner
  let i = floor(v + dot(v, vec4(0.309016994374947451)));
  let x0 = v - i + dot(i, C.xxxx);
  let i0 = vec4(0.0, 0.0, 0.0, 0.0);
  let isX = step(x0.yzw, x0.xxx);
  let isYZ = step(x0.zww, x0.yyz);
  i0.x = isX.x + isX.y + isX.z;
  i0.yzw = 1.0 - isX;
  i0.y += isYZ.x + isYZ.y;
  i0.zw += 1.0 - isYZ.xy;
  i0.z += isYZ.z;
  i0.w += 1.0 - isYZ.z;
  let i3 = clamp(i0, 0.0, 1.0);
  let i2 = clamp(i0 - 1.0, 0.0, 1.0);
  let i1 = clamp(i0 - 2.0, 0.0, 1.0);
  let x1 = x0 - i1 + C.xxxx;
  let x2 = x0 - i2 + C.yyyy;
  let x3 = x0 - i3 + C.zzzz;
  let x4 = x0 + C.wwww;
  // Permutations
  i = mod(i, 289.0);
  let j0 = noise.permute1(noise.permute1(noise.permute1(noise.permute1(i.w) + i.z) + i.y) + i.x);
  let j1 = noise.permute4(noise.permute4(noise.permute4(noise.permute4(
    i.w + vec4(i1.w, i2.w, i3.w, 1.0))
    + i.z + vec4(i1.z, i2.z, i3.z, 1.0))
    + i.y + vec4(i1.y, i2.y, i3.y, 1.0))
    + i.x + vec4(i1.x, i2.x, i3.x, 1.0));
  // Gradients: 7x7x6 points over a cube, mapped onto a 4-cross polytope
  let ip = vec4(0.003401360544218, 0.020408163265306, 0.142857142857143, 0.0);
  let p0 = noise.snoise4_g(j0, ip);
  let p1 = noise.snoise4_g(j1.x, ip);
  let p2 = noise.snoise4_g(j1.y, ip);
  let p3 = noise.snoise4_g(j1.z, ip);
  let p4 = noise.snoise4_g(j1.w, ip);
  // Normalise gradients
  let nr = noise.isqrtT4(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= nr.x;
  p1 *= nr.y;
  p2 *= nr.z;
  p3 *= nr.w;
  p4 *= noise.isqrtT1(dot(p4, p4));
  // Mix contributions from the five corners
  let m0 = max(0.6 - vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2)), 0.0);
  let m1 = max(0.6 - vec2(dot(x3, x3), dot(x4, x4)), 0.0);
  m0 = m0 * m0;
  m1 = m1 * m1;

  return 49.0 * (dot(m0 * m0, vec3(dot(p0, x0), dot(p1, x1), dot(p2, x2)))
    + dot(m1 * m1, vec2(dot(p3, x3), dot(p4, x4))));
}

export function cell2v(v: vec2): vec2 {
  return noise.cell3v(vec3(v.x, v.y, 0.0));
}
export function cell3v(P: vec3): vec2 {
  let K = 0.142857142857;   // 1/7
  let Ko = 0.428571428571;  // 1/2-K/2
  let K2 = 0.020408163265306; // 1/(7*7)
  let Kz = 0.166666666667;  // 1/6
  let Kzo = 0.416666666667; // 1/2-1/6*2
  let ji = 0.8;             // smaller jitter gives less errors in F2
  let Pi = mod(floor(P), 289.0);
  let Pf = fract(P);
  let Pfx = Pf.x + vec4(0.0, -1.0, 0.0, -1.0);
  let Pfy = Pf.y + vec4(0.0, 0.0, -1.0, -1.0);
  let p = noise.permute4(Pi.x + vec4(0.0, 1.0, 0.0, 1.0));
  p = noise.permute4(p + Pi.y + vec4(0.0, 0.0, 1.0, 1.0));
  let p1 = noise.permute4(p + Pi.z);                    // z+0
  let p2 = noise.permute4(p + Pi.z + vec4(1.0));        // z+1
  let ox1 = fract(p1 * K) - Ko;
  let oy1 = mod(floor(p1 * K), 7.0) * K - Ko;
  let oz1 = floor(p1 * K2) * Kz - Kzo;                  // p1 < 289 guaranteed
  let ox2 = fract(p2 * K) - Ko;
  let oy2 = mod(floor(p2 * K), 7.0) * K - Ko;
  let oz2 = floor(p2 * K2) * Kz - Kzo;
  let dx1 = Pfx + ji * ox1;
  let dy1 = Pfy + ji * oy1;
  let dz1 = Pf.z + ji * oz1;
  let dx2 = Pfx + ji * ox2;
  let dy2 = Pfy + ji * oy2;
  let dz2 = Pf.z - 1.0 + ji * oz2;
  let d1 = dx1 * dx1 + dy1 * dy1 + dz1 * dz1;           // z+0
  let d2 = dx2 * dx2 + dy2 * dy2 + dz2 * dz2;           // z+1

  let d = min(d1, d2);      // F1 is now in d
  d2 = max(d1, d2);         // Make sure we keep all candidates for F2
  d.xy = (d.x < d.y) ? d.xy : d.yx;   // Swap smallest to d.x
  d.xz = (d.x < d.z) ? d.xz : d.zx;
  d.xw = (d.x < d.w) ? d.xw : d.wx;   // F1 is now in d.x
  d.yzw = min(d.yzw, d2.yzw);         // F2 now not in d2.yzw
  d.y = min(d.y, d.z);
  d.y = min(d.y, d.w);
  d.y = min(d.y, d2.x);               // F2 is now in d.y
  return sqrt(d.xy);                  // F1 and F2
}
