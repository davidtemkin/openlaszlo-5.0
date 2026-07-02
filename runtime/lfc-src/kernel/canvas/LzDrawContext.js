/* -*- mode: JavaScript; c-basic-offset: 4; -*- */

/**
  * LzDrawContext.js  (CANVAS kernel)
  *
  * Implements <drawview>'s `this.context` contract (LaszloView.createContext /
  * $lzc$set_context, runtime/lfc-src/views/LaszloView.lzs) for the own-pixels canvas
  * kernel. `drawview.lzx` (runtime/components/extensions/drawview.lzx) is an ordinary
  * app-level LZX library component, NOT part of the LFC -- and the compiler's `$runtime`
  * constant is hardwired `"dhtml"` for every build (see openlaszlo-5.0/compiler
  * src/compile.ts COMPILE_CONSTANTS), so drawview's `<switch><when runtime="dhtml">`
  * branch is the ONLY branch that ever compiles, for apps run under EITHER kernel. The
  * exact same compiled `$lzc$class_drawview` / `LzCanvasGradient` JS therefore calls
  * straight through to `this.context.<method>()` here, unmodified. All this file owes is
  * an object -- handed back by `sprite.getContext()` -- that behaves enough like a real
  * `CanvasRenderingContext2D` for that already-compiled code to work.
  *
  * WHY RECORD/REPLAY. dhtml gives every drawview its OWN persistent `<canvas>` element
  * (kernel/dhtml/LzSprite.getContext): draws accumulate on real private pixels that
  * simply stay until the next clearRect. This kernel has no per-view surface at all --
  * the WHOLE scene is cleared and repainted from scratch every frame
  * (LzCanvasPainter.__repaint / __paintNode). So instead of a real context, a drawview's
  * `this.context` here is a RECORDING PROXY (LzDrawContext): every property write and
  * method call the app makes on it is appended, in order, to a per-sprite op list. At
  * paint time (`__paintFG`, invoked by LzCanvasPainter.__paintNode already inside this
  * sprite's own translate/rotate/scale/clip) the ENTIRE list is replayed against the
  * real shared ctx. Replaying an app's own `clearRect` mid-list genuinely erases
  * whatever the earlier entries in the SAME replay painted -- so "record everything,
  * replay every frame" is not an approximation, it reproduces the exact same raster a
  * persistent per-view canvas would show, op for op, on every repaint.
  *
  * GRADIENTS are the one place a real object is needed synchronously:
  * `LzCanvasGradient` (in drawview.lzx) calls `context.createLinearGradient` /
  * `createRadialGradient` immediately and holds the return value to call
  * `.addColorStop()` on it (baking in the drawview's CURRENT `globalAlpha` attribute at
  * that exact moment -- see drawview.lzx's `LzCanvasGradient.addColorStop`) before ever
  * assigning it to `fillStyle`/`strokeStyle`. A real `CanvasGradient`'s coordinates
  * resolve against the CTM in effect when it is later USED to fill/stroke, not when
  * created, so eagerly materializing one against the single shared `LzSprite.__ctx`
  * would use whatever transform some unrelated node last left there -- wrong.
  * `createLinearGradient`/`createRadialGradient` therefore return a lightweight
  * `LzDrawGradient` placeholder (kind + creation args + accumulated, already
  * alpha-baked color stops); a real `CanvasGradient` is materialized from it lazily,
  * the first time replay hits a `fillStyle`/`strokeStyle` write whose value is one of
  * these placeholders -- always inside `__paintFG`, i.e. always in the drawview's own
  * correct local space.
  *
  * @topic Kernel
  * @subtopic Canvas
  */

{
#pragma "warnUndefinedReferences=false"

// ===========================================================================
//  Gradient placeholder -- materialized to a real CanvasGradient at replay time
// ===========================================================================
function LzDrawGradient(kind, args) {
    this.kind = kind;    // 'linear' | 'radial'
    this.args = args;    // recorded creation args, in ctx.createXGradient() order
    this.stops = [];     // [[offset, cssColor], ...] -- already alpha-baked by the caller
}
LzDrawGradient.prototype.addColorStop = function (offset, color) {
    this.stops.push([offset, color]);
}
// Built fresh every replay (cheap; the CTM it resolves against can differ frame to
// frame -- e.g. a drawview nested inside an animated ancestor).
LzDrawGradient.prototype.__materialize = function (ctx) {
    var a = this.args, g;
    if (this.kind === 'radial') g = ctx.createRadialGradient(a[0], a[1], a[2], a[3], a[4], a[5]);
    else g = ctx.createLinearGradient(a[0], a[1], a[2], a[3]);
    for (var i = 0; i < this.stops.length; i++) {
        try { g.addColorStop(this.stops[i][0], this.stops[i][1]); } catch (e) {}
    }
    return g;
}

// ===========================================================================
//  Recording proxy -- one per drawview sprite (sprite.getContext() memoizes it)
// ===========================================================================
function LzDrawContext(sprite) {
    this.__sprite = sprite;
    this.__ops = [];
    // cached property values (also serve as the getter's backing store)
    this.__globalAlpha = 1;
    this.__fillStyle = '#000000';
    this.__strokeStyle = '#000000';
    this.__lineWidth = 1;
    this.__lineCap = 'butt';
    this.__lineJoin = 'miter';
    this.__miterLimit = 10;
    this.__font = null;
}
LzDrawContext.prototype.__rec = function (op) {
    this.__ops.push(op);
    LzSprite.__markDirty();
}

// --- path + drawing method calls -- args are already in the drawview's own local
// space (see file header), so replay issues them verbatim with no extra transform math.
LzDrawContext.prototype.beginPath = function () { this.__rec({ m: 'beginPath', a: [] }); }
LzDrawContext.prototype.closePath = function () { this.__rec({ m: 'closePath', a: [] }); }
LzDrawContext.prototype.moveTo = function (x, y) { this.__rec({ m: 'moveTo', a: [x, y] }); }
LzDrawContext.prototype.lineTo = function (x, y) { this.__rec({ m: 'lineTo', a: [x, y] }); }
LzDrawContext.prototype.quadraticCurveTo = function (cpx, cpy, x, y) { this.__rec({ m: 'quadraticCurveTo', a: [cpx, cpy, x, y] }); }
LzDrawContext.prototype.bezierCurveTo = function (c1x, c1y, c2x, c2y, x, y) { this.__rec({ m: 'bezierCurveTo', a: [c1x, c1y, c2x, c2y, x, y] }); }
LzDrawContext.prototype.arc = function (x, y, r, a0, a1, ccw) { this.__rec({ m: 'arc', a: [x, y, r, a0, a1, ccw] }); }
LzDrawContext.prototype.rect = function (x, y, w, h) { this.__rec({ m: 'rect', a: [x, y, w, h] }); }
LzDrawContext.prototype.fill = function () { this.__rec({ m: 'fill', a: [] }); }
LzDrawContext.prototype.stroke = function () { this.__rec({ m: 'stroke', a: [] }); }
LzDrawContext.prototype.clip = function () { this.__rec({ m: 'clip', a: [] }); }
LzDrawContext.prototype.clearRect = function (x, y, w, h) { this.__rec({ m: 'clearRect', a: [x, y, w, h] }); }
LzDrawContext.prototype.fillRect = function (x, y, w, h) { this.__rec({ m: 'fillRect', a: [x, y, w, h] }); }
LzDrawContext.prototype.strokeRect = function (x, y, w, h) { this.__rec({ m: 'strokeRect', a: [x, y, w, h] }); }
LzDrawContext.prototype.save = function () { this.__rec({ m: 'save', a: [] }); }
LzDrawContext.prototype.restore = function () { this.__rec({ m: 'restore', a: [] }); }
LzDrawContext.prototype.translate = function (x, y) { this.__rec({ m: 'translate', a: [x, y] }); }
LzDrawContext.prototype.rotate = function (r) { this.__rec({ m: 'rotate', a: [r] }); }
LzDrawContext.prototype.scale = function (x, y) { this.__rec({ m: 'scale', a: [x, y] }); }
LzDrawContext.prototype.drawImage = function () {
    var a = [];
    for (var i = 0; i < arguments.length; i++) a.push(arguments[i]);
    this.__rec({ m: 'drawImage', a: a });
}
LzDrawContext.prototype.fillText = function (text, x, y, maxWidth) {
    this.__rec((maxWidth == null) ? { m: 'fillText', a: [text, x, y] } : { m: 'fillText', a: [text, x, y, maxWidth] });
}
LzDrawContext.prototype.strokeText = function (text, x, y, maxWidth) {
    this.__rec((maxWidth == null) ? { m: 'strokeText', a: [text, x, y] } : { m: 'strokeText', a: [text, x, y, maxWidth] });
}

// --- gradients: return a placeholder immediately (see file header); NOT itself
// recorded as an op -- it only matters once (if ever) assigned to fillStyle/strokeStyle.
LzDrawContext.prototype.createLinearGradient = function (x0, y0, x1, y1) {
    return new LzDrawGradient('linear', [x0, y0, x1, y1]);
}
LzDrawContext.prototype.createRadialGradient = function (x0, y0, r0, x1, y1, r1) {
    return new LzDrawGradient('radial', [x0, y0, r0, x1, y1, r1]);
}

// --- measureText: must return synchronously and depends only on font (not the CTM),
// which is already known (__styleText() sets .font immediately before calling this) --
// so answer it directly against the one real shared ctx instead of deferring to replay.
LzDrawContext.prototype.measureText = function (text) {
    var ctx = LzSprite.__ctx;
    if (!ctx) return { width: 0 };
    var save = ctx.font;
    if (this.__font) ctx.font = this.__font;
    var m = ctx.measureText(text);
    ctx.font = save;
    return m;
}

// --- properties (globalAlpha/fillStyle/strokeStyle/lineWidth/lineCap/lineJoin/
// miterLimit/font): plain `this.context.fillStyle = X` assignments, so they need real
// accessor properties to be recorded like everything else, in the exact order the app
// interleaves them with method calls (drawview.lzx's __updateFillStyle/__updateLineStyle
// compare-and-set these directly on `this.context`).
function __lzDCProp(name) {
    Object.defineProperty(LzDrawContext.prototype, name, {
        get: function () { return this['__' + name]; },
        set: function (v) {
            this['__' + name] = v;
            this.__rec({ p: name, v: v });
        }
    });
}
__lzDCProp('globalAlpha');
__lzDCProp('fillStyle');
__lzDCProp('strokeStyle');
__lzDCProp('lineWidth');
__lzDCProp('lineCap');
__lzDCProp('lineJoin');
__lzDCProp('miterLimit');
__lzDCProp('font');

// ===========================================================================
//  sprite.getContext() / setContextCallback() -- wire up drawview's createContext()
// ===========================================================================
// dhtml's getContext() creates its private <canvas> and returns a context SYNCHRONOUSLY
// (LaszloView.createContext() never actually needs the callback path -- setContextCallback
// only matters for runtimes where the surface isn't ready immediately). Match that: return
// the (memoized) recording proxy synchronously too, and skip the callback entirely.
LzSprite.prototype.getContext = function () {
    if (this.__drawCtx) return this.__drawCtx;
    this.__drawCtx = new LzDrawContext(this);
    this.__paintFG = LzSprite.__drawViewPaintFG;
    return this.__drawCtx;
}
LzSprite.prototype.setContextCallback = function (scope, name) {}

// ===========================================================================
//  Replay -- invoked by LzCanvasPainter.__paintNode (see LzCanvasPainter.js `if
//  (s.__paintFG) s.__paintFG(ctx,w,h);`), already inside this sprite's own
//  translate/rotate/scale/clip. Wrapped in its own save/restore, with a tracked
//  save-depth, so an app that calls save() without a matching restore() (or clip()
//  left active) can never leak state into this node's own children or later siblings.
// ===========================================================================
LzSprite.__drawViewPaintFG = function (ctx, w, h) {
    var ops = this.__drawCtx.__ops;
    if (!ops.length) return;
    ctx.save();
    var depth = 0;
    for (var i = 0; i < ops.length; i++) {
        var op = ops[i];
        try {
            if (op.p) {
                var v = op.v;
                if (v instanceof LzDrawGradient) v = v.__materialize(ctx);
                ctx[op.p] = v;
            } else {
                if (op.m === 'save') depth++;
                else if (op.m === 'restore') { if (depth <= 0) continue; depth--; }
                ctx[op.m].apply(ctx, op.a);
            }
        } catch (e) {}
    }
    while (depth-- > 0) ctx.restore();
    ctx.restore();
}

}
