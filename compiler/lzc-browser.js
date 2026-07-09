// dist/xml.js
var ENTITIES = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'"
};
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 1114111 ? String.fromCodePoint(code) : m;
    }
    return body in ENTITIES ? ENTITIES[body] : m;
  });
}
function parseXml(src, opts) {
  const keepComments = opts?.keepComments === true;
  let i = 0;
  const n = src.length;
  const nls = [];
  for (let k = 0; k < n; k++)
    if (src[k] === "\n")
      nls.push(k);
  function lineAt(pos) {
    let lo = 0, hi = nls.length;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (nls[mid] < pos)
        lo = mid + 1;
      else
        hi = mid;
    }
    return lo + 1;
  }
  function colAt(pos) {
    let lo = 0, hi = nls.length;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (nls[mid] < pos)
        lo = mid + 1;
      else
        hi = mid;
    }
    const prevNl = lo > 0 ? nls[lo - 1] : -1;
    return pos - prevNl;
  }
  function error(msg) {
    let line = 1, col = 1;
    for (let k = 0; k < i && k < n; k++) {
      if (src[k] === "\n") {
        line++;
        col = 1;
      } else
        col++;
    }
    throw new Error(`XML parse error at ${line}:${col}: ${msg}`);
  }
  function skipMisc() {
    for (; ; ) {
      while (i < n && /\s/.test(src[i]))
        i++;
      if (src.startsWith("<!--", i)) {
        const end = src.indexOf("-->", i + 4);
        if (end < 0)
          error("unterminated comment");
        i = end + 3;
        continue;
      }
      if (src.startsWith("<?", i)) {
        const end = src.indexOf("?>", i + 2);
        if (end < 0)
          error("unterminated processing instruction");
        i = end + 2;
        continue;
      }
      if (src.startsWith("<!", i)) {
        const end = src.indexOf(">", i + 2);
        if (end < 0)
          error("unterminated declaration");
        i = end + 1;
        continue;
      }
      break;
    }
  }
  function parseName() {
    const start = i;
    while (i < n && /[^\s/>=]/.test(src[i]))
      i++;
    if (i === start)
      error("expected name");
    return src.slice(start, i);
  }
  function parseElement() {
    if (src[i] !== "<")
      error("expected '<'");
    const startLine = lineAt(i);
    i++;
    const name = parseName();
    const attrs = {};
    const attrOrder = [];
    const attrLines = {};
    let endTagLine = startLine;
    let endTagCol = 0;
    for (; ; ) {
      while (i < n && /\s/.test(src[i]))
        i++;
      if (src[i] === "/" && src[i + 1] === ">") {
        const endLine = lineAt(i + 1);
        const endCol = colAt(i + 1);
        i += 2;
        return { type: "elem", name, attrs, attrOrder, attrLines, children: [], line: startLine, endLine, endCol, closeLine: endLine };
      }
      if (src[i] === ">") {
        endTagLine = lineAt(i);
        endTagCol = colAt(i);
        i++;
        break;
      }
      const attrLine = lineAt(i);
      const aname = parseName();
      while (i < n && /\s/.test(src[i]))
        i++;
      let aval = "";
      if (src[i] === "=") {
        i++;
        while (i < n && /\s/.test(src[i]))
          i++;
        const q = src[i];
        if (q !== '"' && q !== "'")
          error("expected quoted attribute value");
        i++;
        const start = i;
        while (i < n && src[i] !== q)
          i++;
        if (i >= n)
          error("unterminated attribute value");
        aval = decodeEntities(src.slice(start, i).replace(/[\t\r\n]/g, " "));
        i++;
      }
      if (!(aname in attrs)) {
        attrOrder.push(aname);
        attrLines[aname] = attrLine;
      }
      attrs[aname] = aval;
    }
    const children = [];
    let closeLine = endTagLine;
    for (; ; ) {
      if (i >= n)
        error(`unterminated element <${name}>`);
      if (src.startsWith("</", i)) {
        closeLine = lineAt(i);
        i += 2;
        const close = parseName();
        while (i < n && /\s/.test(src[i]))
          i++;
        if (src[i] !== ">")
          error("expected '>' in closing tag");
        i++;
        if (close !== name)
          error(`mismatched closing tag </${close}> for <${name}>`);
        break;
      }
      if (src.startsWith("<!--", i)) {
        const end = src.indexOf("-->", i + 4);
        if (end < 0)
          error("unterminated comment");
        if (keepComments) {
          children.push({ type: "text", value: src.slice(i + 4, end), cdata: false, comment: true, line: lineAt(i + 4) });
        }
        i = end + 3;
        continue;
      }
      if (src.startsWith("<![CDATA[", i)) {
        const end = src.indexOf("]]>", i + 9);
        if (end < 0)
          error("unterminated CDATA");
        children.push({ type: "text", value: src.slice(i + 9, end), cdata: true, line: lineAt(i + 9) });
        i = end + 3;
        continue;
      }
      if (src.startsWith("<?", i)) {
        const end = src.indexOf("?>", i + 2);
        if (end < 0)
          error("unterminated PI");
        i = end + 2;
        continue;
      }
      if (src[i] === "<") {
        children.push(parseElement());
        continue;
      }
      const start = i;
      while (i < n && src[i] !== "<")
        i++;
      children.push({ type: "text", value: decodeEntities(src.slice(start, i)), cdata: false, line: lineAt(start) });
    }
    return { type: "elem", name, attrs, attrOrder, attrLines, children, line: startLine, endLine: endTagLine, endCol: endTagCol, closeLine };
  }
  skipMisc();
  const root = parseElement();
  return root;
}

// dist/value.js
var HEX = "0123456789ABCDEF";
function hexchar(c) {
  return HEX[c & 15];
}
function jsString(s) {
  let quote = '"';
  if (s.indexOf("'") >= 0 || s.indexOf('"') >= 0) {
    let n = 0;
    for (const ch of s) {
      if (ch === "'")
        n--;
      else if (ch === '"')
        n++;
    }
    quote = n > 0 ? "'" : '"';
  }
  let out = quote;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    const i = s.charCodeAt(k);
    switch (c) {
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\b":
        out += "\\b";
        break;
      case "	":
        out += "\\t";
        break;
      case "\v":
        out += "\\v";
        break;
      case "\f":
        out += "\\f";
        break;
      case "\\":
        out += "\\\\";
        break;
      case "'":
      case '"':
        if (c === quote)
          out += "\\";
        out += c;
        break;
      default:
        if (i === 0)
          out += "\\0";
        else if (i < 32 || i >= 128 && i <= 255)
          out += "\\x" + hexchar(i >> 4) + hexchar(i);
        else if (i > 255)
          out += "\\u" + hexchar(i >> 12) + hexchar(i >> 8) + hexchar(i >> 4) + hexchar(i);
        else
          out += c;
    }
  }
  return out + quote;
}
function jsNumber(v) {
  if (Number.isInteger(v))
    return String(v);
  return String(v);
}
function javaDouble(v) {
  if (Number.isInteger(v))
    return v.toFixed(1);
  return String(v);
}
function emitTyped(t) {
  switch (t.kind) {
    case "number":
      return jsNumber(t.v);
    case "double":
      return javaDouble(t.v);
    case "string":
      return jsString(t.v);
    case "boolean":
      return t.v ? "true" : "false";
    case "raw":
      return t.v;
  }
}
var RESERVED = /* @__PURE__ */ new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "null",
  "true",
  "false"
]);
function emitKey(k) {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) && !RESERVED.has(k))
    return k;
  return jsString(k);
}
function emitObject(entries) {
  const keys = Object.keys(entries).sort();
  return "{" + keys.map((k) => `${emitKey(k)}:${entries[k]}`).join(",") + "}";
}
function emitObjectSpaced(entries) {
  const keys = Object.keys(entries).sort();
  if (keys.length === 0)
    return "{}";
  return "{" + keys.map((k) => `${emitKey(k)}: ${entries[k]}`).join(", ") + "}";
}

// dist/schema-types.js
var SCHEMA = { "interface": { "ext": "Object", "attrs": { "name": "string" } }, "Instance": { "ext": "Object", "attrs": {} }, "handler": { "ext": "Instance", "attrs": {} }, "event": { "ext": "Instance", "attrs": {} }, "font": { "ext": "Instance", "attrs": {} }, "node": { "ext": "Instance", "attrs": { "classroot": "string", "cloneManager": "string", "datapath": "string", "defaultplacement": "string", "id": "ID", "ignoreplacement": "boolean", "immediateparent": "string", "inited": "boolean", "initstage": "string", "name": "token", "nodeLevel": "number", "options": "css", "parent": "string", "placement": "string", "styleclass": "string", "subnodes": "string", "transition": "string", "$lzc$bind_id": "expression", "$delegates": "expression", "$lzc$bind_name": "expression", "with": "string" } }, "animatorgroup": { "ext": "node", "attrs": { "attribute": "token", "duration": "number", "from": "number", "indirect": "boolean", "isactive": "boolean", "motion": "string", "paused": "boolean", "process": "string", "relative": "boolean", "repeat": "number", "start": "boolean", "started": "boolean", "target": "reference", "to": "number" } }, "animator": { "ext": "animatorgroup", "attrs": {} }, "contextmenu": { "ext": "node", "attrs": {} }, "contextmenuitem": { "ext": "node", "attrs": { "delegate": "expression", "caption": "string", "enabled": "boolean", "separatorbefore": "boolean", "visible": "boolean" } }, "datapointer": { "ext": "node", "attrs": { "context": "string", "p": "string", "rerunxpath": "boolean", "xpath": "string" } }, "datapath": { "ext": "datapointer", "attrs": { "axis": "string", "pooling": "boolean", "replication": "string", "sortorder": "string", "sortpath": "string", "spacing": "number" } }, "dataset": { "ext": "node", "attrs": { "acceptencodings": "boolean", "autorequest": "boolean", "cacheable": "boolean", "clientcacheable": "boolean", "dataprovider": "expression", "getresponseheaders": "boolean", "multirequest": "boolean", "nsprefix": "boolean", "params": "string", "postbody": "string", "proxied": "inheritableBoolean", "proxyurl": "string", "querystring": "string", "querytype": "string", "rawdata": "string", "request": "boolean", "secureport": "number", "src": "string", "timeout": "number", "trimwhitespace": "boolean", "type": "string", "queuerequests": "boolean", "datafromchild": "boolean" } }, "import": { "ext": "node", "attrs": { "href": "string", "proxied": "inheritableBoolean", "stage": "string" } }, "script": { "ext": "node", "attrs": { "src": "string", "type": "string", "when": "string" } }, "state": { "ext": "node", "attrs": { "applied": "boolean", "pooling": "boolean" } }, "view": { "ext": "node", "attrs": { "aaactive": "boolean", "aadescription": "string", "aaname": "string", "aasilent": "boolean", "aatabindex": "number", "align": "string", "backgroundrepeat": "string", "bgcolor": "color", "cachebitmap": "boolean", "capabilities": "string", "clickable": "boolean", "clickregion": "string", "clip": "boolean", "colortransform": "expression", "context": "expression", "contextmenu": "string", "cornerradius": "string", "cursor": "token", "fgcolor": "color", "focusable": "boolean", "focustrap": "boolean", "font": "string", "fontsize": "size", "fontstyle": "string", "frame": "numberExpression", "framesloadratio": "number", "hassetheight": "boolean", "hassetwidth": "boolean", "height": "size", "layout": "css", "loadratio": "number", "mask": "string", "opacity": "number", "pixellock": "boolean", "playing": "boolean", "resource": "string", "resourceheight": "number", "resourcewidth": "number", "rotation": "numberExpression", "shadowangle": "number", "shadowblurradius": "number", "shadowcolor": "color", "shadowdistance": "number", "showhandcursor": "boolean", "source": "string", "stretches": "string", "subviews": "string", "tintcolor": "string", "totalframes": "number", "unstretchedheight": "number", "unstretchedwidth": "number", "usegetbounds": "boolean", "valign": "string", "visibility": "string", "visible": "boolean", "width": "size", "x": "numberExpression", "xoffset": "numberExpression", "xscale": "numberExpression", "y": "numberExpression", "yoffset": "numberExpression", "yscale": "numberExpression" } }, "canvas": { "ext": "view", "attrs": { "allowfullscreen": "boolean", "appbuilddate": "string", "dataloadtimeout": "numberExpression", "datasets": "string", "defaultdataprovider": "string", "embedfonts": "boolean", "framerate": "number", "fullscreen": "boolean", "httpdataprovider": "string", "lpsbuild": "string", "lpsbuilddate": "string", "lpsrelease": "string", "lpsversion": "string", "mediaerrortimeout": "numberExpression", "medialoadtimeout": "numberExpression", "percentcreated": "number", "proxied": "inheritableBoolean", "runtime": "string", "scriptlimits": "css", "version": "string", "compileroptions": "string", "debug": "boolean", "title": "string", "id": "ID", "history": "boolean", "accessible": "boolean" } }, "text": { "ext": "view", "attrs": { "antiAliasType": "string", "direction": "string", "gridFit": "string", "hasdirectionallayout": "boolean", "hscroll": "number", "letterspacing": "number", "lineheight": "number", "maxhscroll": "number", "maxlength": "numberExpression", "maxscroll": "number", "multiline": "boolean", "pattern": "string", "resize": "boolean", "scroll": "number", "scrollevents": "boolean", "scrollheight": "number", "scrollwidth": "number", "selectable": "boolean", "sharpness": "number", "text": "text", "textalign": "string", "textdecoration": "string", "textindent": "number", "thickness": "number", "xscroll": "number", "yscroll": "number", "embedfonts": "boolean" } }, "inputtext": { "ext": "text", "attrs": { "enabled": "boolean", "password": "boolean" } }, "params": { "ext": "Instance", "attrs": {} }, "library": { "ext": "canvas", "attrs": { "href": "string", "includes": "string", "proxied": "inheritableBoolean", "validate": "boolean" } }, "mixin": { "ext": "interface", "attrs": {} }, "class": { "ext": "interface", "attrs": { "extends": "token", "with": "token", "implements": "token" } }, "audio": { "ext": "Instance", "attrs": { "src": "string", "id": "ID", "name": "token" } }, "resource": { "ext": "Instance", "attrs": { "src": "string", "name": "token", "offsetx": "number", "offsety": "number" } }, "frame": { "ext": "node", "attrs": { "src": "string" } }, "splash": { "ext": "Instance", "attrs": { "hideafterinit": "boolean", "persistent": "boolean" } }, "splashview": { "ext": "Instance", "attrs": { "name": "token", "resource": "string", "ratio": "string", "x": "number", "y": "number", "center": "boolean" } }, "include": { "ext": "Instance", "attrs": { "href": "string", "type": "string" } }, "stylesheet": { "ext": "Instance", "attrs": { "src": "string" } }, "preloadresource": { "ext": "view", "attrs": { "name": "token", "ratio": "string", "synctoload": "boolean", "hideafterinit": "boolean", "center": "boolean", "synchronized": "boolean", "lastframe": "number", "resource": "string", "resourcename": "string" } }, "security": { "ext": "Instance", "attrs": {} } };
function schemaAttrType(tag, name) {
  let c = tag;
  while (c) {
    const cls = SCHEMA[c];
    if (!cls)
      return null;
    if (name in cls.attrs)
      return cls.attrs[name];
    c = cls.ext;
  }
  return null;
}
var SCHEMA_EVENTS = { "node": ["onconstruct", "ondata", "oninit"], "animatorgroup": ["onrepeat", "onstart", "onstop"], "contextmenu": ["onmenuopen"], "contextmenuitem": ["onselect"], "datapointer": ["onerror", "ontimeout"], "dataset": ["onerror", "ontimeout"], "import": ["onerror", "onload", "ontimeout"], "state": ["onapply", "onremove"], "view": ["onaddsubview", "onbackgroundrepeat", "onblur", "onclick", "onclickable", "onclip", "oncontext", "oncornerradius", "ondblclick", "onerror", "onfocus", "onframe", "onframesloadratio", "onheight", "onkeydown", "onkeyup", "onlastframe", "onload", "onloadratio", "onmousedown", "onmousedragin", "onmousedragout", "onmouseout", "onmouseover", "onmousetrackout", "onmousetrackover", "onmousetrackup", "onmouseup", "onmouseupoutside", "onopacity", "onplay", "onremovesubview", "onshadowangle", "onshadowblurradius", "onshadowcolor", "onshadowdistance", "onstop", "ontimeout", "onvisible", "onwidth", "onx", "ony"], "canvas": ["onafterinit", "onframerate", "onfullscreen", "onmouseenter", "onmouseleave", "onmousemove", "onpercentcreated"], "text": ["ondirection", "onhscroll", "onlineheight", "onmaxhscroll", "onmaxlength", "onmaxscroll", "onpattern", "onscroll", "onscrollevents", "onscrollheight", "onscrollwidth", "onselectable", "ontext", "ontextlink", "onxscroll", "onyscroll"], "inputtext": ["onenabled"] };
function schemaHasEvent(tag, name) {
  let c = tag;
  while (c) {
    const cls = SCHEMA[c];
    if (!cls)
      return false;
    if ((SCHEMA_EVENTS[c] ?? []).includes(name))
      return true;
    c = cls.ext;
  }
  return false;
}

// dist/schema.js
function mapType(t) {
  switch (t) {
    case "number":
    case "size":
    case "numberExpression":
    case "sizeExpression":
      return "number";
    case "boolean":
    case "inheritableBoolean":
      return "boolean";
    case "color":
      return "color";
    case "css":
      return "css";
    // parsed into an object literal {prop:value,…}
    case "expression":
    case "node":
    case "reference":
      return "expression";
    // emitted as a raw JS expression
    default:
      return "string";
  }
}
var NAME_TYPE = {};
for (const cls of Object.values(SCHEMA))
  for (const [n, t] of Object.entries(cls.attrs))
    if (!(n in NAME_TYPE))
      NAME_TYPE[n] = t;
var COLOR = /* @__PURE__ */ new Set(["color", "bordercolor"]);
var NUMBER = /* @__PURE__ */ new Set([
  "spacing",
  "inset",
  "leftinset",
  "rightinset",
  "topinset",
  "bottominset",
  "xinset",
  "yinset",
  "offset",
  "duration",
  "from",
  "to"
]);
var BOOLEAN = /* @__PURE__ */ new Set([
  "resizable",
  "wrap",
  "passevents",
  "canceldefault",
  "selected",
  "autoscroll",
  "loop",
  "play"
]);
function attrType(_tag, name) {
  if (name in NAME_TYPE)
    return mapType(NAME_TYPE[name]);
  if (COLOR.has(name))
    return "color";
  if (NUMBER.has(name))
    return "number";
  if (BOOLEAN.has(name))
    return "boolean";
  return "string";
}

// dist/colors.js
var NAMED_COLORS = {
  aliceblue: 15792383,
  antiquewhite: 16444375,
  aqua: 65535,
  aquamarine: 8388564,
  azure: 15794175,
  beige: 16119260,
  bisque: 16770244,
  black: 0,
  blanchedalmond: 16772045,
  blue: 255,
  blueviolet: 9055202,
  brown: 10824234,
  burlywood: 14596231,
  cadetblue: 6266528,
  chartreuse: 8388352,
  chocolate: 13789470,
  coral: 16744272,
  cornflowerblue: 6591981,
  cornsilk: 16775388,
  crimson: 14423100,
  cyan: 65535,
  darkblue: 139,
  darkcyan: 35723,
  darkgoldenrod: 12092939,
  darkgray: 11119017,
  darkgreen: 25600,
  darkgrey: 11119017,
  darkkhaki: 12433259,
  darkmagenta: 9109643,
  darkolivegreen: 5597999,
  darkorange: 16747520,
  darkorchid: 10040012,
  darkred: 9109504,
  darksalmon: 15308410,
  darkseagreen: 9419919,
  darkslateblue: 4734347,
  darkslategray: 3100495,
  darkslategrey: 3100495,
  darkturquoise: 52945,
  darkviolet: 9699539,
  deeppink: 16716947,
  deepskyblue: 49151,
  dimgray: 6908265,
  dimgrey: 6908265,
  dodgerblue: 2003199,
  firebrick: 11674146,
  floralwhite: 16775920,
  forestgreen: 2263842,
  fuchsia: 16711935,
  gainsboro: 14474460,
  ghostwhite: 16316671,
  gold: 16766720,
  goldenrod: 14329120,
  gray: 8421504,
  green: 32768,
  greenyellow: 11403055,
  grey: 8421504,
  honeydew: 15794160,
  hotpink: 16738740,
  indianred: 13458524,
  indigo: 4915330,
  ivory: 16777200,
  khaki: 15787660,
  lavender: 15132410,
  lavenderblush: 16773365,
  lawngreen: 8190976,
  lemonchiffon: 16775885,
  lightblue: 11393254,
  lightcoral: 15761536,
  lightcyan: 14745599,
  lightgoldenrodyellow: 16448210,
  lightgray: 13882323,
  lightgreen: 9498256,
  lightgrey: 13882323,
  lightpink: 16758465,
  lightsalmon: 16752762,
  lightseagreen: 2142890,
  lightskyblue: 8900346,
  lightslategray: 7833753,
  lightslategrey: 7833753,
  lightsteelblue: 11584734,
  lightyellow: 16777184,
  lime: 65280,
  limegreen: 3329330,
  linen: 16445670,
  magenta: 16711935,
  maroon: 8388608,
  mediumaquamarine: 6737322,
  mediumblue: 205,
  mediumorchid: 12211667,
  mediumpurple: 9662683,
  mediumseagreen: 3978097,
  mediumslateblue: 8087790,
  mediumspringgreen: 64154,
  mediumturquoise: 4772300,
  mediumvioletred: 13047173,
  midnightblue: 1644912,
  mintcream: 16121850,
  mistyrose: 16770273,
  moccasin: 16770229,
  navajowhite: 16768685,
  navy: 128,
  oldlace: 16643558,
  olive: 8421376,
  olivedrab: 7048739,
  orange: 16753920,
  orangered: 16729344,
  orchid: 14315734,
  palegoldenrod: 15657130,
  palegreen: 10025880,
  paleturquoise: 11529966,
  palevioletred: 14381203,
  papayawhip: 16773077,
  peachpuff: 16767673,
  peru: 13468991,
  pink: 16761035,
  plum: 14524637,
  powderblue: 11591910,
  purple: 8388736,
  red: 16711680,
  rosybrown: 12357519,
  royalblue: 4286945,
  saddlebrown: 9127187,
  salmon: 16416882,
  sandybrown: 16032864,
  seagreen: 3050327,
  seashell: 16774638,
  sienna: 10506797,
  silver: 12632256,
  skyblue: 8900331,
  slateblue: 6970061,
  slategray: 7372944,
  slategrey: 7372944,
  snow: 16775930,
  springgreen: 65407,
  steelblue: 4620980,
  tan: 13808780,
  teal: 32896,
  thistle: 14204888,
  tomato: 16737095,
  turquoise: 4251856,
  violet: 15631086,
  wheat: 16113331,
  white: 16777215,
  whitesmoke: 16119285,
  yellow: 16776960,
  yellowgreen: 10145074
};
var ColorFormatException = class extends Error {
};
function parseColor(str) {
  if (str === "transparent")
    return -1;
  if (str in NAMED_COLORS)
    return NAMED_COLORS[str];
  if (str.startsWith("0x")) {
    const v = parseInt(str.slice(2), 16);
    if (!Number.isNaN(v))
      return v;
  }
  let m = /^#([0-9a-fA-F]{3})$/.exec(str);
  if (m) {
    const v = parseInt(m[1], 16);
    const r = (v >> 8) * 17, g = (v >> 4 & 15) * 17, b = (v & 15) * 17;
    return (r << 16) + (g << 8) + b;
  }
  m = /^#([0-9a-fA-F]{6})$/.exec(str);
  if (m)
    return parseInt(m[1], 16);
  m = /^rgb\(\s*([0-9.%]+)\s*,\s*([0-9.%]+)\s*,\s*([0-9.%]+)\s*\)$/.exec(str);
  if (m) {
    let v = 0;
    for (let i = 1; i <= 3; i++) {
      let s = m[i];
      let c;
      if (s.endsWith("%"))
        c = Math.trunc(parseFloat(s.slice(0, -1))) * 255 / 100;
      else
        c = parseInt(s, 10);
      if (c < 0)
        c = 0;
      if (c > 255)
        c = 255;
      v = v << 8 | c;
    }
    return v;
  }
  throw new ColorFormatException(str);
}
function canonicalColorHex(value) {
  const n = parseColor(value);
  return "0x" + (n >>> 0).toString(16);
}

// dist/debug.js
var ANNOTATE_MARKER = "";
var OP_FILE_LINENUM = "f";
var OP_FILE_LINENUM_FORCE = "F";
var OP_CLASSNAME = "C";
var OP_CLASSEND = "c";
var OP_BINDER = "B";
var OP_PATHRESET = "R";
var OP_PATHRESET_ONLY = "r";
var OP_REG = "G";
var OP_SETPATH = "P";
var DBG_BACKTRACE = false;
function setDebugBacktrace(v) {
  DBG_BACKTRACE = v;
}
var DBG_PROFILE = false;
function setDebugProfile(v) {
  DBG_PROFILE = v;
}
function profileMeter(lzp, now, name, getname, event) {
  return "var " + lzp + ' = global["$lzprofiler"];\nif (' + lzp + ") {\nvar " + now + ' = "" + (new Date().getTime() - ' + lzp + ".base);\nvar " + name + " = " + getname + ";\nif (" + lzp + ".last == " + now + ") {\n" + lzp + ".events[" + now + '] += ",' + event + ':" + ' + name + "\n} else {\n" + lzp + "." + event + "[" + now + "] = " + name + "\n};\n" + lzp + ".last = " + now + "\n}";
}
var NO_TRACK_LINES = false;
function setNoTrackLines(v) {
  NO_TRACK_LINES = v;
}
function ctorBacktrace(file, ctorLine) {
  const D = "$4", S = "$5", Av = "$6";
  return {
    prelude: "var " + D + " = Debug;\nvar " + S + " = " + D + ".backtraceStack;\n",
    prefix: "if (" + S + ") {\nvar " + Av + ' = ["parent", parent_$0, "attrs", attrs_$1, "children", children_$2, "async", async_$3];\n' + Av + ".callee = arguments.callee;\n" + Av + '["this"] = this;\n' + Av + ".filename = " + JSON.stringify(file) + ";\n" + Av + ".lineno = " + ctorLine + ";\n" + S + ".push(" + Av + ");\nif (" + S + ".length > " + S + ".maxDepth) {\n" + D + ".stackOverflow()\n}};\n",
    suffix: "\nfinally {\nif (" + S + ") {\n" + S + ".length--\n}}",
    // The super dispatch's nextMethod fallback is a regular call → noteCallSite at
    // ctorLine+1 (the dispatch's source line). The super test/dispatch is not noted.
    nextMethod: "(" + Av + ".lineno = " + (ctorLine + 1) + ', this.nextMethod(arguments.callee, "$lzsc$initialize"))'
  };
}
function litReset(srcLine) {
  return ANNOTATE_MARKER + OP_PATHRESET + srcLine + ANNOTATE_MARKER;
}
function pathOnlyReset(nLine) {
  return ANNOTATE_MARKER + OP_PATHRESET_ONLY + nLine + ANNOTATE_MARKER;
}
function setPathname(file) {
  return ANNOTATE_MARKER + OP_SETPATH + file + ANNOTATE_MARKER;
}
var BINDER_TABLE = [];
function resetBinderTable() {
  BINDER_TABLE = [];
}
function registerBinder(spec) {
  const idx = BINDER_TABLE.length;
  BINDER_TABLE.push(spec);
  return ANNOTATE_MARKER + OP_BINDER + idx + ANNOTATE_MARKER;
}
function lastBinderSpec() {
  return BINDER_TABLE.length > 0 ? BINDER_TABLE[BINDER_TABLE.length - 1] : void 0;
}
var REG_TABLE = [];
function resetRegTable() {
  REG_TABLE = [];
}
function registerReg(spec) {
  const idx = REG_TABLE.length;
  REG_TABLE.push(spec);
  return ANNOTATE_MARKER + OP_REG + idx + ANNOTATE_MARKER;
}
function isActualFile(str) {
  return str !== "" && !str.startsWith("[");
}
function annoFileLine(filename, line, force = false) {
  if (NO_TRACK_LINES)
    return "";
  let f = filename ?? "";
  let n = line;
  if (!isActualFile(f)) {
    f = "";
    n = 0;
  }
  const op = force ? OP_FILE_LINENUM_FORCE : OP_FILE_LINENUM;
  return ANNOTATE_MARKER + op + f + "#" + n + ANNOTATE_MARKER;
}
function forceBlankLnum() {
  if (NO_TRACK_LINES)
    return "";
  return "\n" + annoFileLine(null, 0, true);
}
function extractLineNumber(operand) {
  const pos = operand.indexOf("#");
  return parseInt(operand.substring(pos + 1), 10);
}
function extractFileName(operand) {
  const pos = operand.indexOf("#");
  return operand.substring(0, pos);
}
function firstAnnotation(str) {
  if (str.length < 1 || str[0] !== ANNOTATE_MARKER)
    return null;
  const end = str.indexOf(ANNOTATE_MARKER, 1);
  if (end < 0)
    return null;
  return { op: str[1], operand: str.substring(2, end) };
}
function fileLineNumberNeeded(ann, filename, line) {
  if (ann == null || ann.op !== OP_FILE_LINENUM && ann.op !== OP_FILE_LINENUM_FORCE)
    return false;
  let nodeFile = filename ?? "";
  let nodeLine = line;
  let annLine = extractLineNumber(ann.operand);
  let annFile = extractFileName(ann.operand);
  if (nodeFile === "") {
    nodeFile = "";
    nodeLine = 0;
  }
  if (!isActualFile(nodeFile)) {
    nodeFile = "";
    nodeLine = 0;
  }
  if (annFile === "") {
    annFile = "";
    annLine = 0;
  }
  return !nodeFile.startsWith("[") && (annFile !== nodeFile || annLine !== nodeLine);
}
function newLineNumberState() {
  return { filename: "", hasfile: false, linenum: Number.MIN_SAFE_INTEGER, linediff: Number.MIN_SAFE_INTEGER };
}
function countLines(s) {
  let c = 0;
  for (let i = 0; i < s.length; i++)
    if (s[i] === "\n")
      c++;
  return c;
}
var TranslationUnit = class {
  constructor() {
    this.text = "";
    this.linenum = 1;
  }
  addText(s) {
    this.text += s;
    this.linenum += countLines(s);
  }
  getTextLineNumber() {
    return this.linenum;
  }
};
function getLineNumberState(tu, operand) {
  const s = newLineNumberState();
  s.filename = extractFileName(operand);
  s.hasfile = isActualFile(s.filename);
  if (s.hasfile) {
    s.linenum = extractLineNumber(operand);
    s.linediff = tu.getTextLineNumber() - s.linenum;
  }
  return s;
}
function shouldShowSourceLocation(os, ns, op, atBol) {
  const fileSame = os.filename === ns.filename;
  const lineSame = os.linediff === ns.linediff;
  if (!fileSame) {
    if (atBol && (ns.hasfile || os.hasfile))
      return true;
  } else if (op === OP_FILE_LINENUM_FORCE && ns.filename.length > 0) {
    return true;
  } else if (atBol && ns.linenum > 0 && (!lineSame || !fileSame)) {
    return true;
  }
  return false;
}
function processAnnotations(annotated, notify) {
  let endann = -1;
  let startann = annotated.indexOf(ANNOTATE_MARKER);
  while (startann >= 0) {
    notify("", annotated.substring(endann + 1, startann));
    const op = annotated[startann + 1];
    endann = annotated.indexOf(ANNOTATE_MARKER, startann + 2);
    if (endann < 0)
      throw new Error("bad annotation markers");
    notify(op, annotated.substring(startann + 2, endann));
    startann = annotated.indexOf(ANNOTATE_MARKER, endann + 1);
  }
  notify("", annotated.substring(endann + 1));
}
function translateAnnotatedUnit(annotated, incoming) {
  const defaulttu = new TranslationUnit();
  const tunits = [defaulttu];
  const st = {
    curtu: defaulttu,
    atBol: true,
    curLstate: newLineNumberState(),
    newLstate: newLineNumberState(),
    srcloc: null,
    diff: 0,
    // The oracle's Token.currentPathname at the current serialize position: set by a
    // real `#file` directive, reset to "" by a literal-attr `#endAttribute` (R marker).
    // Drives the Pattern-A binder discriminator (independent of curLstate, which is the
    // directive-DISPLAY state and is polluted by generated/forceBlankLnum markers).
    // SEEDED from the previous top-level statement's trailing context (cross-unit
    // threading) so a directive-less reg/trailer statement inherits it (S46).
    runningPathname: incoming?.runningPathname ?? "",
    // The oracle's cumulative source-line at the current serialize position. After a
    // literal attr's #endAttribute it is (attr srcLine + 2). A Pattern-A binder that
    // follows reads this as its $reportException line N.
    runningSrcLine: incoming?.runningSrcLine ?? 0
  };
  const notify = (op, operand) => {
    if (op === "") {
      if (operand.length > 0) {
        if (st.srcloc != null && st.srcloc.length > 0) {
          st.curtu.addText(st.srcloc);
          st.newLstate.linediff += st.diff;
          st.curLstate = st.newLstate;
          st.srcloc = null;
        }
        st.curtu.addText(operand);
        st.atBol = operand.endsWith("\n");
      }
      return;
    }
    if (op === OP_PATHRESET) {
      st.runningPathname = "";
      st.runningSrcLine = parseInt(operand, 10) + 2;
      return;
    }
    if (op === OP_PATHRESET_ONLY) {
      st.runningPathname = "";
      st.runningSrcLine = parseInt(operand, 10);
      return;
    }
    if (op === OP_SETPATH) {
      st.runningPathname = operand;
      return;
    }
    if (op === OP_FILE_LINENUM || op === OP_FILE_LINENUM_FORCE) {
      st.newLstate = getLineNumberState(st.curtu, operand);
      if (st.newLstate.hasfile)
        st.runningPathname = st.newLstate.filename;
      if (shouldShowSourceLocation(st.curLstate, st.newLstate, op, st.atBol)) {
        const offset = st.curLstate.linediff - st.newLstate.linediff;
        if (st.atBol) {
          st.srcloc = "";
          st.diff = 0;
        } else {
          st.srcloc = "\n";
          st.diff = 1;
        }
        if (st.newLstate.filename.length === 0) {
          st.srcloc += "/* -*- file: -*- */\n";
          st.diff += 1;
        } else if (op === OP_FILE_LINENUM_FORCE || st.curLstate.filename !== st.newLstate.filename) {
          st.srcloc += "/* -*- file: " + st.newLstate.filename + "#" + st.newLstate.linenum + " -*- */\n";
          st.diff += 1;
        } else {
          const update = "/* -*- file: #" + st.newLstate.linenum + " -*- */\n";
          if (st.atBol && offset > 0 && offset < update.length) {
            for (let i = 0; i < offset; i++)
              st.srcloc += "\n";
            st.diff += offset;
          } else {
            st.srcloc += update;
            st.diff += 1;
          }
        }
      }
      return;
    }
    if (op === OP_BINDER) {
      const spec = BINDER_TABLE[parseInt(operand, 10)];
      if (st.srcloc != null && st.srcloc.length > 0) {
        st.curtu.addText(st.srcloc);
        st.newLstate.linediff += st.diff;
        st.curLstate = st.newLstate;
        st.srcloc = null;
      }
      const patternA = st.runningPathname === "";
      const stream = patternA ? spec.render("", st.runningSrcLine) : spec.render(spec.file, spec.funcLine);
      processAnnotations(stream, notify);
      return;
    }
    if (op === OP_REG) {
      const spec = REG_TABLE[parseInt(operand, 10)];
      const patternA = st.runningPathname === "";
      const stream = patternA ? spec.body : annoFileLine(spec.file, spec.seq) + spec.body;
      processAnnotations(stream, notify);
      return;
    }
    if (op === OP_CLASSNAME) {
      st.curtu = new TranslationUnit();
      tunits.push(st.curtu);
      return;
    }
    if (op === OP_CLASSEND) {
      st.curtu = defaulttu;
      return;
    }
  };
  processAnnotations(annotated, notify);
  return {
    text: tunits.map((t) => t.text).join(""),
    ctx: { runningPathname: st.runningPathname, runningSrcLine: st.runningSrcLine }
  };
}
function debugConstructor(file, ctorLine) {
  const L = ctorLine, B = ctorLine + 1;
  const A = (n) => annoFileLine(file, n);
  const Agen = annoFileLine(null, 0);
  const FB = forceBlankLnum();
  const superDispatch = '(arguments.callee["$superclass"] && arguments.callee.$superclass.prototype["$lzsc$initialize"] || this.nextMethod(arguments.callee, "$lzsc$initialize")).call(this, parent_$0, attrs_$1, children_$2, async_$3)';
  const switchText = "switch (arguments.length) {\ncase 0:\n" + A(B) + "parent_$0 = null;;case 1:\nattrs_$1 = null;;case 2:\nchildren_$2 = null;;case 3:\nasync_$3 = false\n}";
  if (DBG_PROFILE) {
    const meterGet = 'arguments.callee["displayName"]';
    const FUNC2 = A(L) + "function (parent_$0, attrs_$1, children_$2, async_$3) {\ntry {\n" + profileMeter("$4", "$5", "$6", meterGet, "calls") + ";\n" + A(L) + switchText + ";\n" + A(B) + superDispatch + "\n}\n" + Agen + "finally {\n" + profileMeter("$4", "$5", "$6", meterGet, "returns") + "}}" + FB;
    const S12 = A(L) + "var $lzsc$temp = " + FUNC2 + ";";
    const S22 = A(L) + '$lzsc$temp["displayName"] = "$lzsc$initialize";';
    const S32 = A(L) + "return $lzsc$temp";
    return "(function () {\n" + S12 + "\n" + S22 + "\n" + S32 + "\n}" + FB + ")()";
  }
  const catchBody = 'if ((Error["$lzsc$isa"] ? Error.$lzsc$isa($lzsc$e) : $lzsc$e instanceof Error) && $lzsc$e !== lz["$lzsc$thrownError"]) {\n$reportException(' + JSON.stringify(file) + ", " + L + ", $lzsc$e)\n} else {\nthrow $lzsc$e\n}";
  const bt = DBG_BACKTRACE ? ctorBacktrace(file, L) : null;
  const dispatch = bt ? '(arguments.callee["$superclass"] && arguments.callee.$superclass.prototype["$lzsc$initialize"] || ' + bt.nextMethod + ").call(this, parent_$0, attrs_$1, children_$2, async_$3)" : superDispatch;
  const catchBt = 'if ((Error["$lzsc$isa"] ? Error.$lzsc$isa($lzsc$e) : $lzsc$e instanceof Error) && $lzsc$e !== lz["$lzsc$thrownError"]) {\n$reportException(' + JSON.stringify(file) + ", $6.lineno, $lzsc$e)\n} else {\nthrow $lzsc$e\n}";
  const tryText = "try {\n" + (bt ? bt.prefix : "") + A(L) + switchText + ";\n" + A(B) + dispatch + "\n}\n" + Agen + "catch ($lzsc$e) {\n" + (bt ? catchBt : catchBody) + "}" + (bt ? bt.suffix : "");
  const funcBlock = "{\n" + Agen + (bt ? bt.prelude : "") + tryText + "}";
  const FUNC = A(L) + "function  (parent_$0, attrs_$1, children_$2, async_$3) " + funcBlock + FB;
  const S1 = A(L) + "var $lzsc$temp = " + FUNC + ";";
  const S2 = A(L) + '$lzsc$temp["displayName"] = "$lzsc$initialize";';
  const S2bt = bt ? "\n" + A(L) + '$lzsc$temp["_dbg_filename"] = ' + JSON.stringify(file) + ";\n" + A(L) + '$lzsc$temp["_dbg_lineno"] = ' + L + ";" : "";
  const S3 = A(L) + "return $lzsc$temp";
  return "(function () {\n" + S1 + "\n" + S2 + S2bt + "\n" + S3 + "\n}" + FB + ")()";
}
function debugConstructorPlain(line) {
  if (DBG_PROFILE) {
    const meterGet = 'arguments.callee["displayName"]';
    return "(function () {\n" + annoFileLine(null, 0) + "var $lzsc$temp = function (parent_$0, attrs_$1, children_$2, async_$3) {\ntry {\n" + profileMeter("$4", "$5", "$6", meterGet, "calls") + ';\nswitch (arguments.length) {\ncase 0:\nparent_$0 = null;;case 1:\nattrs_$1 = null;;case 2:\nchildren_$2 = null;;case 3:\nasync_$3 = false\n};\n(arguments.callee["$superclass"] && arguments.callee.$superclass.prototype["$lzsc$initialize"] || this.nextMethod(arguments.callee, "$lzsc$initialize")).call(this, parent_$0, attrs_$1, children_$2, async_$3)\n}\nfinally {\n' + profileMeter("$4", "$5", "$6", meterGet, "returns") + '}};\n$lzsc$temp["displayName"] = "$lzsc$initialize";\nreturn $lzsc$temp\n})()';
  }
  const bt = DBG_BACKTRACE ? ctorBacktrace("", line) : null;
  const dispatch = bt ? '(arguments.callee["$superclass"] && arguments.callee.$superclass.prototype["$lzsc$initialize"] || ' + bt.nextMethod + ").call(this, parent_$0, attrs_$1, children_$2, async_$3)\n" : '(arguments.callee["$superclass"] && arguments.callee.$superclass.prototype["$lzsc$initialize"] || this.nextMethod(arguments.callee, "$lzsc$initialize")).call(this, parent_$0, attrs_$1, children_$2, async_$3)\n';
  const catchTail = bt ? 'if ((Error["$lzsc$isa"] ? Error.$lzsc$isa($lzsc$e) : $lzsc$e instanceof Error) && $lzsc$e !== lz["$lzsc$thrownError"]) {\n$reportException("", $6.lineno, $lzsc$e)\n} else {\nthrow $lzsc$e\n}}' + bt.suffix + "}\n" : 'if ((Error["$lzsc$isa"] ? Error.$lzsc$isa($lzsc$e) : $lzsc$e instanceof Error) && $lzsc$e !== lz["$lzsc$thrownError"]) {\n$reportException("", ' + line + ", $lzsc$e)\n} else {\nthrow $lzsc$e\n}}}\n";
  const dbgMeta = bt ? '$lzsc$temp["_dbg_filename"] = "";\n$lzsc$temp["_dbg_lineno"] = ' + line + ";\n" : "";
  return "(function () {\n" + annoFileLine(null, 0) + "var $lzsc$temp = function  (parent_$0, attrs_$1, children_$2, async_$3) {\n" + (bt ? bt.prelude : "") + "try {\n" + (bt ? bt.prefix : "") + "switch (arguments.length) {\ncase 0:\nparent_$0 = null;;case 1:\nattrs_$1 = null;;case 2:\nchildren_$2 = null;;case 3:\nasync_$3 = false\n};\n" + dispatch + "}\ncatch ($lzsc$e) {\n" + catchTail + ';\n$lzsc$temp["displayName"] = "$lzsc$initialize";\n' + dbgMeta + "return $lzsc$temp\n}\n)()";
}
function renderDebugClassMake(file, classLine, classNameJs, instProps, superJs, classPropsInner) {
  return annoFileLine(file, classLine) + "Class.make(" + classNameJs + ", [" + instProps.join(", ") + "], " + superJs + ", [" + classPropsInner + "])";
}
function assembleDebugProgram(topLevelAnnotated) {
  let out = "";
  let ctx = { runningPathname: "", runningSrcLine: 0 };
  for (const stmt of topLevelAnnotated) {
    const r = translateAnnotatedUnit(stmt, ctx);
    ctx = r.ctx;
    out += r.text;
    if (!r.text.endsWith(";"))
      out += ";";
  }
  return out;
}

// dist/sc.js
var ScUnsupported = class extends Error {
};
var PUNCT = [
  ">>>=",
  "===",
  "!==",
  ">>>",
  "<<=",
  ">>=",
  "&&=",
  "||=",
  "**=",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "<<",
  ">>",
  "**",
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  ";",
  ",",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "%",
  "&",
  "|",
  "^",
  "!",
  "~",
  "?",
  ":",
  "=",
  "...",
  "."
];
var KEYWORDS = /* @__PURE__ */ new Set([
  "var",
  "return",
  "if",
  "else",
  "for",
  "while",
  "do",
  "function",
  "new",
  "typeof",
  "delete",
  "void",
  "instanceof",
  "in",
  "this",
  "true",
  "false",
  "null",
  "break",
  "continue",
  "switch",
  "case",
  "default",
  "throw",
  "try",
  "catch",
  "finally",
  "super",
  "with"
]);
function lex(src, baseLine = 1, baseFile, lexIncludes = false) {
  const toks = [];
  let i = 0;
  let line = baseLine;
  let lineStart = 0;
  let curFile = baseFile;
  let afterDir = false;
  const n = src.length;
  const countNl = (from, to) => {
    for (let k = from; k < to; k++)
      if (src[k] === "\n") {
        line++;
        lineStart = k + 1;
      }
  };
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) {
      if (c === "\n") {
        line++;
        lineStart = i + 1;
        afterDir = false;
      }
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n")
        i++;
      afterDir = false;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      const end = e < 0 ? n : e + 2;
      countNl(i, end);
      i = end;
      afterDir = false;
      continue;
    }
    if (c === "#") {
      let w = i + 1;
      while (w < n && /[A-Za-z]/.test(src[w]))
        w++;
      const word = src.slice(i, w);
      if (word === "#file" || word === "#line" || word === "#pragma") {
        let eol = src.indexOf("\n", w);
        if (eol < 0)
          eol = n;
        const rest = src.slice(w, eol).trim();
        const dLine = line, dCol = i - lineStart + 1, dFile = curFile;
        i = eol < n ? eol + 1 : n;
        lineStart = i;
        if (word === "#file") {
          curFile = rest;
          line++;
          afterDir = false;
        } else if (word === "#line") {
          line = parseInt(rest, 10);
          afterDir = true;
        } else {
          line++;
          if (/throwsError\s*=\s*true/.test(rest))
            toks.push({ t: "pragma", v: "throwsError", line: dLine, col: dCol, file: dFile });
          const ufn = /^["']userFunctionName=([\s\S]*)["']$/.exec(rest);
          if (ufn)
            toks.push({ t: "pragma", v: "userFunctionName=" + ufn[1], line: dLine, col: dCol, file: dFile });
          if (/debugBacktrace\s*=\s*false/.test(rest))
            toks.push({ t: "pragma", v: "noBacktrace", line: dLine, col: dCol, file: dFile });
          if (SC_PROFILE) {
            if (/profile\s*=\s*false/.test(rest))
              toks.push({ t: "pragma", v: "profileOff", line: dLine, col: dCol, file: dFile });
            else if (/profile\s*=\s*true/.test(rest))
              toks.push({ t: "pragma", v: "profileOn", line: dLine, col: dCol, file: dFile });
          }
        }
      } else if (lexIncludes && word === "#passthrough") {
        const end = src.indexOf("}#", w);
        if (end < 0)
          throw new ScUnsupported("#passthrough: missing closing }#");
        countNl(i, end + 2);
        i = end + 2;
      } else if (lexIncludes && word === "#include") {
        const incLine = line, incCol = i - lineStart + 1, incFile = curFile;
        let k = w;
        while (k < n && (src[k] === " " || src[k] === "	"))
          k++;
        const q = src[k];
        if (q !== '"' && q !== "'")
          throw new ScUnsupported(`#include: expected string path, got ${JSON.stringify(src.slice(k, k + 12))}`);
        let j = k + 1, s = "";
        while (j < n && src[j] !== q)
          s += src[j++];
        toks.push({ t: "include", v: s, line: incLine, col: incCol, file: incFile });
        i = j + 1;
      } else {
        i = w;
      }
      continue;
    }
    const tokLine = line;
    const tokCol = i - lineStart + 1;
    const tokFile = curFile;
    const tokAfterDir = afterDir;
    afterDir = false;
    if (c === '"' || c === "'") {
      let j = i + 1, s = "";
      while (j < n && src[j] !== c) {
        if (src[j] === "\\") {
          s += unescapeChar(src, j);
          j += escLen(src, j);
        } else {
          if (src[j] === "\n") {
            line++;
            lineStart = j + 1;
          }
          s += src[j++];
        }
      }
      toks.push({ t: "str", v: s, line: tokLine, col: tokCol, file: tokFile, afterDir: tokAfterDir });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || c === "." && /[0-9]/.test(src[i + 1])) {
      let j = i;
      if (c === "0" && (src[i + 1] === "x" || src[i + 1] === "X")) {
        j += 2;
        while (j < n && /[0-9a-fA-F]/.test(src[j]))
          j++;
      } else {
        while (j < n && /[0-9.eE]/.test(src[j])) {
          if ((src[j] === "e" || src[j] === "E") && (src[j + 1] === "+" || src[j + 1] === "-"))
            j++;
          j++;
        }
      }
      toks.push({ t: "num", v: src.slice(i, j), line: tokLine, col: tokCol, file: tokFile, afterDir: tokAfterDir });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j]))
        j++;
      const w = src.slice(i, j);
      toks.push({ t: KEYWORDS.has(w) ? w : "id", v: w, line: tokLine, col: tokCol, file: tokFile, afterDir: tokAfterDir });
      i = j;
      continue;
    }
    let matched = "";
    for (const p of PUNCT)
      if (src.startsWith(p, i)) {
        matched = p;
        break;
      }
    if (!matched)
      throw new ScUnsupported(`lex: unexpected char ${JSON.stringify(c)}`);
    toks.push({ t: matched, v: matched, line: tokLine, col: tokCol, file: tokFile, afterDir: tokAfterDir });
    i += matched.length;
  }
  toks.push({ t: "eof", v: "", line, col: i - lineStart + 1, file: curFile });
  return toks;
}
function escLen(s, j) {
  const c = s[j + 1];
  if (c === "x")
    return 4;
  if (c === "u")
    return 6;
  return 2;
}
function unescapeChar(s, j) {
  const c = s[j + 1];
  switch (c) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "	";
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "v":
      return "\v";
    case "0":
      return "\0";
    case "x":
      return String.fromCharCode(parseInt(s.substr(j + 2, 2), 16));
    case "u":
      return String.fromCharCode(parseInt(s.substr(j + 2, 4), 16));
    default:
      return c;
  }
}
var AS3_DECL = /* @__PURE__ */ new Set(["class", "interface", "import", "package"]);
var CLASS_MODIFIERS = /* @__PURE__ */ new Set(["public", "private", "protected", "final", "internal", "dynamic"]);
function makeIsExpr(a, b, line) {
  return {
    k: "cond",
    c: { k: "index", o: b, i: { k: "str", v: "$lzsc$isa" } },
    // Backtrace: the generated `B.$lzsc$isa(a)` CALL is noteCallSite-wrapped, so it
    // carries the `is` expression's source line (the operator token line).
    t: { k: "call", c: { k: "member", o: b, p: "$lzsc$isa" }, args: [a], line },
    f: { k: "bin", op: "instanceof", l: a, r: b }
  };
}
function makeSubclassofExpr(a, b, line) {
  return { k: "paren", e: { k: "call", c: { k: "id", name: "$lzsc$issubclassof" }, args: [a, b], line } };
}
function isSuperCallExpr(e) {
  if (e.k !== "call")
    return false;
  const c = e.c;
  if (c.k === "super")
    return true;
  if (c.k === "member" && c.o.k === "super")
    return true;
  if (c.k === "member" && (c.p === "call" || c.p === "apply") && c.o.k === "member" && c.o.o.k === "super")
    return true;
  return false;
}
function isControlStmt(s) {
  switch (s.s) {
    case "block":
    case "if":
    case "while":
    case "dowhile":
    case "with":
    case "for":
    case "forin":
    case "try":
    case "switch":
      return true;
    default:
      return false;
  }
}
function predecessorTriggersRuleA(s, endsBrace) {
  if (s.s !== "if" || s.e)
    return true;
  const then = s.t;
  if (then.s !== "block") {
    return then.line === s.line;
  }
  if (!endsBrace)
    return false;
  const last = then.body[then.body.length - 1];
  return last ? !(isControlStmt(last) && last.endsBrace === true) : false;
}
var Parser = class {
  constructor(toks) {
    this.pos = 0;
    this.lfc = false;
    this.profileOff = false;
    this.toks = toks;
  }
  peek(o = 0) {
    return this.toks[this.pos + o];
  }
  next() {
    return this.toks[this.pos++];
  }
  eat(t) {
    if (this.peek().t !== t)
      throw new ScUnsupported(`parse: expected ${t}, got ${this.peek().t} '${this.peek().v}'`);
    return this.next();
  }
  is(t) {
    return this.peek().t === t;
  }
  /** Skip an ActionScript-style `:Type` annotation (erased from output, like the
   *  `cast` operator). A type is `*`, or a (possibly dotted) name — keywords
   *  `void`/`null`/`function` are also valid type names — with an optional
   *  `.<…>` vector parameter and an optional trailing `?` (nullable type). */
  /** Skip an ActionScript-style `:Type` annotation — erased from OUTPUT, but the
   *  type TEXT is returned for reflection (lfc-reflect). null = no annotation. */
  skipTypeAnnotation() {
    if (!this.is(":"))
      return null;
    this.next();
    return this.typeExpr();
  }
  typeExpr() {
    let text = "";
    if (this.is("*")) {
      this.next();
      text = "*";
    } else {
      if (this.is("id") || this.is("void") || this.is("null") || this.is("function"))
        text = this.next().v;
      else
        throw new ScUnsupported(`type: unexpected ${this.peek().t} '${this.peek().v}'`);
      while (this.is(".")) {
        this.next();
        if (this.is("<")) {
          this.next();
          text += ".<" + this.typeExpr();
          this.eat(">");
          text += ">";
        } else
          text += "." + this.eat("id").v;
      }
    }
    if (this.is("?")) {
      this.next();
      text += "?";
    }
    return text;
  }
  parseProgram() {
    const body = [];
    while (!this.is("eof"))
      body.push(this.statement());
    return body;
  }
  parseExpr() {
    const e = this.expression();
    this.eat("eof");
    return e;
  }
  statement() {
    const line = this.peek().line;
    const file = this.peek().file;
    const afterDir = this.peek().afterDir === true;
    const s = this.statementInner();
    if (s.line === void 0)
      s.line = line;
    if (s.file === void 0 && file !== void 0)
      s.file = file;
    if (afterDir && (s.s === "expr" || s.s === "var"))
      s.afterDir = true;
    if (s.endLine === void 0)
      s.endLine = this.toks[this.pos - 1]?.line ?? line;
    if (s.endsBrace === void 0)
      s.endsBrace = this.toks[this.pos - 1]?.t === "}";
    if (s.superQuirkPredecessor === void 0) {
      const endsBrace = s.endsBrace;
      s.superQuirkPredecessor = predecessorTriggersRuleA(s, endsBrace);
      s.singleLineBlockIf = s.s === "if" && !s.e && s.line === s.endLine && endsBrace;
    }
    return s;
  }
  statementInner() {
    const t = this.peek().t;
    if (t === "include") {
      const tk = this.next();
      return { s: "include", path: tk.v, line: tk.line, file: tk.file };
    }
    if (t === "pragma") {
      const pv = this.peek().v;
      this.next();
      if (pv === "profileOff")
        this.profileOff = true;
      else if (pv === "profileOn")
        this.profileOff = false;
      return { s: "empty" };
    }
    if (t === "id") {
      let k = 0;
      while (this.peek(k).t === "id" && CLASS_MODIFIERS.has(this.peek(k).v))
        k++;
      if ((this.peek(k).v === "class" || this.peek(k).v === "mixin") && this.peek(k + 1).t === "id")
        return this.classDecl();
    }
    if (t === "id" && AS3_DECL.has(this.peek().v))
      throw new ScUnsupported(`unsupported declaration: ${this.peek().v}`);
    if (t === "{")
      return this.block();
    if (t === ";") {
      this.next();
      return { s: "empty" };
    }
    if (t === "var" || t === "id" && this.peek().v === "const" && this.peek(1).t === "id")
      return this.varStmt();
    if (t === "return") {
      const kwLine = this.peek().line;
      this.next();
      let e2 = null;
      const asiBreak = this.lfc && this.peek().line > kwLine;
      if (!asiBreak && !this.is(";") && !this.is("}") && !this.is("eof"))
        e2 = this.expression();
      this.semi();
      return { s: "return", e: e2 };
    }
    if (t === "if")
      return this.ifStmt();
    if (t === "while") {
      this.next();
      this.eat("(");
      const c = this.expression();
      this.eat(")");
      return { s: "while", c, body: this.statement() };
    }
    if (t === "do") {
      this.next();
      const body = this.statement();
      this.eat("while");
      this.eat("(");
      const c = this.expression();
      this.eat(")");
      this.semi();
      return { s: "dowhile", c, body };
    }
    if (t === "with") {
      this.next();
      this.eat("(");
      const c = this.expression();
      this.eat(")");
      return { s: "with", c, body: this.statement() };
    }
    if (t === "throw") {
      this.next();
      const e2 = this.expression();
      this.semi();
      return { s: "throw", e: e2 };
    }
    if (t === "try") {
      const tryLine = this.peek().line;
      this.next();
      const block = this.block();
      let param = null;
      let handler = null;
      let handlerLine;
      if (this.is("catch")) {
        handlerLine = this.peek().line;
        this.next();
        this.eat("(");
        param = this.eat("id").v;
        this.skipTypeAnnotation();
        this.eat(")");
        handler = this.block();
      }
      let finalizer = null;
      let finalizerLine;
      if (this.is("finally")) {
        finalizerLine = this.peek().line;
        this.next();
        finalizer = this.block();
      }
      return { s: "try", line: tryLine, block, param, handler, handlerLine, finalizer, finalizerLine };
    }
    if (t === "function") {
      const fn = this.functionExpr();
      if (fn.name)
        return { s: "funcdecl", name: fn.name, fn };
      this.semi();
      return { s: "expr", e: fn };
    }
    if (t === "for")
      return this.forStmt();
    if (t === "switch")
      return this.switchStmt();
    if (t === "break") {
      this.next();
      this.semi();
      return { s: "break" };
    }
    if (t === "continue") {
      this.next();
      this.semi();
      return { s: "continue" };
    }
    const e = this.expression();
    this.semi();
    return { s: "expr", e };
  }
  semi() {
    if (this.is(";"))
      this.next();
  }
  block() {
    const braceLine = this.peek().line;
    this.eat("{");
    const savedProfileOff = this.profileOff;
    const body = [];
    while (!this.is("}"))
      body.push(this.statement());
    this.eat("}");
    this.profileOff = savedProfileOff;
    const line = body[0]?.line ?? braceLine;
    return { s: "block", line, body };
  }
  // AS3 `class Name [extends Super] { ... }`. Members: `[modifiers] var n[:T]
  // [=init];` and `[modifiers] function m(args)[:T] { body }`. Only `static`
  // affects output (→ class properties); other modifiers are ignored. The
  // constructor is the method whose name equals the class name.
  classDecl() {
    const classBeginLine = this.peek().line;
    while (this.is("id") && CLASS_MODIFIERS.has(this.peek().v))
      this.next();
    const xtor = this.next().v === "mixin" ? "Mixin" : "Class";
    const name = this.eat("id").v;
    let sup = null;
    if (this.is("id") && this.peek().v === "extends") {
      this.next();
      sup = this.eat("id").v;
      while (this.is(".")) {
        this.next();
        sup += "." + this.eat("id").v;
      }
    }
    const mixins = [];
    if (this.is("with")) {
      this.next();
      do {
        let mn = this.eat("id").v;
        while (this.is(".")) {
          this.next();
          mn += "." + this.eat("id").v;
        }
        mixins.push(mn);
      } while (this.is(",") && this.next());
    }
    if (this.is("id") && this.peek().v === "implements")
      throw new ScUnsupported("AS3 class implements");
    this.eat("{");
    const members = [];
    this.classBody(members);
    this.eat("}");
    const semi = this.is(";");
    if (semi)
      this.next();
    return { s: "as3class", name, sup, mixins, xtor, members, semi, classLine: classBeginLine };
  }
  /** Parse class-body members up to (not eating) the closing `}`, appending to
   *  `members`. Shared by the class root and (in LFC mode) compile-time
   *  if-directive branches. */
  classBody(members) {
    const MODIFIERS = /* @__PURE__ */ new Set(["public", "private", "protected", "static", "final", "override", "internal", "dynamic"]);
    while (!this.is("}")) {
      if (this.is("pragma")) {
        this.next();
        continue;
      }
      if (this.is(";")) {
        this.next();
        members.push({ kind: "stmt", stmt: { s: "empty" } });
        continue;
      }
      if (this.lfc && this.is("if")) {
        this.classIfDirective(members);
        continue;
      }
      let isStatic = false;
      while (this.is("id") && MODIFIERS.has(this.peek().v)) {
        if (this.peek().v === "static")
          isStatic = true;
        this.next();
      }
      if (this.is("var") || this.is("id") && this.peek().v === "const") {
        this.next();
        do {
          const vn = this.eat("id").v;
          const varType = this.skipTypeAnnotation();
          let init = null;
          if (this.is("=")) {
            this.next();
            init = this.assign();
          }
          members.push({ kind: "var", name: vn, init, static: isStatic, ...varType ? { varType } : {} });
        } while (this.is(",") && this.next());
        this.semi();
      } else if (this.is("function") && this.peek(1).t === "id") {
        const fn = this.functionExpr();
        members.push({ kind: "method", name: fn.name, fn, static: isStatic });
      } else {
        members.push({ kind: "stmt", stmt: this.statement() });
      }
    }
  }
  /** LFC class-body compile-time if-directive: `if (magic) { members } [else
   *  { members } | else if …]`. Folds the (magic-constant) condition and inlines
   *  the taken branch's members. Refuses a non-constant condition (no runtime
   *  class-body conditionals occur in the LFC). */
  classIfDirective(members) {
    this.next();
    this.eat("(");
    const cond = this.expression();
    this.eat(")");
    const thenM = [];
    this.eat("{");
    this.classBody(thenM);
    this.eat("}");
    let elseM = null;
    if (this.is("else")) {
      this.next();
      if (this.is("if")) {
        elseM = [];
        this.classIfDirective(elseM);
      } else {
        elseM = [];
        this.eat("{");
        this.classBody(elseM);
        this.eat("}");
      }
    }
    const folded = foldNode(cond);
    if (folded.k === "lit" && folded.v === "true")
      members.push(...thenM);
    else if (folded.k === "lit" && folded.v === "false") {
      if (elseM)
        members.push(...elseM);
    } else
      throw new ScUnsupported(`non-constant class-body if-directive`);
  }
  varStmt() {
    this.next();
    const decls = [];
    do {
      const name = this.eat("id").v;
      this.skipTypeAnnotation();
      let init = null;
      if (this.is("=")) {
        this.next();
        init = this.assign();
      }
      decls.push({ name, init });
    } while (this.is(",") && this.next());
    this.semi();
    return { s: "var", decls };
  }
  ifStmt() {
    this.eat("if");
    this.eat("(");
    const c = this.expression();
    this.eat(")");
    const t = this.statement();
    let e = null;
    let elseLine;
    if (this.is("else")) {
      elseLine = this.peek().line;
      this.next();
      e = this.statement();
    }
    return { s: "if", c, t, e, elseLine };
  }
  forStmt() {
    this.eat("for");
    this.eat("(");
    let init = null;
    if (this.is(";"))
      this.next();
    else if (this.is("var")) {
      this.eat("var");
      const decls = [];
      do {
        const name = this.eat("id").v;
        this.skipTypeAnnotation();
        let dinit = null;
        if (this.is("=")) {
          this.next();
          dinit = this.assign();
        }
        decls.push({ name, init: dinit });
      } while (this.is(",") && this.next());
      if (decls.length === 1 && decls[0].init == null && this.is("in")) {
        this.next();
        const obj = this.expression();
        this.eat(")");
        return { s: "forin", varName: decls[0].name, lhs: { k: "id", name: decls[0].name }, obj, body: this.statement() };
      }
      init = { s: "var", decls };
      this.eat(";");
    } else {
      const head = this.assign(true);
      if (this.is("in")) {
        this.next();
        const obj = this.expression();
        this.eat(")");
        return { s: "forin", varName: null, lhs: head, obj, body: this.statement() };
      }
      init = this.is(",") ? this.commaTail(head) : head;
      this.eat(";");
    }
    let test = null;
    if (!this.is(";"))
      test = this.expression();
    this.eat(";");
    let upd = null;
    if (!this.is(")"))
      upd = this.expression();
    this.eat(")");
    return { s: "for", init, test, upd, body: this.statement() };
  }
  switchStmt() {
    this.eat("switch");
    this.eat("(");
    const disc = this.expression();
    this.eat(")");
    this.eat("{");
    const cases = [];
    while (!this.is("}")) {
      let test = null;
      const labelTok = this.peek();
      if (this.is("case")) {
        this.next();
        test = this.expression();
      } else {
        this.eat("default");
      }
      this.eat(":");
      const body = [];
      while (!this.is("case") && !this.is("default") && !this.is("}"))
        body.push(this.statement());
      cases.push({ test, body, line: labelTok.line, file: labelTok.file });
    }
    this.eat("}");
    return { s: "switch", disc, cases };
  }
  expression() {
    const e = this.assign();
    return this.is(",") ? this.commaTail(e) : e;
  }
  /** Complete a comma expression whose first operand is already parsed. */
  commaTail(head) {
    const es = [head];
    while (this.is(",")) {
      this.next();
      es.push(this.assign());
    }
    return { k: "seq", es };
  }
  assign(noIn = false) {
    const l = this.cond(noIn);
    const t = this.peek().t;
    if (["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=", ">>>=", "**="].includes(t)) {
      this.next();
      return { k: "assign", op: t, l, r: this.assign(noIn) };
    }
    return l;
  }
  cond(noIn = false) {
    const c = this.binary(0, noIn);
    let e = c;
    while (this.peek().t === "id" && this.peek().v === "cast") {
      this.next();
      e = { k: "cast", e, type: this.binary(0) };
    }
    if (this.is("?")) {
      this.next();
      const t = this.assign();
      this.eat(":");
      const f = this.assign();
      return { k: "cond", c: e, t, f };
    }
    return e;
  }
  binary(minPrec, noIn = false) {
    let left = this.unary();
    for (; ; ) {
      const op = this.peek().t;
      if (op === "id" && this.peek().v === "is") {
        if (9 < minPrec)
          break;
        const isLine = this.peek().line;
        this.next();
        const right2 = this.binary(10, noIn);
        left = makeIsExpr(left, right2, isLine);
        continue;
      }
      if (op === "id" && this.peek().v === "subclassof") {
        if (9 < minPrec)
          break;
        const scLine = this.peek().line;
        this.next();
        const right2 = this.binary(10, noIn);
        left = makeSubclassofExpr(left, right2, scLine);
        continue;
      }
      if (noIn && op === "in")
        break;
      const prec = BINPREC[op];
      if (prec === void 0 || prec < minPrec)
        break;
      this.next();
      const right = this.binary(prec + 1);
      left = LOGIC.has(op) ? { k: "logic", op, l: left, r: right } : { k: "bin", op, l: left, r: right };
    }
    return left;
  }
  unary() {
    const t = this.peek().t;
    if (["!", "~", "+", "-", "typeof", "void", "delete"].includes(t)) {
      this.next();
      return { k: "unary", op: t, e: this.unary(), prefix: true };
    }
    if (t === "++" || t === "--") {
      const line = this.peek().line;
      this.next();
      return { k: "unary", op: t, e: this.unary(), prefix: true, line };
    }
    return this.postfix();
  }
  postfix() {
    const opTokLine = this.peek().line;
    let e = this.callMember();
    if (this.is("++") || this.is("--")) {
      const op = this.next().t;
      e = { k: "unary", op, e, prefix: false, line: opTokLine };
    }
    return e;
  }
  callMember() {
    const startTok = this.peek();
    const startLine = this.lfc && startTok.afterDir === true ? startTok.line - 1 : startTok.line;
    let e;
    if (this.is("new")) {
      this.next();
      const c = this.callMemberNoCall();
      const args = this.is("(") ? this.argList() : [];
      e = { k: "new", c, args, line: startLine };
    } else {
      e = this.primary();
    }
    for (; ; ) {
      if (this.is(".")) {
        this.next();
        e = { k: "member", o: e, p: this.eat("id").v };
      } else if (this.is("[")) {
        this.next();
        const i = this.expression();
        this.eat("]");
        e = { k: "index", o: e, i };
      } else if (this.is("(")) {
        e = { k: "call", c: e, args: this.argList(), line: startLine };
      } else
        break;
    }
    return e;
  }
  callMemberNoCall() {
    let e = this.primary();
    for (; ; ) {
      if (this.is(".")) {
        this.next();
        e = { k: "member", o: e, p: this.eat("id").v };
      } else if (this.is("[")) {
        this.next();
        const i = this.expression();
        this.eat("]");
        e = { k: "index", o: e, i };
      } else
        break;
    }
    return e;
  }
  /** A function expression `function [name] (params) [:RetType] { body }`. The
   *  optional name and return type are erased in compress mode. */
  functionExpr() {
    const ftok = this.peek();
    const fline = ftok.afterDir === true ? ftok.line - 1 : ftok.line;
    const noProfile = this.profileOff;
    this.eat("function");
    let name = null;
    if (this.is("id"))
      name = this.next().v;
    const { names, defaults, rest, types } = this.formalParams();
    const returnType = this.skipTypeAnnotation();
    this.eat("{");
    let throwsError = false;
    let userFunctionName;
    let noBacktrace = false;
    for (let k = 0; this.peek(k).t === ";" || this.peek(k).t === "pragma"; k++) {
      const pv = this.peek(k).t === "pragma" ? this.peek(k).v : "";
      if (pv === "throwsError")
        throwsError = true;
      else if (pv === "noBacktrace")
        noBacktrace = true;
      else if (pv.startsWith("userFunctionName="))
        userFunctionName = pv.slice("userFunctionName=".length);
    }
    const body = [];
    while (!this.is("}"))
      body.push(this.statement());
    this.eat("}");
    if (rest != null) {
      const m = (o, p) => ({ k: "member", o, p });
      const slice = m(m(m({ k: "id", name: "Array" }, "prototype"), "slice"), "call");
      const numOptional = defaults.filter((d) => d != null).length;
      const restLine = numOptional === 0 ? ftok.line : ftok.line + numOptional + 2;
      const init = { k: "call", c: slice, args: [{ k: "id", name: "arguments" }, { k: "num", raw: String(names.length) }], line: restLine };
      body.unshift({ s: "var", decls: [{ name: rest, init }], line: restLine });
    }
    return { k: "func", name, params: names, defaults, body, line: fline, col: ftok.col, file: ftok.file, ...throwsError ? { throwsError: true } : {}, ...noBacktrace ? { noBacktrace: true } : {}, ...noProfile ? { noProfile: true } : {}, ...userFunctionName !== void 0 ? { userFunctionName } : {}, ...types.some((t) => t != null) ? { paramTypes: types } : {}, ...returnType != null ? { returnType } : {} };
  }
  /** Formal parameter list `(a, b:Type, c=default)` → names + optional defaults. */
  formalParams() {
    this.eat("(");
    const names = [];
    const defaults = [];
    const types = [];
    let rest = null;
    while (!this.is(")")) {
      if (this.is("...")) {
        this.next();
        rest = this.eat("id").v;
        this.skipTypeAnnotation();
        break;
      }
      const nm = this.eat("id").v;
      const pt = this.skipTypeAnnotation();
      let def = null;
      if (this.is("=")) {
        this.next();
        def = this.assign();
      }
      names.push(nm);
      defaults.push(def);
      types.push(pt);
      if (this.is(","))
        this.next();
      else
        break;
    }
    this.eat(")");
    return { names, defaults, rest, types };
  }
  argList() {
    this.eat("(");
    const args = [];
    while (!this.is(")")) {
      args.push(this.assign());
      if (this.is(","))
        this.next();
      else
        break;
    }
    this.eat(")");
    return args;
  }
  primary() {
    const t = this.peek();
    switch (t.t) {
      case "num":
        this.next();
        return { k: "num", raw: t.v };
      case "str":
        this.next();
        return { k: "str", v: t.v };
      case "id":
        this.next();
        return { k: "id", name: t.v, line: t.line };
      case "this":
        this.next();
        return { k: "this" };
      case "super":
        this.next();
        return { k: "super" };
      case "function":
        return this.functionExpr();
      case "true":
      case "false":
      case "null":
        this.next();
        return { k: "lit", v: t.t };
      // Drop explicit parens — precedence-based wrapping re-adds only the
      // necessary ones (matching ParseTreePrinter, which does not preserve them).
      case "(": {
        this.next();
        const e = this.expression();
        this.eat(")");
        return e;
      }
      case "[": {
        this.next();
        const els = [];
        while (!this.is("]")) {
          els.push(this.assign());
          if (this.is(","))
            this.next();
          else
            break;
        }
        this.eat("]");
        return { k: "array", els };
      }
      case "{": {
        this.next();
        const props = [];
        while (!this.is("}")) {
          let key;
          let keyKind;
          const kt = this.peek();
          if (kt.t === "str") {
            this.next();
            key = kt.v;
            keyKind = "str";
          } else if (kt.t === "num") {
            this.next();
            key = kt.v;
            keyKind = "num";
          } else {
            this.next();
            key = kt.v;
            keyKind = "id";
          }
          this.eat(":");
          props.push({ key, keyKind, computed: false, v: this.assign() });
          if (this.is(","))
            this.next();
          else
            break;
        }
        this.eat("}");
        return { k: "object", props };
      }
      default:
        throw new ScUnsupported(`parse: unexpected ${t.t} '${t.v}' @${t.file ?? "?"}#${t.line}`);
    }
  }
};
var BINPREC = {
  "||": 3,
  "&&": 4,
  "|": 5,
  "^": 6,
  "&": 7,
  "==": 8,
  "!=": 8,
  "===": 8,
  "!==": 8,
  "<": 9,
  ">": 9,
  "<=": 9,
  ">=": 9,
  instanceof: 9,
  in: 9,
  "<<": 10,
  ">>": 10,
  ">>>": 10,
  "+": 11,
  "-": 11,
  "*": 12,
  "/": 12,
  "%": 12,
  "**": 13
};
var LOGIC = /* @__PURE__ */ new Set(["&&", "||"]);
var MAGIC_FALSE = /* @__PURE__ */ new Set(["$swf7", "$swf8", "$as2", "$swf9", "$swf10", "$as3", "$j2me", "$svg", "$profile", "$backtrace"]);
var MAGIC_TRUE = /* @__PURE__ */ new Set(["$dhtml", "$js1"]);
var SC_DEBUG = false;
function setScDebug(v) {
  SC_DEBUG = v;
}
var SC_BACKTRACE = false;
function setScBacktrace(v) {
  SC_BACKTRACE = v;
}
var SC_PROFILE = false;
function setScProfile(v) {
  SC_PROFILE = v;
}
var PROFILE_VARS = ["$lzsc$lzp", "$lzsc$now", "$lzsc$name"];
function meterEvent(lzp, now, name, getname, event) {
  return "var " + lzp + ' = global["$lzprofiler"];\nif (' + lzp + ") {\nvar " + now + ' = "" + (new Date().getTime() - ' + lzp + ".base);\nvar " + name + " = " + getname + ";\nif (" + lzp + ".last == " + now + ") {\n" + lzp + ".events[" + now + '] += ",' + event + ':" + ' + name + "\n} else {\n" + lzp + "." + event + "[" + now + "] = " + name + "\n};\n" + lzp + ".last = " + now + "\n}";
}
var SC_LFC_GENSYM = null;
var SC_LFC_NAMEFUNCS = false;
var SC_KNOWN_GLOBALS = /* @__PURE__ */ new Set([
  "NaN",
  "Infinity",
  "undefined",
  "eval",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "Object",
  "Function",
  "Array",
  "String",
  "Boolean",
  "Number",
  "Date",
  "RegExp",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  "Math",
  "lz",
  // debug-mode globals
  "Debug",
  "$reportNotFunction",
  "$reportUndefinedObjectProperty",
  "$reportUndefinedMethod",
  "$reportException",
  "$reportUndefinedProperty",
  "$reportUndefinedVariable",
  "$reportSourceWarning"
]);
var SC_KNOWN_CLASSNAMES = /* @__PURE__ */ new Set();
function resetKnownClassnames() {
  SC_KNOWN_CLASSNAMES = /* @__PURE__ */ new Set();
}
var SC_KNOWN_IDS = /* @__PURE__ */ new Set();
function resetKnownIds() {
  SC_KNOWN_IDS = /* @__PURE__ */ new Set();
}
function addKnownId(name) {
  SC_KNOWN_IDS.add(name);
}
var isFalse = (n) => n.k === "lit" && n.v === "false";
var isTrue = (n) => n.k === "lit" && n.v === "true";
var isMagicConst = (name) => name === "$debug" || MAGIC_FALSE.has(name) || MAGIC_TRUE.has(name);
function foldNode(n) {
  switch (n.k) {
    case "id":
      if (n.name === "$debug")
        return { k: "lit", v: SC_DEBUG ? "true" : "false" };
      if (n.name === "$profile")
        return { k: "lit", v: SC_PROFILE ? "true" : "false" };
      if (MAGIC_FALSE.has(n.name))
        return { k: "lit", v: "false" };
      if (MAGIC_TRUE.has(n.name))
        return { k: "lit", v: "true" };
      return n;
    case "logic": {
      const foldOp = (x) => x.k === "id" && isMagicConst(x.name) ? x : foldNode(x);
      const l = foldOp(n.l);
      if (n.op === "&&") {
        if (isFalse(l))
          return { k: "lit", v: "false" };
        if (isTrue(l))
          return foldOp(n.r);
      } else {
        if (isTrue(l))
          return { k: "lit", v: "true" };
        if (isFalse(l))
          return foldOp(n.r);
      }
      return { k: "logic", op: n.op, l, r: foldOp(n.r) };
    }
    case "cond": {
      const c = foldNode(n.c);
      if (isFalse(c))
        return foldNode(n.f);
      if (isTrue(c))
        return foldNode(n.t);
      return { k: "cond", c, t: foldNode(n.t), f: foldNode(n.f) };
    }
    case "unary": {
      const e = n.e.k === "id" && isMagicConst(n.e.name) ? n.e : foldNode(n.e);
      if (n.op === "!") {
        if (isFalse(e))
          return { k: "lit", v: "true" };
        if (isTrue(e))
          return { k: "lit", v: "false" };
      }
      return { k: "unary", op: n.op, e, prefix: n.prefix, line: n.line };
    }
    case "paren":
      return { k: "paren", e: foldNode(n.e) };
    case "cast":
      return { k: "cast", e: foldNode(n.e), type: foldNode(n.type) };
    case "func":
      return { k: "func", name: n.name, params: n.params, defaults: n.defaults.map((d) => d ? foldNode(d) : null), body: foldStmts(n.body), line: n.line, col: n.col, file: n.file, ...n.throwsError ? { throwsError: true } : {}, ...n.noBacktrace ? { noBacktrace: true } : {}, ...n.noProfile ? { noProfile: true } : {}, ...n.userFunctionName !== void 0 ? { userFunctionName: n.userFunctionName } : {}, ...n.paramTypes ? { paramTypes: n.paramTypes } : {}, ...n.returnType != null ? { returnType: n.returnType } : {} };
    case "bin":
      return { k: "bin", op: n.op, l: foldNode(n.l), r: foldNode(n.r) };
    case "assign":
      return { k: "assign", op: n.op, l: foldNode(n.l), r: foldNode(n.r) };
    case "member":
      return { k: "member", o: foldNode(n.o), p: n.p };
    case "index":
      return { k: "index", o: foldNode(n.o), i: foldNode(n.i) };
    case "call":
      return { k: "call", c: foldNode(n.c), args: n.args.map(foldNode), line: n.line };
    case "new":
      return { k: "new", c: foldNode(n.c), args: n.args.map(foldNode), line: n.line };
    case "array":
      return { k: "array", els: n.els.map(foldNode) };
    case "object":
      return { k: "object", props: n.props.map((p) => ({ ...p, v: foldNode(p.v) })) };
    case "seq":
      return { k: "seq", es: n.es.map(foldNode) };
    default:
      return n;
  }
}
function foldStmt(s) {
  const out = foldStmtInner(s);
  const line = s.line;
  if (line !== void 0) {
    for (const r of out)
      if (r.line === void 0)
        r.line = line;
  }
  const file = s.file;
  if (file !== void 0) {
    for (const r of out)
      if (r.file === void 0)
        r.file = file;
  }
  const endLine = s.endLine;
  if (endLine !== void 0) {
    for (const r of out)
      if (r.endLine === void 0)
        r.endLine = endLine;
  }
  const sqp = s.superQuirkPredecessor;
  if (sqp !== void 0) {
    for (const r of out)
      if (r.superQuirkPredecessor === void 0)
        r.superQuirkPredecessor = sqp;
  }
  const slbi = s.singleLineBlockIf;
  if (slbi !== void 0) {
    for (const r of out)
      if (r.singleLineBlockIf === void 0)
        r.singleLineBlockIf = slbi;
  }
  const aft = s.afterDir;
  if (aft !== void 0) {
    for (const r of out)
      if (r.afterDir === void 0)
        r.afterDir = aft;
  }
  return out;
}
function foldStmtInner(s) {
  switch (s.s) {
    case "if": {
      const c = foldNode(s.c);
      if (isFalse(c))
        return s.e ? [foldOne(s.e)] : [];
      if (isTrue(c))
        return [foldOne(s.t)];
      let e = s.e ? foldOne(s.e) : null;
      if (e && isEmptyStmt(e))
        e = null;
      return [{ s: "if", c, t: foldOne(s.t), e, elseLine: s.elseLine }];
    }
    case "include":
      return [s];
    // expanded by compileLibraryProgram after fold (dead-branch includes are gone)
    case "expr":
      return [{ s: "expr", e: foldNode(s.e) }];
    case "var":
      return [{ s: "var", decls: s.decls.map((d) => ({ name: d.name, init: d.init ? foldNode(d.init) : null })) }];
    case "return":
      return [{ s: "return", e: s.e ? foldNode(s.e) : null }];
    case "block":
      return [{ s: "block", body: foldStmts(s.body) }];
    case "while":
      return [{ s: "while", c: foldNode(s.c), body: foldOne(s.body) }];
    case "dowhile":
      return [{ s: "dowhile", c: foldNode(s.c), body: foldOne(s.body) }];
    case "with":
      return [{ s: "with", c: foldNode(s.c), body: foldOne(s.body) }];
    case "funcdecl":
      return [{ s: "funcdecl", name: s.name, fn: foldNode(s.fn) }];
    case "for":
      return [{
        s: "for",
        init: s.init == null ? null : "s" in s.init ? foldStmt(s.init)[0] ?? { s: "empty" } : foldNode(s.init),
        test: s.test ? foldNode(s.test) : null,
        upd: s.upd ? foldNode(s.upd) : null,
        body: foldOne(s.body)
      }];
    case "forin":
      return [{ s: "forin", varName: s.varName, lhs: s.varName ? s.lhs : foldNode(s.lhs), obj: foldNode(s.obj), body: foldOne(s.body) }];
    case "switch":
      return [{ s: "switch", disc: foldNode(s.disc), cases: s.cases.map((cl) => {
        const folded = foldStmts(
          cl.body,
          /*spliceBlocks*/
          false
        );
        const body = folded.length === 0 && cl.body.length > 0 ? [{ s: "empty", dead: true }] : folded;
        return { test: cl.test ? foldNode(cl.test) : null, body, line: cl.line, file: cl.file };
      }) }];
    case "throw":
      return [{ s: "throw", e: foldNode(s.e) }];
    case "try":
      return [{
        s: "try",
        param: s.param,
        block: foldOne(s.block),
        handler: s.handler ? foldOne(s.handler) : null,
        handlerLine: s.handlerLine,
        finalizer: s.finalizer ? foldOne(s.finalizer) : null,
        finalizerLine: s.finalizerLine
      }];
    case "as3class":
      return [{
        s: "as3class",
        name: s.name,
        sup: s.sup,
        mixins: s.mixins,
        xtor: s.xtor,
        semi: s.semi,
        classLine: s.classLine,
        members: s.members.map((m) => m.kind === "var" ? { ...m, init: m.init ? foldNode(m.init) : null } : m.kind === "method" ? { ...m, fn: foldNode(m.fn) } : { kind: "stmt", stmt: foldStmt(m.stmt)[0] ?? { s: "empty" } })
      }];
    default:
      return [s];
  }
}
function isEmptyStmt(s) {
  return s.s === "empty" || s.s === "block" && s.body.length === 0;
}
function foldOne(s) {
  const r = foldStmt(s);
  return r.length === 1 ? r[0] : r.length === 0 ? { s: "empty" } : { s: "block", body: r };
}
function foldStmts(body, spliceBlocks = true) {
  const out = [];
  for (const s of body)
    for (const f of foldStmt(s)) {
      if (f.s === "block" && spliceBlocks)
        out.push(...f.body);
      else
        out.push(f);
    }
  return out;
}
var AVAILABLE = /* @__PURE__ */ new Set(["this", "arguments", "super", "_root", "_parent", "_global", "$flasm"]);
function freeVarsOfNode(n, declared, out) {
  switch (n.k) {
    case "id":
      if (!declared.has(n.name))
        out.add(n.name);
      break;
    // A nested function's free variables escape to the enclosing scope (the
    // analyzer's `innerFree`): closing over a variable counts as a use.
    case "func":
      for (const v of computeFree(n.params, n.body))
        if (!declared.has(v))
          out.add(v);
      break;
    case "member":
      freeVarsOfNode(n.o, declared, out);
      break;
    // .p is a property name
    case "index":
      freeVarsOfNode(n.o, declared, out);
      freeVarsOfNode(n.i, declared, out);
      break;
    case "call":
      freeVarsOfNode(n.c, declared, out);
      n.args.forEach((a) => freeVarsOfNode(a, declared, out));
      break;
    case "new":
      freeVarsOfNode(n.c, declared, out);
      n.args.forEach((a) => freeVarsOfNode(a, declared, out));
      break;
    case "unary":
      freeVarsOfNode(n.e, declared, out);
      break;
    case "bin":
    case "logic":
    case "assign":
      freeVarsOfNode(n.l, declared, out);
      freeVarsOfNode(n.r, declared, out);
      break;
    case "cond":
      freeVarsOfNode(n.c, declared, out);
      freeVarsOfNode(n.t, declared, out);
      freeVarsOfNode(n.f, declared, out);
      break;
    case "paren":
      freeVarsOfNode(n.e, declared, out);
      break;
    case "cast":
      freeVarsOfNode(n.e, declared, out);
      freeVarsOfNode(n.type, declared, out);
      break;
    case "seq":
      n.es.forEach((e) => freeVarsOfNode(e, declared, out));
      break;
    case "array":
      n.els.forEach((e) => freeVarsOfNode(e, declared, out));
      break;
    case "object":
      n.props.forEach((p) => freeVarsOfNode(p.v, declared, out));
      break;
  }
}
function freeVarsOfStmts(declared, body) {
  const out = /* @__PURE__ */ new Set();
  const walkS = (s) => {
    switch (s.s) {
      case "expr":
        freeVarsOfNode(s.e, declared, out);
        break;
      case "var":
        s.decls.forEach((d) => {
          if (d.init)
            freeVarsOfNode(d.init, declared, out);
        });
        break;
      case "return":
        if (s.e)
          freeVarsOfNode(s.e, declared, out);
        break;
      case "if":
        freeVarsOfNode(s.c, declared, out);
        walkS(s.t);
        if (s.e)
          walkS(s.e);
        break;
      case "block":
        s.body.forEach(walkS);
        break;
      case "while":
      case "dowhile":
        freeVarsOfNode(s.c, declared, out);
        walkS(s.body);
        break;
      case "with":
        freeVarsOfNode(s.c, declared, out);
        walkS(s.body);
        break;
      case "funcdecl":
        freeVarsOfNode(s.fn, declared, out);
        break;
      case "for":
        if (s.init) {
          if ("s" in s.init)
            walkS(s.init);
          else
            freeVarsOfNode(s.init, declared, out);
        }
        if (s.test)
          freeVarsOfNode(s.test, declared, out);
        if (s.upd)
          freeVarsOfNode(s.upd, declared, out);
        walkS(s.body);
        break;
      case "forin":
        if (!s.varName)
          freeVarsOfNode(s.lhs, declared, out);
        freeVarsOfNode(s.obj, declared, out);
        walkS(s.body);
        break;
      case "switch":
        freeVarsOfNode(s.disc, declared, out);
        s.cases.forEach((cl) => {
          if (cl.test)
            freeVarsOfNode(cl.test, declared, out);
          cl.body.forEach(walkS);
        });
        break;
      case "throw":
        freeVarsOfNode(s.e, declared, out);
        break;
      case "try":
        walkS(s.block);
        if (s.handler)
          walkS(s.handler);
        if (s.finalizer)
          walkS(s.finalizer);
        break;
    }
  };
  body.forEach(walkS);
  return out;
}
function hasNestedFuncDecl(body) {
  let found = false;
  const wS = (s) => {
    switch (s.s) {
      case "funcdecl":
        found = true;
        break;
      case "block":
        s.body.forEach(wS);
        break;
      case "if":
        wS(s.t);
        if (s.e)
          wS(s.e);
        break;
      case "while":
      case "dowhile":
      case "with":
        wS(s.body);
        break;
      case "for":
        if (s.init && "s" in s.init)
          wS(s.init);
        wS(s.body);
        break;
      case "forin":
        wS(s.body);
        break;
      case "switch":
        s.cases.forEach((cl) => cl.body.forEach(wS));
        break;
      case "try":
        wS(s.block);
        if (s.handler)
          wS(s.handler);
        if (s.finalizer)
          wS(s.finalizer);
        break;
    }
  };
  body.forEach(wS);
  return found;
}
function collectVariables(body) {
  const order = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (n) => {
    if (!seen.has(n)) {
      seen.add(n);
      order.push(n);
    }
  };
  const walkS = (st) => {
    switch (st.s) {
      case "var":
        for (const d of st.decls)
          add(d.name);
        break;
      case "funcdecl":
        add(st.name);
        break;
      case "block":
        st.body.forEach(walkS);
        break;
      case "if":
        walkS(st.t);
        if (st.e)
          walkS(st.e);
        break;
      case "while":
      case "dowhile":
      case "with":
        walkS(st.body);
        break;
      case "for":
        if (st.init && "s" in st.init)
          walkS(st.init);
        walkS(st.body);
        break;
      case "forin":
        if (st.varName)
          add(st.varName);
        walkS(st.body);
        break;
      case "switch":
        st.cases.forEach((cl) => cl.body.forEach(walkS));
        break;
      case "try":
        walkS(st.block);
        if (st.param)
          add(st.param);
        if (st.handler)
          walkS(st.handler);
        if (st.finalizer)
          walkS(st.finalizer);
        break;
    }
  };
  body.forEach(walkS);
  return order;
}
function collectFuncDecls(body) {
  const out = [];
  const wS = (s) => {
    switch (s.s) {
      case "funcdecl":
        out.push(s);
        break;
      // does NOT descend into s.fn (own scope)
      case "block":
        s.body.forEach(wS);
        break;
      case "if":
        wS(s.t);
        if (s.e)
          wS(s.e);
        break;
      case "while":
      case "dowhile":
      case "with":
        wS(s.body);
        break;
      case "for":
        if (s.init && "s" in s.init)
          wS(s.init);
        wS(s.body);
        break;
      case "forin":
        wS(s.body);
        break;
      case "switch":
        s.cases.forEach((cl) => cl.body.forEach(wS));
        break;
      case "try":
        wS(s.block);
        if (s.handler)
          wS(s.handler);
        if (s.finalizer)
          wS(s.finalizer);
        break;
    }
  };
  body.forEach(wS);
  return out;
}
function stripFuncDecls(body) {
  const sS = (s) => {
    switch (s.s) {
      case "block":
        return { ...s, body: stripFuncDecls(s.body) };
      case "if":
        return { ...s, t: sS(s.t), e: s.e ? sS(s.e) : null };
      case "while":
      case "dowhile":
      case "with":
        return { ...s, body: sS(s.body) };
      case "for":
        return { ...s, init: s.init && "s" in s.init ? sS(s.init) : s.init, body: sS(s.body) };
      case "forin":
        return { ...s, body: sS(s.body) };
      case "switch":
        return { ...s, cases: s.cases.map((cl) => ({ ...cl, body: stripFuncDecls(cl.body) })) };
      case "try":
        return { ...s, block: sS(s.block), handler: s.handler ? sS(s.handler) : null, finalizer: s.finalizer ? sS(s.finalizer) : null };
      default:
        return s;
    }
  };
  return body.filter((s) => s.s !== "funcdecl").map(sS);
}
function computeFree(params, body) {
  const declared = /* @__PURE__ */ new Set([...params, ...collectVariables(body), ...AVAILABLE]);
  return freeVarsOfStmts(declared, body);
}
function collectDirectFuncs(body) {
  const out = [];
  const wN = (n) => {
    switch (n.k) {
      case "func":
        out.push(n);
        return;
      // do not descend
      case "member":
        wN(n.o);
        break;
      case "index":
        wN(n.o);
        wN(n.i);
        break;
      case "call":
      case "new":
        wN(n.c);
        n.args.forEach(wN);
        break;
      case "unary":
        wN(n.e);
        break;
      case "bin":
      case "logic":
      case "assign":
        wN(n.l);
        wN(n.r);
        break;
      case "cond":
        wN(n.c);
        wN(n.t);
        wN(n.f);
        break;
      case "paren":
        wN(n.e);
        break;
      case "cast":
        wN(n.e);
        wN(n.type);
        break;
      case "seq":
        n.es.forEach(wN);
        break;
      case "array":
        n.els.forEach(wN);
        break;
      case "object":
        n.props.forEach((p) => wN(p.v));
        break;
    }
  };
  const wS = (s) => {
    switch (s.s) {
      case "expr":
        wN(s.e);
        break;
      case "var":
        s.decls.forEach((d) => {
          if (d.init)
            wN(d.init);
        });
        break;
      case "return":
        if (s.e)
          wN(s.e);
        break;
      case "if":
        wN(s.c);
        wS(s.t);
        if (s.e)
          wS(s.e);
        break;
      case "block":
        s.body.forEach(wS);
        break;
      case "while":
      case "dowhile":
        wN(s.c);
        wS(s.body);
        break;
      case "with":
        wN(s.c);
        wS(s.body);
        break;
      case "funcdecl":
        wN(s.fn);
        break;
      case "for":
        if (s.init) {
          if ("s" in s.init)
            wS(s.init);
          else
            wN(s.init);
        }
        if (s.test)
          wN(s.test);
        if (s.upd)
          wN(s.upd);
        wS(s.body);
        break;
      case "forin":
        if (!s.varName)
          wN(s.lhs);
        wN(s.obj);
        wS(s.body);
        break;
      case "switch":
        wN(s.disc);
        s.cases.forEach((cl) => {
          if (cl.test)
            wN(cl.test);
          cl.body.forEach(wS);
        });
        break;
      case "throw":
        wN(s.e);
        break;
      case "try":
        wS(s.block);
        if (s.handler)
          wS(s.handler);
        if (s.finalizer)
          wS(s.finalizer);
        break;
    }
  };
  body.forEach(wS);
  return out;
}
function computeDereferenced(body) {
  let found = false;
  const wN = (n) => {
    if (found)
      return;
    switch (n.k) {
      case "member":
      case "index":
        found = true;
        return;
      // A super call is an ASTSuperCallExpression, NOT an ASTCallExpression
      // (VariableAnalyzer.java:122/159) — it does NOT mark `dereferenced`, and
      // only its ARGUMENTS (node.get(2)) are visited as references; the
      // `super`/selector callee is skipped. So `super.init()` (no derefs in its
      // args) is NOT dereferenced. (Grammar: super | super.X | super.X.call/apply.)
      case "call":
        if (isSuperCallExpr(n)) {
          n.args.forEach(wN);
          return;
        }
        found = true;
        return;
      // also descend for sub-derefs (harmless)
      case "func":
        return;
      // nested closure: own analyzer
      case "new":
        n.args.forEach(wN);
        wN(n.c);
        break;
      case "unary":
        wN(n.e);
        break;
      case "bin":
      case "logic":
      case "assign":
        wN(n.l);
        wN(n.r);
        break;
      case "cond":
        wN(n.c);
        wN(n.t);
        wN(n.f);
        break;
      case "paren":
        wN(n.e);
        break;
      case "cast":
        wN(n.e);
        wN(n.type);
        break;
      case "seq":
        n.es.forEach(wN);
        break;
      case "array":
        n.els.forEach(wN);
        break;
      case "object":
        n.props.forEach((p) => wN(p.v));
        break;
    }
  };
  const wS = (s) => {
    if (found)
      return;
    switch (s.s) {
      case "expr":
        wN(s.e);
        break;
      case "var":
        s.decls.forEach((d) => {
          if (d.init)
            wN(d.init);
        });
        break;
      case "return":
        if (s.e)
          wN(s.e);
        break;
      case "if":
        wN(s.c);
        wS(s.t);
        if (s.e)
          wS(s.e);
        break;
      case "block":
        s.body.forEach(wS);
        break;
      case "while":
      case "dowhile":
        wN(s.c);
        wS(s.body);
        break;
      case "with":
        wN(s.c);
        wS(s.body);
        break;
      case "funcdecl":
        break;
      // nested closure: own analyzer
      case "for":
        if (s.init) {
          if ("s" in s.init)
            wS(s.init);
          else
            wN(s.init);
        }
        if (s.test)
          wN(s.test);
        if (s.upd)
          wN(s.upd);
        wS(s.body);
        break;
      case "forin":
        if (!s.varName)
          wN(s.lhs);
        wN(s.obj);
        wS(s.body);
        break;
      case "switch":
        wN(s.disc);
        s.cases.forEach((cl) => {
          if (cl.test)
            wN(cl.test);
          cl.body.forEach(wS);
        });
        break;
      case "throw":
        wN(s.e);
        break;
      case "try":
        wS(s.block);
        if (s.handler)
          wS(s.handler);
        if (s.finalizer)
          wS(s.finalizer);
        break;
    }
  };
  body.forEach(wS);
  return found;
}
var BACKTRACE_VARS = ["$lzsc$d", "$lzsc$s", "$lzsc$a"];
function analyzeScope(params, body, isMethod, as3, debug = false, noBacktrace = false, noProfile = false) {
  const variables = collectVariables(body);
  if (debug && SC_BACKTRACE && !noBacktrace) {
    for (const v of BACKTRACE_VARS)
      if (!variables.includes(v))
        variables.push(v);
  }
  if (debug && SC_PROFILE && !noProfile) {
    for (const v of PROFILE_VARS)
      if (!variables.includes(v))
        variables.push(v);
  }
  const localSet = /* @__PURE__ */ new Set([...params, ...variables]);
  const free = computeFree(params, body);
  const innerFree = /* @__PURE__ */ new Set();
  for (const f of collectDirectFuncs(body))
    for (const x of computeFree(f.params, f.body))
      innerFree.add(x);
  const closed = new Set([...localSet].filter((n) => innerFree.has(n)));
  const possible = as3 !== void 0 ? new Set([...free].filter((f) => as3.props.has(f))) : free;
  const withThis = isMethod && possible.size > 0;
  const fullMap = /* @__PURE__ */ new Map();
  let regno = 0;
  for (const k of /* @__PURE__ */ new Set([...params, ...variables])) {
    const skip = !withThis && closed.has(k) || withThis && closed.has(k) && !params.includes(k);
    if (skip)
      continue;
    let r;
    const synthetic = k.startsWith("$");
    do {
      const reg = "$" + regno.toString(36);
      r = debug && !synthetic ? k + "_" + reg : reg;
      regno++;
    } while (localSet.has(r) || free.has(r));
    fullMap.set(k, r);
  }
  const closedParams = withThis ? params.filter((p) => closed.has(p)) : [];
  const bodyMap = new Map(fullMap);
  const closedRedecls = closedParams.map((p) => ({ name: p, reg: fullMap.get(p) }));
  for (const p of closedParams)
    bodyMap.delete(p);
  const newParams = params.map((p) => fullMap.get(p) ?? p);
  return { map: bodyMap, newParams, withThis, closedRedecls, free, dereferenced: computeDereferenced(body), locals: localSet, closed };
}
var NL = "\n";
var UNARY_WORD = /* @__PURE__ */ new Set(["typeof", "void", "delete"]);
var Printer = class _Printer {
  nextGensym() {
    return "$lzsc$" + (this.gensym.n++).toString(36);
  }
  constructor(rename, compress = true) {
    this.lfc = false;
    this.classDescriptors = /* @__PURE__ */ new Map();
    this.dbg = false;
    this.dfile = "";
    this.dline = 0;
    this.joinDepth = 0;
    this.pendingBlockLine = -1;
    this.dbgLineDelta = 0;
    this.dbgNoWrapper = false;
    this.dbgFree = null;
    this.dbgOuterVars = /* @__PURE__ */ new Set();
    this.dbgLocals = /* @__PURE__ */ new Set();
    this.dbgInsideFunc = false;
    this.outerUserName = null;
    this.btVar = null;
    this.btSuppress = false;
    this.btSuperSeen = false;
    this.btWarnUndef = true;
    this.gensym = { n: 1 };
    this.rename = rename;
    this.c = compress;
    this.SP = compress ? "" : " ";
    this.COMMA = "," + this.SP;
    this.COLON = ":" + this.SP;
    this.ASSIGN = this.SP + "=" + this.SP;
    this.OPENP = this.SP + "(";
    this.CLOSEP = ")" + this.SP;
  }
  id(name) {
    return this.rename.get(name) ?? name;
  }
  // lnum (ParseTreePrinter:1184): in a debug build, prefix a source-line
  // annotation to a node's output unless an equivalent annotation is already at
  // the head of the string. `line` is the construct's source line in `dfile`
  // (0 / null = generated code → the `/* -*- file: -*- */` marker).
  lnum(line, str, fileOverride) {
    if (!this.dbg)
      return str;
    const file = fileOverride !== void 0 ? fileOverride : line == null ? "" : this.dfile;
    const eff = line == null ? null : line + this.dbgLineDelta;
    const ann = firstAnnotation(str);
    if (str.length <= 1 || str[0] !== ANNOTATE_MARKER || fileLineNumberNeeded(ann, file, eff ?? 0)) {
      return annoFileLine(file, eff ?? 0) + str;
    }
    return str;
  }
  // A super-call (translateSuperCallExpression) gets NO noteCallSite
  // (JavascriptGenerator:834) — detect the three super dispatch shapes so they
  // are excluded from backtrace instrumentation.
  isSuperCall(n) {
    const c = n.c;
    if (c.k === "super")
      return true;
    if (c.k === "member" && c.o.k === "super")
      return true;
    if (c.k === "member" && (c.p === "call" || c.p === "apply") && c.o.k === "member" && c.o.o.k === "super")
      return true;
    return false;
  }
  // Backtrace noteCallSite predicate: a call node carrying a source line (and not
  // a super dispatch) is wrapped `($lzsc$a.lineno = <line>, <call>)`.
  btNotableCall(n) {
    if (this.btVar == null || typeof n.line !== "number" || n.line <= 0)
      return false;
    if (n.k === "new")
      return true;
    return n.k === "call" && !this.isSuperCall(n);
  }
  // Backtrace noteCallSite predicate for a CHECKED free-bare-id reference
  // (makeCheckedNode): a free identifier carrying a source line, not resolving to
  // an enclosing-scope binding. Wrapped `($lzsc$a.lineno = <line>, <id>)`.
  btNotableId(n) {
    return this.btVar != null && this.btWarnUndef && n.k === "id" && typeof n.line === "number" && n.line > 0 && this.dbgFree != null && this.dbgFree.has(n.name) && !this.dbgOuterVars.has(n.name) && !SC_KNOWN_GLOBALS.has(n.name) && !SC_KNOWN_CLASSNAMES.has(n.name) && !SC_KNOWN_IDS.has(n.name);
  }
  // precedence for paren decisions
  prec(n) {
    if ((this.btNotableCall(n) || this.btNotableId(n)) && !this.btSuppress)
      return 0;
    switch (n.k) {
      case "seq":
        return 0;
      case "assign":
        return 1;
      case "cond":
        return 2;
      case "logic":
        return BINPREC[n.op];
      // The `in` operator is PARSED at relational precedence (BINPREC, used by the
      // parser) but the oracle's ParseTreePrinter deliberately moved it to the
      // ASSIGNMENT precedence row for paren decisions (ParseTreePrinter.prec table,
      // "to compensate for SWF9 3rd party compiler precedence bug") — so an `in`
      // expression used as an operand of `||`/`&&`/etc. is parenthesized:
      // `! (("x" in args) || …)`. Assignment level = 1 in this (printer-only) scale.
      case "bin":
        return n.op === "in" ? 1 : BINPREC[n.op];
      case "unary":
        return n.prefix ? 14 : 15;
      case "call":
      case "new":
      case "member":
      case "index":
        return 17;
      case "cast":
        return this.prec(n.e);
      // A function expression has assignment precedence (ParseTreePrinter:
      // ASTFunctionExpression → prec(ASSIGN)); it is parenthesized when used as a
      // call/member base, but not as an argument, var-initializer, or RHS. BUT in
      // the DEBUG build a function VALUE renders as the displayName-IIFE
      // `(function(){…})()` — itself a CALL expression (prec 17) that already
      // carries its parens — so a debug func used as a call/member base needs NO
      // extra wrap (the oracle's `(…IIFE…)()(arg)`, not `((…IIFE…)())(arg)`).
      case "func":
        return this.dbg ? 17 : 1;
      default:
        return 20;
    }
  }
  wrap(child, parentPrec, rightSide = false) {
    const cp = this.prec(child);
    if (cp < parentPrec || cp === parentPrec && rightSide)
      return "(" + this.expr(child) + ")";
    return this.expr(child);
  }
  expr(n) {
    if (this.btVar != null && (this.btNotableCall(n) || this.btNotableId(n))) {
      if (!this.btSuppress) {
        const line = n.line;
        this.btSuppress = true;
        const inner = this.expr(n);
        const cp = this.btSuperSeen ? this.dfile : "";
        return annoFileLine(null, 0) + annoFileLine(cp, 1) + this.btVar + ".lineno = " + line + ", " + inner;
      }
      this.btSuppress = false;
    }
    switch (n.k) {
      case "num":
        return printNumber(n.raw);
      case "str":
        return jsString(n.v);
      case "id":
        return this.id(n.name);
      case "this":
        return "this";
      case "super":
        return "super";
      case "lit":
        return n.v;
      case "paren":
        return this.expr(n.e);
      // parens reinserted by precedence
      case "cast":
        return this.expr(n.e);
      // `e cast Type` erases to `e`
      case "member":
        return this.wrap(n.o, 17) + "." + n.p;
      case "index":
        return this.wrap(n.o, 17) + "[" + this.expr(n.i) + "]";
      case "call": {
        const A = this.SP, C = this.COMMA;
        if (this.btVar != null && this.isSuperCall(n))
          this.btSuperSeen = true;
        if (SC_BACKTRACE && this.btVar != null && n.c.k === "member" && n.c.p === "$lzsc$isa")
          this.btSuperSeen = true;
        const btLine = n.line;
        const nextMethod = (m) => {
          const callExpr = `this.nextMethod(arguments.callee${C}${m})`;
          return this.btVar != null && typeof btLine === "number" && btLine > 0 ? `(${this.btVar}.lineno${this.ASSIGN}${btLine}${C}${callExpr})` : callExpr;
        };
        const dispatch = (m) => `(arguments.callee["$superclass"]${A}&&${A}arguments.callee.$superclass.prototype[${m}]${A}||${A}${nextMethod(m)})`;
        if (n.c.k === "super") {
          const m = jsString("$lzsc$initialize");
          const args = n.args.map((a) => this.wrap(a, 1)).join(C);
          return `${dispatch(m)}.call(this${args ? C + args : ""})`;
        }
        if (n.c.k === "member" && (n.c.p === "call" || n.c.p === "apply") && n.c.o.k === "member" && n.c.o.o.k === "super") {
          const m = jsString(n.c.o.p);
          const args = n.args.map((a) => this.wrap(a, 1)).join(C);
          return `${dispatch(m)}.${n.c.p}(${args})`;
        }
        if (n.c.k === "member" && n.c.o.k === "super") {
          if (n.c.p === "setAttribute" && n.args.length === 2) {
            const value = this.wrap(n.args[1], 1);
            const prop = n.args[0];
            if (prop.k === "str") {
              const m2 = jsString("$lzc$set_" + prop.v);
              return `${dispatch(m2)}.call(this${C}${value})`;
            }
            return `this.nextMethod(arguments.callee${C}${jsString("$lzc$set_")}${A}+${A}${this.expr(prop)}).call(this${C}${value})`;
          }
          const m = jsString(n.c.p);
          const args = n.args.map((a) => this.wrap(a, 1)).join(C);
          return `${dispatch(m)}.call(this${args ? C + args : ""})`;
        }
        const callee = n.c.k === "id" ? this.id(n.c.name) : this.wrap(n.c, 17);
        return callee + "(" + n.args.map((a) => this.wrap(a, 1)).join(this.COMMA) + ")";
      }
      case "new":
        return "new " + this.wrap(n.c, 18) + "(" + n.args.map((a) => this.wrap(a, 1)).join(this.COMMA) + ")";
      case "unary":
        if (this.dbg && !SC_PROFILE && (n.op === "++" || n.op === "--") && n.e.k === "id" && this.dbgFree && this.dbgFree.has(n.e.name) && !this.dbgOuterVars.has(n.e.name)) {
          const sym = n.e.name;
          const step = n.op === "++" ? "+" : "-";
          const innerSrc = n.prefix ? `var $lzsc$tmp = ${sym}; return ${sym} = $lzsc$tmp ${step} 1;` : `var $lzsc$tmp = ${sym}; ${sym} = $lzsc$tmp ${step} 1; return $lzsc$tmp;`;
          const line = n.line ?? this.dline;
          const fn = {
            k: "func",
            name: null,
            params: [],
            defaults: [],
            body: foldStmts(new Parser(lex(innerSrc, line, this.dfile)).parseProgram()),
            line,
            col: 1,
            file: this.dfile
          };
          const userName = this.outerUserName != null ? this.outerUserName : this.dfile + "#" + line + "/1";
          return renderDebugFuncNode(
            fn,
            userName,
            /*named*/
            false,
            this.dfile,
            line,
            "report",
            false,
            void 0,
            this.outerUserName
          ) + "()";
        }
        if (!n.prefix) {
          return this.wrap(n.e, 15) + n.op;
        }
        return n.op + (UNARY_WORD.has(n.op) ? " " : "") + this.wrap(n.e, 14, true);
      case "bin":
      case "logic": {
        const p = n.k === "bin" && n.op === "in" ? 1 : BINPREC[n.op];
        const sp = n.op === "instanceof" || n.op === "in" ? " " : this.SP;
        const r = this.wrap(n.r, p, true);
        const rsp = sp || (r.length > 0 && r[0] !== "(" && n.op[n.op.length - 1] === r[0] ? " " : "");
        return this.wrap(n.l, p) + sp + n.op + rsp + r;
      }
      case "assign":
        if (n.l.k === "id" && this.btNotableId(n.l))
          this.btSuppress = true;
        return this.wrap(n.l, 1) + this.SP + n.op + this.SP + this.wrap(n.r, 1);
      case "cond":
        return this.wrap(n.c, 2, true) + this.SP + "?" + this.SP + this.wrap(n.t, 2, true) + this.SP + ":" + this.SP + this.wrap(n.f, 2, true);
      case "array":
        return "[" + n.els.map((e) => this.wrap(e, 1)).join(this.COMMA) + "]";
      case "object":
        return "{" + n.props.map((p) => {
          const k = p.keyKind === "str" ? jsString(p.key) : p.keyKind === "num" ? printNumber(p.key) : p.key;
          return k + this.COLON + this.wrap(p.v, 1);
        }).join(this.COMMA) + "}";
      case "seq":
        return n.es.map((e) => this.expr(e)).join(this.COMMA);
      case "func":
        return this.printFunc(n);
    }
  }
  /** Print a function expression with its own renaming scope. Nested function
   *  expressions are never methods, so they never get `with(this)`; their
   *  params/locals are renamed per their own register map. */
  printFunc(n) {
    if (this.dbg) {
      const fl = n.line ?? this.dline ?? 0;
      const ffile = n.file !== void 0 ? n.file : this.dfile ?? "";
      const userName = this.outerUserName != null ? this.outerUserName : n.name != null ? n.name : `${ffile}#${n.line}/${n.col}`;
      const childOuter = /* @__PURE__ */ new Set([
        ...this.dbgOuterVars,
        ...this.rename.keys(),
        ...SC_BACKTRACE ? this.dbgLocals : []
      ]);
      const out = renderDebugFuncNode(n, userName, n.name != null, ffile, fl, "report", false, void 0, this.outerUserName, childOuter, void 0, false, this.dbgInsideFunc);
      if (SC_BACKTRACE)
        this.btSuperSeen = true;
      return out;
    }
    const scope = analyzeScope(n.params, n.body, false);
    const sub = new _Printer(scope.map, this.c);
    sub.lfc = this.lfc;
    sub.gensym = this.gensym;
    const funcdecls = collectFuncDecls(n.body);
    const rest = stripFuncDecls(n.body);
    const hoist = funcdecls.length ? funcdecls.map((d) => `var ${sub.id(d.name)};`).join("") + funcdecls.map((d) => `${sub.id(d.name)}=${sub.printFunc(d.fn)};`).join("") : "";
    const cases = n.params.map((_, i) => n.defaults[i] != null ? `case ${i}:
${scope.newParams[i]}=${sub.expr(n.defaults[i])};` : null).filter((c) => c != null);
    const prologue = cases.length > 0 ? `switch(arguments.length){
${cases.join("\n")}

};` : "";
    const inner = hoist + prologue + sub.joinStmts(rest);
    const text = n.throwsError ? sub.throwsWrap(inner) : inner;
    const block = text === "" ? "{}" : sub.makeBlock(text);
    return `function(${scope.newParams.join(",")})${block}`;
  }
  /** Emit a class method/constructor body as `function(…){…}` (a faithful
   *  port of compileFunction's body emission, but over a parsed func node with
   *  AS3-class `with(this)` refinement). Static methods are never `with(this)`
   *  (isMethod=false). */
  printAs3Method(fn, isMethod, as3) {
    const params = fn.params;
    const body = fn.body;
    const scope = analyzeScope(params, body, isMethod, as3);
    const printer = new _Printer(scope.map, this.c);
    printer.lfc = this.lfc;
    printer.gensym = this.gensym;
    const funcdecls = collectFuncDecls(body);
    const rest = stripFuncDecls(body);
    const hoist = funcdecls.length ? funcdecls.map((d) => `var ${printer.id(d.name)};`).join("") + funcdecls.map((d) => `${printer.id(d.name)}=${printer.printFunc(d.fn)};`).join("") : "";
    const cases = params.map((_, i) => {
      if (fn.defaults[i] == null)
        return null;
      const lhs = scope.closedRedecls.some((r) => r.name === params[i]) ? params[i] : scope.newParams[i];
      return `case ${i}:
${lhs}=${printer.expr(foldNode(fn.defaults[i]))};`;
    }).filter((c) => c != null);
    const prologue = cases.length > 0 ? `switch(arguments.length){
${cases.join("\n")}

};` : "";
    const bodyText = printer.joinStmts(rest);
    let block;
    if (scope.withThis) {
      const redecls = scope.closedRedecls.map(({ name, reg }) => `var ${name}=${reg};`).join("");
      const withContent = fn.throwsError ? printer.throwsWrap(redecls + hoist + prologue + bodyText) : redecls + hoist + prologue + bodyText;
      block = printer.makeBlock("with(this)" + printer.makeBlock(withContent));
    } else {
      const inner = hoist + prologue + bodyText;
      const combined = fn.throwsError ? printer.throwsWrap(inner) : inner;
      block = combined === "" ? "{}" : printer.makeBlock(combined);
    }
    return `function(${scope.newParams.join(",")})${block}`;
  }
  /** Compile an AS3 `class` to `Class.make("Name", <instanceprops>[, <super>[,
   *  <classprops>]])` (CommonGenerator.visitClassDefinition). Instance/static
   *  vars become name/value pairs (no init → `void 0`); the constructor is
   *  renamed `$lzsc$initialize`; members appear in source order. No `$m`/`$LZ`
   *  gensym is consumed (names are literal). */
  printAs3Class(n) {
    const ownProps = /* @__PURE__ */ new Set();
    for (const m of n.members) {
      if (m.kind === "stmt" || m.static)
        continue;
      ownProps.add(m.kind === "method" && m.name === n.name ? "$lzsc$initialize" : m.name);
    }
    let complete;
    let refineProps;
    if (n.sup === null) {
      complete = true;
      refineProps = ownProps;
    } else {
      const sd = this.classDescriptors.get(n.sup);
      if (sd && sd.complete) {
        complete = true;
        refineProps = /* @__PURE__ */ new Set([...ownProps, ...sd.props]);
      } else {
        complete = false;
        refineProps = null;
      }
    }
    this.classDescriptors.set(n.name, { complete, props: refineProps ?? ownProps });
    const as3 = refineProps !== null ? { props: refineProps } : void 0;
    const inst = [];
    const stat = [];
    const stmts = [];
    for (const m of n.members) {
      if (m.kind === "stmt") {
        stmts.push(m.stmt);
        continue;
      }
      const target = m.static ? stat : inst;
      if (m.kind === "var") {
        target.push(jsString(m.name));
        target.push(m.init ? this.expr(foldNode(m.init)) : "void 0");
      } else {
        const isCtor = !m.static && m.name === n.name;
        target.push(jsString(isCtor ? "$lzsc$initialize" : m.name));
        target.push(m.static ? this.printAs3Method(m.fn, false) : this.printAs3Method(m.fn, true, as3));
      }
    }
    const instArr = inst.length ? "[" + inst.join(",") + "]" : null;
    const statArr = stat.length ? "[" + stat.join(",") + "]" : null;
    const superRef = n.mixins.length ? "[" + [...n.mixins, ...n.sup !== null ? [n.sup] : []].join(",") + "]" : n.sup;
    let args = "";
    if (statArr !== null)
      args = "," + statArr;
    if (superRef !== null)
      args = "," + superRef + args;
    else if (args.length)
      args = ",null" + args;
    if (instArr !== null)
      args = "," + instArr + args;
    else if (args.length)
      args = ",null" + args;
    const make = `${n.xtor}.make(${jsString(n.name)}${args})`;
    if (stmts.length === 0)
      return make;
    const stmtsText = this.joinStmts(stmts);
    const withBody = this.lfc && unannotateStr(stmtsText).trim() === "" ? "with($0)with($0.prototype){}" : "with($0)with($0.prototype)" + this.makeBlock(this.makeBlock(stmtsText));
    const iife = `(function($0)${this.makeBlock(withBody)})(${n.name})`;
    if (this.lfc)
      return `${make};${iife}`;
    return `{${NL}${make};${iife}${NL}};`;
  }
  /** Debug (compress=false) rendering of a script-level AS3 `class` declaration.
   *  Mirrors printAs3Class but: the instance/static arrays are spaced (`, `), and
   *  each method VALUE is the full displayName-IIFE + try/catch + $reportException
   *  debug stream (renderDebugFuncNode), tracked at the method's own source line.
   *  (CommonGenerator.visitClassDefinition + the debug method machinery.) The
   *  class-body-statement initializer path is not yet handled in debug — refuse. */
  printAs3ClassDebug(n) {
    const ownProps = /* @__PURE__ */ new Set();
    for (const m of n.members) {
      if (m.kind === "stmt" || m.static)
        continue;
      ownProps.add(m.kind === "method" && m.name === n.name ? "$lzsc$initialize" : m.name);
    }
    let complete;
    let refineProps;
    if (n.sup === null) {
      complete = true;
      refineProps = ownProps;
    } else {
      const sd = this.classDescriptors.get(n.sup);
      if (sd && sd.complete) {
        complete = true;
        refineProps = /* @__PURE__ */ new Set([...ownProps, ...sd.props]);
      } else {
        complete = false;
        refineProps = null;
      }
    }
    this.classDescriptors.set(n.name, { complete, props: refineProps ?? ownProps });
    const as3 = refineProps !== null ? { props: refineProps } : void 0;
    const inst = [];
    const stat = [];
    const stmts = [];
    const file = n.file !== void 0 ? n.file : this.dfile;
    for (const m of n.members) {
      if (m.kind === "stmt") {
        stmts.push(m.stmt);
        continue;
      }
      const target = m.static ? stat : inst;
      if (m.kind === "var") {
        target.push(jsString(m.name));
        target.push(m.init ? this.expr(foldNode(m.init)) : "void 0");
      } else {
        const isCtor = !m.static && m.name === n.name;
        const userName = isCtor ? "$lzsc$initialize" : m.name;
        target.push(jsString(userName));
        const methodFile = m.fn.file !== void 0 ? m.fn.file : file;
        target.push(renderDebugFuncNode(
          m.fn,
          userName,
          /*named*/
          true,
          methodFile,
          m.fn.line ?? 0,
          "report",
          /*isMethod*/
          !m.static,
          m.static ? void 0 : as3,
          void 0,
          void 0,
          void 0,
          /*isStatic*/
          m.static
        ));
      }
    }
    const instArr = inst.length ? "[" + inst.join(", ") + "]" : null;
    const statArr = stat.length ? "[" + stat.join(", ") + "]" : null;
    const superRef = n.mixins.length ? "[" + [...n.mixins, ...n.sup !== null ? [n.sup] : []].join(", ") + "]" : n.sup;
    let args = "";
    if (statArr !== null)
      args = ", " + statArr;
    if (superRef !== null)
      args = ", " + superRef + args;
    else if (args.length)
      args = ", null" + args;
    if (instArr !== null)
      args = ", " + instArr + args;
    else if (args.length)
      args = ", null" + args;
    const make = `${n.xtor}.make(${jsString(n.name)}${args})`;
    if (stmts.length === 0)
      return make;
    const cl = n.classLine ?? 0;
    const A = (k) => annoFileLine(file, k);
    const GEN = annoFileLine(null, 0);
    const FB = forceBlankLnum();
    const sub = new _Printer(
      /* @__PURE__ */ new Map(),
      /*compress*/
      false
    );
    sub.dbg = true;
    sub.dfile = file;
    if (SC_BACKTRACE) {
      sub.btVar = "$3";
      sub.btWarnUndef = false;
    }
    const stmtsText = sub.joinStmts(stmts);
    const withInner = unannotateStr(stmtsText).trim() === "" ? `with ($0) with ($0.prototype) {}` : `with ($0) with ($0.prototype) {
${GEN}{
${elideSemi(stmtsText)}
}}`;
    const tryWrap = `try {
${A(cl)}${withInner}}
${GEN}catch ($lzsc$e) {
${debugCatchBody(file, cl)}}`;
    const bt = SC_BACKTRACE;
    const utp = bt ? "lfc/" + file : file;
    const prof = SC_PROFILE;
    const mGet = 'arguments.callee["displayName"]';
    const funcBlock = bt ? `{
${GEN}${btPrelude("$1", "$2")}
try {
${btPrefix(
      "$1",
      "$2",
      "$3",
      ["$lzsc$c"],
      ["$0"],
      utp,
      cl,
      /*isStatic*/
      false
    )};
${A(cl)}${withInner}}
${GEN}finally {
${btSuffix("$2")}}}` : prof ? `{
${GEN}try {
${meterEvent("$1", "$2", "$3", mGet, "calls")};
${A(cl)}${withInner}}
${GEN}finally {
${meterEvent("$1", "$2", "$3", mGet, "returns")}}}` : SC_LFC_NAMEFUNCS ? `{
${A(cl)}${withInner}}` : `{
${GEN}${tryWrap}}`;
    const innerFn = `function ($0) ${funcBlock}${FB}`;
    const S1 = `var $lzsc$temp = ${innerFn};`;
    const S2 = `${A(cl)}$lzsc$temp["displayName"] = ${jsString(file + "#" + cl + "/1")};`;
    const S2bt = bt ? `
${A(cl)}$lzsc$temp["_dbg_filename"] = ${jsString(utp)};
${A(cl)}$lzsc$temp["_dbg_lineno"] = ${cl};` : "";
    const S3 = `${A(cl)}return $lzsc$temp`;
    const iife = `(function () {
${S1}
${S2}${S2bt}
${S3}
}${FB})()`;
    const init = this.lnum(cl - 1, `${iife}(${n.name})`);
    if (this.lfc)
      return `${make};
${init}`;
    return "{\n" + this.lnum(cl - 1, make) + ";\n" + init + "\n}";
  }
  // Join statements with the oracle's sep rule: sep before each child is ";"
  // when the previous child did not end in ";", else "" (compress mode).
  joinStmts(body) {
    this.joinDepth++;
    try {
      return this.joinStmtsInner(body);
    } finally {
      this.joinDepth--;
    }
  }
  joinStmtsInner(body) {
    let out = "";
    let sep = "";
    const NLsep = this.c ? "" : NL;
    const ruleActive = this.dbg && this.joinDepth === 1;
    let prevWasShiftedSuper = false;
    const firstStmtQuirk = ruleActive && this.dbgNoWrapper;
    const blockLine = this.dbg && this.joinDepth > 1 ? this.pendingBlockLine : -1;
    this.pendingBlockLine = -1;
    let nestedFirstSuperActive = blockLine >= 0;
    let prevEndLine = firstStmtQuirk ? this.dline : nestedFirstSuperActive ? blockLine : -1;
    let prevTriggersQuirk0 = firstStmtQuirk || nestedFirstSuperActive;
    let prevTriggersQuirk = prevTriggersQuirk0;
    let prevSingleLineBlockIf = false;
    for (const s of body) {
      const deltaBefore = this.dbgLineDelta;
      if (this.dbg && this.joinDepth === 1 && s.file !== void 0)
        this.dfile = s.file;
      let text = this.stmt(s);
      if (text === "")
        continue;
      let raw = text;
      let ruleAFired = false;
      let firedNestedAdjSuper = false;
      if (this.dbg) {
        let line = s.line ?? this.dline;
        const as3ClassLine = s.s === "as3class" && s.classLine != null ? s.classLine : null;
        if (as3ClassLine != null)
          line = as3ClassLine - 1;
        const isSuper = s.s === "expr" && isSuperCallExpr(s.e);
        const nestedAdjSuper = this.dbg && this.joinDepth > 1 && !nestedFirstSuperActive && isSuper && prevTriggersQuirk && line === prevEndLine + 1;
        const ruleA = (ruleActive || nestedFirstSuperActive || nestedAdjSuper) && isSuper && prevTriggersQuirk && line === prevEndLine + 1;
        firedNestedAdjSuper = nestedAdjSuper && ruleA;
        const ruleAGap = ruleActive && isSuper && prevTriggersQuirk && line === prevEndLine + 2 && prevSingleLineBlockIf;
        if (ruleA)
          line = prevEndLine;
        else if (ruleAGap)
          line = prevEndLine + 1;
        ruleAFired = ruleA || ruleAGap;
        let iifeQuirk = false;
        const iifeOrigLine = line;
        if (this.dbg && s.s === "expr" && !ruleAFired && raw.startsWith("(function")) {
          iifeQuirk = true;
          line -= 1;
        }
        const deltaNow = this.dbgLineDelta;
        this.dbgLineDelta = deltaBefore;
        if (ruleA && nestedFirstSuperActive && line !== (s.line ?? line)) {
          text = this.lnum(s.line, text, s.file);
          text = this.lnum(line, text, s.file);
        } else if (ruleAFired && !nestedFirstSuperActive && line !== (s.line ?? line)) {
          text = this.lnum(s.line, text, s.file);
          text = this.lnum(line, text, s.file);
          text = this.lnum(s.line, text, s.file);
        } else if (iifeQuirk) {
          text = this.lnum(line, text, s.file);
          text = this.lnum(iifeOrigLine, text, s.file);
        } else if (as3ClassLine != null) {
          text = this.lnum(as3ClassLine - 1, text, s.file);
          text = this.lnum(as3ClassLine, text, s.file);
          text = this.lnum(as3ClassLine - 1, text, s.file);
        } else if (s.afterDir === true && !ruleAFired && !iifeQuirk) {
          text = this.lnum(line - 1, text, s.file);
          text = this.lnum(line, text, s.file);
          text = this.lnum(line - 1, text, s.file);
        } else {
          text = this.lnum(line, text, s.file);
        }
        this.dbgLineDelta = deltaNow;
        if (s.scriptVarRewrite)
          text = annoFileLine(null, 0) + text;
        raw = unannotateStr(text);
      }
      out += sep + text;
      sep = raw.endsWith(";") ? NLsep : ";" + NLsep;
      const sStart = s.line;
      const sEnd = s.endLine;
      prevEndLine = sEnd ?? sStart ?? prevEndLine;
      prevWasShiftedSuper = ruleAFired;
      const firedNestedFirstSuper = ruleAFired && nestedFirstSuperActive;
      if (ruleAFired && !firedNestedFirstSuper && !firedNestedAdjSuper && this.joinDepth !== 1)
        this.dbgLineDelta -= 1;
      prevTriggersQuirk = s.superQuirkPredecessor === true;
      prevSingleLineBlockIf = s.singleLineBlockIf === true;
      nestedFirstSuperActive = false;
      if (s.s === "as3class" && s.semi && !this.lfc) {
        out += sep + ";";
        sep = "";
      }
    }
    return out;
  }
  // visitCaseClause body: the DIRECT concatenation of statement strings (no
  // separator), each statement lnum-prefixed with its own source line. Unlike a
  // block's StatementList (joinStmts), a case clause does NOT insert a NEWLINE
  // between statements — the inter-statement layout comes purely from each stmt's
  // lnum once the translation-unit machinery runs. The super-call JJTree quirk
  // (joinStmts) never applies here (case bodies are nested, never joinDepth 1).
  joinCaseBody(body) {
    let out = "";
    for (const s of body) {
      if (s.s === "empty" && s.dead) {
        if (this.dbg)
          out += annoFileLine(null, 0);
        continue;
      }
      let text = this.stmt(s);
      if (text === "")
        continue;
      if (this.dbg)
        text = this.lnum(s.line ?? this.dline, text, s.file);
      out += text;
    }
    return out;
  }
  // makeBlock: elide trailing ";" TWICE, wrap {\n…(\n)}. The oracle
  // (ParseTreePrinter.makeBlock:161-166) calls elideSemi on the body and then
  // elideSemi AGAIN inside the return — so a body ending in `;;` (e.g. a switch
  // whose last clause's SEMI-terminated `break;` is followed by the clause-level
  // OPTIONAL_SEMI in a debug build → `break;;`) loses BOTH semis → bare `break`.
  // The trailing-NEWLINE `}`-check uses the SINGLE-elided body (matching `body` at
  // line 166). For ordinary blocks (one trailing `;`) the second elide is a no-op.
  makeBlock(body) {
    const b = elideSemi(body);
    return "{" + NL + elideSemi(b) + (unannotateStr(b).endsWith("}") ? "" : NL) + "}";
  }
  // The `#pragma "throwsError=true"` error wrapper (JavascriptGenerator THROWS_ERROR,
  // L1280-1311): wrap the (already-rendered) body text in `try{…}catch($lzsc$e){ if
  // ($lzsc$e is Error){lz.$lzsc$thrownError=$lzsc$e}; throw $lzsc$e }`. Record-and-
  // rethrow only (no $reportException — that arm is debug-only). The catch body's
  // `is Error` is the literal $lzsc$isa ternary (compress). Matches the app path's
  // baked DEPS_INNER wrapper byte-for-byte; production (compress) only.
  throwsWrap(inner) {
    const catchBody = 'if(Error["$lzsc$isa"]?Error.$lzsc$isa($lzsc$e):$lzsc$e instanceof Error){' + NL + "lz.$lzsc$thrownError=$lzsc$e" + NL + "};throw $lzsc$e";
    return "try" + this.makeBlock(inner) + NL + "catch($lzsc$e)" + this.makeBlock(catchBody);
  }
  // Force a block (used for an if-then that has an else, to avoid dangling-else).
  forceBlock(st) {
    return st.s === "block" ? this.makeBlock(this.joinStmts(st.body)) : this.makeBlock(this.joinStmts([st]));
  }
  // ensureBlock: print the body (a block statement-list prints empty→"" else
  // via makeBlock; any other statement prints as itself, no braces), then an
  // EMPTY result becomes `{}` — matching ParseTreePrinter.ensureBlock (an empty
  // statement-list prints as "" at ParseTreePrinter:304, so `if(c){}`→`{}`).
  bodyOf(st) {
    let printed;
    if (st.s === "block") {
      const joined = this.joinStmts(st.body);
      printed = elideSemi(joined) === "" ? "" : this.makeBlock(joined);
    } else {
      printed = this.stmt(st);
    }
    return printed === "" ? "{}" : printed;
  }
  // bodyOf, threading the enclosing control statement's source line so the block
  // body's FIRST super-call tracks at the block's open-`{` line (nested-first-super
  // JJTree quirk). `enclLine` is the control statement's own line.
  bodyOfAt(st, enclLine) {
    this.pendingBlockLine = enclLine ?? -1;
    const out = this.bodyOf(st);
    this.pendingBlockLine = -1;
    return out;
  }
  // LFC-only setAttribute inlining (JavascriptGenerator.visitCallExpression:760-812,
  // gated on FLASH_COMPILER_COMPATABILITY = "compiling the lfc"). A statement-
  // position (`!isReferenced`) `scope.setAttribute(prop, value)` with a DOT-method
  // reference and 2 args expands to an inlined setter-dispatch block. The oracle
  // calls UUID() FIVE times UNCONDITIONALLY (thisvar/propvar/valvar/svar/evtvar) then
  // overwrites the ones whose arg is simple — so every inline advances the gensym
  // counter by exactly 5, even when no gensym appears in the output. The fragment is
  // built as source and re-parsed/printed so the `is` operator, paren-elision and
  // spacing normalize through the same machinery as the oracle's parseFragment.
  // Returns the rendered block (an ASTStatementList → makeBlock, no trailing `;`),
  // or null if `e` is not an inlinable setAttribute. App path inert (lfc=false).
  tryInlineSetAttribute(e) {
    if (!this.lfc)
      return null;
    if (e.k !== "call" || e.args.length !== 2)
      return null;
    const fn = e.c;
    if (fn.k !== "member" || fn.p !== "setAttribute")
      return null;
    const scope = fn.o, property = e.args[0], value = e.args[1];
    let thisvar = this.nextGensym();
    let propvar = this.nextGensym();
    let valvar = this.nextGensym();
    let svar = this.nextGensym();
    const evtvar = this.nextGensym();
    let decls = "";
    const propIsLiteral = property.k === "str";
    const savedBtVar = this.btVar;
    this.btVar = null;
    if (scope.k === "id" || scope.k === "this")
      thisvar = this.expr(scope);
    else
      decls += `var ${thisvar} = ${this.expr(scope)};`;
    if (propIsLiteral || property.k === "id") {
      propvar = this.expr(property);
      if (propIsLiteral)
        svar = propvar.charAt(0) + "$lzc$set_" + propvar.slice(1);
    } else
      decls += `var ${propvar} = ${this.expr(property)};`;
    if (value.k === "str" || value.k === "num" || value.k === "lit" || value.k === "id")
      valvar = this.expr(value);
    else
      decls += `var ${valvar} = ${this.expr(value)};`;
    this.btVar = savedBtVar;
    const onProp = propIsLiteral ? propvar.charAt(0) + "on" + propvar.slice(1) : `"on" + ${propvar}`;
    const fragment = `if (! (${thisvar}.__LZdeleted )) {` + (propIsLiteral ? "" : `var ${svar} = "$lzc$set_" + ${propvar};`) + `if (${thisvar}[${svar}] is Function) {  ${thisvar}[${svar}](${valvar});} else {  ${thisvar}[ ${propvar} ] = ${valvar};    var ${evtvar} = ${thisvar}[${onProp}];  if (${evtvar} is LzEvent) {    if (${evtvar}.ready) {${evtvar}.sendEvent( ${valvar} ); }  }}}`;
    const stmts = foldStmts(new Parser(lex(decls + fragment)).parseProgram());
    const sub = new _Printer(this.rename, this.c);
    sub.lfc = this.lfc;
    sub.gensym = this.gensym;
    if (this.dbg) {
      sub.dbg = true;
      sub.dfile = "";
      const blk = annoFileLine(null, 0) + sub.makeBlock(sub.joinStmts(stmts));
      this.btSuperSeen = false;
      return blk;
    }
    return sub.makeBlock(sub.joinStmts(stmts));
  }
  // A statement carries its own terminator: ";" for simple statements; control
  // statements end in "}" with no ";".
  stmt(st) {
    switch (st.s) {
      // An unexpanded `#include` reaching codegen is a bug (compileLibraryProgram
      // expands them all); refuse loudly rather than emit garbage.
      case "include":
        throw new ScUnsupported(`unexpanded #include "${st.path}" reached codegen`);
      case "expr": {
        const inlined = this.tryInlineSetAttribute(st.e);
        if (inlined != null)
          return inlined;
        return this.expr(st.e) + ";";
      }
      case "empty":
        return "";
      case "var":
        return "var " + st.decls.map((d) => this.id(d.name) + (d.init ? this.SP + "=" + this.SP + this.wrap(d.init, 1) : "")).join(this.COMMA) + ";";
      case "return": {
        if (!st.e)
          return "return;";
        const child = this.expr(st.e);
        const hasParen = child.startsWith("(");
        let phrase = (hasParen ? this.SP : " ") + child;
        if (!hasParen && child.includes("\n"))
          phrase = "(" + phrase + ")";
        return "return" + phrase + ";";
      }
      case "block":
        return this.makeBlock(this.joinStmts(st.body));
      case "if": {
        const cond = "if" + this.OPENP + this.expr(st.c) + this.CLOSEP;
        if (!st.e)
          return cond + this.bodyOfAt(st.t, st.line);
        this.pendingBlockLine = st.line ?? -1;
        const thenText = st.t.s === "block" ? this.makeBlock(this.joinStmts(st.t.body)) : this.makeBlock(this.joinStmts([st.t]));
        this.pendingBlockLine = -1;
        const elseB = st.e.s === "block" ? this.SP + this.bodyOfAt(st.e, st.elseLine) : " " + this.stmt(st.e);
        return cond + thenText + this.SP + "else" + elseB;
      }
      case "while":
        return "while" + this.OPENP + this.expr(st.c) + this.CLOSEP + this.bodyOfAt(st.body, st.line);
      case "dowhile":
        return "do" + this.SP + this.bodyOfAt(st.body, st.line) + this.SP + "while" + this.OPENP + this.expr(st.c) + ")";
      case "with":
        return "with" + this.OPENP + this.expr(st.c) + this.CLOSEP + this.bodyOfAt(st.body, st.line);
      case "funcdecl": {
        if (this.dbg)
          return renderDebugFuncDecl(st.name, st.fn, this.dfile ?? "", st.fn.line ?? this.dline ?? 0);
        const fscope = analyzeScope(st.fn.params, st.fn.body, false);
        const fsub = new _Printer(fscope.map, this.c);
        fsub.lfc = this.lfc;
        fsub.gensym = this.gensym;
        const fcases = st.fn.params.map((_, i) => st.fn.defaults[i] != null ? `case ${i}:
${fscope.newParams[i]}=${fsub.expr(st.fn.defaults[i])};` : null).filter((c) => c != null);
        const fprologue = fcases.length > 0 ? `switch(arguments.length){
${fcases.join("\n")}

};` : "";
        const ftext = fprologue + fsub.joinStmts(st.fn.body);
        const fblock = ftext === "" ? "{}" : fsub.makeBlock(ftext);
        return `function ${this.id(st.name)}(${fscope.newParams.join(",")})${fblock}`;
      }
      case "for": {
        const init = st.init == null ? "" : "s" in st.init ? this.forInit(st.init) : this.expr(st.init);
        return "for" + this.OPENP + init + ";" + (st.test ? this.expr(st.test) : "") + ";" + (st.upd ? this.expr(st.upd) : "") + this.CLOSEP + this.bodyOfAt(st.body, st.line);
      }
      case "forin": {
        const head = st.varName ? "var " + this.id(st.varName) : this.expr(st.lhs);
        return "for" + this.OPENP + head + " in " + this.expr(st.obj) + this.CLOSEP + this.bodyOfAt(st.body, st.line);
      }
      case "switch": {
        let body = "";
        for (const cl of st.cases) {
          let label;
          if (cl.test) {
            const t = this.expr(cl.test);
            const plain = unannotateStr(t);
            label = "case" + (plain.startsWith("(") ? "" : " ") + t + ":";
          } else
            label = "default:";
          const stmts = this.joinCaseBody(cl.body);
          const optSemi = this.c ? NL : ";";
          let clause = label + NL + (cl.body.length > 0 ? stmts + optSemi : "");
          if (this.dbg)
            clause = this.lnum(cl.line ?? null, clause, cl.file);
          body += clause;
        }
        return "switch" + this.OPENP + this.expr(st.disc) + this.CLOSEP + this.makeBlock(body);
      }
      case "break":
        return "break;";
      case "continue":
        return "continue;";
      case "throw": {
        const child = this.expr(st.e);
        return "throw" + (child.startsWith("(") ? "" : " ") + child + ";";
      }
      case "try": {
        let out = "try" + this.SP + this.bodyOfAt(st.block, st.line);
        if (st.handler) {
          let cat = "catch" + this.OPENP + this.id(st.param) + this.CLOSEP + this.bodyOfAt(st.handler, st.handlerLine);
          if (this.dbg && st.handlerLine !== void 0)
            cat = this.lnum(st.handlerLine, cat, st.file);
          out += NL + cat;
        }
        if (st.finalizer) {
          let fin = "finally" + this.SP + this.bodyOfAt(st.finalizer, st.finalizerLine);
          if (this.dbg && st.finalizerLine !== void 0)
            fin = this.lnum(st.finalizerLine, fin, st.file);
          out += NL + fin;
        }
        return out;
      }
      case "as3class":
        return this.dbg ? this.printAs3ClassDebug(st) : this.printAs3Class(st);
    }
  }
  forInit(st) {
    if (st.s === "var")
      return "var " + st.decls.map((d) => this.id(d.name) + (d.init ? this.SP + "=" + this.SP + this.expr(d.init) : "")).join(this.COMMA);
    throw new ScUnsupported("for-init");
  }
};
function unannotateStr(s) {
  if (s.indexOf(ANNOTATE_MARKER) < 0)
    return s;
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === ANNOTATE_MARKER) {
      const end = s.indexOf(ANNOTATE_MARKER, i + 1);
      i = end < 0 ? s.length : end + 1;
    } else {
      out += s[i];
      i++;
    }
  }
  return out;
}
function elideSemi(s) {
  if (!unannotateStr(s).endsWith(";"))
    return s;
  const semipos = s.lastIndexOf(";");
  return s.slice(0, semipos) + s.slice(semipos + 1);
}
function printNumber(raw) {
  if (/^0[xX]/.test(raw))
    return String(parseInt(raw, 16));
  const v = Number(raw);
  return String(v);
}
var PURE_FUNCTIONS = /* @__PURE__ */ new Set([
  "Math.abs",
  "Math.acos",
  "Math.asin",
  "Math.atan",
  "Math.atan2",
  "Math.ceil",
  "Math.cos",
  "Math.exp",
  "Math.floor",
  "Math.log",
  "Math.max",
  "Math.min",
  "Math.pow",
  "Math.random",
  "Math.round",
  "Math.sin",
  "Math.sqrt",
  "Math.tan"
]);
function collectDependencies(expr) {
  const ast = foldNode(new Parser(lex(expr)).parseExpr());
  const printer = new Printer(/* @__PURE__ */ new Map());
  const refSeen = /* @__PURE__ */ new Set();
  const pairs = [];
  const baseSeen = /* @__PURE__ */ new Set();
  const bases = [];
  const fnSeen = /* @__PURE__ */ new Set();
  const fnNodes = [];
  const addRef = (base, prop) => {
    const baseText = printer.expr(base);
    const text = baseText + "." + prop;
    if (!baseSeen.has(baseText)) {
      baseSeen.add(baseText);
      bases.push(jsString(baseText));
    }
    if (refSeen.has(text))
      return;
    refSeen.add(text);
    pairs.push(baseText + "," + jsString(prop));
  };
  const isSetAttributeOnThis = (c) => c.k === "member" && c.o.k === "this" && c.p === "setAttribute";
  const addFn = (n) => {
    const text = printer.expr(n);
    if (fnSeen.has(text))
      return;
    fnSeen.add(text);
    fnNodes.push(n);
  };
  const walk = (n) => {
    switch (n.k) {
      case "id":
        addRef({ k: "this" }, n.name);
        break;
      case "member":
        if (n.o.k === "call" && !isSetAttributeOnThis(n.o.c))
          addFn(n.o);
        addRef(n.o, n.p);
        break;
      case "call":
        if (!isSetAttributeOnThis(n.c))
          addFn(n);
        n.args.forEach(walk);
        break;
      case "this":
      case "num":
      case "str":
      case "lit":
      case "super":
        break;
      case "bin":
      case "logic":
      case "assign":
        walk(n.l);
        walk(n.r);
        break;
      case "unary":
        walk(n.e);
        break;
      case "cond":
        walk(n.c);
        walk(n.t);
        walk(n.f);
        break;
      case "paren":
        walk(n.e);
        break;
      case "cast":
        walk(n.e);
        walk(n.type);
        break;
      case "seq":
        n.es.forEach(walk);
        break;
      case "array":
        n.els.forEach(walk);
        break;
      case "object":
        n.props.forEach((p) => walk(p.v));
        break;
      case "index":
        walk(n.o);
        walk(n.i);
        break;
      case "new":
        n.args.forEach(walk);
        break;
    }
  };
  walk(ast);
  let exprStr = "[" + pairs.join(",") + "]";
  for (const call of fnNodes) {
    const callee = call.c;
    if (PURE_FUNCTIONS.has(printer.expr(callee)))
      continue;
    let receiver, method;
    if (callee.k === "member") {
      receiver = callee.o;
      method = callee.p;
    } else if (callee.k === "id") {
      receiver = { k: "this" };
      method = callee.name;
    } else
      throw new ScUnsupported("constraint dependency on a computed call");
    const args = "[" + call.args.map((a) => printer.expr(a)).join(",") + "]";
    const ctnm = SC_DEBUG ? jsString(printer.expr(receiver)) : "null";
    exprStr += `.concat($lzc$getFunctionDependencies(${jsString(method)},this,${printer.expr(receiver)},${args},${ctnm}))`;
  }
  const free = /* @__PURE__ */ new Set();
  freeVarsOfNode(foldNode(new Parser(lex(exprStr)).parseExpr()), /* @__PURE__ */ new Set(), free);
  return { array: exprStr, hasFree: free.size > 0, annotation: "[" + bases.join(",") + "]" };
}
function stripVarToExpr(decls) {
  const es = decls.map((d) => d.init ? { k: "assign", op: "=", l: { k: "id", name: d.name }, r: d.init } : { k: "id", name: d.name });
  return es.length === 1 ? es[0] : { k: "seq", es };
}
function stripScriptVars(s) {
  const out = stripScriptVarsInner(s);
  if (out !== s) {
    for (const k of ["line", "endLine", "file", "superQuirkPredecessor"]) {
      if (s[k] !== void 0 && out[k] === void 0)
        out[k] = s[k];
    }
  }
  return out;
}
function stripScriptVarsInner(s) {
  switch (s.s) {
    case "var":
      return { s: "expr", e: stripVarToExpr(s.decls), scriptVarRewrite: true };
    case "for": {
      let init = s.init;
      if (init && "s" in init && init.s === "var")
        init = stripVarToExpr(init.decls);
      return { s: "for", init, test: s.test, upd: s.upd, body: stripScriptVars(s.body) };
    }
    case "forin":
      return s.varName ? { s: "forin", varName: null, lhs: { k: "id", name: s.varName }, obj: s.obj, body: stripScriptVars(s.body) } : { s: "forin", varName: null, lhs: s.lhs, obj: s.obj, body: stripScriptVars(s.body) };
    case "block":
      return { ...s, body: s.body.map(stripScriptVars) };
    case "if":
      return { s: "if", c: s.c, t: stripScriptVars(s.t), e: s.e ? stripScriptVars(s.e) : null };
    case "while":
      return { s: "while", c: s.c, body: stripScriptVars(s.body) };
    case "dowhile":
      return { s: "dowhile", c: s.c, body: stripScriptVars(s.body) };
    case "with":
      return { s: "with", c: s.c, body: stripScriptVars(s.body) };
    case "switch":
      return { s: "switch", disc: s.disc, cases: s.cases.map((cl) => ({ test: cl.test, body: cl.body.map(stripScriptVars) })) };
    case "try":
      return { s: "try", param: s.param, block: stripScriptVars(s.block), handler: s.handler ? stripScriptVars(s.handler) : null, handlerLine: s.handlerLine, finalizer: s.finalizer ? stripScriptVars(s.finalizer) : null, finalizerLine: s.finalizerLine };
    default:
      return s;
  }
}
function compileScriptBody(source) {
  const ast = foldStmts(new Parser(lex(source)).parseProgram());
  const printer = new Printer(/* @__PURE__ */ new Map());
  const hoistNames = collectVariables(ast);
  const funcAssigns = [];
  const rest = [];
  for (const s of ast) {
    if (s.s === "funcdecl")
      funcAssigns.push(`${s.name}=${printer.printFunc(s.fn)};`);
    else
      rest.push(stripScriptVars(s));
  }
  if (hasNestedFuncDecl(rest))
    throw new ScUnsupported("nested function declaration in script context");
  const hoist = hoistNames.map((n) => `${n}=void 0;`).join("");
  const text = hoist + funcAssigns.join("") + printer.joinStmts(rest);
  return `function()${text === "" ? "{}" : printer.makeBlock(text)}`;
}
function compileScriptBodyDebug(source, file, elementLine, displayCol) {
  const ast = foldStmts(new Parser(lex(source, elementLine, file)).parseProgram());
  const hoistNames = collectVariables(ast);
  const funcdecls = ast.filter((s) => s.s === "funcdecl");
  const rest = ast.filter((s) => s.s !== "funcdecl").map(stripScriptVars);
  if (hasNestedFuncDecl(rest))
    throw new ScUnsupported("nested function declaration in script context");
  const printer = new Printer(
    /* @__PURE__ */ new Map(),
    /*compress*/
    false
  );
  printer.dbg = true;
  printer.dfile = file;
  printer.dline = elementLine;
  const bt = SC_BACKTRACE;
  if (bt) {
    printer.btVar = "$lzsc$a";
    printer.dbgFree = computeFree([], ast);
  }
  const prof = SC_PROFILE;
  const profGet = 'arguments.callee["displayName"]';
  const profPrefix = prof ? meterEvent(PROFILE_VARS[0], PROFILE_VARS[1], PROFILE_VARS[2], profGet, "calls") : "";
  for (const v of hoistNames)
    printer.dbgOuterVars.add(v);
  const A = (n) => annoFileLine(file, n);
  const Agen = annoFileLine(null, 0);
  const FB = forceBlankLnum();
  const hoist = hoistNames.length ? hoistNames.map((n) => Agen + n + " = void 0;").join("\n") : "";
  const funcAssigns = funcdecls.length ? funcdecls.map((d) => {
    const fl = d.fn.line;
    const lead2 = fl != null ? A(fl - 1) : Agen;
    return lead2 + printer.id(d.name) + " = " + printer.printFunc(d.fn) + ";";
  }).join("\n") : "";
  const bodyStmts = printer.joinStmts(rest);
  const btFramePrefix = bt ? btPrefix("$lzsc$d", "$lzsc$s", "$lzsc$a", [], [], file, elementLine, false) : "";
  const lead = [btFramePrefix, hoist, profPrefix, funcAssigns].filter((s) => s !== "");
  const joinSep = (acc, item) => acc + (unannotateStr(acc).replace(/\s+$/, "").endsWith(";") ? "\n" : ";\n") + item;
  const leadJoined = lead.length ? lead.reduce(joinSep) : "";
  const leadSep = unannotateStr(leadJoined).replace(/\s+$/, "").endsWith(";") ? "\n" : ";\n";
  const bodyInner = lead.length ? leadJoined + (bodyStmts ? leadSep + bodyStmts : "") : bodyStmts;
  const blockNL = (b) => unannotateStr(b).endsWith("}") ? "" : NL;
  const elided = elideSemi(bodyInner);
  const freeReal = computeFree([], ast);
  const needTry = bt || prof || computeDereferenced(ast) || freeReal.size > 0;
  let funcBlock;
  if (needTry) {
    const profSuffix = prof ? meterEvent(PROFILE_VARS[0], PROFILE_VARS[1], PROFILE_VARS[2], profGet, "returns") : "";
    const catchBody = bt ? debugCatchBodyBacktrace(file, "$lzsc$a") : debugCatchBody(file, elementLine);
    const finallyClause = bt ? "\n" + Agen + "finally {\n" + btSuffix("$lzsc$s") + blockNL(btSuffix("$lzsc$s")) + "}" : prof ? "\n" + Agen + "finally {\n" + profSuffix + blockNL(profSuffix) + "}" : "";
    const catchPart = prof ? "" : "\n" + Agen + "catch ($lzsc$e) {\n" + catchBody + blockNL(catchBody) + "}";
    const tryWrap = "try {\n" + elided + blockNL(elided) + "}" + catchPart + finallyClause;
    const preludeStr = bt ? btPrelude("$lzsc$d", "$lzsc$s") + "\n" : "";
    funcBlock = "{\n" + Agen + preludeStr + tryWrap + "}";
  } else {
    funcBlock = elided === "" ? "{}" : "{\n" + elided + blockNL(elided) + "}";
  }
  const innerFn = A(elementLine) + "function () " + funcBlock + FB;
  const userName = file + "#" + elementLine + "/" + displayCol;
  const S1 = A(elementLine) + "var $lzsc$temp = " + innerFn + ";";
  const S2 = A(elementLine) + '$lzsc$temp["displayName"] = ' + jsString(userName) + ";";
  const S2bt = bt ? NL + A(elementLine) + '$lzsc$temp["_dbg_filename"] = ' + jsString(file) + ";" + NL + A(elementLine) + '$lzsc$temp["_dbg_lineno"] = ' + elementLine + ";" : "";
  const S3 = A(elementLine) + "return $lzsc$temp;";
  const inner = S1 + NL + S2 + S2bt + NL + elideSemi(S3);
  return "(function () {" + NL + inner + NL + "}" + FB + ")()";
}
function finalSourceLine(src, baseLine = 1, baseFile) {
  const toks = lex(src, baseLine, baseFile);
  return toks[toks.length - 1].line;
}
function compileProgram(source) {
  const ast = foldStmts(new Parser(lex(source)).parseProgram());
  return new Printer(/* @__PURE__ */ new Map()).joinStmts(ast);
}
function compileProgramDebug(source, filename, baseLine) {
  const ast = foldStmts(new Parser(lex(source, baseLine, filename)).parseProgram());
  const printer = new Printer(
    /* @__PURE__ */ new Map(),
    /*compress*/
    false
  );
  printer.dbg = true;
  printer.dfile = filename;
  for (const v of collectVariables(ast))
    printer.dbgOuterVars.add(v);
  const units = [];
  for (const s of ast) {
    const text = printer.stmt(s);
    if (text === "")
      continue;
    const trailEmpty = s.s === "as3class" && s.semi;
    if (text.startsWith("{")) {
      units.push(text);
      if (trailEmpty)
        units.push(";");
      continue;
    }
    const dirLine = s.s === "as3class" && s.classLine != null ? s.classLine - 1 : s.line ?? 0;
    const sfile = s.file;
    const fileOv = sfile !== void 0 && sfile !== printer.dfile ? sfile : void 0;
    units.push(printer.lnum(dirLine, text, fileOv));
    if (trailEmpty)
      units.push(";");
  }
  return units;
}
function compileStylesheetDebug(iifeSource, filename, elementLine, displayCol) {
  const padded = " ".repeat(Math.max(0, displayCol - 3)) + iifeSource;
  const ast = foldStmts(new Parser(lex(padded, elementLine, filename)).parseProgram());
  const printer = new Printer(
    /* @__PURE__ */ new Map(),
    /*compress*/
    false
  );
  printer.dbg = true;
  printer.dfile = filename;
  const iife = ast.find((s) => s.s === "expr");
  if (!iife)
    throw new ScUnsupported("stylesheet: no IIFE expression");
  const text = printer.stmt(iife);
  return [";", printer.lnum(elementLine - 1, text)];
}
function compileExpr(src) {
  const ast = foldNode(new Parser(lex(src)).parseExpr());
  return new Printer(/* @__PURE__ */ new Map()).expr(ast);
}
function compileExprDebug(src) {
  const ast = foldNode(new Parser(lex(src)).parseExpr());
  const p = new Printer(
    /* @__PURE__ */ new Map(),
    /*compress*/
    false
  );
  p.dbg = true;
  return p.expr(ast);
}
function compileFunction(params, source, defaults = [], isMethod = true) {
  const restIdx = params.findIndex((p) => p.startsWith("..."));
  if (restIdx >= 0) {
    const restName = params[restIdx].slice(3).trim();
    params = params.slice(0, restIdx);
    defaults = defaults.slice(0, restIdx);
    source = `var ${restName} = Array.prototype.slice.call(arguments, ${restIdx});
${source}`;
  }
  const ast = foldStmts(new Parser(lex(source)).parseProgram());
  const scope = analyzeScope(params, ast, isMethod);
  const printer = new Printer(scope.map);
  const funcdecls = ast.filter((s) => s.s === "funcdecl");
  const rest = ast.filter((s) => s.s !== "funcdecl");
  if (funcdecls.length && hasNestedFuncDecl(rest))
    throw new ScUnsupported("nested function declaration");
  const hoist = funcdecls.length ? funcdecls.map((d) => `var ${printer.id(d.name)};`).join("") + funcdecls.map((d) => `${printer.id(d.name)}=${printer.printFunc(d.fn)};`).join("") : "";
  const cases = params.map((_, i) => {
    if (defaults[i] === void 0)
      return null;
    const lhs = scope.closedRedecls.some((r) => r.name === params[i]) ? params[i] : scope.newParams[i];
    return `case ${i}:
${lhs}=${compileExpr(defaults[i])};`;
  }).filter((c) => c != null);
  const prologue = cases.length > 0 ? `switch(arguments.length){
${cases.join("\n")}

};` : "";
  const bodyText = hoist + printer.joinStmts(rest);
  let block;
  if (scope.withThis) {
    const redecls = scope.closedRedecls.map(({ name, reg }) => `var ${name}=${reg};`).join("");
    block = printer.makeBlock("with(this)" + printer.makeBlock(redecls + prologue + bodyText));
  } else {
    const combined = prologue + bodyText;
    block = combined === "" ? "{}" : printer.makeBlock(combined);
  }
  return `function(${scope.newParams.join(",")})${block}`;
}
function debugCatchBody(filename, line) {
  return 'if ((Error["$lzsc$isa"] ? Error.$lzsc$isa($lzsc$e) : $lzsc$e instanceof Error) && $lzsc$e !== lz["$lzsc$thrownError"]) {\n$reportException(' + jsString(filename) + ", " + line + ", $lzsc$e)\n} else {\nthrow $lzsc$e\n}";
}
function btPrelude(dvar, svar) {
  return "var " + dvar + " = Debug;\nvar " + svar + " = " + dvar + ".backtraceStack;";
}
function btPrefix(dvar, svar, avar, params, newParams, fn, line, isStatic) {
  const elems = [];
  for (let i = 0; i < params.length; i++) {
    elems.push(jsString(params[i]));
    elems.push(newParams[i]);
  }
  const arr = "[" + elems.join(", ") + "]";
  return "if (" + svar + ") {\nvar " + avar + " = " + arr + ";\n" + avar + ".callee = arguments.callee;\n" + (isStatic ? "" : avar + '["this"] = this;\n') + avar + ".filename = " + jsString(fn) + ";\n" + avar + ".lineno = " + line + ";\n" + svar + ".push(" + avar + ");\nif (" + svar + ".length > " + svar + ".maxDepth) {\n" + dvar + ".stackOverflow()\n}}";
}
function btSuffix(svar) {
  return "if (" + svar + ") {\n" + svar + ".length--\n}";
}
function debugCatchBodyBacktrace(filename, avar) {
  return 'if ((Error["$lzsc$isa"] ? Error.$lzsc$isa($lzsc$e) : $lzsc$e instanceof Error) && $lzsc$e !== lz["$lzsc$thrownError"]) {\n$reportException(' + jsString(filename) + ", " + avar + ".lineno, $lzsc$e)\n} else {\nthrow $lzsc$e\n}";
}
function debugCatchBodyThrows() {
  return 'if (Error["$lzsc$isa"] ? Error.$lzsc$isa($lzsc$e) : $lzsc$e instanceof Error) {\nlz.$lzsc$thrownError = $lzsc$e\n};\nthrow $lzsc$e';
}
function compileFunctionDebug(userName, params, source, defaults, file, methodLine, bodyBaseLine, forceWithThis = false, catchKind = "report", isMethod = true, propagateName) {
  const restIdx = params.findIndex((p) => p.startsWith("..."));
  let restPrologueSrc = "";
  if (restIdx >= 0) {
    const restName = params[restIdx].slice(3).trim();
    restPrologueSrc = `var ${restName} = Array.prototype.slice.call(arguments, ${restIdx}); `;
    params = params.slice(0, restIdx);
    defaults = defaults.slice(0, restIdx);
  }
  const hasDefaultSwitch = defaults.some((d) => d !== void 0);
  let restPrologueAst = [];
  let bodySource = restPrologueSrc + source;
  let bodyLexBase = bodyBaseLine;
  if (restIdx >= 0 && hasDefaultSwitch) {
    restPrologueAst = foldStmts(new Parser(lex(restPrologueSrc, methodLine + 3, file)).parseProgram());
    bodySource = source;
    bodyLexBase = bodyBaseLine;
  }
  const ast = restPrologueAst.concat(foldStmts(new Parser(lex(bodySource, bodyLexBase, file)).parseProgram()));
  const scope = analyzeScope(
    params,
    ast,
    isMethod,
    void 0,
    /*debug*/
    true
  );
  const withThis = scope.withThis || forceWithThis && (scope.dereferenced || scope.free.size > 0 || params.length === 0);
  const printer = new Printer(
    scope.map,
    /*compress*/
    false
  );
  printer.dbg = true;
  if (SC_LFC_GENSYM) {
    printer.lfc = true;
    printer.gensym = SC_LFC_GENSYM;
  }
  printer.dbgFree = scope.free;
  printer.dbgLocals = scope.locals;
  printer.btWarnUndef = !SC_LFC_NAMEFUNCS && catchKind !== "throws";
  printer.dfile = file;
  printer.dline = methodLine;
  if (propagateName != null)
    printer.outerUserName = propagateName;
  const bt = SC_BACKTRACE;
  const dvar = bt ? scope.map.get("$lzsc$d") : "";
  const svar = bt ? scope.map.get("$lzsc$s") : "";
  const avar = bt ? scope.map.get("$lzsc$a") : "";
  if (bt)
    printer.btVar = avar;
  const utp = SC_LFC_NAMEFUNCS && bt ? "lfc/" + file : file;
  const prof = SC_PROFILE;
  const mlzp = prof ? scope.map.get("$lzsc$lzp") : "";
  const mnow = prof ? scope.map.get("$lzsc$now") : "";
  const mname = prof ? scope.map.get("$lzsc$name") : "";
  const meterGetName = 'arguments.callee["displayName"]';
  const A = (n) => annoFileLine(file, n);
  const Agen = annoFileLine(null, 0);
  const FB = forceBlankLnum();
  const funcdecls = ast.filter((s) => s.s === "funcdecl");
  const rest = ast.filter((s) => s.s !== "funcdecl");
  if (funcdecls.length && hasNestedFuncDecl(rest))
    throw new ScUnsupported("nested function declaration");
  const cases = params.map((_, i) => {
    if (defaults[i] === void 0)
      return null;
    const lhs = scope.closedRedecls.some((r) => r.name === params[i]) ? params[i] : scope.newParams[i];
    return { i, assign: lhs + " = " + compileExpr(defaults[i]) };
  }).filter((c) => c != null);
  const redecls = withThis ? scope.closedRedecls.map(({ name, reg }) => Agen + "var " + name + " = " + reg + ";").join("\n") : "";
  const hoistDecls = funcdecls.length ? funcdecls.map((d) => Agen + "var " + printer.id(d.name) + ";").join("\n") : "";
  const hoistAssigns = funcdecls.length ? funcdecls.map((d) => A(methodLine) + printer.id(d.name) + " = " + renderDebugFuncNode(
    d.fn,
    d.name,
    /*named*/
    true,
    file,
    d.line ?? methodLine
  ) + ";").join("\n") : "";
  const hoist = hoistDecls && hoistAssigns ? hoistDecls + "\n" + hoistAssigns : hoistDecls + hoistAssigns;
  const prologue = cases.length > 0 ? A(methodLine) + "switch (arguments.length) {\n" + cases.map((c, j) => "case " + c.i + ":\n" + (j === 0 ? A(methodLine + 1) : "") + c.assign).join(";;") + "\n}" : "";
  const prefix = bt ? btPrefix(
    dvar,
    svar,
    avar,
    params,
    scope.newParams,
    utp,
    methodLine,
    /*isStatic*/
    false
  ) : prof ? meterEvent(mlzp, mnow, mname, meterGetName, "calls") : "";
  const lead = bt || prof ? [redecls, hoistDecls, prefix, hoistAssigns, prologue].filter((s) => s !== "") : [redecls, hoist, prologue].filter((s) => s !== "");
  const needTry = SC_LFC_NAMEFUNCS || SC_PROFILE ? bt || prof || catchKind === "throws" : bt || scope.dereferenced || scope.free.size > 0 || cases.length > 0;
  printer.dbgNoWrapper = !needTry && lead.length === 0;
  printer.dbgInsideFunc = true;
  const bodyStmts = printer.joinStmts(rest);
  printer.dbgNoWrapper = false;
  const joinSep = (acc, item) => acc + (unannotateStr(acc).replace(/\s+$/, "").endsWith(";") ? "\n" : ";\n") + item;
  const leadJoined = lead.length ? lead.reduce(joinSep) : "";
  const leadSep = unannotateStr(leadJoined).replace(/\s+$/, "").endsWith(";") ? "\n" : ";\n";
  const bodyInner = lead.length ? leadJoined + (bodyStmts ? leadSep + bodyStmts : "") : bodyStmts;
  const blockNL = (b) => unannotateStr(b).endsWith("}") ? "" : NL;
  const elided = elideSemi(bodyInner);
  let funcBlock;
  if (needTry) {
    const profSuffix = prof ? meterEvent(mlzp, mnow, mname, meterGetName, "returns") : "";
    const finallyClause = bt ? "\n" + Agen + "finally {\n" + btSuffix(svar) + blockNL(btSuffix(svar)) + "}" : prof ? "\n" + Agen + "finally {\n" + profSuffix + blockNL(profSuffix) + "}" : "";
    const noCatch = (SC_LFC_NAMEFUNCS || SC_PROFILE) && (bt || prof) && catchKind !== "throws";
    const catchBody = catchKind === "throws" ? debugCatchBodyThrows() : bt ? debugCatchBodyBacktrace(file, avar) : debugCatchBody(file, methodLine);
    const catchPart = noCatch ? "" : "\n" + Agen + "catch ($lzsc$e) {\n" + catchBody + blockNL(catchBody) + "}";
    const tryWrap = "try {\n" + elided + blockNL(elided) + "}" + catchPart + finallyClause;
    const preludeStr = bt ? btPrelude(dvar, svar) + "\n" : "";
    funcBlock = withThis ? "{\n" + Agen + "with (this) {\n" + preludeStr + tryWrap + "}}" : "{\n" + Agen + preludeStr + tryWrap + "}";
  } else {
    funcBlock = elided === "" ? "{}" : "{\n" + elided + blockNL(elided) + "}";
  }
  const innerFn = A(methodLine) + "function" + (SC_PROFILE ? " " : "  ") + "(" + scope.newParams.join(", ") + ") " + funcBlock + FB;
  const S1 = A(methodLine) + "var $lzsc$temp = " + innerFn + ";";
  const S2 = A(methodLine) + '$lzsc$temp["displayName"] = ' + jsString(userName) + ";";
  const S2bt = bt ? NL + A(methodLine) + '$lzsc$temp["_dbg_filename"] = ' + jsString(utp) + ";" + NL + A(methodLine) + '$lzsc$temp["_dbg_lineno"] = ' + methodLine + ";" : "";
  const S3 = A(methodLine) + "return $lzsc$temp;";
  const inner = S1 + NL + S2 + S2bt + NL + elideSemi(S3);
  return "(function () {" + NL + inner + NL + "}" + FB + ")()";
}
function compileBinderDebug(userName, bodySource, file, funcLine) {
  const src = "function ($lzc$node, $lzc$bind=true) {\n" + bodySource + "}";
  const ast = new Parser(lex(src, funcLine, file)).parseProgram();
  const fnStmt = ast[0];
  if (!fnStmt || fnStmt.s !== "expr" || fnStmt.e.k !== "func")
    throw new ScUnsupported("binder: expected a function expression");
  const fn = foldNode(fnStmt.e);
  return renderDebugFuncNode(
    fn,
    userName,
    /*named*/
    false,
    file,
    funcLine
  );
}
function renderDebugFuncDecl(name, fn, file, funcLine) {
  return renderDebugFuncNode(
    fn,
    name,
    /*named*/
    true,
    file,
    funcLine,
    "report",
    false,
    void 0,
    void 0,
    void 0,
    name
  );
}
function renderDebugFuncNode(fn, userName, named, file, funcLine, catchKind = "report", isMethod = false, as3, propagateName, outerVars, asDecl, isStatic = false, insideFunc = false) {
  const params = fn.params;
  const ast = fn.body;
  if (fn.throwsError)
    catchKind = "throws";
  if (fn.userFunctionName !== void 0) {
    userName = fn.userFunctionName;
    propagateName = fn.userFunctionName;
  }
  const noBt = fn.noBacktrace === true;
  const noProf = fn.noProfile === true;
  const scope = analyzeScope(
    params,
    ast,
    isMethod,
    as3,
    /*debug*/
    true,
    noBt,
    noProf
  );
  const printer = new Printer(
    scope.map,
    /*compress*/
    false
  );
  printer.dbg = true;
  if (SC_LFC_GENSYM) {
    printer.lfc = true;
    printer.gensym = SC_LFC_GENSYM;
  }
  printer.dbgFree = scope.free;
  printer.dbgLocals = scope.locals;
  if (outerVars)
    printer.dbgOuterVars = outerVars;
  printer.dfile = file;
  printer.dline = funcLine;
  if (propagateName != null)
    printer.outerUserName = propagateName;
  const bt = SC_BACKTRACE && !noBt;
  const dvar = bt ? scope.map.get("$lzsc$d") : "";
  const svar = bt ? scope.map.get("$lzsc$s") : "";
  const avar = bt ? scope.map.get("$lzsc$a") : "";
  if (bt)
    printer.btVar = avar;
  if (SC_LFC_NAMEFUNCS)
    printer.btWarnUndef = false;
  const utp = SC_LFC_NAMEFUNCS && bt ? "lfc/" + file : file;
  const prof = SC_PROFILE && !noProf;
  const mlzp = prof ? scope.map.get("$lzsc$lzp") : "";
  const mnow = prof ? scope.map.get("$lzsc$now") : "";
  const mname = prof ? scope.map.get("$lzsc$name") : "";
  const meterGetName = asDecl != null ? jsString(asDecl) : 'arguments.callee["displayName"]';
  if (SC_PROFILE && insideFunc && asDecl == null && scope.closed.size > 0)
    userName += " closure";
  const A = (n) => annoFileLine(file, n);
  const Agen = annoFileLine(null, 0);
  const FB = forceBlankLnum();
  const funcdecls = collectFuncDecls(ast);
  const rest = stripFuncDecls(ast);
  const cases = params.map((_, i) => {
    if (fn.defaults[i] == null)
      return null;
    const lhs = scope.closedRedecls.some((r) => r.name === params[i]) ? params[i] : scope.newParams[i];
    return { i, assign: lhs + " = " + printer.expr(fn.defaults[i]) };
  }).filter((c) => c != null);
  const withThis = scope.withThis;
  const redecls = withThis ? scope.closedRedecls.map(({ name, reg }) => Agen + "var " + name + " = " + reg + ";").join("\n") : "";
  const hoistDecls = funcdecls.length ? funcdecls.map((d) => Agen + "var " + printer.id(d.name) + ";").join("\n") : "";
  const hoistAssigns = funcdecls.length ? funcdecls.map((d) => A((d.line ?? funcLine) - 1) + printer.id(d.name) + " = " + renderDebugFuncNode(
    d.fn,
    d.name,
    /*named*/
    true,
    file,
    d.line ?? funcLine,
    "report",
    false,
    void 0,
    void 0,
    void 0,
    void 0,
    false,
    /*insideFunc*/
    true
  ) + ";").join("\n") : "";
  const hoist = hoistDecls && hoistAssigns ? hoistDecls + "\n" + hoistAssigns : hoistDecls + hoistAssigns;
  const prologue = cases.length > 0 ? A(funcLine) + "switch (arguments.length) {\n" + cases.map((c, j) => "case " + c.i + ":\n" + (j === 0 ? A(funcLine + 1) : "") + c.assign).join(";;") + "\n}" : "";
  const prefix = bt ? btPrefix(
    dvar,
    svar,
    avar,
    params,
    scope.newParams,
    utp,
    funcLine,
    /*isStatic*/
    isStatic
  ) : prof ? meterEvent(mlzp, mnow, mname, meterGetName, "calls") : "";
  const lead = (bt || prof ? [redecls, hoistDecls, prefix, hoistAssigns, prologue] : [redecls, prefix, hoist, prologue]).filter((s) => s !== "");
  const needTry = SC_LFC_NAMEFUNCS || SC_PROFILE ? bt || prof || catchKind === "throws" : bt || scope.dereferenced || scope.free.size > 0 || cases.length > 0 || catchKind === "throws";
  printer.dbgNoWrapper = !needTry && lead.length === 0;
  if (bt && funcdecls.length)
    printer.btSuperSeen = true;
  printer.dbgInsideFunc = true;
  const bodyStmts = printer.joinStmts(rest);
  printer.dbgNoWrapper = false;
  const joinSep = (acc, item) => acc + (unannotateStr(acc).replace(/\s+$/, "").endsWith(";") ? "\n" : ";\n") + item;
  const leadJoined = lead.length ? lead.reduce(joinSep) : "";
  const leadSep = unannotateStr(leadJoined).replace(/\s+$/, "").endsWith(";") ? "\n" : ";\n";
  const bodyInner = lead.length ? leadJoined + (bodyStmts ? leadSep + bodyStmts : "") : bodyStmts;
  const blockNL = (b) => unannotateStr(b).endsWith("}") ? "" : NL;
  const elided = elideSemi(bodyInner);
  let funcBlock;
  if (needTry) {
    const profSuffix = prof ? meterEvent(mlzp, mnow, mname, meterGetName, "returns") : "";
    const finallyClause = bt ? "\n" + Agen + "finally {\n" + btSuffix(svar) + blockNL(btSuffix(svar)) + "}" : prof ? "\n" + Agen + "finally {\n" + profSuffix + blockNL(profSuffix) + "}" : "";
    const noCatch = (SC_LFC_NAMEFUNCS || SC_PROFILE) && (bt || prof) && catchKind !== "throws";
    const catchBody = catchKind === "throws" ? debugCatchBodyThrows() : bt ? debugCatchBodyBacktrace(file, avar) : debugCatchBody(file, funcLine);
    const catchPart = noCatch ? "" : "\n" + Agen + "catch ($lzsc$e) {\n" + catchBody + blockNL(catchBody) + "}";
    const tryWrap = "try {\n" + elided + blockNL(elided) + "}" + catchPart + finallyClause;
    const preludeStr = bt ? btPrelude(dvar, svar) + "\n" : "";
    funcBlock = withThis ? "{\n" + Agen + "with (this) {\n" + preludeStr + tryWrap + "}}" : "{\n" + Agen + preludeStr + tryWrap + "}";
  } else {
    funcBlock = elided === "" ? "{}" : "{\n" + elided + blockNL(elided) + "}";
  }
  if (asDecl != null) {
    const decl = A(funcLine) + "function " + asDecl + " (" + scope.newParams.join(", ") + ") " + funcBlock + FB;
    if (bt) {
      return decl + ";" + NL + Agen + asDecl + '["_dbg_filename"] = ' + jsString(utp) + ";" + NL + Agen + asDecl + '["_dbg_lineno"] = ' + funcLine;
    }
    if (prof)
      return decl + ";" + NL + Agen + asDecl + '["displayName"] = ' + jsString(asDecl);
    return decl;
  }
  const innerFn = A(funcLine) + "function" + (named && !SC_PROFILE ? "  " : " ") + "(" + scope.newParams.join(", ") + ") " + funcBlock + FB;
  const S1 = A(funcLine) + "var $lzsc$temp = " + innerFn + ";";
  const S2 = A(funcLine) + '$lzsc$temp["displayName"] = ' + jsString(userName) + ";";
  const S2bt = bt ? NL + A(funcLine) + '$lzsc$temp["_dbg_filename"] = ' + jsString(utp) + ";" + NL + A(funcLine) + '$lzsc$temp["_dbg_lineno"] = ' + funcLine + ";" : "";
  const S3 = A(funcLine) + "return $lzsc$temp;";
  const inner = S1 + NL + S2 + S2bt + NL + elideSemi(S3);
  return "(function () {" + NL + inner + NL + "}" + FB + ")()";
}

// dist/css.js
var CssUnsupported = class extends Error {
};
function buildStylesheetProgram(cssText, debugFile2) {
  const rules = parseRules(cssText);
  if (rules.length === 0)
    return null;
  let script = "";
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    const dbgArgs = debugFile2 != null ? `, ${jsString(debugFile2)}, ${i}` : "";
    script += `$lzc$style._addRule(new $lzc$rule(${r.selector}, ${r.props}${dbgArgs}));
`;
  }
  return ` (function() { var $lzc$style = LzCSSStyle, $lzc$rule = LzCSSStyleRule;
${script}})();`;
}
function parseRules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) {
      if (css.slice(i).trim() !== "")
        throw new CssUnsupported("trailing CSS text");
      break;
    }
    const close = css.indexOf("}", open);
    if (close < 0)
      throw new CssUnsupported("unbalanced braces");
    const selectorList = css.slice(i, open).trim();
    const body = css.slice(open + 1, close);
    const props = buildProperties(body);
    for (const sel of splitTopLevel(selectorList, ","))
      out.push({ selector: buildSelector(sel.trim()), props });
    i = close + 1;
  }
  return out;
}
function splitTopLevel(s, sep) {
  const parts = [];
  let depth = 0, quote = "", cur = "";
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote)
        quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === "[") {
      depth++;
      cur += ch;
    } else if (ch === "]") {
      depth--;
      cur += ch;
    } else if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = "";
    } else
      cur += ch;
  }
  if (cur.trim() !== "" || parts.length === 0)
    parts.push(cur);
  return parts;
}
function buildSelector(sel) {
  const simples = splitSimples(sel);
  if (simples.length === 0)
    throw new CssUnsupported(`empty selector`);
  if (simples.length === 1)
    return buildSimple(simples[0]);
  return "[" + simples.map(buildSimple).join(", ") + "]";
}
function splitSimples(sel) {
  if (/[>+~]/.test(sel.replace(/\[[^\]]*\]/g, "")))
    throw new CssUnsupported(`CSS combinator in selector: ${sel}`);
  const out = [];
  let depth = 0, cur = "";
  for (const ch of sel) {
    if (ch === "[") {
      depth++;
      cur += ch;
    } else if (ch === "]") {
      depth--;
      cur += ch;
    } else if (/\s/.test(ch) && depth === 0) {
      if (cur !== "") {
        out.push(cur);
        cur = "";
      }
    } else
      cur += ch;
  }
  if (cur !== "")
    out.push(cur);
  return out;
}
function buildSimple(sel) {
  const m = /^([a-zA-Z_*][\w-]*)?(.*)$/.exec(sel);
  const element = m[1];
  const rest = m[2];
  if (rest === "") {
    const map = { s: "1" };
    if (element && element !== "*")
      map.t = jsString(element);
    return emitMap(map);
  }
  return buildCondition(rest, element);
}
function buildCondition(cond, element) {
  let m = /^#([\w-]+)$/.exec(cond);
  if (m)
    return emitMap({ i: jsString(m[1]), s: "100" });
  m = /^\.([\w-]+)$/.exec(cond);
  if (m) {
    const map = { a: jsString("styleclass"), v: jsString(m[1]), m: jsString("~=") };
    return finishAttr(map, 10, element);
  }
  m = /^\[\s*([\w-]+)\s*(?:([~|]?=)\s*(.+?)\s*)?\]$/.exec(cond);
  if (m) {
    const attr = m[1], op = m[2], rawVal = m[3];
    const map = { a: jsString(attr) };
    if (rawVal != null)
      map.v = jsString(unquote(rawVal));
    if (op === "~=")
      map.m = jsString("~=");
    else if (op === "|=")
      map.m = jsString("|=");
    else if (op && op !== "=")
      throw new CssUnsupported(`attribute operator ${op}`);
    return finishAttr(map, 10, element);
  }
  throw new CssUnsupported(`CSS selector condition: ${cond}`);
}
function finishAttr(map, spec, element) {
  if (element && element !== "*") {
    map.t = jsString(element);
    spec += 1;
  }
  map.s = String(spec);
  return emitMap(map);
}
function buildProperties(body) {
  const map = {};
  for (const decl of body.split(";")) {
    const d = decl.trim();
    if (d === "")
      continue;
    const idx = d.indexOf(":");
    if (idx < 0)
      throw new CssUnsupported(`CSS declaration: ${d}`);
    const name = d.slice(0, idx).trim();
    const value = d.slice(idx + 1).trim();
    if (!/^-?[a-zA-Z][\w-]*$/.test(name))
      throw new CssUnsupported(`CSS property name: ${name}`);
    map[name] = cssValueToJs(value);
  }
  return emitMap(map);
}
function cssValueToJs(value) {
  if (/!\s*important\s*$/i.test(value))
    throw new CssUnsupported(`!important`);
  if (/^"[^"]*"$/.test(value) || /^'[^']*'$/.test(value))
    return value;
  let m = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (m)
    return "0x" + m[1];
  m = /^#([0-9a-fA-F]{3})$/.exec(value);
  if (m) {
    const h = m[1];
    return "0x" + h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  m = /^rgb\(\s*([^)]*)\)$/i.exec(value);
  if (m)
    return rgbToHex(m[1]);
  if (/^-?\d+$/.test(value))
    return value;
  if (/^-?\d*\.\d+$/.test(value))
    return value;
  if (/^[a-zA-Z_][\w-]*$/.test(value))
    return `new LzStyleIdent('${value}')`;
  throw new CssUnsupported(`CSS value: ${value}`);
}
function rgbToHex(args) {
  const parts = args.split(",").map((s) => s.trim());
  if (parts.length !== 3)
    throw new CssUnsupported(`rgb() args: ${args}`);
  let hex = "0x";
  for (const p of parts) {
    let n;
    const pm = /^(\d+)%$/.exec(p);
    if (pm)
      n = Math.round(Math.min(parseInt(pm[1], 10) * 255 / 100, 255));
    else if (/^\d+$/.test(p))
      n = parseInt(p, 10);
    else
      throw new CssUnsupported(`rgb() component: ${p}`);
    hex += (n < 16 ? "0" : "") + n.toString(16).toUpperCase();
  }
  return hex;
}
function unquote(s) {
  if (s.startsWith('"') && s.endsWith('"') || s.startsWith("'") && s.endsWith("'"))
    return s.slice(1, -1);
  return s;
}
function emitMap(map) {
  const keys = Object.keys(map).sort();
  const parts = keys.map((k) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : jsString(k)}: ${map[k]}`);
  return "{" + parts.join(", ") + "}";
}

// dist/compile.js
var BUILD_CONSTANTS = {
  lpsbuild: "branches/4.9@17752 (17752)",
  lpsbuilddate: "2010-10-22T15:20:34Z",
  lpsrelease: "Production",
  lpsversion: "4.9.0",
  runtime: "dhtml"
};
var NORMALIZED_APPBUILDDATE = "1970-01-01T00:00:00Z";
function canvasDefaults(proxied) {
  return {
    // SOLO build flips this one byte: proxied===false → "false" (oracle SOLO).
    __LZproxied: { kind: "string", v: proxied === false ? "false" : "true" },
    bgcolor: { kind: "number", v: 16777215 },
    embedfonts: { kind: "boolean", v: true },
    font: { kind: "string", v: "Verdana,Vera,sans-serif" },
    fontsize: { kind: "number", v: 11 },
    fontstyle: { kind: "string", v: "plain" },
    height: { kind: "string", v: "100%" },
    width: { kind: "string", v: "100%" }
  };
}
var LFC_TAG_CLASS = {
  node: "LzNode",
  view: "LzView",
  text: "LzText",
  inputtext: "LzInputText",
  canvas: "LzCanvas",
  script: "LzScript",
  animatorgroup: "LzAnimatorGroup",
  animator: "LzAnimator",
  layout: "LzLayout",
  state: "LzState",
  datapointer: "LzDatapointer",
  dataprovider: "LzDataProvider",
  datapath: "LzDatapath",
  dataset: "LzDataset",
  datasource: "LzDatasource",
  lzhttpdataprovider: "LzHTTPDataProvider",
  import: "LzLibrary",
  contextmenu: "LzContextMenu",
  contextmenuitem: "LzContextMenuItem"
};
function classJsName(tag) {
  return LFC_TAG_CLASS[tag] ?? `$lzc$class_${tag}`;
}
var Unsupported = class extends Error {
};
var SymbolGenerator = class {
  constructor(prefix) {
    this.prefix = prefix;
    this.idx = 0;
  }
  next() {
    return this.prefix + (++this.idx).toString(36);
  }
};
var MOUSE_EVENTS = /* @__PURE__ */ new Set([
  "onclick",
  "ondblclick",
  "onmousedown",
  "onmouseup",
  "onmouseover",
  "onmousemove",
  "onmouseout"
]);
function isEventAttr(name) {
  return /^on[a-z]/.test(name);
}
var PROPERTY_ELEMENTS = /* @__PURE__ */ new Set([
  "attribute",
  "method",
  "handler",
  "setter",
  "event",
  "passthrough",
  "doc"
]);
function isPropertyElement(name) {
  return PROPERTY_ELEMENTS.has(name);
}
function parseArgs(argsStr) {
  const names = [];
  const defaults = [];
  for (const part of argsStr.split(",")) {
    const p = part.trim();
    if (!p)
      continue;
    const eq = p.indexOf("=");
    const namePart = (eq >= 0 ? p.slice(0, eq) : p).trim();
    const colon = namePart.indexOf(":");
    const name = (colon >= 0 ? namePart.slice(0, colon) : namePart).trim();
    if (eq >= 0) {
      names.push(name);
      defaults.push(p.slice(eq + 1).trim());
    } else {
      names.push(name);
      defaults.push(void 0);
    }
  }
  return { names, defaults };
}
function xmlEncode(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&apos;").replace(/"/g, "&quot;");
}
function normalizeTextContent(s) {
  return s.replace(/\s+/g, " ").trim();
}
function escapeXmlAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\t/g, "&#x9;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;");
}
function escapeXmlText(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#xD;");
}
var HTML_ELEMENTS = /* @__PURE__ */ new Set(["a", "b", "img", "br", "font", "i", "p", "pre", "u", "ul", "li", "ol"]);
function isHTMLElement(name) {
  return HTML_ELEMENTS.has(name);
}
function isJavaWhitespace(c) {
  const i = c.charCodeAt(0);
  return i === 32 || i === 9 || i === 10 || i === 13 || i === 12 || i === 11;
}
function elemRawText(el) {
  return el.children.map((n) => n.type === "text" ? n.value : "").join("");
}
var LineMetrics = class {
  constructor() {
    this.verbatim = false;
    this.trim = true;
    this.last_space_pos = -1;
    this.last_newline_pos = 0;
    this.buf = "";
  }
  addHTML(rawtext, normalized) {
    if (rawtext.length === 0)
      return;
    const leading = isJavaWhitespace(rawtext[0]);
    const trailing = isJavaWhitespace(rawtext[rawtext.length - 1]);
    const allWs = normalized.length === 0;
    if (allWs) {
      normalized = !this.trim && (leading || trailing) ? " " : "";
      this.trim = true;
    } else {
      if (!this.trim && leading)
        normalized = " " + normalized;
      if (trailing)
        normalized = normalized + " ";
      this.trim = trailing;
    }
    this.addSpan(normalized);
  }
  setVerbatim(v) {
    this.verbatim = v;
    this.last_space_pos = -1;
  }
  addSpan(str) {
    if (str.length === 0)
      return;
    str = xmlEncode(str);
    if (!this.verbatim) {
      const buflen = this.buf.length;
      this.last_space_pos = str[str.length - 1] === " " ? buflen + str.length - 1 : -1;
      const nl = str.lastIndexOf("\n");
      if (nl >= 0)
        this.last_newline_pos = nl + buflen;
    }
    this.buf += str;
  }
  addFormat(str) {
    this.buf += str;
  }
  endOfLine() {
    if (!this.verbatim && this.last_space_pos > 0 && this.last_space_pos > this.last_newline_pos)
      this.buf = this.buf.slice(0, this.last_space_pos) + this.buf.slice(this.last_space_pos + 1);
    this.last_space_pos = -1;
  }
  newline() {
    this.endOfLine();
    this.trim = true;
    this.buf += "<br/>";
  }
  paragraphBreak() {
    if (this.buf.length === 0)
      return;
    let tn = 0;
    for (let i = this.buf.length - 1; i >= 0; i--) {
      const c = this.buf[i];
      if (c === "	" || c === " ")
        continue;
      if (c === "\n")
        tn++;
      else if (this.buf.endsWith("<br/>")) {
        tn++;
        i -= "<br/>".length;
      } else
        break;
    }
    if (tn === 0)
      this.buf += "<br/><br/>";
    else if (tn === 1)
      this.buf += "<br/>";
    this.trim = true;
  }
};
function getHTMLContentInto(el, lm) {
  for (const node of el.children) {
    if (node.type === "elem") {
      const tag = node.name;
      if (tag === "br") {
        lm.newline();
        getHTMLContentInto(node, lm);
        if (elemRawText(node) !== "")
          lm.newline();
      } else if (tag === "p") {
        lm.paragraphBreak();
        lm.paragraphBreak();
      } else if (tag === "pre") {
        const prev = lm.verbatim;
        lm.setVerbatim(true);
        getHTMLContentInto(node, lm);
        lm.setVerbatim(prev);
      } else if (isHTMLElement(tag)) {
        lm.addFormat("<" + tag);
        for (const an of node.attrOrder)
          lm.addFormat(" " + an + '="' + node.attrs[an] + '"');
        lm.addFormat(">");
        getHTMLContentInto(node, lm);
        lm.addFormat("</" + tag + ">");
      }
    } else {
      const raw = node.value;
      if (lm.verbatim)
        lm.addSpan(raw);
      else if (raw.length > 0)
        lm.addHTML(raw, normalizeTextContent(raw));
    }
  }
}
function getHTMLContent(el) {
  const lm = new LineMetrics();
  getHTMLContentInto(el, lm);
  lm.endOfLine();
  return lm.buf;
}
function getInputText(el) {
  let text = "";
  for (const node of el.children) {
    if (node.type === "elem") {
      if (node.name === "p" || node.name === "br")
        text += "\n";
      else if (node.name === "pre")
        text += elemRawText(node);
    } else {
      text += normalizeTextContent(node.value);
    }
  }
  return text;
}
function isLocalDataset(el) {
  const type = el.attrs["type"];
  if (type === "soap" || type === "http")
    return false;
  const src = el.attrs["src"];
  if (src != null && (/^https?:/.test(src) || /^\s*\$(\w*)\s*\{[\s\S]*\}\s*$/.test(src)))
    return false;
  return true;
}
function isLiteralDatasetEl(el) {
  if (el.name !== "dataset")
    return false;
  const dtype = el.attrs["type"];
  const dsrc = el.attrs["src"];
  if (dtype === "soap" || dtype === "http")
    return false;
  if (dsrc != null && (/^https?:/.test(dsrc) || /^\s*\$(\w*)\s*\{[\s\S]*\}\s*$/.test(dsrc)))
    return false;
  if (el.attrs["datafromchild"] === "true")
    return false;
  return true;
}
function datasetArgs(el, globals, globalOrigins, opts) {
  const name = el.attrs["name"];
  if (!name)
    throw new Unsupported(`<dataset> without name`);
  const trim = el.attrs["trimwhitespace"] === "true";
  const nsprefix = el.attrs["nsprefix"] === "true";
  const src = el.attrs["src"];
  let children;
  if (src != null) {
    const text = opts.resolveDatasetSrc?.(src, el.origin);
    if (text == null)
      throw new Unsupported(`unresolved dataset src: ${src}`);
    children = [parseXml(text, { keepComments: true })];
  } else {
    children = el.children;
  }
  if (trim)
    throw new Unsupported(`dataset trimwhitespace`);
  const dataEl = { type: "elem", name: "data", attrs: {}, attrOrder: [], children };
  const content = serializeXmlRaw(dataEl);
  globals.push(name);
  addKnownId(name);
  globalOrigins.push(el.origin ?? "");
  return { name, content, trim, nsprefix };
}
function compileDataset(el, globals, globalOrigins, opts) {
  const { name, content, trim, nsprefix } = datasetArgs(el, globals, globalOrigins, opts);
  return `${name}=canvas.lzAddLocalData(${jsString(name)},${jsString(content)},${trim},${nsprefix});${name}==true;`;
}
function compileDatasetDebug(el, globals, globalOrigins, opts, dir) {
  const { name, content, trim, nsprefix } = datasetArgs(el, globals, globalOrigins, opts);
  const src = `${name} = canvas.lzAddLocalData(${jsString(name)}, ${jsString(content)}, ${trim}, ${nsprefix});${name} == true`;
  const [dirFile, dirLine] = dir;
  return compileProgramDebug(src, dirFile, dirLine);
}
function serializeXmlRaw(el) {
  let out = "<" + el.name;
  for (const a of el.attrOrder)
    out += ` ${a}="${escapeXmlAttr(el.attrs[a])}"`;
  if (el.children.length === 0)
    return out + " />";
  out += ">";
  for (const c of el.children) {
    if (c.type === "elem")
      out += serializeXmlRaw(c);
    else if (c.comment)
      out += `<!--${c.value}-->`;
    else
      out += escapeXmlText(c.value);
  }
  return out + `</${el.name}>`;
}
function parseConstraint(raw) {
  const m = /^\s*\$(\w*)\s*\{([\s\S]*)\}\s*$/.exec(raw);
  if (!m)
    return null;
  return { when: m[1] === "always" ? "" : m[1], expr: m[2] };
}
function attrConstraint(raw, whenAttr) {
  if (raw == null)
    return null;
  const c = parseConstraint(raw);
  if (c)
    return { ...c, literal: false };
  if (whenAttr != null)
    return { when: whenAttr === "always" ? "" : whenAttr, expr: raw, literal: true };
  return null;
}
var DEPS_INNER = (deps) => `try{
return ${deps}
}
catch($lzsc$e){
if(Error["$lzsc$isa"]?Error.$lzsc$isa($lzsc$e):$lzsc$e instanceof Error){
lz.$lzsc$thrownError=$lzsc$e
};throw $lzsc$e
}`;
var depsMethod = (deps, hasFree) => hasFree ? `function(){
with(this){
${DEPS_INNER(deps)}}}` : `function(){
${DEPS_INNER(deps)}}`;
var srcDirective = (file, line) => `
#file ${file}
#line ${line}
`;
var END_SRC_DIRECTIVE = "\n#file \n";
var attrSrc = (file, line, value) => "#beginAttribute" + srcDirective(file, line) + value + END_SRC_DIRECTIVE + "#endAttribute";
function compileConstraintDebug(name, exprType, expr, when, mGen, file, srcLine) {
  const q = jsString(name);
  const setterName = mGen.next();
  const whenTag = when === "path" ? "path" : when === "once" ? "once" : "";
  const dnSetter = `${name}='$${whenTag}{...}'`;
  if (when === "once" || when === "path") {
    const installer = when === "path" ? "dataBindAttribute" : "setAttribute";
    const extra = when === "path" ? `,${jsString(exprType)}` : "";
    const setterBody2 = `this.${installer}(${q},${attrSrc(file, srcLine, expr)}${extra})`;
    const setterFn2 = compileFunctionDebug(dnSetter, ["$lzc$ignore"], setterBody2, [void 0], file, srcLine, srcLine, false, "report", true, dnSetter);
    return {
      entries: [ent(setterName, setterFn2)],
      // The debug build carries the binder's prettyBinderName as the init's last
      // arg (production AND profile pass `null` — it is $debug-gated, NodeModel).
      initExpr: `new LzOnceExpr(${q}, ${jsString(exprType)}, ${jsString(setterName)}, ${COMPILE_PROFILE ? "null" : jsString(dnSetter)})`,
      lastBody: setterBody2,
      lastSrcLine: srcLine
    };
  }
  const depsName = mGen.next();
  const setterBody = `var $lzc$newvalue = ${attrSrc(file, srcLine, expr)};
if ($lzc$newvalue !== this[${q}] || (! this.inited)) {
this.setAttribute(${q},$lzc$newvalue)
}`;
  const setterFn = compileFunctionDebug(dnSetter, ["$lzc$ignore"], setterBody, [void 0], file, srcLine, srcLine, false, "report", true, dnSetter);
  const deps = collectDependencies(expr);
  const depsBody = `if ($debug) {
  return $lzc$validateReferenceDependencies(${deps.array}, ${deps.annotation});
} else {
  return ${deps.array};
}
`;
  const depsFn = compileFunctionDebug(`${name} dependencies`, [], depsBody, [], file, srcLine, srcLine, false, "throws", true, `${name} dependencies`);
  return {
    entries: [ent(setterName, setterFn), ent(depsName, depsFn)],
    initExpr: `new LzAlwaysExpr(${q}, ${jsString(exprType)}, ${jsString(setterName)}, ${jsString(depsName)}, ${COMPILE_PROFILE ? "null" : jsString(dnSetter)})`,
    lastBody: depsBody,
    lastSrcLine: srcLine
  };
}
function compileConstraint(name, exprType, expr, when, mGen) {
  const q = jsString(name);
  const setterName = mGen.next();
  if (when === "once" || when === "path") {
    const body = when === "path" ? `this.dataBindAttribute(${q},${expr},${jsString(exprType)})` : `this.setAttribute(${q},${expr})`;
    const setterFn2 = compileFunction(["$lzc$ignore"], body);
    return {
      entries: [`${jsString(setterName)},${setterFn2}`],
      initExpr: `new LzOnceExpr(${q},${jsString(exprType)},${jsString(setterName)},null)`
    };
  }
  const depsName = mGen.next();
  const setterBody = `var $lzc$newvalue = ${expr};
if ($lzc$newvalue !== this[${q}] || (! this.inited)) {
this.setAttribute(${q},$lzc$newvalue)
}`;
  const setterFn = compileFunction(["$lzc$ignore"], setterBody);
  const deps = collectDependencies(expr);
  return {
    entries: [`${jsString(setterName)},${setterFn}`, `${jsString(depsName)},${depsMethod(deps.array, deps.hasFree)}`],
    initExpr: `new LzAlwaysExpr(${q},${jsString(exprType)},${jsString(setterName)},${jsString(depsName)},null)`
  };
}
function colorValue(name, raw, declared, mGen, file, srcLine) {
  try {
    return { plain: `LzColorUtils.convertColor(${jsString(canonicalColorHex(raw))})` };
  } catch (e) {
    if (!(e instanceof ColorFormatException))
      throw e;
    const expr = `LzColorUtils.convertColor(${jsString(raw)})`;
    const cc = COMPILE_DEBUG && file !== void 0 ? compileConstraintDebug(name, declared, expr, "once", mGen, file, srcLine ?? 0) : compileConstraint(name, declared, expr, "once", mGen);
    return { entries: cc.entries, init: cc.initExpr, cc };
  }
}
function styleConstraintExpr(name, exprType, value, fallback) {
  const v = value.trim();
  if (!/^(?:'\S*'|"\S*")$/.test(v))
    throw new Unsupported(`non-constant $style binding: ${name}`);
  const sep = COMPILE_DEBUG ? ", " : ",";
  const fb = fallback !== void 0 ? `${sep}${fallback}${sep}false` : "";
  return `new LzStyleConstraintExpr(${jsString(name)}${sep}${jsString(exprType)}${sep}${jsString(v.slice(1, -1))}${fb})`;
}
function aliasType(t) {
  return t === "html" ? "text" : t;
}
function btNoteConstraintInit(initExpr, line, file) {
  if (!COMPILE_BACKTRACE)
    return initExpr;
  const m = /^new ([A-Za-z_$][\w$.]*)\(([\s\S]*)\)$/.exec(initExpr);
  if (!m)
    return initExpr;
  void file;
  const note = `${annoFileLine(null, 0)}$3.lineno = ${line}`;
  return `(${note}, new (${note}, ${m[1]})(${m[2]}))`;
}
function btNoteColorInit(plain, line) {
  if (!COMPILE_BACKTRACE)
    return plain;
  const m = /^([A-Za-z_$][\w$.]*)\.([A-Za-z_$][\w$]*)\(([\s\S]*)\)$/.exec(plain);
  if (!m)
    return plain;
  const note = `${annoFileLine(null, 0)}$3.lineno = ${line}`;
  return `(${note}, (${note}, ${m[1]}).${m[2]}(${m[3]}))`;
}
function compileAttr(tag, name, raw, inCanvas, typeOf = attrType) {
  if (/^\$(once|always|immediately)?\{/.test(raw) || /^\$\{/.test(raw)) {
    throw new Unsupported(`constraint expression: ${name}=${raw}`);
  }
  if (isEventAttr(name)) {
    throw new Unsupported(`event-handler attribute: ${name} (anon-subclass milestone)`);
  }
  if (name === "id" || name === "name") {
    throw new Unsupported(`${name}= outside a top-level instance`);
  }
  if (name === FONTSTYLE_ATTRIBUTE)
    raw = normalizeStyleString(raw);
  return compileTypedValue(typeOf(tag, name), raw, inCanvas);
}
var FONTSTYLE_ATTRIBUTE = "fontstyle";
function normalizeStyleString(style) {
  let bits = 0;
  for (const tok of style.trim().split(/\s+/)) {
    if (tok === "")
      continue;
    else if (tok === "bold")
      bits |= 1;
    else if (tok === "italic")
      bits |= 2;
    else if (tok === "plain")
      bits |= 0;
    else if (tok === "bolditalic")
      bits |= 3;
    else
      throw new Unsupported(`unknown fontstyle token: ${tok}`);
  }
  return ["plain", "bold", "italic", "bolditalic"][bits];
}
function compileTypedValue(t, raw, inCanvas) {
  switch (t) {
    case "color":
      if (inCanvas)
        return emitTyped({ kind: "number", v: parseColor(raw) });
      try {
        return `LzColorUtils.convertColor(${jsString(canonicalColorHex(raw))})`;
      } catch (e) {
        if (e instanceof ColorFormatException)
          return `LzColorUtils.convertColor(${jsString(raw)})`;
        throw e;
      }
    case "number":
      if (raw.trim().endsWith("%"))
        return emitTyped({ kind: "string", v: raw });
      return COMPILE_DEBUG ? compileExprDebug(raw) : compileExpr(raw);
    case "boolean":
      return COMPILE_DEBUG ? compileExprDebug(raw) : compileExpr(raw);
    case "expression":
      return COMPILE_DEBUG ? compileExprDebug(raw) : compileExpr(raw);
    case "css":
      return compileCss(raw);
    case "string":
      return emitTyped({ kind: "string", v: raw });
  }
}
function compileCss(raw) {
  const props = {};
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const decl of text.split(";")) {
    const d = decl.trim();
    if (d === "")
      continue;
    const ci = d.indexOf(":");
    if (ci < 0) {
      const key2 = d.trim();
      if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(key2))
        throw new Unsupported(`css property: ${key2}`);
      props[key2] = "true";
      continue;
    }
    const key = d.slice(0, ci).trim();
    const valRaw = d.slice(ci + 1).trim();
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(key))
      throw new Unsupported(`css property: ${key}`);
    props[key] = compileCssTerm(valRaw);
  }
  return COMPILE_DEBUG ? emitObjectSpaced(props) : emitObject(props);
}
function compileCssTerm(v) {
  let m;
  if (m = /^([+-]?)([1-9][0-9]*)$/.exec(v)) {
    const n = parseInt(m[2], 10);
    return emitTyped({ kind: "number", v: m[1] === "-" ? -n : n });
  }
  if (m = /^([+-]?)((?:[0-9]+\.[0-9]*|\.[0-9]+|[0-9]+)(?:[eE][+-]?[0-9]+)?)$/.exec(v)) {
    const n = parseFloat(m[2]);
    return emitTyped({ kind: "number", v: m[1] === "-" ? -n : n });
  }
  if ((m = /^'([^'\\]*)'$/.exec(v)) || (m = /^"([^"\\]*)"$/.exec(v)))
    return emitTyped({ kind: "string", v: m[1] });
  if (v === "true" || v === "false")
    return v;
  if (/^[A-Za-z][A-Za-z0-9-]*$/.test(v))
    return emitTyped({ kind: "string", v });
  throw new Unsupported(`css value: ${v}`);
}
function childViews(el) {
  return el.children.filter((c) => c.type === "elem" && c.name !== "doc" && c.name !== "datapath" && !isPropertyElement(c.name) && !isHTMLElement(c.name));
}
var LZSC_INIT_FN = 'function($0,$1,$2,$3){\nswitch(arguments.length){\ncase 0:\n$0=null;\ncase 1:\n$1=null;\ncase 2:\n$2=null;\ncase 3:\n$3=false;\n\n};(arguments.callee["$superclass"]&&arguments.callee.$superclass.prototype["$lzsc$initialize"]||this.nextMethod(arguments.callee,"$lzsc$initialize")).call(this,$0,$1,$2,$3)\n}';
function ent(name, value) {
  return jsString(name) + (COMPILE_DEBUG ? ", " : ",") + value;
}
function emitObj(o) {
  return COMPILE_DEBUG ? emitObjectSpaced(o) : emitObject(o);
}
function voidSlot(name) {
  return jsString(name) + (COMPILE_DEBUG ? ", void 0" : ",void 0");
}
function adjustRelativePathJ(p, source, dest) {
  const norm = (parts) => {
    const out = [];
    for (const c of parts) {
      if (c === "." || c === "")
        continue;
      if (c === ".." && out.length && out[out.length - 1] !== "..")
        out.pop();
      else
        out.push(c);
    }
    return out;
  };
  if (p.endsWith("/"))
    return p;
  const sd = norm(source.replace(/\/+$/, "").split("/"));
  const dd = norm(dest.replace(/\/+$/, "").split("/"));
  while (sd.length && dd.length && sd[0] === dd[0]) {
    sd.shift();
    dd.shift();
  }
  const comps = [];
  for (let i = 0; i < sd.length; i++)
    comps.push("..");
  for (const d of dd)
    comps.push(d);
  comps.push(p);
  return comps.join("/");
}
function urlSchemeSource(raw, srcDir, destDir) {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):([\s\S]*)$/.exec(raw);
  if (!m)
    return raw;
  const rest = m[2];
  if (rest.startsWith("//")) {
    const after = rest.slice(2);
    const slash = after.indexOf("/");
    const authority = slash < 0 ? after : after.slice(0, slash);
    if (authority.length > 0)
      return raw;
    const path2 = slash < 0 ? "" : after.slice(slash);
    return path2.startsWith("/") ? raw : path2 || raw;
  }
  const hash = rest.indexOf("#");
  const noFrag = hash < 0 ? rest : rest.slice(0, hash);
  const q = noFrag.indexOf("?");
  let path = q < 0 ? noFrag : noFrag.slice(0, q);
  const query = q < 0 ? "" : noFrag.slice(q + 1);
  if (path.startsWith("/"))
    return raw;
  if (srcDir && destDir && srcDir !== destDir)
    path = adjustRelativePathJ(path, srcDir, destDir);
  return query.length > 0 ? path + "?" + query : path;
}
function dirOf(id) {
  const s = id.replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(0, i) : "";
}
function isVoidSlot(e) {
  return e.endsWith(",void 0") || e.endsWith(", void 0");
}
function splitEntry(e) {
  const m = /^"((?:[^"\\]|\\.)*)",\s?([\s\S]*)$/.exec(e);
  return m ? { name: m[1], value: m[2] } : null;
}
function routeStateMethods(instEntries, inits) {
  return instEntries.map((e) => {
    const m = splitEntry(e);
    if (!m || isVoidSlot(e))
      return e;
    inits[m.name] = m.value;
    return voidSlot(m.name);
  });
}
function emitClassBlock(name, superJs, instEntries, defaultAttrs, childrenJs, classAllocEntries = [], datapathSlot = false, dbg) {
  const lzcName = classJsName(name);
  if (dbg) {
    const ctor = dbg.memberRich ? debugConstructorPlain(dbg.ctorLine) : debugConstructor(dbg.file, dbg.ctorLine);
    const tailEntries = [`"$lzsc$initialize", ${ctor}`];
    if (datapathSlot)
      tailEntries.push(`"$datapath", void 0`);
    const allocPart2 = classAllocEntries.length ? classAllocEntries.join(", ") + ", " : "";
    const childrenPart2 = childrenJs ? `"children", ${childrenJs}, ` : "";
    const classPropsInner = `${allocPart2}"tagname", ${jsString(name)}, ${childrenPart2}"attributes", new LzInheritedHash(${superJs}.attributes)`;
    const make2 = renderDebugClassMake(dbg.file, dbg.classLine, `"${lzcName}"`, [...instEntries, ...tailEntries], superJs, classPropsInner);
    if (Object.keys(defaultAttrs).length === 0)
      return make2;
    const merge2 = debugMergeAttributes(dbg.file, dbg.classLine, dbg.bodyLine, lzcName, emitObjectSpaced(defaultAttrs), dbg.memberRich ? void 0 : dbg.ctorLine + 4, dbg.ctorLine + 4);
    return `{
${make2};
${merge2}
}`;
  }
  const tail = `"$lzsc$initialize",${LZSC_INIT_FN}` + (datapathSlot ? `,"$datapath",void 0` : "");
  const props = [...instEntries, tail].join(",");
  const childrenPart = childrenJs ? `"children",${childrenJs},` : "";
  const allocPart = classAllocEntries.length ? classAllocEntries.join(",") + "," : "";
  const classProps = `[${allocPart}"tagname",${jsString(name)},${childrenPart}"attributes",new LzInheritedHash(${superJs}.attributes)]`;
  const make = `Class.make("${lzcName}",[${props}],${superJs},${classProps});`;
  if (Object.keys(defaultAttrs).length === 0)
    return make;
  const merge = `(function($0){
with($0)with($0.prototype){
{
LzNode.mergeAttributes(${emitObject(defaultAttrs)},${lzcName}.attributes)
}}})(${lzcName})`;
  return `{
${make}${merge}
};`;
}
function emitAnonClass(lzcName, superJs, superTag, instEntries, childrenJs) {
  const props = [...instEntries, `"$lzsc$initialize",${LZSC_INIT_FN}`].join(",");
  const dn = jsString(`<anonymous extends='${superTag}'>`);
  const childrenPart = childrenJs ? `"children",${childrenJs},` : "";
  const classProps = `["displayName",${dn},${childrenPart}"attributes",new LzInheritedHash(${superJs}.attributes)]`;
  return `Class.make("${lzcName}",[${props}],${superJs},${classProps});`;
}
function emitAnonClassDebug(lzcName, superJs, superTag, instEntries, childrenJs, node) {
  const file = node.el ? debugFile(node.el) : "";
  const classLine = (node.el?.endLine ?? node.el?.line ?? 1) - 1;
  if (node.lastMemberBody === void 0)
    throw new Unsupported(`debug anon class without a tracked code member`);
  const finalLine = finalSourceLine(srcDirective(file, node.lastMemberSrcLine) + node.lastMemberBody + END_SRC_DIRECTIVE + "\n}");
  let lastMethodIdx = -1;
  for (let i = 0; i < instEntries.length; i++)
    if (!isVoidSlot(instEntries[i]))
      lastMethodIdx = i;
  const trailingVarDecls = instEntries.length - 1 - lastMethodIdx;
  const ctorLine = finalLine + 1 + trailingVarDecls;
  const ctor = ent("$lzsc$initialize", debugConstructorPlain(ctorLine));
  const firstChildBinder = node.children[0]?.idBinderSpec;
  if (firstChildBinder)
    firstChildBinder.funcLine = classLine + 3;
  const dn = jsString(`<anonymous extends='${superTag}'>`);
  const childrenPart = childrenJs ? `"children", ${childrenJs}, ` : "";
  const classPropsInner = `"displayName", ${dn}, ${childrenPart}"attributes", new LzInheritedHash(${superJs}.attributes)`;
  return renderDebugClassMake(file, classLine, `"${lzcName}"`, [...instEntries, ctor], superJs, classPropsInner);
}
function collectNamedChildren(childEls, superTag, ctx) {
  const names = [];
  for (const c of childEls) {
    if (ctx.isStateClass(c.name)) {
      names.push(...collectNamedChildren(childViews(c), c.name, ctx));
    } else if (c.attrs["name"] != null) {
      names.push(c.attrs["name"]);
    }
  }
  if (superTag) {
    const def = ctx.classes.get(superTag);
    if (def)
      names.push(...collectNamedChildren(childViews(def.el), def.superTag, ctx));
  }
  return names;
}
function percentConstraintExpr(schemaType, name, raw) {
  if (schemaType !== "size" && schemaType !== "numberExpression")
    return null;
  const v = raw.trim();
  if (!v.endsWith("%"))
    return null;
  const f = parseFloat(v.slice(0, -1));
  if (Number.isNaN(f))
    return null;
  const scale = Math.fround(f) / 100;
  const ref = name === "x" ? "width" : name === "y" ? "height" : name;
  let expr = "immediateparent." + ref;
  if (scale !== 1)
    expr += "\n * " + javaDouble(scale);
  return expr;
}
function buildNode(el, ctx, topLevel, classDepth, parentTag) {
  const { resolve, resolveConstraintType, valueTypeOf, isInherited, mGen, globals, globalOrigins, registerResource } = ctx;
  const superTag = el.name;
  const methodEntries = [];
  const delegateList = [];
  const delegateEvents = /* @__PURE__ */ new Set();
  const attrs = {};
  const slotNames = [];
  const inlineSlots = [];
  const attrSlots = [];
  let hasLiteralAttr = false;
  let lastMemberBody;
  let lastMemberSrcLine;
  let idBinderSpec;
  const noteCodeMember = (body, srcLine) => {
    if (body !== void 0) {
      lastMemberBody = body;
      lastMemberSrcLine = srcLine;
    }
  };
  let pendingNameGlobal;
  let pendingNameBinderRaw;
  if (el.name === "script") {
    if (el.attrs["when"] === "immediate")
      throw new Unsupported(`<script when="immediate">`);
    let body = el.children.map((n) => n.type === "text" ? n.value : "").join("");
    const src = el.attrs["src"];
    if (src) {
      const text = SCRIPT_SRC?.(src, el.origin ?? DEBUG_SOURCE_ID);
      if (text == null)
        throw new Unsupported(`<script src="${src}"> not found`);
      body = `#file ${src}
#line 1
` + text;
    }
    const script = COMPILE_DEBUG ? compileScriptBodyDebug(body, debugFile(el), el.line ?? 0, (el.endCol ?? 0) + 63) : compileScriptBody(body);
    return { superTag, methodEntries, attrs, delegateList, delegateEvents, children: [], slotNames: [], inlineSlots: [], attrSlots: [], script, subtreeHasScriptOrContent: true };
  }
  let datasetLiteral = false;
  if (el.name === "dataset") {
    const dtype = el.attrs["type"];
    const dsrc = el.attrs["src"];
    const datafromchild = el.attrs["datafromchild"] === "true";
    const literal = !(dtype === "soap" || dtype === "http") && !(dsrc != null && (/^https?:/.test(dsrc) || /^\s*\$(\w*)\s*\{[\s\S]*\}\s*$/.test(dsrc))) && !datafromchild;
    if (literal) {
      datasetLiteral = true;
      let dchildren;
      if (dsrc != null) {
        const text = DATASET_SRC?.(dsrc, el.origin);
        if (text == null)
          throw new Unsupported(`unresolved dataset src: ${dsrc}`);
        dchildren = [parseXml(text, { keepComments: true })];
      } else {
        dchildren = el.children;
      }
      if (el.attrs["trimwhitespace"] === "true")
        throw new Unsupported(`dataset trimwhitespace`);
      const dataEl = { type: "elem", name: "data", attrs: {}, attrOrder: [], children: dchildren };
      attrs["initialdata"] = jsString(serializeXmlRaw(dataEl));
      hasLiteralAttr = true;
    }
  }
  for (const name of el.attrOrder) {
    const raw = el.attrs[name];
    if (name === "resource" && !parseConstraint(raw) && /^(?:https?|ftp|file|soap):/.test(raw)) {
      attrs["source"] = jsString(urlSchemeSource(raw, dirOf(DEBUG_SOURCE_ID), dirOf(el.origin ?? DEBUG_SOURCE_ID))) + (COMPILE_DEBUG ? litReset(el.endLine ?? el.line ?? 0) : "");
      hasLiteralAttr = true;
    } else if (name === "resource" && !parseConstraint(raw)) {
      attrs["resource"] = jsString(registerResource(raw, el.origin)) + (COMPILE_DEBUG ? litReset(el.endLine ?? el.line ?? 0) : "");
      hasLiteralAttr = true;
    } else if (name === "id") {
      globals.push(raw);
      addKnownId(raw);
      globalOrigins.push(el.origin ?? "");
      attrs["$lzc$bind_id"] = COMPILE_DEBUG ? idBinderDebug(raw, true, debugFile(el), el.endLine ?? el.line ?? 0) : idBinder(raw, true);
      if (COMPILE_DEBUG)
        idBinderSpec = lastBinderSpec();
      attrs["id"] = jsString(raw) + (COMPILE_DEBUG ? litReset(el.endLine ?? el.line ?? 0) : "");
      hasLiteralAttr = true;
    } else if (name === "name") {
      attrs["name"] = jsString(raw) + (COMPILE_DEBUG ? litReset(el.endLine ?? el.line ?? 0) : "");
      hasLiteralAttr = true;
      if (topLevel) {
        pendingNameGlobal = raw;
        pendingNameBinderRaw = raw;
      }
    } else if (isEventAttr(name)) {
      const h = emitHandler(name, raw, void 0, void 0, void 0, mGen, methodEntries, delegateList, delegateEvents, el, true);
      noteCodeMember(h.body, h.srcLine);
    } else {
      let con = parseConstraint(raw);
      let ctype = null;
      let literal = false;
      if (!con && raw.trim().endsWith("%")) {
        try {
          ctype = resolveConstraintType(superTag, name, parentTag);
        } catch {
          ctype = null;
        }
        const pexpr = percentConstraintExpr(ctype, name, raw);
        if (pexpr)
          con = { when: "", expr: pexpr };
      }
      if (!con && !isEventAttr(name)) {
        const iw = ctx.inheritedWhen(superTag, name);
        if (iw === "once" || iw === "always") {
          const ac = attrConstraint(raw, iw);
          if (ac) {
            con = { when: ac.when, expr: ac.expr };
            literal = ac.literal;
          }
        }
      }
      if (con) {
        if (con.when === "style") {
          attrs[name] = styleConstraintExpr(name, resolveConstraintType(superTag, name, parentTag), con.expr);
        } else if (con.when === "immediately") {
          attrs[name] = (COMPILE_DEBUG ? compileExprDebug(con.expr) : compileExpr(con.expr)) + (COMPILE_DEBUG ? litReset(el.endLine ?? el.line ?? 0) : "");
          hasLiteralAttr = true;
        } else {
          if (con.when !== "" && con.when !== "once" && con.when !== "path")
            throw new Unsupported(`$${con.when}{} constraint`);
          const declared = ctype ?? resolveConstraintType(superTag, name, parentTag);
          const setterExpr = literal && declared === "color" ? `LzColorUtils.convertColor(${jsString(con.expr)})` : con.expr;
          const endLn = el.endLine ?? el.line ?? 0;
          const cc = COMPILE_DEBUG ? compileConstraintDebug(name, declared, setterExpr, con.when, mGen, debugFile(el), endLn) : compileConstraint(name, declared, setterExpr, con.when, mGen);
          noteCodeMember(cc.lastBody, cc.lastSrcLine);
          if (name === "datapath") {
            for (const e of cc.entries) {
              const m = splitEntry(e);
              methodEntries.push(voidSlot(m.name));
              attrs[m.name] = m.value;
            }
          } else {
            methodEntries.push(...cc.entries);
          }
          attrs[name] = cc.initExpr;
        }
      } else if (valueTypeOf(superTag, name) === "color") {
        const cv = colorValue(name, raw, resolveConstraintType(superTag, name, parentTag), mGen, debugFile(el), el.endLine ?? el.line ?? 0);
        if ("plain" in cv) {
          attrs[name] = cv.plain + (COMPILE_DEBUG ? litReset(el.endLine ?? el.line ?? 0) : "");
          hasLiteralAttr = true;
        } else {
          methodEntries.push(...cv.entries);
          attrs[name] = cv.init;
          noteCodeMember(cv.cc.lastBody, cv.cc.lastSrcLine);
        }
      } else {
        attrs[name] = compileAttr(superTag, name, raw, false, valueTypeOf) + (COMPILE_DEBUG ? litReset(el.endLine ?? el.line ?? 0) : "");
        hasLiteralAttr = true;
      }
    }
  }
  if (pendingNameBinderRaw !== void 0) {
    const baseLine = el.endLine ?? el.line ?? 0;
    const nameLine = el.attrs["id"] != null ? baseLine + binderLineSpan(true) : baseLine;
    attrs["$lzc$bind_name"] = COMPILE_DEBUG ? idBinderDebug(pendingNameBinderRaw, false, debugFile(el), nameLine) : idBinder(pendingNameBinderRaw, false);
  }
  if (pendingNameGlobal !== void 0 && pendingNameGlobal !== el.attrs["id"]) {
    globals.push(pendingNameGlobal);
    addKnownId(pendingNameGlobal);
    globalOrigins.push(el.origin ?? "");
  }
  const children = [];
  let datapathNode;
  let textParts = "";
  for (const c of datasetLiteral ? [] : el.children) {
    if (c.type === "text") {
      textParts += c.value;
      continue;
    }
    if (c.name === "doc")
      continue;
    if (isHTMLElement(c.name))
      continue;
    if (c.name === "handler") {
      const h = compileHandler(c, mGen, methodEntries, delegateList, delegateEvents);
      noteCodeMember(h.body, h.srcLine);
    } else if (c.name === "method") {
      methodEntries.push(compileMethod(c));
      noteCodeMember(c.children.map((n) => n.type === "text" ? n.value : "").join("") + "\n#endContent", c.line ?? 0);
    } else if (c.name === "attribute") {
      const an = c.attrs["name"];
      if (!an)
        throw new Unsupported(`<attribute> without name`);
      const raw = "value" in c.attrs ? c.attrs["value"] : null;
      const con = attrConstraint(raw, c.attrs["when"]);
      const slot = isInherited(superTag, an) || ctx.isStateClass(superTag) ? [] : [voidSlot(an)];
      const setLine = c.endLine ?? c.line ?? 0;
      const setterEntry = c.attrs["setter"] != null ? [COMPILE_DEBUG ? ent("$lzc$set_" + an, compileFunctionDebug("set " + an, [an], c.attrs["setter"], [], debugFile(c), setLine, setLine + 1, false, "report", true, "set " + an)) : `${jsString("$lzc$set_" + an)},${compileFunction([an], c.attrs["setter"])}`] : [];
      if (con && con.when === "immediately") {
        methodEntries.push(...slot, ...setterEntry);
        if (!isInherited(superTag, an))
          attrSlots.push(an);
        attrs[an] = COMPILE_DEBUG ? compileExprDebug(con.expr) : compileExpr(con.expr);
      } else if (con && con.when === "style") {
        const declared = c.attrs["type"] != null ? aliasType(c.attrs["type"]) : resolveConstraintType(superTag, an);
        methodEntries.push(...slot, ...setterEntry);
        attrs[an] = styleConstraintExpr(an, declared, con.expr);
      } else if (con) {
        if (con.when !== "" && con.when !== "once" && con.when !== "path")
          throw new Unsupported(`$${con.when}{} constraint`);
        const declared = c.attrs["type"] != null ? aliasType(c.attrs["type"]) : resolveConstraintType(superTag, an);
        const litType = con.literal ? c.attrs["type"] ? mapType(c.attrs["type"]) : valueTypeOf(superTag, an) : null;
        const setterExpr = litType === "color" ? `LzColorUtils.convertColor(${jsString(con.expr)})` : con.expr;
        const conSrc = an === "resource" ? el : c;
        const cc = COMPILE_DEBUG ? compileConstraintDebug(an, declared, setterExpr, con.when, mGen, debugFile(conSrc), conSrc.endLine ?? conSrc.line ?? 0) : compileConstraint(an, declared, setterExpr, con.when, mGen);
        noteCodeMember(cc.lastBody, cc.lastSrcLine);
        methodEntries.push(...cc.entries, ...slot, ...setterEntry);
        attrs[an] = cc.initExpr;
      } else {
        methodEntries.push(...slot, ...setterEntry);
        if (!isInherited(superTag, an))
          attrSlots.push(an);
        if (raw != null) {
          if (an === "resource" && !c.attrs["type"] && !parseConstraint(raw) && !/^(?:https?|ftp|file|soap):/.test(raw)) {
            attrs[an] = jsString(registerResource(raw, c.origin));
          } else {
            const declared = c.attrs["type"] ? mapType(c.attrs["type"]) : isInherited(superTag, an) ? valueTypeOf(superTag, an) : mapType("expression");
            attrs[an] = compileTypedValue(declared, raw, false);
          }
        }
      }
    } else if (c.name === "event") {
      const en = c.attrs["name"];
      if (!en)
        throw new Unsupported(`<event> without name`);
      if (!isInherited(superTag, en))
        methodEntries.push(voidSlot(en));
      attrs[en] = "LzDeclaredEvent";
    } else if (c.name === "setter") {
      const sn = c.attrs["name"];
      if (!sn)
        throw new Unsupported(`<setter> without name`);
      const { names, defaults } = parseArgs(c.attrs["args"] || "");
      const sbody = c.children.map((n) => n.type === "text" ? n.value : "").join("");
      methodEntries.push(COMPILE_DEBUG ? ent("$lzc$set_" + sn, compileFunctionDebug("set " + sn, names, sbody, defaults, debugFile(c), c.line ?? 0, bodyLineOf(c), false, "report", true, "set " + sn)) : `${jsString("$lzc$set_" + sn)},${compileFunction(names, sbody, defaults)}`);
      noteCodeMember(sbody + "\n#endContent", bodyLineOf(c));
    } else if (isPropertyElement(c.name)) {
    } else if (c.name === "datapath") {
      if (datapathNode)
        throw new Unsupported(`multiple <datapath> children`);
      datapathNode = buildNode(c, ctx, false, null, superTag);
      if (datapathNode.datapath)
        throw new Unsupported(`nested <datapath>`);
      if (datapathNode.methodEntries.some((e) => !isVoidSlot(e)))
        datapathNode.isState = true;
    } else {
      if (c.attrs["name"] != null) {
        slotNames.push(c.attrs["name"]);
        if (!ctx.isStateClass(superTag)) {
          methodEntries.push(voidSlot(c.attrs["name"]));
          inlineSlots.push(c.attrs["name"]);
        }
      }
      const childDepth = classDepth == null ? null : classDepth + (ctx.isStateClass(superTag) ? 0 : 1);
      children.push(buildNode(c, ctx, false, childDepth, superTag));
    }
  }
  if (!ctx.isStateClass(superTag)) {
    for (const c of childViews(el)) {
      if (!ctx.isStateClass(c.name))
        continue;
      for (const h of collectNamedChildren(childViews(c), c.name, ctx))
        if (!slotNames.includes(h) && !(h in attrs))
          slotNames.push(h);
    }
  }
  if (ctx.hasTextContent(superTag) && !("text" in attrs)) {
    const text = ctx.isInputTextTag(superTag) ? getInputText(el) : getHTMLContent(el);
    if (text.length !== 0) {
      attrs["text"] = jsString(text);
    }
  } else if (textParts.trim() && !ctx.hasTextContent(superTag)) {
    throw new Unsupported(`unexpected text content in <${el.name}>`);
  }
  if (classDepth != null)
    attrs["$classrootdepth"] = String(classDepth);
  const becomesAnonClass = methodEntries.some((e) => !isVoidSlot(e)) && !ctx.isStateClass(superTag);
  const subtreeHasLiteralAttr = hasLiteralAttr || !becomesAnonClass && children.some((c) => c.subtreeHasLiteralAttr) || (datapathNode?.subtreeHasLiteralAttr ?? false);
  const subtreeHasScriptOrContent = !becomesAnonClass && children.some((c) => c.subtreeHasScriptOrContent) || (datapathNode?.subtreeHasScriptOrContent ?? false);
  let subtreeLastLiteralLine = hasLiteralAttr ? el.endLine ?? el.line ?? void 0 : void 0;
  if (!becomesAnonClass) {
    for (const c of children)
      if (c.subtreeLastLiteralLine != null)
        subtreeLastLiteralLine = c.subtreeLastLiteralLine;
  }
  return { superTag, methodEntries, attrs, delegateList, delegateEvents, children, slotNames, inlineSlots, attrSlots, datapath: datapathNode, isState: ctx.isStateClass(superTag), isInterface: ctx.interfaces.has(superTag), el, lastMemberBody, lastMemberSrcLine, idBinderSpec, subtreeHasLiteralAttr, subtreeHasScriptOrContent, subtreeLastLiteralLine, topLevelHasIdOrName: topLevel && (el.attrs["name"] != null || el.attrs["id"] != null) };
}
function emitNode(node, resolve, inheritsChildren, mGen, compileClass) {
  if (node.script != null)
    return {
      defs: "",
      map: COMPILE_DEBUG ? `{"class": lz.script, attrs: {script: ${node.script}}}` : `{"class":lz.script,attrs:{script:${node.script}}}`
    };
  const hasMethods = node.methodEntries.some((e) => !isVoidSlot(e));
  const className = hasMethods && !node.isState ? `$lzc$class_${mGen.next().slice(1)}` : null;
  const anonSuperDef = className ? compileClass(node.superTag) : "";
  const childResults = node.children.map((c) => emitNode(c, resolve, inheritsChildren, mGen, compileClass));
  let childDefs = childResults.map((r) => r.defs).join("");
  const childMaps = childResults.map((r) => r.map);
  const attrs = { ...node.attrs };
  if (node.datapath) {
    const dp = emitNode(node.datapath, resolve, inheritsChildren, mGen, compileClass);
    childDefs += dp.defs;
    const dpHasConstraint = node.datapath.lastMemberSrcLine !== void 0;
    const dpReset = COMPILE_DEBUG && dpHasConstraint ? pathOnlyReset(node.datapath.lastMemberSrcLine + 8) : "";
    attrs["$datapath"] = dp.map + dpReset;
    attrs["datapath"] = "LzNode._ignoreAttribute";
  }
  if (!("clickable" in attrs)) {
    const mouseAttr = Object.keys(attrs).some((k) => MOUSE_EVENTS.has(k));
    const mouseDelegate = [...node.delegateEvents].some((e) => MOUSE_EVENTS.has(e));
    if (attrs["cursor"] === "true" || mouseAttr || mouseDelegate)
      attrs["clickable"] = "true";
  }
  if (node.delegateList.length > 0)
    attrs["$delegates"] = "[" + node.delegateList.join(COMPILE_DEBUG ? ", " : ",") + "]";
  for (const s of node.slotNames)
    attrs[s] = "void 0";
  for (const s of node.attrSlots)
    if (!(s in attrs))
      attrs[s] = "void 0";
  if (node.isState) {
    for (const e of node.methodEntries) {
      const m = splitEntry(e);
      if (!m)
        throw new Unsupported(`state instance with declaration slot`);
      if (m.value === "void 0") {
        if (m.name in attrs)
          continue;
        throw new Unsupported(`state instance with declaration slot`);
      }
      attrs[m.name] = m.value;
    }
  }
  if (className) {
    const inherits = inheritsChildren(node.superTag);
    let childrenJs = null;
    if (childMaps.length > 0 || inherits) {
      const arr = "[" + childMaps.join(COMPILE_DEBUG ? ", " : ",") + "]";
      childrenJs = inherits ? `LzNode.mergeChildren(${arr}${COMPILE_DEBUG ? ", " : ","}${resolve(node.superTag)}["children"])` : arr;
    }
    const slotEntries = node.slotNames.filter((s) => !node.inlineSlots.includes(s)).map((s) => voidSlot(s));
    const crd = "$classrootdepth" in node.attrs ? [voidSlot("$classrootdepth")] : [];
    const dpSlot = node.datapath ? [voidSlot("$datapath")] : [];
    const instEntries = [...node.methodEntries, ...slotEntries, ...crd, ...dpSlot];
    const classDef = COMPILE_DEBUG ? emitAnonClassDebug(className, resolve(node.superTag), node.superTag, instEntries, childrenJs, node) : emitAnonClass(className, resolve(node.superTag), node.superTag, instEntries, childrenJs);
    const spec2 = { class: className };
    if (Object.keys(attrs).length > 0)
      spec2.attrs = emitObj(attrs);
    if (DEBUG_STMTS) {
      pushDebug(classDef);
      return { defs: "", map: emitObj(spec2) };
    }
    return { defs: anonSuperDef + childDefs + classDef, map: emitObject(spec2) };
  }
  const plainSuperDef = node.isInterface ? "" : compileClass(node.superTag);
  const spec = node.isInterface ? { tag: jsString(node.superTag) } : { class: resolve(node.superTag) };
  if (Object.keys(attrs).length > 0)
    spec.attrs = emitObj(attrs);
  if (COMPILE_DEBUG && Object.keys(attrs).length === 0) {
    const fb = node.children[0]?.idBinderSpec;
    if (fb)
      fb.funcLine = node.el?.endLine ?? node.el?.line ?? fb.funcLine;
  }
  if (childMaps.length > 0)
    spec.children = "[" + childMaps.join(COMPILE_DEBUG ? ", " : ",") + "]";
  if (DEBUG_STMTS)
    return { defs: "", map: emitObj(spec) };
  return { defs: childDefs + plainSuperDef, map: emitObject(spec) };
}
function idBinder(symbol, setId) {
  const s = jsString(symbol);
  const onBind = setId ? `$0.id=${s};${symbol}=$0` : `${symbol}=$0`;
  const onUnbind = setId ? `${symbol}=null;$0.id=null` : `${symbol}=null`;
  return `function($0,$1){
switch(arguments.length){
case 1:
$1=true;

};if($1){
${onBind}
}else if(${symbol}===$0){
${onUnbind}
}}`;
}
function idBinderBodySource(symbol, setId) {
  const q = jsString(symbol);
  return `#pragma "userFunctionName=bind #${symbol}"
if ($lzc$bind) {
  if ($debug) {
    if (${symbol} && (${symbol} !== $lzc$node)) {
      Debug.warn('Redefining #${symbol} from %w to %w', 
        ${symbol}, $lzc$node);
    }
  }
` + (setId ? `  $lzc$node.id = ${q};
` : ``) + `  ${symbol} = $lzc$node;
  if ($as3) { global[${q}] = $lzc$node; }
} else if (${symbol} === $lzc$node) {
  ${symbol} = null;
  if ($as3) { global[${q}] = null; }
` + (setId ? `  $lzc$node.id = null;
` : ``) + `}
`;
}
function idBinderDebug(symbol, setId, file, elemLine) {
  const userName = "bind #" + symbol;
  const body = idBinderBodySource(symbol, setId);
  return registerBinder({
    render: (f, n) => compileBinderDebug(userName, body, f, n),
    file,
    funcLine: elemLine
  });
}
function binderLineSpan(setId) {
  const body = idBinderBodySource("x", setId);
  const bodyNewlines = (body.match(/\n/g) || []).length;
  return bodyNewlines + 2;
}
function emitHandler(event, body, argsAttr, reference, methodAttr, mGen, methodEntries, delegateList, delegateEvents, srcEl, isAttr) {
  if (!event || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(event))
    throw new Unsupported(`<handler> needs a valid name`);
  if (reference === "")
    throw new Unsupported(`empty handler reference`);
  const hasBody = isAttr ? body != null : body != null && body.trim().length > 0;
  if (!hasBody && methodAttr == null)
    throw new Unsupported(`empty <handler> (declare the event instead)`);
  const file = srcEl ? debugFile(srcEl) : "";
  const isAttrHandler = !!(srcEl?.attrLines && event && srcEl.attrLines[event] != null);
  const hLine = srcEl?.endLine ?? srcEl?.line ?? 0;
  let referencename = null;
  if (reference != null) {
    referencename = mGen.next();
    const refBody = `return (${reference});`;
    methodEntries.push(COMPILE_DEBUG ? ent(referencename, compileFunctionDebug("get " + reference, [], refBody, [], file, hLine, hLine, false, "report", true, "get " + reference)) : `${jsString(referencename)},${compileFunction([], refBody)}`);
  } else {
    delegateEvents.add(event);
  }
  let method = methodAttr ?? null;
  const bLine = isAttrHandler ? hLine : srcEl ? bodyLineOf(srcEl) : hLine;
  if (hasBody) {
    if (method == null)
      method = mGen.next();
    const { names, defaults } = argsAttr === void 0 ? { names: ["$lzc$ignore"], defaults: [] } : parseArgs(argsAttr);
    if (COMPILE_DEBUG) {
      const dn = "handle " + (reference != null ? reference + "." : "") + event;
      const propagate = methodAttr == null ? dn : null;
      methodEntries.push(ent(method, compileFunctionDebug(dn, names, body, defaults, file, hLine, bLine, false, "report", true, propagate)));
    } else {
      methodEntries.push(`${jsString(method)},${compileFunction(names, body, defaults)}`);
    }
  }
  delegateList.push(jsString(event));
  delegateList.push(method != null ? jsString(method) : "null");
  delegateList.push(referencename != null ? jsString(referencename) : "null");
  if (hasBody)
    return { body: body + "\n#endContent\n", srcLine: bLine };
  if (reference != null)
    return { body: `return (${attrSrc(file, hLine, reference)});`, srcLine: hLine };
  return {};
}
function compileHandler(c, mGen, methodEntries, delegateList, delegateEvents) {
  const body = c.children.map((n) => n.type === "text" ? n.value : "").join("");
  return emitHandler(c.attrs["name"], body, c.attrs["args"], c.attrs["reference"], c.attrs["method"], mGen, methodEntries, delegateList, delegateEvents, c);
}
function bodyLineOf(c) {
  for (const n of c.children)
    if (n.type === "text")
      return n.line ?? c.line ?? 0;
  return c.line ?? 0;
}
function compileMethod(c) {
  const mn = c.attrs["name"];
  if (!mn)
    throw new Unsupported(`<method> without name`);
  const { names, defaults } = parseArgs(c.attrs["args"] || "");
  const body = c.children.map((n) => n.type === "text" ? n.value : "").join("");
  const isStatic = c.attrs["allocation"] === "class";
  if (COMPILE_DEBUG) {
    const startLine = c.endLine ?? c.line ?? 0;
    return ent(mn, compileFunctionDebug(mn, names, body, defaults, debugFile(c), startLine, startLine, false, "report", !isStatic));
  }
  return `${jsString(mn)},${compileFunction(names, body, defaults, !isStatic)}`;
}
var COMPILE_CONSTANTS = {
  $runtime: "dhtml",
  $swf7: false,
  $swf8: false,
  $as2: false,
  $swf9: false,
  $swf10: false,
  $as3: false,
  $dhtml: true,
  $j2me: false,
  $svg: false,
  $js1: true,
  $debug: false,
  $profile: false,
  $backtrace: false,
  // $canvas is a PER-BUILD constant (like $debug): the static value here is the
  // dhtml/default (false); evalSwitchCondition overrides it with COMPILE_CANVAS for a
  // `lzr=canvas` build. Canvas stays dhtml-family, so $runtime/$dhtml are unchanged.
  $canvas: false
};
function evalSwitchCondition(el) {
  const propname = el.attrs["property"];
  if (propname != null) {
    const prop = propname === "$debug" ? COMPILE_DEBUG : propname === "$canvas" ? COMPILE_CANVAS : COMPILE_CONSTANTS[propname];
    if (prop === void 0)
      return false;
    if (typeof prop === "boolean")
      return prop;
    const value = el.attrs["value"];
    return value != null ? prop === value : false;
  }
  if (el.attrs["runtime"] != null) {
    if (el.attrs["runtime"] === "canvas")
      return COMPILE_CANVAS;
    return COMPILE_CONSTANTS.$runtime === el.attrs["runtime"];
  }
  throw new Unsupported(`<${el.name}> requires a property or runtime attribute`);
}
function evaluateSwitch(el) {
  for (const c of el.children)
    if (c.type === "elem" && c.name !== "when" && c.name !== "unless" && c.name !== "otherwise")
      throw new Unsupported(`<switch> clause <${c.name}>`);
  let selected = null;
  for (const c of el.children)
    if (c.type === "elem" && c.name === "when" && evalSwitchCondition(c)) {
      selected = c;
      break;
    }
  for (const c of el.children)
    if (c.type === "elem" && c.name === "unless" && !evalSwitchCondition(c)) {
      selected = c;
      break;
    }
  if (!selected) {
    for (const c of el.children)
      if (c.type === "elem" && c.name === "otherwise") {
        selected = c;
        break;
      }
  }
  return selected ? selected.children.filter((n) => n.type === "elem") : [];
}
function expandIncludes(el, currentId, opts, seen, recordOrigins) {
  el.origin = currentId;
  recordOrigins?.add(currentId);
  if (!ORIGIN_RANK.has(currentId))
    ORIGIN_RANK.set(currentId, ORIGIN_RANK_NEXT++);
  const out = [];
  const processChild = (c) => {
    if (c.type === "elem" && c.name === "include") {
      const href = c.attrs["href"];
      if (!href)
        throw new Unsupported(`<include> without href`);
      if (c.attrs["type"] === "text") {
        const inc2 = opts.resolveInclude?.(href, currentId);
        if (!inc2)
          throw new Unsupported(`unresolved text include: ${href}`);
        out.push({ type: "text", value: inc2.source, cdata: false });
        return;
      }
      if (c.attrs["type"] != null && c.attrs["type"] !== "lzx")
        throw new Unsupported(`<include type="${c.attrs["type"]}">`);
      const inc = opts.resolveInclude?.(href, currentId);
      if (!inc)
        throw new Unsupported(`unresolved include: ${href}`);
      let incRoot;
      try {
        incRoot = parseXml(inc.source);
      } catch (e) {
        throw new Unsupported(`include ${href} parse: ${e.message}`);
      }
      if (incRoot.name === "library") {
        if (seen.has(inc.id))
          return;
        seen.add(inc.id);
        LIBRARY_ORIGINS.add(inc.id);
        expandIncludes(incRoot, inc.id, opts, seen, recordOrigins);
        for (const ic of incRoot.children)
          if (ic.type === "elem")
            out.push(ic);
      } else {
        if (!ORIGIN_RANK.has(inc.id))
          ORIGIN_RANK.set(inc.id, ORIGIN_RANK.get(currentId) ?? 0);
        expandIncludes(incRoot, inc.id, opts, seen, recordOrigins);
        out.push(incRoot);
      }
    } else if (c.type === "elem" && c.name === "switch") {
      for (const sel of evaluateSwitch(c))
        processChild(sel);
    } else {
      if (c.type === "elem")
        expandIncludes(c, currentId, opts, seen, recordOrigins);
      out.push(c);
    }
  };
  for (const c of el.children)
    processChild(c);
  el.children = out;
}
function collectLayoutRef(el, referenced) {
  const layoutAttr = el.attrs["layout"];
  if (layoutAttr !== void 0 && !/\$\{|\$once|\$path|\$style|^\s*\$/.test(layoutAttr)) {
    const m = /(?:^|;)\s*class\s*:\s*([A-Za-z_][\w-]*)/.exec(layoutAttr);
    referenced.add(m ? m[1] : "simplelayout");
  }
}
function collectTags(el, defined, referenced) {
  for (const c of el.children) {
    if (c.type !== "elem")
      continue;
    if (c.name === "class" || c.name === "interface" || c.name === "mixin") {
      const n = c.attrs["name"];
      if (n)
        defined.add(n);
      const sup = c.attrs["extends"];
      if (sup)
        referenced.add(sup);
    } else if (!isPropertyElement(c.name) && c.name !== "doc") {
      referenced.add(c.name);
    }
    collectLayoutRef(c, referenced);
    collectTags(c, defined, referenced);
  }
}
function expandAutoincludes(root, opts, _seen) {
  const auto = opts.autoincludes;
  if (!auto)
    return 0;
  const sourceId = opts.sourceId ?? "";
  const defined = /* @__PURE__ */ new Set();
  const referenced = /* @__PURE__ */ new Set();
  collectTags(root, defined, referenced);
  collectLayoutRef(root, referenced);
  const definedOrigin = /* @__PURE__ */ new Map();
  for (const c of root.children)
    if (c.type === "elem" && (c.name === "class" || c.name === "interface" || c.name === "mixin")) {
      const n = c.attrs["name"];
      if (n && !definedOrigin.has(n))
        definedOrigin.set(n, c.origin ?? void 0);
    }
  const libs = /* @__PURE__ */ new Map();
  for (const tag of referenced) {
    if (!auto[tag])
      continue;
    const inc = opts.resolveInclude?.(auto[tag], sourceId);
    if (!inc)
      continue;
    if (definedOrigin.has(tag) && definedOrigin.get(tag) !== inc.id)
      continue;
    libs.set(inc.id, inc);
  }
  const seen = /* @__PURE__ */ new Set();
  const prefix = [];
  for (const id of [...libs.keys()].sort()) {
    if (seen.has(id))
      continue;
    seen.add(id);
    const inc = libs.get(id);
    const libRoot = parseXml(inc.source);
    expandIncludes(libRoot, inc.id, opts, seen, AUTO_ORIGINS);
    for (const c of libRoot.children)
      if (c.type === "elem")
        prefix.push(c);
  }
  const canvasContent = root.children.filter((c) => !(c.type === "elem" && c.origin != null && seen.has(c.origin)));
  root.children = [...prefix, ...canvasContent];
  for (const id of seen)
    _seen.add(id);
  return prefix.length;
}
function spliceDebuggerLibrary(root, opts, seen, at) {
  const inc = opts.resolveInclude?.("debugger/library.lzx", opts.sourceId ?? "");
  if (!inc)
    throw new Unsupported(`debug build: cannot resolve debugger/library.lzx`);
  if (seen.has(inc.id))
    return;
  seen.add(inc.id);
  const libRoot = parseXml(inc.source);
  expandIncludes(libRoot, inc.id, opts, seen, AUTO_ORIGINS);
  const children = libRoot.children.filter((c) => c.type === "elem");
  root.children.splice(at, 0, ...children);
}
function compile(source, opts = {}) {
  return compileFromXml(parseXml(source), opts);
}
function compileFromXml(root, opts = {}) {
  if (root.name !== "canvas") {
    return { js: "", unsupported: `root is <${root.name}>, expected <canvas>` };
  }
  const isDebugBuild = root.attrs["debug"] === "true" || /(?:^|;)\s*debug\s*:\s*true\b/.test(root.attrs["compileroptions"] ?? "");
  const canvasDebugOff = root.attrs["debug"] === "false" || /(?:^|;)\s*debug\s*:\s*false\b/.test(root.attrs["compileroptions"] ?? "");
  const wantsBacktrace = opts.backtrace === true || /(?:^|;)\s*backtrace\s*:\s*true\b/.test(root.attrs["compileroptions"] ?? "");
  const debug = (opts.debug === true || isDebugBuild || wantsBacktrace) && !canvasDebugOff;
  const backtraceWanted = wantsBacktrace;
  const backtrace = backtraceWanted && debug;
  const profile = (opts.profile === true || /(?:^|;)\s*profile\s*:\s*true\b/.test(root.attrs["compileroptions"] ?? "") || root.attrs["profile"] === "true") && !debug;
  const routeDebug = debug || profile;
  try {
    setScDebug(debug);
    setScBacktrace(backtrace);
    setScProfile(profile);
    if (profile)
      setNoTrackLines(true);
    setDebugBacktrace(backtrace);
    setDebugProfile(profile);
    resetKnownClassnames();
    resetKnownIds();
    resetBinderTable();
    resetRegTable();
    COMPILE_DEBUG = routeDebug;
    COMPILE_BACKTRACE = backtrace;
    COMPILE_PROFILE = profile;
    COMPILE_CANVAS = opts.canvas === true;
    DEBUG_FILE = opts.debugFileName ?? ((id) => id);
    DEBUG_SOURCE_ID = opts.sourceId ?? "";
    SCRIPT_SRC = opts.resolveScriptSrc ?? null;
    DATASET_SRC = opts.resolveDatasetSrc ?? null;
    return compileInner(root, opts, routeDebug);
  } finally {
    setScDebug(false);
    setScBacktrace(false);
    setScProfile(false);
    setNoTrackLines(false);
    setDebugBacktrace(false);
    setDebugProfile(false);
    COMPILE_DEBUG = false;
    COMPILE_BACKTRACE = false;
    COMPILE_PROFILE = false;
    COMPILE_CANVAS = false;
    DEBUG_FILE = (id) => id;
    DEBUG_STMTS = null;
    SCRIPT_SRC = null;
    DATASET_SRC = null;
  }
}
var SCRIPT_SRC = null;
var DATASET_SRC = null;
var DEBUG_FILE = (id) => id;
var DEBUG_SOURCE_ID = "";
function debugFile(el) {
  return DEBUG_FILE(el.origin ?? DEBUG_SOURCE_ID);
}
function debugMergeAttributes(file, classLine, bodyLine, classNameJs, objSpaced, mergeLine, noteLine) {
  const A = (n) => annoFileLine(file, n);
  const GEN = annoFileLine(null, 0);
  const FB = forceBlankLnum();
  const bt = COMPILE_BACKTRACE;
  const M = noteLine ?? bodyLine;
  const N1 = mergeLine != null ? annoFileLine(file, 1) : "";
  const mergeCall = bt ? `${GEN}${N1}$3.lineno = ${M}, (${GEN}${N1}$3.lineno = ${M}, LzNode).mergeAttributes(${objSpaced}, ${classNameJs}.attributes)` : `LzNode.mergeAttributes(${objSpaced}, ${classNameJs}.attributes)`;
  const mergeDir = mergeLine != null ? A(mergeLine) : "";
  const withPart = `with ($0) with ($0.prototype) {
${GEN}{
${mergeDir}${mergeCall}
}}`;
  const btPrelude2 = bt ? `var $1 = Debug;
var $2 = $1.backtraceStack;
` : "";
  const btPrefix2 = bt ? `if ($2) {
var $3 = ["$lzsc$c", $0];
$3.callee = arguments.callee;
$3["this"] = this;
$3.filename = ${jsString(file)};
$3.lineno = ${bodyLine};
$2.push($3);
if ($2.length > $2.maxDepth) {
$1.stackOverflow()
}};
` : "";
  const catchBody = bt ? `if ((Error["$lzsc$isa"] ? Error.$lzsc$isa($lzsc$e) : $lzsc$e instanceof Error) && $lzsc$e !== lz["$lzsc$thrownError"]) {
$reportException(${jsString(file)}, $3.lineno, $lzsc$e)
} else {
throw $lzsc$e
}` : debugCatchBody2(file, bodyLine);
  const btFinally = bt ? `
${GEN}finally {
if ($2) {
$2.length--
}}` : "";
  let funcBlock;
  if (COMPILE_PROFILE) {
    const meterGet = 'arguments.callee["displayName"]';
    const profTry = `try {
${meterEvent("$1", "$2", "$3", meterGet, "calls")};
${A(bodyLine)}${withPart}}
${GEN}finally {
${meterEvent("$1", "$2", "$3", meterGet, "returns")}}`;
    funcBlock = `{
${GEN}${profTry}}`;
  } else {
    const tryWrap = `try {
${btPrefix2}${A(bodyLine)}${withPart}}
${GEN}catch ($lzsc$e) {
${catchBody}}${btFinally}`;
    funcBlock = `{
${GEN}${btPrelude2}${tryWrap}}`;
  }
  const innerFn = `function ($0) ${funcBlock}${FB}`;
  const S1 = `var $lzsc$temp = ${innerFn};`;
  const S2 = `${A(bodyLine)}$lzsc$temp["displayName"] = ${jsString(file + "#" + bodyLine + "/1")};`;
  const S2bt = bt ? `
${A(bodyLine)}$lzsc$temp["_dbg_filename"] = ${jsString(file)};
${A(bodyLine)}$lzsc$temp["_dbg_lineno"] = ${bodyLine};` : "";
  const S3 = `${A(bodyLine)}return $lzsc$temp`;
  const iife = `(function () {
${S1}
${S2}${S2bt}
${S3}
}${FB})()`;
  return `${A(classLine)}${iife}(${classNameJs})`;
}
function debugCatchBody2(file, line) {
  return 'if ((Error["$lzsc$isa"] ? Error.$lzsc$isa($lzsc$e) : $lzsc$e instanceof Error) && $lzsc$e !== lz["$lzsc$thrownError"]) {\n$reportException(' + jsString(file) + ", " + line + ", $lzsc$e)\n} else {\nthrow $lzsc$e\n}";
}
var COMPILE_DEBUG = false;
var COMPILE_BACKTRACE = false;
var COMPILE_PROFILE = false;
var COMPILE_CANVAS = false;
var DEBUG_STMTS = null;
function pushDebug(stmt) {
  if (DEBUG_STMTS)
    DEBUG_STMTS.push(stmt);
}
function instanceTrailingFile(built, file) {
  const patternA = (built?.subtreeHasLiteralAttr ?? false) && !(built?.subtreeHasScriptOrContent ?? false) && !(built?.topLevelHasIdOrName ?? false);
  return patternA ? "" : file;
}
var AUTO_ORIGINS = /* @__PURE__ */ new Set();
var LIBRARY_ORIGINS = /* @__PURE__ */ new Set();
var ORIGIN_RANK = /* @__PURE__ */ new Map();
var ORIGIN_RANK_NEXT = 0;
function orderGlobals(globals, origins, sourceId) {
  const cat = (o) => AUTO_ORIGINS.has(o) ? 0 : LIBRARY_ORIGINS.has(o) ? 2 : 1;
  const rank = (o) => ORIGIN_RANK.get(o) ?? 0;
  return globals.map((g, i) => ({ g, c: cat(origins[i] ?? ""), r: rank(origins[i] ?? ""), i })).sort((a, b) => a.c - b.c || a.r - b.r || a.i - b.i).map((e) => e.g);
}
function compileInner(root, opts, debug) {
  try {
    const seenIncludes = /* @__PURE__ */ new Set();
    AUTO_ORIGINS = /* @__PURE__ */ new Set();
    LIBRARY_ORIGINS = /* @__PURE__ */ new Set();
    ORIGIN_RANK = /* @__PURE__ */ new Map();
    ORIGIN_RANK_NEXT = 0;
    expandIncludes(root, opts.sourceId ?? "", opts, seenIncludes);
    const prefixLen = expandAutoincludes(root, opts, seenIncludes);
    if (debug && !COMPILE_PROFILE)
      spliceDebuggerLibrary(root, opts, seenIncludes, prefixLen);
    const cattrs = {};
    const defs = canvasDefaults(opts.proxied);
    for (const k of Object.keys(defs))
      cattrs[k] = emitTyped(defs[k]);
    cattrs["appbuilddate"] = emitTyped({ kind: "string", v: NORMALIZED_APPBUILDDATE });
    for (const [k, v] of Object.entries(BUILD_CONSTANTS))
      cattrs[k] = emitTyped({ kind: "string", v });
    const classes = /* @__PURE__ */ new Map();
    const interfaces = /* @__PURE__ */ new Set();
    for (const child of root.children) {
      if (child.type === "elem" && (child.name === "class" || child.name === "interface")) {
        const name = child.attrs["name"];
        if (!name)
          throw new Unsupported(`<${child.name}> without name`);
        classes.set(name, { name, superTag: child.attrs["extends"] || "view", el: child });
        if (child.name === "interface")
          interfaces.add(name);
      }
    }
    const resolve = (tag) => {
      if (classes.has(tag))
        return classJsName(tag);
      const b = LFC_TAG_CLASS[tag];
      if (b)
        return b;
      throw new Unsupported(`unknown tag <${tag}>`);
    };
    const declaredType = (className, attr) => {
      const def = classes.get(className);
      if (!def)
        return void 0;
      for (const c of def.el.children) {
        if (c.type === "elem" && c.name === "attribute" && c.attrs["name"] === attr)
          return c.attrs["type"] != null ? aliasType(c.attrs["type"]) : null;
      }
      return void 0;
    };
    const inheritedWhen = (className, attr) => {
      let cur = className;
      while (cur && classes.has(cur)) {
        for (const c of classes.get(cur).el.children) {
          if (c.type === "elem" && c.name === "attribute" && c.attrs["name"] === attr && c.attrs["when"] != null)
            return c.attrs["when"];
        }
        cur = classes.get(cur).superTag;
      }
      return void 0;
    };
    const schemaTypeOf = (tag, attr) => {
      let cur = tag;
      let sawUntyped = false;
      while (cur && classes.has(cur)) {
        const t = declaredType(cur, attr);
        if (t === null)
          sawUntyped = true;
        else if (t !== void 0)
          return t;
        cur = classes.get(cur).superTag;
      }
      const builtin = cur ? schemaAttrType(cur, attr) : null;
      if (builtin != null)
        return builtin;
      return sawUntyped ? "expression" : null;
    };
    const resolveConstraintType = (tag, attr, parentTag) => {
      const t = schemaTypeOf(tag, attr);
      if (t != null)
        return t;
      if (parentTag && isStateClass(tag)) {
        const pt = schemaTypeOf(parentTag, attr);
        if (pt != null)
          return pt;
      }
      return "expression";
    };
    const valueTypeOf = (tag, attr) => {
      const t = schemaTypeOf(tag, attr);
      return t ? mapType(t) : attrType(tag, attr);
    };
    const declaresMemberHere = (className, name) => {
      const def = classes.get(className);
      if (!def)
        return false;
      for (const c of def.el.children) {
        if (c.type === "elem" && (c.name === "attribute" || c.name === "event") && c.attrs["name"] === name)
          return true;
      }
      return false;
    };
    const isInherited = (superTag, attr) => {
      let cur = superTag;
      while (cur && classes.has(cur)) {
        if (declaresMemberHere(cur, attr))
          return true;
        cur = classes.get(cur).superTag;
      }
      return cur != null && (schemaAttrType(cur, attr) != null || schemaHasEvent(cur, attr));
    };
    const isStateClass = (tag) => {
      let cur = tag;
      const seen = /* @__PURE__ */ new Set();
      while (cur && !seen.has(cur)) {
        if (cur === "state")
          return true;
        seen.add(cur);
        const def = classes.get(cur);
        if (!def)
          return false;
        cur = def.superTag;
      }
      return false;
    };
    const isInputTextTag = (tag) => {
      let cur = tag;
      const seen = /* @__PURE__ */ new Set();
      while (cur && !seen.has(cur)) {
        if (cur === "inputtext")
          return true;
        seen.add(cur);
        const def = classes.get(cur);
        if (!def)
          return false;
        cur = def.superTag;
      }
      return false;
    };
    const hasTextContent = (tag) => schemaTypeOf(tag, "text") != null;
    for (const name of root.attrOrder) {
      if (name === "debug")
        continue;
      if (isEventAttr(name))
        continue;
      cattrs[name] = compileAttr("canvas", name, root.attrs[name], true, valueTypeOf);
    }
    const childCountMemo = /* @__PURE__ */ new Map();
    const classDefChildCount = (tag) => {
      if (childCountMemo.has(tag))
        return childCountMemo.get(tag);
      if (interfaces.has(tag))
        return 0;
      const def = classes.get(tag);
      if (!def)
        return 0;
      childCountMemo.set(tag, 0);
      let n = classDefChildCount(def.superTag);
      n += childViews(def.el).length;
      childCountMemo.set(tag, n);
      return n;
    };
    const inheritsMemo = /* @__PURE__ */ new Map();
    const inheritsChildren = (tag) => {
      if (inheritsMemo.has(tag))
        return inheritsMemo.get(tag);
      if (!classes.has(tag))
        return false;
      inheritsMemo.set(tag, true);
      const def = classes.get(tag);
      const r = interfaces.has(tag) || childViews(def.el).length > 0 || inheritsChildren(def.superTag);
      inheritsMemo.set(tag, r);
      return r;
    };
    const storedCount = /* @__PURE__ */ new Map();
    const effectiveInitstage = (el) => {
      const own = el.attrs["initstage"];
      if (own != null)
        return own;
      let cur = el.name;
      while (cur && classes.has(cur) && storedCount.has(cur)) {
        const cdef = classes.get(cur);
        const ci = cdef.el.attrs["initstage"];
        if (ci != null)
          return ci;
        cur = cdef.superTag;
      }
      return void 0;
    };
    const instanceContribution = (el) => {
      if (isStateClass(el.name))
        return 1;
      const initstage = effectiveInitstage(el);
      if (initstage === "late" || initstage === "defer")
        return 0;
      let n = classes.has(el.name) && storedCount.has(el.name) ? storedCount.get(el.name) : 1;
      if (isLiteralDatasetEl(el))
        return n;
      for (const c of childViews(el))
        n += instanceContribution(c);
      return n;
    };
    const classStoredCount = (def) => {
      let n = classes.has(def.superTag) ? storedCount.get(def.superTag) ?? 1 : 1;
      for (const c of childViews(def.el))
        n += instanceContribution(c);
      return n;
    };
    const mGen = new SymbolGenerator("$m");
    const globals = [];
    const globalOrigins = [];
    const lzGen = new SymbolGenerator("$LZ");
    const preamble = [];
    let hasResource = false;
    const declaredResources = /* @__PURE__ */ new Set();
    const emittedResources = /* @__PURE__ */ new Set();
    const anonResEntries = [];
    const fontEntries = [];
    let spriteOffset = 0;
    const registerResource = (ref, originId) => {
      if (declaredResources.has(ref))
        return ref;
      const info = opts.resolveResource?.(ref, originId);
      if (!info)
        throw new Unsupported(`unresolved resource: ${ref}`);
      const name = lzGen.next();
      hasResource = true;
      anonResEntries.push({
        height: Math.round(info.height),
        render: (off) => `LzResourceLibrary.${name}={ptype:${jsString(info.ptype)},frames:['${info.relPath}'],width:${javaDouble(info.width)},height:${javaDouble(info.height)}` + // "none" mode drops ALL sprite machinery — incl. the (master-sprite-inert)
        // spriteoffset on single-frame anon resources — so the JS references nothing
        // sprite-related and is a TOTAL reduction of the oracle output.
        (opts.sprites === "none" ? "" : `,spriteoffset:${off}`) + `};`
      });
      return name;
    };
    const registerNamedResource = (el) => {
      const name = el.attrs["name"];
      if (!name)
        throw new Unsupported(`<resource> without name`);
      if (emittedResources.has(name))
        return;
      const frameRefs = [];
      for (const c of el.children) {
        if (c.type === "text") {
          if (c.value.trim())
            throw new Unsupported(`text in <resource>`);
          continue;
        }
        if (c.name === "frame") {
          const src = c.attrs["src"];
          if (!src)
            throw new Unsupported(`<frame> without src`);
          frameRefs.push(src);
        } else
          throw new Unsupported(`<${c.name}> in <resource>`);
      }
      const hadFrameChildren = frameRefs.length > 0;
      const srcAttr = el.attrs["src"];
      const enumerated = srcAttr && frameRefs.length === 0 ? opts.resolveResourceFrames?.(srcAttr, el.origin) : null;
      let infos;
      if (enumerated) {
        infos = enumerated;
      } else {
        if (srcAttr)
          frameRefs.unshift(srcAttr);
        if (frameRefs.length === 0)
          throw new Unsupported(`<resource> without frames`);
        infos = frameRefs.map((r) => {
          const i = opts.resolveResource?.(r, el.origin);
          if (!i)
            throw new Unsupported(`unresolved resource: ${r}`);
          return i;
        });
      }
      const GIF_SCALE = 65470 / 65536;
      const cell = (i, dim) => {
        if (!/\.gif$/i.test(i.relPath))
          return dim;
        return infos.length > 1 ? Math.floor(dim * GIF_SCALE) : Math.round(Math.floor(dim * 20 * GIF_SCALE) / 20);
      };
      const w = Math.max(...infos.map((i) => cell(i, i.width)));
      const h = Math.max(...infos.map((i) => cell(i, i.height)));
      const frames = infos.map((i) => `'${i.relPath}'`).join(",");
      const noSprite = hadFrameChildren && !enumerated && infos.length === 1;
      const allGif = infos.length > 1 && infos.every((i) => /\.gif$/i.test(i.relPath));
      const isDir = !!(enumerated && srcAttr && srcAttr.endsWith("/"));
      const unscaledAdvance = allGif || isDir;
      const noSheets = opts.sprites === "none";
      const spriteKey = noSheets || infos.length <= 1 ? "" : isDir ? `,sprite:'${infos[0].relPath.slice(0, infos[0].relPath.lastIndexOf("/") + 1)}'` : `,sprite:'${infos[0].relPath.replace(/\.[^./]+$/, "")}.sprite.png'`;
      const offsetKey = noSprite || noSheets ? "" : `,spriteoffset:${spriteOffset}`;
      declaredResources.add(name);
      emittedResources.add(name);
      hasResource = true;
      preamble.push(`LzResourceLibrary.${name}={ptype:${jsString(infos[0].ptype)},frames:[${frames}],width:${javaDouble(w)},height:${javaDouble(h)}${spriteKey}${offsetKey}};`);
      const advanceH = unscaledAdvance ? Math.max(...infos.map((i) => i.height)) : h;
      if (!noSprite)
        spriteOffset += Math.round(advanceH);
    };
    const compileFontTag = (el) => {
      const fontOrigin = el.origin ?? "";
      const name = el.attrs["name"];
      if (!name)
        throw new Unsupported(`<font> without name`);
      if (el.attrs["device"] === "true")
        throw new Unsupported(`device <font>`);
      const emitFace = (face) => {
        const src = face.attrs["src"];
        if (!src)
          return;
        const info = opts.resolveFont?.(src);
        if (!info)
          throw new Unsupported(`unresolved font: ${src}`);
        let style = face.attrs["style"] || "";
        if (style === "")
          style = "plain";
        let weight = "normal";
        if (style === "plain") {
          weight = "normal";
          style = "normal";
        } else if (style === "bold") {
          weight = "bold";
          style = "normal";
        } else if (style === "italic") {
          weight = "normal";
          style = "italic";
        } else if (style === "bold italic" || style === "bolditalic") {
          weight = "bold";
          style = "italic";
        }
        fontEntries.push({ line: `LzFontManager.addFont('${name}','${style}','${weight}','${info.relPath}','${info.ptype}');`, origin: fontOrigin });
      };
      if (el.attrs["src"])
        emitFace(el);
      for (const c of el.children) {
        if (c.type === "text") {
          if (c.value.trim())
            throw new Unsupported(`text in <font>`);
          continue;
        }
        if (c.name === "face")
          emitFace(c);
        else
          throw new Unsupported(`<${c.name}> in <font>`);
      }
    };
    const ctx = { resolve, resolveConstraintType, valueTypeOf, isInherited, mGen, globals, globalOrigins, registerResource, isStateClass, inheritedWhen, hasTextContent, isInputTextTag, classes, interfaces };
    const registrations = [];
    let lastTopFile = debugFile(root);
    let lastTopInstance;
    let lastTopWasInstance = false;
    let crossUnitFile = "debugger/debugger.lzx";
    let debugAnonClassPending = false;
    let debugWindowScript = "";
    const compiled = /* @__PURE__ */ new Set();
    const compileClass = (name) => {
      if (!classes.has(name))
        return "";
      if (interfaces.has(name))
        return "";
      if (compiled.has(name))
        return "";
      compiled.add(name);
      const def = classes.get(name);
      const superDef = compileClass(def.superTag);
      return superDef + emitClassDef(def);
    };
    const emitClassDef = (def) => {
      const child = def.el;
      const superJs = resolve(def.superTag);
      storedCount.set(def.name, classStoredCount(def));
      const instEntries = [];
      let lastMemberClose = -1;
      let lastMemberHandler = false;
      let lastMemberConBody;
      let lastMemberConSrcLine;
      let placementAttrSrcLine;
      let lastStaticMethodClose;
      const noteMember = (el, handler) => {
        lastMemberConBody = void 0;
        lastMemberClose = el.closeLine ?? el.endLine ?? el.line ?? lastMemberClose;
        lastMemberHandler = handler;
      };
      const classAllocEntries = [];
      const delegateList = [];
      const delegateEvents = /* @__PURE__ */ new Set();
      const defaultAttrs = {};
      for (const an of child.attrOrder) {
        if (an === "name" || an === "extends")
          continue;
        const raw = child.attrs[an];
        let con = parseConstraint(raw) && { ...parseConstraint(raw), literal: false } || null;
        let pctType = null;
        if (!con && raw.trim().endsWith("%")) {
          try {
            pctType = resolveConstraintType(def.name, an);
          } catch {
            pctType = null;
          }
          const pexpr = percentConstraintExpr(pctType, an, raw);
          if (pexpr)
            con = { when: "", expr: pexpr, literal: false };
        }
        if (!con && !isEventAttr(an)) {
          const iw = inheritedWhen(def.name, an);
          if (iw === "once" || iw === "always")
            con = attrConstraint(raw, iw);
        }
        if (isEventAttr(an)) {
          emitHandler(an, raw, void 0, void 0, void 0, mGen, instEntries, delegateList, delegateEvents, child, true);
          lastMemberConBody = void 0;
          lastMemberClose = child.endLine ?? child.closeLine ?? child.attrLines?.[an] ?? lastMemberClose;
          lastMemberHandler = true;
        } else if (con && con.when === "immediately") {
          defaultAttrs[an] = compileExpr(con.expr);
        } else if (con && con.when === "style") {
          defaultAttrs[an] = btNoteConstraintInit(styleConstraintExpr(an, resolveConstraintType(def.name, an), con.expr), child.endLine ?? child.line ?? 0, debugFile(child));
        } else if (con) {
          if (con.when !== "" && con.when !== "once" && con.when !== "path")
            throw new Unsupported(`$${con.when}{} constraint`);
          const declared = pctType ?? resolveConstraintType(def.name, an);
          const setterExpr = con.literal && declared === "color" ? `LzColorUtils.convertColor(${jsString(con.expr)})` : con.expr;
          const c = COMPILE_DEBUG ? compileConstraintDebug(an, declared, setterExpr, con.when, mGen, debugFile(child), child.endLine ?? child.line ?? 0) : compileConstraint(an, declared, setterExpr, con.when, mGen);
          instEntries.push(...c.entries);
          defaultAttrs[an] = btNoteConstraintInit(c.initExpr, child.endLine ?? child.line ?? 0, debugFile(child));
          if (COMPILE_DEBUG && "lastBody" in c) {
            noteMember(child, false);
            lastMemberConBody = c.lastBody;
            lastMemberConSrcLine = c.lastSrcLine;
          }
        } else if (valueTypeOf(def.name, an) === "color") {
          const cv = colorValue(an, raw, resolveConstraintType(def.name, an), mGen, debugFile(child), child.endLine ?? child.line ?? 0);
          if ("plain" in cv)
            defaultAttrs[an] = btNoteColorInit(cv.plain, child.endLine ?? child.line ?? 0);
          else {
            instEntries.push(...cv.entries);
            defaultAttrs[an] = btNoteConstraintInit(cv.init, child.endLine ?? child.line ?? 0, debugFile(child));
            if (COMPILE_DEBUG && cv.cc.lastBody !== void 0) {
              noteMember(child, false);
              lastMemberConBody = cv.cc.lastBody;
              lastMemberConSrcLine = cv.cc.lastSrcLine;
            }
          }
        } else {
          defaultAttrs[an] = compileAttr(def.name, an, raw, false, valueTypeOf);
        }
      }
      const childNodes = [];
      let classDatapath;
      for (const c of child.children) {
        if (c.type === "text")
          continue;
        if (c.name === "doc")
          continue;
        if (c.name === "handler") {
          compileHandler(c, mGen, instEntries, delegateList, delegateEvents);
          noteMember(c, true);
          continue;
        }
        if (c.name === "attribute") {
          const an = c.attrs["name"];
          if (!an)
            throw new Unsupported(`<attribute> without name`);
          if (an === "defaultplacement")
            placementAttrSrcLine = c.line ?? c.endLine ?? placementAttrSrcLine;
          const raw = "value" in c.attrs ? c.attrs["value"] : null;
          if (c.attrs["allocation"] === "class") {
            if (c.attrs["setter"] != null || c.attrs["when"] != null || raw != null && parseConstraint(raw))
              throw new Unsupported(`allocation="class" with setter/constraint`);
            const allocType = c.attrs["type"] ? mapType(c.attrs["type"]) : mapType("expression");
            const value = raw == null ? "void 0" : COMPILE_DEBUG && (allocType === "expression" || allocType === "boolean" || allocType === "number") ? compileExprDebug(raw) : compileTypedValue(allocType, raw, false);
            classAllocEntries.push(COMPILE_DEBUG ? ent(an, value) : `${jsString(an)},${value}`);
            continue;
          }
          let con = attrConstraint(raw, c.attrs["when"]);
          if (!con && raw != null && c.attrs["style"] == null && c.attrs["setter"] == null && !isEventAttr(an)) {
            const iw = inheritedWhen(def.name, an);
            if (iw === "once" || iw === "always")
              con = attrConstraint(raw, iw);
          }
          const slot = isInherited(def.superTag, an) ? [] : [voidSlot(an)];
          const setLine = c.endLine ?? c.line ?? 0;
          const setterEntry = c.attrs["setter"] != null ? [COMPILE_DEBUG ? ent("$lzc$set_" + an, compileFunctionDebug("set " + an, [an], c.attrs["setter"], [], debugFile(c), setLine, setLine + 1, false, "report", true, "set " + an)) : `${jsString("$lzc$set_" + an)},${compileFunction([an], c.attrs["setter"])}`] : [];
          if (c.attrs["style"] != null) {
            const declared = c.attrs["type"] != null ? aliasType(c.attrs["type"]) : resolveConstraintType(def.name, an);
            instEntries.push(...slot, ...setterEntry);
            if (c.attrs["setter"] != null)
              noteMember(c, false);
            const fb = raw != null ? compileTypedValue(c.attrs["type"] ? mapType(c.attrs["type"]) : valueTypeOf(def.name, an), raw, false) : void 0;
            defaultAttrs[an] = btNoteConstraintInit(styleConstraintExpr(an, declared, jsString(c.attrs["style"]), fb), c.endLine ?? c.line ?? 0, debugFile(c));
          } else if (con && con.when === "immediately") {
            instEntries.push(...slot, ...setterEntry);
            if (c.attrs["setter"] != null)
              noteMember(c, false);
            defaultAttrs[an] = compileExpr(con.expr);
          } else if (con) {
            if (con.when !== "" && con.when !== "once" && con.when !== "path")
              throw new Unsupported(`$${con.when}{} constraint`);
            const declared = c.attrs["type"] != null ? aliasType(c.attrs["type"]) : resolveConstraintType(def.name, an);
            const litType = con.literal ? c.attrs["type"] ? mapType(c.attrs["type"]) : valueTypeOf(def.name, an) : null;
            const setterExpr = litType === "color" ? `LzColorUtils.convertColor(${jsString(con.expr)})` : con.expr;
            const cc = COMPILE_DEBUG ? compileConstraintDebug(an, declared, setterExpr, con.when, mGen, debugFile(c), c.endLine ?? c.line ?? 0) : compileConstraint(an, declared, setterExpr, con.when, mGen);
            instEntries.push(...cc.entries, ...slot, ...setterEntry);
            defaultAttrs[an] = btNoteConstraintInit(cc.initExpr, c.endLine ?? c.line ?? 0, debugFile(c));
            noteMember(c, false);
            lastMemberConBody = cc.lastBody;
            lastMemberConSrcLine = cc.lastSrcLine;
          } else {
            instEntries.push(...slot, ...setterEntry);
            if (c.attrs["setter"] != null)
              noteMember(c, false);
            if (raw != null) {
              const declared = c.attrs["type"] ? mapType(c.attrs["type"]) : valueTypeOf(def.name, an);
              defaultAttrs[an] = compileTypedValue(declared, raw, false);
            }
          }
        } else if (c.name === "method") {
          if (c.attrs["allocation"] === "class") {
            classAllocEntries.push(compileMethod(c));
            lastStaticMethodClose = c.closeLine ?? c.endLine ?? c.line ?? lastStaticMethodClose;
          } else {
            instEntries.push(compileMethod(c));
            noteMember(c, false);
          }
        } else if (c.name === "event") {
          const en = c.attrs["name"];
          if (!en)
            throw new Unsupported(`<event> without name`);
          if (!isInherited(def.superTag, en))
            instEntries.push(voidSlot(en));
          defaultAttrs[en] = COMPILE_BACKTRACE ? `(${annoFileLine(null, 0)}$3.lineno = ${c.line ?? 0}, LzDeclaredEvent)` : "LzDeclaredEvent";
        } else if (c.name === "setter") {
          const sn = c.attrs["name"];
          if (!sn)
            throw new Unsupported(`<setter> without name`);
          const { names, defaults } = parseArgs(c.attrs["args"] || "");
          const body = c.children.map((n) => n.type === "text" ? n.value : "").join("");
          instEntries.push(COMPILE_DEBUG ? ent("$lzc$set_" + sn, compileFunctionDebug("set " + sn, names, body, defaults, debugFile(c), c.line ?? 0, bodyLineOf(c), false, "report", true, "set " + sn)) : `${jsString("$lzc$set_" + sn)},${compileFunction(names, body, defaults)}`);
          noteMember(c, false);
        } else if (c.name === "datapath") {
          if (classDatapath)
            throw new Unsupported(`multiple <datapath> children`);
          classDatapath = buildNode(c, ctx, false, null, def.name);
          if (classDatapath.datapath)
            throw new Unsupported(`nested <datapath>`);
          if (classDatapath.methodEntries.some((e) => !isVoidSlot(e)))
            classDatapath.isState = true;
        } else if (isPropertyElement(c.name)) {
        } else {
          if (c.attrs["name"] != null && !isInherited(def.superTag, c.attrs["name"]))
            instEntries.push(voidSlot(c.attrs["name"]));
          childNodes.push(buildNode(c, ctx, false, isStateClass(def.name) ? 0 : 1, def.name));
        }
      }
      if (!isStateClass(def.name)) {
        for (const c of childViews(child)) {
          if (!isStateClass(c.name))
            continue;
          for (const h of collectNamedChildren(childViews(c), c.name, ctx))
            if (!instEntries.includes(voidSlot(h)) && !(h in defaultAttrs))
              instEntries.push(voidSlot(h));
        }
      }
      if (!("clickable" in defaultAttrs)) {
        const mouseAttr = Object.keys(defaultAttrs).some((k) => MOUSE_EVENTS.has(k));
        const mouseDelegate = [...delegateEvents].some((e) => MOUSE_EVENTS.has(e));
        if (defaultAttrs["cursor"] === "true" || mouseAttr || mouseDelegate)
          defaultAttrs["clickable"] = "true";
      }
      if (delegateList.length > 0)
        defaultAttrs["$delegates"] = "[" + delegateList.join(COMPILE_DEBUG ? ", " : ",") + "]";
      const childResults = childNodes.map((n) => emitNode(n, resolve, inheritsChildren, mGen, compileClass));
      let childDefs = childResults.map((r) => r.defs).join("");
      const childMaps = childResults.map((r) => r.map);
      if (classDatapath) {
        const dp = emitNode(classDatapath, resolve, inheritsChildren, mGen, compileClass);
        childDefs += dp.defs;
        defaultAttrs["$datapath"] = dp.map;
        defaultAttrs["datapath"] = "LzNode._ignoreAttribute";
      }
      const inherits = inheritsChildren(def.superTag);
      let defaultPlacementTarget;
      if ("defaultplacement" in defaultAttrs && (childMaps.length > 0 || inherits)) {
        defaultPlacementTarget = defaultAttrs["defaultplacement"];
        childMaps.push(emitObj({ attrs: defaultAttrs["defaultplacement"], class: "$lzc$class_userClassPlacement" }));
        delete defaultAttrs["defaultplacement"];
      }
      let childrenJs = null;
      if (childMaps.length > 0 || inherits) {
        const arr = "[" + childMaps.join(COMPILE_DEBUG ? ", " : ",") + "]";
        childrenJs = inherits ? `LzNode.mergeChildren(${arr}${COMPILE_DEBUG ? ", " : ","}${superJs}["children"])` : arr;
      }
      const emitEntries = isStateClass(def.name) ? routeStateMethods(instEntries, defaultAttrs) : instEntries;
      let dbg;
      if (COMPILE_DEBUG) {
        const classLine = (child.endLine ?? child.line ?? 0) - 1;
        const stateClass = isStateClass(def.name);
        const lastOwnChild = childNodes.length ? childNodes[childNodes.length - 1] : void 0;
        let stateChildRich = false;
        if (stateClass && lastOwnChild !== void 0) {
          for (const cn of childNodes)
            if (cn.subtreeLastLiteralLine != null) {
              stateChildRich = true;
              break;
            }
        }
        const childOnlyRich = !stateClass && lastMemberClose < 0 && lastOwnChild !== void 0;
        let childOnlyNoLiteral = false;
        if (childOnlyRich && defaultPlacementTarget === void 0) {
          childOnlyNoLiteral = true;
          for (const cn of childNodes)
            if (cn.subtreeLastLiteralLine != null) {
              childOnlyNoLiteral = false;
              break;
            }
        }
        const staticMethodRich = !stateClass && lastMemberClose < 0 && lastOwnChild === void 0 && lastStaticMethodClose !== void 0;
        const memberRich = stateClass ? stateChildRich : (lastMemberClose >= 0 || childOnlyRich || staticMethodRich) && !childOnlyNoLiteral;
        let ctorLine;
        if (stateChildRich) {
          const voidSlotDecls = emitEntries.filter(isVoidSlot).length;
          let lastLit;
          for (const cn of childNodes)
            if (cn.subtreeLastLiteralLine != null)
              lastLit = cn.subtreeLastLiteralLine;
          const anchor = lastLit ?? lastOwnChild.el?.closeLine ?? lastOwnChild.el?.endLine ?? classLine;
          ctorLine = anchor + 4 + voidSlotDecls;
        } else if (stateClass) {
          const ndecls = emitEntries.length;
          const extraStatic = (childrenJs ? 1 : 0) + classAllocEntries.length;
          ctorLine = classLine + 4 + ndecls + extraStatic;
        } else {
          let trailingVoidSlots = 0;
          for (let k = emitEntries.length - 1; k >= 0 && isVoidSlot(emitEntries[k]); k--)
            trailingVoidSlots++;
          const extraStatic = (childrenJs ? 1 : 0) + classAllocEntries.length;
          if (childOnlyRich && !childOnlyNoLiteral) {
            const voidSlotDecls = emitEntries.filter(isVoidSlot).length;
            const placementAttrLine = defaultPlacementTarget !== void 0 ? placementAttrSrcLine : void 0;
            if (placementAttrLine != null) {
              ctorLine = placementAttrLine + 4 + voidSlotDecls;
            } else if (defaultPlacementTarget !== void 0) {
              ctorLine = classLine + 1 + 4 + voidSlotDecls;
            } else {
              let lastLit;
              for (const cn of childNodes)
                if (cn.subtreeLastLiteralLine != null)
                  lastLit = cn.subtreeLastLiteralLine;
              const anchor = lastLit ?? lastOwnChild.el?.closeLine ?? lastOwnChild.el?.endLine ?? classLine;
              ctorLine = anchor + 4 + voidSlotDecls;
            }
          } else if (staticMethodRich) {
            ctorLine = lastStaticMethodClose + 7;
          } else if (memberRich && lastMemberConBody !== void 0) {
            const finalLine = finalSourceLine(srcDirective(debugFile(child), lastMemberConSrcLine) + lastMemberConBody + END_SRC_DIRECTIVE + "\n}");
            ctorLine = finalLine + 1 + trailingVoidSlots;
          } else {
            const voidSlotDecls = emitEntries.filter(isVoidSlot).length;
            ctorLine = memberRich ? lastMemberClose + (lastMemberHandler ? 6 : 5) + trailingVoidSlots : classLine + 4 + extraStatic + voidSlotDecls;
          }
        }
        dbg = { file: debugFile(child), classLine, bodyLine: child.endLine ?? child.line ?? 0, ctorLine, memberRich };
      }
      const out = childDefs + emitClassBlock(def.name, superJs, emitEntries, defaultAttrs, childrenJs, classAllocEntries, classDatapath != null, dbg);
      registrations.push(`lz[${jsString(def.name)}]=${classJsName(def.name)};`);
      if (DEBUG_STMTS) {
        lastTopFile = debugFile(child);
        lastTopWasInstance = false;
        crossUnitFile = debugFile(child);
        pushDebug(out);
        return "";
      }
      return out;
    };
    const CANVAS_MEMBER_TAGS = /* @__PURE__ */ new Set(["method", "handler", "attribute", "event", "setter"]);
    const memberEls = root.children.filter((c) => c.type === "elem" && CANVAS_MEMBER_TAGS.has(c.name));
    const canvasEventAttrs = {};
    const canvasEventOrder = [];
    const canvasAttrLines = {};
    for (const name of root.attrOrder) {
      if (isEventAttr(name)) {
        canvasEventAttrs[name] = root.attrs[name];
        canvasEventOrder.push(name);
        canvasAttrLines[name] = root.endLine ?? root.line ?? 0;
      }
    }
    let canvasClass = "LzCanvas";
    let canvasAnonDef = "";
    let canvasAnonDefDebug = "";
    if (memberEls.length > 0 || canvasEventOrder.length > 0) {
      const synth = { type: "elem", name: "canvas", attrs: canvasEventAttrs, attrOrder: canvasEventOrder, attrLines: canvasAttrLines, children: memberEls, origin: root.origin, line: root.line, endLine: root.endLine };
      const built = buildNode(synth, ctx, true, null, "canvas");
      const attrs = { ...built.attrs };
      if (built.delegateList.length > 0)
        attrs["$delegates"] = "[" + built.delegateList.join(COMPILE_DEBUG ? ", " : ",") + "]";
      for (const s of built.attrSlots)
        if (!(s in attrs))
          attrs[s] = "void 0";
      for (const [k, v] of Object.entries(attrs))
        cattrs[k] = v;
      const hasMethods = built.methodEntries.some((e) => !isVoidSlot(e));
      if (hasMethods) {
        canvasClass = `$lzc$class_${mGen.next().slice(1)}`;
        canvasAnonDef = emitAnonClass(canvasClass, "LzCanvas", "canvas", built.methodEntries, null);
        if (debug)
          canvasAnonDefDebug = emitAnonClassDebug(canvasClass, "LzCanvas", "canvas", built.methodEntries, null, built);
      }
    }
    const canvasLine = `canvas=new ${canvasClass}(null,${emitObject(cattrs)});`;
    DEBUG_STMTS = debug ? [] : null;
    for (const child of root.children)
      if (child.type === "elem" && child.name === "resource") {
        const rn = child.attrs["name"];
        if (rn)
          declaredResources.add(rn);
      }
    let js = "";
    for (const child of root.children) {
      if (child.type === "elem" && CANVAS_MEMBER_TAGS.has(child.name))
        continue;
      if (child.type === "text") {
        if (child.value.trim())
          throw new Unsupported(`text directly under <canvas>`);
        continue;
      }
      const debugAnonPrev = debugAnonClassPending;
      debugAnonClassPending = false;
      if (child.name === "class") {
        js += compileClass(child.attrs["name"]);
        continue;
      }
      if (child.name === "interface")
        continue;
      if (child.name === "script" && child.attrs["when"] === "immediate") {
        let body = child.children.map((n) => n.type === "text" ? n.value : "").join("");
        const ssrc = child.attrs["src"];
        if (ssrc) {
          const stext = SCRIPT_SRC?.(ssrc, child.origin ?? DEBUG_SOURCE_ID);
          if (stext == null)
            throw new Unsupported(`<script src="${ssrc}"> not found`);
          body = `#file ${ssrc}
#line 1
` + stext;
        }
        if (DEBUG_STMTS) {
          for (const u of compileProgramDebug(body, debugFile(child), bodyLineOf(child)))
            pushDebug(u);
          lastTopWasInstance = false;
          continue;
        }
        const prog = compileProgram(body);
        if (prog)
          js += prog.endsWith(";") ? prog : prog + ";";
        continue;
      }
      if (child.name === "resource") {
        registerNamedResource(child);
        continue;
      }
      if (child.name === "splash")
        continue;
      if (child.name === "security")
        continue;
      if (child.name === "font") {
        compileFontTag(child);
        continue;
      }
      if (child.name === "stylesheet") {
        if (child.attrs["src"])
          throw new Unsupported(`<stylesheet src=\u2026>`);
        const cssText = child.children.map((n) => n.type === "text" ? n.value : "").join("");
        if (DEBUG_STMTS) {
          const progD = buildStylesheetProgram(cssText, COMPILE_PROFILE ? void 0 : debugFile(child));
          if (progD) {
            const styleLine = child.line ?? 0;
            const styleCol = (child.endCol ?? 0) + 4;
            for (const u of compileStylesheetDebug(progD, debugFile(child), styleLine, styleCol))
              pushDebug(u);
            lastTopWasInstance = false;
          }
          continue;
        }
        const prog = buildStylesheetProgram(cssText);
        if (prog)
          js += ";" + compileProgram(prog);
        continue;
      }
      if (child.name === "dataset" && isLocalDataset(child)) {
        if (DEBUG_STMTS) {
          const dsDir = debugAnonPrev ? ["", 0] : [crossUnitFile, 1];
          for (const u of compileDatasetDebug(child, globals, globalOrigins, opts, dsDir))
            pushDebug(u);
          lastTopWasInstance = false;
          continue;
        }
        js += compileDataset(child, globals, globalOrigins, opts);
        continue;
      }
      if (child.name === "debug") {
        if (debug) {
          const dbgEl = { ...child, name: "LzDebugWindow" };
          const dbgBuilt = buildNode(dbgEl, ctx, true, null, "canvas");
          const dbgR = emitNode(dbgBuilt, resolve, inheritsChildren, mGen, compileClass);
          const clsMatch = dbgR.map.match(/"class": *([^,}]+)\}?$/);
          const dbgClass = clsMatch ? clsMatch[1].trim() : resolve("LzDebugWindow");
          debugWindowScript = `new ${dbgClass}(canvas, ${dbgR.map}.attrs)`;
          debugAnonClassPending = !!(clsMatch && /^\$lzc\$class_/.test(dbgClass) && dbgClass !== resolve("LzDebugWindow"));
        }
        continue;
      }
      const built = buildNode(child, ctx, true, null, "canvas");
      const r = emitNode(built, resolve, inheritsChildren, mGen, compileClass);
      if (DEBUG_STMTS) {
        const dir = annoFileLine(debugFile(child), child.endLine ?? child.line ?? 0);
        lastTopFile = debugFile(child);
        lastTopInstance = built;
        lastTopWasInstance = true;
        crossUnitFile = instanceTrailingFile(built, debugFile(child));
        pushDebug(`${dir}canvas.LzInstantiateView(${r.map}, ${instanceContribution(child)})${setPathname(instanceTrailingFile(built, debugFile(child)))}`);
        continue;
      }
      js += r.defs + `canvas.LzInstantiateView(${r.map},${instanceContribution(child)});`;
    }
    if (DEBUG_STMTS) {
      const regFile = lastTopFile;
      let regResetPrefix = setPathname("");
      const pushReg = (marker) => {
        pushDebug(regResetPrefix + marker);
        regResetPrefix = "";
      };
      registrations.forEach((reg, i) => pushReg(registerReg({ body: reg.replace(/;$/, "").replace("]=", "] = "), file: regFile, seq: i + 1 })));
      if (COMPILE_PROFILE) {
        pushReg(registerReg({ body: "canvas.initDone()", file: regFile, seq: 1 }));
      } else if (debugWindowScript) {
        pushReg(registerReg({ body: debugWindowScript + ";canvas.initDone()", file: regFile, seq: 1 }));
      } else {
        pushReg(registerReg({ body: "Debug.makeDebugWindow()", file: regFile, seq: 1 }));
        pushReg(registerReg({ body: "canvas.initDone()", file: regFile, seq: 1 }));
      }
    }
    js += registrations.join("");
    js += "canvas.initDone();";
    const fontCat = (o) => AUTO_ORIGINS.has(o) ? 0 : LIBRARY_ORIGINS.has(o) ? 2 : 1;
    preamble.push(...fontEntries.map((e, i) => ({ e, c: fontCat(e.origin), r: ORIGIN_RANK.get(e.origin) ?? 0, i })).sort((a, b) => a.c - b.c || a.r - b.r || a.i - b.i).map((x) => x.e.line));
    for (const e of anonResEntries) {
      preamble.push(e.render(spriteOffset));
      spriteOffset += e.height;
    }
    let lib = preamble.join("");
    if (hasResource && opts.sprites !== "none")
      lib += `LzResourceLibrary.__allcss={path:'${opts.spritePath ?? "app.sprite.png"}'};`;
    if (debug) {
      const allStmts = [
        ...orderGlobals(globals, globalOrigins, opts.sourceId ?? "").map((g) => `var ${g} = null`),
        ...canvasAnonDefDebug ? [canvasAnonDefDebug] : [],
        `canvas = new ${canvasClass}(null, ${emitObjectSpaced(cattrs)})`,
        ...DEBUG_STMTS ?? []
      ];
      return { js: lib + assembleDebugProgram(allStmts) };
    }
    const globalDecls = orderGlobals(globals, globalOrigins, opts.sourceId ?? "").map((g) => `var ${g}=null;`).join("");
    return { js: lib + globalDecls + canvasAnonDef + canvasLine + js };
  } catch (e) {
    if (e instanceof Unsupported || e instanceof ScUnsupported || e instanceof CssUnsupported)
      return { js: "", unsupported: e.message };
    throw e;
  }
}

// dist/imagedim.js
function u16be(b, i) {
  return b[i] << 8 | b[i + 1];
}
function u16le(b, i) {
  return b[i] | b[i + 1] << 8;
}
function u32be(b, i) {
  return (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
}
function imageDim(b) {
  if (b.length >= 24 && b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71)
    return { width: u32be(b, 16), height: u32be(b, 20), format: "png" };
  if (b.length >= 10 && b[0] === 71 && b[1] === 73 && b[2] === 70)
    return { width: u16le(b, 6), height: u16le(b, 8), format: "gif" };
  if (b.length >= 4 && b[0] === 255 && b[1] === 216) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 255) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204)
        return { height: u16be(b, i + 5), width: u16be(b, i + 7), format: "jpeg" };
      const len = u16be(b, i + 2);
      i += 2 + len;
    }
  }
  return null;
}

// dist/browser-io.js
function maxCommonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i])
    i++;
  const clean = i === 0 || a[i - 1] === "/" || i === a.length && (i === b.length || b[i] === "/") || i === b.length && a[i] === "/";
  if (!clean)
    i = a.lastIndexOf("/", i - 1) + 1;
  return i > 1 && a[i - 1] === "/" ? a.slice(0, i - 1) : a.slice(0, i);
}
function splitJ(s) {
  const out = [];
  let start = 0;
  for (; ; ) {
    const end = s.indexOf("/", start);
    if (end === -1) {
      if (start > 0 || start < s.length)
        out.push(s.slice(start));
      break;
    }
    out.push(s.slice(start, end));
    start = end + 1;
  }
  return out;
}
function normalizePath(path) {
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    if (c === "." || c === "") {
      path.splice(i, 1);
      i--;
    } else if (c === ".." && i > 0) {
      path.splice(i - 1, 2);
      i -= 2;
    }
  }
}
function adjustRelativePath(p, source, dest) {
  const sep = "/";
  if (p.endsWith(sep))
    return p;
  if (source.endsWith(sep))
    source = source.slice(0, -1);
  if (dest.endsWith(sep))
    dest = dest.slice(0, -1);
  const sd = splitJ(source);
  const dd = splitJ(dest);
  normalizePath(sd);
  normalizePath(dd);
  while (sd.length && dd.length && sd[0] === dd[0]) {
    sd.shift();
    dd.shift();
  }
  const comps = [];
  for (let i = 0; i < sd.length; i++)
    comps.push("..");
  for (const d of dd)
    comps.push(d);
  comps.push(p);
  return comps.join(sep);
}
function getUserPathname(pathname, basePathnames) {
  pathname = pathname.replace(/\\/g, "/");
  const slash = pathname.lastIndexOf("/");
  const sourceDir = slash >= 0 ? pathname.slice(0, slash) : "";
  const name = pathname.slice(slash + 1);
  let best = pathname;
  let bestLen = splitJ(best).length;
  for (const base of basePathnames) {
    const cand = adjustRelativePath(name, base.replace(/\\/g, "/"), sourceDir);
    const len = splitJ(cand).length;
    if (len < bestLen) {
      best = cand;
      bestLen = len;
    }
  }
  return best;
}
function dirUrl(u) {
  const i = u.lastIndexOf("/");
  return i >= 0 ? u.slice(0, i) : u;
}
function basenameUrl(u) {
  const i = u.lastIndexOf("/");
  return i >= 0 ? u.slice(i + 1) : u;
}
function joinUrl(base, ref) {
  if (/^[a-z]+:\/\//i.test(ref))
    return ref;
  const m = /^([a-z]+:\/\/[^/]*)(\/.*)?$/i.exec(base);
  const origin = m ? m[1] : "";
  let path = m ? m[2] ?? "" : base;
  if (ref.startsWith("/"))
    path = ref;
  else
    path = (path.endsWith("/") ? path : path + "/") + ref;
  const segs = path.split("/");
  const out = [];
  for (const s of segs) {
    if (s === "." || s === "")
      continue;
    if (s === "..") {
      if (out.length)
        out.pop();
      continue;
    }
    out.push(s);
  }
  return origin + "/" + out.join("/");
}
function insertSubdir(u, sub) {
  return dirUrl(u) + "/" + sub + "/" + basenameUrl(u);
}
function browserOptions(args) {
  const { baseUrl, lpsUrl, state } = args;
  const appDir = dirUrl(baseUrl);
  const lps = lpsUrl ? lpsUrl.endsWith("/") ? lpsUrl.slice(0, -1) : lpsUrl : null;
  let pending = false;
  const want = (url) => {
    const hit = state.map.get(url);
    if (hit) {
      state.onUse?.(url);
      return hit;
    }
    if (state.missing.has(url))
      return null;
    state.faults.add(url);
    pending = true;
    return null;
  };
  const PLACEHOLDER_RESOURCE = { width: 1, height: 1, ptype: "ar", relPath: "__lzc_pending__" };
  const PLACEHOLDER_INCLUDE = { source: "<library/>", id: "__lzc_pending__" };
  const PLACEHOLDER_TEXT = "";
  const DATASET_PLACEHOLDER = "<data/>";
  const pathOf = (u) => {
    const m = /^[a-z]+:\/\/[^/]*(\/.*)?$/i.exec(u);
    return m ? m[1] ?? "" : u;
  };
  const appDirPath = pathOf(appDir);
  const lpsPath = lps ? pathOf(lps) : null;
  const relPathOf = (absUrl) => {
    const abs = pathOf(absUrl);
    let ptype, prefix;
    if (abs.startsWith(appDirPath)) {
      ptype = "ar";
      prefix = maxCommonPrefix(abs, appDirPath);
    } else {
      ptype = "sr";
      prefix = lpsPath ? maxCommonPrefix(abs, lpsPath) : appDirPath;
    }
    let relPath = abs.startsWith(prefix) ? abs.slice(prefix.length) : abs;
    if (relPath[0] === "/")
      relPath = relPath.slice(1);
    return { ptype, relPath };
  };
  const resolveResource = (ref, originId) => {
    const isSwf = /\.swf$/i.test(ref);
    const pngRef = isSwf ? ref.replace(/\.swf$/i, ".png") : ref;
    const originDir = originId ? dirUrl(originId) : appDir;
    const baseDirs = [originDir];
    if (lps)
      baseDirs.push(lps + "/lps/components", lps + "/lps/fonts", lps + "/lps/lfc");
    pending = false;
    let foundUrl;
    let file = null;
    outer: for (const dir of baseDirs) {
      const direct = joinUrl(dir + "/", pngRef);
      const tries = isSwf ? [direct, insertSubdir(direct, "autoPng")] : [direct];
      for (const cand of tries) {
        const f = want(cand);
        if (f) {
          foundUrl = cand;
          file = f;
          break outer;
        }
      }
    }
    if (!foundUrl || !file)
      return pending ? PLACEHOLDER_RESOURCE : null;
    const dim = imageDim(file.bytes);
    if (!dim)
      return null;
    const { ptype, relPath } = relPathOf(foundUrl);
    return { width: dim.width, height: dim.height, ptype, relPath };
  };
  const resolveFont = (src) => {
    const cands = [];
    cands.push(joinUrl(appDir + "/", src));
    if (lps) {
      cands.push(joinUrl(lps + "/lps/components/", src));
      cands.push(joinUrl(lps + "/lps/fonts/", src));
      cands.push(joinUrl(lps + "/lps/lfc/", src));
    }
    pending = false;
    for (const cand of cands) {
      const f = want(cand);
      if (f)
        return relPathOf(cand);
    }
    return pending ? { ptype: "ar", relPath: "__lzc_pending__" } : null;
  };
  const frameInfo = (url) => {
    const f = want(url);
    if (!f)
      return null;
    const dim = imageDim(f.bytes);
    if (!dim)
      return null;
    const { ptype, relPath } = relPathOf(url);
    return { width: dim.width, height: dim.height, ptype, relPath };
  };
  const resolveResourceFrames = () => null;
  const resolveInclude = (ref, fromId) => {
    const base = fromId ? dirUrl(fromId) : appDir;
    const roots = ref.startsWith("/") ? lps ? [joinUrl(lps + "/lps/components/", ref.slice(1))] : [] : [joinUrl(base + "/", ref)];
    if (lps && !ref.startsWith("/"))
      roots.push(joinUrl(lps + "/lps/components/", ref));
    const candidates = roots.flatMap((r) => /\.lzx$/i.test(ref) ? [r] : [r + "/library.lzx"]);
    pending = false;
    for (const url of candidates) {
      const f = want(url);
      if (f)
        return { source: f.text, id: url };
    }
    return pending ? PLACEHOLDER_INCLUDE : null;
  };
  const autoincludes = {};
  if (lps) {
    const propUrl = lps + "/WEB-INF/lps/misc/lzx-autoincludes.properties";
    const f = want(propUrl);
    if (f) {
      for (const line of f.text.split("\n")) {
        const m = /^\s*([\w-]+)\s*[:=]\s*(\S+)/.exec(line);
        if (m && !line.trimStart().startsWith("#"))
          autoincludes[m[1]] = m[2];
      }
    }
  }
  const resolveDatasetSrc = (ref, fromId) => {
    const base = fromId ? dirUrl(fromId) : appDir;
    const cands = base === appDir ? [joinUrl(appDir + "/", ref)] : [joinUrl(base + "/", ref), joinUrl(appDir + "/", ref)];
    pending = false;
    for (const url of cands) {
      const f = want(url);
      if (f)
        return f.text;
    }
    return pending ? DATASET_PLACEHOLDER : null;
  };
  const resolveScriptSrc = (ref, fromId) => {
    const base = fromId ? dirUrl(fromId) : appDir;
    const cands = [joinUrl(base + "/", ref)];
    if (lps && !ref.startsWith("/"))
      cands.push(joinUrl(lps + "/lps/components/", ref));
    if (lps && ref.startsWith("/"))
      cands.push(joinUrl(lps + "/lps/components/", ref.slice(1)));
    pending = false;
    for (const url of cands) {
      const f = want(url);
      if (f)
        return f.text;
    }
    return pending ? PLACEHOLDER_TEXT : null;
  };
  const sourceId = baseUrl;
  const basePathnames = [appDirPath];
  if (lpsPath)
    basePathnames.push(lpsPath + "/lps/components", lpsPath + "/lps/fonts", lpsPath + "/lps/lfc");
  const debugFileName = (id) => {
    const isApp = id === sourceId;
    return getUserPathname(pathOf(isApp ? sourceId : id), basePathnames);
  };
  const spritePath = basenameUrl(baseUrl).replace(/\.lzx$/, "") + ".sprite.png";
  return {
    resolveResource,
    resolveResourceFrames,
    resolveFont,
    spritePath,
    resolveInclude,
    autoincludes,
    resolveDatasetSrc,
    resolveScriptSrc,
    sourceId,
    debugFileName
  };
}

// dist/closure.js
function validatorsEqual(stored, current) {
  if (!!stored.missing !== !!current.missing)
    return false;
  if (stored.missing && current.missing)
    return true;
  for (const k of ["etag", "lastModified"]) {
    if (stored[k] !== void 0 && current[k] !== void 0)
      return stored[k] === current[k];
  }
  let compared = 0;
  for (const k of ["hash", "mtime", "size"]) {
    if (stored[k] !== void 0 && current[k] !== void 0) {
      if (stored[k] !== current[k])
        return false;
      compared++;
    }
  }
  return compared > 0;
}
function isUpToDate(closure, currentProps, probe) {
  const a = closure.props, b = currentProps;
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length)
    return false;
  for (const k of ak)
    if (a[k] !== b[k])
      return false;
  for (const e of closure.entries) {
    if (!validatorsEqual(e.v, probe(e)))
      return false;
  }
  return true;
}
function fnv1a(s) {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ BigInt(s.charCodeAt(i))) & mask;
    h = h * prime & mask;
  }
  return h.toString(16).padStart(16, "0");
}
function lookupKey(mainId, props, compilerVersion) {
  const parts = [`v=${compilerVersion}`, `main=${mainId}`];
  for (const k of Object.keys(props).sort())
    parts.push(`${k}=${props[k]}`);
  return fnv1a(parts.join("\n"));
}
function contentTag(mainId, closure, compilerVersion) {
  const parts = [`v=${compilerVersion}`, `main=${mainId}`];
  for (const k of Object.keys(closure.props).sort())
    parts.push(`${k}=${closure.props[k]}`);
  const sorted = [...closure.entries].sort((x, y) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  for (const e of sorted) {
    const v = e.v;
    parts.push(`${e.kind}:${e.id}|${v.hash ?? ""}|${v.etag ?? ""}|${v.lastModified ?? ""}|${v.mtime ?? ""}|${v.size ?? ""}|${v.missing ? "X" : ""}`);
  }
  return fnv1a(parts.join("\n"));
}

// dist/cache-browser.js
function validatorFromResponse(headers, body) {
  const v = {};
  const etag = headers?.get("etag") ?? headers?.get("ETag") ?? null;
  const lastMod = headers?.get("last-modified") ?? headers?.get("Last-Modified") ?? null;
  if (etag)
    v.etag = etag;
  else if (lastMod)
    v.lastModified = lastMod;
  if (body?.text !== void 0)
    v.hash = fnv1a(body.text);
  if (body?.size !== void 0)
    v.size = body.size;
  return v;
}
var BrowserTracker = class {
  constructor() {
    this.m = /* @__PURE__ */ new Map();
  }
  /** Record a fetched URL's validator (called by the driver per fetch). */
  record(id, v, kind = "file") {
    this.m.set(id, { id, kind, v });
  }
  /** Tracker.file — used when a resolver touches a URL we have NOT separately
   *  recorded (defensive; the driver normally records every fetch up front). */
  file(id) {
    if (!this.m.has(id))
      this.m.set(id, { id, kind: "file", v: { missing: true } });
  }
  dir(id) {
    if (!this.m.has(id))
      this.m.set(id, { id, kind: "dir", v: { missing: true } });
  }
  has(id) {
    return this.m.has(id);
  }
  /** Drop all recorded entries (the driver resets per pass so the FINAL pass's
   *  recorded set is exactly the used closure). */
  reset() {
    this.m.clear();
  }
  entries() {
    return [...this.m.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
};
async function browserProbe(entry, fetchFn) {
  try {
    const res = await fetchFn(entry.id, { method: "HEAD" });
    if (!res.ok)
      return { missing: true };
    const v = validatorFromResponse(res.headers);
    const cl = res.headers.get("content-length");
    if (cl && entry.v.size !== void 0)
      v.size = Number(cl);
    if (v.etag === void 0 && v.lastModified === void 0 && v.size === void 0) {
      const g = await fetchFn(entry.id, { method: "GET" });
      if (!g.ok)
        return { missing: true };
      return validatorFromResponse(g.headers, { text: await g.text() });
    }
    return v;
  } catch {
    return { missing: true };
  }
}
var MemKv = class {
  constructor() {
    this.m = /* @__PURE__ */ new Map();
  }
  async get(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  async put(k, v) {
    this.m.set(k, v);
  }
};
var CacheStorageKv = class {
  constructor(cacheName) {
    this.cacheName = cacheName;
  }
  url(k) {
    return "https://lzc-cache.invalid/" + encodeURIComponent(k);
  }
  async get(k) {
    const c = await caches.open(this.cacheName);
    const r = await c.match(this.url(k));
    return r ? await r.text() : null;
  }
  async put(k, v) {
    const c = await caches.open(this.cacheName);
    await c.put(this.url(k), new Response(v));
  }
};
var BrowserCache = class {
  constructor(compilerVersion, opts) {
    this.compilerVersion = compilerVersion;
    const useCS = (opts?.store ?? (typeof caches !== "undefined" ? "cachestorage" : "memory")) === "cachestorage" && typeof caches !== "undefined";
    this.kv = useCS ? new CacheStorageKv(opts?.cacheName ?? "lzc-compile-cache") : new MemKv();
  }
  /** Look up a fresh cached compile. `fetchFn` is used by browserProbe to re-check
   *  each dependency. Returns null on miss or staleness. */
  async get(mainUrl, props, fetchFn) {
    const key = lookupKey(mainUrl, props, this.compilerVersion);
    const manRaw = await this.kv.get(key + ".json");
    const blob = await this.kv.get(key + ".js");
    if (manRaw === null || blob === null)
      return null;
    let man;
    try {
      man = JSON.parse(manRaw);
    } catch {
      return null;
    }
    const probed = /* @__PURE__ */ new Map();
    await Promise.all(man.closure.entries.map(async (e) => {
      probed.set(e.id, await browserProbe(e, fetchFn));
    }));
    const fresh = isUpToDate(man.closure, props, (e) => probed.get(e.id) ?? { missing: true });
    if (!fresh)
      return null;
    return { blob, tag: man.tag, closure: man.closure };
  }
  /** Store a finished compile; returns the ETag (contentTag). */
  async put(mainUrl, closure, blob) {
    const key = lookupKey(mainUrl, closure.props, this.compilerVersion);
    const tag = contentTag(mainUrl, closure, this.compilerVersion);
    await this.kv.put(key + ".js", blob);
    await this.kv.put(key + ".json", JSON.stringify({ tag, closure }));
    return tag;
  }
};

// dist/domsource.js
var DomDialectError = class extends Error {
};
var ELEMENT = 1;
var TEXT = 3;
var CDATA = 4;
var COMMENT = 8;
var PREFIX = "lz-";
var FORBIDDEN_BARE = {
  canvas: "the app root is <laszlo-app>; a literal <canvas> is an HTML canvas element",
  style: "HTML parses <style> as raw CSS and applies it to the page; write <lz-style>",
  image: "HTML rewrites <image> to a void <img>, destroying children; write <lz-image>",
  img: "HTML rewrote your <image> to <img>; write <lz-image>",
  html: "an in-body <html> start tag merges into the document; write <lz-html>",
  form: "HTML drops nested <form> start tags; write <lz-form>",
  button: "an adopted <button> carries UA chrome/semantics; write <lz-button>",
  label: "write <lz-label>",
  menu: "write <lz-menu>",
  param: "<param> is a void element; write <lz-param>"
};
var CODE_PARENTS = /* @__PURE__ */ new Set(["method", "handler", "setter"]);
var NO_STAMP_SUBTREE = /* @__PURE__ */ new Set(["class", "interface", "mixin", "dataset"]);
var NO_STAMP_TAGS = /* @__PURE__ */ new Set([
  "canvas",
  "attribute",
  "method",
  "handler",
  "setter",
  "script",
  "include",
  "font",
  "resource",
  "dataset",
  "datapath",
  "datapointer",
  "class",
  "interface",
  "mixin",
  "node",
  "state",
  "animator",
  "animatorgroup",
  "layout",
  "simplelayout",
  "stableborderlayout",
  "constantlayout",
  "wrappinglayout",
  "text",
  "inputtext",
  "splash",
  "switch",
  "when",
  "otherwise"
]);
function localName(el) {
  return el.tagName.toLowerCase();
}
function dialectName(raw) {
  if (raw.startsWith(PREFIX))
    return raw.slice(PREFIX.length);
  const why = FORBIDDEN_BARE[raw];
  if (why)
    throw new DomDialectError(`<${raw}> cannot be authored bare: ${why}`);
  return raw;
}
var normAttr = (v) => v.replace(/[\t\r\n]/g, " ");
function textContentOf(el) {
  let s = "";
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i];
    if (c.nodeType === TEXT || c.nodeType === CDATA)
      s += c.nodeValue ?? "";
    else if (c.nodeType === ELEMENT)
      s += textContentOf(c);
  }
  return s;
}
function transpile(ctx, code, owner) {
  if (!ctx.opts.transpileTs)
    throw new DomDialectError("TypeScript code present but no transpileTs was provided (text/lzs carriers pass through)");
  try {
    return ctx.opts.transpileTs(code);
  } catch (e) {
    throw new DomDialectError(`in <${owner}>: ${e.message}`);
  }
}
function scriptNodes(el, parentName, ctx) {
  const type = (el.getAttribute("type") ?? "").trim().toLowerCase();
  if (type === "application/xml") {
    if (parentName !== "dataset")
      throw new DomDialectError('<script type="application/xml"> is only valid inside <dataset>');
    return [parseXml(textContentOf(el).trim())];
  }
  let body;
  if (type === "text/typescript")
    body = transpile(ctx, textContentOf(el), CODE_PARENTS.has(parentName) ? parentName : "script");
  else if (type === "text/lzs")
    body = textContentOf(el);
  else
    throw new DomDialectError('bare or JavaScript-typed <script> is not allowed (the page parser would execute it); use <script type="text/typescript"> or <script type="text/lzs">');
  const textNode = { type: "text", value: body, cdata: false };
  if (CODE_PARENTS.has(parentName))
    return [textNode];
  const attrs = {};
  const attrOrder = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    if (a.name === "type" || a.name === "data-lz-adopt")
      continue;
    if (!(a.name in attrs)) {
      attrOrder.push(a.name);
      attrs[a.name] = normAttr(a.value);
    }
  }
  return [{ type: "elem", name: "script", attrs, attrOrder, children: [textNode] }];
}
function walkElem(el, ctx, isRoot) {
  const raw = localName(el);
  const name = isRoot && raw === "laszlo-app" ? "canvas" : dialectName(raw);
  const attrs = {};
  const attrOrder = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    if (a.name === "data-lz-adopt")
      continue;
    if (!(a.name in attrs)) {
      attrOrder.push(a.name);
      attrs[a.name] = normAttr(a.value);
    }
  }
  const childCtx = ctx.inTemplate || !NO_STAMP_SUBTREE.has(name) ? { ...ctx, inTemplate: ctx.inTemplate } : { ...ctx, inTemplate: true };
  let adoptId = null;
  if (ctx.opts.domAdopt && !isRoot && !ctx.inTemplate && !NO_STAMP_TAGS.has(name)) {
    adoptId = String(ctx.counter.n++);
    el.setAttribute("data-lz-adopt", adoptId);
  }
  const children = [];
  const isCodeParent = CODE_PARENTS.has(name);
  let sawCarrier = false;
  let sawServer = false;
  const isShader = name === "shader";
  const shaderMethods = [];
  const shaderRaw = (mEl) => {
    for (let i = 0; i < mEl.childNodes.length; i++) {
      const c = mEl.childNodes[i];
      if (c.nodeType === ELEMENT && localName(c) === "script")
        return textContentOf(c);
    }
    return textContentOf(mEl);
  };
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i];
    if (c.nodeType === COMMENT)
      continue;
    if (c.nodeType === TEXT || c.nodeType === CDATA) {
      children.push({ type: "text", value: c.nodeValue ?? "", cdata: false });
      continue;
    }
    if (c.nodeType !== ELEMENT)
      continue;
    const ce = c;
    if (localName(ce) === "server") {
      if (!isRoot)
        throw new DomDialectError("<server> must be a direct child of <laszlo-app>");
      if (sawServer)
        throw new DomDialectError("at most one <server> section per app");
      sawServer = true;
      continue;
    }
    if (isShader && localName(ce) === "method") {
      shaderMethods.push({
        name: ce.getAttribute("name") ?? "",
        args: ce.getAttribute("args") ?? "",
        returns: ce.getAttribute("returns") ?? "float",
        code: shaderRaw(ce)
      });
      continue;
    }
    if (localName(ce) === "script") {
      children.push(...scriptNodes(ce, name, childCtx));
      if (isCodeParent)
        sawCarrier = true;
      continue;
    }
    children.push(walkElem(ce, childCtx, false));
  }
  if (isCodeParent) {
    if (sawCarrier) {
      const kept = children.filter((k) => !(k.type === "text" && k.value.trim() === ""));
      children.length = 0;
      children.push(...kept);
    } else if (children.length && children.every((k) => k.type === "text")) {
      const joined = children.map((k) => k.value).join("");
      if (joined.trim() !== "") {
        children.length = 0;
        children.push({ type: "text", value: transpile(childCtx, joined, name), cdata: false });
      }
    }
  }
  if (isShader && shaderMethods.length) {
    if (!ctx.opts.glslGen)
      throw new DomDialectError("<shader> present but no glslGen was provided (inject it like transpileTs)");
    const colorM = shaderMethods.find((m) => m.name === "color");
    if (!colorM)
      throw new DomDialectError('<shader> needs a <method name="color">');
    const uniforms = [];
    for (const k of children) {
      if (k.type === "elem" && k.name === "attribute") {
        const ty = k.attrs["type"];
        if (ty === "number" || ty === "color")
          uniforms.push({ name: k.attrs["name"], lzType: ty });
      }
    }
    const helpers = shaderMethods.filter((m) => m.name !== "color").map((m) => ({
      name: m.name,
      params: m.args.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
        const [n, ty] = x.split(":").map((y) => y.trim());
        return { name: n, type: ty || "float" };
      }),
      ret: m.returns,
      code: m.code,
      srcLine: 1
    }));
    const r = ctx.opts.glslGen({ color: { code: colorM.code, srcLine: 1 }, helpers, uniforms });
    if (!r.ok) {
      const first = r.findings?.[0];
      throw new DomDialectError(`<shader> dialect: ${first ? first.message : "generation failed"}`);
    }
    attrs["shaderprogram"] = JSON.stringify(r.program);
    attrOrder.push("shaderprogram");
  }
  const elem = { type: "elem", name, attrs, attrOrder, children };
  if (adoptId !== null) {
    elem.attrs["lzdomadopt"] = adoptId;
    elem.attrOrder.push("lzdomadopt");
  }
  return elem;
}
function domToXmlElem(root, opts = {}) {
  return walkElem(root, { opts, counter: { n: 1 }, inTemplate: false }, true);
}

// dist/browser.js
var COMPILER_VERSION = "lzc-ts-0.0.1";
var textDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
function decode(bytes) {
  if (textDecoder)
    return textDecoder.decode(bytes);
  let s = "";
  for (let i = 0; i < bytes.length; i++)
    s += String.fromCharCode(bytes[i]);
  return s;
}
var cloneXml = (e) => JSON.parse(JSON.stringify(e));
function compileProps(o) {
  return {
    debug: String(!!o.debug || !!o.backtrace),
    backtrace: String(!!o.backtrace),
    profile: String(!!o.profile),
    proxied: String(o.proxied !== false),
    sprites: o.sprites ?? "none",
    canvas: String(!!o.canvas)
  };
}
async function compileInBrowser(mainUrl, o = {}) {
  const fetchFn = o.fetchFn ?? globalThis.fetch;
  if (!fetchFn)
    throw new Error("compileInBrowser: no fetch available (pass fetchFn)");
  const sprites = o.sprites ?? "none";
  const props = compileProps(o);
  if (o.cache && !o.rootXml) {
    const hit = await o.cache.get(mainUrl, props, fetchFn);
    if (hit) {
      return { js: hit.blob, closure: hit.closure, tag: hit.tag, cached: true, passes: 0 };
    }
  }
  const state = {
    map: /* @__PURE__ */ new Map(),
    faults: /* @__PURE__ */ new Set(),
    missing: /* @__PURE__ */ new Set()
  };
  const tracker = new BrowserTracker();
  const validators = /* @__PURE__ */ new Map();
  const fetchOne = async (url) => {
    try {
      const res = await fetchFn(url, { method: "GET" });
      if (!res.ok) {
        state.missing.add(url);
        return;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const text = decode(buf);
      state.map.set(url, { bytes: buf, text });
      validators.set(url, validatorFromResponse(res.headers, { text, size: buf.length }));
    } catch {
      state.missing.add(url);
    }
  };
  state.onUse = (url) => {
    if (!tracker.has(url))
      tracker.record(url, validators.get(url) ?? { missing: true });
  };
  if (!o.rootXml)
    await fetchOne(mainUrl);
  if (o.lpsUrl) {
    const lps = o.lpsUrl.endsWith("/") ? o.lpsUrl.slice(0, -1) : o.lpsUrl;
    await fetchOne(lps + "/WEB-INF/lps/misc/lzx-autoincludes.properties");
  }
  const maxRetries = o.maxRetries ?? 50;
  let result = { js: "", unsupported: void 0 };
  let passes = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    state.faults.clear();
    tracker.reset();
    tracker.record(mainUrl, validators.get(mainUrl) ?? { missing: true });
    const opts = browserOptions({ baseUrl: mainUrl, lpsUrl: o.lpsUrl, state, sprites });
    const r = o.rootXml ? compileFromXml(cloneXml(o.rootXml), {
      ...opts,
      debug: o.debug,
      backtrace: o.backtrace,
      profile: o.profile,
      proxied: o.proxied,
      sprites,
      canvas: o.canvas
    }) : compile(state.map.get(mainUrl).text, {
      ...opts,
      debug: o.debug,
      backtrace: o.backtrace,
      profile: o.profile,
      proxied: o.proxied,
      sprites,
      canvas: o.canvas
    });
    passes++;
    result = { js: r.js, unsupported: r.unsupported };
    if (state.faults.size === 0)
      break;
    const toFetch = [...state.faults].filter((u) => !state.map.has(u) && !state.missing.has(u));
    if (toFetch.length === 0)
      break;
    await Promise.all(toFetch.map(fetchOne));
    if (attempt === maxRetries) {
      throw new Error(`compileInBrowser: did not converge after ${maxRetries} passes (still faulting ${toFetch.length} urls, e.g. ${toFetch[0]})`);
    }
  }
  const closure = { entries: tracker.entries(), props };
  let tag;
  let cached = false;
  if (o.cache && !result.unsupported && !o.rootXml) {
    tag = await o.cache.put(mainUrl, closure, result.js);
  } else {
    tag = contentTag(mainUrl, closure, COMPILER_VERSION);
  }
  void cached;
  return { js: result.js, closure, tag, cached: false, unsupported: result.unsupported, passes };
}
export {
  BrowserCache,
  BrowserTracker,
  COMPILER_VERSION,
  DomDialectError,
  browserOptions,
  browserProbe,
  compile,
  compileFromXml,
  compileInBrowser,
  contentTag,
  domToXmlElem,
  fnv1a,
  isUpToDate,
  lookupKey,
  parseXml,
  validatorFromResponse,
  validatorsEqual
};
