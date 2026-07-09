// shaderlib: math — curated port of dreemgl system/shaderlib/mathlib.js
// (github.com/dreemproject/dreemgl, Apache-2.0). Dialect-clean TS.
// CORRECTIONS vs upstream: odd()/even() keep their upstream bool returns (they were
// already booleans, not strings); the string macro-constants (this.PI = '3.14…') are
// dropped in v1 — no in-scope consumer survives the exclusions (drawField consumed
// SQRT_1_2 and is itself excluded for its derivatives dependency).

export function rotate2d(v: vec2, angle: float): vec2 {
  let cosa = cos(angle);
  let sina = sin(angle);
  return vec2(v.x * cosa - v.y * sina, v.x * sina + v.y * cosa);
}

export function bezier2d(p0: vec2, p1: vec2, p2: vec2, p3: vec2, t: float): vec4 {
  let t2 = t * t;
  let t3 = t2 * t;
  let it = 1.0 - t;
  let it2 = it * it;
  let it3 = it2 * it;
  let pos = p0 * it3 + p1 * 3.0 * t * it2 + p2 * 3.0 * it * t2 + p3 * t3;
  let deriv = -3.0 * p0 * it2 + 3.0 * p1 * (it2 - 2.0 * t * it) + 3.0 * p2 * (-t2 + it * t * 2.0) + 3.0 * p3 * t2;
  deriv = normalize(deriv);
  return vec4(pos.x, pos.y, deriv.x, deriv.y);
}

export function odd(f: float): bool {
  if (mod(f, 2.0) == 0.0) {
    return true;
  } else {
    return false;
  }
}

export function even(f: float): bool {
  if (mod(f, 2.0) == 0.0) {
    return false;
  } else {
    return true;
  }
}
