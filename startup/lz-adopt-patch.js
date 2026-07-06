// lz-adopt-patch.js — element-adoption runtime patch for DOM-authored apps
// (spec: docs/superpowers/specs/2026-07-05-dom-native-authoring-design.md, Seam 2).
//
// PREPENDED to the compiled app JS by laszlo-dom.js: lz.embed loads the LFC
// script first, then the app script — so LzView/LzNode exist here and no view
// has been constructed yet. The LFC on disk is UNTOUCHED (its byte-for-byte
// oracle parity is inviolable; that is why this is a patch, not an LFC edit).
//
// Contract with the compiler (domsource.ts): statically-authored plain-view
// instances carry args.lzdomadopt = "<n>", and the live authored element
// carries data-lz-adopt="<n>" (held in window.__lzDomAdoptRegistry).
(function () {
  var reg = window.__lzDomAdoptRegistry;
  if (!reg || typeof LzView === "undefined" || typeof LzNode === "undefined") return;
  var orig = LzView.prototype.__makeSprite;
  LzView.prototype.__makeSprite = function (args) {
    orig.call(this, args);
    if (!args || args.lzdomadopt == null) return;
    var id = String(args.lzdomadopt);
    // Consume: the sentinel means "never apply as a normal attribute" — exactly
    // how construct() handles stretches/resource (LaszloView.lzs).
    args.lzdomadopt = LzNode._ignoreAttribute;
    var el = reg.get(id);
    if (!el) {
      if (window.console) console.warn("lz-adopt: no live element for id " + id + " (falling back to a created div)");
      return;
    }
    reg["delete"](id); // consume-once
    var sprite = this.sprite;
    var created = sprite && sprite.__LZdiv;
    // Only swap a fresh, unattached, plain created div. Subclass sprites
    // (LzTextSprite etc.) never reach this wrapper (they override __makeSprite),
    // and stamping already excludes them — this is defense in depth.
    if (!created || created.tagName !== "DIV" || created.parentNode) return;
    // Append (don't clobber) so an author-written class="…" survives adoption.
    el.className = (el.className ? el.className + " " : "") + created.className; // + 'lzdiv'
    if (created.style.cssText) el.style.cssText = created.style.cssText;
    el.owner = sprite;                            // the back-reference the LFC sets on __LZdiv
    sprite.__LZdiv = el;
  };
})();
