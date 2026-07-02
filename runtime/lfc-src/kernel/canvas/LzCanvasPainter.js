/* -*- mode: JavaScript; c-basic-offset: 4; -*- */

/**
  * LzCanvasPainter.js  (CANVAS kernel)
  *
  * Scene compositor for the own-pixels canvas kernel. Owns the rAF scheduler + dirty
  * bit and the full-scene back-to-front (painter's-algorithm) walk that redraws the
  * WHOLE view tree to the one shared <canvas> whenever anything changes.
  *
  * Seam with LzSprite (core): the core's view-facing setters call `LzSprite.__markDirty()`
  * to request a frame; nothing else in the core knows how pixels reach the screen. Text
  * sprites hook in via the `__paintFG(ctx,w,h)` method (called inside each node's
  * transform/clip). The z-order comparator `LzSprite.__zCompareFn` lives in the core
  * (z-order is part of the view contract) and is shared with the hit-tester.
  *
  * @topic Kernel
  * @subtopic Canvas
  */

{
#pragma "warnUndefinedReferences=false"

// ===========================================================================
//  RENDER LOOP — full-scene redraw on a dirty bit (painter's algorithm)
// ===========================================================================
LzSprite.__dirty = false;
LzSprite.__rafPending = false;
LzSprite.__raf = (typeof requestAnimationFrame != 'undefined')
    ? function (cb) { return requestAnimationFrame(cb); }
    : function (cb) { return setTimeout(cb, 16); };

LzSprite.__markDirty = function () {
    LzSprite.__dirty = true;
    if (LzSprite.__rafPending || !LzSprite.__ctx) return;
    LzSprite.__rafPending = true;
    LzSprite.__raf(LzSprite.__repaint);
}

LzSprite.__repaint = function () {
    LzSprite.__rafPending = false;
    LzSprite.__dirty = false;
    var ctx = LzSprite.__ctx, root = LzSprite.__rootSprite;
    if (!ctx || !root) return;
    var el = LzSprite.__canvasEl;
    // clear the whole DEVICE-pixel backing store, then install the HiDPI base transform:
    // a uniform scale(dpr,dpr) so the entire scene walk draws in LOGICAL coordinates yet
    // rasterizes at physical resolution (crisp fillText on Retina). dpr=1 => identity.
    var dpr = LzSprite.__dpr || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, el.width, el.height);
    if (dpr != 1) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    LzSprite.__paintNode(root, ctx, 1);
}

// Build a rounded-rect sub-path on ctx (does NOT fill/clip — caller does). r = the
// sprite's parsed [tl,tr,br,bl] px radii. Matches CSS border-radius corner order; the
// browser auto-clamps over-large radii to the box, and so does ctx.roundRect.
LzSprite.__roundRectPath = function (ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    // fallback for engines without roundRect: arcs per corner, clamped to half-box.
    var m = Math.min(w, h) / 2;
    var tl = Math.min(r[0], m), tr = Math.min(r[1], m), br = Math.min(r[2], m), bl = Math.min(r[3], m);
    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.arcTo(x + w, y,     x + w, y + h, tr);
    ctx.arcTo(x + w, y + h, x,     y + h, br);
    ctx.arcTo(x,     y + h, x,     y,     bl);
    ctx.arcTo(x,     y,     x + w, y,     tl);
    ctx.closePath();
}

// `inCt` = the inherited colortransform cascading from ancestors (a DHTML CSS/SVG filter on a
// plain __LZdiv visually tints all descendant content). null at the root.
LzSprite.__paintNode = function (s, ctx, alpha, inCt) {
    if (s.visible === false) return;
    var a = alpha * (s.opacity == null ? 1 : s.opacity);
    if (a <= 0) return;
    ctx.save();
    var tx = (s.x || 0) + (s.xoffset || 0);
    var ty = (s.y || 0) + (s.yoffset || 0);
    if (tx || ty) ctx.translate(tx, ty);
    if (s.rotation) ctx.rotate(s.rotation * Math.PI / 180);
    if ((s.xscale && s.xscale != 1) || (s.yscale && s.yscale != 1)) ctx.scale(s.xscale || 1, s.yscale || 1);
    var w = s.width, h = s.height;
    var rr = s.__cornerradii;   // [tl,tr,br,bl] px when cornerradius>0, else null
    // clip: rounded-rect path when this view has cornerradius (matches dhtml border-radius
    // + overflow:hidden), else the plain rect. AE-neutral for square views (rr null).
    if (s.clip && w >= 0 && h >= 0) {
        if (rr) LzSprite.__roundRectPath(ctx, 0, 0, w, h, rr);
        else { ctx.beginPath(); ctx.rect(0, 0, w, h); }
        ctx.clip();
    }
    ctx.globalAlpha = a;
    // colortransform (Flash ColorTransform): the oracle applies an SVG feColorMatrix to
    // `__LZimg || __LZdiv`. When a sprite HAS a resource image, its OWN filter sits on __LZimg
    // (tints the image only; bgcolor + children are unaffected by it). When it has NO image, its
    // OWN filter sits on __LZdiv and CASCADES to bgcolor + descendants. An ancestor's filter
    // (`inCt`) always cascades through this node's __LZdiv onto its content + children. Logic +
    // compose/tint math live in LzCanvasColorTransform.js.
    var own = s.__colortransform;     // this sprite's own transform, or null
    var hasImg = s.__img && s.__imgloaded;
    // ct on the IMAGE = ancestor cascade composed with this sprite's own __LZimg filter.
    var imgCt = LzSprite.__ctCompose(inCt, own);
    // ct on the __LZdiv (bgcolor) + what cascades to children: ancestor cascade, plus this
    // sprite's own filter ONLY when it lives on __LZdiv (i.e. this sprite has no image element).
    var divCt = hasImg ? inCt : LzSprite.__ctCompose(inCt, own);
    if (s.bgcolor != null && w > 0 && h > 0) {
        ctx.fillStyle = divCt ? LzSprite.__ctColor(s.bgcolor, divCt) : LzSprite.__torgb(s.bgcolor);
        if (rr) { LzSprite.__roundRectPath(ctx, 0, 0, w, h, rr); ctx.fill(); }
        else ctx.fillRect(0, 0, w, h);
    }
    if (hasImg) {
        // when tinted, draw the recolored bitmap through the IDENTICAL stretch/pixel-snap path
        // (same natural size) so only the color changes — matches the oracle's post-scale filter.
        var __drawImg = imgCt ? LzSprite.__tintImage(s.__img, imgCt) : s.__img;
        // stretch model mirrors dhtml __updateStretches: the image is drawn at the
        // RESOURCE's natural (declared) size unless an axis is stretched to fill the view.
        var rw = (s.resourceWidth  != null) ? s.resourceWidth  : s.__img.width;
        var rh = (s.resourceHeight != null) ? s.resourceHeight : s.__img.height;
        var dw, dh;
        switch (s.stretches) {
            case 'both':   dw = w;  dh = h;  break;
            case 'width':  dw = w;  dh = rh; break;
            case 'height': dw = rw; dh = h;  break;
            default:       dw = rw; dh = rh; break;
        }
        // Browsers PIXEL-SNAP an unscaled <img> to the device-pixel grid (crisp); canvas
        // drawImage at a fractional offset interpolates (blurry). Match the browser by
        // rounding the translation to the DEVICE grid when the image is axis-aligned at the
        // logical 1:1 scale (the CTM diagonal == the base dpr scale; m.e/m.f are device px).
        var dpr = LzSprite.__dpr || 1;
        var m = (!s.stretches && ctx.getTransform) ? ctx.getTransform() : null;
        if (m && m.b === 0 && m.c === 0 && m.a === dpr && m.d === dpr) {
            ctx.setTransform(dpr, 0, 0, dpr, Math.round(m.e), Math.round(m.f));
            try { ctx.drawImage(__drawImg, 0, 0, dw, dh); } catch (e) {}
            ctx.setTransform(m);
        } else {
            try { ctx.drawImage(__drawImg, 0, 0, dw, dh); } catch (e) {}
        }
    }
    // foreground hook: text sprites paint their glyphs here (base sprites have none)
    if (s.__paintFG) s.__paintFG(ctx, w, h);
    var ch = s.__children;
    if (ch && ch.length) {
        // paint back-to-front by z (stable: only sort a copy)
        var sorted = ch.length > 1 ? ch.slice().sort(LzSprite.__zCompareFn) : ch;
        for (var i = 0; i < sorted.length; i++) LzSprite.__paintNode(sorted[i], ctx, a, divCt);
    }
    ctx.restore();
}

}
