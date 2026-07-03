# DEBUG-BUILD BYTE-FOR-BYTE GRIND — RELAY HANDOFF

## ✅ BACKTRACE **COMPLETE — RAW IDENTICAL byte-for-byte (1340227=1340227), refusal FLIPPED, check-debug 78/78** (2026-06-25)
THE FINAL CASE (@1294170, the lone remaining divergence the prior worker left at 96.6%) was CLOSED by a
**ONE-LINE fix** — far smaller than the prior worker's "global currentPath threading / parseFragment ordering /
extreme risk" diagnosis feared. The blocker was debugger.lzx `addText`'s catch `trace@951`: GOLD `/* -*- file:
#1 -*- */` (currentPath = file) vs MINE `/* -*- file: -*- */` (currentPath = ""). The `-SS` lineann GROUND TRUTH
(`backtrace-lineann-184.txt`, displayName "addText") showed ALL noteCallSite markers in the body = `#fileline
0#0: #fileline 40#1` (cp = file 40), set by the **`is` operator** at line 945 (`msg.toHTML is Function`). The
oracle re-lexes the generated `B.$lzsc$isa(a)` call from source → it flips `Token.currentPathname` to the real
file for the REST of the body, EXACTLY like a super-dispatch or a function-value. Mine's `btSuperSeen` model
already handled super/function-value but NOT the is-expr. **FIX** (sc.ts Printer `call` case, gated
`SC_BACKTRACE`): `if (SC_BACKTRACE && this.btVar != null && n.c.k === "member" && n.c.p === "$lzsc$isa")
this.btSuperSeen = true;` — the user is-expr's `$lzsc$isa` call (from makeIsExpr) is the ONLY one reaching the
printer (the generated frame catch-wrapper's `Error.$lzsc$isa(...)` is a literal STRING via debugCatchBody*, so
it never hits here → no false trigger). That single set propagated cp=file through the catch and **`btshow` →
RAW IDENTICAL — byte-for-byte! (mine=gold=1340227)**. The HANDOFF's "model currentPath as a global threaded
across compile units, reset mid-body by parseFragments" turned out to be UNNEEDED — the per-body `btSuperSeen`
flag, with the is-expr trigger added, is sufficient for the whole 1340227-byte LFC.

**REFUSAL FLIPPED — backtrace now COMPILES in production** (compile.ts, the `wantsBacktrace` block ~L2407):
removed the `if (isDebugBuild && wantsBacktrace && !opts.debug) return refuse;` block; `debug = (opts.debug ===
true || isDebugBuild || wantsBacktrace) && !canvasDebugOff` (backtrace forces debug on); `backtraceWanted =
wantsBacktrace` (no longer gated to forced-debug). A `compileroptions="…backtrace: true"` canvas (e.g.
backtrace.lzx) now produces the real DEBUG_BACKTRACE build in BOTH proxied (`check`) and SOLO (`check-ol`,
btshow) modes. The `.goldcache/backtrace.lzx.gold` (proxied) + `.goldcache-ol-corpus/backtrace.{nd,dbg}.gold`
(SOLO) were already current against the patched oracle (FIX #1/#2/#3) — `check`/`check-debug`/`check-ol` all
diff 0, so NO regen was needed.

**FULL GATE — ALL GREEN, ZERO regressions (run 2026-06-25):**
- `btshow` → **RAW IDENTICAL — byte-for-byte! (1340227=1340227)**
- `dbgshow /tmp/dbg3.lzx` → **RAW IDENTICAL @845661** (the critical guard)
- `check` → **346 ok, 0 diff, 0 unsup** (was 345/0/1 — the lone backtrace unsup is now ok)
- `check-debug` → **78 match, 0 diff, 0 unsup** (was 77/1/0 — backtrace was the lone diff)
- `check-explorer-solo` → **62/0/0**;  `check-explorer-debug` → **62/0/0**
- `check-dashboard` → **BYTE-IDENTICAL @432082**
- `check-ol corpus` → nd **346/346**, dbg **344/344** (was nd 345, dbg 343 — backtrace was the lone holdout in BOTH)
- `harness/debug.mjs` → all debug-pipeline tests passed
Files changed: `openlaszlo-5.0/compiler/src/{sc.ts (is-expr btSuperSeen set), compile.ts (refusal flip)}`. No
oracle patch touched. **PHASE 2/3 backtrace track = DONE. The DEBUG-BUILD byte-for-byte grind is COMPLETE.**

---
### (Historical) BACKTRACE frontier @150786 → @1294170 (96.6% of 1340227; bytes mine=1340222 gold=1340227), refusal STILL LIVE (2026-06-25)
THE BIG UNLOCK this session: ran the oracle's STOCK **`-SS` flag** to dump per-script
`*-lineann-*.txt` (printableAnnotations: every annotation as `#fileline <FID>#<LINE>`, FID 0 = the
generated/"" file) — GROUND TRUTH for the noteCallSite marker line-state. Recipe (no oracle patch):
```
java -cp <patch/classes:libs:classes> -DLPS_HOME=$WEBAPP -Dlps.config.dir.abs=<debug-solo-config> \
  org.openlaszlo.compiler.Main --debug -SS --runtime=dhtml --dir /tmp/btss -o backtrace.dhtml.js /tmp/btss/backtrace.lzx
# → /tmp/btss/backtrace-lineann-<N>.txt, one per compileScript unit. `grep` for the call you're diffing.
```
**THE noteCallSite MARKER MODEL (cracked via -SS).** A noted seq is `[gen #0#0][currentPath#1]$lzsc$a.lineno
= L, <inner>`. The `#0#0` is the generated ASTExpressionList (beginLine 0). The `#<currentPath>#1` is the
`$lzsc$a.lineno = L` fragment, parsed FRESH (`new Parser().parse`, JavascriptGenerator:733) → it inherits
`Token.currentPathname` (a GLOBAL JavaCC lexer static) at line 1. **currentPath = the real source file when a
super-dispatch OR a function-value (or other source-lexing op) was the last thing generated before the
marker; "" (→ `#0#0`, suppressed) when a `parseFragment` (`#file [CommonGenerator.parseFragment]`, starts
`[` → isActualFile false) was.** At statement head this renders `/* -*- file: #1 -*- */` (path omitted, same
file as context) when file; `/* -*- file: -*- */` when "". Mid-expression it is invisible (atBol false).

**LANDED this session (all gated `backtrace`/`SC_BACKTRACE`/`COMPILE_BACKTRACE`, INERT elsewhere — gate proven
GREEN, see bottom):**
- **`Printer.btSuperSeen`** (sc.ts): the currentPath=file flag. Set true when a super-dispatch prints (the
  `call` case, `isSuperCall`) AND when a function VALUE prints (`printFunc`, AFTER renderDebugFuncNode so the
  enclosing call's cp — computed post-`expr(n)` — sees it). noteCallSite marker (sc.ts ~L1595):
  `annoFileLine(null,0) + annoFileLine(btSuperSeen ? dfile : "", 1)`. Closed basecomponent `_usestyle` #1,
  basebutton init, the sort-comparator case, etc.
- **funcdecl hoist SPLIT** (sc.ts compileFunctionDebug): under `bt`, the `var name;` DECLARATIONS hoist
  BEFORE the frame prefix (front of try body), the `name = function…` ASSIGNMENTS stay after — matches the
  oracle statement-list var-hoist (command.lzx keysToString `var map_$0;`). Non-bt keeps `hoist` together.
- **`Printer.dbgLocals`** (sc.ts): a body's ALL declared names incl. closed-but-unrenamed ones (`dk`), from
  new `Scope.locals` (= localSet). printFunc unions it into a nested function's `childOuter` (gated
  SC_BACKTRACE) so a free ref to an enclosing closed local is NOT noted (command.lzx inner closure `dk`).
- **`SC_KNOWN_IDS`** (sc.ts addKnownId/resetKnownId; compile.ts populates at the 3 `globals.push` sites +
  reset): a reference to a DECLARED global id/name (oracle ToplevelCompiler.computeDeclarations → globals) is
  not a checked ref → not noted (tooltipview `id="tp"` → `tp` ref). ⚠️ **populated INCREMENTALLY during the
  walk** — a method referencing a global declared LATER in the doc would still wrongly note it. If a
  forward-ref divergence appears, switch to a PRE-PASS that collects all id/name before generation.
- **array element parens** (sc.ts `case "array"` → `wrap(e,1)`, NOT gated — verified inert): a comma-seq
  element (a noteCallSite) is parenthesized so its comma is not the array separator (`["y", (… , call)]`).
- **`btNoteColorInit`** (compile.ts): a CLASS-DEFAULT plain `LzColorUtils.convertColor("0x…")` value is a
  noted call: `($3.lineno=N, ($3.lineno=N, LzColorUtils).convertColor(…))`. Applied at the class-default
  color branch (~L3313). `#0#0` markers (mid-object, invisible).
- **`debugMergeAttributes` N1** (compile.ts): the mergeAttributes call marker gets `#<file>#1` ONLY for a
  DIRECTIVE-FORM (state-class, `mergeLine != null` ≡ `!memberRich`) constructor; a plain constructor stays
  `#0#0` (basefocusview). `btNoteConstraintInit` reverted to `#0#0` (mid-object inits are invisible either
  way; the `file`/directive-form refinement is deferred — see `void file`).

**THE REMAINING BLOCKER (next divergence @1294170): the currentPath model is INCOMPLETE.** `Token.current
Pathname` is a GLOBAL static that **persists ACROSS method/compile-unit boundaries** and is also RESET to ""
by `parseFragment` MID-body — neither modeled (btSuperSeen is per-Printer, resets each body, only SETs).
Proof (lineann-184 = debugger.lzx LzDebugWindow): within ONE method, `push@509` = `#0#0` ("") but
`sort@535` = `#0#0 #40#1` (file, set by the sort's function ARG generated before the marker — handled now);
and `addText`'s catch `trace@951` = file in gold but MINE "" because currentPath was set FILE in an EARLIER
unit and persisted in (no reset in addText), while MINE's per-body flag reset it. The `is` operator
(`msg is Function` → generated `$lzsc$isa` call) generation likely also flips currentPath=file. **TO FINISH:
model currentPath as a SINGLE module-global that threads the WHOLE generation in order — SET file by
super-dispatch / function-value / is-expr / any source-lexing fragment, RESET "" by the frame
prelude/prefix/suffix parseFragments at each function body entry — persisting across bodies.** Use `-SS`
lineann as the oracle for every case (grep the `#fileline 0#0` vs `#fileline <FID>#1` before each
`$N.lineno`). This is the documented "parseFragment ordering / extreme risk" area — proceed case-by-case
against -SS, holding the gate.

**GATE — ALL GREEN, ZERO regressions (run 2026-06-25):** dbg3 RAW IDENTICAL @845661; check 345/0/1
(backtrace unsup); check-debug 77 match / 1 diff (backtrace @1294169, the 77 non-backtrace UNCHANGED);
explorer-solo 62/0/0; explorer-debug 62/0/0; dashboard BYTE-IDENTICAL @432082; check-ol corpus nd 345/346,
dbg 343/344 (backtrace the lone diff). Files: openlaszlo-5.0/compiler/src/{sc.ts,compile.ts}. No oracle
patch touched. The non-gated `wrap(e,1)` array change verified inert (gate green).

### (Superseded) ORACLE FIX #3 LANDED (LPP-3949) — backtrace frontier @133424 → ~150786, refusal STILL LIVE (2026-06-25)
ORACLE FIX #3 (`modern-build/oracle/patch/src/NodeModel.java`, README §3) closes the class-default
`mergeAttributes` constraint-init line-state blocker that defeated the @133424 frontier. It is a
**principled oracle bug-fix** (completing the authors' LPP-3949 TODO at NodeModel.java:474-477): in a
DEBUG_BACKTRACE build ONLY, each synthesized `new LzOnceExpr/LzAlwaysExpr/LzConstraintExpr/
LzStyleConstraintExpr(...)` class-default init is wrapped in the same `#beginAttribute … srcloc …
#endAttribute` directive the adjacent WHEN_IMMEDIATELY path emits, so the backtrace `noteCallSite`
records the attribute's DECLARATION line (style.lzx basecolor→44, bgcolor→49, …) instead of the running
JavaCC physical line of the generated object (the old wrong 161/14/100). Gated on
`env.getBooleanProperty(BACKTRACE_PROPERTY)` → INERT for normal-debug + production.

**BLAST RADIUS — PROVEN (not asserted):** `regen-debug` = **1 changed (backtrace), 77 unchanged, 0 failed**;
`dbgshow /tmp/dbg3.lzx` = **RAW IDENTICAL @845661** (large non-backtrace debug build, live patched oracle).
The patch moves ONLY the backtrace gold. Regenerated golds: `.goldcache/backtrace.lzx.gold`,
`.goldcache-ol-corpus/backtrace.{nd,dbg}.gold` (all now declaration-anchored).

**This session also advanced the TS backtrace backend** (all gated on `backtrace`, INERT elsewhere):
- **ORACLE FIX #3 TS mirror** (`compile.ts` `btNoteConstraintInit`): wraps each class-default constraint
  init `new CTOR(args)` → `(GEN $3.lineno=N, new (GEN $3.lineno=N, CTOR)(args))`, N = attr endLine.
  Applied at the 5 class-default `defaultAttrs[...] =` sites (class-tag constraint/style/color +
  `<attribute>` constraint/style). Closed the style class → @136124.
- **`<script>`-instance backtrace frame** (`sc.ts` compileScriptBodyDebug): the `<script>` element's
  `script:` function VALUE bypasses renderDebugFuncNode, so the frame was wired in directly (btPrelude/
  btPrefix/btSuffix/debugCatchBodyBacktrace, literal $lzsc$d/$lzsc$s/$lzsc$a registers, `_dbg_filename`/
  `_dbg_lineno`); `printer.dbgFree = computeFree([], ast)` so body bare-id calls/refs (`canvas`, …) note.
  → @149271.
- **`is`-operator generated call note** (`sc.ts` makeIsExpr): the generated `B.$lzsc$isa(a)` CALL now
  carries the `is` token's source line so it noteCallSite-wraps. → @150786.

**STILL NOT byte-identical** — the remaining divergence (@150786) is the next generated-call noteCallSite
case (`$2.lineno = 151, _usestyle()` and a tail of similar LFC bare-id calls). This is the open-ended
`noteCallSite`-completeness grind the project documents as multi-hour ("treat 99.99% as optimistic"):
each fix exposes the next class. Production `compileroptions="backtrace:true"` therefore **STILL REFUSES**
(refuse-don't-miscompile; compile.ts ~L2420, message updated). To RESUME: `btshow` (@150786) →
note `_usestyle()` (a bare-id call in a `<method>` body whose call node lacks a line, or whose printer
context isn't noting it) and onward. Gate GREEN, ALL fixed points held: dbg3 RAW IDENTICAL @845661,
check 345/0/1, check-debug 77/1/0 (backtrace @150785), explorer-solo 62/0/0, explorer-debug 62/0/0,
dashboard BYTE-IDENTICAL @432082, check-ol nd 345/346 / dbg 343/344 (backtrace @150786 the lone diff).

### (Historical) BACKTRACE frontier @133424 progress (pre-FIX-#3)
The full `compileroptions="backtrace:true"` instrumentation is implemented behind a `backtrace`
flag (SC_BACKTRACE/DBG_BACKTRACE/COMPILE_BACKTRACE). Earlier-session fixes advanced the frontier
43857 → 66720 → 133424 (then FIX #3 + the 3 TS fixes above → ~150786).

### ⚠️ The "ONE residual / 99.99% / instance-property refinement" claim was a MISDIAGNOSIS.
The prior HANDOFF said the only thing left was an instance-property refinement (exclude `classroot` from
noting via `possibleInstance.retainAll(getInstanceProperties())`). **This is WRONG and was proven so by
the gold:** SETTER bodies DO note instance props — e.g. focusoverlay's x setter is
`var $1 = -($4.lineno = 27, classroot).offset` (classroot IS noted). The @43857 divergence was NOT instance
props at all; it was the constraint **DEPENDENCIES** method, which carries `#pragma
warnUndefinedReferences=false` (NodeModel.java:396) → `JavascriptReference` never makes a bare ref a checked
node → its bare-id refs are NOT noted (but its CALLs still are). DO NOT build a class-attribute enumeration
— it is not needed.

WHAT CLOSED THE @43857 + @66720 frontiers THIS SESSION (both gated on `backtrace`, INERT for dbg3/normal):
- **@43857 — deps-body warnUndefinedReferences=false.** New `Printer.btWarnUndef` field (default true). In
  `compileFunctionDebug`, `printer.btWarnUndef = catchKind !== "throws"` — the deps method is the unique
  `catchKind:"throws"` caller (it pairs throwsError=true with warnUndefinedReferences=false, NodeModel.java:395-396).
  `btNotableId` now returns false when `!btWarnUndef`, so deps-body bare refs (`classroot`, `parent`, `this`)
  are not noted, while `btNotableCall` (the `$lzc$validateReferenceDependencies(...)` call) still fires. Files:
  src/sc.ts (field + btNotableId gate + compileFunctionDebug set).
- **@66720 — super-dispatch nextMethod fallback noteCallSite.** In a method override, the `this.nextMethod(
  arguments.callee, "m")` FALLBACK of a super-dispatch is a generated CALL → noted at the super-call's source
  line: `(... || ($3.lineno = 57, this.nextMethod(arguments.callee, "doFocus")))`. Fixed in the sc.ts Printer
  `call` case: a `nextMethod(m)` helper wraps the call in `(${btVar}.lineno=${n.line}, …)` when `btVar != null`.

### THE REAL REMAINING BLOCKER (first divergence @133424): class-default mergeAttributes object-value noteCallSite line-state.
Under backtrace, EVERY value in the CLASS-DEFAULT `mergeAttributes({...}, X.attributes)` object that is a
`new LzOnceExpr/LzAlwaysExpr(...)` or a checked class ref (`LzDeclaredEvent`) is noteCallSite-wrapped:
`basecolor: ($3.lineno = 161, new ($3.lineno = 161, LzOnceExpr)("basecolor", "color", "$mx", ...))`. Only the
53 inits inside a backtrace FRAME (the debugMergeAttributes IIFE, frame reg fixed `$3`) are noted; the 172 in
static `children` arrays are NOT (those are top-level Class.make data → `context.findFunctionContext()==null`).
**The hard part is the note LINE.** It is NOT the attribute's declaration line — for the `style` class the
notes are basecolor/bgcolor/…→161, menuitembgcolor→14, selectedcolor/textcolor/…→100, onisdefault→82,
onstylechanged→98. Lines 161/100/14 are DOC/TEXT lines in style.lzx (basecolor is declared at 43!), i.e. the
oracle's RUNNING JavaCC line counter at each object position — the generated-line-state model the project
documents as a multi-hour grind (same class of wall as the else-super line model). The `LzDeclaredEvent`
events ARE already hand-noted at compile.ts ~L3414 (`$3.lineno = ${c.line}` — c.line happens to match for
events, 82/98 = the `<event>` line); the `new LzXxxExpr` inits are NOT, and their note line follows the
line-state, not c.line. RESUME: `btshow` (@133424). To close, model the running line-state through the
class-body annotation stream and wrap each class-default constraint init (compileConstraintDebug initExpr +
colorValue init, fed into `defaultAttrs` → debugMergeAttributes) with `($3.lineno=<state>, new ($3.lineno=
<state>, LzXxxExpr)(args))`. Likely MORE divergence classes beyond this once it lands — treat "99.99%" as
optimistic. Until byte-identical, production refusal STAYS (compile.ts ~L2399, message updated to name this
blocker). NOTE: the old refusal message ("instance-property checked-ref refinement unimplemented") was the
misdiagnosis and has been corrected in compile.ts.

EARLIER WHAT-LANDED (all gated on `backtrace`, INERT for dbg3/normal debug):
- **noteCallSite** (sc.ts Printer): every `call`/`new` (not super) + every CHECKED free-bare-id ref is
  wrapped `(<$lzsc$a>.lineno = <node.line>, <node>)` — a `seq` node (prec 0). The seq string is PREFIXED
  with a generated `#0` marker: the oracle's ASTExpressionList is line-0, and its marker overwrites
  `newLstate` so `curLstate` becomes generated after the statement flushes (the deferred-srcloc quirk in
  translateAnnotatedUnit) → each noted statement re-shows its full file directive, and NO reset emits
  before `catch`. Call CALLEE id is NOT noted (translateReferenceForCall); `new` callee IS (checked).
  Args/var-init wrap at prec 1 so seqs parenthesize. `line` added to `id` nodes (parser).
- **Function-body frame** (renderDebugFuncNode + compileFunctionDebug + debug.ts debugConstructor/Plain +
  compile.ts debugMergeAttributes): prelude `var $D=Debug; var $S=$D.backtraceStack;` (before try, inside
  withThis), prefix `if($S){var $A=[quote,p,…];$A.callee=…;$A["this"]=this;$A.filename=…;$A.lineno=…;
  $S.push($A);if(>maxDepth){stackOverflow}}` (front of try), suffix `finally{if($S){$S.length--}}`, catch
  reports `$A.lineno`. `$lzsc$d/$lzsc$s/$lzsc$a` reserved as the LAST 3 registers in analyzeScope.
  displayName gets `_dbg_filename`/`_dbg_lineno`. Constructors: fixed regs $4/$5/$6; the super-dispatch's
  `nextMethod` fallback IS noted (@ctorLine+1). Predefined known globals (SC_KNOWN_GLOBALS: builtins+lz+
  Debug+$report*) excluded from noting; class names ARE noted (checked).
- **(SUPERSEDED — see the corrected section above.)** The prior "instance-property refinement" residual was
  a misdiagnosis: setter bodies DO note instance props (`classroot`), only the deps body suppresses them via
  warnUndefinedReferences=false. The @43857 + @66720 frontiers are now CLOSED; the live blocker is the
  class-default mergeAttributes object-value note line-state (@133424).
Files: openlaszlo-5.0/compiler/src/{sc.ts,debug.ts,compile.ts} + harness/batch.mjs (btshow mode).


## ⚑ states-$7 CLOSED (2026-06-25): dbg 342→343/344, nd 345/346. The prior NO-GO was WRONG.
Metric `node harness/batch.mjs check-ol corpus`: nd 345/346 (unchanged), dbg **342→343/344** (only
backtrace remains, a true NO-GO). File changed: `src/compile.ts`. Gate GREEN throughout (fixtures 96/0/0,
check 345/0/1, check-debug 77/1/0 backtrace, explorer-solo 62/0/0, explorer-debug 62/0/0, dashboard
BYTE-IDENTICAL @432082, dbg3 RAW IDENTICAL @845661). ZERO reverts.

- **states-$7 — state-class-WITH-VIEW-CHILDREN synthetic ctor = PLAIN childOnlyRich form.** The prior
  worker's "re-lex count, not derivable" NO-GO was incorrect — it IS the ordinary childOnlyRich re-lex
  count. `-SS` PROOF (states7-src-149, the fadeDragger ScriptClass input string): the synthetic ctor
  `function $lzc$class_fadeDragger(...)` (loc=null) inherits the JavaCC lexer's running line counter, which
  is NOT reset by the trailing `#file ` blank (a `#file` resets the FILE but not the LINE). The last `#line`
  directive in the `children` static is the vShadow last-literal attr `#line 16` (= vShadow el.endLine 16),
  then the physical generated-source lines count down: content `10`(=src 16), `#file `blank(17),
  `}];`children-close(18), `static var attributes`(19), `var $mh0;`(20), `var $mh1;`(21), `var hShadow;`(22),
  `var vShadow;`(23), `function ctor`(24) → `$reportException("", 24)` in GENERATED context (`#fileline 0#0`
  → PLAIN form). So **ctorLine = lastChildLiteralLine + 4 + voidSlotDecls** — IDENTICAL to the existing
  childOnlyRich arithmetic (16 + 4 + 4 = 24; the 4 void slots are $mh0/$mh1/hShadow/vShadow, the handlers
  route to mergeAttributes so they're void decls). FIX (compile.ts ~L3493): a `stateChildRich` flag (state
  class + a child carrying a source-literal value attr, i.e. subtreeLastLiteralLine != null) now selects the
  PLAIN ctor form (memberRich=true) and computes ctorLine via the childOnlyRich anchor (last child
  subtreeLastLiteralLine) + 4 + voidSlots. SCOPED strictly: an ATTRIBUTE-ONLY state (built-in
  dragstate/resizestate, dbg3's `_dbg_lzhdrag`/`_dbg_lzvdrag`) has NO children static → no literal → keeps
  the DIRECTIVE form (classLine+4+ndecls+extraStatic, unchanged). Probe-confirmed (minimal `<class
  extends="state">`): 0 children → directive form; 1 literal child → anchor+4+1; 2 literal children →
  anchor+4+2. dbg3 RAW IDENTICAL preserved (its state classes are attribute-only → directive path untouched).


## ⚑ DOCS-CORPUS 4-GAP GRIND (2026-06-25): nd 343→345/346, dbg 339→342/344. 3 CLOSED, 1 NO-GO.
Metric `node harness/batch.mjs check-ol corpus`. Gate GREEN throughout (fixtures 96/0/0, check 343→345/0/1,
check-debug 77/1/0 backtrace, explorer-solo 62/0/0, explorer-debug 62/0/0, dashboard BYTE-IDENTICAL,
dbg3 RAW IDENTICAL @845661). Files changed: `src/sc.ts`, `src/compile.ts`. ZERO reverts to the gate.
Remaining diffs: nd backtrace (NO-GO); dbg backtrace + states-$7 (NO-GO).

- **① databinding-$7 CLOSED (both modes) — funcdecl in PROGRAM context + nested-literal-dataset subnode
  count.** Two fixes. (a) `sc.ts` Printer.stmt `funcdecl` case: a top-level funcdecl in an immediate
  `<script>` body (compiled via `compileProgram`/`compileProgramDebug`, NOT the SCRIPT_ELEMENT transform
  in compileScriptBody which HOISTS funcdecls to `name=function(){}` assignments) is emitted VERBATIM as a
  named declaration `function name($0,$1){…}`. Non-debug builds the scope (analyzeScope) + named-decl
  inline. Debug uses new `renderDebugFuncDecl(name,fn,file,line)` → `renderDebugFuncNode(..., asDecl=name)`
  which returns the inner `function name (params) {try…}` directly (no displayName-IIFE, no S2/S3 — a
  funcdecl STATEMENT keeps its name), with a TRAILING `\n` so assembleDebugProgram's `;` unit-separator
  lands on its own line (gold `}}}\n;`). xmlequals.lzx's `xmlstringequals`/`xmlequals` top-level funcdecls.
  (b) `compile.ts` instanceContribution/classStoredCount: a literal `<dataset>` (new `isLiteralDatasetEl`,
  mirrors the buildNode datasetLiteral gate) contributes ONLY itself to totalSubnodes — its XML-data
  children (`<foo>bar</foo>`) are includeChildren=false, NOT view subnodes (somedata `…},3)` was `4`).
- **② richtext-$2 CLOSED (both modes) — `<interface>` instance WITH methods.** Removed the `hasMethods &&
  node.isInterface` refuse in emitNode (compile.ts ~1693). A method-bearing interface instance (e.g. a
  `<richinputtext width="${parent.width-10}">` — the constraint is a code member) becomes an anon subclass
  EXTENDING `$lzc$class_richinputtext` (the implementation class from the library's AS3 `<script>`,
  resolved by NAME). The existing anon-class path already handles it uniformly: `compileClass(interface)`
  returns "" (interfaces emit no def, compile.ts:3080), `resolve("richinputtext")` →
  `$lzc$class_richinputtext`, `inheritsChildren(interface)=true` → `mergeChildren([],
  $lzc$class_richinputtext["children"])`. Method-LESS interface instances keep the `tag:"richinputtext"`
  deferred-indirection path (unchanged). The 2 corpus FEATURE-unsups are now both gone.
- **④ databinding-$15 CLOSED (debug) — `<dataset>` directive-suppression after a constraint `<debug>`.** A
  top-level `<dataset>` IMMEDIATELY following a `<debug>` element that became an ANON subclass
  ($lzc$class_mhN extends LzDebugWindow, from %-constraint attrs like `x="50%"`) emits its lzAddLocalData
  in GENERATED context (no `/* file */` directive) — the anon Class.make registration leaves the running
  Token.currentPathname BLANK. Verified via `-SS`: the onion dataset unit is entirely `#fileline 0#0`,
  vs data_app-$1/databinding-$28/$29 (a LITERAL-attr `<debug y="100">` stays $lzc$class_LzDebugWindow,
  whose following dataset KEEPS debugger.lzx#1). FIX: a `debugAnonClassPending` flag (compile.ts) set in
  the `<debug>` branch ONLY when the resolved class is a generated `$lzc$class_mhN` (NOT
  `$lzc$class_LzDebugWindow`), captured-and-cleared at the top of the canvas-child loop (inter-element
  whitespace doesn't break adjacency); the dataset branch then passes `["",0]` (blank file → no directive)
  instead of `[crossUnitFile,1]`. SCOPED to the dataset path only — a blanket `crossUnitFile=""` reset
  broke databinding-$28/$29/rpc-$20/rpc-soap-$8 (reg-trailer/instance context) and was reverted; the
  LzDebugWindow-exclusion fixed the over-fire on $28/$29.
- **③ states-$7 NO-GO (debug) — state-class-WITH-CHILDREN synthetic-ctor line is a GENERATED re-lex count.**
  CONFIRMED via `-SS` (states7-lineann-186): the fadeDragger (`<class extends="dragstate">` with hShadow/
  vShadow view children) synthetic ctor is `$reportException("", 24)` rendered ENTIRELY in generated
  context (`#fileline 0#0` — PLAIN form, not the directive form the stateClass path forces; the built-in
  childless dragstate/resizestate correctly use the DIRECTIVE form `$reportException("utils/states/
  dragstate.lzx", N)`). The `24` is NOT a source line: 4 probes proved it is `Token.currentLineNumber`
  captured when the state's children are APPLIED to the parent during the first instance's instantiation —
  probe with 1 plain state-child view → ctor 10; probe with the full 2-constraint-children class → ctor 23
  (the constraint children's generated children-application code adds re-lex lines). Modeling this exact
  generated-line count is the multi-hour grind C5 documented. Discriminator (state + view children → plain
  form) is dbg3-SAFE (dbg3's _dbg_lzhdrag/_dbg_lzvdrag state classes have `<attribute>`-only, NO view
  children; built-in dragstate/resizestate likewise), but without the line the form alone is useless.
  Deferred — same disposition as before, now `-SS`-confirmed as a re-lex count.

## ⚑ DOCS-CORPUS DEBUG 327→339/344 (2026-06-24): 4 clusters CLOSED (+12), 2 NO-GO.
Metric `node harness/batch.mjs check-ol corpus` → NON-DEBUG **343/346** (unchanged, 3 unsup),
DEBUG **339/344** (was 327; 5 diff remain). Gate GREEN throughout (fixtures 96/0/0, check 343/0/3,
check-debug 77/1/0 backtrace, explorer-solo 62/0/0, explorer-debug 62/0/0, dashboard BYTE-IDENTICAL,
dbg3 RAW IDENTICAL @845661). Files changed: `src/sc.ts`, `src/compile.ts`. ZERO reverts to the gate.

- **C1 performance-tuning-$2..$9 (+8) @847441 — script-class trailing-`;` empty stmt + `j++`
  false-expansion.** TWO fixes. (a) A library `<script when="immediate">` AS3 `class X{…};` (a
  trailing source `;` after the `}`) carries an EXTRA empty-statement directive after the Class.make
  (gold `)()]);;/* file */`). `compileProgramDebug` processes top-level stmts individually (NOT via
  `joinStmtsInner` where the `s.semi` append already lived), so it dropped the empty stmt — added a
  separate `";"` translation unit after an as3class with `.semi` (handles both the `{`-block-wrapped
  body-stmt class and the plain make form). assembleDebugProgram supplies the make's terminator `;`
  (the make unit doesn't end `;`), the new unit supplies the empty `;` → `;;`. (b) The top-level
  `<script>` `j++` (postfix on `var j` declared at script scope) was WRONGLY IIFE-expanded: the S50-2
  rule "checked = free bare id" is necessary-not-sufficient — a free ref that RESOLVES to an enclosing
  (script-scope `var`/funcdecl, or outer-function local) declaration is NOT checked (oracle
  translateReference resolves it). Added `Printer.dbgOuterVars` (outer-resolvable names) threaded via a
  new `outerVars` param on `renderDebugFuncNode`; the postfix-check now also requires
  `!dbgOuterVars.has(name)`. Seeded from `compileScriptBodyDebug` hoistNames (the `<script>` globals) and
  `compileProgramDebug` collectVariables; `printFunc` unions each function's own locals
  (`rename.keys()`) for its descendants. (`j` resolves → plain; databinding's instance attr `ind` has no
  outer var → still expands.)
- **C4 databinding-$11 (+1) @845109 — PREFIX `++ind` IIFE expansion.** The postfix expansion only handled
  `X++`; the oracle expands PREFIX `++X` too, returning the NEW value: `var $0 = X; return X = $0 + 1`
  (vs postfix `var $0=X; X=$0+1; return $0`). Unified the unary `++`/`--` branch in `Printer.expr` to fire
  for both prefix and postfix on a checked free bare id, picking the prefix/postfix innerSrc. Captured the
  prefix operand line at parse (`unary.line` in `unary()`). The IIFE displayName now uses
  `this.outerUserName` when set (`handle onclick` for `++ind` in a handler) else `file#line/1` (lzunit-$2's
  `counter++` in a method body — outerUserName null, unchanged). Threaded outerUserName into the IIFE's
  renderDebugFuncNode.
- **C2 views-$13/$22 (+2) @842080/@845497 — tag-attr handler member anchors at class start-tag `>` line.**
  A class with an event handler declared as a TAG ATTRIBUTE (`<class onmousedown=… onmouseup=… …>`) whose
  start tag spans multiple lines: the handler body's `#line` tracks at the class START-TAG `>` line
  (`el.endLine`, RULE 8), NOT the attribute's own line — so the synthetic-ctor member cursor (`lastMemberClose`)
  must be `child.endLine`, not `child.attrLines[an]`. (views-$13 dragBox onmouseup@4 but `>`@5 → ctor #12,
  was #11.) No-op for single-line class tags (attrLine == endLine).
- **C3 viewvisibility (+1) @859608 — class color-default `$once` constraint is a code member.** A
  non-canonicalizable color CLASS-default (`<class demo bgcolor="gray90">` → `LzColorUtils.convertColor`
  `$once` constraint, `$mhb`) is a CODE MEMBER but the class-attr loop's `color` branch never called
  `noteMember` (the instance path already did via noteCodeMember). So `demo` fell into the childOnlyRich
  last-literal anchor (ctor @52) instead of the member-rich plain ctor off the constraint deps span (gold
  @49). Mirrored the instance-path noteCodeMember in the class color branch (sets lastMemberConBody/SrcLine).
- **C5 states-$7 — state-class-WITH-CHILDREN synthetic ctor = NO-GO.** A `<class extends="dragstate">` with
  user view children (hShadow/vShadow) + handlers uses the PLAIN ctor form (`$reportException("", 24)`,
  generated context) — NOT the directive form the state path forces (`!stateClass` gates memberRich). The
  built-in `dragstate` (no view children) correctly uses the directive form. The discriminator (state + view
  children → plain) is clear, but the ctorLine=24 is the source line the re-lexer reaches when the STATE's
  children are applied to the PARENT during the FIRST instance's instantiation (line 24 = `</view>` of the
  first `<view><fadeDragger/>…</view>` group, lines 19-24) — NOT derivable from the class subtree. Modeling
  state-child re-lexing into the parent is a multi-hour grind with dbg3-state-class (resizestate/dragstate)
  risk. Deferred.
- **C6 databinding-$15 — `<dataset>` directive-suppression after a `<debug>` anon class = NO-GO.** A local
  `<dataset>` immediately following a `<debug>` element (which emits an anon `<anonymous extends=
  'LzDebugWindow'>` subclass when it has constraint attrs) suppresses its `lzAddLocalData` leading directive
  in the gold (`…attributes)]);onion = canvas.lzAddLocalData`), whereas the SAME dataset after a regular
  instance DOES emit `/* file: …#1 */` (data_app-$1/$3 pass with the directive shown). The dataset is a
  FRESH translateAnnotatedUnit (fresh curLstate, filename=""), so `shouldShowSourceLocation` ALWAYS shows a
  real-file BOL directive — the oracle's per-statement makeTranslationUnits has the same fresh curLstate, so
  the gold's suppression implies the `<debug>` anon class + the dataset share ONE makeTranslationUnits unit
  in the oracle (DebugCompiler grouping), which the TS per-pushDebug-unit model can't replicate without
  restructuring unit boundaries (dbg3 risk). Setting crossUnitFile to the app file fixes the directive FILE
  (debugger.lzx → databinding-$15.lzx) but not the show-vs-suppress (reverted). Deferred.

## ⚑ EXPLORER 67/67 BOTH MODES (2026-06-24): all 4 check-ol-explorer gaps CLOSED.
Metric `node harness/batch.mjs check-ol explorer` → **NON-DEBUG 67/67, DEBUG 67/67, BOTH 67**
(from baseline 64/64, 63 both). Five deterministic fixes, ZERO reverts to the gate. The corpus
`check` invariant IMPROVED from 266/0/80 → **343/0/3** (the gap-3 debug-honor change made +77
debug-source programs byte-match; **0 diff HELD**). Full gate GREEN throughout: dbg3 RAW IDENTICAL
@845661, check-debug 77/1/0 (backtrace holdout), explorer-debug 62/0/0, explorer-solo 61/0/1→**62/0/0**
(debugger.lzx now matches), dashboard byte-identical, fixtures 96/0/0, bare exit 3, browser+closure pass.

- **E67-1 welcome.lzx `<include>` in a `<switch>` arm (BOTH modes).** `expandIncludes` recursed into a
  selected `<when>`/`<otherwise>` arm via `out.push(sel)` but never re-dispatched an `<include>`/`<switch>`
  that WAS the selected child. FIX: extract the per-child loop body into `processChild(c)` and call it on
  each `evaluateSwitch` result (`continue`→`return`). Also: **library-origin fonts now order AFTER host
  fonts** (cat 1<2 like globals, `fontCat`/ORIGIN_RANK sort) — welcome's host `headerfont`/`Helmet` precede
  the rclock library's `Kgr`. (compile.ts ~2063 expandIncludes, ~3859 font flush.)
- **E67-2 sc.ts bin printer adjacent-sign disambiguation (welcome.lzx @16104).** `a + +b` not `a++b`
  (ParseTreePrinter `visitBinaryExpressionSequence`/`delimit`): the right operand gets a forced leading
  space when the operator's LAST char equals the operand's FIRST char (unless `(`-parenthesized). Applies in
  BOTH compress + debug. (sc.ts `bin`/`logic` case ~1557.)
- **E67-3 videolib.lzx nested-fn displayName (DEBUG @844898).** A `#pragma userFunctionName=` (handler
  `handle X`, setter `set X`, reference `get X`, constraint binder/deps) PERSISTS down CodeGenerator's
  options-copy into ALL lexically-nested function VALUES, so their debug displayName is the enclosing pretty
  name, NOT `file#line/col`. FIX: `Printer.outerUserName` threaded via a new `propagateName` param on
  `compileFunctionDebug`+`renderDebugFuncNode`; set from handler(auto-method-only)/reference/setters(×4)/
  constraint setter+deps. (7 displayNames fixed: 6 addEventListener cbs in `oninit`, 1 in `set url`.)
- **E67-4 explore-nav state/datapath + rest-param (BOTH modes).** (a) A state/datapath canHaveMethods=false
  instance with a void-0 `<attribute name=X value=V/>` DECL slot whose value V is already in `attrs[X]` now
  KEEPS the value (skip the slot) instead of refusing `state instance with declaration slot` (menubutton's
  `<datapath><attribute name=doneDel value=null/>` → `doneDel:null`). (b) A method with BOTH a default-param
  switch AND `...rest`: lex the synthetic rest prologue at methodLine+3 (collapses, no directive) + the body
  at its true line (re-emits) — matching substituteStmts (extensions/html.lzx `callJavascript`).
- **E67-5 explore-nav anon-class ctor line for a reference-only handler (DEBUG @1005978).** A
  `<handler reference=X method=Y/>` with NO body emits the `get X` REFERENCE method (NodeModel:1465) as its
  LAST code member. FIX: `emitHandler` now reports `noteCodeMember(return (#beginAttribute<srcloc>X<endsrc>
  #endAttribute);, hLine)` when there is no body method, so `finalSourceLine` drives the `$lzsc$initialize`
  ctor catch line (menu basetree `<handler onbookmark reference=canvas method=dataBound/>`@380 → ctor #386,
  was #384).
- **E67-6 (gap 3) HONOR source `debug="true"` in the non-debug batch.** The oracle ALWAYS produces a debug
  build for a `debug="true"`/`compileroptions="debug: true"` SOURCE regardless of the CLI `--debug` flag
  (CanvasCompiler sets DEBUG_PROPERTY from the attr). The TS port previously REFUSED these (the historical
  57-diff-flip policy). VERIFIED the readable backend is now byte-for-byte across the corpus: flipping
  `debug=(opts.debug || (isDebugBuild && !wantsBacktrace)) && !canvasDebugOff` yields corpus 343/**0**/3.
  Refusal narrowed to `backtrace:true` ONLY (the one unimplemented debug feature, still the check-debug 1/78
  holdout). Bare `dbg3` still exit-3 (now refuses on `debugger/library.lzx` resolution, not policy).

## ⚑ BROWSER TRACK (2026-06-24): compile LZX in the browser — DONE, byte-== Node.
ADDED-only (no frozen-core touch): `src/browser-io.ts` (fetch mirror of node-io: refs→URLs,
same search order, reads an in-memory map, records misses to a `faults` set + returns benign
placeholders), `src/cache-browser.ts` (`BrowserTracker`/`browserProbe`/`BrowserCache` over HTTP
validators + CacheStorage, mirroring cache-disk), `src/browser.ts` (`compileInBrowser` = the
fault-and-retry preload-then-compile-sync driver loop + cache get/put; re-exports the core).
`package.json` `"./browser"` export + `bundle:browser` script. Gate `npm run test:browser`
(`harness/browser-equiv.mjs`) — fetchFn shim reading the FS — proves the browser-driver JS is
**BYTE-IDENTICAL to `compileFile(app,{lpsHome,sprites:"none"})`** for hello (429B, 1 pass),
calendar (339329B, 7 passes), dashboard (432542B, 6 passes); closure file-set == Node; 2nd
compile = cache HIT; dep-validator bump invalidates. Bundle `dist/lzc-browser.js` (~243KB ESM
via `npx esbuild`) + live `demo/index.html`. KEY mechanics: (1) benign placeholders on a MISS so
one pass surfaces MANY misses; (2) `state.missing` set so a 404 candidate is skipped (not
re-faulted) → convergence; (3) closure records only USED urls (`state.onUse`), not speculative
probes (e.g. `.swf`→autoPng), so it equals Node's. Existing gates UNAFFECTED: corpus 266/0/80,
check-dashboard BYTE-IDENTICAL, test:closure all passed, test:cache 16/16. Full doc: **README-BROWSER.md**.

## ⚑ SESSION 50 (2026-06-24): corpus-DEBUG 75→77/78 (2 closes, 1 NO-GO, 0 reverts to gate).
Metric `node harness/batch.mjs check-debug` → **77 match / 1 diff / 0 unsup**. Closed `lzunit-$2` and
`lzunit-$5` byte-identical; `backtrace.lzx` characterized as a NO-GO (scaffolding cleanly reverted).
Gate GREEN throughout: corpus 266/0/80, dbg3 RAW IDENTICAL @848740, expl-debug 62/0/0, expl-solo 61/0/1,
check-dashboard byte-identical, fixtures 96/0/0, bare exit 3.

- **S50-1 lzunit-$5 — plain-instance first-child `$lzc$bind_id` funcLine (@938501).** When a PLAIN
  (non-anon-class) instance has NO own attrs, its first child's id-binder is serialized immediately
  after the PARENT's instantiation `#line` directive — so the binder's funcLine = `parent.el.endLine`
  (the parent's `>`-line), NOT the child's own `el.endLine`. Mirrors the existing anon-class re-point
  (`firstChildBinder.funcLine = classLine+3`). FIX: in `emitNode`'s plain-instance branch (compile.ts
  ~1779), gated to `Object.keys(attrs).length === 0`, re-point `node.children[0].idBinderSpec.funcLine`
  to `node.el.endLine`. Verified via `-SS` lzunit-$5-src-165: `#line 5` precedes the bind_id for
  `<view>@5` wrapping `<view id="bluebox">@6` (gold `lzunit-$5.lzx#5`, mine was `#6`).
- **S50-2 lzunit-$2 — debug postincrement/decrement expansion (@936832).** A postfix `++`/`--` on a
  CHECKED reference (a FREE bare identifier — `JavascriptGenerator.visitPostfixExpression:859`
  `translateReference(ref).isChecked()`) expands to a source-capturing displayName-IIFE:
  `(function(){var $lzsc$temp=function(){var $0=X; X=$0+1; return $0}; …displayName="F#N/1"; return
  $lzsc$temp})()()`. **Only `VariableReference` (bare ids) are checked** — `PropertyReference.checkedNode`
  is commented out (1906-1908), so `a.b++`/`a[i]++` and LOCAL `i++` (in `variables`) are NOT expanded
  (that's why all the `for(i++)` golds stayed correct). FIX: capture the operand's line on the `unary`
  node at parse (postfix() / foldNode); in `Printer.expr` for postfix `++`/`--` with `dbg` && operand is
  a bare id in `dbgFree`, render the IIFE via `renderDebugFuncNode` + `()`; wire `printer.dbgFree =
  scope.free` at the 3 scope-bearing printer sites. Also extended the synthetic bare-register rename to
  the `$lzsc$` namespace (the IIFE's `$lzsc$tmp` → `$0`, not `$lzsc$tmp_$0`) — verified no gold carries a
  `$lzsc$X_$N` debug-named form.
- **S50-3 backtrace.lzx — DEBUG_BACKTRACE = NO-GO (characterized, scaffolding reverted).** `backtrace:true`
  (`JavascriptGenerator:1211-1246` + `noteCallSite:727-737`) instruments EVERY fn/method body (1022 here —
  the whole LFC): prelude `var d=Debug; var s=d.backtraceStack;` (outside try, inside `with`); in-try
  prefix `if(s){var a=[quote(param),reg…]; a.callee=arguments.callee; a["this"]=this(non-static);
  a.filename=F; a.lineno=methodLine; s.push(a); if(s.length>s.maxDepth){d.stackOverflow()}}`; **2213
  per-call-site `a.lineno=N,<node>` notes** on EVERY non-super CALL + EVERY checked free-bare-id ref
  (super-calls excluded, line 834); catch uses `a.lineno`; `finally{if(s){s.length--}}`. `d/s/a` →
  `$1/$2/$3` (analyzed AFTER the body, 1345-1363). **BLOCKER:** noteCallSite needs precedence-correct
  `seq` nodes (1093 nested-parenthesized vs 1120 statement-level of 2213) AND a per-NODE `beginLine` the
  TS AST does not carry (only statements do) — byte-exact across the entire LFC = a multi-hour grind + a
  5-path wrapper restructure (method/function/handler/constructor/script) + shared-debug-path risk.
  Deferred (dev-only, low value). The `SC_BACKTRACE` flag, `analyzeScope` `extraVars`, and printer
  `btFrame/btLine` scaffolding were FULLY reverted — zero residue.
- **HOW TO RESUME S50→S51 (backtrace, if pursued):** (a) thread `SC_BACKTRACE` (re-add the flag +
  `setScBacktrace` wiring in compile.ts gated on `/(?:^|;)\s*backtrace\s*:\s*true\b/`); (b) re-add
  `analyzeScope(..., extraVars=["$lzsc$d","$lzsc$s","$lzsc$a"])` to register them AFTER body vars;
  (c) build a `backtraceWrap` helper producing prelude/prefix/finally from `scope.map.get("$lzsc$a")`
  etc., and a recursive AST→`seq` noteCallSite transform that needs per-node lines — the real work is
  giving call/id/new nodes a `line` (extend the parser like the S50 `unary.line`) so the notes are
  byte-exact; (d) wire the wrapper into renderDebugFuncNode + compileFunctionDebug + the constructor +
  script/handler paths, all gated by SC_BACKTRACE so the non-backtrace path stays byte-identical (dbg3).

## ⚑ SESSION 49 (2026-06-24): DASHBOARD PRODUCTION = BYTE-IDENTICAL (3 fixes, 0 reverts).
Metric `node harness/batch.mjs check-dashboard` → **"BYTE-IDENTICAL — match!" (434851=434851 normalized)**.
The real-app Dashboard (samples/dashboard/dashboard.lzx + ~dozen library files + PNG/SWF) now matches the
oracle's production DHTML output byte-for-byte under the project's standard normalizer. Three stacked
divergences closed, each in SHARED codegen, gate GREEN throughout (corpus 266/0/80, expl-solo 61/0/1,
expl-debug 62/0/0, check-debug 75/3/0, dbg3 RAW IDENTICAL @848740, fixtures 96/0/0, bare exit 3):
- **S49-1 cross-library global order (@18122).** The oracle's `ToplevelCompiler.computeDeclarations`
  emits `var X=null` ids in a DFS where a file's OWN class/instance ids come before the ids of the
  libraries it `<include>`s — `computeDeclarations` descends element children but NOT through nested
  `<include>`s; those are deferred to a second `collectObjectProperties` loop. So a host library's
  globals precede its includes' globals REGARDLESS of the include's document position. (Discriminator:
  `videoviewer` in videolib.lzx's own `videoplayer` class vs `videotime` in the `<include>`d
  mediaplayer.lzx — gold = videoviewer FIRST; minimal repro confirmed `vp_id` before `mp_id` for
  include-before/between/after.) FIX: `ORIGIN_RANK` map (compile.ts ~2412), assigned per origin-file
  the first time `expandIncludes` enters it (host entered before its includes ⇒ entry-order == this
  DFS rank); `orderGlobals` sorts `(category, originRank, push-index)`. NON-library includes (inlined,
  Parser.java:739) INHERIT the host's rank (pre-seeded before recursion) so they stay in document order
  — without that clause lzpix's `tools`/`spnr`/`scrn` flipped (caught + fixed, transient expl-solo 61→60→61).
- **S49-2 nested literal `<dataset>` initialdata (@199213).** A non-top-level `<dataset>` of literal XML
  (chatlib `<dataset name="message"/>`) is a normal instance: oracle NodeModel.addAttributes:615-631 adds
  `initialdata` = serialized `<data>…</data>` (`"<data />"` empty) BEFORE `name`, includeChildren=false.
  TS only handled TOP-LEVEL datasets (lzAddLocalData path). FIX: a `dataset` branch in `buildNode` BEFORE
  the attr loop (so initialdata precedes name in the emitted attrs map) emitting `attrs["initialdata"]` +
  suppressing children (`for (const c of datasetLiteral ? [] : el.children)`); gated to literal
  (not soap/http/url/constraint/datafromchild). New module-level `DATASET_SRC` resolver mirrors `SCRIPT_SRC`.
- **S49-3 inherited initstage=late in the instance node-count (@388368).** Every `<dashWindow>` instance
  had count gold=33 (CONSTANT) but mine=86/131/… The dashWindow class's content child is a `<lattabslider>`,
  and `<class lattabslider extends=basetabslider initstage="late"/>` (dashboard.lzx:279-281). NodeModel
  .totalSubnodes():709 returns 0 for initstage late/defer — so the lattabslider contributes 0 ⇒ instance
  count = bare dashWindow storedCount (33). The initstage is INHERITED from the instantiated class def
  (NodeModel ctor seeds `initstage` from parentClassModel.nodeModel.initstage), not the instance element's
  own attr — TS `instanceContribution` read only `el.attrs["initstage"]`. FIX: `effectiveInitstage(el)`
  helper — instance's own initstage else walk the user-class chain for the class def's `initstage`, gated on
  `storedCount.has(cur)` (oracle inherits only when the class is compiled). dbg3 unaffected (RAW IDENTICAL).

HOW TO RESUME: `check-dashboard` is GREEN. Calendar (GAP-7) + Dashboard (GAP-DASH) real apps are both
byte-identical. For a NEW real app, run `check-dashboard <path.lzx>` (argv[3] picks any main). The 3 fixes
are general (computeDeclarations order, nested-dataset initialdata, inherited initstage), not dashboard
hacks. See known-gaps §0 GAP-DASH.

## ⚑ SESSION 48 (2026-06-24): check-debug 69→75/78 (3 fixes, 4 unsup→0). Remainder = 3 documented FEATURES.
Metric `node harness/batch.mjs check-debug` went **69 match/5 diff/4 unsup → 75/3/0**. Gate stayed GREEN
throughout (prod 266/0/80, dbg3 RAW IDENTICAL @848740, fixtures 96/0/0, expl-solo 61/0/1, expl-debug 62/0/0, bare exit 3).
Three scoped fixes, no reverts:
- **S48-1 `<security>` top-level skip (+4: rpc-javarpc-$2/$4/$8/$10).** The 4 `unsup` all shared one cause:
  `unexpected text content in <pattern>`. `<security>` is a TOP-LEVEL server-side directive — `SecurityCompiler.compile`
  just calls `canvas.setSecurityOptions(element)` and emits NO client JS (Compiler.java:714 dispatches it there, never to
  instance/view compilation). Its `<allow>/<deny>` children carry `<pattern>` regex TEXT which buildNode's instance path
  rejected. Fix: `if (child.name === "security") continue;` in the canvas-children loop (compile.ts, next to `<splash>`).
- **S48-2 method funcLine = `el.endLine` (datapointer-creating-node, #194→#195).** A `<method>` whose open tag spans lines
  (`<method name="x"\n args="…"><![CDATA[`) — `CompilerUtils.attributeLocationDirective(elt,"name")` → `sourceLocation
  Directive(elt,true)` → `Parser.getSourceLocation(LINENO,start=true)` resolves to the start tag's CLOSING `>` (SAX/JDOM
  quirk), i.e. `endLine`, not the `<` line. `compileMethod` passed `c.line` for BOTH funcLine + bodyBaseLine; now passes
  `c.endLine ?? c.line` (single-line tags: endLine===line → no-op; dbg3 unaffected — verified RAW IDENTICAL).
- **S48-3 script try-wrapper folds nested-funcdecl free vars (databinding-$8).** A top-level `<script>` whose funcdecls
  close over globals (`processReqChange`/`loadXMLDoc` over `Debug`/`lz`) must get the debug try/catch wrapper even when the
  top-level statements alone are free-clean. The oracle's `VariableAnalyzer.computeReferences` folds each nested function's
  `free` into the outer `used`→`free` (innerFree, VariableAnalyzer.java:80-88); JavascriptGenerator wraps iff `dereferenced
  || !free.isEmpty()`. `compileScriptBodyDebug` analyzed only `rest` (funcdecls split out) so it missed those captures. Fix:
  `needTry = computeDereferenced(ast) || computeFree([], ast).size > 0` over the FULL original `ast` (script-scope locals
  are declared by collectVariables → available → not free, so calendar event.lzx's `var X={…}` globals still get NO try).

### THE 3 REMAINING DIFFS — all genuine FEATURES (confirmed S48, match prior S47 characterization)
- **backtrace.lzx (@20810):** `compileroptions debug+backtrace` — `Debug.backtraceStack` instrumentation replaces the
  try/catch wrapper pervasively. Large code-gen feature. SKIP.
- **lzunit-$2.lzx (@936832):** postincrement-as-value IIFE. `assertEquals(1, counter++)` — `counter++` used as a function
  ARG is desugared in debug to a source-capturing thunk `(function(){var $lzsc$temp=function(){try{var $0=counter;
  counter=$0+1;return $0}catch…}; $lzsc$temp["displayName"]="…#13/1"; return $lzsc$temp})()`. A real `sc` expression rewrite
  + nested-anon-fn displayName mechanism. dbg3-RISKY feature. SKIP.
- **lzunit-$5.lzx (@938485):** AS3 script-class binder-vs-method ordering — gold leads the nested instance children's asMap
  with the `$lzc$bind_id` (Pattern-A, `/* file: #5 */` directive) but mine emits the handler methods first. Structural
  member-ordering, not a line-fix. SKIP. (NB: lzunit-$4 is no longer in the cache's 78-set; the trio is now $2/$5 + backtrace.)


You are one agent in a relay finishing the OpenLaszlo phase-3 TS compiler's
**debug build** (`<canvas debug="true">`) to **byte-for-byte parity** with the
Java 4.9 oracle. Read this whole file, then `cd /Users/temkin/Code/OpenLaszlo/modern-build/compiler`
and work. Deep background lives in the memory file `openlaszlo-compiler-plan`
(SESSION 15–23 entries) and `README.md`; this file is the operational source of truth.

## ⚑⚑⚑ STRATEGIC DIRECTIVE (user, 2026-06-23): ORACLE-PATCH over TS BUG-REPLICATION ⚑⚑⚑
Where a debug-build divergence roots in a genuine **bug** in the Java oracle or a
dependency (e.g. a JavaCC `SimpleCharStream`/JJTree cumulative line-drift), the fix
belongs in the **ORACLE**, not in TS workaround code:
- **PRECEDENT**: SESSION 28–30 already did this for the `#line` buffer-boundary defect —
  `modern-build/oracle/patch/` holds a regenerated `SimpleCharStream` (4 KB→4 MB buffer);
  the affected golds were regenerated drift-free. Oracle-patching is an established,
  sanctioned tool, not a new risk.
- **WHY**: replicating these bugs in TS is (a) a hard exercise and (b) makes the TS
  compiler harder to read/maintain — explicitly UNDESIRABLE. The TS compiler must encode
  OpenLaszlo's *intended* semantics cleanly, not mirror lexer defects.
- **HOW (discipline — each patch must be a PROVABLE bug fix)**: (1) diagnose the defect to
  its root in the oracle source; (2) extend `modern-build/oracle/patch/`; (3) regenerate
  ONLY the affected debug golds (`batch.mjs regen-debug`); (4) VALIDATE — the *un-patched*
  regen must reproduce the stock gold byte-for-byte (proves the patch touches only the
  defect), and production (compress) output must stay byte-identical. Never edit the oracle
  to "match us" — only to fix a real defect.
- **STANDING OPPORTUNITY (re-baseline)**: much existing TS *debug-path* complexity (super
  Rule A/B quirk, cascading `dbgLineDelta`, per-element line special-cases S24–S35) is
  itself bug-reproduction of this same line-drift family. Once the drift is patched away at
  the oracle and all 78 debug golds regenerated drift-free, that TS quirk code can likely be
  DELETED (big readability win) and may collapse several clusters at once. This is a
  re-baseline (re-validate dbg3 + closed golds) — assess feasibility/scope BEFORE committing.
- **Reproduce-in-TS only when the behavior is INTENDED oracle semantics** (e.g. the
  cross-unit `Token.currentPathname` reg/binder mechanism — that is real, not a bug).

## THE GOAL / DEFINITION OF DONE
The compiled output of `/tmp/dbg3.lzx` (a `<canvas debug="true">`, which pulls in
the ~850 KB debugger + component closure) must match the gold
`modern-build/oracle/out/dbg3.dhtml.js` (**850,579 bytes**) byte-for-byte.
dbg3 is now **byte-for-byte (850579, RAW IDENTICAL)** — DONE. ⚠️ But that did NOT
make the 83 corpus debug builds pass (see SESSION 30 CRITICAL FINDING below): the
other 78 corpus debug builds have their own divergences. The TRUE DoD (corpus
**263/0/83 → 346/0/0**) requires grinding those 78 to byte parity, then:
1. Flip the refusal in `src/compile.ts` (~L1894, the `debug="true"` exit-3).
2. Diff the real debug golds WITHOUT `LZC_DEBUG_FORCE` (`batch.mjs check`); raise the
   harness execFileSync maxBuffer (2 ENOBUFS); add `p_debug_*` fixtures.
3. Corpus goes **263/0/83 → 346/0/0** (all 83 debug builds compile clean). DONE.
The fixed-oracle debug golds are ALREADY regenerated in `.goldcache` (via the new
`node harness/batch.mjs regen-debug`); production golds need no regen.

## ⭐ EXPLORER-SOLO TRACK (NEW 2026-06-23) — byte parity for the 62 Explorer programs
A SECOND parity track, separate from the debug grind above. Goal: byte-for-byte (TS vs oracle)
for **SOLO builds** of the 62 real multi-file programs the Laszlo Explorer navigator links
(`lps-4.9.0-src/lps-4.9.0/laszlo-explorer/nav_dhtml.xml`; disjoint from the 346 docs corpus).

**SOLO support is DONE (1-byte delta).** `CompileOptions.proxied?: boolean` (compile.ts);
default (undefined/true) = existing behavior unchanged (every corpus/dbg3 gold intact — verified).
`proxied:false` flips `canvas.__LZproxied "true"→"false"`. Drive it: `cli.js --solo` /
`--proxied=false` / env `LZC_SOLO=1`.

**Infra:**
- Oracle SOLO wrapper: `modern-build/oracle/compile-solo.sh` (= compile.sh but with
  `-Dlps.config.dir.abs=…/oracle/solo-config`; that config dir symlinks the real LPS config and
  overrides only `compiler.proxied=false`). The REAL `lps.properties` is untouched.
- Harness modes (`harness/batch.mjs`): `build-explorer-solo` (oracle-compile all 62 → SEPARATE
  `.goldcache-explorer-solo/<slug>.gold` + `.src`=source path) and `check-explorer-solo` (TS
  `--solo` vs gold; prints `== N match, M diff, K unsupported ==` + per-program buckets).
  Program list parsed from nav_dhtml.xml (`explorerPrograms()`), excludes the server-only
  `/lps/admin/console.lzx`, slugs path→name to dodge basename collisions.

**STATE: 61/62 byte-match** (0 diff, 1 TS-unsupported, as of 2026-06-24 post-GAP-20+GAP-10).
All 62 oracle golds build. lzpix + window_example CLOSED — NO remaining body diffs in the
buildable SOLO set. The ONLY unsupported is `debugger` (production debug build — the §2
debug-grind phase). **The PRODUCTION Explorer-SOLO set is DONE (61/61 buildable).** Next phase:
the DEBUG builds of the Explorer set.

## ⭐⭐ EXPLORER-DEBUG TRACK (NEW 2026-06-24, Phase 2) — byte parity for the 62 Explorer DEBUG builds
A THIRD parity track: byte-for-byte (TS forced-debug vs oracle) for the **DEBUG + SOLO** builds of
the same 62 Explorer programs. This applies the existing debug backend (the dbg3-proven one) to the
REAL multi-file Explorer apps — disjoint from the 78 corpus debug golds above.

**CURRENT (2026-06-24, after the constraint-preceded-binder fix: CALENDAR CLOSED): 61 match /
1 diff / 0 unsupported of 62** — the lone remaining diff is **component_sampler @1883467** (the
documented-intractable Pattern-A registration discriminator; clean NO-GO). (see "SESSION 2026-06-24
(calendar: constraint-preceded $lzc$bind_id directive-suppression)" below, and the earlier class-ctor
cluster.) **BASELINE was 24 match / 38 diff.** All 62 oracle DEBUG+SOLO golds
build (0 oracle failures). **`debugger` MATCHES under check-explorer-debug — Phase-1's 62/62 is
effectively closed** (its only-remaining-unsupported was the debug build itself, which now byte-matches).
Zero TS refusals — every program at least compiles the debug backend; all 38 gaps are body DIFFs, not
unsupported features. The match set is the small/structural programs (basics hello/hellobutton/view/
scrolling, classes/constraints/data examples, music, checkbox/window examples, debugger, events, methods).

**The oracle DEBUG+SOLO wrapper** — `modern-build/oracle/compile-debug-solo.sh` + committed
`modern-build/oracle/debug-solo-config/`. The two properties take DIFFERENT paths (verified vs 4.9 src):
- `proxied=false` (SOLO): `CompilationEnvironment.initCompilerOptionDefaults` seeds PROXIED_PROPERTY
  from `LPS.getProperty("compiler.proxied","true")` (CompilationEnvironment.java:260) → the config dir's
  `compiler.proxied=false` wins (same `-Dlps.config.dir.abs` trick as compile-solo.sh). debug-solo-config/
  symlinks the real LPS config + a COPY of solo-config's proxied=false lps.properties.
- `debug=true`: DEBUG_PROPERTY is HARD-CODED to `"false"` in initCompilerOptionDefaults
  (CompilationEnvironment.java:254) — it does NOT read `compiler.debug` from lps.properties, so a
  config-dir override would be IGNORED. The faithful switch is Main's `--debug` (`-g1`) flag, which sets
  DEBUG_PROPERTY=true directly (Main.java:314). (NOT `-g`/`--backtrace`, which ALSO turns on backtrace.)
  So the wrapper passes `--debug` AND `-Dlps.config.dir.abs=…/debug-solo-config`. Produces the ~848KB
  debug closure + `/* -*- file: F#N -*- */` directives + spaced `__LZproxied: "false"` for ANY program
  (verified on basics/hello.lzx, which is NOT debug="true").

**ONE src change required** (`compile.ts` ~2182): the TS debug backend previously activated ONLY when
the canvas itself had `debug="true"`/compileroptions (`debug = opts.debug===true && isDebugBuild`). Most
Explorer programs are NOT debug="true", so they fell through to a production build. Changed to
`debug = opts.debug === true` — mirroring the oracle's `--debug` flag (which forces DEBUG_PROPERTY for
ANY canvas). The PRODUCTION refusal stays LIVE: a debug="true" canvas with opts.debug UNSET (no
LZC_DEBUG_FORCE) still refuses (exit 3). Verified zero regression (dbg3 RAW IDENTICAL, corpus 266/0/80,
explorer-solo 61/62, fixtures 96/0, debug.mjs all-passed).

**Harness modes** (`harness/batch.mjs`): `build-explorer-debug` (oracle-compile all 62 DEBUG+SOLO via
compile-debug-solo.sh → SEPARATE `.goldcache-explorer-debug/<slug>.gold` + `.src`) and
`check-explorer-debug` (TS with `LZC_DEBUG_FORCE=1` + `LZC_SOLO=1`, normalize, diff vs gold; 128MB
maxBuffer for the ~850KB outputs; prints `== N match, M diff, K unsupported ==` + match/diff@offset/
TS-error buckets, diffs sorted by offset).

### SESSION 2026-06-24 (component_sampler reg Pattern-A — ORACLE-INSTRUMENTED NO-GO, definitive). explorer-debug stays 61/1. Gate GREEN.
**RESULT: component_sampler @1883467 is a PROVEN-irreducible permanent gap (61 match / 1 documented gap).** No code-behavior change — only a corrected explanatory comment on `instanceTrailingFile` (`src/compile.ts` ~L2353) + this doc + known-gaps. dbg3 RAW IDENTICAL, corpus 266/0/80, fixtures 96/0, explorer-solo 61/1, explorer-debug 61/1, bare exit 3 — all re-verified.

**THE MECHANISM (now PROVEN by oracle instrumentation, not inferred):** the reg-trailer (`lz["X"]=…`,
emitted by `ToplevelCompiler.outputTagMap` via `compileScript(String)` with NO `#file` directive) inherits
the JavaCC lexer's static `Token.currentPathname` left by the LAST canvas-direct child compiled. Pattern A
(currentPathname="" → inline regs, no directive) vs Pattern B (a real app file → sequential `/* file: app#k */`).
Instrumentation (temporary, since removed; committed `oracle/patch/` UNTOUCHED): patched a /tmp copy of
`Token.java` with a public `getCurrentPathname()` getter + `ToplevelCompiler.outputTagMap` to log it, +
`CompilationEnvironment.compileScript(String,Element)` to log each top-level child's name/id and resulting
currentPathname; compiled into `/tmp/instr/classes`, prepended to the oracle classpath, ran via the
compile-debug-solo flags. Swept ALL 62: **the logged outputTagMap currentPathname predicts the gold A/B
EXACTLY** (the last-child trailing currentPathname IS the discriminator — confirmed mechanism).

**WHY IT IS IRREDUCIBLE (the contradiction, now reproduced with FRESH evidence at the byte level):**
- **component_sampler**: last canvas child `<view id="s1">` → currentPathname=`[]` → **Pattern A** (gold).
- **contactlist**: last canvas child `<view contactsborder>` → currentPathname=`[contactlist.lzx]` → **Pattern B** (gold).
  YET both instances END their serialized children-static **BYTE-IDENTICALLY**:
  `…{axis: "x"}, "class": $lzc$class_simplelayout}], "class": LzView}], "class": LzView}, N);` — the last
  serialized attr is a LITERAL (`axis:"x"`) whose `#beginAttribute…#file \n#endAttribute` leaves an empty `#file `
  in BOTH (verified in the `-SS` `*-src-*` dumps + raw `od -c`: both end on `…#file \n#endAttribute}…)`). The
  difference is NOT in the serialized stream — it is the interleaved order in which that instance's CONSTRAINT
  (`LzAlwaysExpr`/`$mN`) and id/name binder fragments are parsed during `cg.translate` (each `parseFragment`
  toggles currentPathname; the LAST fragment parsed either re-establishes the app file or leaves "").
- **Even the structural proxies CONTRADICT pairwise** (62-program sweep): `tabs id=null` → **A** (form_example)
  vs `tabs id=null` → **B** (grid_example); `view id=null` → A (button_example) vs → B (amazon/contactlist).
  form_example's last instance ENDS with `LzAlwaysExpr(…)}` (constraint) and is **A**; grid_example ENDS with
  `LzOnceExpr(…)}` and is **B** — so neither "ends-with-constraint" nor element-type nor id/name presence
  separates them.
- **The current `!topLevelHasIdOrName` gate is a proxy that fits 61 but is WRONG for component_sampler** (its
  `s1` HAS id → the gate says Pattern B, gold is A). **DROPPING the gate FLIPS 15 passing programs B→A**
  (debugger/methods/events/music/splitpanel/dataimage/contactlist/weather/survey/calendar/…), regressing
  explorer-debug 61→46 (empirically verified + reverted). So no scoped tweak of the existing structural rule
  can close component_sampler without breaking the 15.

**THE ONLY GO PATH (not taken — out of scope + extreme dbg3 risk):** port the oracle's full `cg.translate`
AST-walk fragment-generation ORDER into the TS code generator so the trailing currentPathname is simulated
exactly. That is a rewrite of the whole codegen-ordering model (touches every constraint/binder in dbg3 + 266
corpus + 62 explorer-debug), not a scoped fix — it violates the refuse-don't-miscompile / scoped-fix discipline.
Accept component_sampler as the lone permanent documented gap: **explorer-debug = 61/62 + 1 known-gap.**
**RE-INSTRUMENTATION RECIPE (if ever revisited):** see `/tmp/instr-run.sh` pattern — patch `Token.java`
(add `getCurrentPathname`), `ToplevelCompiler.outputTagMap` (log it), `CompilationEnvironment.compileScript`
(log child name/id + post-state); `javac` with `/tmp/instr/classes` FIRST on the classpath; the logged
outputTagMap currentPathname is the ground-truth A/B.

### SESSION 2026-06-24 (class-ctor: childOnlyRich ctorLine + no-literal directive form + class-static-method ctor) — explorer-debug 58 → 60. amazon + component-browser CLOSED. Gate GREEN throughout.
The shared **`<class>` synthetic-ctor** cluster (the prior worker's flagged HIGH-RISK target) — characterized first against dbg3's own green classes, then landed SCOPED so EVERY dbg3 class + 266 corpus + 58 prior explorer-debug matches stay byte-identical. FOUR fixes (3 in `src/compile.ts`, 1 spanning `compile.ts`+`sc.ts`):

1. **childOnlyRich synthetic-ctor line = lastChildBlockLine + 4 + voidSlotDecls** (`compile.ts` ~L3292,
   the `if (childOnlyRich && !childOnlyNoLiteral)` branch). UNIFIED the anchor + offset model. The ctor's
   `$reportException` line = the source line the re-lexer reaches at the ctor `function`, = the LAST `#line`
   the children static block emits + `1(#file reset) + 1(}]; close) + 1(attributes static) + V(one var <name>;
   per void slot) + 1(ctor)`. The KEY correction: the void-decl block (`var a; var b; …`) is emitted AFTER
   the whole children array, so **ALL** void slots follow the literal anchor (which is INSIDE the children
   array) — NOT only those trailing the last child (the old `trailingAfterChild` premise was WRONG when the
   last literal sits FAR above the close, e.g. addresslist scrollpane `name` @36, children close @68: the
   2 var-decls addressSelection+scrollpane STILL follow). LAST `#line` is: ELEMENT placement → the attr's
   own line (`placementAttrLine`); TAG placement → the class start-tag line (`classLine + 1`); else the
   `subtreeLastLiteralLine` (deepest-rightmost source-literal attr in DFS order, fall back to closeLine).
   **Verified across ALL childOnlyRich classes in dbg3+corpus+explorer (162 instances): only 4 amazon classes
   change** — addresslist #40→42, addressmanager #24→26, cardlist #34→35, cardmanager #24→26 (all confirmed
   vs gold). scrollview (#13, GREEN) was an old COINCIDENCE: my old anchor=lastLit(9)+4+0 == the true
   placement-anchor(5)+4+voidSlots(4); now BOTH paths give 13 (it routes through the tag-placement branch).

2. **No-literal childOnlyRich → DIRECTIVE (member-LESS) ctor form** (`compile.ts` `childOnlyNoLiteral` ~L3245).
   A childOnlyRich class whose children static emits NO source `#line` — every child is an anon-class
   reference / constraint with NO source-literal value attr (`subtreeLastLiteralLine` undefined) and NO
   `defaultplacement` sentinel — NEVER resets `#file` to "" inside the children array, so the synthetic ctor
   inherits the CLASS HEADER source context → the DIRECTIVE form (`debugConstructor`, member-less), tracked
   at `classLine + 4 + extraStatic + voidSlots`. (tabsbarview3 #44, tabsbarviewcomplete #52, tabsview #78 —
   the single child is `{…ref to $lzc$class_muw}` with only a `width` constraint, no literal.) **Verified:
   ONLY those 3 tabsview.lzx classes across the WHOLE corpus+dbg3+explorer switch to directive form, all 3
   gold-confirmed; CLOSED component-browser.** Discriminator: form follows lastLit set/undefined exactly —
   tabsbarview1/tabsview1/tabsbarview2 (lastLit SET) stay PLAIN (gold-confirmed).

3. **Class-static-method-only class → PLAIN ctor at lastStaticMethodClose + 7** (`compile.ts` `staticMethodRich`
   ~L3248 + the `<method allocation="class">` branch L3107 records `lastStaticMethodClose`). A class with
   ONLY `allocation="class"` methods (no instance code member, no view children) is member-rich in the PLAIN
   sense: the static methods sit at the TOP of the ScriptClass body and their `#endContent` resets `#file` to
   "" → generated-context ctor. Line = `lastStaticMethodClose + 5(method→ctor span) + 2(the tagname/attributes
   statics that, for static methods, sit AFTER the methods)`. Probed: probe1 m1@5→12, probe2 m2@13→20,
   iso8601 leadingZero@40→47. amazon-only (only iso8601.lzx has allocation=class methods in the set).

4. **Static-method debug body omits `with (this)`** (`sc.ts` `compileFunctionDebug` new `isMethod=true` param;
   `compile.ts` `compileMethod` passes `!isStatic`). The PRODUCTION path already did `compileFunction(...,!isStatic)`
   but the DEBUG path hardcoded `isMethod=true` → spurious `with (this) {` around static-method bodies. Now an
   `allocation="class"` method's body compiles WITHOUT the wrapper (NodeModel omits `#pragma 'withThis'` for
   ALLOCATION_CLASS). This was the LAST amazon byte (iso8601 stringFromDate body) → amazon CLOSED.

**METHOD that protected the gate (per the prior worker's directive):** dbg3 IS full of childOnlyRich classes
(shadow_bottom/shadow_right) whose ctor lines are ALREADY correct — so before each change I swept EVERY such
class across dbg3 + all 346 corpus (forced-debug) + 62 explorer-debug, computed the predicted-vs-current delta,
and confirmed ONLY the intended targets changed. dbg3 stayed RAW IDENTICAL after every fix.

## SESSION 2026-06-24 (calendar: constraint-preceded `$lzc$bind_id` directive-suppression — LANDED)
**explorer-debug 60 → 61. CALENDAR CLOSED.** The prior NO-GO ("universal binder-line-state, HIGH dbg3 risk")
was AVOIDABLE — the discriminator turned out to be precise and STRUCTURAL, not a blanket runningPathname
change. ROOT CAUSE (verified via `-SS` calendar-src dump, decisive): the infopanel binder follows a
`$datapath` whose sub-map ends with a CONSTRAINT value (`p: new LzAlwaysExpr(...)`, from
`<datapath p="${...}"/>`). That constraint's value was compiled via `compileAttribute` →
`#beginAttribute ... #file #endAttribute`; the trailing empty `#file ` resets the JavaCC `Token.currentPathname`
to "". Unlike a LITERAL attr (which emits a `litReset`/R marker), a CONSTRAINT emits NO litReset — so the
OUTER instance's following `$lzc$bind_id` (alphabetically after `$datapath` in the attrs map) wrongly stayed
Pattern B (directives shown). The fix is NOT "reset runningPathname on every forceBlankLnum" (that over-fires
on every post-method binder); it is scoped to the constraint-bearing `$datapath` map tail.

**FIX (2 files):**
1. `src/debug.ts` — new op `OP_PATHRESET_ONLY` ("r") + `pathOnlyReset(nLine)`. Resets `runningPathname=""`
   (→ Pattern A) AND sets `runningSrcLine = nLine`. (Distinct from `litReset`, which is for a source-literal
   attr whose `#endAttribute` lands at srcLine+2.)
2. `src/compile.ts` (`emitNode`, the `node.datapath` branch ~L1660) — append `pathOnlyReset(dpN)` to the
   `$datapath` value, GATED to `node.datapath.lastMemberSrcLine !== undefined` (the datapath has a CONSTRAINT
   deps body). `dpN = lastMemberSrcLine + 8`: the binder `function`'s line in the concatenated NodeModel
   script, counted by the JavaCC lexer relative to the deps body's last `#line` — the datapath-map tail
   between that `#line` and the binder is exactly 8 source lines (deps fn body close + `#file ` + blank +
   `p: new LzAlwaysExpr(...)` + binder). Verified in the `-SS` calendar-src dump: deps `#line 166` → binder
   function at logical line 174 (= 166 + 8); gold `$reportException("", 174)`. ✓

**WHY IT DOESN'T BREAK dbg3 OR amazon (the discriminator's precision):**
- **dbg3** — its two binders (tooltipview bind_id/bind_name) are the FIRST attr of their instance (no
  `$datapath` precedes them), so `pathOnlyReset` never fires for them; they stay first-attr Pattern B. dbg3
  RAW IDENTICAL preserved (850579).
- **amazon** — its `<datapath>` is LITERAL (`pooling: true, xpath: "CustomerReviews"`, no `${...}` constraint),
  so `lastMemberSrcLine` is undefined → the gate EXCLUDES it. Its trailing `xpath` literal attr already emits
  its OWN `litReset` (correct path-reset + N), so a second reset here would CLOBBER the N (mine showed N=8 from
  `0+8` before the gate was added — caught and fixed). The `reviewsContainer` bind_id stays correct (N=305).
- A grep over ALL golds (explorer-debug + corpus): **only calendar** has a `LzDatapath}, $lzc$bind_id` case —
  the fix is inherently scoped to the single occurrence in the whole corpus.

**REMAINING 1 DIFF — NO-GO (documented):**
- **component_sampler @1883467** — the long-documented intractable Pattern-A registration discriminator. NO-GO.


THREE clean PATH-A fixes landed; calendar advanced 1091923→1566583 (3 walls cleared), amazon 1376001→1492886 (1 wall). All deterministic, characterized via stock `-SS` lineann/src dumps (no oracle patch). NO new explorer-debug MATCH yet — calendar/amazon each cleared their wall but hit a NEW deeper SEPARATE bug. Gate held: corpus 266/0/80, fixtures 96/0/0, dbg3 RAW IDENTICAL, solo 61/1, bare exit3.

1. **resource-constraint line-bleed (the documented calendar `$mkm` / amazon `$mqy` cluster — now SOLVED, prior worker's NO-GO was wrong)** `src/compile.ts` ~L1448. A `<attribute name="resource" value=… when=…/>` ELEMENT child of a view is HOISTED by the oracle (`ViewCompiler.compileResources`, lines 350-390) onto the parent view as a `resource="$when{value}"` TAG-attribute, then the `<attribute>` element is REMOVED. So the resource constraint's source location is the **PARENT view's start-tag endLine**, NOT the `<attribute>` element's own line. Discriminator is razor-narrow: `-SS` sweep of 13 attrs (resource/opacity/bgcolor/width/x/y/name/…) showed **ONLY `resource`** anchors at the parent line; EVERY other attribute keeps its own. So `const conSrc = an === "resource" ? el : c;` (el=parent view, c=the `<attribute>` element). NOT the prior worker's `c.endLine===el.endLine+1` gate (which fired on hundreds of cases, 58→1) — the true rule is per-attribute-NAME, not per-line-adjacency. (calendar cal-button iconv resource #148, amazon classlib tabButton resource #65.)
2. **`<script>` try-wrapper over-fire** `src/sc.ts` `compileScriptBodyDebug` ~L2478. The oracle runs `VariableAnalyzer` on the ORIGINAL script body (with `var` decls intact) → script-scope hoisted vars are LOCALS → in `available` → NOT free (`free = used − available`). Our `rest` strips `var` BEFORE `analyzeScope`, so those names re-appear as free assignment targets → spurious `needTry=true`. FIX: `const freeReal = new Set([...scope.free].filter((n) => !hoistNames.includes(n)))` then `needTry = scope.dereferenced || freeReal.size > 0`. (calendar event.lzx top-level `<script>` = two `var X = {…}` globals → NO try-wrapper, matches gold.)
3. **`$immediately{expr}` debug spacing** `src/compile.ts` L1338 (tag-attr loop) + L1437 (`<attribute>` element loop). A `$immediately{}` value must print compress=false in debug (`60 - 11`, not `60-11`): use `compileExprDebug(con.expr)` under `COMPILE_DEBUG`. (calendar infopanel `<basebutton x="$immediately{60-11}">`.)

**REMAINING 4 diffs (after this session):**
- **calendar** @1566583: a `$lzc$bind_id` IIFE — gold SUPPRESSES the `/* -*- file: calendar.lzx#165 -*- */` directive before `var $lzsc$temp`, mine emits it. This is the **id/Pattern-A binder directive-suppression** cluster (the binder follows a `datapath` `LzAlwaysExpr` in a serialized children-static). Known binder-line-state family (see `src/debug.ts` Pattern-A resolver).
- **amazon** @1492886: `$reportException("", 42, $lzsc$e)` (gold 42 vs mine 40) in the SYNTHETIC ctor (`$lzsc$initialize`) of the `lz/checkbox.lzx` library class (a `<class name="checkbox">` with a `<multistatebutton>` view + methods). Off-by-2 = the **synthetic-ctor line for a library class with member children** — the prior worker's flagged "class-ctor leading-blank-line+ctorLine" sub-target. SHARED CLUSTER with component-browser (also unresolved). HIGH RISK (every class has a synthetic ctor → touches dbg3/corpus) — characterize the ctorLine model against dbg3's own classes BEFORE touching. NOT attempted this session to protect the green gate.
- **component-browser** @1484510: tabsbarview3 childOnlyRich plain-vs-directive ctor (documented, HIGH RISK).
- **component_sampler** @1883467: Pattern-A reg discriminator (documented-intractable, leave alone).

**METHOD NOTE (reusable):** the `-SS`/`--savestate` ground-truth recipe works great. Add `-SS` to a /tmp copy of the lzc invocation in `compile-debug-solo.sh` (do NOT edit the committed script). It writes `<src>-src-*.txt` (the ScriptClass input WITH the `#line N` markers that drive funcLine — grep `userFunctionName=<attr>=` then read the preceding `#line`) and `-lineann-*.txt` beside the SOURCE file. Dumps land next to the .lzx (Main.java:382 `sourceNameNoExt`), NOT the out dir. ALWAYS delete them when done (`find … -name '*-src-*.txt' -delete`). To isolate a per-construct rule, build minimal `<canvas><class…><view…><attribute…></class></canvas>` probes and sweep ONE variable (attr name / value len / nesting / siblings) — that's how the resource-only discriminator was nailed (the earlier `single` vs `a1` flip was an unreliable cross-file grep, not real byte-position drift).

### SESSION 2026-06-24 (binder-cluster + ctorLine void-slots) — explorer-debug 55 → 58. Gate GREEN throughout.
Closed the PRIMARY binder cluster (dataimage, weather, lzpix) and advanced amazon. Two landed fixes
(both in `src/compile.ts`), proven via stock `-SS` lineann/src dumps:

1. **PRIMARY — first-child id-binder funcLine (dataimage/weather/lzpix), +3** (`emitAnonClassDebug` ~L1011).
   When an anon-INSTANCE class's FIRST child instance leads its attrs with a `$lzc$bind_id`, that binder is
   serialized as the very first entry of the `children` static array. Its funcLine is **`classLine + 3`**
   (= the parent view's `el.endLine` + 2), NOT the old `ctorLine − 4`. Mechanism (from `-SS` `*-src-*`): the
   ScriptClass emits the class header `#line` at classLine+1 (= node.el.endLine), `displayName` on the next
   line, and the children-array's first `#line` (the binder) one further → classLine+3. Verified: dataimage
   yellowRect #132 (was #135), weather forecastData #222 (was #229), lzpix agroup #527 (was #531). The old
   `ctorLine−4` happened to equal el.endLine for some, masking the bug. color-$3 stays green (classLine+3 ==
   its prior value there). **This was the documented "binder serialized inside anon-class children uses
   el.line" item — the real rule is classLine+3, NOT a raw el.line swap (which crashed prior workers 61/62).**

2. **SECONDARY — member-less class ctorLine void-slot count (amazon class_sel)** (`emitClassBlock` caller ~L3333).
   The member-less NON-state synthetic-ctor line now adds the void-slot decl count:
   **`classLine + 4 + extraStatic + voidSlotDecls`** (each `<attribute>` decl with no setter/method is a
   `var name;` line in the ScriptClass before the ctor — the state path already counted these via `ndecls`,
   the non-state path did not). amazon `<class name="sel">` (2 `<attribute>` decls) ctor #13 → #15.
   Advanced amazon 1361194 → 1376001 (did NOT fully close — hit the constraint-line-bleed wall below).

**REMAINING 4 DIFFS — characterized, all NO-GO after real `-SS` work:**
- **calendar `$mkm` + amazon `$mqy` — constraint-after-handler line-bleed (SHARED cause).** A child
  `<attribute when>` constraint whose SINGLE-LINE value sits on `el.endLine + 1` (the line right after the
  view's `>`, following TAG event-handlers that track at the view's `>` line) is lexed by JavaCC's
  SimpleCharStream in the PRECEDING handler's `#line` context → tracks at the VIEW's line, not its own.
  (calendar cal-button.lzx iconv resource @149 → gold #148; amazon classlib.lzx tabButton resource @66 →
  gold #65.) BUT a `c.endLine === el.endLine + 1` gate fires on 100s of CORRECT cases (58→1 catastrophic
  regression — REVERTED). And basegridrow.lzx width (MULTILINE value @181-183, also state-nested) correctly
  uses its OWN endLine #183 — so the discriminator is NOT element-line arithmetic; it requires simulating the
  JavaCC line counter through member serialization (does the value text cross a fresh `#line`?). Real
  lexer-state work, high regression risk. NO-GO.
- **component-browser tabsbarview3 — childOnlyRich plain-vs-directive ctor form.** Gold uses the DIRECTIVE
  synthetic-ctor form (`debugConstructor`, body @ source #44), mine uses the PLAIN form
  (`debugConstructorPlain`, generated context). From `-SS`: tabsbarview3's `children` static is `[{…ref to
  $lzc$class_muw}]` — a single ANON-CLASS REFERENCE, no inline instantiation content, so the ctor stays in
  SOURCE context (#44, directive). shadow_bottom/scrollview (currently green plain-form) have inline-content
  children that push to generated context. Fixing requires distinguishing children-array content type
  (anon-class-ref vs inline) in the childOnlyRich model — same family as component_sampler, high risk to the
  many green childOnlyRich classes. NO-GO.
- **component_sampler — Pattern-A registration discriminator.** Gold emits NO `/* file */` before
  `lz["basefocusview"]=…`, mine emits `/* file: component_sampler.lzx#1 */`. Long-documented hardest
  reg-directive case, unrelated to binder/ctorLine. NO-GO (as flagged).

### SESSION 2026-06-24 (Cluster E + F) — explorer-debug 52 → 55. Gate GREEN throughout.
Closed datepicker_example, contactlist, lzproject-LZProject. Four landed fixes (all in `src/compile.ts`):
1. **Cluster E (datepicker, contactlist)** — a directive-less `<dataset>`/`lzAddLocalData` top-level
   statement inherits the file context of the LAST top-level CLASS emitted before it. Top-level class
   emission now does `crossUnitFile = debugFile(child)` (it left `Token.currentPathname` at the class's
   own file via its `)()($lzc$class_…)` tail). datepicker's `datepicker_strings_en` → `base/basecomponent.lzx`;
   contactlist's `mydata` → `lz/tabelement.lzx` (was the stale `debugger/debugger.lzx` default). Contactlist
   CLOSED outright; datepicker advanced past it.
2. **datepicker childOnlyRich ctorLine** — the synthetic-ctor `$reportException` line anchors on the LAST
   `#line` the children static block emits = the start-tag-close line of the DEEPEST-rightmost element with
   a source-literal attr (`BuiltNode.subtreeLastLiteralLine`), NOT `lastOwnChild.closeLine`. datepickercombobox:
   outer `<view>` closes @55 but the basebutton grandchild's `styleable="true"` literal is @54 → 54+4=58 (was 59).
   For the common case (last child carries the last literal) this equals closeLine, so shadow_bottom/tabscontent
   are unchanged. Verified via oracle `-SS` `*-src-*.txt` dump (the `#line 54` before the ctor).
3. **Cluster F (lzproject)** — a canvas `debug="false"` attribute (or `compileroptions="debug: false"`)
   OVERRIDES the `--debug` flag: **Parser.java:418-422** runs `env.setProperty(DEBUG_PROPERTY, dbg.equals("true"))`
   UNCONDITIONALLY when the attr is present, AFTER Main applied `--debug` → a NON-debug build under `--debug`.
   Deterministic oracle behavior, NOT a bug. TS now: `debug = opts.debug === true && !canvasDebugOff`. lzproject's
   gold was a plain SOLO production build (590KB, no debug markers); mine now matches. **The oracle itself produces
   this — re-verified by re-running compile-debug-solo.sh on LZProject.lzx.**
4. **crossUnitFile origin-gate REMOVED** — was `if (child.origin == null || child.origin === sourceId)`; now
   EVERY top-level instance shifts crossUnitFile (incl. library-origin instances spliced inline in doc order).
   lzpix's `sizeds` http-dataset (origin `classes/dataman.lzx`) now leaves `classes/dataman.lzx` for the following
   `userds` local dataset (was `classes/draggedphotos.lzx`). The debugger lib is a monolithic closure — never an
   individual instance in this loop — so no gate is needed. lzpix advanced 1122092 → 1292524.

**REMAINING 7 DIFFS (characterized for the next worker):**
- **binder-funcLine ×3 (dataimage @965376 #132 vs #135, weather, lzpix @1292524 #527 vs #531).** A `bind_id`
  binder serialized as the FIRST attr of a children-array entry INSIDE an anon class's `children` static inherits
  the element's OPEN-tag line (`el.line`), NOT the start-tag-close line (`el.endLine`). dataimage `<view id="yellowRect">`
  opens @132 closes @135; the binder funcLine = 132 (proven by `-SS` lineann: `$lzc$bind_id: #fileline 43#131 ( #fileline 43#132 function`).
  **DO NOT just swap `el.endLine`→`el.line` globally — it crashed 61/62 (most binders, esp. top-level `LzInstantiateView`
  ones, correctly use `el.endLine`; only the class-children-static ones use `el.line`).** The fix must be SCOPED to
  binders serialized inside an anon-class children static, like the existing "re-point to ctorLine−4 when FIRST child
  of an anon class" logic at compile.ts ~1285. The `bind_name` pairing (`baseLine + binderLineSpan`) must move with it.
- **calendar @1091923** — a `$mkm` constraint/method funcLine off-by-one (gold `cal-button.lzx#148`, mine `#149`).
- **amazon @1361194** — class `$lzc$class_sel` synthetic ctor: gold has 6 leading blank lines before `var $lzsc$temp`
  + ctorLine #15, mine has 3 blanks + #13. A class-with-class-attrs (void slots `selectedItem`/`val`) ctor blank-line model.
- **component-browser @1484510** — class `$lzc$class_tabsbarview3` ctor: gold has 5 leading blanks + no leading
  `/* file: -*- */` directive before `var $lzsc$temp`; mine emits the directive + collapses the blanks. S40-family leading-directive suppression.
- **component_sampler @1883467** — the Pattern-A reg discriminator (`lz["name"]=$lzc$class_name;` block: gold emits NO
  per-reg directives, mine emits `/* file: component_sampler.lzx#N */` each). This is the long-documented intractable
  reg Pattern-A anomaly (see "REG PATTERN-A ANOMALY — CONTRADICTION MATRIX" below).

**THE 38 DIFFS — clustered (this is the Phase-2 scope, prioritized by leverage):**
- **[13] Cluster A — reg-trailer stray `<file>.lzx#1` directive. ✅ RESOLVED 2026-06-24 (13/13, 24→37).**
  See the "CLUSTER A RESOLVED" note below for the full Pattern-A/B discriminator + the 3 fixes
  (resource/source literal branches + folded-text neutrality).
- **[13] Cluster B / [4] Cluster C — super-tail same-file directive. 🟢 PRIMARY LANDED 2026-06-24.**
  The `#52` (datapath `_valuedatapath`), `#29` (item-loop body), and `#114` (if-block body) super-tail
  directives now EMIT. All 17 advanced: weather 130556→182794 (+52KB), contactlist 153414→**1004295**
  (≈ whole file), combobox/radiogroup/grid/tabs/menu/list/floatinglist/component_sampler/form/tabslider/
  basics-form/animation/survey +186 past `#29`, component-browser 389374→410645, tree 422872→444143.
  See the "SUPER-TAIL PARTIAL" note below for the cracked rules + the remaining `listselector.select`
  else-super `#33` blocker (the one hard tail, needs oracle TU-instrumentation).
- **[2] Cluster D — `$reportException` ctor-line drift. ✅ RESOLVED 2026-06-24 (classes-events + scrollbar
  CLOSED, 37→39).** See the "TAILS D/G/I" note below.
- **[2] Cluster G — object/array literal SPACING. ✅ RESOLVED 2026-06-24 (calendar/amazon ADVANCED to the
  `#33` wall).** See the "TAILS D/G/I" note below.
- **[1] Cluster I — `<script src>` directive name. ✅ RESOLVED 2026-06-24 (lzpix ADVANCED
  1084805→1122083).** See the "TAILS D/G/I" note below.
- **[3] Cluster E — reg-directive file CONTEXT (cross-unit). 🟡 DOCUMENTED + DEFERRED.** A library
  `<dataset>` / cross-unit reg emitted after an ON-DEMAND class registration inherits the WRONG
  `Token.currentPathname`: gold uses the last-emitted class's file (`base/basecomponent.lzx#1`,
  `lz/tabelement.lzx#1`, `classes/dataman.lzx#1`), mine the `debugger/debugger.lzx` default. `crossUnitFile`
  is only updated by APP-ORIGIN top-level instances (`compile.ts` ~3476), not by on-demand class emission
  from non-app-origin library instances. Now affects 3 (datepicker, contactlist, lzpix). Needs cross-unit
  threading of the last-emitted-class file (GAP-2/GAP-4 family); deep + dbg3/corpus-risky.
- **[1] Cluster F — resource-lib naming/order** (lzproject: gold `$LZ1` anon @spriteoffset>tab vs mine
  `upBtn_rsc` named). 🟡 DEBUG-only resource-emission ORDER divergence (production lzproject SOLO matched).
  Non-portable + shared; single example; DEFERRED.
- **[1] dataimage — binder funcLine for a LEAF multi-line start tag. 🟡 DOCUMENTED + DEFERRED.** (The
  original "Cluster H" $lzsc$initialize stray directive @953197 was already resolved/shifted; dataimage's
  current first divergence is a `$lzc$bind_id` funcLine: yellowRect `<view id=…`@132…`/>`@135 wants #132
  but `el.endLine`=#135. A CONTAINER class-root binder (tooltipview tp @17…`>`@20 → #20) AND a single-line
  container (tree xxx @64 → #65) both want endLine-based values; changing the universal `el.endLine`→`el.line`
  broke 62 programs. Leaf-vs-container is 1 example + every-binder-dbg3-shared → SKIPPED.)

**2026-06-24 — CLUSTER A RESOLVED (24→37 match, 13/13 closed).** The reg-trailer Pattern-A/B
discriminator: the `lz["X"]=…` registration trailer is Pattern A (inline, NO directive) iff the LAST
top-level instance left `Token.currentPathname` reset to "" — i.e. its subtree has a genuine source
*literal value attr* (no `<script>`/folded-content reset, no top-level id/name). **Discriminator vs
dbg3 (Pattern B):** dbg3's last instance is a `width="${parent.height}"` *constraint* (`LzAlwaysExpr`,
NOT a literal) → keeps `currentPathname` at the app file → Pattern B (sequential `/* file: app#k */`).
THREE input-classification bugs dropped the literal flag for the Explorer apps:
1. `resource="http:…"` → `source: "…"` (compile.ts ~1258, URL branch): emitted the literal value but did
   NOT set `hasLiteralAttr` nor append the `litReset` `#endAttribute` marker. FIXED → closed mediaaudio.
2. `resource="file"` → `resource: "$LZN"` (~1260, file branch): same bug. FIXED → closed mediavideo/
   mediaimg/layout/fonts.
3. Folded TEXT content `<text>…</text>` (~1536): the old code set `hasContent=true` → Pattern B always.
   But folded text is NEUTRAL: it neither sets `hasLiteralAttr` (so a canvas child whose ONLY literal is
   folded text — basics `hello` `<text>Hello World!</text>` — stays Pattern B, gold-verified) NOR
   `subtreeHasScriptOrContent` (so it does NOT block Pattern A when the element ALSO has a real literal
   attr — dragdrop `<text x="5" y="5">…`, gold-verified). Removed the `hasContent` var; the
   `color-$3`/`databinding-$10` Pattern-B "anomaly" is a trailing `<script>` element (separate instance
   via the script path, sets `subtreeHasScriptOrContent` directly), NOT folded text. FIXED → closed
   hellowindow/dragdrop/animatorgroup/animation/motion/button/edittext/slider.
Gate held: dbg3 RAW IDENTICAL, corpus 266/0/80, fixtures 96/0, explorer-solo 61/62, debug.mjs passed,
bare exit 3. **NEXT: Cluster D `classes-events` @852827 ($reportException line gold 13 vs mine 16 — a
ctor-line drift) is the lowest-offset remaining Cluster-A-adjacent diff; the big remaining clusters are
B (13, super-tail `#29`) + C (4, datapath super-tail `#52`) — crack C first (4 examples triangulate the
GAP-2/GAP-3 super-tail line-rule).**

**2026-06-24 — SUPER-TAIL PARTIAL (Cluster C/B PRIMARY landed; 37 match held — all 17 advanced).**
The GAP-2/GAP-3 super-tail family. **THREE directive sites CRACKED** (`src/sc.ts`):
1. **Cluster C `#52` — `predecessorTriggersRuleA` brace-tail refinement.** The else-less-`if` block-tail
   NO-FIRE case (ii) now requires the block's LAST nested statement to be a control statement that ITSELF
   ends in `}` (block-terminated). A braceless `if(c) expr;`/`else if(c) expr;` chain tail (baselistitem
   `dataBindAttribute`: `if(attr=='text')…; else if(attr=='value')…;`) does NOT suppress → the super still
   tracks at the outer `}` line → FIRE `#52`. vs baseformitem `init`'s `if($debug){…}` tail (block-
   terminated → NO-FIRE, super keeps own line). Added a per-statement `endsBrace` flag (recorded on EVERY
   statement in `statement()`); `predecessorTriggersRuleA` reads `last.endsBrace`.
2. **Cluster B `#29` + `#114` — nested-first-super block-open quirk.** A super that is the FIRST statement
   of a control-block body (`if`/`for`/`while`/`forin`/`with`/`dowhile`) tracks at the block's open-`{`
   source line (JJTree node-open getToken(1) = the `{` token). Mechanism: `pendingBlockLine` (Printer
   field) set by the new `bodyOfAt(st, enclLine)` wrapper in the control-statement printers; captured in
   `joinStmtsInner` as `blockLine` → `nestedFirstSuperActive` (first statement only). The Rule-B cascade
   (`dbgLineDelta -= 1`) now fires for nested supers too (not gated to joinDepth-1). **Two ordering fixes**
   were load-bearing: (a) `deltaBefore` snapshot — a statement's OWN line directive resolves against the
   delta BEFORE its body (a nested super in the body mutates dbgLineDelta, which must only shift SUBSEQUENT
   siblings); (b) the `if`-printer evaluates `forceBlock(st.t)` (THEN) BEFORE the `elseB` initializer so a
   then-block super's cascade reaches the else block in SOURCE order (JS was evaluating the `elseB` `const`
   initializer first, mutating the delta out of order).
**THE REMAINING BLOCKER (all 17): the `listselector.select` else-super `#33`.** `} else {`@33, super@34.
Mine tracks at eff=33 (own 34 + cascade −1) but the translate-unit renders `lineSame=true` → COLLAPSE
(no directive, no blank); the oracle emits `/* -*- file: #33 -*- */`. The else-super needs to SHOW, but:
(a) a plain cascade-tracked 33 collapses; (b) a block-open-quirk'd 33 with delta-bypass BREAKS dbg3's
basebutton `set_frame` else-super (`}} else {`@107, super@108 → a BLANK LINE, not a directive — it tracks
at OWN 108, delta 0). **The two else-supers are structurally identical** (first stmt of else block adjacent
to `{`) yet render differently — distinguished ONLY by the cascade delta (listselector −1 from the for-
super, basebutton 0) + the generated-line offset. **Genuine contradiction in my generated-line model:**
with identical visible bytes up to the else-super, mine's running linediff == the else-super's linediff
(→ collapse), but gold MUST have them differ (→ show). Cannot reconcile without ORACLE TU-INSTRUMENTATION
(log `TranslationUnit.linenum` + `linediff` per directive-emit at the listselector vs basebutton else-
super, correlate). **DOCUMENT-and-DEFER** — the next worker takes the isolated tails D/G/E/F/H/I instead.
Gate held after every change: dbg3 RAW IDENTICAL (verified ~10×), corpus 266/0/80, fixtures 96/0,
explorer-solo 61/62, debug.mjs passed, bare exit 3.

**2026-06-24 — TAILS D/G/I LANDED (37→39 match).** Three isolated-tail clusters resolved (gate held after
every change: dbg3 RAW IDENTICAL, corpus 266/0/80, fixtures 96/0, explorer-solo 61/62, debug.mjs passed,
bare exit 3):
- **Cluster D — `$reportException` ctor-line drift (classes-events + scrollbar CLOSED).** TWO fixes:
  (1) a class-tag event-handler ATTRIBUTE (`onmouseover=…` on a `<class>`) IS a code member (a `$mhN`
  method) — the class-attr path now calls `noteMember(child.attrLines[an], handler=true)` so the synthetic
  `$lzsc$initialize` ctor tracks AFTER it (borderedbox: handler @6 + 1 trailing void slot → ctor 13, was
  16). `compile.ts` ~2891. (2) The `childOnlyRich` ctorLine over-counted trailing void slots — a member-less
  class with NAMED children (scrollview: scrollto/content/sbx/sby slots) had its named-child slots already
  covered by the `lastOwnChild.closeLine` anchor, so it now counts ONLY void slots AFTER the last own
  child's slot (`trailingAfterChild`), not ALL trailing void slots; dropped the now-subsumed placementSlot
  subtraction. `compile.ts` ~3229.
- **Cluster G — object/array literal SPACING (calendar/amazon ADVANCED to the `#33` wall).** A canvas-level
  `<attribute>` constant object/array value compiled via `compileTypedValue`'s expression/number/boolean
  cases with the PRODUCTION `compileExpr` (compressed); under `COMPILE_DEBUG` they now use `compileExprDebug`
  (compress=false → spaced `, `/`: `). `compile.ts` ~681.
- **Cluster I — `<script src>` directive name (lzpix ADVANCED 1084805→1122083).** A `<script src="md5.js"
  when="immediate"/>` body opens with `#file md5.js`, so its embedded AS3 `class md5` + methods track the
  SRC file (`md5.js#14`/`#24`), not the including `classes/dataman.lzx`. (1) `compileProgramDebug` passes
  the statement's own `.file` as the `lnum` fileOverride when it differs from the base dfile (`sc.ts` ~2463);
  (2) `printAs3ClassDebug` uses the class node's `.file` (not `this.dfile`) for member directives (`sc.ts`
  ~1714). lzpix now hits a Cluster-E cross-unit reg-file-ctx divergence (`app.lzx` vs `classes/dataman.lzx`).

**2026-06-24 — ELSE-SUPER / BLOCK-OPEN GEN-LINE MODEL CRACKED (39→48, +9).** The dominant documented-hard
blocker (the `listselector.select` else-super `#33`, 18 programs) is RESOLVED by ORACLE TU-INSTRUMENTATION
(the sanctioned path). Method: built an instrumented `ParseTreePrinter` (stderr dump of
`TranslationUnit.linenum` + `os/ns.linediff` + the `show` decision per directive, gated to the
listselector/basebutton/reverselayout/lz-list/basetabs/gridtext methods), ran it via the oracle classpath
(`instr-classes:patch/classes:…`, temporary, since removed), and correlated against my TS trace.
**ROOT CAUSE:** the oracle gives each statement its OWN source line — the super-reparse shift applies ONLY
to subsequent SUPER calls (via the block-open quirk), NOT to sibling statements. My old `dbgLineDelta -= 1`
cascade shifted BOTH the else-super AND the intervening `_forcemulti = false` by −1, so their linediffs
stayed EQUAL → the else-super collapsed; the oracle keeps `_forcemulti=false` at 32 (linediff 37) and the
else-super at 33 (linediff 38) → differ → SHOW. THREE fixes (`src/sc.ts`): (1) a nested-first (block-open)
super no longer cascades `dbgLineDelta`; (2) the `if`-with-else printer threads BOTH the then-block `{` line
and the else-block `} else {` line (new parser-captured `elseLine`) via `bodyOfAt` so a leading super tracks
at the block line (then-super set_bgcolor #298; else-super listselector #33 / gridtext #119); the
directive-vs-blank render is decided downstream by the linediff continuum (basebutton set_frame's else-super,
same shape, renders BLANK #108 because its then-branch for-super left the running linediff one higher — NO
`superReparsedInBody` gate needed); (3) a joinDepth-1 Rule-A super emits a DOUBLE annotation `#own #shifted`
so the linediff picks SHIFTED-directive (reverselayout #42) vs OWN-blank (lz/list set_height #244 blank).
**Also resolved corpus GAP-3 super-tail (partial):** `data-accessing-lzdataelement` is now BYTE-IDENTICAL;
`datapointer-creating-node` advanced past its super-tail. dbg3 RAW IDENTICAL + corpus 266/0/80 + fixtures
96/0 + explorer-solo 61/62 + debug.mjs + bare exit 3 held throughout.

**HOW TO RESUME the Explorer-DEBUG grind** — state: **48 match / 14 diff / 0 unsupported**. Iterate:
`node harness/batch.mjs check-explorer-debug`. Rebuild golds only if oracle/patch changes
(`build-explorer-debug`, slow). Remaining ORDER (leverage):
1. ~~A~~ ✅ → ~~C/B PRIMARY~~ 🟢 → ~~D/G/I~~ ✅ → ~~else-super `#33`~~ ✅ DONE 2026-06-24.
2. **basetabs `createChildren` 3-blank super-tail (6 programs):** tabs/component-browser/tree/form/grid/
   component_sampler. A joinDepth-1 Rule-A super after a MULTI-LINE simple-expr predecessor
   (`myChildren.push({…})`@397-400, super@401) needs a THIRD trailing `#own` annotation
   (`#own #shifted #own`) → BLANK(3) not BLANK(2). Adding it universally BREAKS the Rule-B case
   (super+`this.update()` in layout addSubview); gating on "predecessor multi-line"
   (`prevEndLine>prevStartLine`) regressed other matches. Needs a precise discriminator (likely:
   predecessor multi-line AND the super renders BLANK not a directive). To re-instrument the oracle: copy
   `WEB-INF/.../sc/ParseTreePrinter.java`, add a stderr dump in the 2nd `makeTranslationUnits`
   (`notify`/`ANNOTATE_OP_FILE_LINENUM` case) gated on env `LZC_ORACLE_TRACE`+filename/linenum, compile
   it against the webapp jars into a temp dir, prepend that dir to the oracle classpath (before
   `oracle/patch/classes`), run via `compile-debug-solo.sh`-equivalent flags. (The instr build is
   self-contained + was removed after use; the committed `oracle/patch/` was NOT touched.)
3. **method/handler funcLine off-by-one** (calendar/weather `$mkm` #148 vs #149; datapointer #195/#194) —
   a method-declaration source-line gap, distinct from the super-tail.
4. **Cluster E (3, cross-unit reg-file-ctx) / F (1, resource-order) / dataimage (1, leaf binder funcLine)
   / amazon $lzsc$initialize (1)** — deeper/structural, DOCUMENTED + DEFERRED above.
Each fix MUST hold the no-regression gate (corpus 266/0/80, explorer-solo 61/62, fixtures 96/0, debug.mjs
all-passed, dbg3 RAW IDENTICAL) — the debug backend is shared with dbg3 + the 64 corpus debug golds.

**2026-06-24 — GAP-20 RESOLVED (59→60) — lzpix CLOSED.** The trigger was an `onclick=""`
event-handler ATTRIBUTE (empty-string value), not the `<handler>` element: the attribute form
does NOT trim-to-null (`addHandlerFromAttribute`), so an empty value is a real empty body →
`function($0){}`. `emitHandler` gained an `isAttr` flag (element form keeps trim-to-null).
Three stacked lzpix divergences then closed: (1) frame enumeration excludes the oracle's OWN
generated `*.sprite.png` montage; (2) a directory-`src` all-PNG montage uses the source DIR as
`sprite:` + UNSCALED-height advance (`allGif || isDir`); (3) `<script src=… when="immediate"/>`
now reads its `src` file (md5.js, an AS3 `class md5 { static var… }`) — was dropped. Plus a
global-ordering fix: a NON-`<library>` fragment include (a bare `<view>`) interleaves its
globals in DOCUMENT order (orderGlobals cat 1, not cat 2 = end). See known-gaps GAP-20.

**2026-06-24 — GAP-10 RESOLVED (60→61) — window_example CLOSED.** A `<canvas oninit="…">`
event-handler ATTRIBUTE makes the canvas an anonymous LzCanvas subclass
(`Class.make("$lzc$class_m2",["$m1",fn],LzCanvas,…)` + `$delegates:["oninit","$m1",null]`).
Fix: the canvas-attr loop skips event attrs; the canvas-member synth node carries the canvas's
event attrs so `buildNode`'s `emitHandler(isAttr=true)` path generates the method + delegate; the
anon-class trigger broadens to "member children OR event attrs". See known-gaps GAP-10.

**2026-06-24 — GAP-19 RESOLVED (58→59) — amazon CLOSED, the full Amazon demo compiles byte-identical.**
A `<class>` with `<method allocation="class">` (amazon `iso8601.lzx` `ISO8601Date`): the oracle
(a) routes each static method to the CLASS-property array (4th `Class.make` arg, document order,
before `tagname`) — NOT the instance-member list — and (b) compiles its body WITHOUT `with(this)`
(`NodeModel.addMethodInternal` skips `#pragma 'withThis'` for ALLOCATION_CLASS, NodeModel.java:1619;
`addProperty` routes to `classProps`). With all methods static, the synthetic default ctor
`$lzsc$initialize` is the only instance member → it appears FIRST. FIX: `compileFunction` gained an
`isMethod` arg (default true; `compileMethod` passes `!isStatic`); `emitClassDef`'s `<method>` branch
pushes `allocation="class"` methods to `classAllocEntries` not `instEntries`. `src/sc.ts:2464`,
`src/compile.ts:1854` + `<method>` child branch ~2988. Gate held: corpus 266/0/80, fixtures 96/0,
debug pass, dbg3 RAW IDENTICAL, bare exit 3. (NOTE: debug-build path for static methods is NOT
exercised by dbg3 and was left as-is — compileMethod's COMPILE_DEBUG branch still emits the method
via instEntries; revisit if a debug build hits an allocation="class" method.)

**2026-06-23 — GAP-7 RESOLVED (57→58) + real Calendar app compiles byte-identical (FIRST §0
real-app blocker closed).** Class-level `<datapath>` with a `${}`-binder/methods was refused;
fix = apply the SAME `isState = true` routing the instance path uses (compile.ts ~1483) instead of
refusing (~3000). A datapath is `canHaveMethods=false` (like a `<state>`): its binder/method members
install inline in the `$datapath` asMap's `attrs` (no anon subclass) →
`mergeAttributes({$datapath:{attrs:{$mfN:function(){…}},p:new LzAlwaysExpr("p","string","$mfN","$mfM",null)},"class":LzDatapath})`.
The existing class-datapath emit (~3050) already built the asMap; the only change was refuse→isState.
This UNCOVERED + closed 3 STACKED divergences on the now-compiling calendar:
1. **Single-frame GIF cell width** (compile.ts `cell()`): a single-frame `.gif` width is the SWF
   TWIP-bounds round `round(floor(d*20*.999)/20)` (gripper.gif 800×7→**799**×7; topbar 240→240) —
   DISTINCT from the montage cell `floor(d*.999)` (105→104). Branch on `infos.length`.
2. **`.swf` autoPng enumeration digit-count** (node-io.ts `resolveResourceFrames`): multi-frame
   siblings are `<base>NNNN.png` (exactly 4 digits, `\d{4}`, 1-based), NOT bare `\d+` — `arrow.swf`
   must NOT eat `arrow2.png` (which is `arrow2.swf`'s render); single-frame swf falls through to
   `resolveResource`'s `autoPng/<base>.png`.
3. **`<attribute name="resource" value="x"/>` longhand** (compile.ts ~1445): in a `<state>` this is
   the same as `resource="x"` — register the media + emit the named-resource/gensym NAME as a quoted
   string (`resource:"leftcap_oval"`), not the untyped-`<attribute>` "expression" identifier path.
Real Calendar (`openlaszlo/examples/calendar/calendar.lzx`) now compiles exit 0, 342 KB, and is
byte-identical to the oracle prod gold under standard normalization (dims/appbuilddate/proxied).
Gate GREEN (corpus 266/0/80, fixtures 96/0, debug all-passed, dbg3 RAW IDENTICAL, refusal exit3).

**2026-06-23 — ALL 4 STANDING DIFFS CLOSED (53→57). See known-gaps.md GAP-15..18 for full detail.**
- **dataimage @93974 → GAP-15:** `resource="http://host/path"` keeps its scheme (java.net.URL with
  non-empty host); only host-empty relative URLs reduce to a bare path AND get
  `adjustRelativeURL`-relativized (`adjustRelativePath(path, appDir, fileDir)`). New helper
  `urlSchemeSource(raw, appDir, fileDir)` in compile.ts. This also CLOSED lzproject's final divergence.
- **contactlist @107729 → GAP-16:** `<dataset src>` raw serialization now PRESERVES XML comments
  (JDOM SAXBuilder+XMLOutputter raw retains them). `parseXml(text,{keepComments:true})` for the
  local-dataset src path only; comments carried as text nodes w/ `comment:true` flag (NOT a new
  XmlNode union member — avoids narrowing ripple), re-wrapped by serializeXmlRaw.
- **menu_example @205452 → GAP-18:** the `LzInstantiateView({…},N)` 2nd arg is the SUBNODE COUNT
  (NOT a Class.make source-line — handoff misdiagnosed). `instanceContribution` now returns 0 for
  `initstage="late"|"defer"` (subtree deferred off the queue, NodeModel.totalSubnodes:709).
- **lzproject @488810 → GAP-17 then GAP-15:** class `<attribute>` longhand `$path/once/always` type
  arg now runs explicit `type=` through `aliasType` (`html`→`text`, ViewSchema:54/61); then its
  FINAL divergence (@503274, the included-file http:url relativization) was closed by GAP-15.

Gate GREEN throughout (corpus 266/0/80, fixtures 96/0, debug all-passed, dbg3 RAW IDENTICAL, exit3).

**2026-06-23 — GAP-13 RESOLVED (`basetabpanecontent` `defaultplacement` sentinel gating).**
The `userClassPlacement` placement-sentinel child (`{attrs:<placement>,"class":$lzc$class_userClassPlacement}`)
must only be appended — and `defaultplacement` only removed from the default-attrs — when the
class ALREADY emits a `children` slot, i.e. it has its OWN children OR inherits children. ROOT:
`ClassModel.emitClassDeclaration` (ClassModel.java:772-785) only calls `nodeModel.childrenMaps(env)`
(NodeModel.java:2285-2306, where the sentinel + `removeAttribute("defaultplacement")` live) inside
the `if (hasChildren || inheritsChildren)` gate. A CHILDLESS class with `defaultplacement` (e.g.
`basetabpanecontent`, super=view, no own children, no inherited children) keeps `defaultplacement`
as a plain init in the `mergeAttributes` trailer and gets NO `children` slot at all —
`["tagname","basetabpanecontent","attributes",new LzInheritedHash(LzView.attributes)]`. TS was
unconditionally pushing the sentinel (creating a spurious `"children",[{attrs:"_null_",…userClassPlacement}]`
slot). FIX (compile.ts ~L2940): gate the placement push on `childMaps.length > 0 || inherits`
(compute `inherits` BEFORE the placement block). Closed 4 programs: **component-browser (components),
form_example, tabs_example, tree_example** (46→50). `defaultPlacementTarget` is only used by the
COMPILE_DEBUG ctorLine adjustment, which already requires a named own child, so gating it off for
childless classes is safe. Gate GREEN (corpus 266/0/80, fixtures 96/0, debug all-passed, dbg3 RAW
IDENTICAL, refusal exit3).

**2026-06-23 — GAP-14 gensym off-by-one RESOLVED (50→53; grid/datepicker/component_sampler closed,
lzproject advanced).** The extra `$m` the oracle allocated was a **once-constraint SETTER for a
class `<attribute>` longhand that redeclares an inherited `when="once"` attribute with a plain
value**. Allocation-trace pinned it exactly: the last shared gensym was `$mbp` (v421) @222408;
the oracle then allocated `$mbq` (v422) for a setter `function($0){this.setAttribute("_columnclass",
lz.gridtext)}` + `_columnclass:new LzOnceExpr("_columnclass","expression","$mbq",null)` (NO slot,
inherited) — TS dropped it, shifting the whole downstream `$m` counter −1. Source = `grid.lzx`
`<attribute name="_columnclass" value="lz.gridtext"/>` (no `when`), with `basegrid.lzx:52`
declaring `_columnclass when="once"`. FIX (compile.ts longhand class-`<attribute>` path ~L2794):
after `attrConstraint`, when `con` is null + plain `value=` + no `style=`/`setter=`/event-attr,
look up `inheritedWhen(def.name,an)`; if `once`/`always`, build a literal constraint with that
timing (the class-tag SHORT-form path at ~L2718 already did this — the longhand path just lacked
it). The `else if(con)` branch (L2833) then emits the LzOnceExpr/LzAlwaysExpr setter exactly as
the short form. Gated to the EXACT oracle condition (plain value + inherited once/always + no
style/setter/event) → corpus stayed **266/0/80**, fixtures 96/0, debug all-passed, dbg3 RAW
IDENTICAL (zero gensym ripple). Closed grid_example/datepicker_example/component_sampler;
lzproject advanced @272095 → @488794 (next = `dataBindAttribute` 3rd-arg type `"text"` vs `"html"`
for `description`, a `$path{}` attr-type-resolution gap — separate, NOT gensym).

**2026-06-23 — [SUPERSEDED by GAP-14 above] gensym off-by-one (was NEXT HIGHEST-LEVERAGE).**
GAP-13 unblocked 4 programs (grid_example @218134, datepicker_example @246027, component_sampler
@310565, lzproject @272095) that now ALL share the SAME next divergence: a single `$m`-gensym
counter offset (gold `$lzc$class_mc3`/`$mbr` vs mine `$lzc$class_mc2`/`$mbq` — off by exactly 1).
Confirmed clean off-by-one: gold has 543 unique `$m` gensyms, mine 542; ALL visible text before the
divergence is byte-identical, so the missing allocation produces NO observable output (a suppressed/
forward-allocated symbol). The oracle allocates ONE extra `$m` somewhere between the last matching
gensym `$mb6` (the deps method of a STATE `applied` constraint, grid_example gold @215321) and the
first anon instance subclass `mc3` (`visible="${parent.showvscroll}"`). This is a forward-class
ALLOCATION-ORDER subtlety — needs a full allocation-trace comparison (which source construct in the
state/children traversal bumps the oracle's `$m` counter that TS skips), NOT a speculative codegen
edit (the `$m` SymbolGenerator path is heavily corpus-exercised). DID NOT attempt — documented + left
for a dedicated worker. Likely culprit region: state-class `applied`/`patch` + its children
constraints serialization order in NodeModel.asMap / the state-class routing.

**2026-06-23 — GAP-12 RESOLVED (resource-library emission ORDER + no-dedup), NOT frame ordering.**
The original "frame ordering" framing was wrong. Frame order *within* a `frames:[…]` array is SOURCE
order in BOTH proxied + SOLO (the harness `normalize()` sorts each array on both sides as a
non-portable-order workaround — so source order matches; an attempt to actually alpha-sort the array
in SOLO mismatched the `sprite:` name, which uses the UNSORTED `sources.get(0)` first frame → reverted).
The REAL bug (3 rules, `compile.ts` resource section ~L2445-2480/2560/3270):
  1. EMISSION ORDER = all named `<resource>` → all `<font>` addFont → all anon `$LZ` inline
     `resource="path"` → `__allcss`, regardless of source doc order (oracle schema phase emits
     resources-before-fonts even when `<font>` is declared first — dataimage; inline `$LZ` come last
     from view-compile). Shared `spriteOffset` advances through named then continues into anon.
  2. NO DEDUP of inline `resource="path"` — oracle `mResourceMap` PUT by relPath but GET by full
     canonical path (`DHTMLWriter:238`/`ObjectWriter:331` `[pga]` bug) → never hits → every ref emits
     a fresh `$LZ` + advances sprite (button_example's two identical `plane_icon.swf` → `$LZ1`+`$LZ2`).
  3. Implementation: named stay inline in `preamble`; `fontEntries[]` + `anonResEntries[]` deferred;
     flush named→fonts→anon at lib-assembly; `$LZ` name assigned at registration (doc order),
     definition deferred; dedup removed. Closed button_example (46th). The 7 ex-`$immediately` +
     datepicker/dataimage now have byte-correct resource preambles and diverge far LATER.
Gate GREEN (corpus 266/0/80, fixtures 96/0, debug all-passed, dbg3 RAW IDENTICAL, refusal exit3).

**2026-06-23 — GAP-9 `$immediately{}` RESOLVED (codegen).** The instance-attribute path already
handled it; this added it to the 3 refusing `<attribute>`-declaration sites (instance
`<attribute>` ~L1336, class-tag attr ~L2692, class `<attribute>` longhand ~L2795 in compile.ts).
Rule (vs `NodeModel.WHEN_IMMEDIATELY`/getInitialValue): `$immediately{expr}` = an EAGER value
emitted as plain raw `compileExpr(expr)` (sc-folded), NOT a constraint (no `$m` setter/deps, no
LzOnceExpr); a declaring `<attribute>` keeps its `name:void 0` slot. NO per-type preprocessing
in this path (the longhand form bypasses COLOR parse / STRING quote): `$immediately{null}`→`null`,
`{0xff0000}`→`16711680`, `{hello}`→`hello`, `{5}`→`5`. Real use = basegrid `bgcolor0/1=$immediately{null}`
→ `bgcolor0:null` (verified). All 7 ex-`$immediately` programs moved unsupported→diff, all now
sharing the SAME new 2nd divergence @99 = GAP-12 (resource frame ordering). `$immediately` output
itself is byte-correct. Gate GREEN (corpus 266/0/80, fixtures 96/0, debug all-passed, dbg3 RAW
IDENTICAL, refusal exit3).

**HOW TO RESUME the Explorer-SOLO grind** — state: **59 match / 0 diff / 3 unsupported** (GAP-19
LANDED 2026-06-24 — amazon CLOSED, full Amazon demo byte-identical; NO body diffs remain).
Next leverage = clear the 3 unsupported (GAP-20 lzpix, GAP-10 window, debugger).
To advance further (gap-fix priority):
0. ✅ **GAP-7 RESOLVED (57→58).** calendar class `<datapath>` (isState routing) + 3 stacked diffs
   (single-frame GIF twip-width, `.swf` autoPng `\d{4}` enumeration, longhand `resource` attr). Real
   Calendar app compiles + byte-identical. See the GAP-7 block above.
1. ✅ **All 4 standing diffs CLOSED (GAP-15..18, 53→57).** dataimage/contactlist/menu_example/lzproject.
2. ✅ **GAP-11 RESOLVED — multi-file resource resolution.** 4 fixes (see known-gaps.md GAP-11):
   (a) PRE-SCAN registers every `<resource name=…>` NAME into `declaredResources` BEFORE the body
   loop (split the dedup into a new `emittedResources` set so emission stays in document order);
   (b) autoinclude shadowing now uses a tag→defining-origin map over ALL explicit-include classes
   (amazon's `classlib.lzx` `<class name="radiobutton">` must NOT pull lz/radio.lzx) — EXCEPT when
   the defining origin IS the autoinclude target lib; (c) an ALL-GIF montage `<resource>` emits
   `sprite:'<dir>/'` (not `<first>.sprite.png`) and advances the master-sprite offset by the
   UNSCALED pixel height; (d) `resolveDatasetSrc(ref, fromId)` resolves `src` relative to the
   including file's dir. amazon's resource section is byte-identical.
3. ✅ **GAP-19 RESOLVED (58→59) — amazon CLOSED.** `<class>` with `<method allocation="class">`:
   the static method goes to the class-property array (not instance members) and its body has NO
   `with(this)` (`isMethod=false`); the synthetic ctor `$lzsc$initialize` becomes the first instance
   member. No cascade — amazon was fully byte-identical after this one fix. See GAP-19 block above.
4. **GAP-20 lzpix** (NEXT; empty `<handler name=…/>` event-DECLARATION form refused) — lzpix
   `classes/photo.lzx`. An empty `<handler name="x"/>` declares the event (like `<event>`), no body.
5. ✅ **GAP-7 calendar CLOSED** (see #0 above).
6. **GAP-10 window_example** — `oninit="…"` event-handler ATTR on an instance that becomes an
   anon-subclass is refused; the anon-subclass event-attr case isn't ported.
7. **debugger** = a debug build (debug="true") — belongs to the DEBUG grind, not SOLO; will close
   when the forced-debug refusal is lifted (GAP-2..5).

**Re-run the baseline:** `node harness/batch.mjs check-explorer-solo` (fast; golds cached).
Rebuild golds only if the oracle/config changes: `node harness/batch.mjs build-explorer-solo` (slow, JVM/file).
The Explorer golds live in `.goldcache-explorer-solo/` — do NOT confuse with `.goldcache` (docs corpus).

## THE METRIC
`LZC_DEBUG_FORCE=1 node harness/batch.mjs dbgshow /tmp/dbg3.lzx` prints
`SKELETON IDENTICAL` (the 1268-gensym structural stream already matches end-to-end
— do not regress this) and `RAW first divergence @byte N`. **N is the byte where my
output first differs from gold; drive it up. It must ADVANCE and NEVER regress
below the recorded frontier** (a regression below the frontier means a change broke
an earlier case — revert it).

## ⚑ MAJOR CHANGE (this session): ORACLE NOW CARRIES A BUG-FIX — gold redefined
The "STOP POINT @583428" 2-case setter anomaly (and the S26-1 deps-body + S27-1
ctor-line quirks) were all the SAME root cause: a **debug-only bug in the stock
4.9.0 oracle**. JavaCC's `SimpleCharStream.adjustBeginLineColumn` (which resolves a
`#line N` source directive) is off-by-one when the directive's relabel region
straddles the **4096-char read-buffer boundary** in the concatenated class lex
stream — nudging a few setter/deps bodies to endLine−1 instead of endLine. It is
purely cosmetic: it only affects `/* -*- file: F#L -*- */` debug comments and
`$reportException(file, LINE)` args; **production (compress) output is byte-identical
with or without it** (verified on a 15-file sample). Proven via a patched oracle:
in isolation every `#line N` resolves to N; the N−1 only appears deep in the stream.

**DECISION (user-approved): fix the oracle instead of reproducing the quirk.**
`modern-build/oracle/patch/` holds a JavaCC-regenerated `SimpleCharStream` (built
from the project's own bundled `javacc.jar` + `Parser.jjt`) with ONE change: the
read buffer is 4096 → 4M (`1<<22`), so the stream never crosses a boundary and the
relabel stays in the regime that is already correct. `lzc.sh` prepends
`patch/classes` to the classpath. The regenerated UNMODIFIED SimpleCharStream
reproduces the stock gold byte-for-byte (proves regen ≡ jar before the fix).
Effect on dbg3 gold: exactly 3 comment lines + 1 cascading ctor line
(modaldialog#33→34, window#53→54, debugger#671→672, modaldialog ctor 42→43); all
converge to the drift-free value. The TS compiler ALREADY emitted these values, so
the S26-1 / S27-1 / setter-quirk special-cases were **DELETED** (net simplification).
The committed `oracle/out/dbg3.dhtml.js` is REGENERATED with the fixed oracle.
⚠️ The `.goldcache` debug golds (the 83 unsup) are still STOCK — regenerate them
with `batch.mjs build` (uses the fixed oracle) at the DoD step before flipping the
refusal. Production golds need NO regen (byte-identical).

## ⚑⚑⚑ SESSION 47: CLOSED color-$3 + dynamiccss (+2 debug golds, 62→64) — the binder-ctorLine rule + the <debug>-anon-class trailer; the lzunit trio + reg/super tail are feature/threading work (DOCUMENTED) ⚑⚑⚑
dbg3 STILL BYTE-FOR-BYTE (850579, RAW IDENTICAL — verified after EVERY change). Regression gate GREEN at
**266 ok / 0 diff / 80 unsup (refusal LIVE)**, fixtures 96/0/0, debug.mjs all passed, dbg3 exit 3, backtrace exit 3.
**Flipped `batch.mjs check` advanced 328→330 ok / 12→10 diff / 6 unsup** — debug golds passing = 330−266 = **64**
(was 62), +dbg3 = 65 byte-perfect. **+2 debug golds CLOSED, ZERO regressions.** Both were the S46-flagged "cleanest
tractable" wins; the remaining 10 diffs are all documented-intractable (reg Pattern-A ×4, super-tail ×2) or genuine
features (backtrace, lzunit postincrement-IIFE, lzunit-$4 library-class cross-unit threading, lzunit-$5 binder/method
ordering) — NONE is a clean line-fix.

### CLOSED THIS SESSION (2): color-$3, dynamiccss.

### RULES CRACKED IN SESSION 47 — DO NOT RE-DERIVE
S47-1. **Class-def-first Pattern-B binder funcLine = (enclosing anon class ctorLine) − 4** (NOT el.endLine, NOT the
  S46-guessed classLine+2). When an anon class's FIRST child instance leads its attrs with a `$lzc$bind_id`, that binder
  is re-lexed at the serialize position immediately after the anon CONSTRUCTOR, so its funcLine tracks the ctor's
  trailing line: ctorLine − 4 (the directive-free `displayName`/`return`/`)()]` wrapper height back to the children-array
  binder). VERIFIED across all 4 color-$3 cases: tName ctor 42→38, tHex 49→45, tRGB 56→52, explicitTExpression 73→69.
  PLUMBING: `buildNode` captures the bind_id spec into `BuiltNode.idBinderSpec` (via the new `lastBinderSpec()` export in
  debug.ts); `emitAnonClassDebug` re-points `node.children[0]?.idBinderSpec.funcLine = ctorLine − 4` once ctorLine is
  known (the binder is a deferred `B<idx>` marker, so its spec object is mutated in place after childrenJs is built).
  dbg3-SAFE: dbg3 has 42 `children", [{attrs: {` arrays but NONE leads with bind_id/$delegates (verified), and
  top-level instance-leading Pattern-B binders (tooltipview@20 = `canvas.LzInstantiateView({attrs:{$lzc$bind_id`, NOT a
  children-array) are excluded by the `node.children[0]` gate. The S46 "classLine+2" guess was WRONG — discard it.
S47-2. **The `<debug>` trailer `new` uses the map's OWN `"class"` value, not a hardcoded LzDebugWindow.** A plain
  `<debug>` (dbg3: `y=120 height=500`, no constraints) resolves to LzDebugWindow; a `<debug>` with %-constraint/method
  attrs (dynamiccss: `width="65%"` etc.) becomes an anon subclass `$lzc$class_mhN`, and the trailer emits
  `new $lzc$class_mhN(canvas, {…}.attrs)` — the SAME class as the instance map's `"class"` field. FIX (compile.ts ~L3122):
  parse `dbgR.map.match(/"class": *([^,}]+)\}?$/)` and use that (fallback resolve("LzDebugWindow")). dbg3-SAFE (its plain
  `<debug>` map's class IS LzDebugWindow → unchanged).

### THE REMAINING 10 DIFFS (re-triaged S47) — all feature/threading, NO clean line-fixes left
- **REG PATTERN-A (4: class-inheritance-$8, datapointer-basics, rpc-soap-$5, rpc-soap-$10):** the S46 CONFIRMED-
  INTRACTABLE anomaly (contradiction matrix in SESSION 46). Threading infra in place; discriminator underivable from the
  node tree → needs ORACLE-INSTRUMENTATION. DOCUMENT-and-SKIP.
- **super-tail (2: data-accessing-lzdataelement @231551, datapointer-creating-node @170785):** a super-call nested in a
  `for`/`if` block-body drops its `/* file: #N */` directive after a block-closing `}` (super Rule-A at joinDepth>1, the
  dbg3-load-bearing machinery). dbg3-RISKY, exactly 2 examples → DOCUMENT-and-SKIP.
- **lzunit-$2 (@936832): postincrement-IIFE feature.** `counter++` used as a VALUE (function arg) is desugared in debug
  mode to a temp-var closure `(function(){var $lzsc$temp=function(){try{var $0=counter; counter=$0+1; return $0}catch…};
  $lzsc$temp["displayName"]="lzunit-$2.lzx#13/1"; return $lzsc$temp})()`. A real JS-compiler (`sc`) expression rewrite +
  the nested-anon-fn displayName mechanism — a FEATURE touching every method body (dbg3-risk). NOT a line-fix. SKIP.
- **lzunit-$4 (@935384): library-class cross-unit pathname threading.** The `places = canvas.lzAddLocalData(…)` dataset's
  leading directive should be `lzunit/lzunit.lzx#1` (inherited from the preceding `)()($lzc$class_TestSuite)` library
  class registration's trailing `currentPathname`), but mine emits the default `crossUnitFile = "debugger/debugger.lzx"`.
  A top-level `<class>`/library-class-registration does NOT update `crossUnitFile`/`lastTopFile` (only LzInstantiateView
  instances do, compile.ts ~L3154). Fixing it = threading the class-def trailing pathname — the same intractable reg
  threading area. dbg3-RISKY (the regs depend on lastTopFile). DOCUMENT-and-SKIP.
- **lzunit-$5 (@938501): binder-vs-method ordering in an AS3 script-class.** gold leads the instance children with the
  `$lzc$bind_id` (Pattern-A) but mine emits the `handle onstop` methods first — a member-ordering difference in the
  asMap for an animatorgroup-with-handlers nested instance. Structural ordering, not a line-fix. SKIP.
- **backtrace (@20810): compileroptions debug+backtrace.** the `Debug.backtraceStack` instrumentation replaces the
  try/catch wrapper pervasively — a large code-gen FEATURE. Low priority. SKIP.

### HOW TO RESUME (S47 → S48)
The clean tractable wins are EXHAUSTED. We are at **64/78 debug golds byte-perfect (+dbg3 = 65)**, flipped check 330/10/6.
The 10 remaining diffs are NOT line-fixes — they are: (a) 4 reg Pattern-A + 2 super-tail = need ORACLE-INSTRUMENTATION or
refuse-acceptance (the dbg3-risky/intractable tail S46 already characterized); (b) 4 genuine FEATURES (lzunit
postincrement-IIFE, lzunit-$4 library-class threading, lzunit-$5 AS3 ordering, backtrace). **The next session is a
STRATEGY decision, not a grind:** EITHER (1) commit to ORACLE-INSTRUMENTATION (patch the oracle to log
`Token.currentPathname` per `outputTagMap`/`addScript` + per library-class-registration, correlate, crack the reg/$4
threading discriminator — the STRATEGIC DIRECTIVE's spirit); OR (2) implement the lzunit postincrement-IIFE feature
(self-contained but dbg3-risky, touches method bodies — do it on a worktree + heavy dbg3 verify); OR (3) accept the 14
holdouts as permanently-refused and ship 64/78 (the refusal STAYS live for those; the DoD 346/0/0 becomes 332/0/14).
Same loop as before: flip refusal (`src/compile.ts` ~L2039 `const debug = isDebugBuild || opts.debug === true; // GRIND
FLIP` + comment the `if (isDebugBuild && !debug) { return … }` block), build, `batch.mjs check` (expect 330/10/6),
`batch.mjs show '<name.lzx>'` (QUOTE the `$`!), REVERT before handoff, verify dbg3 RAW IDENTICAL after EVERY change.
Probe-mine directly: `LPS_HOME=/Users/temkin/Code/OpenLaszlo/downloads/ol-4.9.0-servlet node dist/cli.js "$(cat
.goldcache/<name>.lzx.src)"` (the src path is in `.goldcache/<name>.lzx.src`; LPS_HOME is REQUIRED for the debugger lib).

### PATH TO DoD (corpus 266/0/80 → flip refusal off)
We are at **64/78 debug golds byte-perfect (+dbg3 = 65)**, flipped check 330/10/6. ZERO clean tractable line-fixes
remain. The 10 diffs = INTRACTABLE/RISKY (6: reg Pattern-A ×4 + super-tail ×2, need oracle-instrumentation/refuse) +
FEATURE (4: backtrace, lzunit postincrement-IIFE, lzunit-$4 library-class threading, lzunit-$5 AS3 ordering). To flip the
refusal OFF permanently: either crack/oracle-instrument the 6 + implement the 4 features → 0 diff, OR accept the 14 as
permanently-refused (corpus 266/0/80 → 332/0/14, refusal stays live for those 14). Then `src/compile.ts` permanently
removes the refusal block, raise the harness `execFileSync` maxBuffer (2 ENOBUFS), add `p_debug_*` fixtures.

## ⚑⚑⚑ SESSION 46: built the cross-unit running-state THREADING (infra landed, dbg3-safe) — but the REG PATTERN-A cluster is the CONFIRMED-INTRACTABLE anomaly (NO safe rule; +0 net) ⚑⚑⚑
dbg3 STILL BYTE-FOR-BYTE (850579, RAW IDENTICAL — verified after EVERY change). Regression gate GREEN at
**266 ok / 0 diff / 80 unsup (refusal LIVE)**, fixtures 96/0/0, debug.mjs all passed, dbg3 exit 3, backtrace exit 3.
**Flipped `batch.mjs check` HELD at 328 ok / 12 diff / 6 unsup** — debug golds passing = 328−266 = **62** (unchanged;
+dbg3 = 63 byte-perfect). I built the S45-planned threading infrastructure (it's clean + the right foundation) but
exhaustively PROVED the reg Pattern-A discriminator is genuinely underivable from the structural model — the S35/S36
"partially intractable anomaly", now FULLY CHARACTERIZED with a contradiction matrix so S47 doesn't re-derive it.

### WHAT LANDED (infrastructure — behavior-equivalent, ZERO regressions, dbg3-safe)
The cross-unit running-state threading the S45 handoff reserved as the cleanest next win:
1. **`translateAnnotatedUnit(annotated, incoming?)` now returns `{text, ctx}`** (`ctx: RunningCtx =
   {runningPathname, runningSrcLine}`) and SEEDS its internal `st.runningPathname/runningSrcLine` from `incoming`.
2. **`assembleDebugProgram` threads `ctx` across top-level statements** — a directive-less statement (the tag-map
   regs / trailer) inherits the previous statement's trailing `Token.currentPathname`. This is the oracle's real
   cross-unit lexer mechanism (the JavaCC `Token.currentPathname` STATIC persists across `compileScript` calls).
3. **The reg/trailer lines are now `G<idx>` deferred markers** (`registerReg`/`REG_TABLE`/`resetRegTable` in
   debug.ts, op `OP_REG="G"`), resolved at assembly against the threaded `runningPathname`: Pattern A
   (currentPathname==="") → INLINE no directive; Pattern B → `annoFileLine(file, seq)` + body (seq = i+1 for regs,
   1 for trailer). This REPLACES the structural `regsGenerated`/`topLevelHasIdOrName` guard at compile.ts ~L3155.
4. **A top-level instance appends a `setPathname(P-marker, op "P")`** = its trailing `instanceTrailingFile(...)` (the
   S36 structural discriminator) so the threaded ctx carries the right Pattern A/B context to the next statement.
   This makes the new path BEHAVIOR-EQUIVALENT to the old `regsGenerated` (verified: flipped check unchanged 328/12).
   harness/debug.mjs updated to `.text` (translateAnnotatedUnit now returns an object).

### ⚑ THE REG PATTERN-A ANOMALY — CONTRADICTION MATRIX (S47: DO NOT re-derive; it is genuinely intractable structurally)
I tried EVERY structural discriminator. Each fits some data points and is REFUTED by others. Data points (gold):
| file | top instance | trailing inline child | gold |
|---|---|---|---|
| class-inheritance-$8 | foo (id, top) | bar (id, anon-via-method, INLINE) | **A** |
| datapointer-basics | window (no id/name) | button (anon, handler); `<text>` content NOT trailing | **A** |
| rpc-soap-$5/$10 | view name="buttons" (top NAME) | button (anon, onclick); no nested name | **A** |
| class-inheritance-$30 | container (unnamed) | view name="outside"/"inside" (NAME, anon) | **A** |
| class-inheritance-$19 | three id="mysubclass" (top id, anon) | NONE (views hoisted) | **B** |
| class-inheritance-$26 | container name="thetop" (top NAME) | yellow (NAME, anon) | **B** |
| color-$6 | box2 id="mystic" (top id) | text (BUILT-IN LzText, plain `text=`) | **B** |
| readonly | text id="myID" (top id) | NONE; folded CONTENT trailing | **B** |
Refutations (each "rule" is killed by a pair):
- **Positional "last `#file` wins"**: ci8 & ci26 have BYTE-IDENTICAL serialized trailing (`<plain>: …#file \n#endAttribute}…})` — both leave currentPathname="" — yet ci8=A, ci26=B. The `-SS` dumps confirm NO compileScript runs between the instance and `outputTagMap` (dump 149=instance, 150=regs). So the discriminator is NOT in the serialized stream.
- **"top-level id/name forces B"** (old S36-3): killed by ci8 (top id → A) and rpc-soap-$5 (top name → A).
- **"name anywhere in subtree → B"**: killed by ci30 (child name "outside"/"inside" → A) vs ci26 (child name "yellow" → B).
- **"trailing inline child becomes anon → A, built-in → B"**: fits color-$6 (built-in→B) but killed by ci26 (anon child yellow → B, not A).
- **"`<debug>` element present → B"** (its node-build re-lexes app `#file`): killed by ci30/$31/debugging-$4/input-devices-$7/$10 — all HAVE `<debug>` and are Pattern A (existing passing golds).
- **"trailing child has id/name literal as its LAST serialized attr → B"**: ci19 (own id last→B) ✓ but ci26 yellow's last attr is `width` (plain) → predicts A, gold B ✗.
CONCLUSION: the discriminator depends on oracle lexer/emission state NOT reconstructible from the node tree (likely the actual JavaCC buffer/`getTags()` iteration interacting with `currentPathname` per class-def emission). Per HARD DISCIPLINE (refuse-don't-miscompile; guess+risk→SKIP) I landed NO heuristic. The structural `instanceTrailingFile` (= old `regsGenerated`) is retained inside the new threading (328/12, the proven-safe value). **The ONLY paths to close these 4: (a) ORACLE-INSTRUMENT — patch the oracle to LOG `Token.currentPathname` at each `outputTagMap`/`addScript` and correlate with the node tree to FIND the hidden state (the STRATEGIC DIRECTIVE's oracle-tooling spirit); or (b) accept them as permanently-refused (4 of 78).**

### THE REMAINING 12 DIFFS (unchanged from S45; re-triaged S46)
- **REG PATTERN-A (4: class-inheritance-$8, rpc-soap-$5, rpc-soap-$10, datapointer-basics):** the intractable anomaly
  above. The threading infra is IN PLACE; only the discriminator is missing. DOCUMENT-and-SKIP until oracle-instrumented.
- **color-$3 (1, Pattern-B binder funcLine off-by-one @847896):** the FIRST binder is an ANON-CLASS-first `$lzc$bind_id`
  in a Class.make children asMap (`["displayName","<anonymous extends='view'>","children",[{attrs:{$delegates:…,
  $lzc$bind_id:(function(){ /* file #38 */`). GOLD funcLine=38, MINE=39 (uses `el.endLine`). Fix = for a Pattern-B
  binder that is the FIRST attr of the first instance in a CLASS-DEF children array, funcLine = classLine + 2 (NOT
  el.endLine). The binder render is `idBinderDebug(...elemLine=el.endLine)` (compile.ts ~L1611/L1171); needs the
  anon-class directive line threaded in + a gate to ONLY the class-def-first-attr case (instance leading-directive
  Pattern-B binders e.g. tooltipview@20=el.endLine MUST stay). Narrow but needs the anon-class classLine plumbed to the
  binder site + careful dbg3 verify (dbg3 has Pattern-B binders). TRACTABLE for S47 if the classLine is reachable.
- **super-tail (2: data-accessing-lzdataelement @231551, datapointer-creating-node @170785):** a super-call nested in a
  `for`/`if` block-body is MISSING its `/* file: #N */` directive (gold has it; mine drops it after a block-closing `}`).
  This is the super Rule-A line-tracking at joinDepth>1 — the SAME machinery that is load-bearing for dbg3. dbg3-RISKY,
  exactly 2 examples → DOCUMENT-and-SKIP (per discipline).
- **lzunit-$2/$4 (assertEquals nested anon-fn in method arg @936832/935384):** lzunit AS3 script-class method render
  feature. NOT binder/reg. Separate.
- **lzunit-$5 (@938501):** instance-level Pattern-A binder downstream byte; re-show.
- **dynamiccss (@887597, `$lzc$class_LzDebugWindow` vs `$lzc$class_mh8`):** `<debug>`-element class-naming feature. Separate.
- **backtrace (compileroptions debug:true;backtrace:true):** large pervasive code-gen feature. Low priority, SKIP.

### RULES CRACKED IN SESSION 46 — DO NOT RE-DERIVE
S46-1. **The reg Pattern-A discriminator is STRUCTURALLY INTRACTABLE** — see the contradiction matrix above. ci8 and
  ci26 have byte-identical serialized trailing streams (proven via `-SS` dumps) yet differ; the discriminator lives in
  oracle state not present in the node tree. Do NOT spend a session re-trying structural rules; only oracle-instrument.
S46-2. **The cross-unit threading is REAL + dbg3-safe** (the oracle's `Token.currentPathname` static persists across
  `compileScript` calls). It is now the assembly foundation: `translateAnnotatedUnit` returns `{text, ctx}`,
  `assembleDebugProgram` threads `ctx`, reg/trailer = `G<idx>` markers resolved against the threaded `runningPathname`.
  An instance appends `setPathname(instanceTrailingFile(...))` to carry its trailing context. Keep dbg3 Pattern-B.
S46-3. **`<debug>` element presence does NOT force reg Pattern B** (ci30/$31/debugging-$4/input-devices all have `<debug>`
  and are Pattern A). Discard that hypothesis.

### HOW TO RESUME (S46 → S47)
The threading infra is DONE + proven-safe. **The single cleanest tractable next win = color-$3** (the anon-class-first
Pattern-B binder funcLine = classLine+2, not el.endLine — narrow, one file, see the REMAINING-12 entry). Plumb the
anon-class directive line to the `idBinderDebug` call (compile.ts ~L1171) and gate to the class-def-first-attr case;
verify the instance leading-directive Pattern-B binders (tooltipview@20) AND dbg3 stay byte-identical. AFTER that, the
isolated features (lzunit AS3 method, dynamiccss debug-window, lzunit-$5 downstream). The reg Pattern-A (4 files) and
super-tail (2 files) are the documented intractable/dbg3-risky remainder — leave for an oracle-instrumentation session
or accept as permanently-refused. Same loop: flip refusal (`src/compile.ts` ~L2039 `const debug = isDebugBuild ||
opts.debug === true; // GRIND FLIP` + comment the `if (isDebugBuild && !debug) { return … }` block), build,
`batch.mjs check` (expect 328/12/6), `batch.mjs show '<name.lzx>'` (QUOTE the `$`!), REVERT before handoff, verify
dbg3 RAW IDENTICAL after EVERY change.

### PATH TO DoD (corpus 266/0/80 → flip refusal off)
We are at **62/78 debug golds byte-perfect (+dbg3 = 63)**, flipped check 328/12/6. The 12 remaining diffs split into:
TRACTABLE (5–6: color-$3, lzunit-$2/$4/$5, dynamiccss) = isolated features a focused session can close; INTRACTABLE/RISKY
(6: reg Pattern-A ×4 + super-tail ×2) = need oracle-instrumentation or refuse-acceptance; FEATURE (1: backtrace) = large.
To flip the refusal OFF permanently: drive `batch.mjs check` to **0 diff** (close the tractable, then either crack or
oracle-instrument the reg/super remainder), then in `src/compile.ts` permanently remove the `debug` refusal (restore
`const debug = isDebugBuild || opts.debug === true` WITHOUT the refusal block), raise the harness `execFileSync`
maxBuffer (handoff notes 2 ENOBUFS), add `p_debug_*` fixtures, and the corpus goes 266/0/80 → 346/0/0. DONE.

## ⚑⚑⚑ SESSION 45: THE BINDER TWO-PASS — STEP A + STEP B BOTH LANDED → +13 debug golds (49→62), the binder cluster CRACKED ⚑⚑⚑
dbg3 STILL BYTE-FOR-BYTE (850579, RAW IDENTICAL — verified after EVERY change). Regression gate GREEN at
**266 ok / 0 diff / 80 unsup (refusal LIVE)**, fixtures 96/0/0, debug.mjs all passed, dbg3 exit 3 + RAW IDENTICAL.
**Flipped `batch.mjs check` advanced 315→328 ok / 25→12 diff / 6 unsup** — debug golds passing = 328−266 = **62**
(was 49), +dbg3 = 63 byte-perfect. **+13 debug golds CLOSED, ZERO regressions.** I built the Pattern-A binder
two-pass S43/S44 reserved as the biggest prize — and it ALSO resolved the Pattern-B binder line positionally, closing
the whole `$reportException` line for every binder in the cluster.

### CLOSED THIS SESSION (13): lzunit-$1, lzunit-$3, rpc-soap-$8, testdriven-1..10.
The other 8 binder-cluster files (lzunit-$2/$4/$5, rpc-soap-$5/$10, dynamiccss, class-inheritance-$8, color-$3) all
had their BINDER fully fixed and ADVANCED to a DIFFERENT, later divergence (see "REMAINING 12" below).

### THE MECHANISM — how the binder REALLY works (corrects S38/S42's "intractable" verdict; vindicates S43)
The oracle's id/name binder Function is built `sourceLocation=null` (NodeModel.buildIdBinderBody) → its serialized
`toString()` is DIRECTIVE-FREE. When the asMap is re-lexed by `Compiler.compile`, the binder inherits the running
`Token.currentPathname` (file) and `Token.currentLine` (the `$reportException` line N) — a PURE POSITIONAL count over
the serialized-source stream. Two outcomes, BOTH from the same mechanism:
- **Pattern B** (currentPathname = a real app file): the binder renders WITH `#file`/`#line` directives (file real,
  N = the positional source line, which usually but NOT always equals el.endLine — see color-$3 below).
- **Pattern A** (currentPathname reset to "" by a preceding literal-attr's trailing empty `#file `): the binder
  renders INLINE, NO directives, `$reportException("", N)` with N the positional cumulative line.
KEY DERIVATION (the "drift" S42 called underivable): the serialized source wraps each literal attr as
`<key>: #beginAttribute\n\n#file <app>\n#line <srcLine>\n<value>\n#file \n#endAttribute` (verified in the `-SS` dumps).
So at a literal attr's `#endAttribute` the lexer's currentLine = **srcLine + 2** (value line, `#file ` line,
`#endAttribute` line) and currentPathname = "". The binder sorts ALPHABETICALLY FIRST among an instance's real attrs
(`$lzc$bind_id` < `id`/`name`/`text`/…), so the literal attr that resets the context is in a PRIOR sibling instance,
and the binder's `function` token lands on that `#endAttribute` line → **N = (last literal attr's srcLine) + 2.**
(lzunit readout: progress sibling's `name`@#line 940 → readout binder @942. Verified across 13 golds with N from 3 to
446 — robust, not coincidental.)

### THE TWO-PASS — IMPLEMENTED (RULES S45 below). All in src/debug.ts + src/compile.ts.
The resolver IS the existing `translateAnnotatedUnit` assembly pass (it already tracks the generated-line counter +
line-state). I made it re-entrant and gave it two new running trackers:
1. **`runningPathname`** — the oracle's `Token.currentPathname`. Set to a real file by any real `#file` directive
   (`st.newLstate.hasfile`); reset to "" by an `R` marker (the literal-attr `#endAttribute`). This is INDEPENDENT of
   `curLstate` (the directive-DISPLAY state, which is polluted by the binder's own forceBlankLnum generated resets —
   the trap that broke my first attempt: a Pattern-B bind_id's trailing forceBlankLnum makes curLstate.filename="" but
   currentPathname is STILL real, so the following bind_name must stay Pattern B. `runningPathname` models this right.)
2. **`runningSrcLine`** — the oracle's cumulative source line. An `R` marker (carrying the literal attr's srcLine) sets
   it to `srcLine + 2`.
3. **`B<idx>` binder marker** (a side-table `BINDER_TABLE` of `{render, file, funcLine}`): at the marker the pass reads
   `runningPathname`/`runningSrcLine` and renders the binder via the registered `render(file, funcLine)`:
   - Pattern A (`runningPathname === ""`) → `render("", runningSrcLine)` → file=""/inline/`$reportException("", N)`.
   - Pattern B → `render(spec.file, spec.funcLine)` → the original real-file directives (UNCHANGED — dbg3-safe).
   The rendered binder's annotation stream is processed THROUGH THE SAME state (re-entrant `processAnnotations(stream,
   notify)`) so Pattern-B directive collapse / line tracking continue from the outer context (this is why dbg3's 2
   Pattern-B binders stay byte-identical).
`idBinderDebug` (compile.ts) now `registerBinder({render:(f,n)=>compileBinderDebug(userName,body,f,n), file, funcLine})`
and returns the `B<idx>` marker instead of the pre-composed binder text. `resetBinderTable()` runs at each compile start.

### RULES CRACKED IN SESSION 45 — DO NOT RE-DERIVE
S45-1. **Binder Pattern-A discriminator = the running `Token.currentPathname`, NOT `curLstate.filename`.** Track a
  SEPARATE `runningPathname` in translateAnnotatedUnit: set by real `#file` directives, reset to "" by the literal-attr
  `R` marker. A binder's own internal generated/forceBlankLnum markers do NOT change currentPathname (the binder is
  directive-free in the oracle's serialized form). dbg3's binders are Pattern B → MUST stay B (verified).
S45-2. **Pattern-A binder line N = (last literal attr's source line) + 2** (the `#beginAttribute…#file \n#endAttribute`
  serialized-source wrapper puts the `#endAttribute` — where the alphabetically-first binder of the NEXT instance lands
  — at srcLine+2). The literal attr's srcLine = its element's endLine. Emitted via the `R` marker `litReset(endLine)`.
S45-3. **`R` (OP_PATHRESET) markers are emitted after EVERY source-literal attr value** (`id`, `name`, `$immediately`,
  plain color, generic `compileAttr`) — COMPILE_DEBUG-gated, appended to the attr VALUE so they ride into the asMap at
  the value's serialize position. They are consumed (no output) by the pass. These are the SAME 5 sites flagged
  `hasLiteralAttr = true` for the S36 reg discriminator.
S45-4. **The binder is a `B<idx>` side-table marker resolved at assembly**, processed re-entrantly through the live
  translateAnnotatedUnit state so BOTH patterns render in-context. Reset the table per compile (`resetBinderTable`).

### THE REMAINING 12 DIFFS (S46 targets) — the binder is no longer ANY file's first divergence
- **REGISTRATION Pattern-A (4 files: class-inheritance-$8, rpc-soap-$5, rpc-soap-$10, datapointer-basics):** the
  tag-map regs (`lz["x"]=cls`) want Pattern A (no directive) but MINE emits `/* file#1 */`. ROOT: the S36 `regsGenerated`
  guard is structural + only fires when `lastTopWasInstance`; for ci8/rpc-soap the LAST top-level statement is a
  `Class.make` (`}, 24);` then the regs) whose trailing currentPathname is "" — `lastTopWasInstance=false` → Pattern B.
  **THIS IS NOW WITHIN REACH:** thread the new `runningPathname`/`runningSrcLine` ACROSS top-level statements in
  `assembleDebugProgram` (currently each `translateAnnotatedUnit` starts fresh). The reg block (a directive-less
  statement) would inherit the last statement's trailing currentPathname — exactly the oracle's cross-unit mechanism.
  The litReset markers ALREADY make the last Class.make/instance leave runningPathname="" when it ends on a literal
  attr. ⚠️ dbg3's regs are Pattern B (its last instance ends real) → threading must keep them B; VERIFY. This likely
  collapses all 4 + is the cleanest next win. (datapointer-basics is the S44-deferred registration case — same root.)
- **color-$3 (Pattern-B binder line off-by-one):** the FIRST binder is Pattern B but GOLD funcLine=38, MINE=39. It is
  an ANON-CLASS binder (`<view>` with an oninit handler → anon class): `#line 36` (the class dir) → `dynamic class`@36,
  `displayName`@37, `static var children=[{attrs:…bind_id: function`@38 → binder@38 = classLine+2. MINE uses el.endLine=39.
  For Pattern B in a CLASS-DEF children asMap, funcLine should be `classLine + 2`, not el.endLine. Narrow fix; verify the
  other Pattern-B binders (instance leading-directive ones, e.g. tooltipview@20=el.endLine) are unaffected — they're not
  class-def-first, so gate to the anon-class-first-attr case.
- **lzunit-$2/$4 (`assertEquals` method body @936832):** advanced past the binder to a `<method>`/script-class body
  divergence (`with (this) { try { /* file: lzunit-$2.lzx#13 */ assertEquals(1, (function(){…` — a nested anon function
  in a method arg). Separate feature (lzunit AS3 script-class method render). NOT binder-related.
- **lzunit-$5 (instance-level Pattern-A binder @938501):** `canvas.LzInstantiateView({children: [{attrs: {$lzc$bind_id:
  (function(){…` — a top-level INSTANCE (not in a Class.make) whose binder is Pattern A. My fix covers it structurally
  (it's the same B<idx> marker), so the remaining diff is likely a downstream byte, not the binder line — re-show it.
- **dynamiccss (@887597, `$lzc$class_LzDebugWindow` vs `$lzc$class_mh8`):** a `<debug>`-element class-naming / debug
  window instantiation divergence, NOT binder. Separate.
- **data-accessing-lzdataelement, datapointer-creating-node (super-tail nested in loop/if, dbg3-RISKY):** unchanged from
  S44 — DOCUMENT-and-SKIP (super Rule-A nested-depth directive). **backtrace:** unchanged feature (SKIP).

### Verification this session (reproducible)
Flip src/compile.ts (`const debug = isDebugBuild || opts.debug === true; // GRIND FLIP` + comment the refusal block),
build, `batch.mjs check` → 328/12/6. `-SS` dumps: `cd /tmp; cp <f>.lzx t.lzx; bash modern-build/oracle/lzc.sh -SS
--runtime=dhtml /tmp/t.lzx` (NOTE: no `timeout` cmd on this box) → the binder serialized src is `t-src-<N>.txt`
(`grep -l bind_id`); the `#beginAttribute…#line <srcLine>…#endAttribute` structure is directly visible. dbg3 verified
RAW IDENTICAL after the marker, the runningPathname tracker, AND the srcLine resolver. Tree restored: refusal LIVE,
build clean, check 266/0/80, fixtures 96/0/0, debug.mjs all passed, dbg3 exit 3 + RAW IDENTICAL.

### HOW TO RESUME (S45 → S46)
The binder cluster is CRACKED. **The single cleanest next win = the REGISTRATION Pattern-A (4 files)** — thread the new
`runningPathname`/`runningSrcLine` across top-level statements in `assembleDebugProgram` (src/debug.ts), so a
directive-less reg/trailer statement inherits the previous statement's trailing currentPathname. The litReset
infrastructure already leaves runningPathname="" after a literal-attr-ending statement. Replace the structural
`regsGenerated` (compile.ts ~L3143) with the threaded state, OR feed the threaded `runningPathname` into the reg
emission. ⚠️ dbg3 regs = Pattern B → verify RAW IDENTICAL. Then color-$3's anon-class-first Pattern-B funcLine
(classLine+2), then the isolated lzunit AS3 method / dynamiccss debug-window features. Same loop: flip refusal, build,
`batch.mjs check` (expect 328/12/6), `batch.mjs show <name>`, REVERT before handoff, verify dbg3 after EVERY change.

## ⚑⚑⚑ SESSION 44: dynamiccss `style=` attr → `LzStyleConstraintExpr` feature (1 fix) + remaining-25 inventory TRIAGED ⚑⚑⚑
dbg3 STILL BYTE-FOR-BYTE (850579, RAW IDENTICAL — verified after EVERY change). Regression gate GREEN at
**266 ok / 0 diff / 80 unsup (refusal LIVE)**, fixtures 96/0/0, debug.mjs all passed, dbg3 exit 3, backtrace exit 3.
**Flipped `batch.mjs check` HELD at 315 ok / 25 diff / 6 unsup** — debug golds passing = 315−266 = **49** (unchanged
from S43; dynamiccss's style feature is now CORRECT but dynamiccss advanced into the binder cluster so it stays in
the 25). **NO regressions** (the 49 closed golds + the 25 diffs are exactly as S43 left them, minus dynamiccss's
feature-gap which is now the binder).

### THE FIX (RULE S44-1) — `style=` attr on a class-def child `<attribute>` → `new LzStyleConstraintExpr(…)`
`src/compile.ts`: the class-def child `<attribute>` loop (~L2721) had NO handling for a `style="prop"` attribute (only
`$style{}`-VALUE constraints + `when=`/`value=` constraints). A `<attribute name="bgcolor" style="background-color"/>`
(dynamiccss's `colorbutton` class) was DROPPED entirely from the class defaultAttrs. ROOT: `NodeModel.java:1954` — a
`style=` attr rewrites `value = "$style{" + quote(style) + "}"`, and a constant style folds to the compact
`new LzStyleConstraintExpr(name, type, prop[, fallback, false])` init (NodeModel.java:438-449) in mergeAttributes with
NO void-0 slot. THREE sub-parts:
  1. New `if (c.attrs["style"] != null)` branch BEFORE the `con` branch: `instEntries.push(...slot, ...setterEntry)`
     (slot=[] since bgcolor is inherited) then `defaultAttrs[an] = styleConstraintExpr(an, declared, jsString(style), fb)`.
     `declared` = `aliasType(c.attrs["type"])` if a `type=` is present, else `resolveConstraintType(def.name, an)` (for
     bgcolor → "color", an inherited view attr; for swatchopacity → "expression", a new attr).
  2. `styleConstraintExpr` (~L583) now takes an optional `fallback`: a `value=` ALONGSIDE `style=` is the FALLBACK
     expression (NodeModel.java:1959/1987 setFallbackExpression) → emit `, <fallback>, false` (the warn-suppress flag).
     The fallback is the original value compiled as the attr's declared type (`compileTypedValue(...)`).
     (dynamiccss `<attribute name="swatchopacity" style="opacity" value="1"/>` → `("swatchopacity","expression","opacity",1,false)`.)
  3. `styleConstraintExpr` now spaces its arg separators in a debug build (`COMPILE_DEBUG ? ", " : ","`): the
     pre-compiled value renders uncompressed (`new LzStyleConstraintExpr("bgcolor", "color", "background-color")`).
PRODUCTION-affecting (the `style=` branch + `styleConstraintExpr` are shared compress paths) — VERIFIED prod 266/0/80 +
fixtures 96/0 UNCHANGED (no production gold uses a class-def `style=` attr → the new branch never fires in prod; the
`, `↔`,` separator is COMPILE_DEBUG-gated so prod keeps `,`). dbg3 RAW IDENTICAL (dbg3 has ZERO `LzStyleConstraintExpr`).
dynamiccss advanced 857626 → 868781 (style feature fully correct; now blocks on the binder cluster).

### THE REMAINING 25 DIFFS — TRIAGED (for S45 planning)
- **BINDER CLUSTER (21 files, dbg3-safe TS two-pass = the S45 prize):** class-inheritance-$8, color-$3, lzunit-$1…$5,
  rpc-soap-$5/$8/$10, testdriven-1…10, **+dynamiccss** (now), **+datapointer-basics-secondary**. ALL share the
  Pattern-A `$lzc$bind_id` binder as their FIRST (or sole-remaining) divergence. See S43 §(d)/(f): the ONLY route is a
  TS two-pass binder-line resolver (compose Pattern-A binders with a `$reportException("",N)` line PLACEHOLDER + file=""
  discriminator, then resolve N by counting serialized newlines from the last `#line` over the assembled asMap).
  ~80–150 LOC, MEDIUM risk, dbg3's 2 binders are BOTH Pattern B → gate strictly to Pattern A.
- **datapointer-basics (registration Pattern A/B — cross-unit currentPathname, dbg3-RISKY, DOCUMENT-and-SKIP this
  session):** its 25 super-tails ALL MATCH (25/25); its SOLE diff is the trailer/registration block emitting Pattern-B
  `/* file: app#k */` directives where the gold wants Pattern A (inline, no directives). ROOT: the S36 conservative
  guard at compile.ts:3143 (`regsGenerated`) keeps any instance with folded-`<text>`-content as Pattern B
  (`subtreeHasScriptOrContent=true`), but here a LATER literal-attr sibling re-resets `#file`→"" so the LAST `#file`
  before the regs is empty → Pattern A. The correct discriminator is "the LAST serialized leaf's trailing `#file`
  state", which requires threading the running currentPathname through the whole subtree's serialization order — the
  SAME cross-unit machinery as the binder cluster, explicitly reserved for S45 ("dbg3 MUST stay Pattern B"). If S45
  builds the binder two-pass currentPathname model, this likely falls out of it. **DOCUMENT-and-SKIP for now.**
- **data-accessing-lzdataelement, datapointer-creating-node (super-tail directive, dbg3-RISKY, DOCUMENT-and-SKIP):**
  a `super.X(item[i])` call NESTED inside a `for`/`if` block (joinDepth > 1) is MISSING its `/* -*- file: #N -*- */`
  same-file directive. I get 31/39 super-tails right (data-accessing); the ~8 missing are exactly the supers nested in
  loop/if bodies. ROOT (characterized this session): the super-call's `substitute()` reparse re-establishes a source
  directive at the super's (Rule-A-shifted) line, but my Rule A super machinery (`ruleActive = joinDepth === 1`,
  sc.ts:1793/1856) only fires at the function-body StatementList depth, so a nested super gets no shift AND no
  re-established directive. dbg3 has ZERO super-calls directly inside a for-loop (verified) → bounded dbg3 risk, BUT
  the fix touches the super Rule-A/`dbgLineDelta` family + the substitute reparse line-reset at all nesting depths —
  the same line-state machinery dbg3 depends on. NOT a clean isolated patch. **DOCUMENT-and-SKIP** (verify dbg3 if S45
  attempts it: extend ruleActive's empty-file re-establishment to nested supers, gate so dbg3's 200 supers are byte-unchanged).
- **backtrace (large feature, NOT isolated, SKIP):** `compileroptions="debug:true;backtrace:true"` instruments EVERY
  function with backtrace-stack push/pop (`var $2 = $1.backtraceStack; try {…}` — JavascriptGenerator:1277, the
  try/catch+$reportException wrapper ALWAYS added). The gold has **1030** `backtraceStack` instrumentations across the
  whole ~1MB output — this is a pervasive code-generation MODE, not a small patch. Single corpus example. Production
  refuses it (compileroptions debug → exit 3). LOW priority.

### Verification this session (reproducible)
Flip: `src/compile.ts` `const debug = isDebugBuild || opts.debug === true; // GRIND FLIP` + comment the refusal block.
`batch.mjs check` reproduced 315/25/6. dynamiccss byte advanced 857626→868781 via the style fix. Diagnostics: a
one-off `LZC_TRACE_SUPER` trace in sc.ts (since reverted, sc.ts byte-clean vs `/tmp/sc.ts.bak`) confirmed nested supers
have `ruleActive=false`. dbg3 super-tail/super-in-for-loop counts via node greps over `oracle/out/dbg3.dhtml.js`.
Tree restored: refusal LIVE, build clean, check 266/0/80, fixtures 96/0/0, debug.mjs 5/5, dbg3 RAW IDENTICAL, exit 3.

### HOW TO RESUME (S44 → S45)
The 25 diffs are now CLEAN-TRIAGED: **21 binder-cluster, 1 registration (cross-unit), 2 super-tail (nested), 1 backtrace.**
The single biggest prize is the **binder two-pass** (S43 §(f) GO-WITH-CAVEATS) — unlocks ~21 golds (the whole cluster +
dynamiccss). RECOMMENDED S45: dedicate the session to building the Pattern-A binder line resolver (see S43 §(d) for the
exact mechanism + inputs already present in the TS asMap). Start by emitting the file="" discriminator (S35
currentPathname-reset rule), confirm the diff narrows to ONLY the `$reportException("", N)` line, then add the
placeholder + serialized-newline counter. Gate to Pattern A; re-verify dbg3 RAW IDENTICAL + the 49 (now still 49)
closed golds after EVERY step. The registration Pattern-A (datapointer-basics) likely falls out of the same
currentPathname model — re-check it once the binder model exists.

## ⚑⚑⚑ SESSION 43 — DIAGNOSIS: cumulative currentLine drift / binder cluster oracle-patch feasibility ⚑⚑⚑
**No code/oracle/gold changed. Tree left exactly GREEN** (refusal LIVE `opts.debug === true && isDebugBuild`,
check 266/0/80, fixtures 96/0/0, dbg3 RAW IDENTICAL; oracle/patch + golds UNTOUCHED — only a flip/revert for
inspection + scratch `-SS` dumps in /tmp since deleted). This is a GO/NO-GO writeup for the 18-file binder cluster
(lzunit-$1…$5, testdriven-1…10, rpc-soap-$5/$8/$10, color-$3, class-inheritance-$8).

### (a) ROOT CAUSE — precise, in the oracle source
The Pattern-A binder `$reportException("", N)` line N = **`JavascriptGenerator.java:1088` `lineno = "" + node.beginLine`**
(emitted at JavascriptGenerator.java:1301 into the try/catch wrapper of the binder Function). `node` is the binder's
function-expression AST node; `node.beginLine` is set by **`Parser.jjt:40 jjtreeOpenNodeScope` = `getToken(1).beginLine`** —
the SAME mechanism S39 pinned for the `(`-token, but here applied to the binder's `function` token. The binder is a
`Function` built by `NodeModel.buildIdBinderBody` (NodeModel.java:787) wrapped via `new Function(args, body)` →
6-arg ctor with **`sourceLocation=null`** (Function.java:46/72): its `toString()` emits NO `#file`/`#line`
directives — just `function (…) {\n<body>\n}`. So when the whole instance asMap (serialized by
`ScriptCompiler.writeObject`→`writeMap`, ScriptCompiler.java:286/306, which `writer.write(Function.toString())`)
is re-lexed/re-parsed by `Compiler.compile`, the binder's `function` token sits at the lexer's **cumulative
`currentLine`** = (value of the last `#line` directive seen) + (physical newlines emitted in the serialized asMap
between that `#line` and the binder). N is therefore a pure POSITIONAL count over the serialized-source stream, NOT
the element's true source line.
PROOF (stock-oracle compile, `-SS` src/lineann dumps, reproduced this session):
  - **class-inheritance-$8**: `foo`@top → src asMap `#file ci8.lzx / #line 17` immediately precedes the foo binder
    → foo binder `node.beginLine = 17`, file=ci8.lzx → GOLD `$reportException("/tmp/ci8.lzx", 17)` (Pattern B,
    file real, line = true source 17). `bar`@child → the intervening `id:"foo"` `#beginAttribute…#file /tmp/ci8.lzx
    #line 17 "foo" #file <EMPTY> #endAttribute` block ends with the EMPTY `#file ` (resets currentPathname="") and
    occupies 2 serialized newlines after `#line 17` → bar binder `function` token lands at currentLine **19**,
    file="" → GOLD `$reportException("", 19)` (Pattern A). bar's TRUE source line is 18 → "drift +1" = (17 + 2
    serialized lines) − 18. Verified in the lineann: foo binder annotated `40#17` throughout, bar binder `0#0`
    (file reset) with the `19` a baked literal.
  - **lzunit-$1 `readout`**: in `$lzc$class_mhh`'s children asMap, the last `#line` before the readout binder is
    `#line 940`; the trailing `#file ` reset + the binder land it at currentLine **942**, file="" → GOLD
    `$reportException("", 942)`. readout's TRUE source line is 946 → "drift −4" = (940 + 2 serialized lines) − 946:
    the preceding sibling attrs collapsed their multi-line source spans into single serialized lines, so the
    serialized stream is SHORTER than the source span. **The drift is NOT depth-dependent per se — it is
    "intervening-serialized-text dependent": +1 when the serialized stream runs longer than source, −4 when shorter.**

### (b) RECONCILE vs S39's `(`-token finding — SAME mechanism, NOT a separate phenomenon
S42 framed the binder line as a distinct "cumulative" phenomenon from S39's `(`-token N−1. **That is wrong: it is the
EXACT same `jjtreeOpenNodeScope` = `getToken(1).beginLine` lexer-position attribution.** S39's `(` got N−1 because the
`(` followed an EOL special-token at a SPECIFIC offset; the binder gets its positional N for the SAME reason — the
token's `beginLine` is wherever the re-lex counter sits. The binder differs from S39's case only in that (i) it is a
`function`-keyword token not a `(`, and (ii) its asMap position is reached after a chain of `#beginAttribute`/`#line`/
empty-`#file ` resets, which both shift the count AND flip file→"". So S39's verdict generalizes: **deterministic
positional line attribution, NOT a bug.** S42's "intractable / not derivable from el.line/endLine" was right that it's
not a constant offset, but WRONG that it's underivable — it is exactly derivable from the serialized-asMap line layout
(see (d)), which the TS compiler already produces.

### (c) BUG or deterministic? — DETERMINISTIC, NOT a bug; the buffer-fix patch has ZERO effect (proven)
**Patch-on/off test (this session):** compiled class-inheritance-$8 with the STOCK oracle (no patch prefix) vs the
buffer-fixed `oracle/lzc.sh`; filename-normalized the two outputs → **byte-identical except the `appbuilddate`
timestamp** (compiled 14s apart). Every `$reportException("", N)` line is identical with/without the patch; `bar`=19,
`readout`=942 unchanged. The instance asMap units are ~1.9 KB each — far under the 4096-char buffer boundary, and each
asMap is `compileToByteArray`'d separately — so the S28–30 `SimpleCharStream.adjustBeginLineColumn` buffer-boundary
defect REGIME is never entered. This is NOT the S28–30 bug, NOT a residual of it. It is the oracle's normal,
intended line attribution: the binder Function legitimately carries no source location, so the lexer honestly counts
its serialized position. **There is no isolatable DEFECT to fix.**

### (d) PATCH FEASIBILITY
**Oracle-patch route = INFEASIBLE as a "bug fix" (NO-GO).** There is no defect. To change N you'd have to give the
binder Function a `sourceLocation` (a `#file/#line` directive) in `NodeModel.buildIdBinderBody`/`Function.toString` —
but that changes intended output (file→real, line→source) for EVERY binder including dbg3's 2 Pattern-B binders, and
would force a full-corpus re-baseline that ships divergent-from-stock product output. Violates the "only fix a real
defect" discipline. Same conclusion as S39's `(`-token. **NOT an oracle-patch candidate.**
**TS-fix route = FEASIBLE but a SUBSTANTIAL (medium-large, ~core) change, NOT a small isolatable patch.** The line IS
deterministically derivable in TS: `N = (last #line directive value before the binder) + (serialized newlines from
that #line to the binder's function token)`. The TS compiler ALREADY (i) emits the same `#beginAttribute`/`#file`/
`#line`/`#endAttribute` directives in the asMap (`srcDirective`/`attrSrc`, compile.ts:465–468) and (ii) has the
line-counter machinery (`debug.ts` TranslationUnit.linenum + countLines, the `LineNumberState` linediff tracking).
The blocker is ARCHITECTURAL: the binder's `$reportException` line is BAKED at COMPOSITION time inside
`compileBinderDebug` (sc.ts:2714, `lex(src, funcLine, file)` with `funcLine = el.endLine`, compile.ts:1166) — long
BEFORE the layer-2 assembly counter (`assembleDebugProgram`/`translateAnnotatedUnit`) ever runs, and the layer-2
counter only tracks the TOP-LEVEL unit's generated line, NOT a position threaded through the nested asMap. To fix it
TS must: (1) compose Pattern-A binders with a PLACEHOLDER for the `$reportException` line + a Pattern-A discriminator
(file→"", suppress directives — the S35/S42 `currentPathname` reset rule, already characterized); (2) run a
line-counter pass over the fully-composed instance asMap (reusing countLines + the `#line`-reset semantics) to resolve
each placeholder to its positional line. **EXPERIMENT I did NOT fully land** (would have required the two-pass plumbing
and is beyond a diagnosis worker's scope), but I PROVED the inputs are all present: the TS asMap carries the identical
directive structure and the same serialized text, so the same counter that gives the oracle its `beginLine` will give
the identical N. Estimated surface: thread a running (file,line) through `buildNode`/the asMap text assembly + a binder
line-placeholder resolution — plausibly 80–150 LOC touching compile.ts asMap composition + debug.ts assembly, MEDIUM
risk (the placeholder pass must not perturb dbg3's Pattern-B binders or the gensym stream).

### (e) SCOPE if the TS two-pass were built
- **Golds that collapse: the 18 binder-cluster files** (lzunit-$1…$5, testdriven-1…10, rpc-soap-$5/$8/$10, color-$3,
  class-inheritance-$8) — ALL share this Pattern-A binder root as their FIRST divergence. Likely also feeds
  color-$6-adjacent / class-inheritance-$8 secondary diffs. The biggest single remaining cluster (18 of the 25 open).
- **Re-baseline / deletability:** this is INDEPENDENT of S39's super-Rule-A/B `dbgLineDelta` family — it does NOT let
  that quirk code be deleted (different mechanism). It is purely ADDITIVE TS line-modeling, not a re-baseline. No
  oracle/gold regeneration needed (the stock golds already encode the positional N; un-patched regen ≡ jar holds).
- **Revalidation cost:** dbg3 RAW IDENTICAL re-verify (dbg3's 2 binders are BOTH Pattern B — confirmed this session via
  a dump of dbg3.dhtml.js: 0 Pattern-A, 2 Pattern-B — so a correctly-gated Pattern-A placeholder must leave them
  byte-unchanged) + the 49 currently-closed golds re-checked (none should regress; the change is gated to Pattern-A
  binders). LOWER dbg3 risk than S42 feared (S42 said "dbg3's binders are Pattern B" implying risk; in fact that
  means the fix must simply NOT fire on Pattern B — a clean gate).

### (f) RECOMMENDATION — **NO-GO (oracle patch); GO-WITH-CAVEATS (TS two-pass), but it is the HARDEST remaining item**
Do **NOT** patch the oracle — there is no defect (proven: buffer-fix has zero effect; the line is intended positional
attribution; same as S39). The cluster is unlockable ONLY via a TS two-pass binder-line resolver: compose Pattern-A
binders with a line PLACEHOLDER + a file="" discriminator, then resolve the placeholder by counting serialized
newlines from the last `#line` over the fully-assembled asMap. It is the single biggest prize (18 golds) but a
MEDIUM-LARGE core change (~80–150 LOC across compile.ts asMap composition + debug.ts assembly) with dbg3-gating risk —
the hardest remaining work, NOT a quick win. **Recommended next step (in value/effort order):** (1) tackle the cheaper
isolated feature gaps FIRST (dynamiccss `LzStyleConstraintExpr`, backtrace `<method>` body) per S42's resume list;
(2) THEN, as a dedicated multi-step session, build the Pattern-A binder two-pass: start by emitting the FILE
discriminator (file→"" + suppress directives, reusing the S35 currentPathname-reset rule), confirm the diff narrows to
ONLY the `$reportException("", N)` line, then add the placeholder + line-counter resolution. Gate strictly to
Pattern-A binders; verify dbg3 RAW IDENTICAL after every step.

### Verification this session (reproducible)
`-SS` dumps via `cd /tmp; cp <f>.lzx t.lzx; bash modern-build/oracle/lzc.sh -SS --runtime=dhtml /tmp/t.lzx`; the
instance asMap src is `t-src-<N>.txt` (`grep -l bind_id`), its lineann `t-lineann-<M>.txt` (`grep -l 'bind #'`).
Stock-vs-patched proof via a no-patch lzc copy; filename-normalized cmp = identical mod `appbuilddate`. Flipped check
(refusal off) reproduced 315/25/6 (the binder cluster's class-inheritance-$8 @853562: GOLD `(function () {\nvar
$lzsc$temp` vs MINE `(function () {\n/* -*- file: class-inheritance-$8.lzx#18 -*- */\nvar`). Tree restored: refusal
LIVE, build clean, check 266/0/80, fixtures 96/0/0, dbg3 RAW IDENTICAL.

## ⚑⚑⚑ SESSION 42: two isolated class-def fixes (+2 debug golds) + the BINDER cluster CONFIRMED-INTRACTABLE (cumulative line drift) ⚑⚑⚑
dbg3 STILL BYTE-FOR-BYTE (850579, RAW IDENTICAL — verified after EVERY change). Regression gate GREEN at
**266 ok / 0 diff / 80 unsup (refusal LIVE)**, fixtures 96/0/0, debug.mjs all passed, dbg3 exit 3 + RAW IDENTICAL.
**Flipped `batch.mjs check` advanced 313→315 ok / 27→25 diff / 6 unsup** — debug golds passing = 315−266 = **49**
(was 47), +dbg3 = 50 byte-perfect. **+2 debug golds CLOSED (`class-inheritance-$19`, `color-$6`), ZERO
regressions** (the 25 remaining diffs are a strict subset of the prior 27).

I took the PRIMARY target (the cross-unit binder cluster). After deep characterization I CONFIRMED it is the
documented-intractable cumulative line drift (NOT a clean cross-unit rule) — DOCUMENTED-and-SKIPPED per the hard
discipline (dbg3 risk + no derivable formula) — then landed the two cleanest SECONDARY targets to make real
progress.

### THE 2 FIXES (RULES S42 below)
1. **Class-def named-child slot dropped when the name is an INHERITED attribute (S42-1)** — `src/compile.ts`
   ~L2774 (the class-def view-child loop): `instEntries.push(voidSlot(name))` is now gated on
   `!isInherited(def.superTag, name)`. ROOT: `ClassModel.emitClassDeclaration` (ClassModel.java:795,840) computes
   `redeclared = superModel.getAttribute(key) != null` and a null-valued attr (a named-child reference slot,
   `addProperty(childName, null)` NodeModel.java:1262) is `decls.put` ONLY when `!redeclared`. So a child whose
   `name` collides with an inherited instance attribute declares NO `"name", void 0` slot. CLOSED
   class-inheritance-$19 (class `three extends two` has children `t`+`y`; `y` is LzView's y-coordinate attr →
   redeclared → dropped; `t` is custom → kept → `["t", void 0, …]`, was `["t", void 0, "y", void 0, …]`). This is
   the SAME `isInherited(superTag, an) ? [] : [voidSlot(an)]` rule already used for `<attribute>` redeclaration
   (L2700) and instance children (L1297) — now extended to class-def named view children. PRODUCTION-affecting
   (shared compress path) — VERIFIED prod 266/0/80 + fixtures 96/0 unchanged (the prod golds already drop the slot).
2. **Class-tag CONSTRAINT attribute marks the class member-rich → plain ctor (S42-2)** — `src/compile.ts` ~L2656
   (the class-def class-TAG-attr loop, `else if (con)` branch): after emitting the constraint's binder/deps
   methods, now `noteMember(child, false); lastMemberConBody = c.lastBody; lastMemberConSrcLine = c.lastSrcLine`
   (COMPILE_DEBUG-gated, mirroring the `<attribute value="${…}">` path at L2725-2726). ROOT: a class-tag
   constraint attr (`<class name="box1" bgcolor="${global['gold4']}"/>`) generates code members ($reportException
   bodies), so the class IS member-rich → the synthetic ctor takes the plain (`debugConstructorPlain`, file="", NO
   directives) form, with `ctorLine` tracked off the deps body's final source line (the existing
   `memberRich && lastMemberConBody !== undefined` branch L2903: `finalSourceLine(...) + 1 + trailingVoidSlots`).
   Previously box1 had `lastMemberClose < 0` + no view children → `memberRich=false` → `debugConstructor` with a
   spurious `/* color-$6.lzx#9 */`. CLOSED color-$6 (box1 ctor `$reportException("", 15)` byte-exact; the deps
   finalLine 14 + 1 = 15 came out correct from the existing constraint-body math, no new ctorLine logic needed).
   COMPILE_DEBUG-gated so PRODUCTION is untouched — verified prod 266/0/80 + fixtures 96/0.

### ⚑ THE BINDER CLUSTER (18 files: lzunit-$1…$5, testdriven-1…10, rpc-soap-$5/$8/$10, color-$3,
###   class-inheritance-$8) — CONFIRMED INTRACTABLE (cumulative line drift), DOCUMENT-and-SKIP
FULLY re-characterized the `$lzc$bind_id` binder divergence and reached a DEFINITIVE verdict beyond S38's:
- **MECHANISM (the FILE half — tractable):** a named instance's binder Function (NodeModel.buildIdBinderBody) has
  NO `#file` directive, so it inherits the running `Token.currentPathname`/`currentLine` at its serialization
  position. The binder's property `$lzc$bind_id` serializes ALPHABETICALLY-FIRST in the instance's asMap, BEFORE
  the `id: "foo"` literal (which is `#beginAttribute … #file ` = the endSourceLocationDirective reset to ""). So:
  - the FIRST/top-level instance's binder is **Pattern B** (currentPathname = app file → full `/* file#N */`
    directives + `$reportException("F", N)`) — its binder is the first directive-bearing token in the top-level
    statement, file = real.
  - a NESTED/subsequent instance's binder is **Pattern A** (currentPathname="" → INLINE, NO directives,
    `$reportException("", N)`) — a PRECEDING serialized literal-attr (`id: "foo"`, `text: "…"`, …) already reset
    currentPathname="" and nothing restored it before this binder. (Verified on class-inheritance-$8: `foo`@top is
    Pattern B `$reportException("class-inheritance-$8.lzx", 17)`; `bar`@child is Pattern A `$reportException("",
    19)`. lzunit `readout` is Pattern A `$reportException("", 942)`.) Handler bodies do NOT restore the file — they
    live in the button/instance's ANON CLASS (a separate top-level Class.make), not inline in the instance asMap.
- **THE LINE half — INTRACTABLE (the genuine blocker):** the Pattern-A binder's `$reportException("", N)` line N is
  the oracle's cumulative `Token.currentLine` at the binder's serialization position, which DRIFTS from the
  element's true source line by an amount that depends on the ENTIRE preceding serialized stream. PROOF:
  `readout` is `<text id="readout">` at lzunit.lzx **line 946** (true source), yet GOLD = **942** (drift −4, deep
  in a 1000-line library); `bar` is at line 18, GOLD = **19** (drift +1, shallow app). DIFFERENT drift per depth →
  NOT a constant offset, NOT derivable from el.line/endLine. This is the SAME cumulative SimpleCharStream
  line-position drift S37 documented as intractable for the RPC `(`-token — it needs a BYTE-EXACT model of the
  oracle's serialized-source line counter through the whole nested attr/children stream (per-subtree
  currentPathname+currentLine threading). MINE bakes `el.endLine` into `idBinderDebug` (compile.ts L1166) so it
  emits the leading directive + `$reportException("F", el.endLine)`.
- **VERDICT: DOCUMENT-and-SKIP.** Even a perfect Pattern-A FILE discriminator (suppress directives + file→"") does
  NOT close any file — the diff just moves from the leading directive to `$reportException("", N)` (wrong N). The
  binder is byte-identical to a Pattern-B binder EXCEPT (directives suppressed, file→"", line→drifted-running), so
  there is no partial win. HIGH dbg3 risk (dbg3's binders are Pattern B). To land it a future worker must thread a
  running (file,line) currentPathname through `translateAnnotatedUnit`/the asMap emission and resolve a binder
  LINE PLACEHOLDER — a substantial core change, only worth it if the cumulative line counter can be modeled
  byte-exactly (the same open problem as the RPC `(`-drift; if that's ever cracked via an oracle-patch or a
  SimpleCharStream port, BOTH collapse together).

### REMAINING DIFFS (post-S42, 25)
- **BINDER CLUSTER (18): lzunit-$1…$5 + testdriven-1…10 + rpc-soap-$5/$8/$10 + color-$3 + class-inheritance-$8** —
  the cumulative-line-drift binder (above). INTRACTABLE without a byte-exact line-counter model. The biggest
  nominal prize but documented-blocked.
- **datapointer-basics (1) @857943** — the S36 reg Pattern-A discriminator: the last instance is a `<window>` with
  a `<text>Outputs…</text>` TEXT-CONTENT child → mine's `subtreeHasScriptOrContent` flags it Pattern B, but GOLD
  is Pattern A (regs inline). The text-content case is the S35-documented DELICATE sub-case (relaxing
  subtreeHasScriptOrContent for text-content risks regressing S36's 8 closes + dbg3 = Pattern B). DOCUMENT-and-
  SKIP (<2 examples + dbg3 risk).
- **data-accessing-lzdataelement (1) @231551 / datapointer-creating-node (1) @170785** — a `/* file: #N */`
  line-only directive MISSING before a NESTED super-dispatch (`(arguments.callee["$superclass"] …)` inside a `for`
  loop / after a block). The super-tail line-state, S34 UNCRACKED, joinDepth≠1 (nested) so the Rule A/B machinery
  doesn't fire. High dbg3 risk.
- **dynamiccss (1) @857626** — missing `LzStyleConstraintExpr` style-constraint binding (feature gap).
- **backtrace (1) @20810** — the `<method>` body is ENTIRELY DIFFERENT (GOLD `with(this){var $1=Debug;var
  $2=$1.backtraceStack;…try{…}}` vs MINE `with(this){try{setActive(…)}…}`) — a `$backtrace`/local-var-capture
  debug feature, not line-state. Substantial feature gap.

### HOW TO RESUME (S42 → S43): same loop — flip refusal (`src/compile.ts` ~L2024: `const debug = isDebugBuild ||
opts.debug === true; // GRIND FLIP` + comment the `if (isDebugBuild && !debug){…}` return), build, `node
harness/batch.mjs check` (expect **315 ok / 25 diff / 6 unsup**), `node harness/batch.mjs show '<name>'` (QUOTE the
`$N`). REVERT before handoff. S43 candidates, in rough value order:
  - **dynamiccss `LzStyleConstraintExpr` (1)** — a CSS style-constraint binding feature gap (no line-state, no dbg3
    risk) — likely the cleanest tractable next win. Find where the style-constraint init is emitted and add the
    `new LzStyleConstraintExpr(name, cssprop, htmlprop)` form.
  - **backtrace `<method>` body (1)** — the `$backtrace`/var-capture debug feature (substantial but isolated).
  - **BINDER cluster (18)** — only if a byte-exact cumulative-line-counter model is built (the hard prize; shares
    its root with the RPC `(`-drift — consider tackling both together, or via an oracle SimpleCharStream port).
  - **datapointer-basics text-content reg discriminator (1)** / **super-tail line directive (2)** — delicate,
    dbg3-risky, <2 examples each.

## ⚑⚑⚑ SESSION 41: RPC `{ }` block-scope + AS3-script-class with(this) + post-make init — RPC CLUSTER CLOSED (+11 debug golds) ⚑⚑⚑
dbg3 STILL BYTE-FOR-BYTE (850579, RAW IDENTICAL — verified after EVERY change). Regression gate GREEN at
**266 ok / 0 diff / 80 unsup (refusal LIVE)**, fixtures 96/0/0, debug.mjs all passed, dbg3 exit 3 + RAW IDENTICAL.
**Flipped `batch.mjs check` advanced 302→313 ok / 38→27 diff / 6 unsup** — debug golds passing = 313−266 = **47**
(was 36), +dbg3 = 48 byte-perfect. **+11 debug golds CLOSED, ZERO regressions** (the 27 remaining diffs are a
strict subset of the prior 38; every divergence ADVANCED). **THE ENTIRE RPC CLUSTER S40 flagged is CLOSED**:
rpc-$11/$14/$16/$17/$19/$20/$21 + rpc-soap-$2/$3/$13 + rpc-xmlrpc-$2 (the `{ }` block was the FIRST of three
chained AS3-script-class gaps; fixing all three closed them byte-for-byte). 3 rpc-soap files (rpc-soap-$5/$8/$10)
remain — they hit the SEPARATE cross-unit `$lzc$bind_id` binder line-state (the lzunit-cluster root), NOT the
block family.

### ROOT (the S40 "RPC NEXT BLOCKER" fully diagnosed): AS3 *script-class* (`<script when="immediate">` body
`class LzRPC extends … { … }`) post-`Class.make` initializer + block, in `printAs3ClassDebug` (`src/sc.ts`).
The rpc/soap libraries are `.js` files that are actually `<library>`s whose `<script when="immediate">` CDATA
holds AS3 `class` declarations. These compile via `compileProgramDebug`→`printAs3ClassDebug` (NOT the LZX
`<class>`/`emitClassBlock` path). The oracle (`CommonGenerator.visitClassDefinition:510-522`) wraps such a class
in `{ Class.make(…);(function($lzsc$c){with($lzsc$c)with($lzsc$c.prototype){_6}})(Name) }` — a block scope —
**iff the class has class-level body statements `_6` (stmts.isEmpty() false)**. The compress `printAs3Class`
already emitted this `{make;iife}`; the DEBUG path did NOT (it returned `make+"\n"+init` with no block, and
mis-rendered the init). The discriminator for WHICH classes get the block = **a stray `;` (empty statement) at
class level** (e.g. the `;` after `static function DoubleWrapper(){};` in LzRPC) — `translateClassDirectives
Block`'s generic `else`→`stmts.add` puts it in `_6`, so the init+block appear even though `_6` prints empty.

### THE 4 FIXES (RULES S41 below)
1. **AS3 script-class `{ }` block + post-make init in debug (S41-1)** — `src/sc.ts` `printAs3ClassDebug`
   (~L1726): when `stmts.length > 0`, return `"{\n" + lnum(cl−1, make) + ";\n" + init + "\n}"` (was the broken
   `make+"\n"+init`). The make's leading directive (classLine−1) sits INSIDE the `{`. `compileProgramDebug`
   (~L2360) now checks `text.startsWith("{")` and does NOT prepend another directive. The trailing `}` is the
   unit's last char (unit-join appends `;`).
2. **Stray class-level `;` → empty `stmt` member (S41-2)** — `src/sc.ts` `classDecl` (~L491): a `;` at class
   level is pushed as `{ kind:"stmt", stmt:{s:"empty"} }` (was silently skipped). ALSO removed the `this.semi()`
   after a `function f(){}` method (~L518) so a `static function f(){};` trailing `;` falls through to the
   stray-`;` branch (it is a SEPARATE empty-statement directive, not the method's terminator). This is what
   makes a class with such a `;` get the block. The empty stmt prints to "" (empty init body).
3. **AS3 script-class instance method `with(this)` (S41-3)** — `renderDebugFuncNode` (`src/sc.ts` ~L2711) gained
   optional `isMethod`/`as3` params (default false/undefined → all existing callers UNCHANGED, dbg3 safe). When
   `scope.withThis` (an instance method referencing instance props), it now wraps the try/catch in `{\nAgen +
   "with (this) {\n" + tryWrap + "}}"` + emits the closed-param `var name = $reg;` redecls — mirroring
   `compileFunctionDebug`. `printAs3ClassDebug` passes `isMethod=!m.static` + the class's instance-prop `as3`
   refinement (computed exactly as `printAs3Class`). Was the SHARED 2nd blocker: all 14 rpc files advanced from
   `rpc.js#90` (handleResponse, missing `with (this)`).
4. **Post-make init IIFE rendered as the LZX-class mergeAttributes structure (S41-4)** — `printAs3ClassDebug`
   init: replaced the broken `renderDebugFuncNode`-based init (renamed `$0`→`$0_$0`, extra `( )` parens, wrong
   displayName line) with the `debugMergeAttributes`-mirrored template: `(function () { var $lzsc$temp =
   function ($0) { try { <A(cl)>with ($0) with ($0.prototype) { { <stmts> } }} catch {…@cl} }; displayName=
   "<file>#<cl>/1"; return $lzsc$temp })(Name)`, leading dir at cl−1. `$0` is a LITERAL generated param (the
   stmts render under a FRESH `Printer` so `$0` is never renamed). **Empty-body collapse**: when the stmt-list is
   empty the whole with-body becomes `with ($0) with ($0.prototype) {}` (gold `…{}}`), else the stmts sit in the
   nested `{ … }` with their trailing `;` `elideSemi`'d (makeBlock semantics). `cl` = the class begin line
   (LzRPC `class` keyword @ source line 20 → make dir #19=cl−1, `with`/$reportException/displayName @ #20=cl).

### REMAINING DIFFS (post-S41, 27 — all the OTHER clusters, NONE is the block family)
- **lzunit-$1…$5 + testdriven-1…10 (15) @~897K + rpc-soap-$5/$8/$10 (3) @~1027K + color-$3 @847896 +
  class-inheritance-$8 @853562** — the cross-unit `$lzc$bind_id`/`readout` binder line-state (GOLD inline binder
  with NO directives, MINE with `/* file#N */`). The documented-HARD per-subtree `currentPathname` threading
  (S38 lzunit VERDICT). The biggest remaining prize (18 files share this binder root); HIGH dbg3 risk (dbg3
  binders are Pattern B). The 3 rpc-soap files reach it deep (~1027K) — same root.
- **color-$6 (1) @844797** — DOCUMENTED-and-SKIPPED this session (delicate, dbg3 risk). A constraint-only
  `<class name="box1" bgcolor="${…}"/>` (attribute always-constraints, NO `<method>`/child code members) is
  member-RICH in GOLD (synthetic ctor = `debugConstructorPlain`, file="", no directives) but MINE classifies it
  member-LESS (`debugConstructor` with `/* color-$6.lzx#9 */`). FIX = an always-constraint class-tag attribute
  must mark the class member-rich (set lastMemberClose/lastMemberConBody in the class-attr loop ~compile.ts
  L2640), then the ctorLine math follows the constraint-deps-body path. NOT done: the ctorLine computation for a
  constraint-only class is unverified and dbg3 has constraint classes — needs a careful worker.
- **class-inheritance-$19 (1) @845669** — EXTRA `"y", void 0,` instance-entry (attr-dedup / instance-prop gap).
- **data-accessing-lzdataelement / datapointer-creating-node (2)** — `/* #N */` line-only directive MISSING
  before a `(arguments.callee["$superclass"] …)` super-dispatch (super-tail line-state, S38 (d)).
- **datapointer-basics (1) @857943** — S36 reg Pattern-A discriminator — DOCUMENTED-and-SKIPPED (dbg3=Pattern B).
- **dynamiccss (1) @857626** — missing `LzStyleConstraintExpr` style-constraint binding (feature gap).
- **backtrace (1) @20810** — `with(this){var $1=Debug;…}` vs MINE `try{…}` body-shape (backtrace `<script>` wrap).

### HOW TO RESUME (S41 → S42): same loop — flip refusal (`src/compile.ts` ~L2024: `const debug = isDebugBuild
|| opts.debug === true; // GRIND FLIP` + comment the `if (isDebugBuild && !debug){…}` return), build, `node
harness/batch.mjs check` (expect **313 ok / 27 diff / 6 unsup**), `node harness/batch.mjs show '<name>'` (QUOTE
the `$N`). REVERT before handoff. S42 candidates, in rough value order:
  - **cross-unit binder line-state (18 files: lzunit/testdriven 15 + rpc-soap-$5/$8/$10)** — the BIGGEST prize
    but the documented-HARD per-subtree currentPathname threading (S38 lzunit VERDICT). HIGH dbg3 risk.
  - **color-$6 memberRich discriminator (1)** — constraint-only class → member-rich plain ctor (see above; the
    ctorLine math is the risk).
  - **dynamiccss `LzStyleConstraintExpr` (1)** / **class-inheritance-$19 instance-entry (1)** — feature gaps.
  - **data-accessing/datapointer super-tail `/* #N */` (2)** — the super-dispatch line-only directive.

## ⚑⚑⚑ SESSION 40: source `(function…)()` IIFE N−1 directive (S39's GO target) — +2 debug golds CLOSED, RPC cluster (14) unblocked-but-advanced-to-shared-next-divergence ⚑⚑⚑
dbg3 STILL BYTE-FOR-BYTE (850579, RAW IDENTICAL — verified after EVERY change; this fix lives RIGHT NEXT TO
dbg3's wrapper-N−1 logic). Regression gate GREEN at **266 ok / 0 diff / 80 unsup (refusal LIVE)**, fixtures
96/0/0, debug.mjs 5/5, dbg3 exit 3 + RAW IDENTICAL. **Flipped `batch.mjs check` advanced 300→302 ok / 40→38
diff / 6 unsup** — debug golds passing = 302−266 = **36** (was 34), +dbg3 = 37 byte-perfect. **+2 debug golds
CLOSED (`databinding-$8`, `performance-tuning-$1`), ZERO regressions** (the 38 remaining diffs are a strict
subset of the prior 40 — every divergence ADVANCED, none regressed).

I implemented S39's recommended TS fix (the source-IIFE N−1 directive), and a SECOND directly-analogous case
(script-funcdecl assignment). Both fire the SAME N−1 mechanism and rely on the SAME translation-unit
suppression. The RPC cluster (~14 files) is now UNBLOCKED past json.js but ALL advanced to a NEW shared
divergence: a missing `{`-block wrapper around the rpc/soap library's classes (see "RPC NEXT BLOCKER" below).

### THE 2 FIXES (RULES S40 below)
1. **Source `(function…)()` IIFE statement N−1 directive (S40-1)** — `src/sc.ts` `joinStmtsInner` (~L1819,
   right after super Rule A): a top-level (joinDepth===1) SOURCE expression statement whose PRINTED form begins
   with `(function` is line-tracked at N−1 (`line -= 1`). ROOT (S39): JJTree `jjtreeOpenNodeScope` sets the
   paren-group node's begin-line from `getToken(1).beginLine` — the `(` token, which lexes at N−1 because it
   follows the EOL SPECIAL_TOKEN. The N−1 LEADING directive then SUPPRESSES the inner displayName-IIFE S1
   directive (`A(funcLine)`) automatically: the one consumed text line (`(function () {`) makes the S1's
   `linediff` EQUAL the N−1 directive's → `shouldShowSourceLocation` returns false. ⚠️ GATE: `raw.startsWith
   ("(function")` — NOT a bare `(` (my first attempt gated on `raw.startsWith("(")` and BROKE dbg3 @51397: the
   GENERATED super-dispatch statement `(arguments.callee["$superclass"] && … ).call(…)` ALSO begins with `(`
   but is at N, not N−1 — `isSuperCallExpr` returns false for it since it's the substituted dispatch, not a
   `super` node, so I can't exclude via isSuper; narrowing to `(function` excludes it cleanly). Also gated
   `!ruleAFired` so a super that itself fired Rule A is untouched. The generated displayName-IIFE WRAPPERS are
   function VALUES emitted directly by `renderDebugFuncNode` (never reach the joinStmts statement loop) and
   already track N−1 on their own — so this gate does NOT touch them (dbg3 safe, verified).
2. **Script-funcdecl assignment N−1 directive (S40-2)** — `src/sc.ts` `compileScriptBodyDebug` `funcAssigns`
   (~L2270): a script-scope `function f(){…}` is rewritten to a global assignment `f = (function(){…})();`
   whose RHS is the displayName-IIFE wrapper. Changed the leading `Agen` (generated reset) to `A(d.fn.line−1)`
   (N−1 of the `function` keyword line) — the SAME wrapper-`(`-at-N−1 phenomenon; the inner `printFunc` S1
   directive @funcLine is then suppressed by the same linediff alignment. Falls back to `Agen` when the
   funcdecl carries no line. CLOSED databinding-$8 (`processReqChange`/`loadXMLDoc` funcdecls @7/8) +
   performance-tuning-$1 (`measure`/`stringConcatenation` @5).

### ⚑ RPC NEXT BLOCKER (14 files: rpc-$11/$14/$16/$17/$19/$20/$21, rpc-soap-$2/$3/$5/$8/$10/$13, rpc-xmlrpc-$2)
After the IIFE fix, all 14 share ONE divergence: GOLD emits `)()}}, 1);{` then `/* rpc/library/rpc.js#19 */`
then `Class.make("LzRPC", …)`; MINE emits `)()}}, 1);` (NO `{`) then the directive then `Class.make`. So GOLD
wraps the rpc/soap library's CLASSES in a `{ … }` block scope opened right after the library's `addScript(…, 1)`
statement; MINE is missing the `{` (and presumably its matching `}` at the library end). The `{` is library-
specific — base/component libraries (e.g. line 2491 `)()}}, 1);/* base/basecomponent.lzx#7 */`, NO `{`) do NOT
get it. ROOT not yet located: the rpc library's `library/rpc.js`/`json.js` `<script src>` becomes an
`addScript((function(){…})(), 1)` statement, and the FIRST class after it (`LzRPC`) is preceded by a lone `{`.
This is a STRUCTURAL library/script-block feature, NOT the N−1 family — a clean scoped next task (find where the
oracle's LibraryCompiler/script-instance emission opens a block around the post-script classes). HIGH value (14
files at once). Production (compress) is byte-identical without it (these are `debug="true"`-only files, no prod
gold) — verify any `{`-block fix keeps the 36 closed golds + dbg3.

### OTHER REMAINING DIFFS (post-S40, NOT the N−1 family — separate clusters)
- **color-$6 (1)** @844797 — the `$lzc$class_…` synthetic constructor is the `debugConstructorPlain` (memberRich,
  file="", NO `/* file */` directives, `$reportException("", …)`) form in GOLD, but MINE emits `debugConstructor`
  (file directives `/* color-$6.lzx#9 */`). A **memberRich-discriminator** misclassification, NOT N−1.
- **class-inheritance-$8 (1)** @853562 — `$lzc$bind_id: (function () {` binder has an unwanted inner directive in
  MINE (`/* class-inheritance-$8.lzx#18… */`) — the cross-unit binder line-state (the HARD lzunit root).
- **class-inheritance-$19 (1)** @845669 — an EXTRA `"y", void 0,` instance-entry in MINE (a class-inheritance
  attr-dedup / instance-prop feature gap, not line-state).
- **color-$3 (1)** @847896 — `$lzc$bind_id` binder `#38` vs `#39` — the cross-unit binder (lzunit root).
- **data-accessing-lzdataelement / datapointer-creating-node (2)** — a `/* #N */` line-only directive MISSING in
  MINE before a `(arguments.callee["$superclass"] …)` super-dispatch (the super-tail line-state, S38 (d) note).
- **datapointer-basics (1)** @857943 — the S36 reg Pattern-A discriminator (GOLD inline `lz["x"]=…`, MINE with
  directives) — DOCUMENTED-and-SKIPPED (delicate, dbg3=Pattern B).
- **dynamiccss (1)** @857626 — missing `LzStyleConstraintExpr` style-constraint binding (feature gap).
- **lzunit-$1…$5 + testdriven-1…10 (15)** @~897K — the `$lzc$bind_id: (function () {` `readout` binder cross-
  unit currentPathname (the documented-HARD per-subtree threading, S38 lzunit VERDICT). The biggest prize but
  needs the per-subtree (file,line) threading through the nested attr/children serialization.
- **backtrace (1)** @20810 — a `with(this){var $1=Debug;…}` vs MINE `try{…}` body-shape divergence (a different
  feature — the backtrace `<script>` body wrapping).

### HOW TO RESUME (S40 → S41): same loop — flip refusal (`src/compile.ts` ~L2024:
`const debug = isDebugBuild || opts.debug === true; // GRIND FLIP` + comment the `if (isDebugBuild && !debug){…}`
return), build, `node harness/batch.mjs check` (expect **302 ok / 38 diff / 6 unsup**), `node harness/batch.mjs
show '<name>'` (QUOTE — `$N` is shell-expanded). REVERT before handoff (restore `opts.debug === true &&
isDebugBuild` + the refusal `return`). S41 candidates, in rough value order:
  - **RPC `{`-block (14 files)** — the highest-leverage single fix (see RPC NEXT BLOCKER). Find the
    LibraryCompiler/script-instance block-scope wrapper. Verify dbg3 + the 36 closed golds hold.
  - **lzunit/testdriven (15) + color-$3 + class-inheritance-$8 binder** — the cross-unit currentPathname binder
    threading (S38 lzunit VERDICT; HIGH dbg3 risk, dbg3 binders are Pattern B).
  - **color-$6 memberRich discriminator (1)** — classify the `$lzc$class_…` ctor as memberRich (plain ctor).
  - **dynamiccss `LzStyleConstraintExpr` (1)**, **class-inheritance-$19 instance-entry (1)** — feature gaps.

## ⚑⚑⚑ SESSION 39 — DIAGNOSIS: RPC `(`-token lexer-drift, oracle-patch feasibility (GO-with-caveats; NO oracle patch — TS-tractable) ⚑⚑⚑
**No code landed. Tree left exactly GREEN** (refusal LIVE `opts.debug === true && isDebugBuild`, check 266/0/80,
fixtures untouched, dbg3 RAW IDENTICAL). Oracle/patch UNTOUCHED; golds UNTOUCHED. This is a go/no-go writeup.

### (a) ROOT CAUSE — precise, in the oracle source
The S37 `(`-token drift is **NOT** the S28–30 `SimpleCharStream.adjustBeginLineColumn` buffer-boundary bug,
and it is **NOT** "cumulative" or "inconsistent" (S37's read was a mis-attribution — see below). It is a
**single, fully-deterministic rule**: the opening `(` of any PRINTED parenthesized expression is line-tracked
at **N−1** (N = the `(`'s true source line). Origin: `Parser.jjt:40` `jjtreeOpenNodeScope(Node n)` sets each
node's begin-location from **`getToken(1).beginLine`** (the lookahead token). For a parenthesized-group node
the lookahead-1 token is the `(`, whose lexed `beginLine` is N−1 because the `(` immediately follows the `EOL`
SPECIAL_TOKEN (`Parser.jjt:141` — `\n` is NOT in the SKIP whitespace set; it is a special token), and a token
following an EOL special-token reports the prior physical line. (`jjtreeOpenNodeScope` is at
`lps-4.9.0-src/…/sc/Parser.jjt`; the SimpleNode field is `beginLine`, read by the printer via `getLineNumber()`.)
PROOF (patched-oracle `-SS` dumps, all reproduced this session):
  - `<script src>` of `var X=1;\n(function(a){a})(X);` → IIFE `(`@`41#1`, `function`@`41#2` (N−1).
  - 3-line variant with a comment on line 2 → `(`@`41#2`, `function`@`41#3` (N−1).
  - 4-statement variant → `Z=3`@`41#3` (correct), IIFE `(`@`41#3`, `function`@`41#4` (N−1).
  - **json.js (the real rpc blocker)**: line 350 IIFE → `(`@`json.js#349`, `function`@`json.js#350` (N−1).
  - `[1,2].push(X)` → `[`@N (correct — a leading `[` is NOT N−1); `void (function…)` → `void`@N, inner `(`@N−1.
  - `(W).x=1` → oracle DROPS the redundant paren → `W.x=1`@N (so N−1 only when the `(` is actually PRINTED).
  - The **compiler-generated displayName-IIFE wrapper `(`** (`(function(){var $lzsc$temp=…})()` around EVERY
    function value) is ALSO N−1 (e.g. `table = {` value `'{': (`@N−1) — this is the SAME `(` rule.

**S37's "inconsistent N+1" was a mis-read.** Those `39#154: 39#155: (` etc. are super-call statements whose
annotation triple is `stmt@N, super-quirk@N−1, paren@N` — the `(` there is at N, and the N−1 is the *super*
Rule-A middle annotation, not the paren. Verified directly (`10#444: 10#443: 10#444: (` = a `super.init` call).
The actual top-level-IIFE `(` is **reliably N−1, never N+1**.

### (b) BUG or intended?
**Intended/deterministic, NOT a defect.** Unlike the S28–30 bug (a buffer-position-DEPENDENT off-by-one — a
true inconsistency that the buffer-fix patch legitimately corrected), this N−1 is uniform and explained entirely
by `getToken(1)` + the EOL special-token. ⚠️ **The buffer-fix patch does NOT remove it** (verified: noco.js is a
2-line file inside one buffer and still drifts). It is the oracle's normal JJTree node-line attribution. So the
"fix the oracle" precedent does **not** straightforwardly apply: there is no isolatable *defect* to fix — only a
choice to change `jjtreeOpenNodeScope`'s line policy, which would alter intended output everywhere.

### (c) PATCH FEASIBILITY
**Oracle-patch route = LARGE / system-wide re-baseline, NOT a clean small fix.** The N−1 applies to EVERY printed
`(`, dominated by the compiler-generated displayName-IIFE wrapper that wraps every function value. dbg3 (850 KB,
saturated with those wrappers) is byte-identical TODAY — i.e. the TS compiler already reproduces "wrapper `(` =
N−1" correctly. An oracle patch that drove the `(` to N would shift the line of every function-value wrapper
across ALL debug output → must regenerate ALL 78 golds + dbg3 AND delete the TS wrapper-N−1 modeling. High blast
radius, and it changes *intended* output, violating the "only fix a real defect" discipline. **NO-GO on the
oracle patch.**
**TS route = SMALL and clean (GO).** The TS compiler ALREADY emits N−1 for the generated wrapper `(` (dbg3
proves it). The ONLY gap is the **top-level SOURCE `(function…)(…)` IIFE statement**: there the `(` is the
statement's FIRST token, so GOLD emits a SEPARATE leading directive at N−1 then the body at N; MINE emits only
the statement at N. EXPERIMENTALLY CONFIRMED (flipped refusal, `show 'rpc-$11.lzx'`):
  `GOLD: /* file: json.js#349 */ (function () {` vs `MINE: /* file: json.js#350 */ (function () { /* file: #350 */`.
So the fix is a per-statement N−1 directive for a top-level expr-statement whose printed text begins with a
PRINTED `(` (a paren-group / IIFE) — structurally the SAME shape as the existing super-Rule-A handling in
`joinStmtsInner` (`src/sc.ts` ~L1779–1841). I made a first proxy attempt (`startsWithParen` → prepend
`lnum(line-1,"")`) — it built but did not yet land the directive (the IIFE-callee is rendered through
`renderDebugFuncNode`, so the N−1 must be injected where the wrapper/call-callee is annotated for a top-level
*statement* context, not via a bare prepend that the translation-unit dedup then suppresses). REVERTED. This is
an implementation detail, **not** a feasibility blocker: the rule is exact, deterministic, and local. Estimated
effort: a focused worker-session (emit the N−1 lead directive at the right point + verify dbg3 RAW IDENTICAL +
no regression). ⚠️ Must be gated so it fires ONLY for a top-level source paren-group statement (not nested, not
the generated wrappers that are already correct) or it will shift dbg3.

### (d) RE-BASELINE SCOPE (if the oracle WERE patched away — for completeness; recommended AGAINST)
If `jjtreeOpenNodeScope`/EOL were patched so every `(` tracked at N: the deletable TS quirk code is the
super-call family in `joinStmtsInner` (`src/sc.ts` ~L1745–1842): Rule A / Rule A' (gapped) / Rule B
`dbgLineDelta` cascade, `prevWasShiftedSuper`/`prevTriggersQuirk`/`prevSingleLineBlockIf` state, plus the
`classLine−1` / `elementLine−1` offsets in `renderDebugFuncNode` (L2715-2720), `printAs3ClassDebug`,
`compileStylesheetDebug` (S38-2), and assorted S24–S38 per-element `−1` special-cases — **plausibly 150–250 LOC
of the hardest debug-path logic**, collapsing the super-tail (data-accessing-lzdataelement,
datapointer-creating-node), several stylesheet/class-init diffs, AND the rpc cluster at once. BUT the
re-validation cost is system-wide: regenerate ALL 78 debug golds drift-free, re-verify dbg3 + the 34 currently-
closed golds against the NEW golds, and re-confirm production (compress) byte-identical. Because the change is
to *intended* line attribution (not a defect), this is a genuine re-baseline of the entire debug line model — an
order of magnitude more risk/effort than the targeted TS fix, and it would make the TS compiler emit lines that
DISAGREE with the stock 4.9.0 jar's debug output (the patch would have to ship as part of the product). **Not
recommended.**

### (e) RECOMMENDATION — **GO (TS fix), NO-GO (oracle patch)**
Do the **targeted TS fix**: emit the N−1 leading directive for a top-level source `(function…)()` IIFE
expression-statement (and any printed top-level paren-group statement), mirroring the super-Rule-A pattern.
It is small, local, deterministic, and unblocks the rpc cluster (~14 files: rpc-$11/$14/$16/$17/$19/$20/$21,
rpc-soap-$2/$3/$5/$8/$10/$13, rpc-xmlrpc-$2) plus contributes to color-$3/color-$6/databinding-$8/dynamiccss/
class-inheritance-$8/$19 (all show the same wrapper/group N−1 family in their first divergence). Do **NOT** patch
the oracle for this — it is intended behavior, the buffer-fix doesn't touch it, and a patch would force a
full-corpus re-baseline that changes product output. **Recommended next step:** a fix-grinder session implementing
the N−1 source-IIFE directive in `joinStmtsInner`, gated to top-level source paren-group statements, verified
dbg3 RAW IDENTICAL after every change.

### Verification this session (reproducible)
`-SS` dumps via `cd /tmp; cp <f>.lzx t.lzx; bash modern-build/oracle/lzc.sh -SS --runtime=dhtml /tmp/t.lzx`;
the script-IIFE unit is `…-lineann-184.txt` for a single `<script src>` canvas. Flipped check = 300/40/6
(unchanged from S38 — no regression from inspection). Tree restored: refusal LIVE, build clean, check 266/0/80,
dbg3 RAW IDENTICAL.

## ⚑⚑⚑ SESSION 38: dataset + stylesheet DEBUG emission (Cluster-2 secondary target) — +5 debug golds CLOSED, 0 regressions ⚑⚑⚑
dbg3 STILL BYTE-FOR-BYTE (850579, RAW IDENTICAL — verified after EVERY fix). Regression gate GREEN at
**266 ok / 0 diff / 80 unsup (refusal LIVE)**, fixtures 96/0/0, debug.mjs 5/5, dbg3 exit 3 + RAW IDENTICAL,
backtrace exit 3. **Flipped `batch.mjs check` advanced 295→300 ok / 45→40 diff / 6 unsup** — debug golds
passing = 300−266 = **34** (was 29), +dbg3 = 35 byte-perfect. **+5 debug golds CLOSED, ZERO regressions**
(closed = {databinding-$9, databinding-$10, databinding-$28, databinding-$29, rpc-$15}; the 40 remaining
diffs are a strict subset of the prior 45 — every change ADVANCED, none regressed).

I took the handoff's SECONDARY target (the dataset/stylesheet emission, S37 finding (f)). The PRIMARY
lzunit-cluster blocker is the deeply-nested-instance cross-unit binder line-state (NOT the lexer `(`-drift,
but genuinely the documented-hard cross-unit case — see "lzunit VERDICT" below). The dataset/stylesheet
emission was the easy half AND I cracked the dataset cross-unit directive (it IS tractable, unlike the binder).

### THE 3 FIXES (RULES S38 below)
1. **`<dataset>` DEBUG emission + cross-unit directive (S38-1)** — in debug the local `<dataset>` was DROPPED
   (the `js += compileDataset(...)` path is never returned in debug; debug uses only DEBUG_STMTS). New
   `compileDatasetDebug` emits the TWO statements (`<name> = canvas.lzAddLocalData(...)` and `<name> == true`)
   via `compileProgramDebug`, each carrying the inherited cross-unit directive. CRACKED the directive: it is
   always `<currentPathname>#1` — DataCompiler.compile (oracle) does `env.compileScript(script)` with NO
   sourceLocationDirective, so each `addScript` resets the parser LINE to 1 (always `#1`) while
   Token.currentPathname (the persistent static FILE) varies. In a debug build the debugger library is always
   loaded → initial currentPathname = `debugger/debugger.lzx`; a preceding APP-origin top-level INSTANCE
   shifts it via the S35/S36 Pattern A/B (`instanceTrailingFile`: Pattern A → ""; Pattern B → the app file).
   CLOSED databinding-$9/$28/$29 (debugger ctx, no app instance before) + databinding-$10 (a `<dataset
   src=http>` LzDataset instance before `week` → app-file ctx) + rpc-$15.
2. **`<stylesheet>` DEBUG emission (S38-2)** — same drop bug (`js += ";" + compileProgram(prog)` never
   returned in debug). `buildStylesheetProgram(css, debugFile)` now appends the per-rule debug args
   `, "<srcMsgPathname>", <i>` (StyleSheetCompiler.compile:179). New `compileStylesheetDebug` emits TWO units:
   the leading empty `;` (LPP-4083) as its OWN translation unit (so the IIFE's directive lands at a fresh-unit
   BOL with NO leading newline: `};` + `;` + `/* file: #N */` + IIFE — matching gold's `};;/* */`), and the
   `(function(){…})()` IIFE annotated at `elementLine − 1` (the displayName-IIFE WRAPPER sits one line above
   the inner generated `function ()`, whose body/displayName/return track at `elementLine` — the same
   `classLine−1` offset as a `<class>` Class.make). The inner func's displayName col = `endCol + 4` (the
   element's `>` col padded by sourceLocationDirective + `len("; (")` + 1); padded into the source so the
   `function` keyword lexes at that column. color-$3/dynamiccss advanced PAST the stylesheet (color-$3 now
   blocks on a `$lzc$bind_id` cross-unit binder `#38` vs `#39`; dynamiccss on a `LzStyleConstraintExpr`
   style-constraint feature gap — both DIFFERENT clusters, so no close, but the stylesheet IIFE is byte-exact).
3. **`instanceTrailingFile` helper (S38-3, refactor)** — factored the S36 Pattern A/B trailing-currentPathname
   logic into a reusable helper (`subtreeHasLiteralAttr && !subtreeHasScriptOrContent && !topLevelHasIdOrName
   ? "" : file`), used to thread `crossUnitFile` after each APP-origin instance (for the dataset directive).
   The reg/trailer `regsGenerated` STILL uses its own inline copy (unchanged — dbg3-safe).

### ⚑ lzunit/testdriven CLUSTER VERDICT (15 files @897K) — NOT the lexer `(`-drift, but the HARD cross-unit binder
I characterized the lzunit-$1 blocker fully: the `readout` named-instance `$lzc$bind_id` binder. GOLD emits it
with NO directives + `$reportException("", 942, …)` (file="", line=942 a running counter); MINE emits
`lzunit/lzunit.lzx#946` directives + `$reportException("lzunit/lzunit.lzx", 946, …)`. CRUCIALLY mine MATCHES
gold for the OTHER three binders in the file (`tp`→tooltipview#20, `tooltipview`→#38, `lzunitControlPanel`→
lzunit.lzx#957) — only `readout` diverges. `readout` is a `<text id="readout">Test Results</text>` DEEP inside
the lzunitControlPanel instance subtree (TestResult class child tree). The binder (NodeModel.buildIdBinderBody,
a Function with a `#pragma` but NO `#file`) inherits Token.currentPathname at its PARSE time, which for
`readout` has been reset to "" by a `#beginAttribute` immediate-attr reset of a preceding deeply-nested sibling
(line counter at 942 = the `donebar`/`failbar` region). **This is the SAME currentPathname mechanism I cracked
for the dataset — BUT the dataset is a TOP-LEVEL statement (easy: track crossUnitFile across the top-level
loop), whereas the binder is buried inside the instance-attr serialization (`asMap`), so its inherited file/line
depends on the full `#file` token stream threaded through the WHOLE nested attr+children emission. THAT is the
genuinely-hard part the S34/S35 notes warn about.** It is NOT the intractable `(`-token lexer drift (S37) — it
is a deterministic-but-deeply-stateful cross-unit currentPathname. To crack it, `buildNode`/the attr-serialize
loop must thread a running (file, line) currentPathname through every emitted `#file`-bearing attr/child so the
binder reads the same "" + 942 the oracle leaves. HIGH dbg3 risk (dbg3's binders are Pattern B). The biggest
prize (15 files) but it needs the per-subtree currentPathname threading, not a per-binder guess.

### HOW TO RESUME (S38 → S39): same loop — flip refusal (src/compile.ts ~L1997:
`const debug = isDebugBuild || opts.debug === true; // GRIND FLIP` + comment the refusal `return`), build,
`node harness/batch.mjs check` (expect **300 ok / 40 diff / 6 unsup**), `node harness/batch.mjs show '<name>'`
(QUOTE — `$N` is shell-expanded). REVERT before handoff (restore `opts.debug === true && isDebugBuild` + the
`if (isDebugBuild && !debug) { return … }`). S39 candidates, in rough effort order:
  - **datapointer-basics (1 file, reg cluster)** — advanced to the S36 reg Pattern-A discriminator (GOLD emits
    `lz["x"] = …` INLINE, MINE with directives). The last instance is a `<window>` w/ nested literal-attr
    buttons+handlers; my discriminator classifies it B, should be A. ⚠️ The reg discriminator is delicate
    (protects S36's 8 closes + dbg3 = Pattern B) — verify carefully, don't blanket-relax. (I DOCUMENTED-and-
    SKIPPED this per the <2-example + dbg3-risk rule.)
  - **dynamiccss `LzStyleConstraintExpr` (1 file)** — a CSS style-constraint binding (`bgcolor: new
    LzStyleConstraintExpr("bgcolor","color","background-color")`) is MISSING in mine; a feature gap, not line-state.
  - **color-$3 (1 file)** — now blocks ONLY on a `$lzc$bind_id` cross-unit binder (`#38` vs `#39`) — the SAME
    binder cross-unit line-state as lzunit (the hard root). Same fix as the lzunit cluster.
  - **lzunit/testdriven (15) + color-$3 binder** — the cross-unit currentPathname threading (above). The prize.
  - **RPC cluster (18)** — the intractable `(`-token lexer drift (S37, document-and-skip).

## ⚑⚑⚑ SESSION 37: RPC-cluster feature stack (5 fixes) — 18 rpc files advanced parse→json.js@64K; blocked on intractable (-token line-drift ⚑⚑⚑
dbg3 STILL BYTE-FOR-BYTE (850579, RAW IDENTICAL — verified after EVERY fix). Regression gate GREEN at
**266 ok / 0 diff / 80 unsup (refusal LIVE)**, fixtures 96/0/0, debug.mjs 5/5, dbg3 exit 3 + RAW IDENTICAL,
backtrace exit 3. **Flipped `batch.mjs check` 295 ok / 31→45 diff / 20→6 unsup** — debug golds passing
**STILL 29** (no NEW file fully closed), BUT the diff rise is PROGRESS not regression: the 18 RPC debug
golds went from UNSUP (`parse: expected id, got .`) to COMPILING — 14 now show as DIFFs (all blocked at the
SAME json.js IIFE `(`-token line-drift @~64K), 4 (rpc-javarpc-*) advanced further to a NEW `<pattern>`
text-content gap. The 29 previously-passing debug golds are INTACT (ok held at 295). I chose the RPC cluster
(the 18 `expected id` parse-unsup, the handoff's "may be quick wins") and ground it through FIVE stacked
feature gaps — each faithful, each verified dbg3-safe — but the cluster's FINAL blocker (the `(`-token
cumulative SimpleCharStream line-drift) is the documented-intractable STOP-POINT mechanism, so no rpc file
closes yet. The 5 fixes are real infrastructure the next worker builds on.

### THE 5 FIXES (all in src/sc.ts + src/compile.ts + src/node-io.ts; RULES S37 below)
1. **Rest parameter `function(...name)`** (S37-1) — `formalParams` recognizes the `...` token (added to the
   lexer PUNCT before `.`), `functionExpr` desugars to a body prologue `var name = Array.prototype.slice.call(
   arguments, N);` (CommonGenerator.translateFunctionInternal:588 — same as compileFunction's `args="...name"`).
   Unblocked the `parse: expected id, got .` at rpc/rpc.lzx:219 `return function(...ignore){…}`.
2. **`<script src="json.js"/>`** (S37-2) — `resolveScriptSrc(ref, fromId)` (node-io.ts, resolves relative to
   the INCLUDING file's dir + component-base fallback, mirrors CompilationEnvironment.resolveReference) reads
   the JS; buildNode prefixes it with `#file <src>\n#line 1\n` (ScriptElementCompiler.compile) so the BODY
   content uses the src file's lines while the script-instance WRAPPER tracks at the `<script>` element's line.
   The `<script src>` in rpc/library/rpc.js loads json.js (a 376-line plain-JS file).
3. **AS3 class-body initializer statements** (S37-3) — `printAs3ClassDebug` no longer refuses `stmts.length>0`;
   it emits a SEPARATE post-Class.make statement: a displayName-IIFE wrapping `function ($0) { with($0) with(
   $0.prototype) { { <stmts> } } }`, invoked `(<className>)` (CommonGenerator.visitClassDefinition:514). The
   `with` tracks at classLine; the block's leading directive is classLine−1 (same as the Class.make). qname.js
   `LzQName` has 63 such static-init stmts (`XSD_STRING = new LzQName(…)`). Mirrors the PRODUCTION printAs3Class
   path (already handled there). SAFE: only fires for stmts.length>0 (lzunit's TestFailure/TestError have none).
4. **Func node `.file` for nested-function file context** (S37-4) — a `function` token captures its `#file`
   context (`fn.file = ftok.file`); `printFunc` debug uses `n.file` (not the enclosing printer's `dfile`) for the
   nested function's displayName + source directives. These DIFFER for a `<script src>` whose body switches file
   (a `JSON.stringify = function…` inside json.js, whose element file is rpc.js → directive `json.js#61`, not
   `rpc.js#61`). Defaults to dfile when no file (most bodies share the enclosing file → no change). dbg3 SAFE.
5. **Debug func precedence = 17 (IIFE double-paren fix)** (S37-5) — in the DEBUG build a function VALUE renders
   as the displayName-IIFE `(function(){…})()` — itself a CALL (prec 17) that already carries parens — so
   `prec(func)` returns 17 in debug (was 1). A debug func used as a call/member base then needs NO extra wrap:
   `(…IIFE…)()(arg)`, NOT `((…IIFE…)())(arg)`. Fixes json.js `(function(table){…})(JSON.parser.prototype.table)`.
   dbg3 SAFE (verified RAW IDENTICAL; the oracle never double-wraps).

### ⚑ THE FINAL RPC BLOCKER — the `(`-token cumulative line-drift (DOCUMENT-AND-SKIP, fully characterized)
After the 5 fixes, ALL 14 still-diffing rpc files (+ color-$3/dynamiccss stylesheet IIFEs) diverge at a
top-level `(function(){…})(…)` IIFE expression statement where the leading `(` was dropped at parse: GOLD's
statement directive is the `(`-token's line, which DRIFTS from the statement's nominal line. PROVEN via two
experiments: (a) `<script src>` of a 2-line `var X=1;\n(function(a){a})(X);` (noco.js) → lineann
`#fileline 41#2: #fileline 41#1: (` (paren@1, stmt@2 → N−1); a 3-line version with a comment line 2 (wico.js)
→ `42#3: 42#2: (` (paren@2, stmt@3 → N−1 too). (b) A full `-SS` dump shows the relationship is INCONSISTENT
across files: `39#154: 39#155: (` (paren@N+1), `39#535: 39#534: (` (paren@N−1), `7#128: 7#129: (` (paren@N+1)
— sometimes the `(` token is reported ABOVE, sometimes BELOW the statement's nominal line. This is the
CUMULATIVE source-line drift the STOP-POINT note (~L885) warns is intractable to model statically — it needs a
byte-exact SimpleCharStream port (the lexer's per-token beginLine after buffer fills / comment skips), NOT a
per-statement rule. ⚠️ The buffer-fix patch does NOT remove it (noco.js is a 2-line file, well within one
buffer, yet drifts). MINE's lexer reports the `(` at the CORRECT line (N) always, so MINE emits no rewind →
the diff. A wrong guess corrupts every gensym after it → LOG-AND-SKIP, exactly as the STOP-POINT note allows.

### REMAINING DIFF CLUSTERS (S38 targets) — all hit a documented-hard root
1. **RPC cluster (18 files: rpc-$11/$14/$16/$17/$19/$20/$21, rpc-soap-$2/$10/$13, rpc-javarpc-*, rpc-xmlrpc-$2,
   rpc-soap-$3/$5/$8).** 14 blocked on the `(`-token line-drift @~64K (intractable, above); 4 rpc-javarpc-*
   advanced further to a NEW `unexpected text content in <pattern>` parse gap (a `<pattern>` element feature —
   investigate separately). NOT closeable until the line-drift is cracked (needs the SimpleCharStream port).
2. **Dataset/stylesheet class-body-initializer ORDERING + emission (color-$3 @843643, databinding-$9/$10/$28/
   $29 @843369+, dynamiccss @849380, rpc-$15 @845015, performance-tuning-$1, datapointer-basics).** ⚠️ S37
   FOUND the root: in DEBUG mode the `<stylesheet>` (compile.ts ~L2940 `js += ";" + compileProgram(prog)`) and
   the `<dataset>` (~L2949 `js += compileDataset(…)`) are written to the COMPRESSED `js` string which the debug
   build DROPS (the debug return at ~L3054 uses only DEBUG_STMTS, never `js`). So MINE EMITS NEITHER the
   stylesheet IIFE NOR the dataset `lzAddLocalData` statement in debug. FIX: push them to DEBUG_STMTS via
   `pushDebug` in document order. The STYLESHEET debug form = `compileProgramDebug` of `;` + ` (function() {var
   $lzc$style=LzCSSStyle,$lzc$rule=LzCSSStyleRule;\n<rules w/ debug `, "<file>", i` args>})();` (the rules need
   the extra `, "<srcMsgPathname>", i` args in debug — StyleSheetCompiler.compile:177), the leading directive at
   the `<stylesheet>` SAX startLine (color-$3: stmt #3, body #4 — and the IIFE statement hits the SAME `(`-token
   drift, so even with emission it needs cluster-1's fix). The DATASET debug form = a plain statement `myData =
   canvas.lzAddLocalData(…)` with NO leading directive (DataCompiler.compile uses no sourceLocationDirective) —
   it INHERITS the cross-unit `currentPathname` from the previous statement (the LzDebugWindow class init →
   `debugger/debugger.lzx#1`), the S34/S35 cross-unit line-state. So datasets ALSO need the cross-unit mechanism.
   Net: emission is the easy half; the line-state (drift for stylesheet, cross-unit for dataset) is the hard half.
3. **lzunit/testdriven (15 files @897K).** UNCHANGED from S36 — the named-instance `$lzc$bind_id`/`$lzc$bind_name`
   binder block: GOLD emits the binder function with NO directives + `$reportException("", 942, …)` (file="",
   line = the running cross-unit counter); MINE emits `lzunit/lzunit.lzx#946` directives + `$reportException(
   "lzunit/lzunit.lzx", 946, …)`. The binder Function (NodeModel.buildIdBinderBody) has NO `#file` → inherits the
   running `Token.currentPathname`/line. This is the S34/S35 cross-unit line-state (the binder is deep inside an
   instance subtree, so the running line counter is at ~942 and the file is "" from a prior literal-attr reset).
   The biggest prize (15 files) but the hardest (cross-unit SCompiler line-state through the instance tree).
4. **Isolated:** class-inheritance-$19 (void-slot drop, S33-OPEN-B), class-inheritance-$8 (registration variant),
   data-accessing-lzdataelement @231551 + datapointer-creating-node @170785 (Cluster-3 super-tail, S34 UNCRACKED,
   high dbg3 risk), databinding-$8 @932031 (try{}/`req=void 0`), backtrace.lzx (refused feature).

### HOW TO RESUME (S37 → S38): same loop — flip refusal (src/compile.ts ~L1982:
`const debug = isDebugBuild || opts.debug === true; // GRIND FLIP` + comment the refusal `return`), build,
`node harness/batch.mjs check` (expect **295 ok / 45 diff / 6 unsup**), `node harness/batch.mjs show '<name>'`
(QUOTE the name — `$N` is shell-expanded!). REVERT before handoff (restore `opts.debug === true && isDebugBuild`
+ the `if (isDebugBuild && !debug) { return … }`). **S38's cleanest mid-size win is Cluster 2's EMISSION half**
(push the stylesheet/dataset to DEBUG_STMTS) — but verify each file's remaining diff before expecting a close
(stylesheet needs the `(`-drift, dataset needs cross-unit). The RPC `(`-drift and lzunit cross-unit are the
documented-hard roots; don't re-derive them. ⚠️ Verify dbg3 RAW IDENTICAL after EVERY change.

## RULES CRACKED IN SESSION 38 — DO NOT RE-DERIVE
S38-1. **`<dataset>` debug directive = `<currentPathname>#1`.** DataCompiler.compile does
  `env.compileScript(dsetname + " = " + LOCAL_DATA_FNAME + "(…);")` and `compileScript(dsetname + " == true;")`
  with NO sourceLocationDirective. Each `addScript` resets the parser LINE to 1 (so the line is ALWAYS 1); only
  Token.currentPathname (the persistent static FILE) varies. In a DEBUG build the debugger library is always
  loaded → initial currentPathname = `debugger/debugger.lzx`. A preceding APP-origin top-level INSTANCE shifts
  it via the S35/S36 Pattern A/B trailing context (`instanceTrailingFile`). `compileDatasetDebug` emits the two
  statements via `compileProgramDebug(src, crossUnitFile, 1)` (the `;`-joined `= …` + `== true` become two
  units, each annotated `#1`). `crossUnitFile` is threaded across the top-level loop, updated ONLY by app-origin
  instances (`child.origin == null || child.origin === opts.sourceId`) — debugger-library instances spliced
  ahead leave it at `debugger/debugger.lzx`. dbg3 has no `<dataset>` → UNAFFECTED.
S38-2. **`<stylesheet>` debug = `;` (own unit) + IIFE @elementLine−1, inner func @elementLine, displayName col
  = endCol+4.** StyleSheetCompiler.compile: `compileScript(sourceLocationDirective(element) + ";" + "
  (function(){var $lzc$style=LzCSSStyle,$lzc$rule=LzCSSStyleRule;\n<rules>})();", element)` — in DEBUG each
  rule carries two extra `_addRule` args `, ScriptCompiler.quote(getSourceMessagePathname(element)), <i>`
  (StyleSheetCompiler:179). `compileStylesheetDebug` returns TWO translation units: (a) the bare `;` empty
  statement (its OWN unit so the IIFE's directive lands at a fresh-unit BOL → no leading `\n`, matching gold's
  `};;/* file: #N */`), (b) the `(function(){…})()` IIFE annotated at `elementLine − 1` via `printer.lnum`. The
  IIFE is a displayName-IIFE whose WRAPPER (`(function () {` + `var $lzsc$temp = function ()`) sits one line
  ABOVE the inner generated `function ()` (the `classLine−1` offset / the `(`-token of the IIFE expr stmt); the
  inner func's body/displayName/`return` track at `elementLine`. The displayName `<file>#<line>/<col>` col =
  `endCol + 4` (element `>` col padded by sourceLocationDirective + `len("; (")` + 1) — padded into the parsed
  source (`" ".repeat(col-3) + iifeSource`) so the `function` keyword lexes at that column. dbg3 has no
  `<stylesheet>` → UNAFFECTED. (The post-stylesheet diffs of color-$3/dynamiccss are OTHER clusters: a binder
  cross-unit `#N` and a `LzStyleConstraintExpr` feature gap.)
S38-3. **`instanceTrailingFile(built, file)` = the S35/S36 Pattern A/B trailing Token.currentPathname.** Pattern
  A (`subtreeHasLiteralAttr && !subtreeHasScriptOrContent && !topLevelHasIdOrName`) → "" (a source-literal
  value attr's `#beginAttribute` left an unrestored `#file ` reset); else → the real `file`. Used to update
  `crossUnitFile` after each app instance (for S38-1). The reg/trailer `regsGenerated` keeps its own inline
  copy of the SAME predicate (unchanged — dbg3-safe). NOT a behavior change to the regs.

## RULES CRACKED IN SESSION 37 — DO NOT RE-DERIVE
S37-1. **Rest parameter desugar.** `function(...name)` (and method `args="...name"`): the `...` formal is
  dropped, a `var name = Array.prototype.slice.call(arguments, <count-of-fixed-params>);` prologue is prepended
  (CommonGenerator.translateFunctionInternal:588). Implemented in `formalParams` (recognizes the new `...` PUNCT
  token, returns a `rest` name) + `functionExpr` (builds the AST prologue var node and `body.unshift`es it).
  The free `Array`/`arguments` then drive with(this)/the try-wrapper normally. dbg3 SAFE (no rest params).
S37-2. **`<script src="F"/>` body = `#file F\n#line 1\n` + readFile(F).** ScriptElementCompiler.compile reads F
  relative to the including file's dir and prefixes the literal `#file <src>` directive (NOT the resolved path).
  The script-INSTANCE wrapper (`script: function(){…}` displayName-IIFE) still tracks at the `<script>` ELEMENT's
  own line/file (sourceLocationDirective(element,true)); the embedded `#file <src>` switches the BODY to F's
  lines. `resolveScriptSrc(ref, fromId)` in node-io.ts. dbg3 SAFE (no `<script src>`).
S37-3. **AS3 class-body initializer = post-Class.make `(function($0){with($0)with($0.prototype){{<stmts>}}})(
  Name)`.** (CommonGenerator.visitClassDefinition:514, the `_6`-statements substitute.) In debug it is a SEPARATE
  top-level statement (after the Class.make): the displayName-IIFE wraps `function ($0)` whose body is the nested
  `with` + double-block. The `with ($0) with ($0.prototype)` tracks at classLine; the anon-func displayName =
  `<file>#<classLine>/1` (col 1); the outer directive = classLine−1 (= the Class.make's directive). `printAs3-
  ClassDebug` builds a synthetic `with` Stmt (`.line = classLine`) + the double-block and renders via
  `renderDebugFuncNode`. Mirrors the existing PRODUCTION `printAs3Class` (lines 1634-1640). SAFE: gated on
  `stmts.length>0` (lzunit classes have none → no behavior change; dbg3 has no script-level AS3 class).
S37-4. **A nested function's displayName + directives use the FUNCTION'S OWN `#file`, not the enclosing dfile.**
  The `function` token captures `ftok.file`; `fn.file` is threaded through fold; `printFunc` debug uses `n.file ??
  dfile`. Differs from dfile ONLY when a `<script src>` body switches file mid-stream (json.js fn inside a
  rpc.js-element script). Defaults to dfile when absent → no change for same-file bodies. dbg3 RAW IDENTICAL.
S37-5. **In the DEBUG build `prec(func) = 17` (call), not 1 (assign).** A function VALUE renders as the
  displayName-IIFE `(function(){…})()` — a CALL (prec 17) carrying its own parens — so a debug func used as a
  call/member base needs NO extra wrap (`(…)()(arg)`, not `((…)())(arg)`). The oracle never double-wraps. In
  COMPRESS mode a func is still prec 1 (a raw `function(){}` needs the call-target paren). dbg3 RAW IDENTICAL.

## ⚑⚑⚑ SESSION 36: IMPLEMENTED Cluster 2 reg/trailer Pattern-A discriminator — +8 debug golds CLOSED, 0 regressions ⚑⚑⚑
dbg3 STILL BYTE-FOR-BYTE (850579, RAW IDENTICAL — verified after EVERY change). Regression gate GREEN at
**266 ok / 0 diff / 80 unsup (refusal LIVE)**, fixtures 96/0/0, debug.mjs 5/5, dbg3 exit 3 + RAW IDENTICAL.
**Flipped `batch.mjs check` advanced 287→295 ok / 39→31 diff / 20 unsup** — debug golds passing = 295−266
= **29** (was 21), +dbg3 = 30 byte-perfect. **+8 debug golds CLOSED, ZERO regressions** (verified by a
baseline-probe diff: closed = {class-inheritance-$30, class-inheritance-$31, debugging-$4, input-devices-$7,
input-devices-$10, methods-events-attributes-$12, methods-events-attributes-$20, rpc-$12}; regressed = {}).
S35 cracked the MECHANISM but landed no code; S36 implemented it, guarded. All 8 fully close (byte-identical
under the harness normalize — verified directly, incl. the sprite frame-order). **The reg discriminator is
now FULLY CORRECT: no remaining diff has a reg-related first divergence** (color-$3/databinding-$10 stay
Pattern B; dbg3 stays Pattern B). The remaining 31 diffs are the OTHER clusters (script-initializer IIFE
ordering @843K, lzunit/testdriven late-binders @897K, datapointer super-tail, backtrace) — NONE reg-related.

### ⚑ THE REG/TRAILER DISCRIMINATOR — IMPLEMENTED RULE (corrects S35's "any literal attr" proxy)
The tag-map registrations (`lz["x"]=cls;`×N) and the trailer (`Debug.makeDebugWindow()`/the `<debug>`
`new LzDebugWindow(...)`/`canvas.initDone()`) inherit the JavaCC lexer's `Token.currentPathname` left by
the LAST `#file` token of the LAST top-level INSTANCE's source. Pattern B (currentPathname=real app file →
sequential `/* file: app#k */` directives) vs Pattern A (currentPathname="" → INLINE, NO directives). The
boolean `regsGenerated` (in src/compile.ts ~L2980, the `if (DEBUG_STMTS){…}` reg/trailer block) is TRUE
(Pattern A → `annoFileLine(null, 0)` everywhere; `shouldShowSourceLocation` returns false for a generated
fresh-line-state unit → no directive) iff ALL FOUR hold:
  1. **`lastTopWasInstance`** — the LAST top-level statement WAS an instance (not a `Class.make`, an
     immediate-`<script>`, dataset, or stylesheet — those end on generated/other context). Tracked at the
     instance push (set true), the class push (false, ~L2825), the immediate-script push (false, ~L2896).
  2. **`lastTopInstance.subtreeHasLiteralAttr`** — the last instance emits ≥1 SOURCE-literal VALUE attr,
     i.e. one the oracle wraps in `#beginAttribute …#file <app>…#file <RESET>#endAttribute` (the trailing
     empty `#file ` resets currentPathname to "", never restored). Computed in buildNode: set
     `hasLiteralAttr=true` ONLY in the attr-loop branches that emit a literal value — `id` (`attrs["id"]`),
     `name` (`attrs["name"]`), `$immediately{…}` (`compileExpr`), color-PLAIN (`cv.plain`), and the generic
     `compileAttr` path. NOT set for: constraints (LzAlwaysExpr/LzOnceExpr — `new …Expr(...)` carries NO
     `#file`), event handlers, binders, `$delegates`, void slots, OR auto-injected attrs (e.g.
     `clickable: true` synthesized from an onclick handler — these are NOT in `el.attrOrder`, so they never
     hit the attr loop → never counted; this is exactly why dbg3 (whose `clickable: true` is handler-injected,
     and whose only value attr `width` is a `${}` constraint) is Pattern B). ⚠️ CRUCIAL SUBTLETY (the S35
     "any literal in subtree" proxy was WRONG): a method-bearing node becomes an ANON CLASS, so its CHILDREN
     are hoisted into the `Class.make` body (a SEPARATE earlier translation unit) — those children's literals
     do NOT affect THIS instance's closing context. So only INLINE (non-anon-class) children contribute:
     `subtreeHasLiteralAttr = hasLiteralAttr || (!becomesAnonClass && children.some(…)) || datapath…`, where
     `becomesAnonClass = methodEntries.some(non-void-slot) && !isState`. (viewresource: outer `<view>` has an
     oninit handler → anon class mh1, its `<view bgcolor="red"/>` child is class-hoisted → instance attrs are
     just `$delegates` → Pattern B, MATCHING gold. Without this guard it over-fired Pattern A → REGRESSION.)
  3. **NOT `lastTopInstance.subtreeHasScriptOrContent`** — exclude a last instance whose subtree ends on a
     `<script>` body or folded text CONTENT (`#beginContent …#file <reset>#endContent`, NOT `#beginAttribute`).
     The oracle SILENTLY RE-ESTABLISHES the content reset (the color-$3/databinding-$10 anomaly S35 could not
     locate) → those stay Pattern B. Set true on a `<script>` node and on the folded-`text`-from-content path.
  4. **NOT `lastTopInstance.topLevelHasIdOrName`** — exclude a last instance with an `id=`/`name=` on the
     TOP node itself (→ a global + bind_id/bind_name). A top-level id/name triggers a HIDDEN `#file <app>`
     re-set AFTER the instance (the named-instance registration / global-decl path — same FAMILY of re-set as
     the color-$3 script anomaly) → Pattern B EVEN WHEN the instance's own attrs ended on a `#file ` reset.
     Computed `topLevel && (el.attrs["name"]!=null || el.attrs["id"]!=null)`. **THIS was the missing piece**:
     class-inheritance-$26 `<container name="thetop">` (+ $20/$21/$27/$29/$7, custom-components-$1,
     program-development-$16) have a literal-attr reset as the deepest-last `#file` YET are Pattern B because
     the top node is NAMED; the unnamed `<container>` of $30/$31 is Pattern A. (Verified: a bare top-level
     `<view id="myid" width=… bgcolor=…/>` → regs `40#48` = Pattern B too, so id is guarded as well as name.)
When `regsGenerated` is FALSE → the CURRENT Pattern-B code runs EXACTLY (`annoFileLine(regFile, i+1)` per reg,
`annoFileLine(regFile, 1)` for the trailer; dbg3 + color-$3 + lzunit-$1 + viewresource stay byte-identical).

### HOW THE GUARD WAS PROVEN (reproducible)
`-SS` line-annotation dumps from the patched oracle (`cd /tmp; cp <file>.lzx t.lzx; bash
modern-build/oracle/lzc.sh -SS --runtime=dhtml /tmp/t.lzx` → `t-src-<N>.txt` = source w/ `#file`/
`#beginAttribute`; `t-lineann-<M>.txt` = annotated output; tagmap is the lowest N with `grep -l 'lz\['`,
last-instance is the highest LzInstantiateView N below it; regs are `#fileline 0#0: lz[` (Pattern A) vs
`#fileline <fid>#k: lz[` (Pattern B)). ⚠️ zsh aborts a compound cmd on a no-match glob — run `rm`/`grep`
of `t-src-*.txt` as SEPARATE bash calls. Proof points captured: dbg3 last instance (`clickable: true` BARE,
`width` constraint → no `#beginAttribute` → B); input-devices-$7 (`width: #beginAttribute…#file ` deepest →
A); class-inheritance-$30 (child `name: "outside"` reset → A); class-inheritance-$26 (`width` reset BUT
`<container name="thetop">` → B); `<view id="myid" …/>` (→ B); `$immediately{}` (→ #beginAttribute → A);
`clickable="true"` SOURCE attr (→ #beginAttribute → A, unlike handler-injected).

### IMPLEMENTATION SITES (all in src/compile.ts)
- BuiltNode interface: added `subtreeHasLiteralAttr`, `subtreeHasScriptOrContent`, `topLevelHasIdOrName`.
- `buildNode`: local `hasLiteralAttr`/`hasContent` set in the literal-value attr branches + the
  folded-text-content path + the `<script>` early return (`subtreeHasScriptOrContent: true`); aggregated at
  the return with the `becomesAnonClass` guard.
- `compileInner`: `lastTopInstance`/`lastTopWasInstance` tracked at the instance push (~L2952, set), the
  class push (~L2825, false), the immediate-script push (~L2896, false); `regsGenerated` + `regAnno(i)`
  helper in the reg/trailer block (~L2980).

### WHY dynamiccss did NOT close (S35 mis-listed it as a clean Pattern-A file)
dynamiccss is a `<debug>` Pattern-A file, but its FIRST divergence is @849380 — the `<script>`
class-body-initializer IIFE ordering (GOLD `};;/* file: dynamiccss#2 */ (function(){…})()` BEFORE the next
`Class.make`; MINE emits `Class.make` first), which is BEFORE the regs. So the reg fix is necessary but not
sufficient for dynamiccss; it now needs the script-initializer-ordering cluster (below). Its regs ARE now
correct (Pattern A) — verified the reg region is no longer the divergence.

### REMAINING DIFF CLUSTERS (S37 targets) — NONE are reg-related anymore
1. **Script class-body-initializer IIFE / dataset-statement ORDERING (~7 files: color-$3 @843643,
   databinding-$8/$9/$10/$28/$29 @843369–844356, dynamiccss @849380, rpc-$15 @845015).** GOLD emits a
   `<script>` class-body initializer IIFE `};;/* file: app#k */\n(function(){…})()` OR a dataset
   `myData = canvas.lzAddLocalData(…)` BEFORE the `Class.make`/instance blocks; MINE emits the Class.make /
   instance first. This is S33-1's "Class-body-statement initializer NOT yet handled in debug" + S31/S32
   statement-order. Independent of the reg discriminator (now solved). The biggest remaining cluster.
2. **lzunit/testdriven late named-instance binder block (~15 files @897123+).** ALL advanced past the regs
   now (their regs were already Pattern B and correct); blocked on the `$lzc$bind_id`/`$lzc$bind_name`
   trailer line-state for NAMED instances (GOLD emits with NO directives — line-state settled to generated;
   MINE re-emits `#946`-style directives). Per S34: thread the binder block's line-state.
3. **Isolated:** datapointer super-tail (Cluster 3, S34 UNCRACKED, high dbg3 risk). class-inheritance-$19
   void-slot drop (S33-OPEN-B). class-inheritance-$8 (registration variant). backtrace.lzx (refused feature).

## RULES CRACKED IN SESSION 36 — DO NOT RE-DERIVE
S36-1. **The reg/trailer Pattern-A discriminator (FULL rule above).** `regsGenerated` = lastTopWasInstance &&
  subtreeHasLiteralAttr && !subtreeHasScriptOrContent && !topLevelHasIdOrName. A SOURCE-literal value attr
  (`#beginAttribute`) leaves a `#file ` reset → currentPathname="" → Pattern A — UNLESS a hidden re-set
  follows (a `<script>`/text content reset, OR a top-level id/name's registration). Auto-injected attrs
  (`clickable: true` from a handler) and constraints (`new LzAlwaysExpr/Once`) carry NO `#file`. Anon-class
  children are CLASS-hoisted (separate unit) → do NOT count; only inline children do. dbg3 = Pattern B
  (constraint-only + handler-injected clickable) → MUST stay B (verified RAW IDENTICAL).
S36-2. **A method-bearing instance node becomes an anon class whose CHILDREN move to the `Class.make` body**
  (a SEPARATE earlier translation unit), so those children's `#beginAttribute` resets do NOT affect the
  instance's closing `#file` context. (viewresource over-fired Pattern A without this — REGRESSION caught +
  fixed via `becomesAnonClass = methodEntries.some(non-void) && !isState`.)
S36-3. **A top-level `id=`/`name=` on the LAST instance forces Pattern B** (a hidden `#file <app>` re-set
  after the named-instance registration / global decl), regardless of a trailing literal-attr `#file ` reset.
  Same RE-SET FAMILY as the color-$3 `<script>` anomaly (S35 could not locate it; this is its named-instance
  cousin). class-inheritance-$26 `<container name="thetop">` = B; the unnamed `<container>` of $30 = A.

### HOW TO RESUME (S36 → S37): same loop — flip refusal (src/compile.ts ~L1918:
`const debug = isDebugBuild || opts.debug === true; // GRIND FLIP` + comment the refusal `return`), build,
`node harness/batch.mjs check` (expect **295 ok / 31 diff / 20 unsup**), `node harness/batch.mjs show <name>`
per divergence. REVERT before handoff (restore `opts.debug === true && isDebugBuild` + the
`if (isDebugBuild && !debug) { return … }`). The reg cluster is DONE — S37 should target Cluster 1 (the
`<script>` class-body-initializer IIFE / dataset statement-ORDERING) which now blocks ~7 files at @843K, OR
the lzunit named-instance binder line-state (~15 files @897K). ⚠️ Both touch the top-level statement EMISSION
ORDER / cross-unit line-state — verify dbg3 RAW IDENTICAL after every change.

## ⚑⚑⚑ SESSION 35: CRACKED the reg/trailer cross-unit MECHANISM (Token.currentPathname); no fix landed — DOCUMENT-and-SKIP ⚑⚑⚑
dbg3 STILL byte-identical (never touched the emitter; ZERO code changes landed — only flip/revert).
Regression gate UNCHANGED at 266/0/80 (refusal LIVE), fixtures 96/0/0, debug.mjs 5/5, dbg3 exit 3 +
RAW IDENTICAL. Flipped check UNCHANGED at 287/39/20 (21 debug golds + dbg3 = 22). **I spent the session
on the PRIMARY TARGET (Cluster 2 reg/trailer cross-unit line-state) and CRACKED the actual oracle
mechanism — but it is genuinely PARTIALLY INTRACTABLE (one anomaly resists any static model I could
build from the dumps), so per the handoff's explicit guidance I DID NOT land a risky partial fix
(refuse-don't-miscompile + the $m gensym cascade). Below is the COMPLETE mechanism for S36 to finish.**

### ⚑ THE REG/TRAILER DISCRIMINATOR — FULLY CHARACTERIZED (this is the S31/S32/S33/S34 "cross-unit" landmine)
THE PRIOR SESSIONS' MODEL WAS WRONG. `makeTranslationUnits` is NOT stateful across top-level statements
(verified in the oracle: `JavascriptGenerator.compileBlock` loops over the program's children and calls
`ptp.makeTranslationUnits(child, sources)` PER CHILD, each with a FRESH `AnnotationProcessor`/`curLstate`
— my `assembleDebugProgram` per-unit-fresh ALREADY matches this exactly). So threading `curLstate` is the
WRONG fix and would (rightly) break dbg3. **DO NOT attempt the "stateful makeTranslationUnits" refactor —
it is a dead end.** The real discriminator is `Token.currentPathname`, a STATIC in the JavaCC lexer
(`Parser.jjt:113` `Token.setCurrentPathname(image)` on a `#file <name>` directive; each Token captures it
at lex time → `node.getFilename()` → `annotateFileLineNumber` fileId). It persists across parse calls.

THE TAG-MAP (`ToplevelCompiler.outputTagMap` → `env.compileScript(tagmap.toString())`, NO elt, so NO
`#file` directive in the source) and the trailer (`DHTMLWriter.finish`: `addScript("Debug.makeDebugWindow()")`,
`addScript("canvas.initDone()")`, and the user-`<debug>` `addScript(DEBUGGER_WINDOW_SCRIPT)`) are each parsed
with NO leading `#file`, so EVERY reg/trailer token inherits `currentPathname` left by the LAST `#file`
directive in the LAST instance's source. TWO outcomes (proved by `-SS` line-annotation dumps — see PROOF):
  - **Pattern B (regs `app.lzx#1,#2,#3…`, sequential; trailer `app.lzx#1`)** = `currentPathname` is the
    real app file → each reg child (fresh makeTU, curLstate="") emits `/* file: app#k */`. **MINE EMITS
    THIS ALWAYS** (`registrations.forEach(annoFileLine(regFile, i+1))`, regFile=`lastTopFile`=app). dbg3
    is Pattern B (CORRECT). color-$3, lzunit-$1..$5, testdriven-*, databinding-$10/$28/$29 are Pattern B
    (I already match the regs; their @843K–897K diffs are a DIFFERENT cluster — see below).
  - **Pattern A (regs INLINE, `},N);lz["x"]=…lz["y"]=…` NO directives at all; trailer also inline)** =
    `currentPathname` is GENERATED ("") → reg children fileId 0, line 0 → NO directive. **MINE WRONGLY
    EMITS the Pattern-B directives here** → the diff. Pattern A files: class-inheritance-$30 @851186,
    class-inheritance-$31 @846885, dynamiccss @849380, debugging-$4 @845825, input-devices-$7 @847211,
    input-devices-$10 @846729, methods-events-attributes-$20 @845123 (and methods-events-attributes-$12,
    rpc-$15-trailer-ish — verify). ~7 clean files would CLOSE if the discriminator is implemented.

### ⚑ WHAT SETS currentPathname="" (Pattern A): the `#beginAttribute` reset, never restored
An IMMEDIATE-literal attribute (NodeModel `when==WHEN_IMMEDIATELY`, not canvas w/h; NodeModel.java:478)
is wrapped `#beginAttribute\n#file <app>\n#line N\n<value>\n#file \n#endAttribute` — the trailing `#file `
(EMPTY) resets `currentPathname` to "". A CONSTRAINT attribute (`new LzAlwaysExpr/LzOnceExpr(...)`,
when=once/always/path/style) is a plain expression with NO `#file` → does NOT change currentPathname.
There is NO save/restore for `#endAttribute`/`#endContent` (verified in Parser.jjt — they're inert tokens).
So: **after an instance, currentPathname = "" iff the DEEPEST-LAST `#file`-setting token in that instance
is an immediate-attr's trailing `#file ` reset (i.e. the last immediate attr is not followed by any later
`#file <real>` token — e.g. another instance/constraint with its own `#file`).** Proof per file (`-SS`
`*-src-*.txt` of the instance just before the tagmap):
  - dynamiccss (A): `…layout: #beginAttribute #file /tmp#line59 {axis:"y",spacing:5} #file #endAttribute,
    red: new LzAlwaysExpr(…), …, y: new LzAlwaysExpr(…)}, "class": …}, 20);` — the `layout` immediate
    resets to "", and red/toggle/width/x/y are constraints/void (NO `#file`), so the closing `},20);`
    inherits "" → regs `0#0` GENERATED. ✅ (So it is NOT "last attr immediate" — it is "last `#file`-token
    was a reset"; dynamiccss's LAST attr `y` is a constraint, yet Pattern A. THIS is the subtlety prior
    sessions missed.)
  - input-devices-$7 (A): sorted-last attr `width: #beginAttribute…300 #file #endAttribute` → "" → regs gen.
  - class-inheritance-$30 (A): last instance `{attrs:{outside:void 0}, children:[{attrs:{$delegates:…,
    inside:void 0, name:"outside"}, "class":$lzc$class_mh4}], "class":…}` — the DEEPEST-last `#file` is
    `name:"outside"` (an immediate string in the CHILD's attrs) whose reset propagates out → regs gen.
  - debugging-$4 (A): has a `<script>` but the LAST instance is a view `width: #beginAttribute…150 #file
    #endAttribute}, …}, 11);` → "" → regs gen.
  - lzunit-$1 (B): last instance `{children:[{attrs:{mytext:void 0, prop1: new LzOnceExpr(…)}, "class":…}],
    "class":TestSuite}, 3);` — ALL attrs constraint/void, NO `#beginAttribute` anywhere AFTER the instance's
    own `#file /tmp/lzunit.lzx#6` → currentPathname stays REAL → regs `app#k`. ✅
  - dbg3 (B): last instance `{attrs:{$delegates:…, clickable: true, width: new LzAlwaysExpr(…)}, "class":
    $lzc$class_mh3}, 1);` — ⚠️ NOTE `clickable: true` and the others render WITHOUT `#beginAttribute` here
    (they are post-`$delegates`; need to confirm whether dbg3's clickable/etc are immediate-wrapped — in
    the dbg3 dump the last instance shows NO `#beginAttribute`, last attr `width` is a constraint → stays
    REAL → regs `app#k`). dbg3 is Pattern B. The implemented rule MUST keep dbg3 Pattern B.

### ⚑ THE ONE ANOMALY that blocks a clean implementation (and why I did NOT land a fix)
**color-$3 is Pattern B (regs `color-$3.lzx#1,#2,#3`) — but by the rule above it should be Pattern A.**
Its LAST instance (a `<script>` → `lz.script` instance) src ENDS `…#file /tmp/c.lzx #line 73 …(empty body)…
#file \n#endContent\n}}}, 1)` — the LAST `#file` is EMPTY, and the closing `}}}, 1)` lineann tokens are
`0#0` (generated, verified in `c3-lineann-209.txt` tail). So currentPathname="" after the script instance
— YET the tagmap regs are `40#k` (fileId 40 = c.lzx, REAL). I could NOT find what re-sets currentPathname
to c.lzx between the script instance and the tagmap (checked all `*-src-*` and `*-lineann-*` dumps; the
tagmap src has no leading `#file`; outputTagMap uses the no-elt compileScript). There is a hidden re-set
specific to a `<script>`-as-last-instance (probably a SEPARATE compileScript for the script element's
class/body that re-establishes `#file c.lzx`, OR the script-instance path differs). **Because color-$3
(and databinding-$10, also `<script>`-bearing & Pattern B) contradict the otherwise-clean rule, a naive
implementation of "last instance ends in a `#beginAttribute` reset → suppress reg directives" risks
MISCOMPILING any `<script>`-bearing Pattern-B file → 0-diff/refuse-don't-miscompile VIOLATION + the $m
gensym counter cascades (a wrong reg block shifts nothing gensym-wise, BUT the trailer's
`new LzDebugWindow`/initDone directives also flip, and getting the trailer wrong on a passing file would
regress it). So I documented and skipped, exactly as S33/S34 did for their 2-example conflicts.**

### HOW S36 SHOULD FINISH CLUSTER 2 (concrete, low-risk path)
1. Reproduce the proof: `cd /tmp; cp <file>.lzx t.lzx; <oracle> -SS --runtime=dhtml t.lzx` (oracle =
   the lzc.sh classpath, see below) → inspect `t-src-<N>.txt` (the instance just before the tagmap; find
   it by `grep -l 'lz\["' t-src-*.txt`, the tagmap is the lowest such N) and `t-lineann-<M>.txt` (regs are
   the `#fileline 0#0: lz[` ones for Pattern A, `#fileline <fid>#k: lz[` for Pattern B).
2. RESOLVE THE color-$3 ANOMALY FIRST (do NOT implement before this): find the compileScript that re-sets
   `currentPathname=c.lzx` after the `<script>` instance — likely `addClassModel`/the script-element's own
   class emission, or the `#file` left by the script-element CompilerUtils path. Trace `Token.setCurrentPathname`
   call order via the `-SS` `*-src-*` dump SEQUENCE (sort by N; the LAST src with a real `#file <app>` as its
   trailing directive before the tagmap N is the winner). Once you know the FULL rule (incl. scripts),
   you can classify each top-level file deterministically.
3. IMPLEMENT in `src/compile.ts` (~L2911 `if (DEBUG_STMTS){…}`): compute a boolean `regsGenerated` =
   "the last instance leaves currentPathname generated". When TRUE: emit the regs with `annoFileLine(null, 0)`
   (generated, → NO directive) instead of `annoFileLine(regFile, i+1)`, AND emit the trailer
   (`debugWindowScript`/`makeDebugWindow`/`initDone`) generated too (annoFileLine(null,0)). When FALSE:
   keep the CURRENT Pattern-B code exactly (dbg3 + color-$3 + lzunit must stay byte-identical).
   The cleanest way to compute `regsGenerated` faithfully: in `buildNode`/the attr-build loop, when an
   IMMEDIATE-literal attr is emitted (the `attrSrc`/`#beginAttribute` path, src/compile.ts:438), record on
   the instance whether its DEEPEST-LAST emitted `#file`-token is a reset. Simpler proxy that fits all the
   NON-script files: `regsGenerated` = the last top-level instance has ≥1 immediate-literal attr AND its
   sorted-last `#file`-bearing attr (across attrs+children, deepest) is an immediate (not a constraint/another
   instance with its own `#file`). GUARD it so script-bearing files take the (verified) Pattern-B path until
   the color-$3 re-set is understood.
4. After it works for the ~7 Pattern-A files: `LZC_DEBUG_FORCE=1 node harness/batch.mjs dbgshow /tmp/dbg3.lzx`
   MUST say RAW IDENTICAL (dbg3 is Pattern B — verify the rule classifies it B). Then `batch.mjs check`
   flipped should rise from 287 by ~7. Note: $30/$31 ALSO have the class-inheritance-$19-style void-slot or
   other late diffs — verify each Pattern-A file's ONLY remaining diff is the regs before expecting a close.

### NOTE: the @843K diffs of the Pattern-B `<script>`/databinding files are a SEPARATE cluster (NOT regs)
color-$3 @843643, databinding-$9/$10/$28/$29 @843369–844356, rpc-$15 @845015 diverge at a `<script>`
class-body initializer / dataset-statement ORDERING: GOLD emits `};;/* file: app#3 */\n(function(){…})()`
(a script class-body initializer IIFE) or `myDataset = canvas.lzAddLocalData(…)` BEFORE the `Class.make`/
instance blocks; MINE emits `Class.make(…)` or the instance first. This is S33-1's "Class-body-statement
initializer NOT yet handled in debug" + S31/S32 statement-order. Independent of the reg discriminator.

## ⚑⚑⚑ SESSION 34: CORPUS-DEBUG GRIND — lzunit/testdriven cluster (15 files) cracked through @897K ⚑⚑⚑
dbg3 STILL byte-identical (verified after EVERY fix — reverted ONE Cluster-3 super-tail attempt that
broke it @432745). 3 fixes landed (RULES S34 below). The headline FLIPPED `batch.mjs check` count is
UNCHANGED at **287 ok / 39 diff / 20 unsup** (debug-golds passing = 287 − 266 = 21, +dbg3 = 22) — NO new
file fully closed — BUT the ENTIRE 15-file lzunit/testdriven cluster advanced from the TestCase.construct
region (@846405) all the way to the trailer binder block (@897123), past the 2nd-`<script>` multi-var
(S33-OPEN-A SOLVED), the gapped-super, and the user try/catch/finally clause directives. They're now ALL
blocked on the SAME late issue: the named-instance `$lzc$bind_id`/registration trailer cross-unit line-
state (the Cluster-2 stateful makeTranslationUnits — GOLD emits those binders with NO directives because
the line-state has settled to generated; MINE emits `#946`-style directives). Cracking Cluster 2 (the
stateful makeTranslationUnits refactor) should now CLOSE all 15 at once + ~10 registration-cluster files.
Regression gate UNCHANGED at 266/0/80 (refusal LIVE), fixtures 96/0/0, debug.mjs 5/5, dbg3+backtrace exit
3, dbg3 RAW IDENTICAL.

### HOW TO RESUME (S34 → S35): same loop — flip refusal (src/compile.ts ~L1918:
`const debug = isDebugBuild || opts.debug === true; // GRIND FLIP` + comment the refusal `return`), build,
`node harness/batch.mjs check` (expect 287 ok / 39 diff / 20 unsup), `node harness/batch.mjs show <name>`
per divergence. REVERT before handoff (restore `opts.debug === true && isDebugBuild` + the
`if (isDebugBuild && !debug) { return … }`).

### REMAINING DIFF CLUSTERS (S35 targets) — BOTH big clusters are now the SAME root: cross-unit line-state
1. **Cluster 2 — named-instance binder + registration trailer cross-unit line-state (THE BIG ONE, ~25
   files: ALL 15 lzunit/testdriven @897123+, PLUS the registration block files databinding-$9/$10/$28/$29
   @843369+, class-inheritance-$8/$30/$31, methods-events-attributes-$12/$20, color-$3/$6, rpc-$12/$15,
   input-devices-$7/$10, performance-tuning-$1, dynamiccss, debugging-$4).** The trailer top-level
   statements (the `lz["x"] = cls;` tag-map AND the named-instance `{attrs:{$lzc$bind_id: …}}` binders)
   are emitted by the oracle as ONE continuous translation unit whose line-state THREADS from the previous
   top-level statement. GOLD: the binders/regs that follow a generated-line context emit with NO `/* file
   */` directives (line-state already at file=""); MINE renders each as its OWN fresh-line-state unit so
   each re-emits a leading directive. ALSO (databinding-$9 @843369): the top-level STATEMENT ORDER differs
   — GOLD emits the dataset/script-instance (`myData = canvas.lzAddLocalData(...)` @debugger.lzx#1) BEFORE
   the `Class.make` blocks; MINE emits the Class.make first. FIX (per S31-3 / S32-1): thread `curLstate`/
   text-line-count ACROSS top-level statements in `assembleDebugProgram` (src/debug.ts) — make
   makeTranslationUnits STATEFUL per the oracle's persistent SCompiler, NOT per-unit-fresh, AND get the
   statement-emission order right. ⚠️ HIGH dbg3 RISK (S33 reverted a naive attempt @846597). dbg3 keeps
   its reg directives because its regs follow a `<debug>`-window+initDone (file/line jump); the corpus
   files' regs follow a canvas-direct/binder context (aligned → no directive). Needs a careful
   `translateAnnotatedUnit` refactor to a PERSISTENT line-state object passed through the whole top-level
   loop, guarded so dbg3's directives survive exactly. THE biggest single win, the hardest.
2. **Cluster 3 — super after if-block with a CONTROL tail (datapointer-creating-node @170785/now @194963
   if you apply a partial fix, data-accessing-lzdataelement @231551).** STILL UNCRACKED — S34 TRIED the
   discriminator "control-tail suppresses ONLY when it's an `if` with a BLOCK then; an else-chain with
   NON-block branches FIRES" (baselistitem dataBindAttribute `if(attr=='text')…; else if(attr=='value')…`
   → fires #52; baseformitem init `…; if($debug){…}` → suppresses) — it FIXED datapointer (@170785→@194963)
   but REGRESSED dbg3 @432745 (a super.init whose predecessor's control-tail shape my discriminator
   mis-judged) → REVERTED. The two-example conflict (S32-3) is REAL; my block-vs-nonblock discriminator is
   WRONG for some dbg3 case. Needs the JJTree/ParseTreePrinter line-trace for a super after a control-tail
   if-block, NOT a guess. Low priority (2 files), high dbg3 risk.
3. **Isolated:** backtrace.lzx (`backtrace: true` feature, refused). databinding-$8 @932031 (try{}/`req =
   void 0`). class-inheritance-$19 @845669 (class-three multi-named-child void-slot drop, S33-OPEN-B,
   UNCRACKED 1-example).

## RULES CRACKED IN SESSION 34 — DO NOT RE-DERIVE
S34-1. **2nd-`<script>` multi-`var` rewrite: each `var`→assignment is wrapped by the oracle in an
  `ASTStatement(0)` (JavascriptGenerator.rewriteScriptVars:1025) whose own `lnum` prepends a LINE-0
  (generated) annotation BEFORE the inner assignment's real-line annotation.** In `joinStmtsInner`
  (src/sc.ts), when a statement carries `scriptVarRewrite` (set on the `var`→`expr` rewrite in
  `stripScriptVarsInner`), prepend `annoFileLine(null, 0)` to its annotated text (before the inner real-
  line `lnum`). In the translation-unit resolution this line-0 wrapper emits a `/* -*- file: -*- */` reset
  ONLY when the file context just changed away from generated. So: lzunit script `var catchErrors=true;
  var asynchronousTests=true; canvas.runTests=0;` → catchErrors keeps its real `#58` (file changed ""→src),
  asynchronousTests's line-0 wrapper resets to `/* file: -*- */` then its real `#59` is suppressed (file/
  line-same), canvas.runTests (not a var) stays generated. SOLVES S33-OPEN-A. dbg3 UNAFFECTED (its only
  `lz.script` is single-statement, no 2nd var). The `scriptVarRewrite` flag is set in `stripScriptVarsInner`
  case "var" and consumed in joinStmtsInner (no fold-carry needed — script-element rest stmts are stripped
  POST-fold by compileScriptBodyDebug).
S34-2. **Gapped super after a SINGLE-LINE block-if (Rule A'): tracks at prevEnd+1, not prevEnd.** A super
  ONE BLANK LINE below a single-line `if(cond){a;b;}` predecessor (lzunit TestCase.construct: if @559,
  blank 560, super @561) is tracked at **prevEndLine + 1** (= 560 = the blank line = its own line − 1), NOT
  at prevEnd (Rule A) and NOT at its own line. Mechanism: the JJTree super tracks at prevEnd+1 for an if-
  block predecessor in BOTH the adjacent case (alert open: if @67-69, super @70 = prevEnd 69 + 1 = its OWN
  line, no visible shift) and the gapped case (lzunit: prevEnd 559 + 1 = 560 ≠ own line 561 → a visible
  −1 shift). Implemented as `ruleAGap = isSuper && prevTriggersQuirk && line === prevEndLine + 2 &&
  prevSingleLineBlockIf` (a NEW predecessor flag `singleLineBlockIf` = else-less `if` whose `.line ===
  .endLine` and `endsBrace`, computed in `statement()`, fold-carried like `superQuirkPredecessor`); when it
  fires, `line = prevEndLine + 1` and it cascades (`dbgLineDelta -= 1`) like Rule A. ⚠️ SCOPED TIGHTLY to
  single-line-block-if + exactly-one-blank-gap (dbg3 has NO such case — a blanket `line >= prevEnd+1`
  relaxation REGRESSED dbg3 @142936). dbg3 UNAFFECTED.
S34-3. **The user `catch`/`finally` clause is line-tracked at its OWN keyword line** (ParseTreePrinter:470/
  473 — `ASTCatchClause`/`ASTFinallyClause` are separate nodes, each `lnum`'d at its source line). MINE was
  rendering `catch(p)BLOCK` / `finally SP BLOCK` with NO clause-level directive (only the body statements
  tracked). Now the parser captures `handlerLine` (the `catch` keyword line) and `finalizerLine` (the
  `finally` keyword line) on the `try` Stmt; the printer wraps the catch/finally clause string in
  `this.lnum(handlerLine/finalizerLine, …)` in debug. Both must be fold-carried (foldStmtInner case "try")
  AND stripScriptVars-carried. lzunit wrapper: `}finally{` @597 → `/* file: #597 */` before `finally`;
  user `try{}catch(e){}` @611 → `/* file: #611 */` before `catch`. (The GENERATED debug try/catch wrapper's
  own `catch ($lzsc$e)` is built separately with NO real line — unaffected.) dbg3 UNAFFECTED (dbg3 has no
  user try/finally with a real-line catch/finally in a tracked context — verified RAW IDENTICAL).

## ⚑⚑⚑ SESSION 33: CORPUS-DEBUG GRIND — 20 → 21 of 78 (lzunit AS3 class-make cracked; 2nd-script + class-three open) ⚑⚑⚑
dbg3 STILL byte-identical (verified after EVERY fix — reverted one Cluster-1 attempt that broke it).
4 fixes landed (RULES S33 below). FLIPPED forced debug-gold parity **286 → 287 ok / 40 → 39 diff / 20
unsup (of 346)** (debug-golds passing = 287 − 266 = 21, +dbg3 = 22 byte-perfect). The headline ok-count
moved +1 (class-inheritance-$26 CLOSED), BUT the big AS3 script-class fix (S33-1) advanced the whole
lzunit/testdriven cluster (~17 files) from @843421 to @846343+ — they're now ALL blocked on the SAME
TWO late issues (the 2nd `<script>` instance multi-statement line-tracking, S33-OPEN-A; and the reg-
directive Cluster 1). Cracking either closes many at once. Regression gate UNCHANGED at 266/0/80
(refusal LIVE), fixtures 96/0/0, debug.mjs 5/5, dbg3 + backtrace exit 3, dbg3 RAW IDENTICAL.

### HOW TO RESUME (S33 → S34): same loop — flip refusal (src/compile.ts ~L1918:
`const debug = isDebugBuild || opts.debug === true; // GRIND FLIP` + comment the refusal `return`),
build, `node harness/batch.mjs check` (expect 287 ok / 39 diff / 20 unsup), `node harness/batch.mjs
show <name>` per divergence. REVERT before handoff (restore `opts.debug === true && isDebugBuild` + the
`if (isDebugBuild && !debug) { return … }`). For a RAW byte-diff that the `show`/visible context hides,
compile `LPS_HOME=…/downloads/ol-4.9.0-servlet node dist/cli.js <src>` (the flip makes it emit debug)
and byte-walk vs the gold AFTER applying the harness `normalize` (frame-order/appbuilddate).

### REMAINING DIFF CLUSTERS (S34 targets)
1. **AS3 2nd-`<script>` instance multi-statement line-tracking (S33-OPEN-A — blocks the whole lzunit/
   testdriven cluster ~17 files @846343+).** lzunit.lzx's SECOND `<script>` (no `when`, → a `lz.script`
   INSTANCE, compileScriptBodyDebug) has `var catchErrors=true; var asynchronousTests=true; canvas.
   runTests=0;` (src lines 58/59/60). GOLD tracks ONLY THE FIRST stripped statement at its real line
   (`#58 catchErrors = true;`) then emits `/* -*- file: -*- */` (a GENERATED reset, filename="") and
   ALL the rest (asynchronousTests, canvas.runTests) at GENERATED locations. MINE now (after S33-2) gets
   catchErrors #58 right but tracks asynchronousTests at its real line #59 (which then collapses to
   NOTHING via the makeTranslationUnits offset path) — so mine is MISSING the `/* -*- file: -*- */`
   before asynchronousTests. ⚠️ UNCRACKED discriminator: WHY are stmts 2..N generated? `rewriteScriptVars`
   (JavascriptGenerator.java:1020) replaces a `var` statement with `new ASTStatement(0)` (line 0 =
   GENERATED) — so ALL rewritten-var assignments SHOULD be generated. But catchErrors (a rewritten var)
   shows #58 (REAL), and canvas.runTests (NOT a var) shows GENERATED. So neither "all vars generated"
   nor "all real" fits. Two conflicting data points → do NOT guess (corrupts the gensym counter). Get the
   JavaCC/ParseTreePrinter line-trace for a script-instance body, OR find a 2nd script with a non-var
   first statement, before wiring. dbg3 SAFE to change (its only `lz.script` is single-statement).
2. **Registration-directive cross-unit line-state (Cluster 1, ~12 files: class-inheritance-$30/$31/$8,
   color-$3, databinding-$10/$28/$29/$9, datapointer-basics, rpc-$15, dynamiccss, debugging-$4, input-
   devices-$7/$10, methods-events-attributes-$12/$20).** The tag-map block `lz["x"] = cls;`×N. GOLD
   (class-inheritance-$30, a canvas-direct app with NO `<debug>` window): emits them ALL INLINE
   (`…},3);lz["debug"] = …;lz["basefocusview"] = …` continuing the prior instance's translation unit, NO
   directives). MINE emits EACH reg as its own pushDebug unit → each with a `#1`,`#2`,… directive.
   ⚠️ I TRIED combining the regs into ONE pushDebug unit (joined annotations) → it REGRESSED dbg3 (846597)
   AND didn't fix $30 (the `\n`-join + first-reg `#1` are still wrong) → REVERTED. The real fix per S31-3
   is the STATEFUL makeTranslationUnits (thread `curLstate`/text-line-count ACROSS top-level statements in
   assembleDebugProgram, so the reg unit continues the LAST instance's line state) — dbg3 keeps directives
   because its regs follow a `<debug>`-window+initDone (file/line jump); $30's regs follow a canvas-direct
   instance (aligned). HIGH dbg3 RISK; needs careful `translateAnnotatedUnit` refactor to a persistent
   line-state object, NOT one-unit-per-reg. The biggest single win but the hardest.
3. **class-three multi-named-child void-slot drop (class-inheritance-$19 @845669, S33-OPEN-B).** `<class
   name="three" extends="two">` with TWO named view children `t`,`y`. GOLD Class.make = `["t", void 0,
   "$lzsc$initialize", …]` — ONLY `t`, NOT `y`! MINE emits BOTH (`["t", void 0, "y", void 0, …]`). Both
   t,y ARE in the `children` mergeChildren array (with `name:` attrs) — only the void-SLOT (instance prop)
   for `y` is dropped. one/two each have ONE named child → ONE slot; three has TWO → only the FIRST slot.
   ⚠️ NodeModel.addProperty (line 1016) `lattrs.put(name, value)` adds BOTH t and y to attrs (LinkedHashMap),
   so the drop is DOWNSTREAM (ClassModel instProp emission). UNCRACKED (1 example, gensym-affecting → do
   NOT guess). Likely a "only the first/last named child of a multi-child class is an instance prop"
   ClassModel rule — find it in ClassModel.java's instance-attr emission. Affects the void-slot count →
   touches the ctor-line + gensym; verify against the passing single-child classes ($20/$21/foo).
4. **Other isolated:** class-inheritance-$26 CLOSED (S33-3). color-$3/$6 (a `#N` directive at a Class.make
   /method boundary — visible context identical, the diff is a directive number; needs RAW byte-walk via
   the flip-compile + normalize). backtrace.lzx (`backtrace: true` feature, refused). databinding-$8
   @932031 (try{}/`req = void 0`).

## RULES CRACKED IN SESSION 33 — DO NOT RE-DERIVE
S33-1. **Script-level AS3 `class` declaration renders a DEBUG Class.make** (CommonGenerator.visit-
  ClassDefinition + the debug method machinery). `compileProgramDebug` (sc.ts) routed `as3class` stmts
  through the production compressed `printAs3Class`; now the new `printAs3ClassDebug` (Printer method)
  emits the instance/static arrays SPACED (`, `) and each METHOD VALUE as the full displayName-IIFE +
  try/catch + `$reportException` debug stream via `renderDebugFuncNode(m.fn, userName, named=true, file,
  m.fn.line)` (userName = method name, or `$lzsc$initialize` for the ctor). The Class.make LEADING source
  directive tracks at the class node's BEGIN line MINUS ONE (`classLine` captured in `classDecl()`, carried
  on the as3class node + through foldStmts; `compileProgramDebug` uses `classLine − 1` for the dir line) —
  the SAME `endLine − 1` quirk as a `<class>` element (lzunit TestFailure: class@17 → `#16`; TestError@41
  → `#40`). Routed via `case "as3class": this.dbg ? printAs3ClassDebug : printAs3Class`. Class-body-
  statement initializer (the `(function($0){with…})` post-make block) is NOT yet handled in debug →
  `ScUnsupported` (no corpus debug file hits it). AS3 instance methods render isMethod=false (no with-
  this) — faithful for the corpus (all use explicit `this.x`); a bare-instance-ref AS3 method would need
  the as3-refinement with-this (not yet seen). dbg3 UNAFFECTED (no script-level AS3 class).
S33-2. **`stripScriptVars` must PRESERVE the debug source-line metadata across the `var`→`expr` rewrite,
  and the script-body lead separator must dedup the `;`.** (a) `stripScriptVars` (sc.ts) built a fresh
  `{s:"expr",…}` for a `var` statement, DROPPING `.line`/`.endLine`/`.file`/`.superQuirkPredecessor` → the
  converted statement fell back to `this.dline` (the script ELEMENT line) instead of its real source line.
  Split into `stripScriptVars` (copies the metadata from the original onto the rewritten node) +
  `stripScriptVarsInner` (the old body). Fixes the 2nd-script FIRST statement to track at its real line
  (lzunit catchErrors → `#58` not `#56`). (b) `compileScriptBodyDebug` hard-coded the hoist→body separator
  as `";\n"`, doubling the `;` when the hoist already ends in `;` (`void 0;;`). Now uses the same `leadSep`
  as compileFunctionDebug (`…endsWith(";") ? "\n" : ";\n"`). dbg3 UNAFFECTED (its script is single-stmt,
  no hoist-then-body). ⚠️ This does NOT fully fix the 2nd-script — stmts 2..N still mis-track (S33-OPEN-A).
S33-3. **A `childOnlyRich` class's `defaultplacement`-target named child does NOT add a trailing void-slot
  ctor line.** S31-5 added `+trailingVoidSlots` (one `var name;` decl line per NAMED child) to the
  child-only synthetic ctor line (`closeLine + 4 + trailingVoidSlots`). But when the named child is the
  `defaultplacement` target, it is referenced via the placement sentinel (`$lzc$class_userClassPlacement`
  in childMaps), NOT declared as a plain `var name;` decl line — so its slot does NOT push the ctor down.
  `defaultPlacementTarget` (the placement attr value — ALREADY a quoted JS literal e.g. `"red"`) is
  captured before deletion; if the LAST emitEntry equals `<dpt>, void 0` / `<dpt>,void 0`, subtract 1 from
  trailingVoidSlots. class-inheritance-$26 container: `red` is the placement → close 4 + 4 + 0 = 8 (not 9).
  Verified the non-defaultplacement named-child cases ($20/$21 `red` → still +1) unchanged. dbg3 UNAFFECTED
  (shadow_bottom/right children are UNNAMED). ⚠️ Only handles the placement target as the LAST void slot
  (the only corpus case); a placement target mid-list would need a per-slot exclusion.

## ⚑⚑⚑ SESSION 32: CORPUS-DEBUG GRIND — 19 → 20 of 78, but ~35 files ADVANCED to the trailer ⚑⚑⚑
dbg3 STILL byte-identical (verified after every fix). 4 fixes + 1 harness fix landed (RULES
S32 below). Forced debug-gold parity **19 → 20 ok / 41 → 40 diff / 18 unsup (of 78)** (+dbg3
= 21 byte-perfect). The headline ok-count moved only +1, BUT the two STRUCTURAL fixes
(S32-1 global order, S32-2 shared dedup) advanced ~30 files' first divergence from the
MID-file (170K–231K) to the **trailer region (843K–855K)** — i.e. most remaining diffs are
now blocked on the SAME 2 late clusters (registration-directive + AS3 script-class), so
cracking those should CLOSE many files at once. Regression gate UNCHANGED at 266/0/80
(refusal live), fixtures 96/0/0, debug.mjs 5/5, dbg3+backtrace exit 3.

### HOW TO RESUME (S32 → S33): same loop — flip refusal (src/compile.ts ~L1902:
`const debug = isDebugBuild || opts.debug === true;` + comment the refusal `return`), build,
`node harness/batch.mjs check` (expect 286 ok / 40 diff / 20 unsup), `node harness/batch.mjs
show <name>` per divergence. REVERT before handoff. The `show` execFileSync now has
maxBuffer 128M (S32 harness fix — was ENOBUFS on >850KB output).

### THE REMAINING DIFF CLUSTERS (S33 targets) — almost ALL now in the 843K–855K trailer
1. **Registration-directive cross-unit line-state (BIGGEST, ~15 files: class-inheritance-
   $8/$19/$26/$30/$31, color-$3/$6, databinding-$10, methods-events-attributes-$12/$20,
   rpc-$12/$15, performance-tuning-$1, input-devices-$7/$10, dynamiccss, debugging-$4).**
   The tag-map block `lz["x"] = cls;` ×N. GOLD (class-inheritance-$30) emits them ALL INLINE
   with NO directives (`…},3);lz["debug"] = …;lz["basefocusview"] = …` continuing the prior
   instance's translation unit); MINE emits EACH as its own unit with a leading `/* -*-
   file: <app>.lzx#1 -*- */`, `#2`, … directive (the S30-6 dbg3 behavior — which is RIGHT
   for dbg3 but WRONG here). The discriminator is makeTranslationUnits line-continuity from
   the PREVIOUS top-level statement's end. dbg3 has a `<debug>` window + initDone between the
   last instance and the regs (so regs get directives); class-inheritance-$30 has the regs
   directly after a canvas-direct instance (so they're INLINE). FIX = thread `curLstate`
   across top-level statements in `assembleDebugProgram` (src/debug.ts) so makeTranslationUnits
   is STATEFUL per the oracle's persistent SCompiler, not per-unit-fresh. ⚠️ HIGH dbg3 RISK —
   dbg3's reg directives must survive; guard so the stateful path reproduces dbg3 exactly.
2. **AS3 script-class debug rendering (~12 files: lzunit-$1..$5, testdriven-1..10 @843369–
   843463).** lzunit.lzx `<script when="immediate">` has `public final class TestFailure {…}`.
   GOLD: debug-spaced `Class.make("TestFailure", ["test", void 0, …, "$lzsc$initialize",
   (function () {…` + `#16` directive. MINE: COMPRESSED `Class.make("TestFailure",["test",…,
   function($0,$1){…` + `#17`. `compileProgramDebug` (sc.ts) doesn't render script-level
   `class` decls in debug form. A real feature (Class.make + IIFE method wrappers + try/catch
   + per-member directives), NOT a line-tracking tweak.
3. **Super block-then-control-tail sub-rule (datapointer-creating-node @170785, data-
   accessing-lzdataelement @231551).** Both have a super dispatch after `if(cond){ if/else-if }`
   (else-less outer if, BLOCK then, last nested = a control stmt). GOLD FIRES Rule A (super
   tracks at the predecessor's `}` line + rewind directive); MINE suppresses (predecessor-
   TriggersRuleA case ii). BUT baseformitem `init` (ALSO block-then control-tail) correctly
   SUPPRESSES. ⚠️ Discriminator UNCRACKED: baselistitem dataBindAttribute's inner control is
   an if-WITH-else with NON-block branches (`if(attr=='text')…; else if(attr=='value')…;`);
   baseformitem init's inner is an else-less if with a BLOCK then (`if($debug){…}`). Two
   conflicting examples — do NOT guess a rule (high dbg3 risk); get the JavaCC trace or more
   examples first. Low priority (2 files).
4. **databinding-$8 @932031** (a try{} / `req = void 0` issue — advanced past the S32-3/-4
   fixes; inspect with `show`). **backtrace.lzx @20810** — `backtrace: true` feature (cluster 3,
   1 file, currently refused). Other isolated: methods-events-attributes, color-$6, rpc-$12.

## RULES CRACKED IN SESSION 32 — DO NOT RE-DERIVE
S32-1. **Global-declaration order = oracle's getLibraries → app-tree → explicit-include.**
  `ToplevelCompiler.computePropertiesAndGlobals` emits `var X=null;` in 3 tiers: (0) the
  sorted autoincludes + debugger (getLibraries), (1) the app's OWN tree via
  `computeDeclarations` (which does NOT follow explicit `<include>`s), (2) explicit
  `<include>` libraries via the `collectObjectProperties` child-loop. Mine pushed globals in
  instance-WALK order, placing an explicit include's globals at its document position (BEFORE
  a later app child like a named `<button>`). FIX (src/compile.ts): `orderGlobals` does a
  STABLE cat-sort — cat 0 = `origin ∈ AUTO_ORIGINS`, cat 1 = `origin == sourceId`, cat 2 =
  else. `AUTO_ORIGINS` is populated by a new `recordOrigins` param threaded through
  `expandIncludes`, set ONLY from `expandAutoincludes` + `spliceDebuggerLibrary` (NOT the
  app-root expansion). `globalOrigins[]` is parallel to `globals[]` (pushed at the id/name/
  dataset sites). testdriven-2: `tp,tooltipview` (auto) → `goButton` (app) → `readout,
  lzunitControlPanel` (explicit lzunit). dbg3 unaffected (its globals are already cat-ordered:
  debugger then app, so the stable sort is a no-op).
S32-2. **SHARED include dedup across the auto-prefix and the debugger splice.** `expand-
  Autoincludes` built its prefix with a FRESH local `seen` and never shared it, so
  `spliceDebuggerLibrary` (using the caller's `seenIncludes`) RE-pulled a library the
  autoincludes already emitted — `base/colors.lzx` (via `base/style.lzx`) double-emitted its
  `lz.colors.X = …` block. The oracle's `computePropertiesAndGlobals` dedups every library
  pass via ONE `visited` set. FIX: after the canvasContent partition (which needs `seen` to be
  JUST the auto-prefix libs), `for (const id of seen) _seen.add(id)`. HUGE reach — advanced
  ~30 files from mid-file to the trailer. dbg3 unaffected (its autoincludes don't pull colors;
  only the debugger does, once).
S32-3. **Rule-A super-quirk: an else-less `if` with a NON-block then suppresses ONLY when
  MULTI-line.** `predecessorTriggersRuleA` (src/sc.ts) returned false for ANY `if(cond) <stmt>`
  non-block then. REFINED: return `then.line === s.line` — a SINGLE-line `if(c) expr;`
  (`_internalinputtext` construct: `if(parent['multiline']!=null) args.multiline=parent.
  multiline;` then `super.construct(parent,args)` on the next line) FIRES (super tracks at the
  if's line + rewind directive); a MULTI-line if (baseformitem `destroy`: `if(p)\n  p.remove();`)
  still suppresses. dbg3 UNCHANGED.
S32-4. **Magic-const under unary `!` stays a RUNTIME ref.** `foldNode` case `"unary"` folded
  the operand (`$dhtml`→true) then `!true`→`false`. Per S30-5 magic consts fold ONLY as a bare
  if/?: ASTIdentifier test, never as an operand (incl. a unary operand). FIX: guard the operand
  like the `logic` case's `foldOp` — `(n.e.k==="id" && isMagicConst(n.e.name)) ? n.e :
  foldNode(n.e)`. databinding-$8 `lz.XMLHttpRequest.open`: GOLD `… && !$dhtml`, MINE was `… &&
  false`. dbg3 UNCHANGED (no `!$magic` in dbg3, else it'd already diverge).
S32-H. **Harness:** `batch.mjs show` execFileSync now `maxBuffer: 128*1024*1024` (was ENOBUFS
  on >850KB debug output, blocking `show` on datapointer-creating-node / data-accessing-*).

## ⚑⚑⚑ SESSION 31: CORPUS-DEBUG GRIND STARTED — 0 → 19 of 78 debug golds byte-identical ⚑⚑⚑
dbg3 is the proving ground (still byte-identical); SESSION 31 began grinding the OTHER
78 corpus debug golds. **FORCED debug-gold parity 0 → 19 ok / 41 diff / 18 unsup (of 78)**
(+dbg3 = 20 byte-perfect debug builds). 7 fixes landed (RULES S31 below).

### ⚠️ CORRECTED BASELINE — the old "263/0/83" was STALE (pre-S30 regen-debug)
The `.goldcache` actually holds **78 debug golds** (not 83) + **268 production golds**.
With the refusal LIVE, `node harness/batch.mjs check` = **266 ok / 0 diff / 80 unsup**
(80 = 78 debug refused + 2 PRE-EXISTING production real-unsup: `databinding-$7`
"function declaration in script context", `richtext-$2` "<interface> instance with
methods" — both unrelated to debug, fail on features never ported). **This is the
correct regression gate now — use 266/0/80, NOT 263/0/83.** The 0 diff + fixtures
96/0/0 prove no production regression; the ok-count rose only because the goldcache
has fewer debug golds than the stale doc claimed. `compileroptions="debug: true…"`
(e.g. `backtrace.lzx`) is now ALSO refused (it's a debug build the `debug="true"`
check missed — it was silently miscompiling as production).

### HOW TO RESUME (S31 → S32): flip refusal, work the 41 diffs
Same loop as before: temporarily flip the refusal (`src/compile.ts` ~L1898:
`const isDebugBuild = …` block — change to `const debug = isDebugBuild || opts.debug
=== true;` and delete/comment the refusal `return`), `npm run build`, `node
harness/batch.mjs check`. With the flip, expect ~285 ok / 41 diff / ~18 unsup.
`node harness/batch.mjs show <name>` for a single divergence. **REVERT the flip
before committing** (refuse-don't-miscompile). The forced-parity count is measured
WITHOUT flipping via the `/tmp/forced.mjs`-style harness (LZC_DEBUG_FORCE=1 per gold).

### THE 3 REMAINING DIFF CLUSTERS (S32 targets, in rough priority)
1. **Registration-directive cross-unit line-state** (class-inheritance `$19/$20/$21/
   $26/$29/$30/$31/$7`, color-$3, custom-components-$1, databinding-$10, …). The tag-map
   block (`lz["x"] = cls;` ×N) and the trailer scripts are emitted by the oracle as ONE
   `compileScript` with NO #file directive, INHERITING the file context of the last
   top-level statement. MINE renders each registration as its OWN translation unit (each
   forced to emit a leading directive). GOLD sometimes emits NO directives at all
   (class-inheritance-$30: `…},3);lz["debug"]=…;lz["basefocusview"]=…` inline, no dirs)
   and sometimes one-per-line (canvasversion: `debugger/debugger.lzx#1,#2,…`). The
   discriminator is the makeTranslationUnits line-continuity from the PREVIOUS statement's
   end (file+line). To crack: thread `curLstate` ACROSS top-level statements in
   `assembleDebugProgram` (debug.ts) — i.e. make makeTranslationUnits stateful per the
   oracle's persistent SCompiler, instead of per-unit-fresh. RISK: could shift dbg3 — guard
   carefully (dbg3 currently works with per-unit-fresh, so the threaded state must reproduce
   dbg3's directives exactly). This is the BIGGEST cluster (~15+ files).
2. **lzunit / testdriven cluster** (~14 files: lzunit-$1..$5, testdriven-1..10). TWO issues:
   (a) **AS3 script-class debug rendering** — lzunit.lzx has `<script when="immediate">`
   with `public final class TestFailure {…}` (AS3 class decls). MINE emits the source
   directive (debug path) but renders the class body COMPRESSED (`function($0,$1){…}` not
   the spaced debug `function  (…)` + try/catch). `compileProgramDebug` (sc.ts) doesn't
   handle script-level `class` declarations in debug form. (b) **Global var ordering** —
   `var X = null` order: GOLD = app globals BEFORE library globals (testdriven-2: goButton
   then readout/lzunitControlPanel); MINE reverses. The globals are pushed in buildNode
   (compile.ts ~L1078 id / ~L1183 name) — the lib-included instances' globals are pushed
   before the app's. Need to match the oracle's addId/addGlobal document order.
3. **backtrace.lzx** — `compileroptions="debug: true; backtrace: true"`. Needs (a)
   compileroptions→debug parsing (DONE for the refusal) and (b) the `backtrace: true`
   feature (debugBacktrace=true → the try/catch+$reportException wrapper is ALWAYS added,
   JavascriptGenerator:1277, even for non-dereferenced/free-empty bodies). A real feature;
   currently refused. Low priority (1 file).

Other isolated diffs: databinding-$8/$9/$28/$29, methods-events-attributes-$12/$20,
rpc-$12/$15, datapointer-basics/creating-node, data-accessing-lzdataelement,
debug-mon-trace, debugging-$2/$4, dynamiccss, input-devices-$7/$10, performance-tuning-$1,
color-$6, program-development-$16, readonly, debuglevel — inspect each with `show`.

## RULES CRACKED IN SESSION 31 — DO NOT RE-DERIVE
S31-1. **Debug source-location FILE = `Parser.getUserPathname`** (the SHORTEST "/"-segment
  path relative to a search-path dir: [app-file parent (canonical), components, fonts, LFC]).
  App file → its basename (`browser-integration-$19.lzx`); library files → component-relative
  (`base/colors.lzx`, `utils/layouts/simpleboundslayout.lzx`). Ported faithfully in
  `node-io.ts` (`getUserPathname` + `adjustRelativePath` + `normalizePath` + `splitJ` keeping
  empty tokens). dbg3 keeps `/tmp/dbg3.lzx` because `/tmp` is a SYMLINK → `/private/tmp`: the
  app file's non-canonical sourceDir (`/tmp`) ≠ basePathnames[0] = canon(parent) (`/private/tmp`),
  so the relativized `../../tmp/dbg3.lzx` is LONGER and loses. App file uses its AS-GIVEN path
  (symlink quirk preserved); library files use `canon(id)`.
S31-2. **The canvas's OWN anon class is a debug `Class.make` emitted BEFORE `canvas = new`.**
  When the `<canvas>` has handlers/methods it becomes `$lzc$class_mN`. The PRODUCTION path
  inlines it (`canvasAnonDef` raw prefix); the DEBUG path was DROPPING it entirely. Now
  `emitAnonClassDebug(canvasClass, "LzCanvas", "canvas", built.methodEntries, null, built)`
  with the synth node given the canvas's `line`/`endLine` (classLine = endLine−1 = 0 for a
  line-1 canvas). Inserted into `allStmts` between the globals and the `canvas = new …` line.
  Also: the canvas `$delegates` value must be spaced in debug (`COMPILE_DEBUG ? ", " : ","`).
S31-3. **The tag-map registration block + trailer scripts INHERIT the last top-level
  statement's file context** (`regFile = lastTopFile`, NOT always `debugFile(root)`).
  ToplevelCompiler.outputTagMap emits ONE `compileScript` of `lz["x"]=cls;\n…` with no #file,
  so it inherits the file left by the last instance (app file) or last class (e.g.
  `debugger/debugger.lzx` when there are NO canvas instances — canvasversion). Tracked via
  `lastTopFile`, updated at every class push (emitClassDef ~L2693) and instance push (~L2813).
  ⚠️ This only fixes the FILE; the per-registration DIRECTIVE-vs-no-directive cross-unit
  behavior (cluster 1 above) is STILL unmodeled.
S31-4. **`<debug>` element → `new $lzc$class_LzDebugWindow(canvas, {…}.attrs)` trailer, NOT a
  view instance** (DebugCompiler.compile renames `<debug>`→`LzDebugWindow`, builds asMap, and
  STORES the script for the trailer in place of `Debug.makeDebugWindow()`). The `<debug>` attrs
  (x/y/height, sorted) become the instance attrs. In the loop, `<debug>` is skipped (builds the
  node-map for gensym ordering, stores `debugWindowScript`). The stored script's source ends
  `;\n`, so the following `canvas.initDone()` continues in the SAME translation unit with NO
  directive — UNLIKE `Debug.makeDebugWindow()` (each its own one-line addScript → each carries a
  directive). So: user-debug → push `debugWindowScript + ";canvas.initDone()"` as ONE unit;
  default → push makeDebugWindow + initDone as TWO units.
S31-5. **child-only-rich class ctorLine adds `trailingVoidSlots`** (one `var name;` decl per
  NAMED child). S29-3's `lastChild.closeLine + 4` undercounts when the child is named: foo's
  `<view name="red"/>` → +1 → ctor 8 (= closeLine 3 + 4 + 1). shadow_bottom's children are
  UNNAMED → +0 → 128 (unchanged).

## ⚑⚑ SESSION 30: dbg3.lzx is BYTE-FOR-BYTE IDENTICAL (850579 = 850579) ⚑⚑
The forced-debug compile of `/tmp/dbg3.lzx` now matches the gold **byte-for-byte,
end-to-end** (`LZC_DEBUG_FORCE=1 node harness/batch.mjs dbgshow /tmp/dbg3.lzx` →
`RAW IDENTICAL`). Frontier 790521 → 850579 (DONE) via 6 fixes (RULES S30-1…S30-6).

### ⚠️ CRITICAL FINDING — dbg3 parity does NOT equal "all 83 debug builds pass"
The DoD assumed grinding dbg3 to parity would make the 83 corpus debug builds compile
clean. **FALSE.** I regenerated all 78 corpus debug golds with the fixed oracle
(`node harness/batch.mjs regen-debug` — new harness mode I added; 78 changed, 0 fail)
and TEMPORARILY flipped the refusal: result was **263 ok / 57 DIFF / 26 unsup**, i.e.
57 MISCOMPILES. dbg3 exercised one program's constructs; the other 78 corpus debug
builds have their OWN remaining divergences. Observed classes when flipped:
  - **57 diff**: e.g. file-path directives (`/* -*- file: <ABSOLUTE PATH> -*- */` mine
    vs relative `databinding-$10.lzx` / `utils/layouts/simpleboundslayout` gold —
    DEBUG_FILE/origin mapping for corpus files differs from dbg3's `/tmp/dbg3.lzx`);
    a missing `{`+directive structural case (databinding-$28/$29 @216245); a
    first-statement-super `#10` directive (databinding-$8 @209571).
  - **18 `parse: expected id, got . '.'`** — a JS parse gap hit only by some debug bodies.
  - **6 `unknown tag <debug>`** — debug builds with a user `<debug>` window element
    (buildNode has no `<debug>` tag; the refusal currently masks these).
  - **2 `spawnSync node ENOBUFS`** — harness maxBuffer too small for >850KB output
    (raise the check's execFileSync maxBuffer; not a real compile failure).
  57+18+6+2 = 83. So: **I REVERTED the flip** — the production `debug="true"` refusal
  is LIVE again (263/0/83 restored, exit 3). Flipping with 57 miscompiles would
  VIOLATE refuse-don't-miscompile. The regenerated (fixed-oracle) golds are KEPT in
  `.goldcache` (correct, and needed for grinding the rest). DoD (346/0/0) now means:
  grind these 78 corpus debug builds to byte parity — a multi-session effort. dbg3 is
  the proving ground but NOT the whole corpus.

### HOW TO RESUME THE CORPUS-DEBUG GRIND
Flip the refusal temporarily (src/compile.ts ~L1894: `const debug = opts.debug ===
true && …` → `root.attrs["debug"] === "true" || opts.debug === true`, delete the
refusal block), `npm run build`, then `node harness/batch.mjs check` and work the
57 diffs (and the 18 parse / 6 `<debug>` / 2 ENOBUFS unsup) the same way as dbg3:
`batch.mjs show <name>` for the first divergence, fix, re-check. Production stays
263/0. KEEP the refusal reverted-to-live in committed state until 346/0/0 is real.
Likely first targets: the DEBUG_FILE/origin path mapping for corpus files (the
absolute-vs-relative `/* -*- file: -*- */` divergence dominates the 57), then the
`<debug>` tag, then the `parse: expected id, got .` body case.

## RULES CRACKED IN SESSION 30 (790521 → 850579 = DONE on dbg3) — DO NOT RE-DERIVE
S30-1. **A super call is NOT a dereference** (`ASTSuperCallExpression` ≠ `ASTCall-
  Expression`, VariableAnalyzer.java:122/159). `computeDereferenced` (src/sc.ts) now
  recognizes a super-call node (`isSuperCallExpr`) and visits ONLY its arguments, never
  marking `dereferenced`. So a pure-super-dispatch body (`super.init()`) is not
  dereferenced and (super marks this/arguments USED, not free) has empty `free` → the
  debug try/catch + `$reportException` wrapper is SKIPPED (JavascriptGenerator:1277
  `dereferenced || !free.isEmpty()`). `with(this)` also drops (possibleInstance=free=∅).
  GOLD LzDebugWindow.init = bare `function () { (super-dispatch).call(this) }`.
S30-2. **First-statement super in an UNWRAPPED body tracks at the function `{` line.**
  When a method body has NO wrapper (`Printer.dbgNoWrapper`, set by compile/renderDebug-
  FuncNode iff `!needTry && lead.length===0`), the super is the direct first child and
  its textual predecessor is the function's source `{` on `this.dline` (funcLine).
  joinStmtsInner initializes `prevEndLine = this.dline`, `prevTriggersQuirk0 = true` so
  Rule A fires for a first-stmt super on funcLine+1 → tracks at funcLine. (init: `<method>`
  @154, bare `super.init()` @155 → 154.) A WRAPPED body's super follows the generated
  `try {` brace → keeps its own line (basecomponent construct @129, funcLine 128 → 129;
  basecomponent init @145, funcLine 143 → 145 — not adjacent anyway, CDATA line between).
S30-3. **`in` operator: printer-only assignment-level precedence.** `in` is PARSED at
  relational precedence (BINPREC=9, used by the parser) but the oracle's ParseTreePrinter
  moved it to the ASSIGNMENT row for PAREN decisions ("compensate for SWF9 3rd-party
  precedence bug", ParseTreePrinter.prec:744). So `prec()` and the bin-print parent-prec
  return 1 (assign level, below `||`=3) for `in` only — `! (("x" in args) || …)` gets the
  inner parens. BINPREC unchanged (parser unaffected). The ONLY `in`-as-operand case in
  the gold: debugger objToString `lzconsoledebug`.
S30-4. **makeBlock elides the trailing `;` TWICE** (ParseTreePrinter.makeBlock:162 then
  166). A switch body whose last clause is `…break;` + the debug clause-level OPTIONAL_SEMI
  (`;`) = `…break;;` → double-elide → bare `break`. No-op for ordinary one-`;` blocks.
  (src/sc.ts Printer.makeBlock: `"{" + NL + elideSemi(elideSemi(body)) …`, trailing-NL
  `}`-check uses the SINGLE-elided body.)
S30-5. **Magic compile-time constants fold ONLY as a bare if/?:/directive TEST.** `$debug/
  $as3/$as2/$swf*/$dhtml/$js1` fold to a literal (case "id") for if-test/ternary-condition
  dead-branch elimination (evaluateCompileTimeConditional requires an ASTIdentifier; the
  oracle does NO boolean constant folding). As a DIRECT `&&`/`||` OPERAND they stay runtime
  refs — `case "logic"` keeps a bare magic-id operand unfolded (no short-circuit). `$as3 ||
  X` is the ONLY surviving magic ref in the whole gold ($as3×1, $as2/$debug/$swf9×0).
  `isMagicConst` helper in src/sc.ts.
S30-6. **Debug main-app trailer** (DHTMLWriter:473-488). The class registrations
  (`lz["name"] = $lzc$class_name`, spaced `= ` in debug) are synthetic statements in the
  APP file at SEQUENTIAL lines 1,2,3,… (one per registration). Then, unless the source has
  its own `<debug>` element, `Debug.makeDebugWindow()` at app-file `#1`, then
  `canvas.initDone()` at `#1` (both `addScript` one-line synthetic sources). (src/compile.ts
  DEBUG_STMTS trailer ~L2808.)

## CURRENT FRONTIER (dbg3 = DONE; corpus-debug grind is the remaining work)
**dbg3.lzx @byte 850579 = 850579 — RAW IDENTICAL.** (Historic per-session frontier below.)
**@byte 790521** (SESSION 29: 651456 → 790521, +139065 B, 6 fixes — see RULES S29 below).
STOP POINT = the debug **try/catch wrapper is emitted unconditionally** by my method/
function rendering, but the oracle SKIPS it for a body that (after $debug/$as2 folding) has
NO dereference AND NO free reference. `LzDebugWindow.init` (debugger.lzx#154) folds to just
`super.init()`; GOLD emits `function () { (super-dispatch).call(this) }` with **no try/catch**,
MINE wraps it. THE RULE (JavascriptGenerator.java:1277): the wrapper is added iff
`debugBacktrace || analyzer.dereferenced || !free.isEmpty()` (debugBacktrace is off). And
`analyzer.dereferenced` (VariableAnalyzer.java:156) = the body contains ANY `ASTProperty*Reference`
(member `.x` / index `[x]`) OR `ASTCallExpression` — but a **super call is `ASTSuperCallExpression`,
NOT `ASTCallExpression`**, so `super.init()` is NOT a dereference; `super` only marks `this`/
`arguments` USED (not free). So a pure-super-dispatch body → not dereferenced, free empty → NO
wrapper. NEXT: in `renderDebugFuncNode`/`compileFunctionDebug`/`compileMethodDebug` (src/sc.ts),
compute `needsWrapper = bodyDereferenced(foldedBody) || !free.isEmpty()` (free already available
via `analyzeScope`; add a `bodyDereferenced` walk: true on any member/index node or non-super
call). When false, emit `function (params) { <body> }` with NO try{}/catch/$reportException and
NO leading `/* file: -*- */` gen reset (GOLD goes straight `function () {` → `#154` directive →
super). Match the oracle's free-set semantics carefully (this/arguments/super not free) — risk
of over/under-wrapping; the frontier + 263 check are the safety net. (Earlier this session:
@778546 child-only-class ctor RESOLVED S29-3; @778569 super `if`-shift + @790521 cascade
RESOLVED S29-5/S29-6.)

## RULES CRACKED IN SESSION 29 (651456 → 790521) — DO NOT RE-DERIVE
S29-1. **Member-less class ctorLine counts the `children` + class-alloc statics.** A
  member-less class's synthetic `ScriptClass.toString` maps generated line G → source
  endLine + (G−1); the ctor sits after `dynamic class X {` (gen 1) + all static class
  attributes. The base `classLine + 4` (= endLine+3) only covers the 2 always-present
  statics (tagname/displayName + attributes); add `(childrenJs ? 1 : 0) + classAllocEntries.
  length` (the `children` static when the class declares/inherits children, + class-alloc
  attrs) — exactly the state-class `extraStatic`. (sliderthumb inherits children → +1 →
  endLine+4 = 74.) src/compile.ts emitClassDef member-less branch (~L2667).
S29-2. **Named member-rich class: when the LAST code member is an always-constraint, the
  ctorLine uses `finalSourceLine(depsBody)` not crude `close+5`.** The crude `lastMemberClose
  + (handler?6:5) + trailingVoidSlots` works for method/handler/setter last-members but
  UNDER-counts a constraint, whose unfolded `$debug` deps body spans several source lines.
  Track `lastMemberConBody`/`lastMemberConSrcLine` (= `cc.lastBody`/`cc.lastSrcLine` from
  `compileConstraintDebug`) at the constraint call site, cleared by any later non-constraint
  `noteMember`. When set: `ctorLine = finalSourceLine(srcDirective(file, conSrcLine) + conBody
  + END_SRC_DIRECTIVE + "\n}") + 1 + trailingVoidSlots` — the SAME machinery as the anon path
  (emitAnonClassDebug). slidertrack: showfill deps from #50 → finalSourceLine 58, +1+4 = 63.
S29-3. **A child-only class (own view children, no code member) is member-RICH (plain ctor).**
  Its ctor inherits a generated-file context at `lastOwnChild.closeLine + 4` (the trailing
  `attributes` static + the ctor structural span). `childOnlyRich = !stateClass && lastMemberClose
  < 0 && childNodes.length > 0` → memberRich=true, `ctorLine = lastOwnChild.el.closeLine + 4`.
  debugger shadow_bottom: last `<view>` closes @124 → 128; shadow_right @137 → 141.
S29-4. **`debugConstructorPlain` carries a self-adjusting leading generated reset.** Inserted
  `annoFileLine(null, 0)` right after `(function () {\n`. It renders `/* -*- file: -*- */`
  ONLY when the file context before the ctor is a real source file (the child-only case, where
  the ctor is the FIRST instance prop and follows the class directive); when a preceding code
  member already reset to generated (its forceBlankLnum), the annotation collapses to nothing,
  so constraint/method-rich plain ctors are byte-unchanged. (src/debug.ts.)
S29-5. **Super `if`-shift.** Rule B (the −1 shift of the statement after a SHIFTED super) was
  expr-only; an `if` after a shifted super shifts too. Subsumed by S29-6.
S29-6. **Super-shift Rule B is CASCADING, not single-successor.** When a super call is shifted
  up one line (Rule A), the JJTree re-parse consumes a line in the lexer stream, so EVERY
  subsequent source line in the SAME function body — at any nesting depth — tracks one lower.
  Implemented as a Printer-scoped `dbgLineDelta` (src/sc.ts) applied in `lnum`, set `-=1` after
  a Rule-A super, replacing the old per-statement expr-only Rule B. It cascades into nested
  BLOCKS (shared Printer via joinStmts recursion) but NOT nested function expressions (each gets
  a fresh Printer → delta starts at 0). debugger.lzx bottom `<setter name="height">`: super
  shifted 804→803, then `if (parent.isLoaded)` 805→804 AND its body `updateDisplay()` 806→805.
  Verified the prior expr cases (addSubview this.update 29→28, reverselayout this.reset 45→44).

## HARD DISCIPLINE (never violate)
- The production `debug="true"` refusal STAYS LIVE; the forced flag is DEV-ONLY.
- The baselines below are a REGRESSION GATE you run **after a change**, NOT a startup
  ritual. The tree is frozen across sessions (nobody edits it on `/clear`), so the
  recorded numbers (this header / progress.log) still hold — re-proving them at startup
  just burns minutes (diff.mjs launches the JVM oracle ~99×, check runs 346 compiles).
  At session start: `npm run build` ONLY (fast; confirms the tree compiles + toolchain
  is alive). Run the full gate after each batch of edits — they must hold, no regressions:
  - `npm run build`
  - `node harness/diff.mjs fixtures/*.lzx`  → **96 ok, 0 diff** (of 99)
  - `node harness/batch.mjs check`          → **266 ok, 0 diff, 80 unsup** (of 346)
    (CORRECTED baseline as of S31 — see the S31 CORRECTED BASELINE note; the old
    "263/0/83" was stale. 80 unsup = 78 debug refused + 2 pre-existing prod unsup.)
  - `node harness/debug.mjs`                → **all debug-pipeline tests passed** (5/5)
  - `node dist/cli.js /tmp/dbg3.lzx >/dev/null 2>&1; echo $?` → **3** (refusal live)
  - `node dist/cli.js <backtrace.lzx> ; echo $?` → **3** (compileroptions debug refused)
- A forced-debug dbgshow diff is EXPECTED progress. A PRODUCTION diff (any of the
  above regressing) is a VIOLATION — fix or revert before doing anything else.
- After each frontier advance, append ONE line to `progress.log` (see PROTOCOL).

## WORKING LOOP
1. `LZC_DEBUG_FORCE=1 node harness/batch.mjs dbgshow /tmp/dbg3.lzx 2>&1 | sed -n '/RAW first divergence/,$p' | head -28`
   to see the GOLD-vs-MINE context at the divergence.
2. Identify the construct. Find the matching rule below OR reverse-engineer from the
   Java oracle source (paths below). Extract the exact gold fragment by a UNIQUE
   STRING (a class/displayName), NOT by byte offset (the dbgshow offset is in the
   appbuilddate-normalized stream and won't align with raw gold offsets):
   `node -e 'const g=require("fs").readFileSync("modern-build/oracle/out/dbg3.dhtml.js","utf8"); const i=g.indexOf("UNIQUE"); console.log(JSON.stringify(g.slice(i-50,i+400)))'`
   (run from repo root, or use an absolute path). To extract MINE, compile with
   `LPS_HOME=/Users/temkin/Code/OpenLaszlo/downloads/ol-4.9.0-servlet LZC_DEBUG_FORCE=1 node dist/cli.js /tmp/dbg3.lzx`.
3. Make the smallest faithful fix. Rebuild, run ALL baselines, confirm the frontier
   advanced and didn't regress. Log it. Repeat.

## STOP / HANDOFF PROTOCOL
- STOP when EITHER: (a) the frontier hits 850579 with 0 divergence → do the DoD
  steps above; OR (b) you've made ~6–10 fixes / done substantial work / context is
  getting heavy. Do NOT grind your context to exhaustion — hand off while sharp.
- Before returning: (1) update the CURRENT FRONTIER + STOP POINT + RULES sections of
  THIS file with everything you learned; (2) append a final `progress.log` line
  beginning `HANDOFF:` (or `DONE:` if complete) with the frontier byte; (3) leave the
  tree GREEN (all baselines passing, refusal live, build compiles).
- `progress.log` line format (use `date +%H:%M:%S` for the stamp):
  `<HH:MM:SS> @<byte> | <one-line what changed> | base 96/263/5 exit3 OK`
  Write a line after each advance AND a `HANDOFF:`/`DONE:` line at the end.
- Your RETURN MESSAGE (to the orchestrator, not the user): frontier start→end, the
  fixes you landed, baseline status, and DONE vs HANDOFF.

## THE STOP POINT @byte 583428 — RESOLVED by the oracle bug-fix (see MAJOR CHANGE above)
The entire 2-case setter anomaly below — and the FALSIFIED-hypothesis saga — turned
out to be the stock-oracle #line buffer bug. Fixed at the oracle (not reproduced).
The historical analysis is kept below for reference but is NO LONGER ACTIONABLE.

### (history) THE STOP POINT @byte 583428 — first-constraint SETTER body line, a 2-case anomaly
GOLD `window.lzx` `wcontent` (anon `$lzc$class_mal`)'s `bgcolor` constraint SETTER body
(`var $1 = classroot.content.bgcolor;`) tracks at `lz/window.lzx#53`; MINE at `#54`. The
setter body is currently base-lined at `srcLine` (= the element's endLine, RULE 8) inside
`compileConstraintDebug` (src/compile.ts ~L471, `compileFunctionDebug(... srcLine, srcLine)`).
GOLD wants it ONE LOWER (= classLine = endLine−1).

KEY FINDING (verified, NOT yet implemented because the closed-form discriminator eluded me):
Across the WHOLE dbg3 gold there are exactly **TWO** constraint setters whose BODY line !=
their catch/`$reportException` line (= endLine). Both have body = endLine−1 = classLine:
  - `lz/window.lzx` wcontent `bgcolor` (el.line=53, endLine=54, attr@54 → body 53)
  - `debugger/debugger.lzx` `controls` `width` (el.line=672, endLine=672, attr@672 → body 671)
Every OTHER constraint setter (194 of 196) has body = endLine. (Scan: regex over gold,
`try {\n/* file F#B */\nvar $1 = ` then the next `$reportException("F", C)`; B==C for all
but those 2.) Likewise for DEPS bodies: the only deps body != header+1 corpus-wide is
mdcontent `$m8k` (S26-1) — so deps + setter anomalies are BOTH essentially single-element.

The off-by-one is `body = classLine` instead of `endLine` for those two elements only.
I could NOT find a closed form that fires for EXACTLY those two and no others. Data dump
(LZC_TRACE_SETTER2-style, first constraint per element): firing needs (con-attr ON endLine).
But that over-fires badly: e.g. `debugger#730` `<view name="middle" options=… width="${}"
pixellock>` has width@730==endLine yet body=endLine (NO fire); `debugger#817`/`#892`,
windowpanel#251, button#157 all have a constraint on endLine yet body=endLine. Candidate
extra predicates tried and FALSIFIED: "con is first non-name attr" (controls yes, but
wcontent's bgcolor is NOT first non-name yet fires); "el.line<endLine OR con-is-first-non-
name" (over-predicts ~27, only 2 fire). The two firing elements are ASYMMETRIC (controls'
constraint IS the first non-name attr and the tag is single-line per my parser; wcontent's
is the LAST attr and the tag is multi-line) — so a syntactic per-element rule seems wrong.

LIKELY MECHANISM (per the S26-1 note): this is CUMULATIVE source-line drift in the oracle's
re-lexing of the concatenated ScriptClass/Class.make text — NOT a per-attribute srcloc. The
Class.make directive sits at classLine; for these two elements the first setter body's
emitted directive does NOT advance past classLine (stays), whereas normally it advances to
endLine. To crack: NEXT AGENT should look at the PRECEDING instance in document order and
the exact `beginSourceLocationDirective`/line-counter state the oracle carries INTO this
Class.make (CompilerUtils + ScriptClass.toString line accounting), rather than chasing a
per-element attribute predicate. The fix, once the discriminator is known: pass a separate
`setterBodyLine` (= endLine−1 when it fires, else srcLine) to the setter's
`compileFunctionDebug` in `compileConstraintDebug` (the `setterFn` at ~L471, and the
once/path setter at ~L457). Keep the catch/displayName at srcLine (endLine) — only the
BODY base moves. Verify the frontier ADVANCES past 583428 and does not regress.

INVESTIGATION UPDATE (two more passes, both re-confirmed the data, neither cracked the
discriminator — do NOT re-derive the falsified hypotheses above): a `<`-line (SAX
startLineNumber) hypothesis was raised for `wcontent` (`<view` on 53, `>` on 54 → body 53),
BUT it is DEFINITIVELY RULED OUT by `controls` (both `<` and `>` on 672, yet body = 671 =
endLine−1, NOT 672). So NO start-tag / end-tag / attribute line rule can fire exactly these
two. This nails the mechanism to **cumulative source-line drift**: the constraint setter
body inherits the oracle's running line-counter state as it re-lexes the concatenated
ScriptClass/Class.make text, which for these two first-constraint setters has NOT yet
advanced to endLine. The productive next step is to model that line-counter state (read
`CompilerUtils.sourceLocationDirective`/`beginSourceLocationDirective` + how `ScriptClass.
toString` + `Class.make` text feeds the JavaCC/ParseTreePrinter line counter), NOT to keep
searching for a per-element attribute predicate. If this stays intractable after honest
effort, it is a candidate to LOG-AND-SKIP (document precisely, note the 2 affected elements,
move the frontier marker past it manually) so the remaining ~267 KB can be ground — but
prefer cracking it, since a wrong skip corrupts every gensym after it.

INVESTIGATION UPDATE 2 (a third pass, in-progress when interrupted — RESUME FROM HERE):
- CONFIRMED: the setter BODY srcloc uses the oracle's SAX `startLineNumber` (start=true);
  the catch/`$reportException` uses `endLineNumber`. So the body line == the element's
  SAX start-line, NOT a derived endLine±1. The 194 normal setters match endLine only
  because their start tag is single-line (startLine==endLine).
- The two quirk cases by SAX start-line: `wcontent` startLine = the `<`-line = 53 (its
  start tag spans 53–54). `controls` startLine = 671 = a BLANK line immediately BEFORE
  its `<` tag (the tag's `<`/`>` are both on 672, but SAX reported start at 671 — i.e.
  the locator points at the whitespace/blank line preceding the element).
- CANDIDATE FIX it was about to build+test (not yet applied — tree is clean): thread a
  `setterBodyLine` through `compileConstraintDebug` used for BOTH the setter body's
  `compileFunctionDebug` base AND the `attrSrc` EXPR `#line` directive (in gold,
  `var $1 = classroot.content.bgcolor` AND the expr are BOTH on line 53 = setterBodyLine).
  Keep catch/displayName at srcLine (endLine). The OPEN problem is still computing the
  correct `setterBodyLine` VALUE = the element's true SAX startLineNumber, including the
  "blank line before the tag" case (controls=671). That likely needs xml.ts to record a
  SAX-faithful start line (the line where the element's leading whitespace/`<` begins as
  the SAX locator would report it) — verify such a value reproduces 53 AND 671 AND leaves
  the 194 single-line setters unchanged, before wiring it. If it can't be made
  corpus-safe, characterize-and-skip per the note above.

## THE STOP POINT (history, RESOLVED S26) @byte 528830 — constraint `dependencies` body line off-by-one (multi-line start tag)
The divergence is in `lz/modaldialog.lzx`'s `mdcontent` view, whose start tag spans
TWO lines (attribute `y="${classroot.content_inset_top}"` on line 32, the closing `>`
i.e. `name="mdcontent">` on line 33). The `y` constraint emits an always-constraint
with a `<name> dependencies` function. GOLD tracks the folded-`$debug`
`return $lzc$validateReferenceDependencies([classroot, "content_inset_top"], ["classroot"])`
at `modaldialog.lzx#33`; MINE tracks it at `#34` (one too high).

WHAT I LEARNED (verified against gold, but the fix is NOT landed — my attempt REGRESSED
the frontier to 37011, so I reverted it):
- The deps function's HEADER / `displayName` / catch `$reportException` all track at the
  element's **endLine** (srcLine = 33, RULE 8) — this part is already correct.
- The deps **BODY** is base-lined at the constraint **ATTRIBUTE's own source line**, NOT
  the endLine. The body is `if ($debug) {\n  return validate…;\n} else {…}`; after the
  `$debug` fold the `return` lands at (bodyBase + 1). GOLD return line = 33 ⇒ bodyBase = 32
  = the `y=` attribute's line (line 32). For a SINGLE-line element these are equal
  (focusoverlay `$m4`: el line/endLine 27, attr 27 ⇒ deps header @27, return @28 = 27+1 —
  matches gold), so the bug only shows on multi-line start tags.
- So the intended fix: pass the deps `compileFunctionDebug` a `bodyBaseLine` = the
  attribute's line while keeping `methodLine` = srcLine (endLine). I ALREADY added an
  `attrLine` param to `compileConstraintDebug` (src/compile.ts ~L445, defaulted to
  srcLine) and wired the deps `compileFunctionDebug` call (~L476) to use it; ONLY the
  call site (instance path ~L1128) needs to pass the attribute line. BUT passing
  `el.attrLines?.[name]` there REGRESSED to @37011 — so `el.attrLines[name]` is NOT the
  right line source for the very first constraints (it gave a wrong value early). NEXT
  AGENT: find the CORRECT attribute-line source. `el.attrLines` is keyed by attribute
  NAME and records where the NAME token starts (xml.ts ~L197 `attrLines[aname]=attrLine`).
  The early regression means either (a) `attrLines` is missing/0 for some early
  constraint (so it fell back wrong) or (b) the oracle's deps bodyBase is the element
  line for those (single-line) but `attrLines[name]` returned a DIFFERENT line. Dump
  `el.attrLines` for the first failing element (compile dbg3 forced, find the @37011
  byte by unique string) and compare attrLine vs endLine before re-wiring. The
  `compileConstraintDebug` plumbing is already in place — you just need the right value
  at the 4 call sites (1128 instance, plus 1214/2420/2488 class/attr-element paths,
  544 once-color). The setter body base STAYS at srcLine (endLine) — only the deps body
  moves. Verify the frontier ADVANCES past 528830 AND does not regress below it.

### (history) Prior stop point @byte 339856 — super-call RULE A misfire — RESOLVED in S25
`base/baseformitem.lzx` init's `super.init()` after a folded-`$debug` outer-if. Cracked
(see RULE A in S25 RULES below); both baseformitem cases + checkbox/componentmanager now
correct.

## RULES CRACKED IN SESSION 27 (529909 → 583428) — DO NOT RE-DERIVE
S27-1. **Anon-class synthetic-ctor src-line sim: deps body bases at attrLine, not endLine.**
  The `finalSourceLine` ctor-line sim (`emitAnonClassDebug`) uses `node.lastMemberSrcLine`
  as the base. For an `always`-constraint code member, that base must be the deps BODY's
  base line (= `attrLine`, per S26-1), NOT srcLine/endLine. `compileConstraintDebug` now
  returns `lastSrcLine: attrLine` (src/compile.ts ~L486). Fixes modaldialog mdcontent ctor
  (GOLD `("", 42)` not 43): m8u finalLine 41→40, trailingVarDecls 1 → ctor 42.
S27-2. **S26-1 deps-body special case NARROWED to "endLine-bare" start tags.** The ONLY
  element in the entire dbg3 gold whose deps body line != header+1 is modaldialog
  `mdcontent` (`$m8k`, header 33, body 33). S26-1 over-fired (it wrongly listed window
  wframe + alert alerttext as FIRE cases — gold shows BOTH track their deps body at
  endLine+1 like everyone else). Added condition (d) to `specialDepsAttr` (src/compile.ts
  ~L1097): the endLine must carry NO attribute other than `name` (`endLineBare`). mdcontent
  endLine 33 = bare `name="mdcontent">`; window wframe endLine 52 has `options=…bgcolor=…`,
  alert alerttext endLine 44 has `resize=…multiline=…` → those no longer fire. mdcontent is
  now the SOLE firing case corpus-wide (verified by regex over gold for `body != header+1`).
S27-3. **`<setter>` element is a code member for the ctor src-line sim.** The `<setter
  name=…>` child path (src/compile.ts ~L1305) previously emitted its `$lzc$set_<name>`
  entry WITHOUT calling `noteCodeMember`, so when a `<setter>` is the last code member its
  body wasn't counted in `finalSourceLine`. Now calls `noteCodeMember(sbody + "\n#endContent",
  bodyLineOf(c))` (RULE 9 `#endContent`, body base = `bodyLineOf`). Fixes alert `alerttext`
  anon ctor (GOLD `("", 68)` not 55 — the `<setter name="text">` body spans lines 47-61).

## RULES CRACKED IN SESSION 26 (528830 → 529909) — DO NOT RE-DERIVE
S26-1. **Deps (`always`-constraint) `$debug` body source line — the "last shared-line
  constraint" quirk.** A constraint's deps function HEADER/displayName/catch track at the
  element's endLine (RULE 8); its `$debug` BODY (the folded `return $lzc$validateReference
  Dependencies(...)`) normally ALSO tracks at endLine (body base = endLine → return @endLine+1).
  EXCEPTION: the LAST always-constraint (`when==""`) on an element bases its body at the
  attribute's OWN source line (`el.attrLines[name]`) instead of endLine, when ALL of:
  (a) ANOTHER always-constraint shares its source line, (b) it is the LAST attribute (any
  kind) on that source line, and (c) that line < endLine. This only shows on multi-line
  start tags. VERIFIED cases: modaldialog `mdcontent` (x@32,y@32, end 33 → x body 33=endLine,
  y body 32=attrLine); lz/alert `text` (x@43,y@43,end 44 → y body 43); lz/window (width@51,
  height@51,end 52 → height body 51). MUST STAY endLine (rule must NOT fire): newcontent
  `_dbg_horiz_scrollbar` (y@329,width@330 — constraints on DIFFERENT lines → width endLine
  331); newcontent `scrollbar` (x@239,height@239 but bgcolor@239 FOLLOWS height → not last
  on line → height endLine 240); windowpanel#196 (x@196,y@196,width@197 — last constraint
  width is on its OWN line, doesn't share → endLine). Implemented in `compile.ts` buildNode
  (`specialDepsAttr` precompute + `depsBodyLine` at the instance call site ~L1150). The
  `compileConstraintDebug` already had the `attrLine` 3rd-param plumbing (passes to the deps
  `compileFunctionDebug` bodyBaseLine while keeping methodLine=endLine). NOTE: only the
  INSTANCE constraint path is wired; the class/attr-element paths (1214/2420/2488/once-color)
  still pass endLine only — extend `specialDepsAttr` there if a class multi-line tag diverges.
  MECHANISM (unproven but characterized): this is a cumulative-source-line drift in the
  oracle's re-lexing of the concatenated class text, NOT a per-function srcloc — the closed-
  form rule above reproduces it exactly across the whole corpus.

## RULES CRACKED IN SESSION 25 (339856 → 528830) — DO NOT RE-DERIVE
S25-1. **RULE A refinement — super-call line quirk predecessor predicate.** The super
  adjacency shift (`joinStmtsInner`, src/sc.ts) now ALSO requires the predecessor to
  "trigger the quirk". It triggers in the common case (simple stmt; or a `}`-terminated
  control stmt whose controlled block's LAST nested stmt is SIMPLE). It does NOT trigger
  ONLY when the predecessor is an **else-less `if`** whose then-branch is either (i) NOT
  a `}`-block (`if(cond) expr;` — baseformitem `destroy`), or (ii) a `}`-block whose LAST
  nested stmt is itself a control stmt (baseformitem `init`'s outer `if`, then-tail =
  folded `if($debug){…}`). FIRE cases that must keep firing: layout `destroy`
  (`releaseLayout(true);` bare expr), componentmanager `init` (`if(fclass){…reset()}`),
  checkbox `setValue` (`if(){}else if(){}else val=!!val;` — HAS an else). Signal
  (`predecessorTriggersRuleA`) is computed PRE-fold in `statement()` and carried on the
  stmt as `.superQuirkPredecessor` (fold splices nested blocks flat, erasing it).
S25-2. **Member-rich class synthetic-ctor line counts trailing named-child void slots.**
  `emitClassDef` member-rich `ctorLine = lastMemberClose + (handler?6:5) + trailingVoid`,
  where `trailingVoid` = count of consecutive void-slot entries at the END of the class's
  instance entries (named `<view>` children declared AFTER the last code member each emit
  one `var name;` decl line in ScriptClass.toString, pushing the ctor down). button:
  `_applystyle` close 149 +5 +6 (`_outerbezel`…`_title`) → ctor/`$reportException` line 160.
S25-3. **Rest-param (`args="...name"`) prologue does NOT consume a body source line.** In
  the debug path (`compileFunctionDebug`), terminate `var name = Array.prototype.slice.
  call(arguments,N)` with `; ` (semicolon + space, NO newline) so the body's first
  statement keeps the SAME source line as the prologue (basewindow `close`: both at #349,
  no inter-statement blank). The oracle inserts the prologue via substituteStmts as a
  separate synthetic list at the formal-param-list line.
S25-4. **Inlined entry values: strip the `, ` separator via `splitEntry`, not a raw
  regex.** State-instance inline methods (`emitNode` `node.isState`) and the
  `canHaveMethods=false` datapath constraint branch put `methodEntries` values into the
  attrs map. Use `splitEntry(e)` (consumes `,` OR `, `) — a raw `^"…",([\s\S]*)$` leaves
  the debug `, ` space, doubling the `: ` in the emitted object (`$m63:  (function` →
  must be `$m63: (function`).
S25-5. **`defaultplacement` sentinel child map uses `emitObj` (spaced in debug).** The
  `{attrs:"content","class":$lzc$class_userClassPlacement}` placement child must be
  `emitObj(...)` not `emitObject(...)` so the debug build spaces it
  (`{attrs: "content", "class": …}`).

## RULES CRACKED IN SESSION 24 (322487 → 339856) — DO NOT RE-DERIVE
S24-1. **Debug `switch` rendering** (`src/sc.ts` switch printer ~L1648). The switch
  body is the DIRECT concat of clause strings (no separator) wrapped by `makeBlock`.
  Each clause = `"case"+delimit(test)+":"+NEWLINE + (body + OPTIONAL_SEMI)` (or
  `"default:"+NEWLINE+…`); body = the TIGHT concat of statement strings via the new
  `joinCaseBody` (each stmt `lnum`-prefixed with its OWN source line, NO `NLsep`).
  `OPTIONAL_SEMI` (ParseTreePrinter:114) = NEWLINE in compress (always "\n", obfuscate
  off), `;` in debug. The WHOLE clause is `lnum(caseTokenLine,…)`-wrapped → inter-clause
  blank-line padding falls out of the translation machinery. Capture the case/default
  token line in `switchStmt()` (`cl.line`/`cl.file`) and carry it through `foldStmts`.
  `delimit(force=true)` = prefix " " unless the (unannotated) test starts with "(".
S24-2. **id/name binders = debug `Function` (anonymous, displayName-IIFE, NO with-this).**
  `<… id=X>` / top-level `<… name=Y>` emit `$lzc$bind_id`/`$lzc$bind_name` as a
  `Function("$lzc$node:LzNode, $lzc$bind:Boolean=true", buildIdBinderBody(sym,setId))`
  (NodeModel:787/966/980). `loc=null` in the Function (Function.java:72) → it is an
  ANONYMOUS function expression (`function (` — 1 space) carrying its displayName via
  the IIFE from `#pragma userFunctionName=bind #sym`, NEVER with(this). Route through
  the new `compileBinderDebug` → `renderDebugFuncNode(fn, "bind #sym", named=FALSE,…)`.
  The body SOURCE keeps `$debug`/`$as3` intact (the folder: `$debug`→true keeps the
  Debug.warn block; `$as3`→false drops the `global[…]` lines, preserving their source
  lines as blank padding). Lex the wrapped `function (…) {<pragma+body>}` from
  bodyBaseLine = funcLine (header on funcLine, `#pragma` on +1 consumed, `if($lzc$bind)`
  body on +2). funcLine = the element's **endLine** (the `>` line, RULE 8). `compile.ts`
  `idBinderDebug`/`idBinderBodySource`/`binderLineSpan`.
S24-3. **bind_name shares a NON-reset line counter with bind_id.** When an element has
  BOTH id and name, bind_id is compiled first; the line counter is NOT reset, so
  bind_name's funcLine = `el.endLine + binderLineSpan(true)` (= endLine + body-newlines
  + 2 = endLine + 18 for setId). When there's only a name (no id), bind_name sits at
  el.endLine. The name binder is built AFTER the attr loop (deferred via
  `pendingNameBinderRaw`); attrs are SORTED on emit so bind_id always precedes bind_name.
S24-4. **Canvas-direct `LzInstantiateView` leading directive = element endLine** (the
  start-tag `>` line, RULE 8), not the `<`-line. (`compile.ts` ~L2703, was `child.line`.)

## RULES CRACKED IN SESSION 23 (211996 → 322487) — DO NOT RE-DERIVE
1. **State-class constructor = directive form.** A `<class extends="state">` routes
   all setters/methods to mergeAttributes (void-slot decls), so its ctor uses
   `debugConstructor` (`memberRich=false`), NOT the plain form. `ctorLine = classLine
   + 4 + ndecls + extraStatic` where classLine=`endLine-1`, ndecls=`emitEntries.length`
   (the routed void slots), extraStatic=`(childrenJs?1:0)+classAllocEntries.length`.
   (resizestate 2 static + 10 decls → 16; dragstate → 22; member-less → +0.) Blank-
   line padding falls out of the machinery. (`src/compile.ts` emitClassDef debug path.)
2. **State-class mergeAttributes leading directive.** A directive-form ctor leaves
   the file context set, so the following `LzNode.mergeAttributes(...)` gets a leading
   directive at `ctorLine + 4`; a plain ctor (file="") does not. (`debugMergeAttributes`
   takes an optional `mergeLine`.)
3. **`$lzc$getFunctionDependencies` 5th arg** = `($debug ? (ctnm) : null)` where ctnm
   = quoted source text of the call's receiver/callee (ReferenceCollector.fsubst:105).
   In debug = `jsString(printer.expr(receiver))`, null in production. (`src/sc.ts`
   collectDependencies.)
4. **Nested function-expression debug rendering** (`renderDebugFuncNode` in sc.ts):
   named funcdecls (`function map`) AND anonymous callbacks render with the
   displayName-IIFE + name_$N idents + try/catch + directives, like a method but
   isMethod=false (NEVER withThis). Named → displayName = the name, header `function  (`
   (2 spaces). Anonymous → displayName = `<file>#<line>/<col>`, header `function (`
   (1 space). funcdecl hoist: `var name;` then `name = <IIFE>;` at the ENCLOSING
   method's line; the IIFE's internal directives use the function's OWN line.
   printFunc routes to renderDebugFuncNode when `this.dbg`.
5. **Column tracking in the sc lexer.** 1-based, resets at every newline; func nodes
   carry `line`/`col` (the `function` keyword position) for the anonymous displayName
   (JavascriptGenerator:1115 `file#line/col`). (lexer `Tok.col`, functionExpr, foldNode.)
6. **lead/body separator.** A lead ending in `;` (funcdecl hoist / closed-param
   redecls) needs only `\n` before the body; one ending in `}` (the switch prologue)
   needs `;\n`. (Fixed a `)();;` double-semicolon.)
7. **`allocation="class"` value in debug.** A nested object/array value renders
   compress=false (`compileExprDebug`) + `ent()` (`, ` separator).
8. **Handler/method source line = the element's endLine** (the start-tag `>`/`/>`
   line — JDOM/SAX report an element at its start-tag close), NOT the `<`-line and NOT
   the attribute's own line. An attribute handler's inline body is also at endLine; a
   `<handler>` ELEMENT body uses `bodyLineOf`. (`emitHandler`.)
9. **`#endContent` in the anon-class ctor sim.** Handler bodies have `\n#endContent\n`
   appended (NodeModel:1488), method bodies `\n#endContent` (NodeModel:1612). These
   trailing lines MUST be in `lastMemberBody` (noteCodeMember) so `finalSourceLine`
   counts them — they set the synthetic-ctor line in `emitAnonClassDebug`.
10. **buildNode debug-awareness.** The instance/anon-class path (`buildNode`) must use
    the COMPILE_DEBUG branches for setters / `<setter>` / events / named-child slots
    (`voidSlot`, `ent` + `compileFunctionDebug`) exactly like `emitClassDef` — it
    previously emitted the compressed forms unconditionally.
11. **mergeChildren comma.** `LzNode.mergeChildren([], Super["children"])` needs the
    `, ` spaced in debug (3 sites in compile.ts).

## KEY FILES
- `src/compile.ts` — class/instance emission, `buildNode`, `emitClassDef`,
  `emitAnonClassDebug` (synthetic-ctor source-line sim via `finalSourceLine`),
  `debugMergeAttributes`, `emitHandler`. Refusal ~L1591.
- `src/sc.ts` — lexer (cols), `renderDebugFuncNode`, `compileFunctionDebug`,
  `printFunc`, `joinStmts`/`joinStmtsInner` (~L1513), switch printer (~L1648),
  `collectDependencies`, `compileExprDebug`.
- `src/debug.ts` — the makeTranslationUnits port (annotation stream → text,
  blank-line padding, directive suppression). `assembleDebugProgram`.
- `src/xml.ts` — element line/endLine/attrLines/endCol.
- Java oracle: `lps-4.9.0-src/lps-4.9.0/WEB-INF/lps/server/src/org/openlaszlo/`
  `sc/{ParseTreePrinter,ReferenceCollector,Function,ScriptClass,JavascriptGenerator,
  CommonGenerator}.java`, `compiler/{ClassModel,NodeModel,CompilerUtils}.java`.
- Gold: `modern-build/oracle/out/dbg3.dhtml.js` (850579 bytes). Component source under
  `downloads/ol-4.9.0-servlet/lps/components/`.

## COMMANDS QUICK REF (run from modern-build/compiler unless noted)
```
npm run build
node harness/diff.mjs fixtures/*.lzx                         # 96/0/0
node harness/batch.mjs check                                 # 263/0/83
node harness/debug.mjs                                       # 5/5
node dist/cli.js /tmp/dbg3.lzx >/dev/null 2>&1; echo $?      # 3
LZC_DEBUG_FORCE=1 node harness/batch.mjs dbgshow /tmp/dbg3.lzx   # frontier
```

---

## SESSION (2026-06-24): basetabs super-tail + tabscontent ctorLine — explorer-debug 48→52

**Landed two fixes, gate fully GREEN throughout (corpus 266/0/80, fixtures 96/0/0,
dbg3 RAW IDENTICAL 850579, explorer-solo 61/1, explorer-debug 52/10, bare exit 3).**

### FIX 1 — basetabs `createChildren` 3-blank super-tail (CRACKED the primary target)
The previous worker had reverted this, lacking the discriminator. METHOD: enabled the
oracle's BUILT-IN annotation dump via the `-SS`/`--savestate` flag (`Main.java:399` sets
`DUMP_LINE_ANNOTATIONS` → writes `<src>-lineann-*.txt` with `printableAnnotations`, the raw
`#fileline F#N:` stream). NO oracle source patch needed — the flag is stock. Diffed the
oracle stream against a temp TS trace.

FINDING: **every** super-dispatch in the oracle's lineann dump is the IDENTICAL triple
`#fileline X#A: #fileline X#(A-1): #fileline X#A: (#fileline X#A: arguments…$superclass…` —
i.e. the generated super-dispatch EXPRESSION node carries its OWN source line `#A` on its
first token. So the universal stream is `#own #shifted #own (`. The TS-printed dispatch body
is a bare `(…` with NO leading annotation, so the old joinDepth-1 path (two `lnum` prepends)
emitted only `#own #shifted (` — MISSING the inner `#own`. That's why a multi-line-predecessor
super rendered BLANK(2) not BLANK(3): the missing inner annotation under-counted the blank pad.

TWO coupled edits in `src/sc.ts joinStmtsInner` (the `ruleAFired && !nestedFirstSuperActive`
branch ~L1958):
1. **THREE** `lnum` prepends instead of two: inner `#own` (seeds the body's own line) →
   middle `#shifted` (prevEndLine) → outer `#own`. Yields `#own #shifted #own (`, byte-exact
   to the oracle.
2. **Dropped the compensating `dbgLineDelta -= 1` cascade for joinDepth-1** (~L2000, now gated
   `this.joinDepth !== 1`). The old 2-annotation-plus-cascade model was MATHEMATICALLY
   EQUIVALENT to the oracle FOR THE FOLLOWER (e.g. reverselayout addSubview's `this.update()`)
   but produced the wrong BLANK COUNT for the super itself. With the 3rd annotation present,
   the cascade double-shifts (it spuriously demoted `this.update()` from #29→#28, breaking
   dbg3). The oracle has NO cascade — its annotation source lines are TRUE — so emitting the
   3-annotation form AND removing the joinDepth-1 cascade reproduces the oracle exactly.
   (The cascade still fires for NESTED supers, joinDepth>1, where the 3-annotation form
   doesn't apply.)

RESULT: tabs/tree/form/grid + docs-component-browser ALL advanced past the super-tail; dbg3
stayed RAW IDENTICAL.

### FIX 2 — tabscontent childOnlyRich synthetic-ctor line (`$reportException("",370)`)
After FIX 1, the 4 basetabs programs hit a SEPARATE pre-existing bug: the `tabscontent`
class (`lz/tabs.lzx`, childOnlyRich: `<attribute defaultplacement> + one <view borderedcontent>`,
no code members) emitted ctor line 375 vs gold 370. Proven via the `-SS` `*-src-*.txt` dump
(the ScriptClass.toString INPUT): the synthetic ctor's `function` is at generated line 370,
and the LAST `#line` before it is **365 = the `defaultplacement` ATTRIBUTE's source line**,
because the placement SENTINEL `{attrs:"borderedcontent","class":$lzc$class_userClassPlacement}`
is APPENDED as the LAST children-array entry, and its quoted target value carries that `#line`.
From `#line 365`: value(1)+`#file `reset(1)+`}];`children-close(1)+`static var attributes`(1)+
one `var <name>;` per OWN named child(N=1)+`function` = **+5 → 370**.

EDIT in `src/compile.ts`: capture the `<attribute name="defaultplacement">` ELEMENT's line
(`placementAttrSrcLine`, set in the class-member loop), and in the childOnlyRich ctorLine block
(~L3277) use `placementAttrLine + 4 + namedChildDecls` when it's set, else the old
`closeLine + 4 + trailingAfterChild`.

CRITICAL DISCRIMINATOR (regressed scrollview first, then fixed): gate STRICTLY on the
`<attribute>` ELEMENT form. A `defaultplacement=` **TAG attribute** (e.g. scrollview in
scrollbar_example.lzx#5, `<class name="scrollview" defaultplacement="content" …>`) instead
carries the class start-tag line (early, #5), so the sentinel's `#line` is NOT the last — the
last child VIEW's is — and `closeLine + 4` stays correct (scrollview: children close @9 → 13).
So only `placementAttrSrcLine` (set ⇔ `<attribute>` element) re-anchors; the tag-attr fallback
`child.attrLines?.["defaultplacement"]` was REMOVED.

RESULT: tabs/tree/form/grid flipped to MATCH. explorer-debug 48→52.

### TRIED + REVERTED — id-binder funcLine (dataimage #132 vs #135)
`dataimage` `<view id="yellowRect" …/>` spans source 132–135; the `$lzc$bind_id` binder's
funcLine is gold #132 (start tag, where `id=` is) but mine #135 (`el.endLine`, the START-tag's
`/>` line). Tried `el.attrLines?.["id"] ?? el.line` in the `name==="id"` branch (compile.ts
~L1271) — **CRASHED ALL 62 explorer-debug to diff**. The binder's serialized position / the
bind_name pairing (which assumes the id binder sits at `el.endLine` + span, compile.ts ~L1378)
is load-bearing on `el.endLine` far more broadly than the funcLine. REVERTED cleanly (back to
52/dbg3 RAW IDENTICAL). This is a real sub-target but needs the full binder-serialization model,
not a one-line swap. weather (#222 vs #229) is the SAME class of bug.

### REMAINING 10 explorer-debug diffs (offsets from `check-explorer-debug`)
- **binder funcLine ×2** (start-tag vs endLine): `dataimage` #132/#135, `weather` #222/#229.
  Both `$lzc$bind_id`/binder lines on a MULTI-line id'd `<view>`. SHARED ROOT with the reverted
  attempt — crack the binder serialized-position/funcLine model (incl. bind_name pairing).
- **childOnlyRich ctorLine (HARD)**: `docs-component-browser` `hierarchyview` class — ctor gold
  #87 vs mine #205. A member-less class whose SINGLE unnamed `<view>` child holds a deeply-nested
  constraint/handler tree (hierarchyview.lzx 81–202). closeLine anchor (~201) is wildly off;
  gold #87 sits mid-tree. The ScriptClass line model for a constraint-binder-heavy nested
  single child is not yet characterized. Use `-SS` `*-src-*.txt` on a writable copy.
- **Cluster E (reg/file-context)**: `datepicker` (#143733: gold reg `base/basecomponent.lzx#1`
  vs mine `debugger/debugger.lzx#1`), `contactlist`. Cross-unit `Token.currentPathname` /
  makeTranslationUnits file-context for a registration directive — picks the WRONG trailing file.
- **Cluster F (resource-library ordering)**: `lzproject` (#16377: LzResourceLibrary frame-set
  ENUMERATION ORDER — `$LZ1` datepicker pulldown vs `upBtn_rsc` debugger; JVM File.list order),
  `lzpix-app`. Likely a normalize-able order OR a real ordering rule.
- **Misc**: `component_sampler` (#1316236 region: a tag-map reg run `lz["x"]=cls;…` emitted
  INLINE by mine but the gold inserts a `/* -*- file: component_sampler.lzx#1 -*- */` directive
  first — a reg file-context, Cluster-E-adjacent), `calendar`, `amazon` (#1361194: a blank-line
  count in a `$lzsc$initialize` IIFE — possibly another super-tail/ctor-span case to dump).

### METHOD NOTE (reusable, NO oracle patch)
The `-SS`/`--savestate` flag is the oracle's ground-truth probe:
`java … org.openlaszlo.compiler.Main --runtime=dhtml --debug -SS <abs-src>` writes, next to the
source, `<base>-lineann-*.txt` (raw `#fileline F#N:` annotation streams, one per method/TU — the
EXACT input to makeTranslationUnits) and `<base>-src-*.txt` (the ScriptClass.toString INPUT with
`#file`/`#line` directives — ground truth for synthetic-ctor `node.beginLine` arithmetic). For
multi-file apps whose source dir is read-only, copy the app + includes to a writable dir first.
Classpath/flags: see `oracle/compile-debug-solo.sh`. DELETE the dump files when done.

---

## SW LAYER (static Laszlo Explorer) — separate effort, ADDITIVE, does not touch the frozen core

Built the Service-Worker layer that runs OL apps off a plain static fileserver (compiled
in-browser, no dynamic server). Builds ON `src/browser.ts` `compileInBrowser` +
`dist/lzc-browser.js`. No changes to compile.ts/sc.ts/debug.ts/xml.ts/value.ts,
harness/batch.mjs, or the oracle.

New files (all under `demo/`):
- `sw.js` — module Service Worker. fetch routes: `<name>.lzx` navigate → wrapper HTML
  (mirrors openlaszlo/server/wrapper.mjs, runtime refs → configurable RUNTIME_URL);
  `<name>.lzx.js` → `compileInBrowser(src,{lpsUrl,cache,sprites:"none",proxied:false})` +
  `ETag`/`If-None-Match`→304; app-relative `lps/…` runtime resources → proxied to LPS_URL;
  else pass-through. `skipWaiting()`/`clients.claim()`. Config consts at top: LPS_URL,
  RUNTIME_URL, APPS registry. KEY DESIGN: app `.lzx` URLs are VIRTUAL under the SW scope
  (`…/demo/<name>.lzx`) + mapped to real sources via APPS — so plain `python3 -m http.server`
  (which can't send Service-Worker-Allowed) can still intercept them.
- `starter.html` — registers `./sw.js {type:module,scope:./}`, one-time reload handshake
  (sessionStorage-guarded), app links.
- `lzc-browser.js` — copy of dist/lzc-browser.js (re-copy after bundle:browser).
- `README-SW.md` — serve recipe, verified URL map, lifecycle, handshake, module-SW caveat.

Serve: `cd /Users/temkin/Code/OpenLaszlo && python3 -m http.server 8090` →
`http://localhost:8090/modern-build/compiler/demo/starter.html` → click dashboard.lzx.

Verified headlessly: 13 config URLs resolve; all 41 dashboard runtime `lps/*` refs exist
(zero 404s); SW config (sprites:none,proxied:false) compiles dashboard 432543B SOLO +
CacheStorage hit; sw.js + starter parse as ES modules. Gates: build clean, test:browser
21/21 (3× BYTE-IDENTICAL), check-dashboard BYTE-IDENTICAL. UNVERIFIED (needs real browser):
fetch interception, request.mode, clients.claim, CacheStorage persistence — compile output
itself already proven byte-identical.
