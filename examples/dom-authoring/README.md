# DOM-authored LZX (Slice 1)

Author LZX as native HTML inside `<laszlo-app>` (or a separate file via
`<laszlo-app src="app.html">`), served from the distro root:

    node tools/serve-static.mjs . 8087
    open http://localhost:8087/examples/dom-authoring/

## Dialect rules (full spec: docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md)

- The app root is `<laszlo-app width height bgcolor …>` (= LZX `<canvas>`).
  A literal `<canvas>` tag is forbidden.
- Code is **TypeScript**, in typed carriers:
  `<script type="text/typescript">…</script>` inside
  `<method>/<handler>/<setter>` (or standalone for top-level scripts).
  `type="text/lzs"` passes raw LZX Script through (for `is` / `cast`).
  Bare `<script>` is an error (the page parser would execute it).
- Tags that collide with HTML need the `lz-` prefix:
  `lz-style`, `lz-image`, `lz-html`, `lz-form`, `lz-button`, `lz-label`,
  `lz-menu`, `lz-param`. (Any LZX tag may be prefixed.)
- Lowercase only: user class names, attribute and event names.
- No self-closing custom tags: write `<view></view>`, not `<view/>`.
- Inline datasets use `<script type="application/xml">…</script>` (single XML
  root) or `src=` files.
- Statically-authored plain `<view>`s are **adopted**: the element you wrote is
  the live `__LZdiv` of its sprite. `<text>`/`<inputtext>`, replicated and
  class-instantiated views render into created elements (Slice-1 fallback).
- Production build only (no `?debug` source-line mapping for DOM-authored apps).
