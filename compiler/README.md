# lzc-ts — TypeScript port of the OpenLaszlo 4.9 LZX→DHTML compiler

Goal: **byte-for-byte identical** DHTML JS vs the original Java 4.9.0 compiler
(the "oracle"). Runs in Node (CLI + programmatic) **and in the browser** (the
Service Worker compiles LZX at load time).

> ## Current status — complete
>
> The compiler reaches **byte-for-byte parity with the Java 4.9 oracle** across, in **all
> four build modes** (production, debug, `backtrace`, profile):
> - the **documentation corpus** (production 346/0/0, debug 78/0/0, profile 263/0/0),
> - the **Laszlo Explorer** programs and complete apps (Calendar, Dashboard),
> - and the **entire DHTML runtime (LFC)** itself — all four LFC variants build
>   byte-identical from `runtime/lfc-src/`.
>
> Reproduce it with the self-contained oracle harness in
> [`compiler-verify/`](compiler-verify/) (needs a JDK — see its README).
>
> **The long, dated, session-by-session notes below are a historical development log**
> kept for provenance. Their interim "Status / unsupported / remaining" figures (e.g.
> "263 ok / 83 unsup", "debug refused") describe waypoints, **not** the current state
> above — debug, backtrace, and profile are all done and verified.

## Run

```
npm install            # typescript + @types/node only
npm run build          # tsc -> dist/
node dist/cli.js app.lzx > app.js

# differential test (compiles with BOTH oracle and this port, normalizes the
# appbuilddate timestamp, diffs byte-for-byte):
node harness/diff.mjs path/to/app.lzx [...more.lzx]
node harness/diff.mjs --dir path/to/dir-of-lzx
node harness/diff.mjs fixtures/*.lzx          # the durable regression set
```

Regression fixtures live in `fixtures/` (durable copies of the `t_*`/`p_*`/`q_*`
probes). Re-run them after any change.

Corpus differential test (fast, gold-cached — the oracle JVM is the bottleneck):

```
node harness/batch.mjs build <programs-dir>   # oracle-compile *.lzx → .goldcache/ (once)
node harness/batch.mjs check                  # diff the TS port vs cache; aggregate
node harness/batch.mjs show <name.lzx>        # first-diff detail for one file
```

Status on the 4.9 developer-programs corpus (346 oracle-compilable): **263 ok,
0 diff, 83 unsup** — zero wrong bytes across the whole corpus, and fixtures hold
at 0 diff. **The ONLY remaining unsupported cases are debug builds
(`canvas debug="true"` 77 + `<debug>` 6 = 83).** Everything else — including the
GIF-montage resource — is byte-for-byte.

### Debug-build (readable / source-mapped) backend — pipeline built, grind remaining

A `canvas debug="true"` build switches the script backend to the oracle's
readable, source-mapped output (`compress=false`: spaced tokens, `function  (`,
`name_$0` identifiers, `/* -*- file: X#N -*- */` source-location directives,
blank-line source-line padding) and pulls in the ~850KB debugger component
library. Session 15 built and **verified byte-for-byte** the RENDERING pipeline:

- **`src/debug.ts`** — a faithful port of `ParseTreePrinter.makeTranslationUnits`
  / `translatedAnnotations`: the `\u0001`-marker annotation stream, the
  `LineNumberState` / `shouldShowSourceLocation` directive state machine, the
  per-translation-unit GENERATED line counter, the blank-line padding
  (`offset = curLstate.linediff - newLstate.linediff`), `forceBlankLnum`, and the
  CLASSNAME/CLASSEND tunit split + `;`-join assembly (`assembleDebugProgram`).
- **`src/sc.ts` compress=false printer** — the `Printer` is fully parameterized
  for the readable backend (binary/unary/assign/cond spacing, `OPENPAREN`/
  `CLOSEPAREN` for `if`/`while`/`for`/`with`/`switch`/`try`/`catch`, SPACE before
  blocks, NEWLINE statement joins, named-function two-space `function  (` rule,
  `forceBlankLnum`), `name_$N` debug identifiers, and `lnum` source-line
  annotations. All guarded by `this.c`/`this.dbg`, so the production
  compress=true path is byte-identical (verified: 263/0/83, 96 fixtures 0 diff).
- **`compileMethodDebug`** — the displayName wrapper (`(function () { var
  $lzsc$temp = <func>; $lzsc$temp["displayName"]="name"; return $lzsc$temp })()`).

The PROOF TARGET — the `dbg3` `<method name="meth" args="a,b">return a+b;</method>`
wrapper — is reproduced **byte-for-byte end-to-end** (sc parse → name_$N → print →
annotate → translate); see `harness/debug.mjs` (a durable regression).

**Session 16 added the FORCED-DEBUG path + proved the whole closure compiles.**
A development-only `opts.debug` (set by the harness via `LZC_DEBUG_FORCE=1`)
bypasses the `debug="true"` refusal and drives the in-progress backend: it folds
`$debug` to TRUE (`SC_DEBUG` in `sc.ts`, `COMPILE_DEBUG` in `compile.ts`, both
reset in `compile()`'s `finally` — **no production leak**), and splices the
debugger component library (`spliceDebuggerLibrary`: `debugger/library.lzx` →
its `<class name="debug">` + the swf-only `<switch>` + `<include
href="debugger.lzx">`, placed after the sorted autoincludes per
`ToplevelCompiler.getLibraries`). With this, the **entire ~850KB debugger +
component closure compiles clean in compressed mode** — exit 0, no `Unsupported`,
**141/141 classes** (every named class present), and the **total gensym count
matches exactly (1268/1268 `$m`/`$lzc$class_mN`)**. New harness command
`node harness/batch.mjs dbgshow <file.lzx>` forced-debug-compiles and reports
both the gensym SKELETON first-divergence (the ordered token stream — rendering-
independent, so it isolates emission-order bugs from rendering bugs) and the raw
byte first-divergence vs a freshly-oracle-compiled gold.

**Session 20 WIRED the whole named-class debug machinery into the live forced-
debug body and the cascade is now grinding: `dbgshow /tmp/dbg3.lzx` raw first-
divergence advanced @byte 17993 → 36135 (mine 588 KB of the 850 KB gold), with the
member-less `debug` class, the `base/colors.lzx` block, and the ENTIRE complex
`basefocusview` named class (11 members + handler + constructor + mergeAttributes)
rendering byte-for-byte. Held behind the live `debug="true"` refusal; the forced
path is dev-only; corpus 263/0/83 + fixtures 96/0/0 + debug.mjs 5/5 + bare exit 3
all unchanged.**

The session-20 deliverables (all verified, production-neutral):
- **`sc.ts compileFunctionDebug`** — the full method/handler/setter/getter renderer:
  the displayName-IIFE wrapper, the debug `try/catch + $reportException` body
  wrapper (emitted iff `dereferenced || free` — `analyzeScope` now returns both;
  `dereferenced` = a member-access or call in this scope), `with(this)`, `name_$N`
  idents (synthetic `$lzc$ignore` → bare `$0`). Verified vs gold on all 9
  basefocusview methods.
- **Two constructor forms** — `debugConstructor` (member-less, directives, ctorLine
  = `endLine + 3`) and **`debugConstructorPlain`** (member-rich: `file=""`, no
  directives, `$reportException("", N)`, N = last-member close line + 5/6). xml.ts
  records `closeLine` + `attrLines`.
- **Live wiring** — a debug-gated top-level-statement sink (`DEBUG_STMTS`):
  `compileClass`/`emitClassDef`/`emitNode` push each statement →
  `assembleDebugProgram`. `emitClassBlock(…, dbg)` renders via `renderDebugClassMake`
  + `debugMergeAttributes`. Instance entries debug-gated (`ent`/`voidSlot`),
  `compileCss`/`$delegates` spaced, colors via `compileProgramDebug`,
  `node-io.debugFileName`.

**Session 21 GROUND the cascade 36135 → @byte 94809** (mine 840 KB of the 850 KB
gold): the whole constraint / anonymous-class / handler / setter / named-class-
constraint debug machinery is wired, plus the **sc lexer now honors embedded
`#file`/`#line` directives** (the general srcloc unlock) and a **JJTree
statement-line quirk** is characterized + reproduced. Corpus 263/0/83 + fixtures
96/0/0 + debug.mjs 5/5 + bare exit 3 all held; refusal still LIVE. Delivered:
- **sc lexer `#file`/`#line`/`#pragma`/`#beginAttribute`/`#endAttribute`** —
  per-token `file` tracked alongside `line`; `#file X`/`#line N` set the current
  file/line (the `endSourceLocationDirective` `#file ` resets to "" = generated).
  Threaded per-statement `file` through parser → printer (`lnum` file override).
  So a constraint setter body (`var $lzc$newvalue = <srcloc>expr<endsrc>; if(…){…}`)
  carries MIXED line tracking — the value at its `.lzx` line, the `if` at file="".
  Production-neutral (`#` is never valid JS). `finalSourceLine` exported.
- **`compileConstraintDebug`** (compile.ts) — the `always` setter + deps (deps via
  `compileFunctionDebug` + `debugCatchBodyThrows`, `$lzc$validateReferenceDependencies`
  with the `collectDependencies` debug `annotation`), `once`/`path` setters,
  displayNames `<name>='$[once|path]{...}'` / `<name> dependencies`, the init's last
  arg = the prettyBinderName (not `null`). Wired into ALL constraint sites
  (instance + class-tag + class-`<attribute>` + `colorValue`).
- **`emitAnonClassDebug`** — the spaced `Class.make` opened by the anon-class
  directive (`endLine − 1`), the member-rich constructor whose `$reportException("",
  N)` line N is the **ScriptClass.toString line simulation** (`finalSourceLine(srcloc
  + lastMemberBody + endsrc + "\n}") + 1 + trailing-void-0-decls`), spaced
  `displayName`/`children` classprops. `emitObj` (spaced asMaps), children-array
  spacing, `voidSlot` slots.
- **Handler/method/setter member tracking** — `emitHandler`/`compileHandler` return
  the body-method `{body, srcLine}`; `buildNode` records the last code member
  (`noteCodeMember`) for the ctor-line sim. The **setter** method line = the
  attribute's `endLine` (SAX `/>` line), body at `endLine + 1` (fixed a 2-line-tag
  off-by-one). Default-param prologue rewritten to the constructor's `;;case`
  format (annotated first case at `methodLine + 1`). Super-dispatch (`["$superclass"]
  && … || this.nextMethod(…)`) now SP/COMMA-spaced in debug.
- **The JJTree statement-line quirk (sc `joinStmts`)** — a statement whose JJTree
  node-open `getToken(1)` lands on a preceding block's closing brace is tracked at
  the `}` line, not its own. Reproduced (production-neutral, debug-gated) by:
  `joinDepth === 1` (function-body StatementList only) **AND** the current statement
  is an EXPRESSION statement **AND** the previous statement is a MULTI-line brace
  block (`line !== endLine`) whose last inner statement is non-block (text ends in a
  single `}`, not `}}`) **AND** adjacency (`cur.line === prevBlock.endLine + 1`).
  Each condition was a real counterexample (init-super vs fadeout/callupdel/
  setCanvasColor/if-else-if). `endLine` recorded per statement in the parser.

**Session 22 GROUND the cascade 94809 → @byte 211996** (mine 842 KB of the 850 KB
gold). The first `<script>` instance, the default-param try/catch rule, the
if-block brace-preservation fold, XML attribute-value whitespace normalization,
and the FULL super-call line-tracking quirk (Rule A + Rule B) are all wired
byte-for-byte. Corpus 263/0/83 + fixtures 96/0/0 + debug.mjs 5/5 + bare exit 3
held; refusal still LIVE. Delivered (all production-neutral, debug-gated):
- **`sc.ts compileScriptBodyDebug`** — the construction-time `<script>` instance's
  `script` function value: the displayName-IIFE around an ANONYMOUS `function ()`
  (one space) + try/catch, displayName `<file>#<elementLine>/<col>`. The `/<col>`
  is `node.beginColumn` (JavascriptGenerator:1115) = the element's `>` column +
  the fixed asMap prefix length (`canvas.LzInstantiateView({'class': lz.script,
  attrs: {script: ` = 62 chars) + 1 → **endCol + 63**. `xml.ts` now records
  `endCol` (the start tag's `>` column) + normalizes attribute-value whitespace
  (tab/CR/LF → space, the XML/JDOM rule — a multi-line `setter=`/`onclick=`/`${}`
  body is one logical line for line tracking). `compile.ts` wires the spaced
  script asMap (`{"class": lz.script, attrs: {script: <fn>}}`) + the LzInstantiateView
  LEADING source directive (the element line, for ALL canvas-direct instances).
- **Default-param try/catch** — a method with a default parameter is ALWAYS wrapped
  in try/catch: the generated `switch (arguments.length)` prologue is part of the
  analyzed body and `arguments.length` is a property reference → `dereferenced`
  (JavascriptGenerator:1277). `compileFunctionDebug` `needTry |= cases.length > 0`.
- **`if(true){block}` keeps the block in a BRANCH context** — the constant-fold now
  replaces `if(true) S` with S (a block stays a block); StatementList-level splicing
  (foldStmts) flattens direct-child block statements (both user blocks and folded
  residue — verified vs the oracle). So `if($js1){return v}` still collapses at
  statement-list level, but `else if($debug){warn()}` → `else { warn() }`.
- **The super-call line-tracking quirk, FULLY characterized.** The general s21
  expr-after-block rule was a mis-generalization; the quirk manifests in OUTPUT only
  for super-call rewrites (`substitute()` re-parses the expansion at the JJTree node
  line). **Rule A:** a super-call statement adjacent to the previous statement is
  tracked at that previous end line (any predecessor — if-block OR single-line expr).
  **Rule B:** the EXPRESSION statement right after a SHIFTED super inherits the same
  one-line shift (`line − 1`, independent of any comment gap); a super that kept its
  own line (the first statement of a body) does NOT shift its successor, and
  `if`/`var`/`return` never shift. (`isSuperCallExpr`, `prevWasShiftedSuper`.)

**The s23 stop point — @byte 211996 = the first STATE-class constructor**
(`$lzc$class_resizestate`, utils/states/resizestate.lzx). A `<class extends="state">`
routes its methods to `mergeAttributes` (void-slot decls in `Class.make`), so its
constructor is NOT member-rich-plain — it uses the **directive** form
(`debugConstructor`, with `/* file -*- */` directives + leading blank-line padding),
at a ctorLine derived from a `ScriptClass.toString` simulation of the state-routed
body. Data points: **resizestate ctorLine = 16** (last `when="once"` attr
__resize_yroffset `/>`@15, +1), **dragstate ctorLine = 22** (the `y` constraint
attr @22) — these do NOT fit a single simple attribute-line rule (the constructor
inherits sc's line after the state body's `var name;` decls + the constructor's own
`super()` body, like the s21 anon-class `finalSourceLine` sim but for the state
member-routing). Fix: in `compile.ts` emitClassDef debug path, detect state classes
→ `memberRich=false` (directive form) with the simulated ctorLine. This blocks ~75%
of the file (the divergence is at 25% of 850 KB). Then: remaining canvas instances /
datasets / `initDone` / the app's own canvas, then flip the refusal + add `p_debug_*`.

**Session 19** cracked the synthetic-constructor source-line rule and built +
verified the first-`Class.make` scaffolding renderer in isolation (not yet wired
into the live forced-debug body, so the dbgshow byte is unchanged):
- **Constructor source line = the class's LAST code-generating member
  (`<method>`/`<handler>`/setter) line** — the generated constructor (ClassModel:
  725, body `super(parent,attrs,children,async)`, `loc=null`) is appended last to
  the class attrs with no `#pragma`, so sc tracks it to the preceding member's
  source location. Member-less classes (only `<doc>`) fall back to `classLine + 3`
  (debug 12→15, statictext 8→11). The body (default assignments + super) is at
  `ctorLine + 1`.
- **`src/debug.ts` `debugConstructor(file, ctorLine)` + `renderDebugClassMake(…)`**
  render the displayName-IIFE constructor (try/catch + `$reportException` +
  `switch (arguments.length)` defaults + super dispatch) and the compress=false
  `Class.make(name, [props], super, [classprops])` wrapper as annotation streams.
  Verified byte-for-byte vs the dbg3 gold for two member-less classes (`debug`,
  `statictext` — different file/super/tagname/lines); durable as `harness/debug.mjs`
  tests 4 + 5.
- **`src/xml.ts` `endLine`** (start-tag closing `>` line) threaded onto every
  element; the class-open directive is `endLine − 1`.

(s20 DID this refactor + the member-rich machinery — see the Session-20 block
above; the named-class vertical is byte-for-byte and the divergence is now at the
first anonymous class.)
0. **Cross-class emission-ORDER alignment — SOLVED (s17); skeleton stays
   IDENTICAL (1268/1268).** See the s17 history below; the app-tree-only
   autoinclude + one-library-unit debugger splice fix.
1. **Scaffolding HEADER compress=false — DONE (s18).** The `var X = null` global
   decls and the `canvas = new LzCanvas(null, {…})` line now render spaced
   (`emitObjectSpaced`) as separate top-level statements through
   `assembleDebugProgram` (they carry no source position → no directive). Also:
   the `debug` compile-directive attribute is stripped from the canvas attrs (the
   oracle never emits it — verified for debug="false" too). Pushed the raw
   divergence @byte 17595 → @byte 17993 (the canvas line is byte-for-byte).
2. **Per-node source-line tracking — INFRA LANDED + ELEMENT-DIRECTIVE RULE
   CRACKED (s18).** `xml.ts` now records a 1-based source line on every element
   (start-tag `<` line) and text node (line where content begins); `sc.ts`'s lexer
   tracks per-token lines (from a `baseLine` = the embedded script's text-node
   line) and the parser stamps each statement's `.line` (preserved through
   `foldStmt`). New `compileProgramDebug(source, file, baseLine)` renders an
   immediate `<script>`'s statements as separate annotated units. **Verified
   byte-for-byte against the real gold**: the `base/colors.lzx` `lz.colors` block
   (2515 bytes — each `lz.colors.X = N;` on its true file line, hex-folded, spaced,
   `;`-joined; durable regression in `harness/debug.mjs` test 3). **The
   Class.make-OPENING directive line rule (verified on 8 named classes):
   `directive = (line of the start-tag's closing `>`) − 1`** — the multi-line
   `<class>` (basefocusview: `<` on line 2, `>` on line 4 → directive #3)
   discriminates it from the `<`-line. Script statements use exact JavaCC lines
   (no −1). STILL OPEN: (a) `xml.ts` currently stores the `<`-line, not the
   `>`-line−1 the directive needs — SOLVED in s19 (`xml.ts` `endLine`); (b) the
   synthetic CONSTRUCTOR's source line — SOLVED in s19: it is the class's LAST
   code-generating member line (member-less → classLine+3). The s18 figures here
   (debug=15, basefocusview=8, …) were the first-SETTER line, not the constructor;
   see the Session 19 note above for the correct rule and the verified renderer.
3. **try/catch + `$reportException` structural codegen** — handler / constraint-
   setter / deps / constructor bodies are wrapped `try { <body> } catch
   ($lzsc$e) { if (($lzsc$e is Error) && ($lzsc$e !== lz['$lzsc$thrownError'])) {
   $reportException("<file>", <line>, $lzsc$e) } else { throw $lzsc$e } }`
   (JavascriptGenerator ~1290; the `is Error` uses `makeIsExpr`, already
   supported). Plus the debug dependency form
   `$lzc$validateReferenceDependencies`. ($debug=true folding is DONE.)
   gensym-count-neutral (1268 holds) → pure token rendering. The `<file>`/`<line>`
   here is the per-class constructor line (item 2b).
4. **Class.make / instance compress=false scaffolding renderer** — `compile.ts`
   builds each `Class.make("…",[props],Super,[classprops])`, the mergeAttributes
   block, `lz.colors.X = N`, instances, and `LzInstantiateView` as COMPRESSED
   strings; the debug build must render the array/object STRUCTURE spaced (method
   BODIES already render compress=false via sc) with the item-2 directives, then
   feed the whole top-level-statement stream through `assembleDebugProgram`. This
   needs `compile.ts`'s assembly refactored to a top-level-statement LIST (the
   header at item 1 is already a list; the body still concatenates).
5. **The 850KB cascade grind** — every node's source line exact, zero tolerance
   (one off-by-one cascades through `linediff` AND the shared `$m` counter, since
   the library consumes hundreds of `$m` before the app's own class).

The session-14 push landed the **multi-frame `<resource>` GIF montage**
(`media-resources-$3`): a GIF frame in a montage (`infos.length > 1`) is routed
through the documented `GIF89a.gifToSwf` scale (`.999` as 16.16 fixed-point,
`65470/65536`) then floored to its sprite cell — e.g. a 105×110 GIF montages to
104×109 — reproduced exactly in the compiler (no SWF DefineShape codec port,
no harness fuzzing; single-frame resources keep honest pixel dims + the harness
round). Fixture `p_gifmontage`. Session 14 also **investigated the debug arc and
confirmed it disproportionate** (see the `debug="true"` refusal comment): the
readable backend's `/* -*- file: X#N -*- */` directives need an exact per-node
source line on every AST node across the entire ~850KB debugger closure (XML
line tracking matching JDOM + embedded-script offsets matching JavaCC + exact
generated-line counting for the blank-line padding), with zero partial credit —
the canonical "exact source-map positions" case, for a dev-only artifact.

The session-13 push closed the ENTIRE remaining non-debug tail:

- **AS3 `class` declarations in `<script>`** (`sc.ts` `classDecl`/`printAs3Class`):
  `class Name [extends Super] [with Mixin…] { var…; function…; <stmts> }` →
  `Class.make("Name",[<instance var name/value pairs>, constructor→
  "$lzsc$initialize", methods],<super | [mixin…,super]>,[<static props>])`;
  `mixin` → `Mixin.make`; class-body statements move to a post-make
  `(function($0){with($0)with($0.prototype){{…}}})(Name)` initializer; `with(this)`
  is refined by the class's instance properties when resolvable (a "complete"
  class), else the raw-free rule. The `<script>` element transform now hoists
  function declarations (`name=void 0;` then `name=function(){…};`) and strips
  `var` from all script-scope declarations (script-element globals). The `sc`
  grammar also gained `try`/`catch`/`finally`/`throw`, `const`, nullable type
  annotations (`Type?`), `super(…)`/`super.m.call(…)`/`super.m.apply(…)`
  dispatch, and object keys that preserve their source form (string vs identifier).
- **Canvas-level members**: a `<canvas>` with `<method>`/`<handler>` children
  becomes an anonymous `$lzc$class_mN` subclass of `LzCanvas` (allocated FIRST),
  emitted as `canvas=new $lzc$class_mN(null,{…})`; a canvas-level `<attribute>`
  adds its value to the canvas instance attrs.
- **`<datapath>` with methods/handlers** routes inline like a `<state>`
  (canHaveMethods=false: `$datapath:{attrs:{…methods…},"class":LzDatapath}`); a
  `datapath="${…}"` **constraint** declares its setter/deps as void-0 class slots
  with the closures installed inline (NodeModel.java:1046).
- **Non-canonicalizable color values** (e.g. `"gray90"`) become `when="once"`
  constraints (`LzOnceExpr` + raw `convertColor` setter) instead of a plain
  literal — color attributes are when=once, constant-folded only when resolvable.
- **`<interface>`** emits nothing; its instances use `tag:"name"` deferred
  indirection (`{attrs:{…},tag:"name"}`), not `"class":…`. `inheritsChildren`
  now follows `ClassModel.inheritsChildren` exactly (a super with no compile-time
  node model — an interface — is assumed to inherit children → `mergeChildren`).
- **`<include type="text">`** splices the referenced file's raw text as a text
  node (folded into the enclosing element's text via addText).

The earlier (session-≤12) tail also landed: multi-frame resource enumeration
(a `src` naming a directory or a `.swf` enumerates its sorted PNG frame set —
spinner byte-for-byte; `logo.swf`'s arbitrary JVM `File.list()` frame ORDER is
normalized in the harness, frame set + dims verified), `resource="http:…"` URL
passthrough (→ `source` attr), `do…while`, `$immediately{…}` (immediate computed
value) and `$always{…}` constraints, and `<splash>` (a SWF-only no-op). The
**component-closure push** is complete through the cross-class
ordering subsystem: the `.swf`→`.png` resource resolver substitution
(`FileResolver`'s DHTML rewrite: a `.swf` ref resolves to a sibling `.png`, or
`autoPng/<name>.png`, searching the defining file's own dir first) unblocked the
whole `<button>`/component-library subsystem — the `.swf` demos compile the full
LZX-authored component closure (button/scrollbar/window/list/slider/…)
byte-for-byte.

The session-11 push closed the LAST 8 diffs (all cross-class ordering):
- **On-demand forward-reference class compilation** (`compileClass`,
  `ClassModel.compile`/`emitClassDeclaration`): a class is emitted at most once, in
  the oracle's DFS order — its superclass first (ClassModel.java:698), then its
  instantiated default-child classes (triggered in `NodeModel.asMap` during the
  emit pass, in child order), then its own `Class.make`. So `slider` (which
  instantiates `<slidertrack/>` → `<sliderthumb/>`) emits as `sliderthumb`,
  `slidertrack`, `slider`. The shared `$m`/`$LZ` counters are consumed in exactly
  this order: a per-class **build pass** (allocates method names for the whole
  subtree) then an **emit pass** (allocates anon-class names + triggers forward
  refs), interleaved across the dependency graph via recursion. Registrations
  (`lz[name]=…`) and resource registration follow this emission order.
- **Order-dependent `totalSubnodes` count**: the `LzInstantiateView` node count is
  computed at a class's build time, so a child that instantiates a not-yet-compiled
  class counts as 1 (NodeModel.java:707) — not its full subtree. `storedCount` is
  recorded per class in `emitClassDef`.
- **Library compile order = sorted canonical path** (`getLibraries` +
  `handleAutoincludes`): all referenced-tag libraries — including explicitly
  `<include>`d ones whose tag is referenced — compile in a sorted prefix before any
  canvas content, with each library's own `<include>`s expanded depth-first
  (dedup). So `base/basebutton.lzx` (sorts before `base/basevaluecomponent.lzx`)
  compiles first; the document-order splice of an explicit `<include>` no longer
  wins. This also fixed the resource-registration order (focus before scrollbar).
- **Class-level `<datapath>`**: a `<datapath>` child of a `<class>` now installs
  `$datapath:<asMap>` + `datapath:LzNode._ignoreAttribute` and a `"$datapath",
  void 0` decl slot AFTER `$lzsc$initialize` (NodeModel.updateAttrs adds it last).
- **Boolean values pass through as expressions** (ViewSchema BOOLEAN_TYPE): a
  `type="boolean" value="null"` emits `null`, not `"null"`.

`canvas debug="true"` (77, debugger component library) and `<debug>` (6) remain
refused cleanly — debug-build support is a separate backend (readable output +
source-map + the 850KB debugger library). AS3 `class`/`interface` declarations,
the `<stylesheet>`/`$style` subsystem, `$path{}` constraints, and
`<switch>`/`<when>`/`<unless>`/`<otherwise>` compile-time conditionals are done.

Recent fixes (session 10, 16→9 diff): the inherited `when="once|always"`
style-system propagation is now wired on the **instance** path too (a
`<multistatebutton reference="parent">`, where `reference` is declared
`when="once"` in basebutton, emits the standard once-setter + `LzOnceExpr` — this
closed the multistatebutton off-by-one cluster); nested **prefix-unary** parens
(`!!x`→`!(!x)`, `maybeAddParens` default `assoc=false` ⇒ `<=`); the full DHTML
runtime-constant fold set (`$as2`/`$swf7`/`$swf8`/`$svg`→false, `$js1`→true) with
dead-branch elimination that **flattens** a surviving block branch (`if($js1)
{return v}`→`return v`, no braces); the `with(obj){…}` **statement** (was
misparsed as a call + separate block); `<include>` of a non-`<library>` file now
splices the included file's **root element itself** (Parser.java:739, not its
children) and is not deduped (so two `<include>`s of a `<button>` file yield two
buttons); `allocation="class"` attributes emit as class (static) properties
prepended to the Class.make class-prop array, not instance slots; and **function
declarations** in a body (`function f(a,b){…}`) are hoisted like the oracle —
`var f;` at the body top, then `f=function(…){…};`, with `f` a renamed local
(nested/script-context function declarations refused).

This push landed (all verified byte-for-byte; fixtures held at 0 diff):
- **`.swf`→`.png` resource resolution** (`src/node-io.ts`): DHTML rewrites a
  `.swf` ref to `.png` and searches each base dir for `<dir>/<png>` then
  `<dir>/autoPng/<png>` (FileResolver). Resources/refs now resolve against the
  **defining file's own directory** (an `origin` field is stamped on every
  element during include-expansion and threaded into `resolveResource`), not
  just the app dir — so component-library `<resource>`/`resource=` refs
  resolve. Multi-frame `<resource>` dims are PNG pixel dims (max across frames).
- **Preamble order fixed**: resource-library defs and `LzFontManager.addFont`
  lines now append to ONE buffer in document order (the oracle's single
  `mResourceDefs`), with `__allcss` last (was: all fonts then all resources).
- **Empty block `{}`** (`sc.ts` `bodyOf`/ensureBlock): `if(c){}`/`while(c){}`
  with an empty body emit `{}`, not `{\n\n}` (an empty statement-list prints as
  "" then ensureBlock wraps to `{}`).
- **Rest parameters** (`args="...name"`): removed from the formal list and
  desugared to a body prologue `var name=Array.prototype.slice.call(arguments,
  <argno>);` (the free `Array` forces `with(this)`).
- **`%` constraints on class-tag attributes**: a `width="100%"` on a `<class>`
  tag now allocates its setter/deps `$m` in document order (was only handled on
  instances), so it interleaves correctly with sibling `${}` constraints.
- **`<state>`-child name hoisting into a class** (declareNamedChildren): a class
  with `<state>` children declares the states' named children as deduped
  reference slots (was done for state instances only).
- **`html`→`text` type alias** (ViewSchema): a `type="html"` attribute's
  constraint type string is emitted as `text`.
- **Named-child slot interleaving**: a regular named view child's `"name",void 0`
  reference slot interleaves with methods/attrs in document order within the anon
  class (state-hoisted names still append after).
- **Inherited `when="once"` propagation** (the style system): a plain value on an
  attribute whose inherited `<attribute>` decl is `when="once|always"` becomes a
  literal constant constraint with that timing (standard once-setter; color type
  → `convertColor`). Enables `silverstyle extends style` and friends.
- **Nested-conditional parens** (`sc`): all three `?:` operands are parenthesized
  when their precedence is `<= prec(COLON)`, so `a?b:(c?d:e)` keeps its parens.
- An `<attribute setter=… />` with no value emits `name:void 0` in the instance
  attrs.

### Rich text / HTML-in-text

The text content of a class with a `text` instance attribute (e.g. `<text>`,
`<inputtext>`, or a user subclass / a class declaring `<attribute name="text">`)
is folded into the `text` attribute (`NodeModel.addText`). For an HTML-content
element this is a port of `TextCompiler.getHTMLContent` + the `LineMetrics`
whitespace state machine: XHTML markup (`<b>`/`<i>`/`<font>`/`<a>`/`<img>`/`<u>`/
`<ul>`/`<li>`/`<ol>`) is serialized raw (`<img/>` → `<img …></img>`), text spans
are XML-escaped and whitespace-normalized like browser HTML (runs collapse to a
single space, leading/trailing trimmed across element boundaries), `<br>` emits
`<br/>` (with trailing-space deletion), and `<pre>` switches to verbatim mode
(whitespace preserved, tag dropped). An `<inputtext>` element instead takes
`getInputText` (no HTML; only `<br>`/`<p>`→newline and `<pre>`→verbatim text).
HTML markup elements are never view children (ignored in `addChildren` and
`childViews`). The result string is emitted via `jsString` (= `ScriptCompiler.
quote`). The canvas's own `layout=` attribute now autoincludes its layout class.

### `<stylesheet>` / `$style` (CSS)

`src/css.ts` ports `org.openlaszlo.css.CSSHandler` + `StyleSheetCompiler`. A
`<stylesheet>` becomes an IIFE
`;(function(){var $0=LzCSSStyle,$1=LzCSSStyleRule;$0._addRule(new $1(<sel>,<props>))…})()`
emitted in document order; the selector/property JS is run through the `sc`
stage (which renames the two locals to `$0`/`$1`, folds `0xRRGGBB` hex colors to
ints, and requotes strings) exactly as the oracle's `mEnv.compileScript` does
— so byte-for-byte falls out for free. Selectors: element (`{s:1,t:"…"}`), id
(`{i:"…",s:100}`), attribute (`{a,s:10[,v][,m]}`, `+1`/`t` with an element
part), `.class` (styleclass `~=`), and the descendant combinator (an array,
ancestor-first). Property values: hex/`rgb()` colors → `0x…`, quoted strings,
ints/reals, bare idents → `LzStyleIdent`. A `$style{'prop'}` constraint on a
constant property → `new LzStyleConstraintExpr(name, type, prop)` (compact init,
no `$m` counter, no void-0 slot on inherited attrs). Unsupported CSS
(`!important`, percentages/dimensions, `url()`/`resource()`, `>`/`+`/`~`
combinators, compound AND conditions, non-constant `$style`) refuses cleanly.

## Layout

- `src/xml.ts` — dependency-free XML/LZX parser (preserves attribute order, text, CDATA).
- `src/value.ts` — JS literal emission. Object keys sorted in Java String (UTF-16)
  order; reserved-word keys (`class`) quoted. `javaDouble` mimics `Double.toString`
  (`30.0`); `jsNumber` emits integral values bare (`50`).
- `src/colors.ts` — 147 named colors + `parseColor` + `canonicalColorHex`, ported
  verbatim from `ViewSchema.java`.
- `src/schema.ts` — attribute type table (number/string/boolean/color) for
  literal-value compilation. **Curated**; the constraint-type source below is
  the authoritative one.
- `src/schema-types.ts` — **auto-generated** from the oracle schema
  (`WEB-INF/lps/schema/lfc.lzx`): every built-in class → `{extends, attr→type}`.
  `schemaAttrType(tag,name)` walks the extends chain. Used for the
  `LzAlwaysExpr` constraint type string (e.g. `numberExpression`, `size`).
  Regenerate from `lfc.lzx` (extractor scans `<interface>`/`<attribute>` tags).
- `src/compile.ts` — the compiler: `<canvas>` + nested built-in views.
- `src/cli.ts` — `lzc-ts <file.lzx>` → JS on stdout (exit 3 = UNSUPPORTED).

## Status

Byte-for-byte verified:
- **Milestone 1** — canvas (defaults + build constants + overrides, sorted keys),
  nested built-in views (`children:[…]`, 2nd arg = subtree node count), attribute
  typing incl. the canvas-vs-view color asymmetry, booleans, numbers.
- **Milestone B** — script-free `<class>` definitions (templated): named classes,
  inheritance chains, default attrs, instances (incl. with children), the
  with-attrs vs no-attrs class forms, deferred `lz[name]` registration. Class
  bodies with child elements / methods are refused (need the `sc` stage).

- **Milestone A (in progress)** — `src/sc.ts` is a dependency-free JS compiler
  (lexer, Pratt parser, local-renamer `$0,$1,…`, printer matching the oracle's
  `compress=true,obfuscate=false` formatting), plus free-variable analysis for
  `with(this){…}` insertion and a `ReferenceCollector` subset for constraint
  dependencies. Byte-for-byte verified:
  - `<method>` bodies and `<attribute>` declarations/defaults.
  - **`<handler>`** — gensym `$m` body method (implicit `$lzc$ignore`→`$0` arg),
    `reference=` method (allocated *before* the body method),
    `$delegates:[event,method,ref|null]`, auto-`clickable:true` for mouse events.
  - **constraints `${…}`** — setter (`$mI`) + dependency (`$mJ`) methods +
    `LzAlwaysExpr(name,type,$mI,$mJ,null)`, in three forms: class default-attr
    (methods then the void-0 slot), class-tag attr, and **instance** (anonymous
    subclass via `displayName`, instance `attrs` carry the `LzAlwaysExpr`). Each
    method independently gets `with(this)` when it has free references; the deps
    `with` decision follows the *collected* bases (bare `x`→`[this,"x"]` no `with`;
    `parent.x`→`[parent,"x"]` `with`). Refuses function-call dependencies,
    `$once/$path/$style`, untyped-attr constraints, and constrained instances
    with child views (class-children machinery — next).

- **Instances — fully general (build/emit two-pass).** `buildNode` allocates all
  method `$m` gensyms (pre-order, the model-build pass); `emitNode` allocates
  anon-class names (pre-order) and emits child classes *before* parent (the
  asMap/emit pass). This handles arbitrary nesting byte-for-byte: handler
  attributes (`onclick="…"`), `<handler>`/`<method>` children, constraints, and
  any mix — each method-bearing node becomes an anonymous subclass; non-method
  props (incl. `$delegates`, `clickable`, `LzAlwaysExpr`, id/name binders) stay
  on the instance.
- **Class-children + counts.** Default children become a `"children",[…]`
  class-property (or `LzNode.mergeChildren(…, Super['children'])` when inherited),
  with `$classrootdepth` on *named*-class children only (incrementing by depth).
  `LzInstantiateView` counts use `totalSubnodes` (seeds from the class's default
  children, recursively + inherited, plus own children).
- **id / name.** `id` (always) and top-level `name` emit a `var <sym>=null;`
  global prefix + a `$lzc$bind_id`/`$lzc$bind_name` binder (instance attr, not a
  method) + the `id`/`name` attr; a nested `name` instead declares a
  `<name>:void 0` reference slot on the parent.
- **`with(this)` rule corrected:** a generated method is wrapped iff its body has
  ANY free identifier (not a local/param) — globals are NOT subtracted for anon
  classes (a free `lz`/`Math` forces the wrapper). Empty function bodies emit `{}`.

- **Resources (single-frame raster).** `resource="file"` → a `$LZ` library entry
  `LzResourceLibrary.$LZ<n>={ptype,frames:['relpath'],width,height,spriteoffset}`
  (the second per-compile gensym) + `resource:"$LZ<n>"` on the instance +
  `LzResourceLibrary.__allcss={path:'…'}`. Dimensions read from the file header
  (`src/imagedim.ts`: PNG/GIF/JPEG, no decode). I/O is injected
  (`src/node-io.ts` for Node; a fetch-based resolver for the browser). The oracle
  routes images through Flash so GIFs get a sub-pixel artifact — the port emits
  true pixel dims and the harness rounds resource dims (PNG/JPEG stay exact).
  Preamble order: resource library → id/name globals → canvas.

- **`<include>` (splice + compile).** `<include href=…>` is expanded in a
  preprocessing pass (`expandIncludes`) that splices the referenced file's
  top-level elements in place and compiles them inline (cross-file `$m`/`$LZ`
  gensym falls out of document order). Resolution searches the including file's
  dir then the LFC component base (`<LPS_HOME>/lps/components`), via injected I/O.
  Idempotent per file; no pruning (matches `<include>` semantics). Real component
  libraries now resolve/splice; full apps then hit the next tag gaps.

  **Remaining**: the long tail of component constructs (`<node>`, `<script>`,
  mixins, `<library>` auto-resolution, `<dataset>`/`<record>`, `<font>`,
  `<splash>`, `<html>`, `<debug>`), sprite-sheet generation + `.swf` dims, the
  component-closure machinery (event/attr inheritance is done; the
  `setAttribute('const',v)`→setter rewrite and LFCTag2JSClass special names
  remain). The `sc` grammar now covers `for…in`, the OL `is` operator,
  `switch`, **type annotations** (`var x:Type`, typed params/return — erased like
  `cast`), and **function expressions** with closure-capture renaming (a variable
  closed over by a nested function keeps its name; non-captured params/locals get
  `$<base36>` registers; each function has its own counter; `withThis` methods
  re-declare closed params inside the with-block). AS3 `class`/`interface`/`import`
  declarations in `<script>` are refused cleanly. Register names are base-36
  (`$a`=10). Multi-frame `<resource name>` is done (GIF-frame ones refused —
  montage dims need the SWF codec). **`<font>`** emits
  `LzFontManager.addFont(face,style,weight,relPath,ptype)` preamble lines (font
  src resolved via app dir → components → `lps/fonts` → LFC); a `layout=` CSS
  attribute autoincludes its layout class (default `simplelayout`).
  Autoincludes splice in **sorted canonical-path order** (a TreeSet of library
  files), with each library's `<include>`s expanded during that sorted walk so a
  shared dependency attaches to the first library that needs it; references are
  collected from the app tree only (including `extends`). The **`<state>`
  classroot machinery** is done: `$classrootdepth` does not increment through a
  state node (state children get depth 0); a state instance counts as a single
  subnode (delays its children); named children of a state instance are hoisted
  up into the enclosing classroot as reference slots; a state instance installs
  members inline (no anon class, no void-0 slots). Unknown constraint attribute
  types default to `expression`, and a `<state>` tag attribute resolves its type
  against the DOM parent's class. The `super.X(args)` dispatch implements the
  `super.setAttribute(CONST,v)`→`$lzc$set_<CONST>(v)` setter rewrite.

Zero *wrong* outputs across the corpus (0 diff) — unsupported constructs are
refused cleanly rather than miscompiled. The ONLY remaining clean-UNSUP cases are
debug builds (`canvas debug="true"` + `<debug>`, a separate readable/source-map
backend + the debugger library) and one GIF-montage resource (needs the SWF
DefineShape fixed-point codec for montage dims).

## Browser track (compile LZX in the browser)

The compiler core has no `node:` imports, so it runs in a browser. The `"./browser"`
entry (`compileInBrowser`) fetches an app + its dependency closure over HTTP and
compiles in-page via a fault-and-retry preload loop, with closure-based caching
(CacheStorage). Output is **byte-identical** to the Node `compileFile` path (gate:
`npm run test:browser`, asserting hello/calendar/dashboard byte-== Node). A
self-contained ESM bundle (`npm run bundle:browser` → `dist/lzc-browser.js`) and a
live `demo/index.html` are included. Full details: **README-BROWSER.md**.

## Key invariant (do not break)

The oracle uses two per-compile base-36 counters consumed **in traversal order**:
`$LZ…` (resources) and `$m…` (shared by generated method names AND anonymous
class names, via `methodNameGenerator.next().substring(1)`). Byte-for-byte output
depends on consuming these in the exact order the Java compiler does. Fetch order
may be parallelized later, but **compile/emit order must stay canonical.**
