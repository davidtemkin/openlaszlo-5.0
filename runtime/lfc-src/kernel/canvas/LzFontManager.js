/* -*- mode: JavaScript; c-basic-offset: 4; -*- */

/**
  * LzFontManager.js  (CANVAS kernel)
  *
  * Font registration + text measurement. Real measurement uses a shared OFF-SCREEN
  * Canvas 2D context: `ctx.font = <shorthand>; ctx.measureText(str)`. Glyph advance
  * (`.width`) drives text auto-sizing; the font-wide ascent/descent (from the same
  * TextMetrics) drive baseline placement in LzTextSprite. No scratch DOM is needed.
  *
  * `getSize(dimension, className, style, tagname, string)` keeps the dhtml signature so
  * any generic LFC caller still works (it reconstructs a font shorthand from the CSS
  * `style` string and measures), but LzTextSprite calls `measure()`/`fontMetrics()`
  * directly.
  *
  * @topic Kernel
  * @subtopic Canvas
  */

{
#pragma "warnUndefinedReferences=false"

var LzFontManager = {
    fonts: {}
    ,__rootdiv: null
    ,__sizecache: { counter: 0 }
    ,__fontloadstate: { counter: 0 }
    ,__fontloadcallbacks: {}
    ,fontloadtimeout: 15000

    ,addFont: function (fontname, fontstyle, fontweight, path, ptype) {
        var key = fontname + '_' + fontstyle + '_' + fontweight;
        var font = this.fonts[key] = { name: fontname, style: fontstyle, weight: fontweight, url: path, ptype: ptype };
        // Own-pixels twist vs dhtml: a `<canvas>` renders glyphs with the DOCUMENT's font
        // set, so an EMBEDDED font (`<font src=...>`) must be loaded into the browser or
        // ctx.fillText silently falls back to a serif default. dhtml injects @font-face CSS;
        // here we load the same TTF via the FontFace API (available to every 2D context in
        // the document) and, once ready, re-measure + repaint the text (widths measured with
        // the fallback are wrong until the real metrics arrive — mirrors dhtml __fontLoaded).
        // addFont typically runs (library init) BEFORE the root sprite exists, so getBaseUrl
        // has no serverroot/approot yet — QUEUE and flush once the root is up (see __flushFonts).
        this.__fontQueue.push(font);
        this.__flushFonts();
    }
    // Flush queued fonts once the root sprite + its lz.embed options exist, so getBaseUrl
    // resolves the real serverroot/approot. Idempotent + safe to call repeatedly (the root
    // ctor calls it; so does addFont, in case fonts are declared after boot).
    ,__fontQueue: []
    ,__flushFonts: function () {
        if (!(LzSprite.__rootSprite && LzSprite.__rootSprite.options)) return;
        var q = this.__fontQueue;
        this.__fontQueue = [];
        for (var i = 0; i < q.length; i++) this.__loadFontFace(q[i]);
    }
    // @font-face string kept for the fallback CSS-injection path (older browsers w/o FontFace).
    ,generateCSS: function () {
        var out = '';
        for (var i in this.fonts) {
            var f = this.fonts[i], url = this.getURL(f);
            out += '@font-face{font-family:' + f.name + ';src:local("' + f.name + '"), url(' + url +
                   ') format("truetype");font-weight:' + f.weight + ';font-style:' + f.style + ';}';
        }
        return out;
    }
    // Full resolved URL (baseurl by ptype + declared path) — identical resolution to dhtml.
    ,getURL: function (font) {
        if (!font) return '';
        var base = (LzSprite.prototype.getBaseUrl) ? LzSprite.prototype.getBaseUrl(font) : '';
        return base + (font.url || '');
    }

    // --- embedded-font loading (FontFace API; graceful no-op if unavailable) ---
    ,__textSprites: []
    ,__pendingFonts: 0
    ,__fontStyleEl: null
    ,__registerTextSprite: function (sprite) {
        // real text sprites register so they can be re-measured when a font finishes loading
        if (sprite) this.__textSprites.push(sprite);
    }
    ,__loadFontFace: function (font) {
        if (typeof document == 'undefined' || !document.fonts || typeof FontFace == 'undefined') {
            // No FontFace API: fall back to a one-shot @font-face <style> injection.
            this.__injectFontFaceCSS(font);
            return;
        }
        var url = this.getURL(font);
        var self = this;
        var ff;
        try {
            ff = new FontFace(font.name, 'url("' + url + '") format("truetype")',
                              { weight: font.weight, style: font.style });
        } catch (e) { this.__injectFontFaceCSS(font); return; }
        document.fonts.add(ff);
        this.__pendingFonts++;
        var done = function () {
            if (--self.__pendingFonts > 0) return;   // wait for the last font, then re-flow once
            self.__metricsCache = {};
            self.__clearMeasureCache();
            var ts = self.__textSprites;
            for (var k = 0; k < ts.length; k++) { if (ts[k] && ts[k].__fontLoaded) ts[k].__fontLoaded(); }
            if (LzSprite.__markDirty) LzSprite.__markDirty();
        };
        ff.load().then(done, done);   // repaint even on failure so we don't hang the settle loop
    }
    ,__injectFontFaceCSS: function (font) {
        if (typeof document == 'undefined') return;
        var el = this.__fontStyleEl;
        if (!el) {
            el = this.__fontStyleEl = document.createElement('style');
            el.type = 'text/css';
            (document.getElementsByTagName('head')[0] || document.documentElement).appendChild(el);
        }
        var url = this.getURL(font);
        el.appendChild(document.createTextNode(
            '@font-face{font-family:' + font.name + ';src:local("' + font.name + '"), url(' + url +
            ') format("truetype");font-weight:' + font.weight + ';font-style:' + font.style + ';}'));
    }
    // Client (platform) fonts are always "loaded"; embedded fonts re-flow via __fontLoaded
    // above, so from the LFC's point of view sizing is never blocked.
    ,isFontLoaded: function (sprite, fontname, fontstyle, fontweight) { return true; }
    ,__createContainerDiv: function () { /* no scratch DOM needed for canvas */ }
    ,__clearMeasureCache: function () { this.__metricsCache = {}; }
    ,__measurefontdiv: function () {}
    ,__createMeasureDiv: function () { return null; }
    ,__setTextContent: function () {}
    ,__fontLoaded: function () {}

    // --- shared off-screen measuring context ---
    ,__mctx: null
    ,__getMeasureCtx: function () {
        if (!this.__mctx) {
            var c = (typeof document != 'undefined') ? document.createElement('canvas') : null;
            this.__mctx = c ? c.getContext('2d') : null;
        }
        return this.__mctx;
    }

    // Measure a string with the given canvas font shorthand (+ optional letter-spacing
    // in px). Returns the TextMetrics (or a {width:0} fallback if no 2D context).
    // NOTE: letterSpacing is always (re)set so it never leaks between callers.
    ,measure: function (fontString, string, letterSpacing) {
        var ctx = this.__getMeasureCtx();
        if (!ctx) return { width: 0 };
        ctx.font = fontString;
        if ('letterSpacing' in ctx) ctx.letterSpacing = (letterSpacing || 0) + 'px';
        return ctx.measureText(string == null ? '' : String(string));
    }

    // Font-wide ascent/descent (constant per font+size), cached by font shorthand.
    // Uses fontBoundingBox* from measureText, which matches the content area Chrome
    // uses for CSS line layout, so baselines line up with the DHTML text divs.
    ,__metricsCache: {}
    ,fontMetrics: function (fontString) {
        var c = this.__metricsCache[fontString];
        if (c) return c;
        var m = this.measure(fontString, 'Hg');
        var a = (m && m.fontBoundingBoxAscent  != null) ? m.fontBoundingBoxAscent  : null;
        var d = (m && m.fontBoundingBoxDescent != null) ? m.fontBoundingBoxDescent : null;
        return (this.__metricsCache[fontString] = { ascent: a, descent: d });
    }

    // --- dhtml-signature compatibility shim (rebuild a font shorthand from CSS style) ---
    ,getSize: function (dimension, className, style, tagname, string) {
        var fontString = this.__styleToFont(style);
        var out = {};
        var fs = this.__pxFromStyle(style, 'font-size') || 11;
        if (dimension == 'width') {
            out.width = Math.ceil(this.measure(fontString, string).width);
        } else {
            // height / lineheight: emulate_flash uses 1.2em
            out[dimension] = Math.round(fs * 1.2);
        }
        return out;
    }
    ,__pxFromStyle: function (style, prop) {
        if (!style) return null;
        var m = new RegExp(prop + '\\s*:\\s*([0-9.]+)px').exec(style);
        return m ? parseFloat(m[1]) : null;
    }
    ,__styleToFont: function (style) {
        style = style || '';
        var trimRe = new RegExp('\\s+$');
        var grab = function (prop) {
            var m = new RegExp(prop + '\\s*:\\s*([^;]+)').exec(style);
            return m ? m[1].replace(trimRe, '') : null;
        };
        var fstyle  = grab('font-style');
        var fweight = grab('font-weight');
        var fsize   = grab('font-size') || '11px';
        var ffam    = grab('font-family') || 'Verdana,Vera,sans-serif';
        var s = '';
        if (fstyle  && fstyle  != 'normal') s += fstyle  + ' ';
        if (fweight && fweight != 'normal') s += fweight + ' ';
        s += fsize + ' ' + ffam;
        return s;
    }
}

}
