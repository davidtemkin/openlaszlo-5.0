// flex-adapter.js — pure adapter between flexlayout.lzx and the vendored css-layout
// engine. Spec: docs/superpowers/specs/2026-07-06-flexlayout-design.md ("The engine and
// its adapter"). No LFC dependencies; unit-tested from node (flexlayout-adapter.test.mjs).
(function (global) {
  var engine = (typeof module !== "undefined" && module.exports)
    ? require("./css-layout.js") : global.LzCssLayout;

  function mkRef(over) {
    var r = {
      _size: [NaN, NaN], _pos: [NaN, NaN], _corner: [NaN, NaN],
      _margin: [0, 0, 0, 0], _padding: [0, 0, 0, 0], _borderwidth: [0, 0, 0, 0],
      _minsize: [NaN, NaN], _maxsize: [NaN, NaN],
      _flexdirection: "row", _justifycontent: "flex-start", _alignitems: "stretch",
      // null, NEVER "auto": the engine's getAlignItem tests truthiness — "auto" matches
      // no alignment constant and falls through to flex-end.
      _alignself: null, _flexwrap: "nowrap", _position: "relative", _direction: "ltr",
      _flex: 0,
    };
    for (var k in over) r[k] = over[k];
    return r;
  }
  function mkNode(r, children) {
    return { ref: r, children: children || [], visible: true,
      layout: { width: undefined, height: undefined, left: 0, top: 0, right: 0, bottom: 0 } };
  }
  var isRow = function (d) { return d === "row" || d === "row-reverse"; };

  // The spec's dimension-control rule: a dimension belongs to the engine ONLY when it is
  // genuinely auto. main: flex>0 && auto; cross: resolved align === stretch && auto.
  function engineControlled(child, containerAlign, dir) {
    var align = child.alignself || containerAlign;
    var mainAuto = isRow(dir) ? child.autoWidth : child.autoHeight;
    var crossAuto = isRow(dir) ? child.autoHeight : child.autoWidth;
    return {
      main: child.flex > 0 && mainAuto,
      cross: align === "stretch" && crossAuto,
      mainDim: isRow(dir) ? "width" : "height",
      crossDim: isRow(dir) ? "height" : "width",
    };
  }

  function buildTree(c, children) {
    var dir = c.flexdirection || "row";
    var kids = [];
    for (var i = 0; i < children.length; i++) {
      var ch = children[i];
      if (!ch.visible || ch.ignore) continue;
      var ec = engineControlled(ch, c.alignitems || "stretch", dir);
      var size = [ch.width, ch.height];
      if (ec.main) size[ec.mainDim === "width" ? 0 : 1] = NaN;      // engine-controlled → auto
      if (ec.cross) size[ec.crossDim === "width" ? 0 : 1] = NaN;
      var m = ch.margin || 0;
      var node = mkNode(mkRef({
        _size: size,
        // _flex only when main is engine-controlled: the engine resizes ANY _flex>0 child,
        // even one with a defined main size — gating here is what preserves authored sizes.
        _flex: ch.flex > 0 && ec.main ? ch.flex : 0,
        _alignself: ch.alignself || null,
        _margin: [m, m, m, m],
      }));
      node.idx = i;
      node.ec = ec;
      kids.push(node);
    }
    var p = c.padding || 0;
    return mkNode(mkRef({
      _size: [c.width, c.height],
      _flexdirection: dir,                       // ALWAYS explicit: engine default is column
      _justifycontent: c.justifycontent || "flex-start",
      _alignitems: c.alignitems || "stretch",
      _flexwrap: c.flexwrap || "nowrap",
      _padding: [p, p, p, p],
    }), kids);
  }

  function computeWrites(tree, containerWidth) {
    engine.layoutNode(tree, containerWidth, "ltr");
    var out = [];
    for (var i = 0; i < tree.children.length; i++) {
      var n = tree.children[i];
      var wCtl = (n.ec.main && n.ec.mainDim === "width") || (n.ec.cross && n.ec.crossDim === "width");
      var hCtl = (n.ec.main && n.ec.mainDim === "height") || (n.ec.cross && n.ec.crossDim === "height");
      out.push({
        idx: n.idx,
        x: Math.round(n.layout.left), y: Math.round(n.layout.top),
        width: wCtl ? Math.max(0, Math.round(n.layout.width)) : null,
        height: hCtl ? Math.max(0, Math.round(n.layout.height)) : null,
      });
    }
    return out;
  }

  var api = { buildTree: buildTree, computeWrites: computeWrites, engineControlled: engineControlled };
  global.LzFlexAdapter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
