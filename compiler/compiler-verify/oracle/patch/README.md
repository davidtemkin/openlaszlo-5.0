# Oracle debug-source-attribution patches

This directory holds **three** small, surgical bug-fixes to the stock OpenLaszlo
4.9.0 compiler, prepended to the classpath via `lzc.sh` (`patch/classes` comes
first, overriding the stock classes in the webapp). All fix **deterministic,
DEBUG-ONLY, cosmetic defects** in the source-location (`#file`/`#line`) machinery
— production (`compress`) output is byte-identical with or without them
(verified). They exist so the TypeScript reimplementation can match a *consistent*
oracle rather than replicate a leaked-state accident, which would make the TS
compiler harder to read and maintain. Remove the `patch/classes` prefix from
`lzc.sh` to revert to the bit-exact stock oracle.

---

## 1. `SimpleCharStream.class` — read-buffer 4096 → 4M (`1<<22`)

JavaCC-generated char stream for the LZX script compiler
(`org.openlaszlo.sc.parser`), regenerated from the project's bundled `javacc.jar`
against `Parser.jjt` with ONE change: the default read-buffer size raised from
4096 to 4M.

**Why.** The stock 4096-char buffer triggers a position-dependent off-by-one bug
in JavaCC's `adjustBeginLineColumn` (which resolves a `#line N` directive). When
the relabel region straddles a buffer-refill boundary in the concatenated class
text, the following content is numbered N-1 instead of N. Cosmetic DEBUG-ONLY: it
only affects `/* -*- file: F#L -*- */` comments and `$reportException(file, LINE)`
args. Enlarging the buffer keeps the whole stream in one buffer, where
`adjustBeginLineColumn` is already correct (proven by isolation), so line numbers
are consistent (always N).

**Effect (dbg3 + corpus).** Production golds byte-identical; debug golds get a
handful of comment-line corrections to the drift-free N (e.g. modaldialog#33->34,
window#53->54, debugger#671->672, and the cascading synthetic-ctor 42->43). The
regenerated *unmodified* SimpleCharStream reproduces the stock gold byte-for-byte,
confirming the regeneration is behaviorally identical to the jar.

---

## 2. `ToplevelCompiler.class` — reset `Token.currentPathname` before the tag map (2026-06-24)

Source: `patch/src/ToplevelCompiler.java` (stock source + 2 lines). In
`outputTagMap`, immediately before `env.compileScript(tagmap.toString())`, add:

```java
Token.setCurrentPathname("");   // generated tag map has no source file
env.compileScript(tagmap.toString());
```

(plus `import org.openlaszlo.sc.parser.Token;`).

**Why it's a bug, not a feature.** The tag→class map (`lz["x"] = cls;`) is
compiler-GENERATED code with no source file. But `Token.currentPathname` is a
`private static` (`parser/Token.java:41`, copied into every `newToken().pathname`
at :99, set ONLY by the lexer's `#file` pragma rule at `Parser.jjt:113`) that
**survives across `compileScript()` calls**. So without this reset the generated
tag map silently inherits whatever source file the *last instance's last-parsed
script fragment* happened to leave in the static. That makes the registration
trailer's debug `#file` source-location attribution depend on the oracle's
internal `cg.translate` `parseFragment` ORDER rather than on anything in the node
tree — a leaked-static accident. `outputTagMap` is the very last thing
`CanvasCompiler.compile` runs (the trailer), and the tag-map string contains no
`#file` pragma, so the reset is fully surgical: it affects only the generated
tag-map + trailer tokens, with no subsequent code.

**Why it's benign / debug-only.** Production builds emit no `#file` directives, so
production output is byte-identical with or without the fix (verified: explorer-
solo 61/1, corpus 266/0/80, fixtures 96/0/0 all unchanged after the patch). The
"correct" attribution for generated code is undefined anyway; `""` (file-less,
"Pattern A" — inline, no directive) is the consistent choice for all programs.

**Effect (dbg3 + corpus + Explorer).** Production golds byte-identical. Debug
golds: the formerly-"Pattern B" programs' tag maps lose their per-line
`/* -*- file: app#k -*- */` directives (now concatenated inline). dbg3 re-baselined
850579 → 848740 bytes (RAW IDENTICAL preserved). `regen-debug`: 51 of 78 corpus
debug golds changed. Explorer-DEBUG reaches **62/62 byte-perfect** (this closed
`component_sampler`, the last diff — see `known-gaps.md`).

**TS side.** `src/compile.ts` (debug path) threads the identical reset by
prefixing the first reg/trailer statement with `setPathname("")`, so the whole
registration block renders Pattern A. This superseded the
`instanceTrailingFile`/`topLevelHasIdOrName` reg-block proxy.

**Rebuild recipe** (if the stock source or classpath changes):
```
JAVA_HOME=/opt/homebrew/opt/openjdk@17
WEBAPP=/Users/temkin/Code/OpenLaszlo/downloads/ol-4.9.0-servlet
CP="$(find "$WEBAPP/WEB-INF/lib" -name '*.jar' | tr '\n' ':')$WEBAPP/WEB-INF/classes"
"$JAVA_HOME/bin/javac" -cp "$CP" -d patch/classes patch/src/ToplevelCompiler.java
```
(produces only `ToplevelCompiler.class` — no inner classes.)

---

## 3. `NodeModel.java` — anchor backtrace class-default constraint inits to their declaration line (LPP-3949) (2026-06-25)

Source: `patch/src/NodeModel.java` (stock source + ~15 lines, one new
private helper `btAnchorConstraintInit` + three one-token call-site changes in
`CompiledAttribute.getInitialValue`).

**What it changes.** In a **DEBUG_BACKTRACE** build only
(`env.getBooleanProperty(CompilationEnvironment.BACKTRACE_PROPERTY)` — set by
`compileroptions="backtrace:true"`, Parser.java:471), the synthesized
class-default **constraint init-expr** — `new LzOnceExpr/LzAlwaysExpr/
LzConstraintExpr/LzStyleConstraintExpr(...)` returned by `getInitialValue` for a
`when="once|path|always|style"` attribute — is wrapped in the **same**
`#beginAttribute … srcloc … endSourceLocationDirective … #endAttribute` directive
the adjacent **WHEN_IMMEDIATELY** path (NodeModel.java:478) already emits:

```java
private String btAnchorConstraintInit (String expr) {
  if (env != null && env.getBooleanProperty(CompilationEnvironment.BACKTRACE_PROPERTY)) {
    return "#beginAttribute\n" + srcloc + expr + CompilerUtils.endSourceLocationDirective + "#endAttribute";
  }
  return expr;
}
```

**Why it's a bug, not a feature.** The OL authors flagged this exact gap:
NodeModel.java:474-477 `// TODO: [2007-05-05 ptw] (LPP-3949) The #beginAttribute
directives for the parser should be added when the attribute is written, not
here...`. Under backtrace, JavascriptGenerator wraps every call/`new`/checked-ref
with a `noteCallSite` recording `<frame>.lineno = node.beginLine`
(JavascriptGenerator:727-733). The class-default constraint inits are collected
into the generated `mergeAttributes({basecolor: new LzOnceExpr(...), …})` object
and re-lexed; **lacking** a source-location directive, their `beginLine` is the
*running JavaCC physical line of the generated object* (e.g. style.lzx `basecolor`,
declared at line 44, noted at the doc-comment line **161**) rather than the
declaration line. The directive anchors each init to its attribute's declaration
line (`srcloc` = `CompilerUtils.sourceLocationDirective(source, true)`, the
start-tag closing `>`/`/>` line), so `basecolor`→44, `bgcolor`→49, etc. — a
**sensible, declaration-anchored** backtrace, completing the LPP-3949 TODO.

**Why it's benign / backtrace-only.** Gated on `BACKTRACE_PROPERTY`, so it is inert
for every normal-debug and production build (those never `noteCallSite` these
inits, and the directive would otherwise perturb their `#file`/`#line` state). The
`srcloc`/`endSourceLocationDirective` mechanism is identical to the WHEN_IMMEDIATELY
path that already runs in this exact object position, so no new lexer behavior is
introduced.

**Blast radius (PROVEN, not asserted).** `harness/batch.mjs regen-debug`
(recompiles all 78 corpus debug golds with the patched oracle): **1 changed
(backtrace.lzx), 77 unchanged, 0 failed**. `dbgshow /tmp/dbg3.lzx` (a large
non-backtrace debug build, live-compiled through the patched classpath): **RAW
IDENTICAL @845661**. So the patch moves ONLY the backtrace gold. The regenerated
backtrace golds (`.goldcache/backtrace.lzx.gold`, `.goldcache-ol-corpus/
backtrace.{nd,dbg}.gold`) carry the declaration-anchored notes.

**Status.** This fix is COMPLETE and scoped, but backtrace is **not yet
byte-identical** — it removed the class-default constraint-init line-state blocker
(first divergence advanced **133424 → ~150786** of 1.34 MB), exposing further
TS-side `noteCallSite`-completeness gaps (the `<script>`-instance function frame —
since fixed TS-side — then generated-call notes for `is`/`_usestyle()`/… in the
LFC). Those are TS implementation gaps, NOT oracle bugs, so production
`compileroptions="backtrace:true"` **still REFUSES** (refuse-don't-miscompile,
compile.ts) until the TS reaches byte-identical. The TS mirror of THIS fix is
`btNoteConstraintInit` in `src/compile.ts` (wraps each class-default constraint
init `new CTOR(args)` → `(GEN $3.lineno=N, new (GEN $3.lineno=N, CTOR)(args))`,
gated on `COMPILE_BACKTRACE`).

**Rebuild recipe:**
```
JAVA_HOME=/opt/homebrew/opt/openjdk@17
WEBAPP=/Users/temkin/Code/OpenLaszlo/downloads/ol-4.9.0-servlet
CP="$(find "$WEBAPP/WEB-INF/lib" -name '*.jar' | tr '\n' ':')$WEBAPP/WEB-INF/classes"
"$JAVA_HOME/bin/javac" -cp "$CP" -d patch/classes patch/src/NodeModel.java
```
(produces `NodeModel.class` + `NodeModel$CompiledAttribute.class` +
`NodeModel$BindingExpr.class`.)
