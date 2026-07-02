/* -*- mode: JavaScript; c-basic-offset: 4; -*- */

/**
  * LzSprite.js  (CANVAS kernel — CORE)
  *
  * Own-pixels (Canvas 2D) backend for the LFC. The DHTML LzSprite maps every view
  * to a tree of absolutely-positioned <div>s; this canvas LzSprite keeps the view
  * tree as lightweight in-memory NODES and paints the whole scene to ONE shared
  * <canvas> with the painter's algorithm (back-to-front by z) on a dirty bit.
  *
  * This file is the CORE: the constructor, the prototype defaults / quirks /
  * capabilities, and the view-facing ~140-method contract (geometry, bgcolor,
  * opacity, clip, visible, z-order, lifecycle). The heavy concerns are split into
  * sibling modules that extend this same `LzSprite` (included after this file):
  *   - LzCanvasPainter.js   scene compositor: __markDirty / __repaint / __paintNode.
  *   - LzCanvasHitTest.js   __hitNode / __hitTestPage (geometry, reverse-z walk).
  *   - LzCanvasInput.js     DOM mouse -> hit-test -> event model; getMouse / __getPos.
  *   - LzCanvasResource.js  setResource / setSource / multi-frame / image cache / stretch.
  * The core only ever calls `LzSprite.__markDirty()` (painter) and, in the root ctor,
  * `LzSprite.__attachInput()` (input) — it knows nothing of how pixels reach the
  * screen or how events are routed.
  *
  * Contract mirrors kernel/dhtml/LzSprite.js (the readable reference). Views only
  * call this.sprite.<method>() — they never reach into sprite internals.
  *
  * @topic Kernel
  * @subtopic Canvas
  */

{
#pragma "warnUndefinedReferences=false"

// ---------------------------------------------------------------------------
//  Constructor
// ---------------------------------------------------------------------------
var LzSprite = function(owner, isroot) {
    // Prototype-chain setup (LzTextSprite.prototype = new LzSprite(null)) passes null.
    if (owner == null) return;
    this.constructor = arguments.callee;
    this.owner = owner;
    this.uid = LzSprite.prototype.uid++;
    this.__children = null;
    this.__csscache = {};

    if (isroot) {
        this.isroot = true;
        LzSprite.__rootSprite = this;

        // Values stashed by lz.embed.dhtml()
        var p = lz.embed.__propcache;
        var appenddiv = LzSprite.__rootSpriteContainer = p.appenddiv;
        appenddiv.style.margin = 0;
        appenddiv.style.padding = 0;
        appenddiv.style.border = "0 none";
        appenddiv.style.overflow = "hidden";

        // The one shared own-pixels surface.
        var c = document.createElement('canvas');
        c.className = 'lzcanvas';
        c.style.position = 'absolute';
        c.style.left = '0px';
        c.style.top = '0px';
        var w = parseInt(p.width, 10);  if (isNaN(w)) w = appenddiv.offsetWidth  || 0;
        var h = parseInt(p.height, 10); if (isNaN(h)) h = appenddiv.offsetHeight || 0;
        // HiDPI: the backing store is sized in PHYSICAL device pixels (logical * dpr)
        // while the CSS box stays logical, and the painter applies a base ctx.scale(dpr)
        // so all drawing rasterizes at device resolution (crisp text on Retina). LOGICAL
        // coordinates (geometry/layout/hit-testing) are unchanged — dpr lives below them.
        // At dpr=1 this is a no-op (backing store == CSS size, base transform == identity).
        var dpr = LzSprite.__dpr = (window.devicePixelRatio || 1);
        c.width = Math.round(w * dpr);  c.height = Math.round(h * dpr);
        c.style.width = w + 'px'; c.style.height = h + 'px';
        appenddiv.appendChild(c);

        LzSprite.__canvasEl = c;
        LzSprite.__ctx = c.getContext('2d');
        this.width = w;  this.height = h;  this.x = 0;  this.y = 0;

        // INPUT: route real DOM mouse events on the <canvas> through the
        // hit-tester into the existing platform-agnostic event model (LzMouseKernel
        // -> LzModeManager.rawMouseEvent -> view.mouseevent). See LzCanvasInput.js.
        LzSprite.__attachInput(c);

        if (p.id)  this._id  = p.id;
        if (p.url) this._url = p.url;
        var options = this.options = p.options;
        if (options) LzSprite.blankimage = (options.serverroot || '') + LzSprite.blankimage;
        // page bgcolor lives behind the canvas; the canvas itself starts transparent
        if (p.bgcolor) this.__pagebg = p.bgcolor;

        // Text-measurement scratch div (no-op in the canvas font manager stub)
        if (typeof LzFontManager != 'undefined' && LzFontManager.__createContainerDiv) {
            LzFontManager.__createContainerDiv();
        }
        // Root + options now exist: load any embedded fonts that were queued during library
        // init (getBaseUrl needs the root's serverroot/approot to resolve the TTF URL).
        if (typeof LzFontManager != 'undefined' && LzFontManager.__flushFonts) {
            LzFontManager.__flushFonts();
        }
        // Track dpr changes (browser zoom / moving the window to a display with a
        // different pixel density): re-read devicePixelRatio, re-scale the backing store
        // to the current LOGICAL size, and repaint. Cheap one-shot listener (no-op at 1x).
        LzSprite.__installDprListener();
        LzSprite.__markDirty();
    }
    // non-root sprites are pure data nodes — nothing to allocate
}

// Re-arm a matchMedia 'resolution' listener each time dpr changes (the query is
// dpr-specific, so it must be re-registered). On change: recompute __dpr, re-size the
// backing store for the current logical root size, repaint. Logical coords are untouched.
LzSprite.__installDprListener = function () {
    if (typeof window == 'undefined' || !window.matchMedia) return;
    var arm = function () {
        var cur = window.devicePixelRatio || 1;
        var mql;
        try { mql = window.matchMedia('(resolution: ' + cur + 'dppx)'); } catch (e) { return; }
        var on = function () {
            LzSprite.__dpr = window.devicePixelRatio || 1;
            var r = LzSprite.__rootSprite;
            if (r) { LzSprite.setRootWidth(r.width | 0); LzSprite.setRootHeight(r.height | 0); }
            LzSprite.__markDirty();
            arm();   // re-register for the NEW dpr
        };
        if (mql.addEventListener) mql.addEventListener('change', on, { once: true });
        else if (mql.addListener) mql.addListener(on);   // legacy
    };
    arm();
}

// ---------------------------------------------------------------------------
//  Defaults  (read by the LFC core)
// ---------------------------------------------------------------------------
LzSprite.prototype.uid = 0;
LzSprite.prototype.x = null;
LzSprite.prototype.y = null;
LzSprite.prototype.xoffset = 0;
LzSprite.prototype.yoffset = 0;
LzSprite.prototype._xoffset = 0;
LzSprite.prototype._yoffset = 0;
LzSprite.prototype.width = null;
LzSprite.prototype.height = null;
LzSprite.prototype.opacity = 1;
LzSprite.prototype.visible = true;
LzSprite.prototype.clip = null;
LzSprite.prototype.bgcolor = null;
LzSprite.prototype.source = null;
LzSprite.prototype.resource = null;
LzSprite.prototype.stretches = null;
LzSprite.prototype.rotation = 0;
LzSprite.prototype.xscale = 1;
LzSprite.prototype.yscale = 1;
LzSprite.prototype.cornerradius = null;
LzSprite.prototype.__cornerradii = null;   // parsed [tl,tr,br,bl] px for the painter
LzSprite.prototype.frame = 1;
LzSprite.prototype.frames = null;
LzSprite.prototype.playing = false;
LzSprite.prototype.clickable = false;
LzSprite.prototype.cursor = null;
LzSprite.prototype.initted = false;
LzSprite.prototype.loading = false;
LzSprite.prototype.borderwidth = 0;
LzSprite.prototype.__z = 0;
LzSprite.prototype.__topZ = 1;
LzSprite.prototype.__parent = null;
LzSprite.prototype.__children = null;
LzSprite.prototype.__img = null;
LzSprite.prototype.__imgloaded = false;
LzSprite.blankimage = 'lps/includes/blank.gif';

// CSSDimension comes from kernel/LzKernelUtils.lzs (already included). Some core
// paths call sprite.CSSDimension(); keep the same binding the dhtml kernel uses.
LzSprite.prototype.CSSDimension = LzKernelUtils.CSSDimension;

// dhtml writes a stylesheet here; canvas needs none.
LzSprite.__defaultStyles = { writeCSS: function () {} };
LzSprite.__styleNames = {};

// quirks + capabilities: copied from the dhtml kernel so the core's quirk/capability
// probes get sane values. Canvas-relevant overrides: no CSS sprite-sheets; we own pixels.
LzSprite.quirks = {
    fix_clickable: false
    ,fix_contextmenu: false
    ,css_hide_canvas_during_init: false
    ,size_blank_to_zero: false
    ,activate_on_mouseover: false
    ,listen_for_mouseover_out: false
    ,focus_on_mouseover: false
    ,prevent_selection: false
    ,use_css_sprites: false
    ,use_css_master_sprite: false
    ,preload_images: false
    ,preload_images_only_once: false
    ,ie_leak_prevention: false
    ,ie_timer_closure: false
    ,scrollbar_width: 15
    ,container_divs_require_overflow: false
    ,canvas_div_cannot_be_clipped: false
    ,emulate_flash_font_metrics: true
    ,hasmetakey: true
    ,text_event_charcode: true
    ,keypress_function_keys: true
}

LzSprite.prototype.capabilities = {
    rotation: true
    ,scalecanvastopercentage: false
    ,readcanvassizefromsprite: true
    ,opacity: true
    ,colortransform: false
    ,audio: false
    ,accessibility: false
    ,htmlinputtext: false
    ,advancedfonts: false
    ,bitmapcaching: false
    ,persistence: false
    ,clickregion: false
    ,minimize_opacity_changes: false
    ,history: true
    ,runtimemenus: false
    ,setclipboard: false
    ,proxypolicy: false
    ,linescrolling: false
    ,allowfullscreen: false
    ,setid: true
    ,globalfocustrap: false
    ,'2dcanvas': true
    ,dropshadows: false
    ,cornerradius: true
    ,rgba: true
    ,css2boxmodel: true
    ,medialoading: true
    ,backgroundrepeat: false
    ,touchevents: false
    ,directional_layout: false
    ,scaling: true
    ,customcontextmenu: false
}
// no-op: quirks are static for the canvas backend
LzSprite.__updateQuirks = function () {}

// ---------------------------------------------------------------------------
//  Color helper (shared by LzCanvasPainter + LzTextSprite)
// ---------------------------------------------------------------------------
LzSprite.__torgb = function (c) {
    if (c == null) return null;
    c = c & 0xFFFFFF;
    var r = (c >> 16) & 0xFF, g = (c >> 8) & 0xFF, b = c & 0xFF;
    return 'rgb(' + r + ',' + g + ',' + b + ')';
}

// z-order comparator shared by the painter (back-to-front) + hit-tester (front-to-back).
LzSprite.__zCompareFn = function (a, b) {
    return (a.__z | 0) - (b.__z | 0);
}

// ===========================================================================
//  CORE methods (real) — the view-facing contract
// ===========================================================================
/** Called when the sprite should show itself (owner finished initializing). */
LzSprite.prototype.init = function (v) {
    this.setVisible(v);
    if (this.isroot) {
        if (this._id) lz.embed[this._id]._ready(this.owner);
    }
    this.initted = true;
    LzSprite.__markDirty();
}

LzSprite.prototype.addChildSprite = function (sprite) {
    if (sprite.__parent != null) return;
    sprite.__parent = this;
    if (this.__children) this.__children.push(sprite);
    else this.__children = [sprite];
    sprite.__setZ(++this.__topZ);
    LzSprite.__markDirty();
}

LzSprite.prototype.setX = function (x) {
    if (x == null || (x == this.x && this._xoffset == this.xoffset)) return;
    this._xoffset = this.xoffset;
    this.x = x;
    if (this.isroot) LzSprite.setRootX(x + this.xoffset);
    LzSprite.__markDirty();
}

LzSprite.prototype.setY = function (y) {
    if (y == null || (y == this.y && this._yoffset == this.yoffset)) return;
    this._yoffset = this.yoffset;
    this.y = y;
    if (this.isroot) LzSprite.setRootY(y + this.yoffset);
    LzSprite.__markDirty();
}

LzSprite.prototype.setWidth = function (w) {
    if (w < 0 || this.width == w) return;
    this.width = w;
    if (this.isroot) LzSprite.setRootWidth(w);
    if (this.clip) this.__updateClip();
    LzSprite.__markDirty();
}

LzSprite.prototype.setHeight = function (h) {
    if (h < 0 || this.height == h) return;
    this.height = h;
    if (this.isroot) LzSprite.setRootHeight(h);
    if (this.clip) this.__updateClip();
    LzSprite.__markDirty();
}

LzSprite.prototype.setVisible = function (v) {
    if (this.visible === v) return;
    this.visible = v;
    LzSprite.__markDirty();
}

LzSprite.prototype.setBGColor = function (c) {
    if (c != null && !this.capabilities.rgba) c = c | 0;
    if (this.bgcolor == c) return;
    this.bgcolor = c;
    LzSprite.__markDirty();
}

LzSprite.prototype.setOpacity = function (o) {
    if (this.opacity == o || o < 0) return;
    this.opacity = o;
    LzSprite.__markDirty();
}

LzSprite.prototype._clip = '';
LzSprite.prototype.setClip = function (c) {
    if (this.clip === c) return;
    this.clip = c;
    this.__updateClip();
}
LzSprite.prototype.__updateClip = function () {
    // canvas clips to the node's own (width,height) bounds at paint time; just
    // record that a clip is active and request a repaint.
    this._clip = this.clip ? 'rect' : '';
    LzSprite.__markDirty();
}

LzSprite.prototype.setRotation = function (r) {
    if (this.rotation == r) return;
    this.rotation = r;
    LzSprite.__markDirty();
}

LzSprite.prototype.setXScale = function (s) {
    if (this.xscale == s) return;
    this.xscale = s;
    LzSprite.__markDirty();
}
LzSprite.prototype.setYScale = function (s) {
    if (this.yscale == s) return;
    this.yscale = s;
    LzSprite.__markDirty();
}

// radii = [tl, tr, br, bl] numeric px (from LaszloView.$lzc$set_cornerradius). Mirror the
// dhtml kernel: keep the joined CSS string in `cornerradius` (parity reads), and a numeric
// array `__cornerradii` the painter uses for the rounded-rect bg fill + clip path. A view
// that never sets cornerradius keeps __cornerradii=null and paints square (AE-neutral).
LzSprite.prototype.setCornerRadius = function (radii) {
    if (radii == null) {
        if (this.cornerradius == null) return;
        this.cornerradius = null; this.__cornerradii = null;
        LzSprite.__markDirty();
        return;
    }
    var css = [];
    for (var i = 0; i < radii.length; i++) css[i] = this.CSSDimension(radii[i]);
    css = css.join(' ');
    if (css == this.cornerradius) return;
    this.cornerradius = css;
    this.__cornerradii = [ (+radii[0] || 0), (+radii[1] || 0), (+radii[2] || 0), (+radii[3] || 0) ];
    LzSprite.__markDirty();
}

// --- z-order ---
LzSprite.prototype.__setZ = function (z) {
    this.__z = z;
    LzSprite.__markDirty();
}
LzSprite.prototype.getZ = function () { return this.__z; }
LzSprite.prototype.__zCompare = function (a, b) { return (a.__z | 0) - (b.__z | 0); }

LzSprite.prototype.bringToFront = function () {
    if (!this.__parent) return;
    this.__setZ(++this.__parent.__topZ);
}
LzSprite.prototype.sendToBack = function () {
    if (!this.__parent) return;
    var c = this.__parent.__children, min = 0;
    for (var i = 0; i < c.length; i++) if (c[i].__z < min) min = c[i].__z;
    this.__setZ(min - 1);
}
LzSprite.prototype.sendBehind = function (other) {
    if (!other || other === this) return;
    this.__setZ(other.__z - 0.5);
}
LzSprite.prototype.sendInFrontOf = function (other) {
    if (!other || other === this) return;
    this.__setZ(other.__z + 0.5);
}

LzSprite.prototype.getWidth = function () { return this.width || 0; }
LzSprite.prototype.getHeight = function () { return this.height || 0; }

LzSprite.prototype.destroy = function (parentvalid) {
    var p = this.__parent;
    if (p && p.__children) {
        var c = p.__children;
        for (var i = 0; i < c.length; i++) if (c[i] === this) { c.splice(i, 1); break; }
    }
    this.__parent = null;
    this.__children = null;
    this.__img = null;
    LzSprite.__markDirty();
}
LzSprite.prototype.predestroy = function () {}

// --- static root-surface geometry (canvas element) ---
LzSprite.setRootX = function (v) { if (LzSprite.__canvasEl) LzSprite.__canvasEl.style.left = (v | 0) + 'px'; }
LzSprite.setRootY = function (v) { if (LzSprite.__canvasEl) LzSprite.__canvasEl.style.top  = (v | 0) + 'px'; }
// A `<canvas width="100%">` app binds its width via the style constraint, so
// setRootWidth is called with a PERCENTAGE STRING (e.g. "100%"), not a number. The DHTML
// kernel writes that CSS onto the container div and re-reads its resolved pixel box; here
// the container is already sized by lz.embed, so resolve the % against its offset box into
// the concrete backing-store pixels a canvas needs. A numeric value keeps the prior path
// byte-for-byte (fixed-size apps like the calendar are unaffected).
LzSprite.__resolveRootPct = function (v, extent) {
    if (typeof v === 'string' && v.indexOf('%') >= 0) {
        var c = LzSprite.__rootSpriteContainer;
        return Math.round((c ? (c[extent] || 0) : 0) * (parseFloat(v) / 100));
    }
    return v;
}
// devnote: `canvas.width`/`canvas.height` (the LZX view attribute, read by every
// `${canvas.width}` constraint) are NOT set here -- they come from LzScreenKernel's
// __resizeEvent, which measures `LzSprite.__rootSpriteContainer` (the lz.embed
// appenddiv), the SAME shared kernel-agnostic path the dhtml kernel uses. So a
// percentage canvas width MUST also be reflected onto the container's own box --
// otherwise the bitmap resizes correctly (below) but canvas.width still reports the
// container's original (un-shrunk) size, diverging from dhtml.
//
// Mirror dhtml's own setRootWidth (kernel/dhtml/LzSprite.js): after resizing the
// container it schedules `setTimeout(LzScreenKernel.__resizeEvent, 0)` -- "simulate
// a resize event so canvas sprite size gets updated". That deferred re-measurement
// is load-bearing, not cosmetic: LzScreenKernel.setCallback() (called earlier, from
// LzCanvas.construct()) already fired __resizeEvent ONCE synchronously against the
// container's PRE-resize box, latching the wrong (un-shrunk) canvas.width. Only
// this later, deferred call -- which runs after the whole view tree (and any
// onwidth/onx delegates registered on canvas.width) is constructed -- corrects it,
// which is also why percentage-width apps only become fully consistent one tick
// after construction in both kernels.
LzSprite.setRootWidth = function (v) {
    var el = LzSprite.__canvasEl; if (!el) return;
    v = LzSprite.__resolveRootPct(v, 'offsetWidth') | 0;
    var bw = Math.round(v * (LzSprite.__dpr || 1));
    if (el.width != bw) el.width = bw; el.style.width = v + 'px';
    var container = LzSprite.__rootSpriteContainer;
    if (container) container.style.width = v + 'px';
    if (LzSprite.__rootSprite) LzSprite.__rootSprite.width = v;
    LzSprite.__markDirty();
    if (typeof LzScreenKernel !== 'undefined') setTimeout(LzScreenKernel.__resizeEvent, 0);
}
LzSprite.setRootHeight = function (v) {
    var el = LzSprite.__canvasEl; if (!el) return;
    v = LzSprite.__resolveRootPct(v, 'offsetHeight') | 0;
    var bh = Math.round(v * (LzSprite.__dpr || 1));
    if (el.height != bh) el.height = bh; el.style.height = v + 'px';
    var container = LzSprite.__rootSpriteContainer;
    if (container) container.style.height = v + 'px';
    if (LzSprite.__rootSprite) LzSprite.__rootSprite.height = v;
    LzSprite.__markDirty();
    if (typeof LzScreenKernel !== 'undefined') setTimeout(LzScreenKernel.__resizeEvent, 0);
}

// ===========================================================================
//  Deferred / no-op long tail (so the LFC BOOTS; grown in later phases)
//   - accessibility:              setAA*, aafocus, sendAAEvent
//   - visual extras:              filter, colortransform, shadow, border, backgroundrepeat
//  (clickable/cursor/contextmenu -> LzCanvasInput.js; resource stretch -> LzCanvasResource.js;
//   <drawview>'s getContext/setContextCallback -> LzDrawContext.js, record/replay proxy)
// ===========================================================================
LzSprite.prototype.getDisplayObject = function () { return this; }
LzSprite.prototype.setMaxLength = function (v) {}
LzSprite.prototype.setPattern = function (v) {}
LzSprite.prototype.setFilter = function (name, value) { return ''; }
LzSprite.prototype.setColorTransform = function () {}
LzSprite.prototype.setBackgroundRepeat = function (v) {}
LzSprite.prototype.updateShadow = function () {}
LzSprite.prototype.set_borderColor = function (c) {}
LzSprite.prototype.set_borderWidth = function (w) {}
LzSprite.prototype.set_padding = function (p) {}
LzSprite.prototype.setID = function (id) { this._setid = id; }
LzSprite.prototype.setAADescription = function (s) {}
LzSprite.prototype.setAccessible = function (a) {}
LzSprite.prototype.setAAActive = function (s) {}
LzSprite.prototype.setAASilent = function (s) {}
LzSprite.prototype.setAAName = function (s) {}
LzSprite.prototype.setAATabIndex = function (s) {}
LzSprite.prototype.sendAAEvent = function () {}
LzSprite.prototype.aafocus = function () {}
LzSprite.prototype.getSelectedText = function () { return ''; }
LzSprite.prototype.setCSS = function (name, value, isdimension) {}
LzSprite.prototype.applyCSS = function (name, value, divname) {}
LzSprite.prototype.__discardElement = function (el) {}

// --- media-load timeouts (statics read by the core at load time) ---
LzSprite.medialoadtimeout = 30000;
LzSprite.mediaerrortimeout = 30000;
LzSprite.setMediaLoadTimeout = function (ms) { LzSprite.medialoadtimeout = ms; }
LzSprite.setMediaErrorTimeout = function (ms) { LzSprite.mediaerrortimeout = ms; }

// the core reads LzSprite.capabilities (static) as well as the prototype copy
LzSprite.capabilities = LzSprite.prototype.capabilities;

// Expose for the AE validation loop / debugging (lz.__LzSprite.__repaint()).
if (typeof lz != 'undefined' && lz) lz.__LzSprite = LzSprite;

// --- audio / video / colortransform / bitmap-cache (deferred — no-op stubs) ---
LzSprite.prototype.getColorTransform = function () { return null; }
LzSprite.prototype.setBitmapCache = function () {}
LzSprite.prototype.setClickRegion = function () {}
LzSprite.prototype.isaudio = function () { return false; }
LzSprite.prototype.seek = function (t) {}
LzSprite.prototype.getCurrentTime = function () { return 0; }
LzSprite.prototype.getTotalTime = function () { return 0; }
LzSprite.prototype.getID3 = function () { return null; }
LzSprite.prototype.setVolume = function (v) {}
LzSprite.prototype.getVolume = function () { return 100; }
LzSprite.prototype.setPan = function (p) {}
LzSprite.prototype.getPan = function () { return 0; }

}
