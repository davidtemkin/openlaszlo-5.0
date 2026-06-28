/* --- OpenLaszlo 5.0: iOS touchcancel recovery (mobile Safari) ----------------------
   iOS Safari fires `touchcancel` (which has no desktop analog) instead of `touchend`
   when it hijacks a touch -- a scroll/gesture, or the layout/focus shift that happens
   when you tap a nav item that swaps in a new app. The runtime only clears its
   mouse-down state on touchend->onmouseup, so a cancelled touch leaves __lastMouseDown
   / __mouseisdown stuck and the canvas stops accepting clicks. Release the stuck press
   via the existing __globalmouseup primitive. Desktop can't hit this (document mouseup
   always completes the cycle). ------------------------------------------------------- */
;(function () {
  if (typeof LzMouseKernel === "undefined" || typeof LzSprite === "undefined") return;
  if (LzMouseKernel.__touchReleaseInstalled) return;
  LzMouseKernel.__touchReleaseInstalled = true;
  LzMouseKernel.__touchRelease = function (e) {
    if (e && e.touches && e.touches.length) return;        // fingers still down
    var ld = LzMouseKernel.__lastMouseDown;
    if (ld && ld.__globalmouseup) ld.__globalmouseup(e);   // synthesize the missing release
    else LzMouseKernel.__lastMouseDown = null;
  };
  var caps = LzSprite.prototype.capabilities;
  if (caps && caps.touchevents && document.addEventListener) {
    document.addEventListener("touchcancel", LzMouseKernel.__touchRelease, false);
    document.addEventListener("touchend",    LzMouseKernel.__touchRelease, false);
  }
})();
