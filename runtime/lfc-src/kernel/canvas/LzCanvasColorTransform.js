/* -*- mode: JavaScript; c-basic-offset: 4; -*- */

/**
  * LzCanvasColorTransform.js  (CANVAS kernel)
  *
  * Implements the Flash-style ColorTransform primitive on the own-pixels canvas kernel:
  * per-channel `multiplier` + `offset` applied to a sprite's drawn output. This is the
  * `setColorTransform`/`colortransform`/`tintcolor` path that LaszloView exposes but that
  * ships gated on `capabilities.colortransform` (FALSE by default -> the view methods only
  * warn + no-op). This module supplies the missing sprite primitive and FLIPS the capability
  * on, so the LFC drives the real path (e.g. the Calendar's eventselector selection tint via
  * `bar.gripper.top.setColorTransform({ra:80,ga:80,ba:80})`, and window tinting later).
  *
  * PARITY MODEL (matches the DHTML oracle exactly). The oracle (openlaszlo-5.0 lfc.js, the
  * appended colortransform block) applies an SVG `<feColorMatrix type="matrix">` filter to the
  * sprite's resource element `this.__LZimg || this.__LZdiv` with a DIAGONAL 5x4 matrix and
  * `color-interpolation-filters="sRGB"`:
  *     R' = rm*R + ro   G' = gm*G + go   B' = bm*B + bo   A' = am*A + ao     (in 0..255 sRGB)
  * (the oracle writes the offset as `offset/255` because feColorMatrix works in 0..1). Because
  * `el = __LZimg || __LZdiv`, when the sprite has a RESOURCE image the filter tints ONLY the
  * image (bgcolor + children, which live on __LZdiv, are untouched); when there is NO image the
  * filter tints the __LZdiv content (bgcolor). We reproduce both:
  *   - image present  -> tint the source bitmap (cached) and draw it exactly where/how the
  *     untinted image draws (same stretch + device pixel-snap) -> pixel-identical geometry/AA,
  *     recolored per the diagonal matrix. For an unscaled 1:1 image (the Calendar dragbar/badge)
  *     tint-then-draw == draw-then-tint, so this matches the oracle's post-scale filter exactly.
  *   - image absent   -> transform the solid bgcolor fill color directly (exact for an opaque
  *     fill; no offscreen needed). The painter reads `__ctColor` for this.
  * feColorMatrix operates on NON-premultiplied sRGB, which is exactly what canvas getImageData /
  * a solid fill give us, so the arithmetic is a straight per-channel affine map.
  *
  * NOTE (characterized): the oracle's CSS/SVG filter on a plain __LZdiv also visually cascades
  * to child DIVs. In the neo view model each sprite carries its OWN colortransform (the app sets
  * it on the specific chrome/bg sprites it wants tinted -- e.g. the eventselector tints three
  * leaf resource sprites by name, and dashboard window-tinting targets the bg sprites), so we do
  * NOT auto-cascade a parent's transform onto child sprites. If a future app relies on the div
  * cascade, that becomes an offscreen-subtree composite pass here.
  *
  * MODULARITY: all colortransform state + math lives in THIS module (extends the shared global
  * LzSprite). The painter (LzCanvasPainter.js) only swaps `s.__img` -> the tinted bitmap and the
  * bgcolor fillStyle -> `__ctColor(...)` when `s.__colortransform` is set. Core LzSprite.js is
  * untouched (its no-op `setColorTransform`/`getColorTransform` are overridden here because this
  * file is #included after the core).
  *
  * @topic Kernel
  * @subtopic Canvas
  */

{
#pragma "warnUndefinedReferences=false"

function __ctNum(v, dflt) { return (v == null || (typeof v == 'number' && isNaN(v))) ? dflt : v; }

// Identity == every multiplier ~1 and every offset ~0 (no visible change). Such a transform
// CLEARS the tint (mirrors the oracle's isIdentity -> el.style.filter = "").
function __ctIsIdentity(rm, gm, bm, am, ro, go, bo, ao) {
    var e = 0.0001;
    return Math.abs(rm - 1) < e && Math.abs(gm - 1) < e &&
           Math.abs(bm - 1) < e && Math.abs(am - 1) < e &&
           Math.abs(ro) < e && Math.abs(go) < e && Math.abs(bo) < e && Math.abs(ao) < e;
}

/**
  * Store a Flash-style color transform for this sprite and request a repaint. Accepts the
  * general dict the LaszloView colortransform setter produces:
  *   {redMultiplier, redOffset, greenMultiplier, greenOffset,
  *    blueMultiplier, blueOffset, alphaMultiplier, alphaOffset}
  * We normalize to a compact {rm,ro,gm,go,bm,bo,am,ao} the painter/tinter consume; an identity
  * transform is stored as null (untinted fast path).
  */
LzSprite.prototype.setColorTransform = function (o) {
    o = o || {};
    var rm = __ctNum(o.redMultiplier,   1), ro = __ctNum(o.redOffset,   0);
    var gm = __ctNum(o.greenMultiplier, 1), go = __ctNum(o.greenOffset, 0);
    var bm = __ctNum(o.blueMultiplier,  1), bo = __ctNum(o.blueOffset,  0);
    var am = __ctNum(o.alphaMultiplier, 1), ao = __ctNum(o.alphaOffset, 0);
    if (__ctIsIdentity(rm, gm, bm, am, ro, go, bo, ao)) {
        this.__colortransform = null;
        this.__colortransformRaw = null;
    } else {
        this.__colortransform = { rm: rm, ro: ro, gm: gm, go: go, bm: bm, bo: bo, am: am, ao: ao };
        this.__colortransformRaw = o;   // returned verbatim by getColorTransform()
    }
    LzSprite.__markDirty();
}

/** Returns the last-applied transform dict (or null) -- mirrors the oracle accessor. */
LzSprite.prototype.getColorTransform = function () {
    return this.__colortransformRaw || null;
}

// ---------------------------------------------------------------------------
//  Tint helpers (called by LzCanvasPainter.__paintNode)
// ---------------------------------------------------------------------------
/**
  * Compose two diagonal transforms into one: apply `inner` first, then `outer` (the CSS/SVG
  * cascade order — an element is rendered + filtered, then its ancestor's filter applies to the
  * result). Per channel: outer(inner(v)) = mo*(mi*v+oi)+oo = (mo*mi)*v + (mo*oi+oo). A null
  * argument is the identity, so compose(a,null)=a and compose(null,b)=b.
  */
LzSprite.__ctCompose = function (outer, inner) {
    if (!outer) return inner || null;
    if (!inner) return outer;
    return {
        rm: outer.rm * inner.rm, ro: outer.rm * inner.ro + outer.ro,
        gm: outer.gm * inner.gm, go: outer.gm * inner.go + outer.go,
        bm: outer.bm * inner.bm, bo: outer.bm * inner.bo + outer.bo,
        am: outer.am * inner.am, ao: outer.am * inner.ao + outer.ao
    };
}

LzSprite.__ctKey = function (ct) {
    return ct.rm + '_' + ct.ro + '_' + ct.gm + '_' + ct.go + '_' +
           ct.bm + '_' + ct.bo + '_' + ct.am + '_' + ct.ao;
}

// Cache of tinted bitmaps, keyed by (image url | transform signature). The Calendar reuses each
// dragbar/badge PNG for every event, and the tint is one of a few fixed dictionaries, so the
// tinted canvas is built once and reused.
LzSprite.__ctTintCache = {};

/**
  * Return a canvas holding `img` recolored by the diagonal transform `ct` (cached). Falls back
  * to the untinted image if the bitmap can't be read (e.g. a cross-origin taint) or has no size.
  * The returned canvas is the SAME natural pixel size as the source, so the painter can draw it
  * through the identical stretch / pixel-snap path -> geometry/AA unchanged, color transformed.
  */
LzSprite.__tintImage = function (img, ct) {
    if (!img) return img;
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) return img;
    var key = (img.src || '') + '|' + LzSprite.__ctKey(ct);
    var cached = LzSprite.__ctTintCache[key];
    if (cached) return cached;
    var oc, octx;
    try {
        oc = document.createElement('canvas');
        oc.width = iw; oc.height = ih;
        octx = oc.getContext('2d');
        octx.drawImage(img, 0, 0, iw, ih);
        var im = octx.getImageData(0, 0, iw, ih);
        var d = im.data, n = d.length;
        var rm = ct.rm, ro = ct.ro, gm = ct.gm, go = ct.go, bm = ct.bm, bo = ct.bo, am = ct.am, ao = ct.ao;
        for (var i = 0; i < n; i += 4) {
            // Uint8ClampedArray assignment clamps to 0..255 and rounds to nearest — the same
            // quantization feColorMatrix's sRGB result undergoes.
            d[i]   = rm * d[i]   + ro;
            d[i+1] = gm * d[i+1] + go;
            d[i+2] = bm * d[i+2] + bo;
            d[i+3] = am * d[i+3] + ao;
        }
        octx.putImageData(im, 0, 0);
    } catch (e) {
        return img;   // tainted/unreadable -> draw untinted (no throw, boot-safe)
    }
    LzSprite.__ctTintCache[key] = oc;
    return oc;
}

/** Transform a solid fill color (24-bit RGB int) by `ct`, returning a CSS rgb() string. Used for
  * the bgcolor of a NON-resource sprite (the oracle tints __LZdiv, which carries the bgcolor). */
LzSprite.__ctColor = function (rgbInt, ct) {
    var c = rgbInt & 0xFFFFFF;
    var r = (c >> 16) & 0xFF, g = (c >> 8) & 0xFF, b = c & 0xFF;
    r = ct.rm * r + ct.ro; g = ct.gm * g + ct.go; b = ct.bm * b + ct.bo;
    r = r < 0 ? 0 : (r > 255 ? 255 : Math.round(r));
    g = g < 0 ? 0 : (g > 255 ? 255 : Math.round(g));
    b = b < 0 ? 0 : (b > 255 ? 255 : Math.round(b));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
}

// Flip the capability on so LaszloView's colortransform setter / setColorTransform alias /
// getColorTransform / tintcolor take the REAL path instead of warning. The view shares this
// very object (LaszloView sets `this.capabilities = this.sprite.capabilities`), and the core
// exposes the same object as LzSprite.capabilities (static) — both see the flip.
if (LzSprite.prototype.capabilities) LzSprite.prototype.capabilities.colortransform = true;

}
