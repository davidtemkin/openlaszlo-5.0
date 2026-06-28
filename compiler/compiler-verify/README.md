# compiler-verify — oracle differential verification

A self-contained capability for **byte-for-byte differential verification** of the
distro's TypeScript LZX compiler (`openlaszlo-5.0/compiler/`) against the original
**OpenLaszlo 4.9.0 Java compiler** (the "oracle").

The oracle is the ground truth: this harness compiles a set of `.lzx` programs with
*both* compilers and asserts the (normalized) DHTML output is identical. It bundles
**only the OL4-unique files the Java compiler needs at runtime** — a minimal
`LPS_HOME`. It does **NOT** bundle the JDK, the OpenLaszlo jar, the runtime
components/fonts/LFC (those are symlinked into `../../runtime/`), or any golds
(those are regenerated locally — see below).

```
compiler-verify/
  oracle/
    lzc.sh              # self-contained oracle driver (reads $JAVA_HOME + $OL_ORACLE_JAR)
    lps-home/           # the MINIMAL LPS_HOME (config/schema/internal files only)
      WEB-INF/lps/
        config/         # lps.properties, lps.xml
        misc/           # *.properties, vera.fft  (autoincludes, deprecated/builtin maps)
        schema/         # lfc.lzx (LFC interface decls), preprocess.xsl (namespace XSLT)
      lps/
        components ->  ../../../../../runtime/components   (symlink — NOT duplicated)
        fonts      ->  ../../../../../runtime/fonts        (symlink — NOT duplicated)
        includes/lfc/  # LFCdhtml.js / LFCdhtml-debug.js -> runtime LFC (existence stubs)
    solo-config/        # config overlay with compiler.proxied=false (SOLO builds)
    patch/              # the 3 debug-only oracle source-location fixes (copied; see patch/README.md)
  harness/
    verify.mjs          # the differential check driver (regen / check / live / show)
  .goldcache/           # regenerated golds (gitignored; NOT committed)
```

## 1. Prerequisites (you install / obtain these)

### a. JDK 17
```
brew install openjdk@17
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
```
(Any JDK 17 works; just point `$JAVA_HOME` at it.)

### b. The prebuilt OpenLaszlo 4.9.0 compiler classpath — `$OL_ORACLE_JAR`
The Java compiler is **not** bundled (license + size). Obtain the OpenLaszlo 4.9.0
**servlet** distribution (`openlaszlo-4.9.0.servlet.tar.gz` / `.zip` from the
OpenLaszlo archives) and unpack it. Then point `$OL_ORACLE_JAR` at it. It accepts:

* the unpacked **servlet webapp root** (the dir containing `WEB-INF/lib/*.jar`),
  e.g. `export OL_ORACLE_JAR=/path/to/ol-4.9.0-servlet` — **recommended**; or
* a single `lps.jar`; or
* an already-assembled colon-separated classpath.

```
export OL_ORACLE_JAR=/path/to/ol-4.9.0-servlet
```

### c. The TS compiler must be built
```
cd openlaszlo-5.0/compiler && npm install && npm run build   # produces dist/cli.js
```

## 2. Regenerate golds (none are committed)

Golds are ~hundreds of MB across the full corpus, so they are **not** in git. Generate
them on demand into `.goldcache/` (gitignored):

```
cd openlaszlo-5.0/compiler/compiler-verify
node harness/verify.mjs regen <dir|file.lzx ...>
# e.g. the docs program corpus:
node harness/verify.mjs regen ../../docs/src/developers/programs
```
`regen` oracle-compiles each program in BOTH variants (non-debug + debug, SOLO) and
writes `<key>.nd.gold` / `<key>.dbg.gold` / `<key>.src`.

## 3. Run a check

```
# Compare the TS port against the regenerated cache:
node harness/verify.mjs check

# Or compile BOTH fresh (no cache) for a quick spot check:
node harness/verify.mjs live <dir|file.lzx ...>

# First-divergence detail for one program:
node harness/verify.mjs show <file.lzx>
```
Each mode reports per-variant `N match, M diff, K unsup`. A program is **unsup** when
the TS compiler deliberately *refuses* (`UNSUPPORTED:`) rather than miscompile.

### What "byte-for-byte" means here (normalization)
`verify.mjs normalize()` neutralizes a few **non-portable, non-semantic** artifacts
on BOTH sides before comparing (identical policy to the canonical
`modern-build/compiler/harness/batch.mjs`):
* `appbuilddate` (the embedded compile timestamp);
* multi-frame resource enumeration ORDER (the oracle's JVM `File.list()` order);
* the sprite-sheet machinery (the distro ships `sprites:"none"`);
* the component/font source-path PREFIX in `#file` / `reportException` / `displayName`
  attributions. Because `lps/components` is a **symlink** into `../../runtime/`, the
  oracle's `relativePath` canonicalizes it to an escaping `../../../../runtime/components/…`
  path while the TS compiler keeps the logical `base/colors.lzx` form. Both denote the
  same source file + line; the prefix (where the resources physically live) is stripped
  on both sides so the gate compares source identity + line, not deployment layout.

## 4. Gate / fixed-points

The canonical full-corpus baselines (from `modern-build/compiler`, for reference) are:
corpus 266/0/80, explorer-solo 61/1, explorer-debug 62/0, dashboard byte-identical,
dbg3 RAW-IDENTICAL. Within this self-contained harness, the intended invariant is:
**every program the TS compiler accepts compiles byte-identically (normalized) to the
oracle in both non-debug and debug**, and the only non-matches are explicit
`UNSUPPORTED:` refusals (refuse-don't-miscompile) — see `../known-gaps.md`.

## Notes / scope
* The `lps/includes/lfc/LFCdhtml*.js` entries are **existence stubs** (symlinks to the
  runtime LFC). The Java compiler only checks that an LFC library *exists* for the
  runtime when linking (`Compiler.java`: `linking && !LFClib.exists()`); it never reads
  the bytes for a SOLO DHTML compile. There is no `LFCdhtml-backtrace.js` stub —
  `compileroptions="backtrace:true"` is a refused build on the TS side.
* SOLO mode (`compiler.proxied=false`, the one-byte `__LZproxied` delta used by the
  distro + the corpus golds) is reached via `solo-config/`; `verify.mjs` always drives
  the oracle and the TS port in SOLO.
* The `patch/` directory is an exact copy of the canonical oracle patch
  (`modern-build/oracle/patch/`) — three debug-only source-location bug-fixes, prepended
  to the classpath. Production output is byte-identical with or without it. See
  `patch/README.md`. Remove the `patch/classes` prefix in `lzc.sh` to use the bit-exact
  stock oracle.
```
