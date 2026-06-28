/* --- OpenLaszlo 5.0: colortransform / setColorTransform for DHTML --------------------
   Flash's ColorTransform was native; in DHTML it was never implemented, so the runtime
   DEFINED the `colortransform` view attribute + setColorTransform()/tintcolor methods
   (LaszloView.lzs) but gated them on `this.capabilities.colortransform`, which shipped
   FALSE -- so they only warned and no-op'd. That forced apps (e.g. the dashboard's
   window/scrollbar tinting) to reach into the DOM and set style.filter themselves, an
   abstraction violation.

   This block (a) implements the missing sprite-kernel primitive LzSprite#setColorTransform
   as an SVG feColorMatrix filter on the sprite's resource element, and (b) flips the
   `colortransform` capability on. The view's `this.capabilities` is the SAME shared object
   as `LzSprite.prototype.capabilities` (LaszloView sets `this.capabilities =
   this.sprite.capabilities`), so flipping the prototype flag activates the view methods
   too. The capability is read in exactly 4 places, ALL in LaszloView.lzs (the colortransform
   setter, the deprecated setColorTransform alias, getColorTransform, and tintcolor), so
   enabling it only lights up those view paths -- safe.

   The sprite transform takes the general dict the view setter produces:
     {redMultiplier, redOffset, greenMultiplier, greenOffset,
      blueMultiplier, blueOffset, alphaMultiplier, alphaOffset}
   and maps it to a DIAGONAL 5x4 feColorMatrix (last column = offset/255), which is the
   faithful, general color transform. For a grayscale source (R=G=B) a diagonal multiply
   yields the IDENTICAL result to a luminance-spread multiply, so the (grayscale) dashboard
   chrome looks unchanged.  Guarded with typeof checks like the touchcancel block above. -- */
;(function () {
  if (typeof LzSprite === "undefined") return;
  if (LzSprite.prototype.__colortransformInstalled) return;
  LzSprite.prototype.__colortransformInstalled = true;

  var SVGNS = "http://www.w3.org/2000/svg";
  var __ctSeq = 0;   // unique id counter for generated filters

  function num(v, dflt) { return (v == null || isNaN(v)) ? dflt : v; }

  // True when the transform is the identity (no visible change): all multipliers ~1,
  // all offsets ~0.  Such transforms CLEAR the filter rather than add a no-op one.
  function isIdentity(rm, gm, bm, am, ro, go, bo, ao) {
    var e = 0.0001;
    return Math.abs(rm - 1) < e && Math.abs(gm - 1) < e &&
           Math.abs(bm - 1) < e && Math.abs(am - 1) < e &&
           Math.abs(ro) < e && Math.abs(go) < e &&
           Math.abs(bo) < e && Math.abs(ao) < e;
  }

  // Build (and cache, keyed by the matrix values) a hidden <svg><filter><feColorMatrix>,
  // returning its element id.  All filters live in one shared off-screen <svg>.
  function ensureFilter(values, key) {
    if (typeof document === "undefined" || !document.body) return null;
    var id = "lzct_" + key;
    if (document.getElementById(id)) return id;
    var svg = document.getElementById("lzct_svg");
    if (!svg) {
      svg = document.createElementNS(SVGNS, "svg");
      svg.setAttribute("id", "lzct_svg");
      svg.setAttribute("width", "0");
      svg.setAttribute("height", "0");
      svg.style.position = "absolute";
      svg.style.left = "-1px";
      svg.style.top = "-1px";
      svg.style.overflow = "hidden";
      document.body.appendChild(svg);
    }
    var f = document.createElementNS(SVGNS, "filter");
    f.setAttribute("id", id);
    f.setAttribute("color-interpolation-filters", "sRGB");
    var m = document.createElementNS(SVGNS, "feColorMatrix");
    m.setAttribute("type", "matrix");
    m.setAttribute("values", values);
    f.appendChild(m);
    svg.appendChild(f);
    return id;
  }

  /**
   * Apply a Flash-style color transform to this sprite's resource element via an SVG
   * feColorMatrix filter.
   * @param o {Object} {redMultiplier, redOffset, greenMultiplier, greenOffset,
   *                    blueMultiplier, blueOffset, alphaMultiplier, alphaOffset}
   */
  LzSprite.prototype.setColorTransform = function (o) {
    var el = this.__LZimg || this.__LZdiv;
    if (!el || !el.style) return;
    o = o || {};
    this.__colortransform = o;
    var rm = num(o.redMultiplier,   1), ro = num(o.redOffset,   0);
    var gm = num(o.greenMultiplier, 1), go = num(o.greenOffset, 0);
    var bm = num(o.blueMultiplier,  1), bo = num(o.blueOffset,  0);
    var am = num(o.alphaMultiplier, 1), ao = num(o.alphaOffset, 0);

    // Identity transform -> clear any existing filter (don't stack a no-op).
    if (isIdentity(rm, gm, bm, am, ro, go, bo, ao)) {
      el.style.filter = "";
      this.__colortransformId = null;
      return;
    }

    // Diagonal 5x4 color matrix; last column is the per-channel offset normalized to 0..1.
    var values =
      rm + " 0 0 0 " + (ro / 255) + " " +
      "0 " + gm + " 0 0 " + (go / 255) + " " +
      "0 0 " + bm + " 0 " + (bo / 255) + " " +
      "0 0 0 " + am + " " + (ao / 255);

    var key = values.replace(/[^0-9a-zA-Z]/g, "_");
    var id = ensureFilter(values, key);
    if (id) {
      el.style.filter = "url(#" + id + ")";
      this.__colortransformId = id;
    }
  };

  // getColorTransform() is referenced by the view; provide a benign accessor so it
  // doesn't throw if called.  Returns the last-applied transform dict (or null).
  if (typeof LzSprite.prototype.getColorTransform !== "function") {
    LzSprite.prototype.getColorTransform = function () {
      return this.__colortransform || null;
    };
  }

  // Enable the capability so the LaszloView colortransform/setColorTransform/tintcolor
  // methods take effect instead of warning.  The view shares this very object.
  if (LzSprite.prototype.capabilities) {
    LzSprite.prototype.capabilities.colortransform = true;
  }
  // Defensive: if some build gives LzView its own capabilities object, flip that too.
  if (typeof LzView !== "undefined" && LzView.prototype &&
      LzView.prototype.capabilities &&
      LzView.prototype.capabilities !== (LzSprite.prototype && LzSprite.prototype.capabilities)) {
    LzView.prototype.capabilities.colortransform = true;
  }
})();
