# shaderlib provenance

This library is a port of dreemgl's `system/shaderlib/*` — but the credit does not
belong to dreemgl, and this file exists so the actual authorship is never lost again.

## Who actually wrote this math

| Here | Original work | Author | License |
| --- | --- | --- | --- |
| `noise.ts` — `snoise2v`, `snoise3v`, `snoise4v`, `permute*`, `isqrtT*` (simplex noise) | [webgl-noise](https://github.com/stegu/webgl-noise) | **Ian McEwan, Ashima Arts** | MIT, © 2011 Ashima Arts |
| `noise.ts` — `cell2v`, `cell3v` (cellular/Worley noise) | [webgl-noise](https://github.com/stegu/webgl-noise) | **Stefan Gustavson** | MIT, © 2011 Stefan Gustavson |
| `noise.ts` — `cheapnoise` | the classic `fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453)` one-liner | unknown (widely circulated, frequently mis-attributed) | — |
| `shape.ts` — every SDF (`sdSphere` … `sdCappedCone`, `udTriangle`, `udQuad`, the 2D `circle`/`box`/`roundbox`/`line`, the smooth-min family) | [distfunctions](https://iquilezles.org/articles/distfunctions/), [smin](https://iquilezles.org/articles/smin/) | **Inigo Quilez** | published freely on iquilezles.org with attribution expected |
| `pal.ts` — `pal()` and the `pal0..pal7` idea | [cosine palettes](https://iquilezles.org/articles/palettes/) | **Inigo Quilez** (presets parameterized in dreemgl) | as above |
| `color.ts` — `hsla`, `hsva`, `hue2rgb` | the standard HSL/HSV conversion routines | folklore (EasyRGB / Foley–van Dam lineage) | — |
| `math.ts` — `rotate2d`, `bezier2d`, `odd`, `even` | elementary formulas | — | — |

## What dreemgl did with it

dreemgl (`github.com/dreemproject/dreemgl`, `system/shaderlib/`) transliterated the GLSL
above into its OneJS shader dialect and shipped it under a blanket header:

> *"Copyright 2015-2016 Teeming Society. Licensed under the Apache License, Version 2.0"*

The public commit record: the files land 2015-12-01 (`dreemgldev`, message "first");
copyright-header passes follow on 2016-01-24 and 2016-01-27 (`onejsdev`, "Copyright
header update" / "Update header"); a dithering helper is added 2016-01-26 (Stijn
Kuipers). The only nods to the actual authors are a comment reading *"inspired by
Seriously awesome GLSL noise functions. Stefan Gustavson, Ian McEwan Ashima Arts"* —
above what is a line-for-line transliteration, not an inspiration — and a *"some shapes
based on"* URL. webgl-noise's MIT license requires reproducing its copyright notice and
license text; a name-drop comment under someone else's copyright banner does not do
that. Draw your own conclusions about a workflow that rewrites public library code into
a proprietary dialect and stamps its own copyright on the result; the transliteration
also introduced real defects this port had to fix (`snoise2` referencing an undefined
variable, `sdTorus82/88` calling functions that exist nowhere, `circle` defined twice
with incompatible signatures).

## What this port does

- Credits the original authors in every file header, and reproduces the webgl-noise
  MIT notice in `noise.ts` as the license requires.
- Documents every correction and exclusion against the dreemgl files (see headers and
  the spec, `docs/superpowers/specs/2026-07-06-shader-view-design.md`).
- Type-annotates everything for the shader dialect so `lzx-check` validates it —
  which is how the defects above were found.
