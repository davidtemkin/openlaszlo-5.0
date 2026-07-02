/* -*- mode: JavaScript; c-basic-offset: 4; -*- */

/**
  * LzTextSprite.js  (CANVAS kernel)
  *
  * Real Canvas 2D text. A <text> view's sprite measures with ctx.measureText
  * (via LzFontManager) and paints with ctx.fillText, honoring color / font-family /
  * size / weight / style. Positioning mirrors the dhtml kernel: the dhtml text div is
  * the `lzswftext` class (emulate_flash_font_metrics) with a 2px gutter (padding) and
  * line-height 1.2em; glyphs sit on the CSS baseline within that line box. We reproduce
  * that placement so canvas text lands where the DHTML oracle places it.
  *
  *   box top-left = view (x,y)         [the sprite node's translate]
  *   glyph left   = x + __pad (2)      [padding-left gutter + textindent]
  *   baseline_y   = y + __pad (2) + half-leading + fontAscent   [first line]
  *
  * The long tail (scrolling / selection / links / advanced-fonts) is no-op'd so the
  * LzText view drives the sprite without error; input editing stays in LzInputTextSprite.
  *
  * @topic Kernel
  * @subtopic Canvas
  */

{
#pragma "warnUndefinedReferences=false"

var LzTextSprite = function (owner, args, hasdirectionallayout) {
    if (owner == null) return;
    LzSprite.call(this, owner, false);
    this.text = '';
    if (args) this.__initTextProperties(args);
    // Register so an embedded font finishing its async load can re-measure + repaint us
    // (widths measured against the fallback font before the TTF arrives are wrong).
    if (LzFontManager.__registerTextSprite) LzFontManager.__registerTextSprite(this);
}
LzTextSprite.prototype = new LzSprite(null);
LzTextSprite.prototype.constructor = LzTextSprite;

// --- text-style state (defaults mirror dhtml lzswftext) ---
LzTextSprite.prototype.text = '';
LzTextSprite.prototype._fontFamily = 'Verdana,Vera,sans-serif';
LzTextSprite.prototype._fontStyle  = 'normal';   // normal | italic
LzTextSprite.prototype._fontWeight = 'normal';   // normal | bold
LzTextSprite.prototype._fontSizePx = 11;         // CSS default 11px
LzTextSprite.prototype._lineHeightPx = null;     // set when fontsize is set (1.2x, emulate_flash)
LzTextSprite.prototype.textcolor = 0;            // canvas fgcolor default = 0 (black)
LzTextSprite.prototype._textAlign = 'left';
LzTextSprite.prototype._textIndent = 0;
LzTextSprite.prototype._letterSpacing = null;   // null => SWF-emulation default (0.01em)
LzTextSprite.prototype._textDecoration = 'none';
// dhtml quirks['match_swf_letter_spacing']: lzswftext has letter-spacing 0.01em. We mirror
// it so canvas glyph advances match the DHTML text divs (else text drifts left-to-right).
LzTextSprite.__swfLetterSpacingEm = 0.01;
LzTextSprite.prototype.multiline = false;
LzTextSprite.prototype.resize = true;
LzTextSprite.prototype.selectable = false;
// SWF 'gutter': dhtml lzswftext has padding:2px each side => 4px total per axis,
// glyphs inset 2px from the box edge.
LzTextSprite.prototype.__wpadding = 4;
LzTextSprite.prototype.__hpadding = 4;
LzTextSprite.prototype.__pad = 2;
// empirical fine-tunes (px) for the AE loop: vertical baseline + horizontal pen.
// 0 = pure CSS half-leading model; set non-zero only if the diff demands it.
LzTextSprite.__baselineAdjust = 0;
LzTextSprite.__xAdjust = 0;

// A <text> interprets the minimal HTML markup set (see the rich-text section below);
// LzInputTextSprite sets this false — an <input>/<textarea> shows its literal value.
LzTextSprite.prototype.__richtext = true;
// --- static tables / regexes for the rich-text (HTML-subset) path ---
// HTML <font size="N"> (legacy 1..7, or +/- relative to 3) -> px. Mirrors the browser's
// font-size keyword table (medium base 16): 1=x-small .. 7=xxx-large. size="24" clamps
// to 7 (48px), which is what the dhtml innerHTML oracle renders (verified vs fonts.lzx).
LzTextSprite.__fontSizeTable = [ 0, 10, 13, 16, 18, 24, 32, 48 ];   // index 1..7
LzTextSprite.__entityMap = { lt:'<', gt:'>', amp:'&', quot:'"', apos:"'", nbsp:' ',
    copy:'©', reg:'®', trade:'™', mdash:'—', ndash:'–',
    hellip:'…', lsquo:'‘', rsquo:'’', ldquo:'“', rdquo:'”',
    middot:'·', deg:'°', bull:'•' };
// Cheap gate: rich path only for a real <tag> or a real &entity; (a bare '&' or 'a < b'
// stays on the byte-identical plain path). No 'g' flag => stateless .test().
LzTextSprite.__markupRe  = new RegExp('</?[a-zA-Z][^>]*>|&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);');
LzTextSprite.__entityRe  = new RegExp('&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);', 'g');
// == the dhtml `inner_html_strips_newlines_re` (RegExp('$','mg')): in MULTILINE text a
// runtime '\n' is turned into <br/> at each line end (a hard break), exactly as setText does.
LzTextSprite.__newlineRe = new RegExp('$', 'mg');
LzTextSprite.__trimRe    = new RegExp('^\\s+|\\s+$', 'g');
LzTextSprite.__trailSpRe = new RegExp(' +$');
LzTextSprite.__hexColorRe = new RegExp('^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$');
LzTextSprite.__namedColors = { black:'#000000', white:'#ffffff', red:'#ff0000', green:'#008000',
    lime:'#00ff00', blue:'#0000ff', yellow:'#ffff00', cyan:'#00ffff', aqua:'#00ffff',
    magenta:'#ff00ff', fuchsia:'#ff00ff', gray:'#808080', grey:'#808080', silver:'#c0c0c0',
    maroon:'#800000', olive:'#808000', navy:'#000080', purple:'#800080', teal:'#008080',
    orange:'#ffa500', pink:'#ffc0cb', brown:'#a52a2a' };

// referenced by LzFontManager measure-cache cleanup
LzTextSprite.prototype.__divstocleanup = [];
LzTextSprite.prototype.__cleanupdivs = function () {}

// Static initializer the LzText view references (LzText.lzs)
LzTextSprite.__initTextProperties = function () {}

// Install font + color from the view's cascaded init attrs (mirror dhtml order).
LzTextSprite.prototype.__initTextProperties = function (args) {
    if (!args) return;
    this.setFontName(args.font);
    this.setFontStyle(args.fontstyle);
    this.setFontSize(args.fontsize);
    this.setTextColor(args.fgcolor);
}

// ---------------------------------------------------------------------------
//  Font / color setters
// ---------------------------------------------------------------------------
LzTextSprite.prototype.setFontName = function (fname) {
    if (fname == null || fname === this._fontFamily) return;
    this._fontFamily = fname;
    this.__fontstr = null;
    this.__resize();
}

LzTextSprite.prototype.setFontSize = function (fsize) {
    if (fsize == null) return;
    fsize = parseFloat(fsize);
    if (isNaN(fsize) || fsize < 0) return;
    if (this._fontSizePx === fsize) return;
    this._fontSizePx = fsize;
    // emulate_flash_font_metrics: line-height tracks 1.2 * fontsize (rounded, as dhtml)
    this._lineHeightPx = Math.round(fsize * 1.2);
    this.__fontstr = null;
    this.__resize();
}

LzTextSprite.prototype.setFontStyle = function (fstyle) {
    if (fstyle == null) return;
    var fweight, fst;
    if (fstyle == 'plain')        { fweight = 'normal'; fst = 'normal'; }
    else if (fstyle == 'bold')    { fweight = 'bold';   fst = 'normal'; }
    else if (fstyle == 'italic')  { fweight = 'normal'; fst = 'italic'; }
    else if (fstyle == 'bold italic' || fstyle == 'bolditalic') { fweight = 'bold'; fst = 'italic'; }
    else return;
    var changed = false;
    if (fweight !== this._fontWeight) { this._fontWeight = fweight; changed = true; }
    if (fst    !== this._fontStyle)   { this._fontStyle  = fst;     changed = true; }
    if (changed) { this.__fontstr = null; this.__resize(); }
}
// dhtml alias
LzTextSprite.prototype.setFontWeight = function (w) { this.setFontStyle(w === 'bold' ? 'bold' : 'plain'); }

LzTextSprite.prototype.setTextColor = function (c) {
    if (c == null || this.textcolor === c) return;
    this.textcolor = c;
    LzSprite.__markDirty();
}
LzTextSprite.prototype.setColor = LzTextSprite.prototype.setTextColor;

// ---------------------------------------------------------------------------
//  Content
// ---------------------------------------------------------------------------
LzTextSprite.prototype.setText = function (t, force) {
    if (t == null) t = '';
    if (force != true && this.text === t) return;
    this.text = t;
    this.__resize();
}
LzTextSprite.prototype.getText = function () { return this.text; }

LzTextSprite.prototype.setMultiline = function (m) {
    m = !!m;
    if (m === this.multiline) return;
    this.multiline = m;
    this.__resize();
}
LzTextSprite.prototype.setResize  = function (r) { this.resize = !!r; }
LzTextSprite.prototype.setSelectable = function (s) { this.selectable = !!s; }
LzTextSprite.prototype.setTextAlign  = function (a) { if (a && a !== this._textAlign) { this._textAlign = a; LzSprite.__markDirty(); } }
LzTextSprite.prototype.setTextIndent = function (n) { if (!isNaN(n) && n !== this._textIndent) { this._textIndent = n; LzSprite.__markDirty(); } }
LzTextSprite.prototype.setLetterSpacing = function (n) { if (!isNaN(n) && n !== this._letterSpacing) { this._letterSpacing = n; this.__resize(); } }
// Effective letter-spacing in px: explicit value if set, else the SWF default 0.01em.
LzTextSprite.prototype.__letterSpacingPx = function () {
    return (this._letterSpacing != null) ? this._letterSpacing : (LzTextSprite.__swfLetterSpacingEm * this._fontSizePx);
}
LzTextSprite.prototype.setTextDecoration = function (d) { if (d && d !== this._textDecoration) { this._textDecoration = d; LzSprite.__markDirty(); } }

// Ask the owner view to recompute its auto-size (no-op until the view is inited),
// then schedule a repaint. Mirrors dhtml's __updatefieldsize -> owner._updateSize.
LzTextSprite.prototype.__resize = function () {
    if (this.owner && this.owner._updateSize) this.owner._updateSize();
    LzSprite.__markDirty();
}

// An embedded font just finished loading: drop the cached font shorthand + measured
// metrics and re-run the owner's auto-size so the view re-flows with the real glyph
// widths (mirrors dhtml LzTextSprite.__fontLoaded). Repaint is scheduled by __resize.
LzTextSprite.prototype.__fontLoaded = function () {
    this.__fontstr = null;
    this.__resize();
}

// ---------------------------------------------------------------------------
//  Font string + metrics
// ---------------------------------------------------------------------------
LzTextSprite.prototype.__fontstr = null;
LzTextSprite.prototype.__fontString = function () {
    if (this.__fontstr) return this.__fontstr;
    var s = '';
    if (this._fontStyle  && this._fontStyle  != 'normal') s += this._fontStyle  + ' ';
    if (this._fontWeight && this._fontWeight != 'normal') s += this._fontWeight + ' ';
    s += this._fontSizePx + 'px ' + this._fontFamily;
    return (this.__fontstr = s);
}

// Split content into the lines to render/measure.
// (RegExp constructor form — the LFC lexer does not accept /regex/ literals.)
//
// The dhtml lzswftext sprite sets text via `scrolldiv.innerHTML = t` with CSS
// `white-space:nowrap`, so the BROWSER applies HTML whitespace handling: runs of
// whitespace (space/tab/newline) collapse to a single space, leading whitespace at the
// block start is removed, and only <br> forces a line break (a literal '\n' becomes a
// space). We mirror that for single-line text so canvas glyphs land where the oracle
// places them (e.g. event titles in the calendar data carry leading/embedded spaces).
// Multiline views keep the legacy \n/<br> split (no collapse) to avoid regressing them.
LzTextSprite.__brRe   = new RegExp('<br\\s*/?>', 'gi');
LzTextSprite.__wsRe   = new RegExp('[ \\t\\n\\r\\f]+', 'g');
LzTextSprite.__leadRe = new RegExp('^[ \\t\\n\\r\\f]+');
LzTextSprite.prototype.__lines = function () {
    var t = this.text == null ? '' : String(this.text);
    if (this.multiline) {
        if (t.indexOf('\n') < 0 && t.indexOf('<br') < 0) return [t];
        return t.replace(LzTextSprite.__brRe, '\n').split('\n');
    }
    // single-line: white-space:nowrap on innerHTML (collapse + trim-leading; <br> breaks)
    var parts = t.split(LzTextSprite.__brRe);
    for (var i = 0; i < parts.length; i++) parts[i] = parts[i].replace(LzTextSprite.__wsRe, ' ');
    parts[0] = parts[0].replace(LzTextSprite.__leadRe, '');
    return parts;
}

// Widest line's advance width, in px (no gutter).
LzTextSprite.prototype.__measureWidth = function () {
    if (this.text == null || this.text === '') return 0;
    // rich path: natural (unwrapped) width = widest hard-break line of styled runs.
    if (this.__richtext && (this.multiline || this.__hasMarkup(String(this.text)))) {
        var items = this.__collapseItems(this.__parseRuns(String(this.text)));
        var runs = [], wmax = 0, lw;
        for (var i = 0; i < items.length; i++) {
            if (items[i].br) { lw = this.__richLineWidth(runs); if (lw > wmax) wmax = lw; runs = []; }
            else runs.push(items[i].run);
        }
        lw = this.__richLineWidth(runs); if (lw > wmax) wmax = lw;
        return wmax;
    }
    var font = this.__fontString(), ls = this.__letterSpacingPx(), lines = this.__lines(), w = 0;
    for (var j = 0; j < lines.length; j++) {
        var lwj = LzFontManager.measure(font, lines[j], ls).width;
        if (lwj > w) w = lwj;
    }
    return w;
}

// First-line alphabetic baseline measured from the box top, using the CSS
// half-leading model (line-height 1.2em, font ascent/descent from measureText).
LzTextSprite.prototype.__baselineFromTop = function () {
    var fs = this._fontSizePx;
    var L  = this._lineHeightPx || (fs * 1.2);     // line box height (1.2em)
    var fm = LzFontManager.fontMetrics(this.__fontString());
    var A, D;
    if (fm.ascent != null) { A = fm.ascent; D = fm.descent; }
    else { A = fs * 0.8; D = fs * 0.2; }           // fallback if no font metrics API
    // half-leading split: baseline = top + (L-(A+D))/2 + A
    return this.__pad + (L - (A + D)) / 2 + A + LzTextSprite.__baselineAdjust;
}

// ===========================================================================
//  Rich text: minimal HTML markup + word-wrap  (matches the dhtml innerHTML oracle)
//
//  The dhtml <text> sprite does `scrolldiv.innerHTML = t`, so the BROWSER interprets a
//  small HTML subset and wraps at the box width (white-space:normal for multiline). Canvas
//  owns its pixels, so we reproduce that here: parse <b>/<strong> (bold), <i>/<em>
//  (italic), <u> (underline), <font color|face|size>, <br>/<p> (breaks) and HTML entities
//  into styled RUNS, apply HTML inline-whitespace collapsing, and — for multiline — greedy
//  word-wrap to the width. Plain, non-multiline text (no tags/entities) keeps the exact
//  legacy fast path (byte-identical, e.g. the calendar). Baselines/line advance stay on the
//  BASE font's line box (dhtml sets a fixed line-height, so an oversized <font> run overflows
//  its line box just like the oracle). The SWF letter-spacing quirk is honored per run (the
//  same 0.01em formula, applied at each run's size — the quirk itself is untouched).
// ===========================================================================

// true iff the string contains a real HTML tag or entity (rich path); else plain fast path.
LzTextSprite.prototype.__hasMarkup = function (t) {
    return LzTextSprite.__markupRe.test(t);
}

// Decode the HTML entities <text> supports: named (&lt; &amp; &quot; &apos; &nbsp; ...) +
// numeric (&#NN; / &#xHH;). Unknown refs are left verbatim (as a browser would).
LzTextSprite.prototype.__decodeEntities = function (s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(LzTextSprite.__entityRe, function (m, ent) {
        if (ent.charAt(0) === '#') {
            var c1 = ent.charAt(1), code;
            if (c1 === 'x' || c1 === 'X') code = parseInt(ent.slice(2), 16);
            else code = parseInt(ent.slice(1), 10);
            if (isNaN(code)) return m;
            try { return String.fromCharCode(code); } catch (e) { return m; }
        }
        var v = LzTextSprite.__entityMap[ent.toLowerCase()];
        return (v != null) ? v : m;
    });
}

// <font color="..."> value -> a CSS color string (or null to keep the base color). Accepts
// #rgb / #rrggbb, the common color names, and rgb()/rgba().
LzTextSprite.prototype.__parseColor = function (str) {
    if (str == null) return null;
    var s = str.replace(LzTextSprite.__trimRe, '');
    if (s === '') return null;
    if (LzTextSprite.__hexColorRe.test(s)) return s;
    var named = LzTextSprite.__namedColors[s.toLowerCase()];
    if (named) return named;
    if (s.toLowerCase().indexOf('rgb') === 0) return s;
    return null;
}

// <font size="..."> value -> px via the legacy HTML table (see __fontSizeTable).
LzTextSprite.prototype.__htmlFontSizePx = function (val) {
    if (val == null) return null;
    var s = val.replace(LzTextSprite.__trimRe, ''), rel = 0;
    if (s.charAt(0) === '+') { rel = 1; s = s.slice(1); }
    else if (s.charAt(0) === '-') { rel = -1; s = s.slice(1); }
    var num = parseInt(s, 10);
    if (isNaN(num)) return null;
    var n = rel ? (3 + rel * num) : num;
    if (n < 1) n = 1; else if (n > 7) n = 7;
    return LzTextSprite.__fontSizeTable[n];
}

// The sprite's own (cascaded) style, before any markup: the base of the tag stack.
LzTextSprite.prototype.__baseStyle = function () {
    return { b: (this._fontWeight === 'bold'), i: (this._fontStyle === 'italic'),
             u: (this._textDecoration === 'underline'), c: null, f: null, s: null, name: null };
}
LzTextSprite.__cloneStyle = function (st) {
    return { b: st.b, i: st.i, u: st.u, c: st.c, f: st.f, s: st.s, name: st.name };
}

// Read one HTML attribute value (double / single quoted or bare) out of a tag body.
LzTextSprite.prototype.__attrVal = function (tag, name) {
    var m = new RegExp(name + '\\s*=\\s*("[^"]*"|\'[^\']*\'|[^\\s>]+)', 'i').exec(tag);
    if (!m) return null;
    var v = m[1], q = v.charAt(0);
    if (q === '"' || q === "'") v = v.slice(1, v.length - 1);
    return v;
}

// Apply an open/self-closing tag to the style stack, or push a break into `items`.
LzTextSprite.prototype.__handleTag = function (tag, items, stack) {
    tag = tag.replace(LzTextSprite.__trimRe, '');
    if (tag === '') return;
    if (tag.charAt(0) === '/') {   // closing tag: pop to the matching open (lenient)
        var cname = tag.slice(1).replace(LzTextSprite.__trimRe, '').toLowerCase();
        for (var k = stack.length - 1; k >= 1; k--) {
            if (stack[k].name === cname) { stack.length = k; return; }
        }
        return;
    }
    var nm = new RegExp('^([a-zA-Z0-9]+)').exec(tag);
    if (!nm) return;
    var name = nm[1].toLowerCase();
    var selfClose = (tag.charAt(tag.length - 1) === '/');
    if (name === 'br' || name === 'p') { items.push({ br: true }); return; }
    var ns = LzTextSprite.__cloneStyle(stack[stack.length - 1]);
    ns.name = name;
    if (name === 'b' || name === 'strong') ns.b = true;
    else if (name === 'i' || name === 'em') ns.i = true;
    else if (name === 'u') ns.u = true;
    else if (name === 'font') {
        var col = this.__attrVal(tag, 'color'); if (col != null) { var pc = this.__parseColor(col); if (pc) ns.c = pc; }
        var face = this.__attrVal(tag, 'face'); if (face) ns.f = face;
        var sz = this.__attrVal(tag, 'size'); if (sz != null) { var ps = this.__htmlFontSizePx(sz); if (ps) ns.s = ps; }
    }
    // unknown tags leave the style unchanged but still nest (so their close pops cleanly)
    if (!selfClose) stack.push(ns);
}

// Tokenize the HTML string into a flat list of { run:{t,b,i,u,c,f,s} } and { br:true }.
LzTextSprite.prototype.__parseRuns = function (t) {
    var items = [], stack = [ this.__baseStyle() ], self = this;
    var emit = function (raw) {
        if (raw === '') return;
        var st = stack[stack.length - 1];
        items.push({ run: { t: self.__decodeEntities(raw), b: st.b, i: st.i, u: st.u, c: st.c, f: st.f, s: st.s } });
    };
    var i = 0, n = t.length;
    while (i < n) {
        var lt = t.indexOf('<', i);
        if (lt < 0) { emit(t.slice(i)); break; }
        if (lt > i) emit(t.slice(i, lt));
        var gt = t.indexOf('>', lt + 1);
        if (gt < 0) { emit(t.slice(lt)); break; }    // stray '<' with no '>' -> literal text
        self.__handleTag(t.slice(lt + 1, gt), items, stack);
        i = gt + 1;
    }
    return items;
}

// HTML inline whitespace collapsing (white-space:normal|nowrap both collapse): runs of
// [ \t\n\r\f] -> one space, leading space dropped at each line/after a space, trailing
// space dropped before a break and at the end. &nbsp; ( ) is NOT collapsible.
LzTextSprite.prototype.__collapseItems = function (items) {
    var out = [], atStart = true, prevSpace = false;
    var rtrim = function () {
        for (var j = out.length - 1; j >= 0; j--) {
            if (out[j].br) return;
            if (out[j].run.t !== '') { out[j].run.t = out[j].run.t.replace(LzTextSprite.__trailSpRe, ''); return; }
        }
    };
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.br) { rtrim(); out.push(it); atStart = true; prevSpace = false; continue; }
        var s = it.run.t.replace(LzTextSprite.__wsRe, ' ');
        if (atStart || prevSpace) s = s.replace(LzTextSprite.__leadRe, '');
        if (s === '') continue;
        it.run.t = s;
        out.push(it);
        atStart = false;
        prevSpace = (s.charAt(s.length - 1) === ' ');
    }
    rtrim();
    return out;
}

// Parse + collapse + split at hard breaks -> array of lines (each an array of runs). For
// multiline, greedy-wrap each line to `avail` px. Mirrors setText's \n->'<br/>' transform.
LzTextSprite.prototype.__richLines = function (avail) {
    var t = (this.text == null) ? '' : String(this.text);
    if (this.multiline && t.indexOf('\n') >= 0) t = t.replace(LzTextSprite.__newlineRe, '<br/>');
    var items = this.__collapseItems(this.__parseRuns(t));
    var lines = [ [] ];
    for (var i = 0; i < items.length; i++) {
        if (items[i].br) lines.push([]);
        else lines[lines.length - 1].push(items[i].run);
    }
    if (!this.multiline || !(avail > 0)) return lines;
    var out = [];
    for (var li = 0; li < lines.length; li++) {
        var wrapped = this.__wrapRichLine(lines[li], avail);
        for (var wi = 0; wi < wrapped.length; wi++) out.push(wrapped[wi]);
    }
    return out;
}

// --- per-run font / color / letter-spacing / width ---
LzTextSprite.prototype.__runFontStr = function (run) {
    var s = '';
    if (run.i) s += 'italic ';
    if (run.b) s += 'bold ';
    s += (run.s || this._fontSizePx) + 'px ' + (run.f || this._fontFamily);
    return s;
}
LzTextSprite.prototype.__runColor = function (run) {
    return (run.c != null) ? run.c : LzSprite.__torgb(this.textcolor == null ? 0 : this.textcolor);
}
// SWF letter-spacing quirk (0.01em), applied at the RUN's size — same formula as
// __letterSpacingPx() (which the plain path/input keep); the quirk itself is unchanged.
LzTextSprite.prototype.__lsForSize = function (size) {
    return (this._letterSpacing != null) ? this._letterSpacing : (LzTextSprite.__swfLetterSpacingEm * size);
}
LzTextSprite.prototype.__segWidth = function (seg) {
    return LzFontManager.measure(this.__runFontStr(seg.run), seg.t, this.__lsForSize(seg.run.s || this._fontSizePx)).width;
}
LzTextSprite.prototype.__richLineWidth = function (runs) {
    var w = 0;
    for (var i = 0; i < runs.length; i++) w += this.__segWidth({ t: runs[i].t, run: runs[i] });
    return w;
}

// --- word wrap (rich) ---
// Split a run's text into word / whitespace segments (only ASCII space breaks; &nbsp; stays).
LzTextSprite.prototype.__splitRunToSegs = function (run, segs) {
    var s = run.t, i = 0, n = s.length;
    while (i < n) {
        var sp = (s.charAt(i) === ' ');
        var j = i + 1;
        while (j < n && ((s.charAt(j) === ' ') === sp)) j++;
        segs.push({ t: s.slice(i, j), run: run, sp: sp });
        i = j;
    }
}
// break-word: split one overlong token into chunks that each fit `avail`; full chunks are
// pushed as their own lines, the trailing remainder is returned to continue the current line.
LzTextSprite.prototype.__hardBreakSeg = function (seg, avail, lines) {
    var s = seg.t, run = seg.run, chunk = '';
    for (var c = 0; c < s.length; c++) {
        var tc = chunk + s.charAt(c);
        if (chunk !== '' && this.__segWidth({ t: tc, run: run }) > avail) {
            lines.push([ { t: chunk, run: run, sp: false } ]);
            chunk = s.charAt(c);
        } else chunk = tc;
    }
    return { t: chunk, run: run, sp: false };
}
// Greedy word-wrap a single (hard-break-delimited) line of runs to `avail` px. A word that
// alone exceeds avail is broken char-by-char (lzswftext word-wrap:break-word in WebKit).
LzTextSprite.prototype.__wrapRichLine = function (runs, avail) {
    var segs = [];
    for (var k = 0; k < runs.length; k++) this.__splitRunToSegs(runs[k], segs);
    var lines = [], cur = [], curW = 0, pend = null, pendW = 0;
    for (var si = 0; si < segs.length; si++) {
        var seg = segs[si];
        if (seg.sp) {                                   // whitespace: defer (may be a trailing space)
            if (cur.length === 0 && pend === null) continue;
            if (pend === null) { pend = seg; pendW = this.__segWidth(seg); }
            continue;
        }
        var wW = this.__segWidth(seg);
        if (cur.length === 0 && pend === null && wW > avail) {   // first token already too wide
            var rem0 = this.__hardBreakSeg(seg, avail, lines);
            cur.push(rem0); curW = this.__segWidth(rem0);
        } else if (cur.length > 0 && (curW + (pend ? pendW : 0) + wW) > avail) {
            lines.push(cur); cur = []; curW = 0; pend = null; pendW = 0;
            if (wW > avail) { var rem = this.__hardBreakSeg(seg, avail, lines); cur.push(rem); curW = this.__segWidth(rem); }
            else { cur.push(seg); curW = wW; }
        } else {
            if (pend) { cur.push(pend); curW += pendW; pend = null; pendW = 0; }
            cur.push(seg); curW += wW;
        }
    }
    if (cur.length) lines.push(cur);
    if (lines.length === 0) lines.push([]);
    var out = [];
    for (var li = 0; li < lines.length; li++) out.push(this.__mergeSegs(lines[li]));
    return out;
}
// Re-merge consecutive segments that share a run into runs; drop any trailing line space.
LzTextSprite.prototype.__mergeSegs = function (segLine) {
    var runs = [], cur = null, curRun = null;
    for (var i = 0; i < segLine.length; i++) {
        var seg = segLine[i];
        if (cur && seg.run === curRun) cur.t += seg.t;
        else { curRun = seg.run; cur = { t: seg.t, b: seg.run.b, i: seg.run.i, u: seg.run.u, c: seg.run.c, f: seg.run.f, s: seg.run.s }; runs.push(cur); }
    }
    if (runs.length) runs[runs.length - 1].t = runs[runs.length - 1].t.replace(LzTextSprite.__trailSpRe, '');
    return runs;
}

// Paint rich (markup / wrapped) text. Baseline + line advance use the BASE font's line box
// (matching the oracle's fixed line-height); each run draws with its own font/color/spacing.
LzTextSprite.prototype.__paintRich = function (ctx, w, h) {
    var avail = (w || 0) - this.__wpadding;
    var lines = this.__richLines(avail);
    var baseL = this._lineHeightPx || (this._fontSizePx * 1.2);
    var base = this.__baselineFromTop();
    var pad = this.__pad, align = this._textAlign;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    for (var i = 0; i < lines.length; i++) {
        var runs = lines[i];
        if (!runs.length) continue;
        var y = base + i * baseL, dx;
        if (align === 'center' || align === 'right') {
            var lw = this.__richLineWidth(runs);
            dx = (align === 'center') ? pad + Math.max(0, (avail - lw) / 2) : pad + Math.max(0, avail - lw);
        } else {
            dx = pad + (this._textIndent || 0) + LzTextSprite.__xAdjust;
        }
        var penx = dx;
        for (var r = 0; r < runs.length; r++) {
            var run = runs[r];
            if (run.t === '') continue;
            var fontStr = this.__runFontStr(run), ls = this.__lsForSize(run.s || this._fontSizePx);
            ctx.font = fontStr;
            if ('letterSpacing' in ctx) ctx.letterSpacing = ls + 'px';
            ctx.fillStyle = this.__runColor(run);
            ctx.fillText(run.t, penx, y);
            var rw = LzFontManager.measure(fontStr, run.t, ls).width;
            if (run.u) {
                var rs = run.s || this._fontSizePx;
                var uy = Math.round(y + rs * 0.12) + 0.5;
                ctx.save(); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(penx, uy); ctx.lineTo(penx + rw, uy); ctx.stroke(); ctx.restore();
            }
            penx += rw;
        }
    }
}

// ---------------------------------------------------------------------------
//  LzText sizing contract  (gated on sprite.initted exactly like dhtml)
// ---------------------------------------------------------------------------
LzTextSprite.prototype.getTextWidth = function (force) {
    if (!this.initted && !force) return 0;
    var w = this.__measureWidth();
    // dhtml measures via a DOM div's offsetWidth, which ROUNDS the (letter-spaced)
    // content width to the nearest integer CSS pixel — NOT ceil. Match that so the
    // app's getTextWidth-driven centering (month title, tab labels) lands identically.
    if (w != 0) w = Math.round(w) + this.__wpadding;   // + emulate_flash gutter
    return w;
}
LzTextSprite.prototype.getLineHeight = function () {
    if (this._lineHeightPx) return this._lineHeightPx;
    return Math.round(this._fontSizePx * 1.2);
}
LzTextSprite.prototype.getTextfieldHeight = function (force) {
    if (!this.initted && !force) return 0;
    var n;
    if (this.__richtext && (this.multiline || this.__hasMarkup(String(this.text)))) {
        // multiline auto-height grows by the (wrapped) display-line count; single line = 1
        // (matches dhtml getTextfieldHeight, which reports getLineHeight() when not multiline).
        // QUIRK: dhtml's getTextDimension('height') measures the wrap using the RAW
        // (un-padded) `this.width` (LzTextSprite.js:465 `width = this.CSSDimension(this.width)`),
        // while the actually-RENDERED scrolldiv is narrower by __wpadding (setWidth subtracts
        // it). So dhtml's own line-count estimate is computed at a slightly WIDER box than what
        // it really wraps into — occasionally one word short of a wrap the real (narrower)
        // render needs, under-counting the line total by one. Reproduce that exact mismatch
        // here (raw this.width, NOT avail) so borderline paragraphs auto-size + stack identically
        // to dhtml (including dhtml's own last-line clip in that case — see __paintRich's clip).
        n = this.multiline ? this.__richLines(this.width || 0).length : 1;
    } else {
        n = this.multiline ? this.__lines().length : 1;
    }
    return this.getLineHeight() * n + this.__hpadding; // + emulate_flash gutter
}
LzTextSprite.prototype.getTextHeight = LzTextSprite.prototype.getTextfieldHeight;
LzTextSprite.prototype.getTextSize = function () {
    return { width: this.getTextWidth(true), height: this.getTextfieldHeight(true) };
}

// ---------------------------------------------------------------------------
//  Paint hook  (invoked by LzSprite.__paintNode inside the node transform/clip)
// ---------------------------------------------------------------------------
LzTextSprite.prototype.__paintFG = function (ctx, w, h) {
    var t = this.text;
    if (t == null || t === '') return;
    // dhtml's scrolldiv sets `overflow:hidden` unconditionally whenever multiline is on
    // (setMultiline(true), independent of the node's own `clip` attribute/resize) — so any
    // wrapped line that falls past the box's OWN (possibly under-measured — see
    // getTextfieldHeight's quirk) height is invisible there. Match that self-clip here.
    var selfClip = this.multiline && w >= 0 && h >= 0;
    if (selfClip) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip(); }
    this.__paintFGInner(ctx, w, h);
    if (selfClip) ctx.restore();
}
LzTextSprite.prototype.__paintFGInner = function (ctx, w, h) {
    var t = this.text;
    // rich path: interpret HTML markup and/or word-wrap multiline (matches dhtml innerHTML).
    if (this.__richtext && (this.multiline || this.__hasMarkup(String(t)))) { this.__paintRich(ctx, w, h); return; }
    var font = this.__fontString(), ls = this.__letterSpacingPx();
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    if ('letterSpacing' in ctx) ctx.letterSpacing = ls + 'px';   // match dhtml lzswftext 0.01em
    ctx.fillStyle = LzSprite.__torgb(this.textcolor == null ? 0 : this.textcolor);
    var lines = this.__lines();
    var L = this._lineHeightPx || (this._fontSizePx * 1.2);
    var base = this.__baselineFromTop();
    var x0 = this.__pad + (this._textIndent || 0) + LzTextSprite.__xAdjust;
    var avail = (w || 0) - this.__wpadding;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i], dx = x0;
        if (this._textAlign == 'center' || this._textAlign == 'right') {
            var lw = LzFontManager.measure(font, line, ls).width;
            dx = (this._textAlign == 'center')
                 ? this.__pad + Math.max(0, (avail - lw) / 2)
                 : this.__pad + Math.max(0, avail - lw);
        }
        ctx.fillText(line, dx, base + i * L);
        if (this._textDecoration == 'underline') {
            var lw2 = LzFontManager.measure(font, line, ls).width;
            var uy = Math.round(base + i * L + this._fontSizePx * 0.12) + 0.5;
            ctx.save(); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(dx, uy); ctx.lineTo(dx + lw2, uy); ctx.stroke(); ctx.restore();
        }
    }
}

// ---------------------------------------------------------------------------
//  No-op long tail (so LzText drives the sprite without error)
// ---------------------------------------------------------------------------
LzTextSprite.prototype.setMaxLength   = function () {}
LzTextSprite.prototype.setPattern     = function () {}
LzTextSprite.prototype.setScroll      = function () {}
LzTextSprite.prototype.setYScroll     = function () {}
LzTextSprite.prototype.setXScroll     = function () {}
LzTextSprite.prototype.setScrollEvents= function () {}
LzTextSprite.prototype.setScrolling   = function () { return false; }
LzTextSprite.prototype.setBorder      = function () {}
LzTextSprite.prototype.setWordWrap    = function () {}
LzTextSprite.prototype.setEmbedFonts  = function () {}
LzTextSprite.prototype.setDirection   = function () {}
LzTextSprite.prototype.setSelection   = function () {}
LzTextSprite.prototype.getSelectionPosition = function () { return -1; }
LzTextSprite.prototype.getSelectionSize     = function () { return -1; }
LzTextSprite.prototype.setLineHeight  = function () {}
LzTextSprite.prototype.updateTextSize = function () {}
LzTextSprite.prototype.setTextClipRegion = function () {}
LzTextSprite.prototype.activateLinks  = function () {}
LzTextSprite.prototype.makeTextLink   = function (str) { return str; }
LzTextSprite.prototype.enableClickableLinks = function () {}
LzTextSprite.prototype.setAntiAliasType = function () {}
LzTextSprite.prototype.setGridFit     = function () {}
LzTextSprite.prototype.setSharpness   = function () {}
LzTextSprite.prototype.setThickness   = function () {}

// Expose for the AE validation loop / debugging (set __baselineAdjust/__xAdjust,
// then lz.__LzSprite.__repaint()). Additive; harmless if lz is absent.
if (typeof lz != 'undefined' && lz) lz.__LzTextSprite = LzTextSprite;

}
