// shaderlib: color — curated port of dreemgl system/shaderlib/colorlib.js
// (github.com/dreemproject/dreemgl, Apache-2.0). Dialect-clean TS: intra-lib
// this.-calls namespace-qualified (this.hue2rgb → color.hue2rgb).

export function hue2rgb(p: float, q: float, t: float): float {
  let tt = t;
  if (tt < 0.0) {
    tt += 1.0;
  } else {
    if (tt > 1.0) { tt -= 1.0; }
  }
  if (tt < 0.166666666666667) { return p + (q - p) * 6.0 * tt; }
  if (tt < 0.5) { return q; }
  if (tt < 0.666666666666667) { return p + (q - p) * (0.666666666666667 - tt) * 6.0; }
  return p;
}

export function hsla(hlsa: vec4): vec4 {
  let h = hlsa.x;
  let s = hlsa.y;
  let l = hlsa.z;

  let r = 0.0;
  let g = 0.0;
  let b = 0.0;

  if (s == 0.0) {
    r = g = b = l; // achromatic
  } else {
    let q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
    let p = 2.0 * l - q;
    r = color.hue2rgb(p, q, h + 0.333333333333333);
    g = color.hue2rgb(p, q, h);
    b = color.hue2rgb(p, q, h - 0.333333333333333);
  }

  return vec4(r, g, b, hlsa.w);
}

export function hsva(hsva: vec4): vec4 {
  let h = hsva.x * 360.0;
  let s = hsva.y;
  let v = hsva.z;
  let r = 0.0;
  let g = 0.0;
  let b = 0.0;
  if (h < 0.0) { h += 360.0; }
  if (s == 0.0) {
    r = g = b = v; // achromatic
  } else {
    let t1 = v;
    let t2 = (1.0 - s) * v;
    let t3 = (t1 - t2) * mod(h, 60.0) / 60.0;
    if (h == 360.0) { h = 0.0; }
    if (h < 60.0) { r = t1; b = t2; g = t2 + t3; }
    else {
      if (h < 120.0) { g = t1; b = t2; r = t1 - t3; }
      else {
        if (h < 180.0) { g = t1; r = t2; b = t2 + t3; }
        else {
          if (h < 240.0) { b = t1; r = t2; g = t1 - t3; }
          else {
            if (h < 300.0) { b = t1; g = t2; r = t2 + t3; }
            else {
              if (h < 360.0) { r = t1; g = t2; b = t1 - t3; }
              else { r = 0.0; g = 0.0; b = 0.0; }
            }
          }
        }
      }
    }
  }
  return vec4(r, g, b, hsva.w);
}
