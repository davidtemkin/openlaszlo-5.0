/**
  * LzInputTextSprite.js
  *
  * @copyright Copyright 2007-2010 Laszlo Systems, Inc.  All Rights Reserved.
  *            Use is subject to license terms.
  *
  * @topic Kernel
  * @subtopic DHTML
  * @author Max Carlson &lt;max@openlaszlo.org&gt;
  */

var LzInputTextSprite = function(owner) {
    if (owner == null) return;
    this.constructor = arguments.callee;
    this.owner = owner;
    this.uid = LzSprite.prototype.uid++;
    this.__csscache = {};
    this.__LZdiv = document.createElement('div');
    this.__LZdiv.className = 'lzinputtextcontainer';
    this.__LZdiv.owner = this;
    if (this.quirks.autoscroll_textarea) {
        this.dragging = false;
    }
    if (this.quirks.ie_leak_prevention) {
        this.__sprites[this.uid] = this;
    }

    this.__createInputText();
    //Debug.debug('new LzInputTextSprite', this.__LZdiv, this.owner);
}

LzInputTextSprite.prototype = new LzTextSprite(null);

if ($debug) {
/** @access private */
LzInputTextSprite.prototype._dbg_typename = 'LzInputTextSprite';
}

/**
 * __lastshown tracks the last inputtext to be shown by __show(), and
 * is used to hide the currently showing inputtext.
 *
 * @access private
 */
LzInputTextSprite.prototype.__lastshown = null;
/**
 * __focusedSprite tracks the last inputtext to be focused, and is
 * used to work around bugs in firefox's focus management and prevent
 * spurious/extra onfocus/blur events from being sent.
 *
 * @access private
 */
LzInputTextSprite.prototype.__focusedSprite = null;
/**
 * __lastfocus holds a reference to the last inputtext to be selected
 * - by select() or setSelection().  It's used as a callback (see
 * setTimout()) to work around a bug in IE where a field can't be
 * selected immediately after it's focused.
 *
 * @access private
 */
LzInputTextSprite.prototype.__lastfocus = null;
/** @access private */
LzInputTextSprite.prototype._cancelfocus = false;
/** @access private */
LzInputTextSprite.prototype._cancelblur = false;

/** @access private */
LzInputTextSprite.prototype.____crregexp = new RegExp('\\r\\n', 'g');

LzInputTextSprite.prototype.__createInputText = function(t) {
    if (this.__LzInputDiv) return;
    //Debug.write('Multiline', this, this.multiline, this.owner.multiline);
    var type = '';
    if (this.owner) {
        if (this.owner.password) {
            type = 'password'
        } else if (this.owner.multiline) {
            type = 'multiline'
        }
    }
    this.__createInputDiv(type);

    t = t || '';
    lz.embed.__setAttr(this.__LzInputDiv, 'value', t);

    if (this.quirks.fix_clickable) {
      if (this.quirks.fix_ie_clickable) {
        this.__LZinputclickdiv = document.createElement('img');
        this.__LZinputclickdiv.src = LzSprite.blankimage;
      } else {
        this.__LZinputclickdiv = document.createElement('div');
      }
      this.__LZinputclickdiv.className = 'lzclickdiv';
      this.__LZinputclickdiv.owner = this;
      // keep LzSprite.destroy() in sync to prevent leaks
      this.setClickable(true);

      if (! this.__LZclickcontainerdiv) {
        // create a click container if we need one
        this.__LZclickcontainerdiv = this.__createContainerDivs('click');
      }
      if (this.quirks.input_highlight_bug) {
        // TODO [hqm 2009-06-09] LPP-8121 I discovered that if an
        // input field is contained within a div which has a white
        // background color, then it selected text will highlight with
        // a dark blue color. The div can have zero width,
        // Windows/Firefox only seems to look at the bgcolor of the
        // containing div when deciding what color to use for input
        // text highlight. So this adds an extra div, with zero width,
        // in which the actual clickable/selectable input text element
        // is placed.
        var ffoxdiv = document.createElement('div');
        ffoxdiv.style.backgroundColor = 'white';
        ffoxdiv.style.width = 0;
        this.__LZclickcontainerdiv.appendChild(ffoxdiv);
        ffoxdiv.appendChild(this.__LZinputclickdiv);
      } else {
        this.__LZclickcontainerdiv.appendChild(this.__LZinputclickdiv);
      }
    }

    this.__LZdiv.appendChild(this.__LzInputDiv);

    //Debug.write(this.__LzInputDiv.style);
    this.__setTextEvents(true);
}

LzInputTextSprite.prototype.__createInputDiv = function(type) {
    var tagname = 'input';
    if (type === 'password') {
        this.multiline = false;
        this.__LzInputDiv = document.createElement(tagname);
        lz.embed.__setAttr(this.__LzInputDiv, 'type', 'password');
    } else if (type === 'multiline') {
        tagname = 'textarea';
        this.multiline = true;
        this.__LzInputDiv = document.createElement(tagname);
    } else {    
        this.multiline = false;
        this.__LzInputDiv = document.createElement(tagname);
        lz.embed.__setAttr(this.__LzInputDiv, 'type', 'text');
    }
    if (this.quirks.firefox_autocomplete_bug) {
        lz.embed.__setAttr(this.__LzInputDiv, 'autocomplete', 'off');
    }
    this.__LzInputDiv.owner = this;
    if (this.quirks.emulate_flash_font_metrics) {
        if (this.multiline) {
            this.className = this.__LzInputDiv.className = 'lzswfinputtextmultiline';
            // Update cached value
            this._whiteSpace = 'pre-wrap';
        } else {
            this.className = this.__LzInputDiv.className = 'lzswfinputtext';
        }
    } else {    
        this.className = this.__LzInputDiv.className = 'lzinputtext';
    }    
    if (this.owner) {
        lz.embed.__setAttr(this.__LzInputDiv, 'name', this.owner.name);
    }
    this.scrolldiv = this.__LzInputDiv;
    this.scrolldivtagname = tagname;
    this.scrolldiv.owner = this;
    // NOTE [2009-09-21 ptw] (LPP-8246) Multiline input texts must
    // always have scrolling on
    this.setScrolling(this.multiline);
    // scrollevents will be updated later, if it is explicitly set
}

LzInputTextSprite.prototype.setMultiline = function(ml) {
    var oldval = this.multiline;
    this.multiline = ml;
    if (this.multiline !== oldval) {
        // cache original values
        var olddiv = this.__LzInputDiv;
        // remove text events
        this.__setTextEvents(false);
        // make new div
        this.__createInputDiv(ml ? 'multiline' : '');
        // must set before appending
        var newdiv = this.__LzInputDiv;
        // NOTE: [2009-02-13 ptw] I don't know of a better way to do
        // this.  You can't just copy over the style declaration, that
        // does not work.
        lz.embed.__setAttr(newdiv, 'style', olddiv.style.cssText);
        if (this.quirks['fix_ie_css_syntax']) {
            newdiv.style.fontStyle = olddiv.style.fontStyle;
            newdiv.style.fontWeight = olddiv.style.fontWeight;
            newdiv.style.fontSize = olddiv.style.fontSize;
            newdiv.style.fontFamily = olddiv.style.fontFamily;
            newdiv.style.color = olddiv.style.color;
        }
        //Debug.debug('replacing %w with %w', olddiv, newdiv);
        var oldleft = olddiv.scrollLeft;
        var oldtop = olddiv.scrollTop;
        // destroy old
        this.__discardElement(olddiv);
        // put in place
        this.__LZdiv.appendChild(newdiv);
        // input elements do not scroll but multiline does, so we need
        // to update scrollevents per the owner
        this.setScrollEvents(this.owner.scrollevents);
        newdiv.scrollLeft = oldleft;
        newdiv.scrollTop = oldtop;
        // restore text events
        this.__setTextEvents(true);
        // restore text content
        this.setText(this.text, true);
    }
}

LzInputTextSprite.prototype.__show = function() {
    if (this.__shown == true || this.disabled == true) return;
    this.__hideIfNotFocused();
    LzInputTextSprite.prototype.__lastshown = this;
    this.__shown = true;

    if (this.quirks['inputtext_parents_cannot_contain_clip']) {
        var sprites = this.__findParents('clip', true);
        var l = sprites.length;
        if (l > 1) {
            if (this._shownclipvals == null) {
                //if ($debug) Debug.warn('IE may not show the contents of inputtexts whose intermediate parents have clipping on.  The following parents have clip set:', sprites);
                // store old values
                this._shownclipvals = [];
                this._shownclippedsprites = sprites;
                for (var n = 0; n < l; n++) {
                    var v = sprites[n];
                    this._shownclipvals[n] = v.__LZclickcontainerdiv.style.clip;
                    var noclip = this.quirks['fix_ie_css_syntax'] ? 'rect(auto auto auto auto)' : '';
                    v.__LZclickcontainerdiv.style.clip = noclip;
                }
            }
        }
    }
    // Hide the clickdivs, so we can interact with the mouse
    LzMouseKernel.setGlobalClickable(false);
    //Debug.warn('__show', this.owner);
    // turn on text selection in IE
    // can't use lz.embed.attachEventHandler because we need to cancel events selectively
    if (LzSprite.quirks.prevent_selection) {
        this.__LZdiv.onselectstart = this.__onselectstartHandler;
    }
}

LzInputTextSprite.prototype.__hideIfNotFocused = function(eventname) {
    var lzinppr = LzInputTextSprite.prototype;
    if (lzinppr.__lastshown == null) return;
    var quirks = LzSprite.quirks;
    if (quirks.textgrabsinputtextfocus) {
        // capture events in IE
        var s = window.event;
        if (s && s.srcElement && s.srcElement.owner && s.srcElement.owner instanceof LzTextSprite) {
            //Debug.write('text intercepting focus', eventname, s.owner instanceof LzTextSprite);
            if (eventname == 'onmousedown') {
                lzinppr.__lastshown.gotFocus();
            }
            return;
        }
    }
    if (lzinppr.__focusedSprite != lzinppr.__lastshown) {
        lzinppr.__lastshown.__hide();
    }
}

LzInputTextSprite.prototype.__hide = function(ignore) {
    if (this.__shown != true || this.disabled == true) return;
    if (LzInputTextSprite.prototype.__lastshown == this) {
        LzInputTextSprite.prototype.__lastshown = null;
    }
    this.__shown = false;
    if (this.quirks['inputtext_parents_cannot_contain_clip']) {
        if (this._shownclipvals != null) {
            // restore old values
            for (var n = 0; n < this._shownclipvals.length; n++) {
                var v = this._shownclippedsprites[n];
                v.__LZclickcontainerdiv.style.clip = this._shownclipvals[n];
            }
            this._shownclipvals = null;
            this._shownclippedsprites = null;
        }
    }
    // Put the clickdivs back in place, we are done interacting with
    // the mouse
    LzMouseKernel.setGlobalClickable(true);
    //Debug.warn('__hide', this.owner);

    // turn off text selection in IE
    // can't use lz.embed.attachEventHandler because we need to cancel events selectively
    if (LzSprite.quirks.prevent_selection) {
        if (LzInputTextSprite.prototype.__lastshown == null) {
            this.__LZdiv.onselectstart = LzTextSprite.prototype.__cancelhandler
        }
    }
}

// called by the LFC focus manager
LzInputTextSprite.prototype.gotBlur = function() {
    if (LzInputTextSprite.prototype.__focusedSprite != this) return;
    //Debug.write('blur', this.uid, LzKeyboardKernel.__cancelKeys);
    this.deselect();
}

// called by the LFC focus manager
LzInputTextSprite.prototype.gotFocus = function() {
    if (LzInputTextSprite.prototype.__focusedSprite == this) return;
    //Debug.write('focus', this.uid, LzKeyboardKernel.__cancelKeys);
    this.select();
}

LzInputTextSprite.prototype.setText = function(t) {
    // NOTE: [2009-0-28 ptw]  Wonder why _here_ we translate <br> to
    // carriage returns, yet in LzTextSprite/setText we translate
    // newlines to <br>?  Since we don't support htmlinputtext, I
    // claim we should not be doing this
    if (this.capabilities['htmlinputtext']) {
      if (t.indexOf('<br/>') != -1) {
          t = t.replace(this.br_to_newline_re, '\r') 
          //Debug.write('new text %w', t)
      }
    }
    this.text = t;
    this.__createInputText(t);
    this.__LzInputDiv.value = t;
    this.__updatefieldsize();
}

LzInputTextSprite.prototype.__setTextEvents = function(c) {
    //Debug.info('__setTextEvents', c);
    var div = this.__LzInputDiv;
    var f = c ? this.__textEvent : null;
    div.onblur = f;
    div.onfocus = f;
    if (this.quirks.ie_mouse_events) {
        div.onmouseleave = f;
    } else {
        div.onmouseout = f;
    }
    div.onmousemove = f;
    div.onmousedown = f;
    div.onmouseup = f;
    div.onkeyup = f;
    div.onkeydown = f;
    div.onkeypress = f;
    div.onchange = f;
    if (this.quirks.ie_paste_event || this.quirks.safari_paste_event) {
        div.onpaste = c ? function (e) { this.owner.__pasteHandlerEx(e) } : null;
    }
}

LzInputTextSprite.prototype.__pasteHandlerEx = function (evt) {
    var checkre = !!(this.restrict);
    var checkml = (this.multiline && this.owner.maxlength > 0);
    if (checkre || checkml) {
        // capture events in IE
        evt = evt || window.event;

        if (this.quirks.safari_paste_event) {
            var txt = evt.clipboardData.getData("text/plain");
        } else {
            var txt = window.clipboardData.getData("TEXT");
            txt = txt.replace(this.____crregexp, '\n');
        }

        var stopPaste = false;
        var selsize = this.getSelectionSize();
        if (selsize < 0) selsize = 0;//[TODO anba 2008-01-06] remove after LPP-5330

        if (checkre) {
            // remove invalid characters
            var matched = txt.match(this.restrict);
            if (matched == null) {
                var newtxt = "";
            } else {
                var newtxt = matched.join("");
            }
            stopPaste = (newtxt != txt);
            txt = newtxt;
        }

        if (checkml) {
            var max = this.owner.maxlength + selsize;
            if (this.quirks.text_ie_carriagereturn) {
                var len = this.__LzInputDiv.value.replace(this.____crregexp, '\n').length;
            } else {
                var len = this.__LzInputDiv.value.length;
            }
            
            var maxchars = max - len;
            if (maxchars > 0) {
                if (txt.length > maxchars) {
                    txt = txt.substring(0, maxchars);
                    stopPaste = true;
                }
            } else {
                txt = "";
                stopPaste = true;
            }
        }

        if (stopPaste) {
            evt.returnValue = false;
            if (evt.preventDefault) {
                evt.preventDefault();
            }

            if (txt.length > 0) {
                if (this.quirks.safari_paste_event) {
                    var val = this.__LzInputDiv.value;
                    var selpos = this.getSelectionPosition();

                    //update value
                    this.__LzInputDiv.value = val.substring(0, selpos) + txt + val.substring(selpos + selsize);

                    //fix selection
                    selpos += txt.length;
                    this.__LzInputDiv.setSelectionRange(selpos, selpos);
                } else {
                    var range = document.selection.createRange();
                    //this updates value and ensures right selection
                    range.text = txt;
                }
            }
        }
    }
}

LzInputTextSprite.prototype.__pasteHandler = function () {
    var selpos = this.getSelectionPosition();
    var selsize = this.getSelectionSize();
    var val = this.__LzInputDiv.value;
    var that = this;

    // use 1ms timeout to defer execution, so that UI can update its state
    setTimeout(function() {
        var checkre = !!(that.restrict);
        var checkml = (that.multiline && that.owner.maxlength > 0);
        var newval = that.__LzInputDiv.value;
        var newlen = newval.length;
        var max = that.owner.maxlength;

        if (checkre || (checkml && newlen > max)) {
            var len = val.length;
            // this text was pasted
            var newc = newval.substr(selpos, newlen - len + selsize);

            if (checkre) {
                // remove all invalid characters
                var matched = newc.match(that.restrict);
                newc = matched != null ? matched.join("") : "";
            }

            if (checkml) {
                // we can only take at max that many chars
                var maxchars = max + selsize - len;
                newc = newc.substring(0, maxchars);
            }

            //update value
            that.__LzInputDiv.value = val.substring(0, selpos) + newc + val.substring(selpos + selsize);

            //fix selection
            //note: we're in Firefox/Opera, so we can savely call "setSelectionRange"
            selpos += newc.length;
            that.__LzInputDiv.setSelectionRange(selpos, selpos);
        }
    }, 1);
}

// Called from the scope of the div - use owner property
LzInputTextSprite.prototype.__textEvent = function ( evt ){
    // capture events in IE
    evt = evt || window.event;
    var sprite = this.owner;
    if (sprite.__LZdeleted == true) return;
    if (sprite.__skipevent) {
        sprite.__skipevent = false;
        return;
    }

    var eventname = 'on' + evt.type;

    // rename ie-specific events to be compatible
    if (LzSprite.quirks.ie_mouse_events) {
        if (eventname === 'onmouseleave') {
            eventname = 'onmouseout';
        }
    }
    var quirks = sprite.quirks;

    // Process and forward mouse events, return so they aren't sent via 
    // inputtextevent()
    if (eventname === 'onmousedown' || eventname === 'onmouseup' || eventname === 'onmouseout' || eventname === 'onmousemove') {
        if (quirks.autoscroll_textarea) {
            // Keep track of left button state for autoscrolling (LPP-8277)
            if (eventname === 'onmousedown') {
                sprite.dragging = true;
            } else if (eventname === 'onmouseup' || eventname === 'onmouseout') {
                sprite.dragging = false;
            } else if (eventname === 'onmousemove') {
                if (sprite.dragging) {
                    // Simulate mouse scrolling near the top and bottom 
                    // see LPP-8277. This is Firefox specific code) per the  
                    // quirks.autoscroll_textarea quirk
                    var d = sprite.__LzInputDiv;
                    var y = evt.pageY - d.offsetTop;
                    if (y <= 3) {
                        d.scrollTop -= sprite.lineHeight ? sprite.lineHeight : 10;
                    }
                    if (y >= d.clientHeight-3) {
                        d.scrollTop += sprite.lineHeight ? sprite.lineHeight : 10;
                    }
                }
            }
        }
        if (eventname === 'onmouseout') {
            // Send 'onmouseout' event directly
            sprite.__mouseEvent(eventname);
        } else if (eventname === 'onmousedown') {
            sprite.__mouseisdown = true;
        } else if (eventname === 'onmouseup') {
            evt.cancelBubble = true;
            // if the mouse isn't over us, send an onmouseupoutside evemt
            if (! sprite.__isMouseOver()) {
                sprite.__globalmouseup(evt);
                // deselect ourselves
                sprite.deselect();
            } else {
                sprite.__mouseEvent(eventname);
            }
        }

        //Debug.info(eventname, this, sprite.__isMouseOver());
        // don't forward mouse events to inputtextevent()
        return;
    }

    // this only happens when tabbing in from outside the app
    if (sprite.__shown != true) {
        if (eventname === 'onfocus') {
            sprite.__skipevent = true;
            //sprite.select()
            sprite.__show();
            sprite.__LzInputDiv.blur();
            LzInputTextSprite.prototype.__lastfocus = sprite;
            LzKeyboardKernel.setKeyboardControl(true);
        }
    }

    // key events
    var view = this.owner.owner;
    if (eventname === 'onfocus') {
        LzMouseKernel.setGlobalClickable(false);
        LzInputTextSprite.prototype.__focusedSprite = sprite;
        sprite.__show();
        if (sprite._cancelfocus) {
            sprite._cancelfocus = false;
            return;
        }
        if (window['LzKeyboardKernel']) LzKeyboardKernel.__cancelKeys = false;
    } else if (eventname === 'onblur') {
        if (window['LzKeyboardKernel']) LzKeyboardKernel.__cancelKeys = true;
        if (LzInputTextSprite.prototype.__focusedSprite === sprite) {
            LzInputTextSprite.prototype.__focusedSprite = null;         
        }
//        if (sprite.__fix_inputtext_with_parent_resource && sprite.__isMouseOver()) {
//            //Debug.write('undo blur')
//            sprite.select();
//            return;
//        }
        sprite.__hide();
        if (sprite._cancelblur) {
            sprite._cancelblur = false;
            return;
        }
    } else if (eventname === 'onkeypress') {
        if (sprite.restrict || (sprite.multiline && view.maxlength && view.maxlength < Infinity)) {
            var keycode = evt.keyCode;
            var charcode = quirks.text_event_charcode ? evt.charCode : evt.keyCode;
            // only printable characters or carriage return (modifier keys must not be active)
            var validChar = (!(evt.ctrlKey || evt.altKey) && (charcode >= 32 || keycode === 13));
            //Debug.write("charCode = %s, keyCode = %s, ctrlKey = %s, altKey = %s, shiftKey = %s", charcode, keycode, evt.ctrlKey, evt.altKey, evt.shiftKey);

            if (validChar) {
                var prevent = false;
                if (keycode != 13 && sprite.restrict) {
                    // only permit characters that match the restrict RegExp
                    prevent = (0 > String.fromCharCode(charcode).search(sprite.restrict));
                }
                if (! prevent) {
                    var selsize = sprite.getSelectionSize();
                    //[TODO anba 2008-01-06] use selsize===0 when LPP-5330 is fixed
                    if (selsize <= 0) {
                    if (quirks.text_ie_carriagereturn) {
                            var val = sprite.__LzInputDiv.value.replace(sprite.____crregexp, '\n');
                        } else {
                            var val = sprite.__LzInputDiv.value;
                        }

                        var len = val.length, max = view.maxlength;
                        if (len >= max) {
                            prevent = true;
                        }
                    }
                }
                if (prevent) {
                    evt.returnValue = false;
                    if (evt.preventDefault) {
                        evt.preventDefault();
                    }
                }
            } else {
                // IE and Safari do not send 'onkeypress' for function-keys,
                // but Firefox and Opera!
                if (quirks.keypress_function_keys) {
                    var ispaste = false;
                    if (evt.ctrlKey && !evt.altKey && !evt.shiftKey) {
                        var c = String.fromCharCode(charcode);
                        // paste by ctrl + v ('v' for Firefox and 'V' for Opera)
                        ispaste = (c === 'v' || c === 'V');
                    } else if (evt.shiftKey && !evt.altKey && !evt.ctrlKey) {
                        // paste by shift + insert (Windows)
                        ispaste = (keycode === 45);
                    }
                    if (ispaste) {
                        //[TODO anba 2008-01-06] how to detect paste per context-menu?
                        //[TODO anba 2008-10-06] (LPP-5406) Firefox3 added context-menu events
                        if (sprite.restrict) {
                            // always call paste-handler if restrict was set
                            sprite.__pasteHandler();
                        } else {
                            var len = sprite.__LzInputDiv.value.length, max = view.maxlength;
                            if (len < max || sprite.getSelectionSize() > 0) {
                                sprite.__pasteHandler();
                            } else {
                                evt.returnValue = false;
                                if (evt.preventDefault) {
                                    evt.preventDefault();
                                }
                            }
                        }
                    }
                }
            }
            sprite.__updatefieldsize();
        }
        // don't forward 'onkeypress' to inputtextevent()
        return;
    }

    if (view) {
        // Generate the event. onkeyup/onkeydown sent by lz.Keys.js
        if (eventname === 'onkeydown' || eventname === 'onkeyup') {
            var d = sprite.__LzInputDiv;
            var v = d.value;
            if (v != sprite.text) {
                sprite.text = v;
                if (sprite.multiline) {
                    // When resizing the div to it's to scrollHeight,
                    // in some browsers there is still a visual
                    // artifact, a "jump", when you add a new line to
                    // the end of the field. However that seems to be
                    // the state of the art right now.
                    if (sprite.quirks['forcemeasurescrollheight']) {
                        // NOTE: To get a reliable value for
                        // scrollheight in IE7, first set the field
                        // height to zero before looking at
                        // style.scrollheight.
                        // Also, Safari needs height forced to zero or else
                        // it leaves text scrolled improperly.
                        d.style.height = 0;

                        var oldscroll = d.scrollTop;
                        d.scrollTop = 0;

                        // restore to old values
                        if (sprite._h != 0) {
                            // use cached CSS height value
                            d.style.height = sprite._h;
                        }

                        if (oldscroll != 0) {
                            d.scrollTop = oldscroll;
                        }
                    }
                }

                // height will be reset
                view.inputtextevent('onchange', v);
            }
            if (quirks.autoscroll_textarea && eventname === 'onkeydown' && d.selectionStart === v.length) {
                // Text added at end. Make sure the text is shown. (LPP-8277)
                // (The +20 is to make sure the last line is shown)
                d.scrollTop = d.scrollHeight - d.clientHeight + 20;
            }
        } else {
            //console.log('__textEvent', eventname, keycode);
            view.inputtextevent(eventname);
        }
    }
}

LzInputTextSprite.prototype.$LzTextSprite$setClickable = LzTextSprite.prototype.setClickable;
LzInputTextSprite.prototype.setClickable = function(clickable) {
    // capture the true clickable value for mouse events
    this.__clickable = clickable;
    // ensure we remain clickable, always call the super() method with true
    this.$LzTextSprite$setClickable(true);
}

LzInputTextSprite.prototype.setEnabled = function ( val ){
    this.disabled = ! val;
    this.__LzInputDiv.disabled = this.disabled;    
}

LzInputTextSprite.prototype.setMaxLength = function ( val ){
    // Runtime does not understand Infinity (Actually Safari and Opera
    // do, but Mozilla does not, probably neither does IE).  The
    // clever ~>>> expression computes MOST_POSITIVE_FIXNUM.
    if (val == Infinity) { val = ~0>>>1; }
    var t = this.getText();
    this.__LzInputDiv.maxLength = val;    

    if(t && t.length > val){
      this.owner._updateSize();
    }
}

LzInputTextSprite.prototype.select = function (){
    //this._cancelblur = true;
    this.__show();
    // Setting focus can generate an error in IE7/dhtml (LPP-6142)
    try {
        this.__LzInputDiv.focus();
    } catch (err) {}
    LzInputTextSprite.prototype.__lastfocus = this;
    setTimeout(LzInputTextSprite.prototype.__selectLastFocused, 50);
    //this.__LzInputDiv.select();
    if (window['LzKeyboardKernel']) LzKeyboardKernel.__cancelKeys = false;
    //Debug.write('select', this.uid, LzKeyboardKernel.__cancelKeys);
}

LzInputTextSprite.prototype.__selectLastFocused = function () {
    if (LzInputTextSprite.prototype.__lastfocus != null) {
        LzInputTextSprite.prototype.__lastfocus.__LzInputDiv.select()
    }
}


LzInputTextSprite.prototype.setSelection = function (start, end=null){
    if (end == null) { end = start; }
    this._cancelblur = true;
    this.__show();
    LzInputTextSprite.prototype.__lastfocus = this;

    if (this.quirks['text_selection_use_range']) {
        var range = this.__LzInputDiv.createTextRange(); 

        // look for leading \r\n
        var val = this.__LzInputDiv.value;

        if (start > end){
            var st = start;
            start = end;
            end = st;
        }

        if(this.multiline) { 
            var offset = 0;
            // account for leading \r\n
            var startcounter = 0;
            while (offset < start) {
                offset = val.indexOf('\r\n', offset + 2); 
                if (offset == -1) break;
                startcounter++;
            }
            var midcounter = 0;
            while (offset < end) {
                offset = val.indexOf('\r\n', offset + 2); 
                if (offset == -1) break;
                midcounter++;
            }
            var endcounter = 0;
            while (offset < val.length) {
                offset = val.indexOf('\r\n', offset + 2); 
                if (offset == -1) break;
                endcounter++;
            }

            var tl = range.text.length;
            var st = start;
            var ed = end - val.length + startcounter + midcounter + endcounter + 1;

            //if (endcounter) endcounter += startcounter;
            //alert (startcounter + ', ' + midcounter + ', ' + endcounter + ', ' + st + ', ' + ed);
        } else {
            var st = start;
            var ed = end - range.text.length;
        }

        range.moveStart("character", st);
        range.moveEnd("character", ed);
        range.select();
        //this.__LzInputDiv.range = range;
        //setTimeout('LzInputTextSprite.prototype.__lastfocus.__LzInputDiv.range.select()', 50);
        //this.__LzInputDiv.focus(); 
    } else {
        this.__LzInputDiv.setSelectionRange(start, end);
    }     
    this.__LzInputDiv.focus();

    if (window['LzKeyboardKernel']) LzKeyboardKernel.__cancelKeys = false;
}

LzInputTextSprite.prototype.getSelectionPosition = function (){
    if (! this.__shown || this.disabled == true) return -1;
    if (this.quirks['text_selection_use_range']) {
        if (this.multiline) {
            var p = this._getTextareaSelection();
        } else {
            var p = this._getTextSelection();
        }

        if (p) {
            return p.start;
        } else {
            return -1;
        }
    } else {
        return this.__LzInputDiv.selectionStart;
    }
}

LzInputTextSprite.prototype.getSelectionSize = function (){
    if (! this.__shown || this.disabled == true) return -1;
    if (this.quirks['text_selection_use_range']) {
        if (this.multiline) {
            var p = this._getTextareaSelection();
        } else {
            var p = this._getTextSelection();
        }
        if (p) {
            return p.end - p.start;
        } else {
            return -1;
        }
    } else {
        return this.__LzInputDiv.selectionEnd - this.__LzInputDiv.selectionStart;
    }
}

if (LzSprite.quirks['text_selection_use_range']) {
LzInputTextSprite.prototype._getTextSelection = function (){
    this.__LzInputDiv.focus();

    var range = document.selection.createRange();
    var bookmark = range.getBookmark();

    var originalContents = contents = this.__LzInputDiv.value;
    do {
        var marker = "~~~" + Math.random() + "~~~";
    } while (contents.indexOf(marker) != -1)

    var parent = range.parentElement();
    if (parent == null || ! (parent.type == "text" || parent.type == "textarea")) {
        return;
    }
    range.text = marker + range.text + marker;
    contents = this.__LzInputDiv.value;

    var result = {};
    result.start = contents.indexOf(marker);
    contents = contents.replace(marker, "");
    result.end = contents.indexOf(marker);

    this.__LzInputDiv.value = originalContents;
    range.moveToBookmark(bookmark);
    range.select();

    return result;
}

LzInputTextSprite.prototype._getTextareaSelection = function (){
    var textarea = this.__LzInputDiv; 
    var selection_range = document.selection.createRange().duplicate();

    if (selection_range.parentElement() == textarea) {    // Check that the selection is actually in our textarea
    // Create three ranges, one containing all the text before the selection,
    // one containing all the text in the selection (this already exists), and one containing all
    // the text after the selection.
    var before_range = document.body.createTextRange();
    before_range.moveToElementText(textarea);                    // Selects all the text
    before_range.setEndPoint("EndToStart", selection_range);     // Moves the end where we need it

    var after_range = document.body.createTextRange();
    after_range.moveToElementText(textarea);                     // Selects all the text
    after_range.setEndPoint("StartToEnd", selection_range);      // Moves the start where we need it

    var before_finished = false, selection_finished = false, after_finished = false;
    var before_text, untrimmed_before_text, selection_text, untrimmed_selection_text, after_text, untrimmed_after_text;

    // Load the text values we need to compare
    before_text = untrimmed_before_text = before_range.text;
    selection_text = untrimmed_selection_text = selection_range.text;
    after_text = untrimmed_after_text = after_range.text;

    // Check each range for trimmed newlines by shrinking the range by 1 character and seeing
    // if the text property has changed.  If it has not changed then we know that IE has trimmed
    // a \r\n from the end.
    do {
    if (!before_finished) {
        if (before_range.compareEndPoints("StartToEnd", before_range) == 0) {
            before_finished = true;
        } else {
            before_range.moveEnd("character", -1)
            if (before_range.text == before_text) {
                untrimmed_before_text += "\r\n";
            } else {
                before_finished = true;
            }
        }
    }
    if (!selection_finished) {
        if (selection_range.compareEndPoints("StartToEnd", selection_range) == 0) {
            selection_finished = true;
        } else {
            selection_range.moveEnd("character", -1)
            if (selection_range.text == selection_text) {
                untrimmed_selection_text += "\r\n";
            } else {
                selection_finished = true;
            }
        }
    }
    if (!after_finished) {
        if (after_range.compareEndPoints("StartToEnd", after_range) == 0) {
            after_finished = true;
        } else {
            after_range.moveEnd("character", -1)
            if (after_range.text == after_text) {
                untrimmed_after_text += "\r\n";
            } else {
                after_finished = true;
            }
        }
    }

    } while ((!before_finished || !selection_finished || !after_finished));

    // Untrimmed success test to make sure our results match what is actually in the textarea
    // This can be removed once you're confident it's working correctly
    var untrimmed_text = untrimmed_before_text + untrimmed_selection_text + untrimmed_after_text;
    var untrimmed_successful = false;
    if (textarea.value == untrimmed_text) {
    untrimmed_successful = true;
    }
    // ** END Untrimmed success test

    var startPoint = untrimmed_before_text.length;
    var endPoint = startPoint + untrimmed_selection_text.length;
    var selected_text = untrimmed_selection_text;

    //alert("Start Index: " + startPoint + "\nEnd Index: " + endPoint + "\nSelected Text\n'" + selected_text + "'");

    // account for leading \r\n
    var val = this.__LzInputDiv.value;
    var offset = 0;
    var startcounter = 0;
    while (offset < startPoint) {
        offset = val.indexOf('\r\n', offset + 2); 
        if (offset == -1) break;
        startcounter++;
    }
    var midcounter = 0;
    while (offset < endPoint) {
        offset = val.indexOf('\r\n', offset + 2); 
        if (offset == -1) break;
        midcounter++;
    }
    var endcounter = 0;
    while (offset < val.length) {
        offset = val.indexOf('\r\n', offset + 2); 
        if (offset == -1) break;
        endcounter++;
    }

    startPoint -= startcounter;
    endPoint -= (midcounter + startcounter);

    //Debug.write(startcounter + ', ' + midcounter + ', ' + endcounter + ', ' + startPoint + ', ' + endPoint);
    return {start: startPoint, end: endPoint};
    }
}
}

LzInputTextSprite.prototype.deselect = function (){
    //this._cancelfocus = true;
    this.__hide();
    if (this.__LzInputDiv && this.__LzInputDiv.blur) this.__LzInputDiv.blur();
    if (window['LzKeyboardKernel']) LzKeyboardKernel.__cancelKeys = true;
    //Debug.write('deselect', this.uid, LzKeyboardKernel.__cancelKeys);
}    

// Should reflect CSS defaults in LzSprite.js
LzInputTextSprite.prototype.__fontStyle = 'normal';
LzInputTextSprite.prototype.__fontWeight = 'normal';
LzInputTextSprite.prototype.__fontSize = '11px';
LzInputTextSprite.prototype.__fontFamily = 'Verdana,Vera,sans-serif';

LzInputTextSprite.prototype.$LzTextSprite$setFontSize = LzTextSprite.prototype.setFontSize;
LzInputTextSprite.prototype.setFontSize = function (fsize) {
    this.$LzTextSprite$setFontSize(fsize);
    if (this.__fontSize != this._fontSize) { 
        this.__fontSize = this._fontSize;
        this.__LzInputDiv.style.fontSize = this._fontSize;
    }    
}

LzInputTextSprite.prototype.$LzTextSprite$setFontStyle = LzTextSprite.prototype.setFontStyle;
LzInputTextSprite.prototype.setFontStyle = function (fstyle) {
    this.$LzTextSprite$setFontStyle(fstyle);
    if (this.__fontStyle != this._fontStyle) {  
        this.__fontStyle = this._fontStyle;
        this.__LzInputDiv.style.fontStyle = this._fontStyle;
    }    
    if (this.__fontWeight != this._fontWeight) {  
        this.__fontWeight = this._fontWeight;
        this.__LzInputDiv.style.fontWeight = this._fontWeight;
    }    
}

LzInputTextSprite.prototype.$LzTextSprite$setFontName = LzTextSprite.prototype.setFontName;
LzInputTextSprite.prototype.setFontName = function (fname) {
    this.$LzTextSprite$setFontName(fname);
    if (this.__fontFamily != this._fontFamily) {  
        this.__fontFamily = this._fontFamily;
        this.__LzInputDiv.style.fontFamily = this._fontFamily;
    }    
}

LzInputTextSprite.prototype.$LzTextSprite$setWidth = LzTextSprite.prototype.setWidth;
LzInputTextSprite.prototype.__iwidthcss = 0;
LzInputTextSprite.prototype.setWidth = function (w) {
    if (w == null || w < 0 || isNaN(w)) return;
    // call the super method
    var nw = this.$LzTextSprite$setWidth(w);
    // no change
    if (nw == null) return;

    if (this.quirks.fix_clickable && nw !== null) {
        nw = this.CSSDimension(nw);
        if (nw !== this.__iwidthcss) {
            //console.log('nw', nw, w);
            this.__iwidthcss = nw;
            this.__LZinputclickdiv.style.width = nw;
        }   
    }
}

LzInputTextSprite.prototype.$LzTextSprite$setHeight = LzTextSprite.prototype.setHeight;
LzInputTextSprite.prototype.__iheightcss = 0;
LzInputTextSprite.prototype.setHeight = function (h) {
    if (h == null || h < 0 || isNaN(h)) return;
    // call the super method
    var nh = this.$LzTextSprite$setHeight(h);
    // no change
    if (nh == null) return;

    if (this.quirks.fix_clickable && nh !== null) {
        nh = this.CSSDimension(nh);
        if (nh !== this.__iheightcss) {
            //console.log('nh', nh, h);
            this.__iheightcss = nh;
            this.__LZinputclickdiv.style.height = nh;
        }
    }
}   

// Must match LzSprite implementation
LzInputTextSprite.prototype.setColor = function (c) {
    if (this.color == c) return;
    this.color = c;
    this.__LzInputDiv.style.color = LzColorUtils.inttohex(c);
}

LzInputTextSprite.prototype.getText = function () {
    if (this.multiline && this.quirks.text_ie_carriagereturn) {
        return this.__LzInputDiv.value.replace(this.____crregexp, '\n');
    } else {
        return this.__LzInputDiv.value;
    }
}

/**
 * If a mouse event occurs in an input text field, find the focused view
 */
LzInputTextSprite.findSelection = function ( ){
    if (LzInputTextSprite.__focusedSprite 
        && LzInputTextSprite.__focusedSprite.owner) {
        return LzInputTextSprite.__focusedSprite.owner;
    }
}

LzInputTextSprite.prototype.setTextColor = function ( c ){
    if (this.textcolor === c) return;
    this.textcolor = c;
    this.scrolldiv.style.color = LzColorUtils.inttohex(c);
}
