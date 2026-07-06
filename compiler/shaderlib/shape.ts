// shaderlib: shape — curated port of dreemgl system/shaderlib/shapelib.js
// (github.com/dreemproject/dreemgl, Apache-2.0; shapes after iquilezles.org
// distfunctions). Dialect-clean TS.
// CORRECTIONS / EXCLUSIONS vs upstream:
//   - upstream defines `circle` TWICE with different signatures (shapelib.js:41 SDF-boolean,
//     :238 distance-field). The distance-field one keeps the name `circle`; the boolean
//     one is renamed `fillcircle`.
//   - sdTorus82/sdTorus88 DROPPED: they call length2/length8, defined nowhere upstream.
//   - drawField EXCLUDED: needs GL_OES_standard_derivatives (#extension is a v1 non-goal).

export function roundedrectdistance(sized: vec2, width: float, height: float,
  topleftcorner: float, toprightcorner: float, bottomleftcorner: float, bottomrightcorner: float): float {
  let c1 = vec2(topleftcorner - 0.5, topleftcorner - 0.5);
  let c2 = vec2(bottomleftcorner - 0.5, height - bottomleftcorner - 0.5);
  let c3 = vec2(width - bottomrightcorner - 0.5, height - bottomrightcorner - 0.5);
  let c4 = vec2(width - toprightcorner - 0.5, toprightcorner - 0.5);

  let dist = 0.0;

  if (sized.x <= c1.x && sized.y < c1.y) {
    dist = shape.distcircle(sized - c1, topleftcorner);
  } else {
    if (sized.x >= c3.x && sized.y >= c3.y) {
      dist = shape.distcircle(sized - c3, bottomrightcorner);
    } else {
      if (sized.x <= c2.x && sized.y >= c2.y) {
        dist = shape.distcircle(sized - c2, bottomleftcorner);
      } else {
        if (sized.x >= c4.x && sized.y <= c4.y) {
          dist = shape.distcircle(sized - c4, toprightcorner);
        } else {
          dist = max(max(-sized.y, sized.y - height), max(-sized.x, sized.x - width));
        }
      }
    }
  }
  return dist;
}

export function fillcircle(texpos: vec2, radius: float): float {
  let c = texpos - vec2(0.5);
  let dist = length(c) - radius;
  let sdf = dist < 0.0 ? 1.0 : 0.0;
  return sdf;
}

export function distcircle(texpos: vec2, radius: float): float {
  let c = texpos - vec2(0.5);
  let dist = length(c) - radius;
  return dist;
}

export function sdSphere(p: vec3, s: float): float {
  return length(p) - s;
}

export function udBox(p: vec3, b: vec3): float {
  return length(max(abs(p) - b, 0.0));
}

export function udRoundBox(p: vec3, b: vec3, r: float): float {
  return length(max(abs(p) - b, 0.0)) - r;
}

export function sdBox(p: vec3, b: vec3): float {
  let d = abs(p) - b;
  return min(max(d.x, max(d.y, d.z)), 0.0) + length(max(d, 0.0));
}

export function sdTorus(p: vec3, t: vec2): float {
  let q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

export function sdCylinder(p: vec3, c: vec3): float {
  return length(p.xz - c.xy) - c.z;
}

export function sdCone(p: vec3, c: vec2): float {
  // c must be normalized
  let q = length(p.xy);
  return dot(c, vec2(q, p.z));
}

export function sdPlane(p: vec3, n: vec4): float {
  // n must be normalized
  return dot(p, n.xyz) + n.w;
}

export function sdHexPrism(p: vec3, h: vec2): float {
  let q = abs(p);
  return max(q.z - h.y, max(q.x * 0.866025 + q.y * 0.5, q.y) - h.x);
}

export function sdTriPrism(p: vec3, h: vec2): float {
  let q = abs(p);
  return max(q.z - h.y, max(q.x * 0.866025 + p.y * 0.5, -p.y) - h.x * 0.5);
}

export function sdCapsule(p: vec3, a: vec3, b: vec3, r: float): float {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

export function sdCappedCylinder(p: vec3, h: vec2): float {
  let d = abs(vec2(length(p.xz), p.y)) - h;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

export function dot2(v: vec3): float {
  return dot(v, v);
}

export function udTriangle(p: vec3, a: vec3, b: vec3, c: vec3): float {
  let ba = b - a;
  let pa = p - a;
  let cb = c - b;
  let pb = p - b;
  let ac = a - c;
  let pc = p - c;
  let nor = cross(ba, ac);

  return sqrt(
    (sign(dot(cross(ba, nor), pa)) +
      sign(dot(cross(cb, nor), pb)) +
      sign(dot(cross(ac, nor), pc)) < 2.0)
      ?
      min(min(
        shape.dot2(ba * clamp(dot(ba, pa) / shape.dot2(ba), 0.0, 1.0) - pa),
        shape.dot2(cb * clamp(dot(cb, pb) / shape.dot2(cb), 0.0, 1.0) - pb)),
        shape.dot2(ac * clamp(dot(ac, pc) / shape.dot2(ac), 0.0, 1.0) - pc))
      :
      dot(nor, pa) * dot(nor, pa) / shape.dot2(nor));
}

export function udQuad(p: vec3, a: vec3, b: vec3, c: vec3, d: vec3): float {
  let ba = b - a;
  let pa = p - a;
  let cb = c - b;
  let pb = p - b;
  let dc = d - c;
  let pc = p - c;
  let ad = a - d;
  let pd = p - d;
  let nor = cross(ba, ad);

  return sqrt(
    (sign(dot(cross(ba, nor), pa)) +
      sign(dot(cross(cb, nor), pb)) +
      sign(dot(cross(dc, nor), pc)) +
      sign(dot(cross(ad, nor), pd)) < 3.0)
      ?
      min(min(min(
        shape.dot2(ba * clamp(dot(ba, pa) / shape.dot2(ba), 0.0, 1.0) - pa),
        shape.dot2(cb * clamp(dot(cb, pb) / shape.dot2(cb), 0.0, 1.0) - pb)),
        shape.dot2(dc * clamp(dot(dc, pc) / shape.dot2(dc), 0.0, 1.0) - pc)),
        shape.dot2(ad * clamp(dot(ad, pd) / shape.dot2(ad), 0.0, 1.0) - pd))
      :
      dot(nor, pa) * dot(nor, pa) / shape.dot2(nor));
}

export function sdCappedCone(p: vec3, c: vec3): float {
  let q = vec2(length(p.xz), p.y);
  let v = vec2(c.z * c.y / c.x, -c.z);

  let w = v - q;

  let vv = vec2(dot(v, v), v.x * v.x);
  let qv = vec2(dot(v, w), v.x * w.x);

  let d = max(qv, 0.0) * qv / vv;

  return sqrt(dot(w, w) - max(d.x, d.y)) * sign(max(q.y * v.x - q.x * v.y, w.y));
}

export function opU(d1: float, d2: float): float {
  return min(d1, d2);
}

export function opS(d1: float, d2: float): float {
  return max(-d1, d2);
}

export function opI(d1: float, d2: float): float {
  return max(d1, d2);
}

export function union2(d1: float, d2: float): float {
  return min(d1, d2);
}

export function intersect(d1: float, d2: float): float {
  return max(d1, d2);
}

export function subtract(d1: float, d2: float): float {
  return max(-d1, d2);
}

export function circle(p: vec2, x: float, y: float, radius: float): float {
  return distance(p, vec2(x, y)) - radius;
}

export function box(p: vec2, left: float, top: float, width: float, height: float): float {
  let xy = vec2(left, top);
  let hwh = vec2(0.5 * width, 0.5 * height);
  let d = abs(p - xy - hwh) - hwh;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

export function roundbox(p: vec2, left: float, top: float, width: float, height: float, radius: float): float {
  let rad2 = vec2(radius, radius);
  let hwh = vec2(0.5 * width, 0.5 * height);
  let xy = vec2(left, top);
  return length(max(abs(p - xy - hwh) - (hwh - 2.0 * rad2), 0.0)) - 2.0 * radius;
}

export function line(p: vec2, left: float, top: float, right: float, bottom: float, radius: float): float {
  let a = vec2(left, top);
  let b = vec2(right, bottom);
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - radius;
}

export function smoothpoly(a: float, b: float, k: float): float {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

export function smoothpow(a: float, b: float, k: float): float {
  let ak = pow(a, k);
  let bk = pow(b, k);
  return pow((ak * bk) / (ak + bk), 1.0 / k);
}

export function smoothexp(a: float, b: float, k: float): float {
  let res = exp(-k * a) + exp(-k * b);
  return -log(res) / k;
}
