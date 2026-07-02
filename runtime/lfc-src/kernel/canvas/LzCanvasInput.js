/* -*- mode: JavaScript; c-basic-offset: 4; -*- */

/**
  * LzCanvasInput.js  (CANVAS kernel)
  *
  * DOM mouse routing for the own-pixels canvas kernel: turns real <canvas> DOM mouse
  * events into the EXISTING platform-agnostic event model (LzMouseKernel ->
  * LzModeManager.rawMouseEvent -> view.mouseevent). Nothing downstream changes.
  *
  * ONE handler (`__canvasMouseDispatch`) is bound to the <canvas> (via `__attachInput`)
  * for mousemove/down/up/click/dblclick/leave. It updates LzMouseKernel.__x/__y, asks
  * LzCanvasHitTest (`__hitTestPage`) for the sprite under the pointer, synthesizes the
  * over/out the dhtml kernel gets free from per-div DOM events (`__updateHover`/__lastHit),
  * and delivers per-sprite events via `__mouseEvent` (ported from kernel/dhtml/LzSprite.js:
  * press/over tracking, drag-in/out while held). `getMouse`/`__getPos` give a view its
  * mouse position relative to its own absolute page box. Cursor/clickable/contextmenu
  * setters (the input-facing state) live here too.
  *
  * Seam: depends on LzCanvasHitTest for `__hitTestPage`/`__canvasPageOffset`; feeds the
  * reused LzMouseKernel verbatim. Sprite-clickable state (`clickable`/`cursor`) is read by
  * the hit-tester and the dispatcher.
  *
  * @topic Kernel
  * @subtopic Canvas
  */

{
#pragma "warnUndefinedReferences=false"

// hover bookkeeping: which sprite the mouse is currently over (for synthetic
// onmouseover/onmouseout, which dhtml gets from per-div DOM mouseover/out events).
LzSprite.__lastHit = null;
LzSprite.__downSprite = null;   // sprite the last mousedown landed on (click validation)

LzSprite.__updateHover = function (hit) {
    var prev = LzSprite.__lastHit;
    if (hit === prev) return;
    LzSprite.__lastHit = hit;
    if (prev) prev.__mouseEvent('onmouseout');
    if (hit)  hit.__mouseEvent('onmouseover');
    // cursor: clickable hover -> the sprite's cursor, else pointer; otherwise default
    var c = LzSprite.__canvasEl;
    if (c) c.style.cursor = hit ? (hit.cursor || 'pointer') : 'default';
}

// the ONE DOM handler bound to the <canvas> for every mouse event type.
LzSprite.__attachInput = function (c) {
    if (!c || !c.addEventListener) return;
    var f = LzSprite.__canvasMouseDispatch;
    c.addEventListener('mousemove', f, false);
    c.addEventListener('mousedown', f, false);
    c.addEventListener('mouseup',   f, false);
    c.addEventListener('click',     f, false);
    c.addEventListener('dblclick',  f, false);
    c.addEventListener('mouseleave', function (e) {
        // mouse left the canvas: clear hover (synthesize the trailing onmouseout)
        if (LzSprite.__lastHit) { LzSprite.__lastHit.__mouseEvent('onmouseout'); LzSprite.__lastHit = null; }
        if (c) c.style.cursor = 'default';
    }, false);
}

LzSprite.__canvasMouseDispatch = function (e) {
    e = e || window.event;
    if (typeof LzKeyboardKernel != 'undefined' && LzKeyboardKernel && LzKeyboardKernel.__updateControlKeys) {
        LzKeyboardKernel.__updateControlKeys(e);
    }
    var type = e.type;
    // right-button / context menu deferred (no canvas context-menu yet)
    if (e.button === 2 || type === 'contextmenu') return;

    // update LzMouseKernel.__x/__y from the page coords; this ALSO fires the global
    // onmousemove (view=null) when type==='mousemove', exactly like the dhtml path.
    LzMouseKernel.__sendMouseMove(e);

    var hit = LzSprite.__hitTestPage();

    if (type === 'mousemove') {
        LzSprite.__updateHover(hit);
        return;
    }
    if (type === 'mousedown') {
        LzSprite.__updateHover(hit);     // make sure we're 'over' the target first
        LzSprite.__downSprite = hit;
        if (hit) hit.__mouseEvent('onmousedown');
        return;
    }
    if (type === 'mouseup') {
        if (hit) hit.__mouseEvent('onmouseup');
        var lmd = LzMouseKernel.__lastMouseDown;
        if (lmd && lmd !== hit) {
            // the sprite the button went down on hears upoutside (dhtml __globalmouseup)
            lmd.__mouseEvent('onmouseup');
            lmd.__mouseEvent('onmouseupoutside');
        }
        LzMouseKernel.__lastMouseDown = null;
        return;
    }
    if (type === 'click') {
        // a native click requires the down+up on the same element; only deliver onclick
        // when the press and release landed on the SAME sprite (matches per-div dhtml).
        if (hit && hit === LzSprite.__downSprite) hit.__mouseEvent('onclick');
        LzSprite.__downSprite = null;
        return;
    }
    if (type === 'dblclick') {
        if (hit) { hit.__mouseEvent('onmousedown'); hit.__mouseEvent('onmouseup'); hit.__mouseEvent('onclick'); }
        return;
    }
}

// Per-sprite event delivery into the platform-agnostic model. PORTED from the dhtml
// kernel's LzSprite.__mouseEvent (kernel/dhtml/LzSprite.js): tracks press/over state,
// handles drag-in/out while the button is held, then LzMouseKernel.__sendEvent(name,
// owner) -> LzModeManager.rawMouseEvent -> view.mouseevent(name).
LzSprite.prototype.__mouseisdown = false;
LzSprite.prototype.__mouseEvent = function (eventname) {
    if (eventname == 'onmousedown') {
        // blur any focused inputtext (matches dhtml LPP-8475)
        var fs = (typeof LzInputTextSprite != 'undefined') && LzInputTextSprite.prototype.__focusedSprite;
        if (fs && fs != this && fs.deselect) fs.deselect();
        this.__mouseisdown = true;
        LzMouseKernel.__lastMouseDown = this;
    } else if (eventname == 'onmouseover') {
        LzMouseKernel.__lastMouseOver = this;
    } else if (eventname == 'onmouseup') {
        this.__mouseisdown = false;
    }

    if (this.owner && this.owner.mouseevent) {
        // while the button is down, over/out become drag-in/out and only fire for the
        // sprite the press started on (mirrors dhtml __mouseEvent).
        if (LzMouseKernel.__lastMouseDown && (eventname === 'onmouseover' || eventname === 'onmouseout')) {
            var sendevents = LzMouseKernel.__lastMouseDown === this;
            if (eventname == 'onmouseover') LzMouseKernel.__lastMouseOver = this;
            else if (sendevents && LzMouseKernel.__lastMouseOver === this) LzMouseKernel.__lastMouseOver = null;
            if (sendevents) {
                LzMouseKernel.__sendEvent(eventname, this.owner);
                var dragname = eventname == 'onmouseover' ? 'onmousedragin' : 'onmousedragout';
                LzMouseKernel.__sendEvent(dragname, this.owner);
            }
            return;
        }
        LzMouseKernel.__sendEvent(eventname, this.owner);
    }
}

LzSprite.prototype.__isMouseOver = function () {
    var p = this.getMouse();
    return p.x >= 0 && p.y >= 0 && p.x < this.width && p.y < this.height;
}

// Mouse position RELATIVE TO THIS SPRITE (mirrors dhtml: page mouse minus sprite's
// absolute page position). LzMouseKernel.__x/__y are page coords (set by __sendMouseMove).
LzSprite.prototype.getMouse = function () {
    var p = this.__getPos();
    return { x: LzMouseKernel.__x - p.x, y: LzMouseKernel.__y - p.y };
}
// Absolute PAGE position of this sprite = canvas element's page offset + the summed
// (x+xoffset, y+yoffset) of this sprite and every ancestor up to the root. (Rotation/
// scale ignored for the pos read, exactly like the dhtml kernel's div-based __getPos.)
LzSprite.prototype.__getPos = function () {
    var off = LzSprite.__canvasPageOffset();
    var x = off.x, y = off.y;
    for (var p = this; p && !p.isroot; p = p.__parent) {
        x += (p.x || 0) + (p.xoffset || 0);
        y += (p.y || 0) + (p.yoffset || 0);
    }
    return { x: x, y: y, width: (this.width || 0), height: (this.height || 0) };
}

// --- input-facing sprite state: clickable / cursor / context menu ---
LzSprite.prototype.setClickable = function (c) { this.clickable = c; }
LzSprite.prototype.setCursor = function (c) { this.cursor = c; }
LzSprite.prototype.setShowHandCursor = function (s) {}
LzSprite.prototype.setDefaultContextMenu = function (m) {}
LzSprite.prototype.setContextMenu = function (m) {}
LzSprite.prototype.getContextMenu = function () { return null; }

}
