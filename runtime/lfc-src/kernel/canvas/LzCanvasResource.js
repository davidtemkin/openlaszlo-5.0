/* -*- mode: JavaScript; c-basic-offset: 4; -*- */

/**
  * LzCanvasResource.js  (CANVAS kernel)
  *
  * Image / multi-frame resource loading for the own-pixels canvas kernel. Mirrors
  * kernel/dhtml/LzSprite.js: a resource is a NAMED entry in the global LzResourceLibrary
  * ({ptype:"ar"|"sr", frames:[urls], width, height}); the owning view sizes itself to
  * (resourceWidth,resourceHeight) via `owner.resourceload()`. Each frame is its own image
  * URL (canvas owns pixels — no CSS sprite-sheets); the current frame's decoded <img> is
  * painted by LzCanvasPainter.__paintNode at the stretch-computed size.
  *
  * Owns: setResource/getResourceUrls/getBaseUrl, setSource, multi-frame __setFrame/play/
  * stop, the process-wide image cache (__imgcache/__loadImage), stretchResource and
  * updateResourceSize, and unload. The painter reads the resulting fields
  * (__img/__imgloaded/resourceWidth/resourceHeight/stretches).
  *
  * @topic Kernel
  * @subtopic Canvas
  */

{
#pragma "warnUndefinedReferences=false"

LzSprite.prototype.resourceWidth = null;
LzSprite.prototype.resourceHeight = null;
LzSprite.prototype.skiponload = true;

// process-wide image cache: the calendar reuses the same button/icon PNGs hundreds of
// times — load each URL once, share the decoded <img>.
LzSprite.__imgcache = {};
LzSprite.__loadImage = function (url, onready) {
    var c = LzSprite.__imgcache[url];
    if (c) { if (c.__loaded) onready(c); else c.__cbs.push(onready); return c; }
    var img = new Image();
    img.__loaded = false; img.__cbs = [onready];
    LzSprite.__imgcache[url] = img;
    img.onload = function () {
        img.__loaded = true;
        var cbs = img.__cbs; img.__cbs = [];
        for (var i = 0; i < cbs.length; i++) try { cbs[i](img); } catch (e) {}
    };
    img.onerror = function () { img.__error = true; var cbs = img.__cbs; img.__cbs = []; for (var i = 0; i < cbs.length; i++) try { cbs[i](null); } catch (e) {} };
    img.src = url;
    return img;
}

LzSprite.prototype.setResource = function (r) {
    if (this.resource == r) return;
    this.resource = r;
    if (r == null) { this.unload(); return; }
    if (r.indexOf('http:') == 0 || r.indexOf('https:') == 0) {
        this.skiponload = false;
        this.setSource(r);
        return;
    }
    var res = (typeof LzResourceLibrary != 'undefined') ? LzResourceLibrary[r] : null;
    if (res) {
        this.resourceWidth = res.width;
        this.resourceHeight = res.height;
    }
    var urls = this.getResourceUrls(r);
    if (this.owner && this.owner.resourceevent) this.owner.resourceevent('totalframes', urls.length);
    this.frames = urls;
    this.frame = 1;
    this.skiponload = true;
    if (urls.length) this.setSource(urls[0], true);
}

LzSprite.prototype.getResourceUrls = function (resourcename) {
    var urls = [];
    var res = (typeof LzResourceLibrary != 'undefined') ? LzResourceLibrary[resourcename] : null;
    if (!res) return urls;
    var baseurl = this.getBaseUrl(res);
    for (var i = 0; i < res.frames.length; i++) urls[i] = baseurl + res.frames[i];
    return urls;
}

LzSprite.prototype.getBaseUrl = function (resource) {
    var opts = LzSprite.__rootSprite && LzSprite.__rootSprite.options;
    if (!opts) return '';
    return opts[resource.ptype == 'sr' ? 'serverroot' : 'approot'] || '';
}

LzSprite.prototype.setSource = function (url, usecache) {
    if (url == null || url == 'null') { this.unload(); return; }
    if (usecache != true) {
        // called directly by a user (not via setResource frame load)
        this.skiponload = false;
        this.resource = url;
        if (this.playing) this.stop();
    }
    if (url === this.source && this.__img) {
        // already showing this image; still honor sizing for re-sets
        if (this.owner && this.owner.resourceload) this.owner.resourceload({ width: this.resourceWidth, height: this.resourceHeight, resource: this.resource, skiponload: this.skiponload });
        return;
    }
    this.source = url;
    this.__imgloaded = false;
    // size the owning view to the resource NOW (synchronous, like dhtml) — layout depends on it
    if (this.owner && this.owner.resourceload) this.owner.resourceload({ width: this.resourceWidth, height: this.resourceHeight, resource: this.resource, skiponload: this.skiponload });
    var self = this;
    LzSprite.__loadImage(url, function (img) {
        if (self.source !== url) return;   // superseded by a later frame/source
        if (!img) { self.__imgloaded = false; if (self.owner && self.owner.resourceloaderror) self.owner.resourceloaderror(); return; }
        self.__img = img; self.__imgloaded = true;
        // if the resource didn't declare a size, adopt the decoded image's natural size
        if (self.resourceWidth == null)  { self.resourceWidth = img.width;  if (self.owner && self.owner.resourceload) self.owner.resourceload({ width: img.width, height: img.height, resource: self.resource, skiponload: true }); }
        if (self.resourceHeight == null) self.resourceHeight = img.height;
        LzSprite.__markDirty();
    });
}

// multi-frame playback: pick the frame's image (each frame is its own URL on canvas)
LzSprite.prototype.__setFrame = function (f, force) {
    if (!this.frames) return;
    if (f < 1) f = 1; else if (f > this.frames.length) f = this.frames.length;
    if (f == this.frame && !force) return;
    this.frame = f;
    this.setSource(this.frames[f - 1], true);
    if (this.owner && this.owner.resourceevent) {
        this.owner.resourceevent('frame', this.frame);
        if (this.frames.length == this.frame) this.owner.resourceevent('lastframe', null, true);
    }
}
LzSprite.prototype.play = function (f) {
    this.playing = true;
    if (f != null) this.__setFrame(f);
}
LzSprite.prototype.stop = function (f) {
    this.playing = false;
    if (f != null) this.__setFrame(f);
}

LzSprite.prototype.unload = function () {
    this.resource = null; this.source = null; this.__img = null; this.__imgloaded = false;
    this.resourceWidth = null; this.resourceHeight = null;
    LzSprite.__markDirty();
}

LzSprite.prototype.updateResourceSize = function () {
    if (this.owner && this.owner.resourceload) this.owner.resourceload({ width: this.resourceWidth, height: this.resourceHeight, resource: this.resource, skiponload: true });
}
LzSprite.prototype.stretchResource = function (s) {
    s = (s != 'none' ? s : null);
    if (this.stretches == s) return;
    this.stretches = s;
    LzSprite.__markDirty();
}

}
