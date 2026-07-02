/* -*- mode: JavaScript; c-basic-offset: 4; -*- */

/**
  * LzCanvasHitTest.js  (CANVAS kernel)
  *
  * Geometric hit-testing for the own-pixels canvas kernel. The dhtml kernel gives every
  * clickable view its own absolutely-positioned <div> and lets the browser hit-test for
  * free; canvas owns its pixels, so WE find which sprite is under a point.
  *
  * `__hitNode` does the reverse painter's-walk (top-z first), transforming the point into
  * each node's local space (the inverse of LzCanvasPainter.__paintNode's
  * translate->rotate->scale), culling whole subtrees by their rect clip, and returning the
  * topmost CLICKABLE sprite whose (0,0,w,h) contains the point. `__hitTestPage` runs it at
  * the current page mouse position. `__canvasPageOffset` (the canvas element's absolute
  * page position) is shared with LzCanvasInput's `__getPos`.
  *
  * Seam: consumes the same scene fields the painter walks (x/xoffset/rotation/xscale/clip/
  * width/height/__children) and the core's `LzSprite.__zCompareFn`; produces a sprite for
  * LzCanvasInput to deliver events to. No pixels touched here.
  *
  * @topic Kernel
  * @subtopic Canvas
  */

{
#pragma "warnUndefinedReferences=false"

// Canvas element's absolute page position (left,top incl. document scroll).
LzSprite.__canvasPageOffset = function () {
    var c = LzSprite.__canvasEl;
    if (!c || !c.getBoundingClientRect) return { x: 0, y: 0 };
    var r = c.getBoundingClientRect();
    var sx = (typeof window != 'undefined' && window.pageXOffset) || 0;
    var sy = (typeof window != 'undefined' && window.pageYOffset) || 0;
    return { x: r.left + sx, y: r.top + sy };
}

// Reverse painter's-walk: return the topmost CLICKABLE sprite containing (px,py),
// where (px,py) is in the PARENT coordinate space of `s`. Mirrors __paintNode's
// transform/clip exactly (translate -> rotate -> scale; rect clip culls subtree),
// but visits children FRONT-TO-BACK (highest z first) and returns the first hit.
LzSprite.__hitNode = function (s, px, py) {
    if (s.visible === false) return null;
    if ((s.opacity != null) && s.opacity <= 0) return null;
    // into local space (inverse of the paint transform)
    var lx = px - ((s.x || 0) + (s.xoffset || 0));
    var ly = py - ((s.y || 0) + (s.yoffset || 0));
    if (s.rotation) {
        var a = -s.rotation * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
        var nx = lx * ca - ly * sa, ny = lx * sa + ly * ca; lx = nx; ly = ny;
    }
    if (s.xscale && s.xscale != 1) lx /= s.xscale;
    if (s.yscale && s.yscale != 1) ly /= s.yscale;
    var w = s.width, h = s.height;
    // a rect clip removes the whole subtree (and self) outside the bounds
    if (s.clip && (lx < 0 || ly < 0 || w == null || h == null || lx >= w || ly >= h)) return null;
    var ch = s.__children;
    if (ch && ch.length) {
        var sorted = ch.length > 1 ? ch.slice().sort(LzSprite.__zCompareFn) : ch;
        for (var i = sorted.length - 1; i >= 0; i--) {
            var hit = LzSprite.__hitNode(sorted[i], lx, ly);
            if (hit) return hit;
        }
    }
    if (s.clickable && w > 0 && h > 0 && lx >= 0 && ly >= 0 && lx < w && ly < h) return s;
    return null;
}

// Hit-test at the current page mouse position (LzMouseKernel.__x/__y).
LzSprite.__hitTestPage = function () {
    var root = LzSprite.__rootSprite;
    if (!root) return null;
    var off = LzSprite.__canvasPageOffset();
    return LzSprite.__hitNode(root, LzMouseKernel.__x - off.x, LzMouseKernel.__y - off.y);
}

}
