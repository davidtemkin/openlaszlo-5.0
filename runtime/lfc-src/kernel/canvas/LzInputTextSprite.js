/* -*- mode: JavaScript; c-basic-offset: 4; -*- */

/**
  * LzInputTextSprite.js  (CANVAS kernel — static-canvas-text + ONE shared DOM overlay)
  *
  * An <inputtext>/<edittext> field needs a real editable DOM control for the caret,
  * selection and IME, but Canvas 2D owns its pixels. The dhtml kernel gives EVERY field
  * its own permanent DOM <input>/<textarea>; the canvas kernel used to do the same, which
  * cost N always-present overlays AND leaked them visually ABOVE canvas-drawn content
  * (a DOM element can never be occluded by canvas pixels — e.g. a floating window drawn on
  * the canvas could not cover a field behind it).
  *
  * NEW MODEL:
  *   - UNFOCUSED  => NO DOM element. The field's current text is drawn as STATIC canvas
  *     text through the same path LzTextSprite uses (this __paintFG override), so it
  *     composites/occludes correctly with the rest of the scene. The box/border/bg keep
  *     painting on the canvas as before. Password fields draw masked bullets.
  *   - FOCUSED    => promote to a SINGLE shared overlay: ONE reused <input> (single-line /
  *     password) or ONE reused <textarea> (multiline), positioned/sized/fonted to the
  *     field's on-screen rect with a TRANSPARENT background (the canvas-drawn box shows
  *     through). The real control owns caret / selection / IME. Only ONE field is focused
  *     at a time, so exactly ONE overlay is live; Tab moves that overlay field-to-field.
  *   - BLUR       => the value (already live-synced every keystroke) is committed to the
  *     field's `text`, the overlay is hidden, and the field redraws as static canvas text.
  *
  * PIXEL PARITY: the overlay replicates the dhtml lzswfinputtext / lzswfinputtextmultiline
  * CSS EXACTLY (WebKit/Mac gutter: single-line padding T0/R3/B2/L1, multiline 2px all;
  * lineHeight 1.2em; letterSpacing 0.01em) so the focused overlay is identical to the dhtml
  * oracle. The STATIC canvas text is placed to match that same control — single-line text is
  * vertically CENTERED in the field box (native <input> behaviour) at glyph-left 1px;
  * multiline text is top-aligned at the 2px gutter with word-wrap — so focusing/blurring
  * produces no visible jump.
  *
  * FOCUS WIRING (matches dhtml semantics):
  *   click        -> canvas hit-test routes the mousedown to this (clickable) sprite ->
  *                   LzModeManager -> lz.Focus.__LZcheckFocusChange(view) -> setFocus(view)
  *                   -> view.onfocus -> isprite.gotFocus() -> select() -> attach overlay + focus.
  *   tab / prog   -> lz.Focus.next()/prev()/setFocus -> onblur old (gotBlur->deselect) +
  *                   onfocus new (gotFocus->select): the single overlay hops between fields.
  *   native focus -> __elEvent bridges to view.inputtextevent('onfocus') (-> lz.Focus.setFocus),
  *   native blur  -> ... ('onblur') (-> lz.Focus.clearFocus); reentrancy is absorbed by the
  *                   _focused guards inside LzInputText (non-kernel), unchanged.
  *   every input  -> live-sync sprite.text = value + view.inputtextevent('onchange', value)
  *                   so bindings/constraints/datapaths update as the user types.
  *
  * @topic Kernel
  * @subtopic Canvas
  */

{
#pragma "warnUndefinedReferences=false"

var LzInputTextSprite = function (owner, args, hasdirectionallayout) {
    if (owner == null) return;
    LzTextSprite.call(this, owner, args, hasdirectionallayout);
    this.disabled = false;
    this.readonly = false;
    this.maxlength = -1;
    this.multiline = !!(owner && owner.multiline);
    this.password  = !!(owner && owner.password);
    this.name = (owner && owner.name != null) ? owner.name : null;
    this.__shown = false;
    this.__styleKey = null;
    this.__rectKey = null;
    // An inputtext must ALWAYS be hit-testable so a click can focus it — the dhtml kernel
    // forces its clickdiv clickable; here the canvas hit-tester routes the focusing click
    // to us (there is no DOM element on top to catch it while unfocused).
    this.clickable = true;
    this.cursor = 'text';
}
LzInputTextSprite.prototype = new LzTextSprite(null);
LzInputTextSprite.prototype.constructor = LzInputTextSprite;

// --- prototype defaults ---
LzInputTextSprite.prototype.disabled  = false;
LzInputTextSprite.prototype.readonly  = false;
LzInputTextSprite.prototype.maxlength = -1;
// An <input>/<textarea> shows its LITERAL value — never HTML markup — so opt OUT of the
// LzTextSprite rich-text path (this sprite has its own literal paint + word-wrap below);
// the inherited measure/height helpers then take their unchanged plain branch.
LzInputTextSprite.prototype.__richtext = false;

// focus bookkeeping (shared with LzCanvasInput.__mouseEvent's blur-on-mousedown)
LzInputTextSprite.prototype.__focusedSprite = null;   // the sprite that currently owns the overlay
LzInputTextSprite.prototype.__lastshown = null;
LzInputTextSprite.prototype.__lastfocus = null;

// mirror dhtml: capture the real clickable value but stay clickable so we always catch focus clicks.
LzInputTextSprite.prototype.setClickable = function (c) { this.__clickable = c; this.clickable = true; }

// single-line <input> WebKit/Mac gutter (see lzswfinputtext override): text glyph-left = 1px.
LzInputTextSprite.__inputPadLeft = 1;
// AE fine-tune knobs (input-only, do NOT touch LzTextSprite.__baselineAdjust/__xAdjust which
// tune plain <text>). __baselineAdjust nudges the vertical baseline; __xAdjust the glyph pen.
//
// __baselineAdjust = -2: a single-line <input> is centred by the browser on the font's
// TYPOGRAPHIC em-box (OS/2 sTypoAscender/Descender, summing to 1em) — NOT the taller
// fontBoundingBox line-box our __inputCenterBaseline derives from. For the OL default face
// (Verdana/Vera 11px, which every lzswfinputtext uses) the typo box centres 2px above the
// fontBoundingBox centre; this correction is a font/size constant (independent of the field
// height — proven by the AE sweep hitting the exact DOM floor for both h=19 and h=20 fields).
LzInputTextSprite.__baselineAdjust = -2;
LzInputTextSprite.__xAdjust = 0;

// strip \r (canvas would render carriage returns as boxes; the value normalizes to \n)
LzInputTextSprite.__crRe = new RegExp('\\r\\n?', 'g');

// ---------------------------------------------------------------------------
//  THE ONE shared overlay  (exactly one <input>/<textarea> live at any time)
// ---------------------------------------------------------------------------
// { container:<div>, input:<input>, textarea:<textarea>, el:<active element|null> }
LzInputTextSprite.__overlay = null;

LzInputTextSprite.__ensureOverlay = function () {
    var o = LzInputTextSprite.__overlay;
    if (!o) o = LzInputTextSprite.__overlay = { container: null, input: null, textarea: null, el: null };
    if (!o.container) {
        var c = document.createElement('div');
        var s = c.style;
        s.position = 'absolute'; s.margin = '0'; s.padding = '0'; s.border = '0 none';
        s.overflow = 'hidden'; s.display = 'none';
        s.zIndex = '10';   // above the <canvas> (sibling in the app container)
        o.container = c;
    }
    var root = LzSprite.__rootSpriteContainer;
    if (root && o.container.parentNode !== root) root.appendChild(o.container);
    return o;
}

// Lazily build (once) and return the shared element for this multiline-ness.
LzInputTextSprite.__makeEl = function (o, multiline) {
    if (multiline) {
        if (!o.textarea) {
            var ta = o.textarea = document.createElement('textarea');
            ta.setAttribute('wrap', 'soft');
            LzInputTextSprite.__styleEl(ta, true);
            LzInputTextSprite.__wireEvents(ta);
        }
        return o.textarea;
    }
    if (!o.input) {
        var inp = o.input = document.createElement('input');
        LzInputTextSprite.__styleEl(inp, false);
        LzInputTextSprite.__wireEvents(inp);
    }
    return o.input;
}

// Static CSS that never changes — replicates the dhtml lzswfinputtext(multiline) classes
// EXACTLY (WebKit/Mac) so the focused overlay is pixel-identical to the dhtml oracle.
LzInputTextSprite.__styleEl = function (el, multiline) {
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('spellcheck', 'false');
    var s = el.style;
    s.position = 'absolute';
    s.left = '0px'; s.top = '0px';
    s.width = '100%'; s.height = '100%';           // dhtml: 100% of the (view-sized) container
    s.margin = '0';
    s.border = '0 none'; s.borderWidth = '0';
    s.outline = 'none';
    s.background = 'transparent'; s.backgroundColor = 'transparent';
    s.boxShadow = 'none';
    s.boxSizing = 'content-box';                   // dhtml default: content 100% + padding gutter
    s.resize = 'none';
    s.lineHeight = '1.2em';
    s.textIndent = '0';
    s.textAlign = 'left';
    if (multiline) {
        s.whiteSpace = 'pre-wrap';
        s.wordWrap = 'break-word';
        s.overflow = 'hidden';
        s.padding = '2px 2px 2px 2px';             // lzswfinputtextmultiline (WebKit)
    } else {
        s.whiteSpace = 'nowrap';
        s.padding = '0px 3px 2px 1px';             // lzswfinputtext (WebKit) T R B L
    }
    if (LzSprite.quirks && LzSprite.quirks.emulate_flash_font_metrics) s.letterSpacing = '0.01em';
}

LzInputTextSprite.__wireEvents = function (el) {
    var f = LzInputTextSprite.__elEvent;
    el.onfocus = f; el.onblur = f;
    el.oninput = f; el.onkeyup = f; el.onkeydown = f; el.onchange = f;
}

// Native DOM event -> LFC inputtext contract. Runs in the scope of the shared element;
// the CURRENT owning sprite is `this.__sprite` (re-pointed on every attach).
LzInputTextSprite.__elEvent = function (evt) {
    evt = evt || window.event;
    var sprite = this.__sprite;
    if (!sprite || sprite.disabled) return;
    var view = sprite.owner;
    var eventname = 'on' + evt.type;

    if (eventname === 'onfocus') {
        LzInputTextSprite.prototype.__focusedSprite = sprite;
        LzInputTextSprite.prototype.__lastshown = sprite;
        sprite.__shown = true;
        if (typeof LzMouseKernel != 'undefined' && LzMouseKernel.setGlobalClickable) LzMouseKernel.setGlobalClickable(false);
        if (typeof LzKeyboardKernel != 'undefined' && LzKeyboardKernel) LzKeyboardKernel.__cancelKeys = false;
        if (view && view.inputtextevent) view.inputtextevent('onfocus');
        return;
    }
    if (eventname === 'onblur') {
        if (LzInputTextSprite.prototype.__focusedSprite === sprite) LzInputTextSprite.prototype.__focusedSprite = null;
        sprite.__shown = false;
        // hide the (now unowned) overlay + repaint the field as static canvas text
        var o = LzInputTextSprite.__overlay;
        if (o && o.container) o.container.style.display = 'none';
        if (typeof LzMouseKernel != 'undefined' && LzMouseKernel.setGlobalClickable) LzMouseKernel.setGlobalClickable(true);
        if (typeof LzKeyboardKernel != 'undefined' && LzKeyboardKernel) LzKeyboardKernel.__cancelKeys = true;
        if (view && view.inputtextevent) view.inputtextevent('onblur');
        LzSprite.__markDirty();
        return;
    }
    // value-changing events: live-sync every keystroke (dhtml onkeydown/onkeyup path) so any
    // bindings / constraints / datapaths on the field update AS the user types.
    if (eventname === 'oninput' || eventname === 'onkeyup' || eventname === 'onkeydown' || eventname === 'onchange') {
        var v = this.value;
        if (v !== sprite.text) {
            sprite.text = v;
            if (view && view.inputtextevent) view.inputtextevent('onchange', v);
        }
        return;
    }
}

// ---------------------------------------------------------------------------
//  Static canvas text (unfocused)  — the field's glyphs when NOT editing
// ---------------------------------------------------------------------------
// Split the raw field VALUE into display lines (NOT the HTML-whitespace-collapsing model
// LzTextSprite uses for <text> innerHTML — an <input>/<textarea> shows the literal value).
LzInputTextSprite.prototype.__inputLines = function (t, avail, font, ls) {
    t = String(t == null ? '' : t).replace(LzInputTextSprite.__crRe, '\n');
    if (!this.multiline) return [ t ];                 // single-line: literal value, one line
    if (avail > 0) return this.__wrapLines(t, avail, font, ls);  // textarea word-wrap
    return t.indexOf('\n') < 0 ? [ t ] : t.split('\n');
}

// Greedy word-wrap approximating the <textarea> (white-space:pre-wrap; word-wrap:break-word)
// so the unfocused multiline field wraps like the focused control / dhtml oracle.
LzInputTextSprite.prototype.__wrapLines = function (t, avail, font, ls) {
    var out = [], paras = t.split('\n');
    var fits = function (str) { return LzFontManager.measure(font, str, ls).width <= avail; };
    var hardbreak = function (word) {
        // break-word: split a too-long token to fit; returns the trailing remainder line
        var chunk = '';
        for (var c = 0; c < word.length; c++) {
            var tc = chunk + word.charAt(c);
            if (chunk !== '' && !fits(tc)) { out.push(chunk); chunk = word.charAt(c); }
            else chunk = tc;
        }
        return chunk;
    };
    for (var p = 0; p < paras.length; p++) {
        var words = paras[p].split(' '), line = '';
        for (var i = 0; i < words.length; i++) {
            var word = words[i];
            var trial = (line === '') ? word : (line + ' ' + word);
            if (fits(trial)) { line = trial; continue; }
            if (line !== '') { out.push(line); line = ''; }
            // place `word` on a fresh line; hard-break it if it alone overflows
            line = fits(word) ? word : hardbreak(word);
        }
        out.push(line);
    }
    return out;
}

// ascent/descent (px) for the current font — same source LzTextSprite uses for baselines.
LzInputTextSprite.prototype.__fontAD = function () {
    var fs = this._fontSizePx;
    var fm = LzFontManager.fontMetrics(this.__fontString());
    if (fm && fm.ascent != null) return { A: fm.ascent, D: fm.descent };
    return { A: fs * 0.8, D: fs * 0.2 };
}

// single-line <input> vertical-center baseline (from the field top): the native control
// centres its one line in the box, so baseline = (h + ascent - descent) / 2.
LzInputTextSprite.prototype.__inputCenterBaseline = function (h) {
    var ad = this.__fontAD();
    return (h + ad.A - ad.D) / 2 + LzInputTextSprite.__baselineAdjust;
}

LzInputTextSprite.prototype.__paintFG = function (ctx, w, h) {
    // the FOCUSED field's glyphs (+ caret + native selection) are shown by the DOM overlay;
    // don't double-draw them on the canvas underneath.
    if (LzInputTextSprite.prototype.__focusedSprite === this) return;
    var t = this.text;
    if (t == null || t === '') return;
    t = String(t);
    if (this.password) {
        // <input type=password> renders a bullet per character
        var n = t.replace(LzInputTextSprite.__crRe, '').length, m = '';
        for (var i = 0; i < n; i++) m += '•';
        t = m;
    }
    var font = this.__fontString(), ls = this.__letterSpacingPx();
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    if ('letterSpacing' in ctx) ctx.letterSpacing = ls + 'px';   // match dhtml swf letter-spacing
    ctx.fillStyle = LzSprite.__torgb(this.textcolor == null ? 0 : this.textcolor);

    if (this.multiline) {
        // <textarea> (lzswfinputtextmultiline): 2px gutter, top-aligned, wrapped, line-height 1.2
        var pad = 2, avail = (w || 0) - 4;
        var lines = this.__inputLines(t, avail, font, ls);
        var L = this._lineHeightPx || (this._fontSizePx * 1.2);
        var base = pad + this.__multilineHalfLeadAscent();
        var x0 = pad + (this._textIndent || 0) + LzInputTextSprite.__xAdjust;
        for (var i = 0; i < lines.length; i++) {
            this.__drawLine(ctx, lines[i], x0, base + i * L, font, ls, avail, pad);
        }
    } else {
        // <input> (lzswfinputtext): single line, glyph-left 1px, VERTICALLY CENTERED.
        var line = this.__inputLines(t)[0] || '';
        var base = this.__inputCenterBaseline(h);
        var avail1 = (w || 0) - 4, x0 = LzInputTextSprite.__inputPadLeft + (this._textIndent || 0) + LzInputTextSprite.__xAdjust;
        this.__drawLine(ctx, line, x0, base, font, ls, avail1, LzInputTextSprite.__inputPadLeft);
    }
}

// half-leading + ascent for the multiline top baseline (mirrors LzTextSprite.__baselineFromTop
// minus the gutter, so line 0 sits on the CSS baseline within the 1.2em line box).
LzInputTextSprite.prototype.__multilineHalfLeadAscent = function () {
    var fs = this._fontSizePx, L = this._lineHeightPx || (fs * 1.2), ad = this.__fontAD();
    return (L - (ad.A + ad.D)) / 2 + ad.A;
}

// draw one line honoring text-align (left default; center/right rare but supported)
LzInputTextSprite.prototype.__drawLine = function (ctx, line, x0, y, font, ls, avail, pad) {
    var dx = x0;
    if (this._textAlign == 'center' || this._textAlign == 'right') {
        var lw = LzFontManager.measure(font, line, ls).width;
        dx = (this._textAlign == 'center') ? pad + Math.max(0, (avail - lw) / 2)
                                           : pad + Math.max(0, avail - lw);
    }
    ctx.fillText(line, dx, y);
    if (this._textDecoration == 'underline') {
        var lw2 = LzFontManager.measure(font, line, ls).width;
        var uy = Math.round(y + this._fontSizePx * 0.12) + 0.5;
        ctx.save(); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(dx, uy); ctx.lineTo(dx + lw2, uy); ctx.stroke(); ctx.restore();
    }
}

// ---------------------------------------------------------------------------
//  LFC focus-manager contract
// ---------------------------------------------------------------------------
LzInputTextSprite.prototype.gotFocus = function () {
    if (LzInputTextSprite.prototype.__focusedSprite === this) return;
    this.select();
}
LzInputTextSprite.prototype.gotBlur = function () {
    if (LzInputTextSprite.prototype.__focusedSprite !== this) return;
    this.deselect();
}
LzInputTextSprite.prototype.select = function () {
    if (this.disabled) return;
    this.__attachOverlay();
    if (typeof LzKeyboardKernel != 'undefined' && LzKeyboardKernel) LzKeyboardKernel.__cancelKeys = false;
}
LzInputTextSprite.prototype.deselect = function () {
    this.__detachOverlay();
    if (typeof LzKeyboardKernel != 'undefined' && LzKeyboardKernel) LzKeyboardKernel.__cancelKeys = true;
}
LzInputTextSprite.prototype.setFocus = function (v) { if (v) this.select(); else this.deselect(); }
LzInputTextSprite.prototype.focus = function () { this.select(); }
LzInputTextSprite.prototype.blur  = function () { this.deselect(); }
LzInputTextSprite.prototype.select_text = function () { this.select(); }

// Move the single shared overlay onto THIS field: pick + style + value + position + focus.
LzInputTextSprite.prototype.__attachOverlay = function () {
    var o = LzInputTextSprite.__ensureOverlay();
    var prev = LzInputTextSprite.prototype.__focusedSprite;
    if (prev && prev !== this) prev.__detachOverlay();   // release any previous owner first

    var el = LzInputTextSprite.__makeEl(o, this.multiline);
    if (o.el && o.el !== el && o.el.parentNode) o.el.parentNode.removeChild(o.el);
    if (el.parentNode !== o.container) o.container.appendChild(el);
    o.el = el;
    el.__sprite = this;

    el.disabled = !!this.disabled;
    el.readOnly = !!this.readonly;
    if (!this.multiline) el.setAttribute('type', this.password ? 'password' : 'text');
    if (this.maxlength != null && this.maxlength >= 0) el.maxLength = this.maxlength;
    if (this.name != null) el.setAttribute('name', this.name); else el.removeAttribute('name');
    var val = (this.text == null ? '' : String(this.text));
    if (el.value !== val) el.value = val;

    LzInputTextSprite.prototype.__focusedSprite = this;
    LzInputTextSprite.prototype.__lastshown = this;
    LzInputTextSprite.prototype.__lastfocus = this;
    this.__shown = true;
    this.__styleKey = null;      // force a style push to the (reused) element
    this.__rectKey = null;       // force a reposition
    this.__applyStyle();
    this.__syncOverlay();        // position/size/clip to the field's on-screen rect NOW
    o.container.style.display = 'block';
    if (typeof LzMouseKernel != 'undefined' && LzMouseKernel.setGlobalClickable) LzMouseKernel.setGlobalClickable(false);

    var self = this;
    try { el.focus(); } catch (e) {}
    // select-all once focus settles (matches dhtml __selectLastFocused)
    setTimeout(function () {
        if (LzInputTextSprite.prototype.__lastfocus === self && o.el === el && el.select) {
            try { el.select(); } catch (e) {}
        }
    }, 50);
    // the field's glyphs now come from the overlay — repaint to drop the static text
    LzSprite.__markDirty();
}

// Release the shared overlay from this field: hide, blur, redraw as static canvas text.
LzInputTextSprite.prototype.__detachOverlay = function () {
    var o = LzInputTextSprite.__overlay;
    this.__shown = false;
    if (LzInputTextSprite.prototype.__focusedSprite === this) LzInputTextSprite.prototype.__focusedSprite = null;
    if (LzInputTextSprite.prototype.__lastshown === this) LzInputTextSprite.prototype.__lastshown = null;
    if (o && o.container) o.container.style.display = 'none';
    if (o && o.el && o.el.__sprite === this && o.el.blur) { try { o.el.blur(); } catch (e) {} }
    if (typeof LzMouseKernel != 'undefined' && LzMouseKernel.setGlobalClickable) LzMouseKernel.setGlobalClickable(true);
    LzSprite.__markDirty();
}

// --- selection (operate on the overlay when this field owns it) ---
LzInputTextSprite.prototype.setSelection = function (start, end) {
    if (end == null) end = start;
    if (LzInputTextSprite.prototype.__focusedSprite !== this) this.select();
    var o = LzInputTextSprite.__overlay;
    if (!o || !o.el) return;
    LzInputTextSprite.prototype.__lastfocus = this;
    try { o.el.focus(); } catch (e) {}
    if (o.el.setSelectionRange) { try { o.el.setSelectionRange(start, end); } catch (e) {} }
    if (typeof LzKeyboardKernel != 'undefined' && LzKeyboardKernel) LzKeyboardKernel.__cancelKeys = false;
}
LzInputTextSprite.prototype.setSelectionRange = LzInputTextSprite.prototype.setSelection;
LzInputTextSprite.prototype.getSelectionPosition = function () {
    var o = LzInputTextSprite.__overlay;
    if (LzInputTextSprite.prototype.__focusedSprite !== this || !o || !o.el) return -1;
    return (o.el.selectionStart != null) ? o.el.selectionStart : -1;
}
LzInputTextSprite.prototype.getSelectionSize = function () {
    var o = LzInputTextSprite.__overlay;
    if (LzInputTextSprite.prototype.__focusedSprite !== this || !o || !o.el) return -1;
    if (o.el.selectionStart == null) return -1;
    return o.el.selectionEnd - o.el.selectionStart;
}

// ---------------------------------------------------------------------------
//  Content / state
// ---------------------------------------------------------------------------
LzInputTextSprite.prototype.setText = function (t, force) {
    if (t == null) t = '';
    this.text = t;
    var o = LzInputTextSprite.__overlay;
    if (LzInputTextSprite.prototype.__focusedSprite === this && o && o.el && o.el.value !== t) o.el.value = t;
    if (this.owner && this.owner._updateSize) this.owner._updateSize();
    LzSprite.__markDirty();
}
LzInputTextSprite.prototype.getText = function () {
    var o = LzInputTextSprite.__overlay;
    if (LzInputTextSprite.prototype.__focusedSprite === this && o && o.el) return o.el.value;
    return this.text == null ? '' : this.text;
}
LzInputTextSprite.prototype.setEnabled = function (val) {
    this.disabled = !val;
    var o = LzInputTextSprite.__overlay;
    if (LzInputTextSprite.prototype.__focusedSprite === this && o && o.el) o.el.disabled = this.disabled;
}
LzInputTextSprite.prototype.setPassword = function (p) {
    this.password = !!p;
    var o = LzInputTextSprite.__overlay;
    if (LzInputTextSprite.prototype.__focusedSprite === this && o && o.el && !this.multiline) {
        o.el.setAttribute('type', p ? 'password' : 'text');
    }
    LzSprite.__markDirty();
}
LzInputTextSprite.prototype.setMaxLength = function (val) {
    if (val == Infinity) val = (~0 >>> 1);
    this.maxlength = val;
    var o = LzInputTextSprite.__overlay;
    if (LzInputTextSprite.prototype.__focusedSprite === this && o && o.el) o.el.maxLength = val;
}
// The LFC may flip multiline after construction. With no per-field DOM element this is just a
// flag + repaint; the shared overlay picks <input> vs <textarea> at focus time. If the field
// happens to be focused, swap the live element.
LzInputTextSprite.prototype.setMultiline = function (ml) {
    ml = !!ml;
    if (ml === this.multiline) return;
    this.multiline = ml;
    if (this.owner) this.owner.multiline = ml;
    if (LzInputTextSprite.prototype.__focusedSprite === this) { this.__detachOverlay(); this.__attachOverlay(); }
    else LzSprite.__markDirty();
}
LzInputTextSprite.prototype.setEditable = function (e) {
    this.readonly = !e;
    var o = LzInputTextSprite.__overlay;
    if (LzInputTextSprite.prototype.__focusedSprite === this && o && o.el) o.el.readOnly = !e;
}

// ---------------------------------------------------------------------------
//  Overlay sync — position / size / visibility / opacity / clip (focused field only)
// ---------------------------------------------------------------------------
LzInputTextSprite.__rectIntersect = function (a, b) {
    var x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    var r = Math.min(a.x + a.w, b.x + b.w), bm = Math.min(a.y + a.h, b.y + b.h);
    return { x: x, y: y, w: r - x, h: bm - y };
}

// font / color / alignment pushed only when changed (avoid reflow + caret reset).
LzInputTextSprite.prototype.__applyStyle = function () {
    var o = LzInputTextSprite.__overlay;
    if (!o || !o.el) return;
    var key = this._fontStyle + '|' + this._fontWeight + '|' + this._fontSizePx + '|' +
              this._fontFamily + '|' + this.textcolor + '|' + this._textAlign;
    if (key === this.__styleKey) return;
    this.__styleKey = key;
    var s = o.el.style;
    s.fontFamily = this._fontFamily;
    s.fontSize   = this._fontSizePx + 'px';
    s.fontWeight = this._fontWeight;
    s.fontStyle  = this._fontStyle;
    s.textAlign  = this._textAlign || 'left';
    s.color = LzSprite.__torgb(this.textcolor == null ? 0 : this.textcolor);
}

// Position the shared container over this field's on-screen rect (canvas-local, LOGICAL px —
// the backing store is device px under HiDPI, but the overlay lives in CSS px like the canvas
// element's box). Accumulate ancestor visibility / opacity / clip up the parent chain.
LzInputTextSprite.prototype.__syncOverlay = function () {
    var o = LzInputTextSprite.__overlay;
    if (!o || !o.container) return;
    var container = o.container;

    var nodes = [];
    for (var p = this; p && !p.isroot; p = p.__parent) nodes.push(p);
    if (!nodes.length || nodes[nodes.length - 1].__parent == null) {
        if (container.style.display !== 'none') container.style.display = 'none';
        return;
    }

    var ox = 0, oy = 0, origins = new Array(nodes.length);
    for (var i = nodes.length - 1; i >= 0; i--) {
        ox += (nodes[i].x || 0) + (nodes[i].xoffset || 0);
        oy += (nodes[i].y || 0) + (nodes[i].yoffset || 0);
        origins[i] = { x: ox, y: oy };
    }
    var vis = (this.visible !== false), op = 1, clip = null;
    for (var i = 0; i < nodes.length; i++) {
        var nd = nodes[i];
        if (nd.visible === false) vis = false;
        if (nd.opacity != null) op *= nd.opacity;
        if (nd.clip && nd.width != null && nd.height != null) {
            var cr = { x: origins[i].x, y: origins[i].y, w: nd.width, h: nd.height };
            clip = clip ? LzInputTextSprite.__rectIntersect(clip, cr) : cr;
        }
    }

    var fx = origins[0].x, fy = origins[0].y, fw = this.width || 0, fh = this.height || 0;
    var rs = LzSprite.__rootSprite;
    var cw = rs ? (rs.width || 0) : 0, ch = rs ? (rs.height || 0) : 0;
    var view = LzInputTextSprite.__rectIntersect({ x: 0, y: 0, w: cw, h: ch }, { x: fx, y: fy, w: fw, h: fh });
    var shownRect = clip ? LzInputTextSprite.__rectIntersect(view, clip) : view;
    if (!vis || op <= 0 || fw <= 0 || fh <= 0 || shownRect.w <= 0 || shownRect.h <= 0) {
        if (container.style.display !== 'none') container.style.display = 'none';
        return;
    }

    var rectKey = fx + ',' + fy + ',' + fw + ',' + fh + ',' + op;
    var clipKey = clip ? (clip.x + ',' + clip.y + ',' + clip.w + ',' + clip.h) : 'none';
    if (this.__rectKey !== rectKey + '|' + clipKey) {
        this.__rectKey = rectKey + '|' + clipKey;
        var st = container.style;
        st.left = fx + 'px'; st.top = fy + 'px';
        st.width = fw + 'px'; st.height = fh + 'px';
        st.opacity = (op >= 1 ? '' : String(op));
        if (clip) {
            var t = Math.max(0, clip.y - fy), l = Math.max(0, clip.x - fx);
            var r = Math.max(0, (fx + fw) - (clip.x + clip.w)), b = Math.max(0, (fy + fh) - (clip.y + clip.h));
            st.clipPath = (t || l || r || b) ? ('inset(' + t + 'px ' + r + 'px ' + b + 'px ' + l + 'px)') : 'none';
        } else {
            st.clipPath = 'none';
        }
    }
    if (container.style.display !== 'block') container.style.display = 'block';
    this.__applyStyle();
}

// Only the ONE focused field's overlay needs syncing (there is at most one).
LzSprite.__syncInputOverlays = function () {
    var s = LzInputTextSprite.prototype.__focusedSprite;
    if (s && !s.__LZdeleted) s.__syncOverlay();
}

// chain the overlay sync onto the painter's repaint (so the overlay follows the scene while
// focused), and onto window scroll/resize (which don't dirty the canvas).
LzInputTextSprite.__superRepaint = LzSprite.__repaint;
LzSprite.__repaint = function () {
    LzInputTextSprite.__superRepaint();
    LzSprite.__syncInputOverlays();
}
if (typeof window != 'undefined' && window.addEventListener) {
    window.addEventListener('scroll', function () { LzSprite.__syncInputOverlays(); }, true);
    window.addEventListener('resize', function () { LzSprite.__syncInputOverlays(); }, false);
}

// ---------------------------------------------------------------------------
//  Lifecycle
// ---------------------------------------------------------------------------
LzInputTextSprite.prototype.destroy = function (parentvalid) {
    this.__LZdeleted = true;
    if (LzInputTextSprite.prototype.__focusedSprite === this) this.__detachOverlay();
    LzTextSprite.prototype.destroy.call(this, parentvalid);
}

// no-ops for the long tail the LFC may probe on an input sprite
LzInputTextSprite.prototype.setHTML = function () {}
LzInputTextSprite.prototype.setScrolling = function (s) { return !!s; }

if (typeof lz != 'undefined' && lz) lz.__LzInputTextSprite = LzInputTextSprite;

}
