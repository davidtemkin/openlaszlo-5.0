# compiler-verify — oracle differential verification

A self-contained capability for **byte-for-byte differential verification** of the
distro's TypeScript LZX compiler (`openlaszlo-5.0/compiler/`) against the original
**OpenLaszlo 4.9.0 Java compiler** (the "oracle"). If you download the distro and
modify the TS compiler, this lets you confirm you have not broken byte-parity with
the oracle — across **app compiles** (production / debug / profile / backtrace),
the **LFC runtime library build**, and **real apps**.

The oracle is the ground truth: the harness compiles a set of inputs with *both*
compilers and asserts the (normalized) output is identical. It bundles **only the
OL4-unique files the Java compiler needs at runtime** — a minimal `LPS_HOME`. It does
**NOT** bundle the JDK, the OpenLaszlo jar, the runtime components/fonts/LFC (those are
symlinked into `../../runtime/`), or any golds (those are regenerated locally).

```
compiler-verify/                         (~400 KB committed; no golds/JDK/jar)
  oracle/
    lzc.sh              # self-contained oracle driver ($JAVA_HOME + $OL_ORACLE_JAR)
                        #   - app compiles via org.openlaszlo.compiler.Main
                        #   - LZC_SOLO=1 → proxied=false (SOLO builds, via solo-config/)
                        #   - LZC_SC=1   → org.openlaszlo.sc.Main (the LFC library build)
    lps-home/           # the MINIMAL LPS_HOME (config/schema/misc/font-metric files)
      WEB-INF/lps/{config,misc,schema}/
      lps/
        components ->  ../../../../../runtime/components   (symlink — NOT duplicated)
        fonts      ->  ../../../../../runtime/fonts        (symlink — NOT duplicated)
        includes/lfc/  # LFCdhtml{,-debug,-profile,-backtrace}.js — 99-byte existence
                       # stubs, one per app-compile mode. The app compiler only checks
                       # that the mode's LFC EXISTS when linking; it never reads the bytes.
    solo-config/        # config overlay with compiler.proxied=false (SOLO builds)
    patch/              # the 3 debug-only oracle source-location fixes (see patch/README.md)
  harness/
    verify.mjs          # the differential driver (all modes — see below)
    fixtures/dbg3.lzx   # tiny synthetic debug program for the `dbg3` RAW byte probe
  .goldcache*/          # regenerated golds (gitignored; NEVER committed)
```

This harness is a **self-contained port** of the canonical development harness
`modern-build/compiler/harness/batch.mjs`, retargeted at distro-resident inputs and at
this directory's external-dependency / no-committed-golds model. It is a **read-only
consumer** of `../../runtime/` (components, fonts, LFC source) and `../src/` (the TS
compiler) — it modifies neither.

---

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

### Determinism — why the regenerated golds are reproducible
The oracle's gensyms are otherwise `rand.nextInt()`. Every oracle invocation here
passes (app compiles) / sets (LFC build) **`generatePredictableTemps=true`**, which turns
gensyms into a deterministic base-36 counter (`$lzsc$0, $lzsc$1, …`). So the same oracle
+ the same source produces byte-identical output every run.

The **gold is *my-oracle*** — this 4.9.0 jar running on *your* JDK 17 — **not** the
ancient release binary. The historical 2010 release artifact (`…/LFCdhtml.js` = 428413)
was built on an old JVM whose `HashMap` iteration order differs in the magic-const
banner; the entire TS port matches *my-oracle* output, so the verification regenerates
*my-oracle* golds rather than shipping a stale binary.

---

## 2. Regenerate golds (none are committed)

Golds are hundreds of MB across the full corpus, so they are **not** in git. Generate
them on demand into the gitignored `.goldcache*` dirs:

```
cd openlaszlo-5.0/compiler/compiler-verify

# App-compile golds (docs program corpus, production; debug="true" programs come out
# as debug golds automatically). Default target = ../../docs/src/developers/programs:
node harness/verify.mjs build
node harness/verify.mjs build-profile            # --profile golds -> .goldcache-profile

# LFC runtime library golds (the 4 variants) -> .goldcache-lfc:
node harness/verify.mjs build-oracle-lfc

# Real-app / nav-derived golds:
node harness/verify.mjs build-explorer-solo
node harness/verify.mjs build-explorer-debug
```

---

## 3. Run the checks

```
# --- App compiles (vs .goldcache) ---
node harness/verify.mjs check            # PRODUCTION (debug="true" → source-driven debug)
node harness/verify.mjs check-debug      # forced-debug over the debug-source golds
node harness/verify.mjs check-profile    # --profile (vs .goldcache-profile)
node harness/verify.mjs show <name>      # first-divergence detail for one cached gold
node harness/verify.mjs live <file.lzx>  # compile BOTH fresh (production + debug), no cache

# --- LFC library build (vs .goldcache-lfc) ---
node harness/verify.mjs check-lfc
node harness/verify.mjs check-lfc-debug
node harness/verify.mjs check-lfc-backtrace
node harness/verify.mjs check-lfc-profile

# --- Real apps + single-program RAW byte probes ---
node harness/verify.mjs check-dashboard          # examples/dashboard (live oracle+TS)
node harness/verify.mjs check-explorer-solo      # nav-derived SOLO set
node harness/verify.mjs check-explorer-debug     # nav-derived DEBUG set
node harness/verify.mjs dbg3                      # forced-debug RAW probe (bundled dbg3.lzx)
node harness/verify.mjs btshow                    # backtrace RAW probe (backtrace.lzx)
```
Each `check*` mode reports `N match, M diff, K unsup`. A program is **unsup** when the
TS compiler deliberately *refuses* (`UNSUPPORTED:`) rather than miscompile (the
refuse-don't-miscompile policy). The RAW probes (`dbg3`, `btshow`, `check-dashboard`,
`check-lfc*`) report `RAW IDENTICAL` / `BYTE-IDENTICAL` or the first divergence offset.

### What "byte-for-byte" means here (normalization)
`verify.mjs normalize()` neutralizes a few **non-portable, non-semantic** artifacts on
BOTH sides before comparing (the canonical `batch.mjs` policy, plus one distro rule):
* `appbuilddate` (the embedded compile timestamp);
* multi-frame resource enumeration ORDER (the oracle's JVM `File.list()` order);
* the sprite-sheet machinery (the distro ships `sprites:"none"`);
* the component/font source-path **PREFIX** in `#file` / `reportException` /
  `displayName` attributions. Because `lps-home/lps/components` is a **symlink** into
  `../../runtime/`, the oracle's `relativePath` canonicalizes it to an escaping
  `../../../../runtime/components/…` path while the TS compiler keeps the logical
  `base/colors.lzx` form. Both denote the same source file + line; the prefix (where
  the resources physically live) is stripped on both sides so the gate compares source
  identity + line, not deployment layout. (This last rule is the only normalization
  beyond `batch.mjs`; it is why the debug RAW-probe byte counts here are slightly
  smaller than the canonical figures — see §4.)

---

## 4. The gate / current fixed-points

The intended invariant: **every program the TS compiler accepts compiles byte-identically
(normalized) to the oracle**, and the only non-matches are explicit `UNSUPPORTED:`
refusals. The canonical baselines (from `modern-build/compiler`, the development tree)
are:

| mode                  | gate                         |
|-----------------------|------------------------------|
| `check`               | 346 / 0 / 0                  |
| `check-debug`         | 78 / 0 / 0                   |
| `check-profile`       | 263 / 0 / 0                  |
| `check-explorer-solo` | 0 diff / 0 unsup             |
| `check-explorer-debug`| 0 diff / 0 unsup  (62 / 0 / 0 canonical) |
| `check-dashboard`     | BYTE-IDENTICAL               |
| `dbg3`                | RAW IDENTICAL (845661 canonical) |
| `btshow`              | RAW IDENTICAL (1340227 canonical)|
| `check-lfc`           | RAW IDENTICAL — **426989**   |
| `check-lfc-debug`     | RAW IDENTICAL — **1179477**  |
| `check-lfc-backtrace` | RAW IDENTICAL — **2207200**  |
| `check-lfc-profile`   | RAW IDENTICAL — **1463512**  |

**Two count caveats for a downloader running this self-contained harness:**

1. **Program counts depend on the corpus present in YOUR distro.** The canonical
   `check` = 346 and the explorer = 62 come from the development tree's program sets.
   In this distro, `check-explorer-solo` enumerates `explorer/nav_dhtml.xml` and
   currently yields **67 / 0 / 0** (the distro nav links more programs than the
   lps-4.9-src nav). What is invariant — and what you should require — is **0 diff,
   0 unsup**, not the exact `N`.

2. **The two debug RAW probes report slightly smaller byte totals here** than the
   canonical 845661 / 1340227, because of the symlink resource-path-prefix
   normalization (§3, last bullet): `dbg3` → **842284**, `btshow` → **1336920**.
   Both are `RAW IDENTICAL` — the byte-parity property holds on both sides; only the
   absolute (path-prefix-stripped) total differs. The **LFC** golds carry no resource
   paths, so they reproduce the canonical totals exactly (426989 / 1179477 / 2207200 /
   1463512), as do the LFC differentials.

---

## 5. The shipped LFC vs the byte-parity gold

`check-lfc*` verifies that the TS compiler builds the LFC **byte-identical to the
oracle** from `../../runtime/lfc-src/` (which stays PRISTINE). That **pristine** LFC is
*not* what the distro actually ships at runtime. The shipped `../../runtime/lfc/{lfc.js,
lfc-debug.js,lfc-backtrace.js,lfc-profile.js}` is the pristine TS build **plus exactly
three small, documented "distro deltas"** re-applied on top by
`../../runtime/lfc/apply-distro-deltas.mjs` (the deltas are NEVER folded into the
source, so the byte-parity golds above stay fixed):

* **(a) `use_css_sprites: false`** — flip `LzSprite.quirks.use_css_sprites` from the
  pristine `true` to `false`. The Java-free distro renders multi-frame resources from
  individual frame PNGs, not CSS sprite-sheets, so the sheet code path is disabled.
* **(b) iOS `touchcancel` recovery** — an appended IIFE that releases a stuck mouse-down
  when mobile Safari fires `touchcancel` instead of `touchend`.
* **(c) `colortransform` / `setColorTransform`** — an appended IIFE that implements the
  missing DHTML sprite-kernel primitive `LzSprite#setColorTransform` (an SVG
  `feColorMatrix` filter) and flips the `colortransform` capability on (window/scrollbar
  tinting).

So: **`runtime/lfc/*.js` (shipped) = pristine TS LFC + the 3 deltas**, a few KB larger
than the `check-lfc*` golds and distinct from them. compiler-verify checks **only the
pristine build** (the byte-parity contract with the oracle); the deltas are a separate,
documented overlay verified by the distro's own runtime, not the oracle.

> **Font note:** the harness's minimal `lps-home` bundles the OL4 font-metric files
> (`misc/vera.fft`, the advance-table) that the oracle reads during compilation; without
> them the oracle's font-bearing builds would diverge. They are part of the committed
> minimal `lps-home`, not regenerated.

---

## Notes / scope

* SOLO mode (`compiler.proxied=false`, the one-byte `__LZproxied` delta) is reached via
  `solo-config/` (`LZC_SOLO=1` on the oracle; `--solo`/`LZC_SOLO=1` on the TS port). The
  docs-corpus `check`/`check-debug`/`check-profile` + `dbg3` run **proxied** (matching
  the canonical golds); `check-explorer-*` + `btshow` run **SOLO**.
* The `patch/` directory is an exact copy of the canonical oracle patch
  (`modern-build/oracle/patch/`) — three debug-only source-location bug-fixes prepended
  to the classpath. **Production output is byte-identical with or without it.** See
  `patch/README.md`. Remove the `patch/classes` prefix in `lzc.sh` to use the bit-exact
  stock oracle.
* The runtime symlinks (`lps-home/lps/{components,fonts}`) are **recreated at run time**
  by `lzc.sh` (idempotent) and gitignored, so the committed tree is symlink-free.
* **Not ported** (development-internal, not part of the distro verification story): the
  `modern-build` `fixtures` gate (a dev-scratch fixture suite with committed `.sprite.png`
  goldens, redundant with the larger distro `check` corpus) and the full-corpus `build-ol`
  / `check-ol` sweep (the same programs `check` already covers from distro sources).
```
