# The prebuilt 4.9.0 oracle binary

Self-contained: this directory carries everything the 4.9.0 compiler needs at
runtime except a JDK.

- **`lps-4.9.0.jar`** (+ **`classes/`**) — the compiler itself. This is the ONLY
  artifact of the original OpenLaszlo 4.9.0 servlet distribution that cannot be
  reproduced from the 4.9 source tree (the source drop ships the 78 dependency jars
  but not the LPS jar itself, and building it needs the retired ant toolchain).
  Preserved here, version-controlled, from `ol-4.9.0-servlet.war` (2010-10-22).
- **`lib/`** — the **7 dependency jars the compiler actually loads** (`jdom`, `saxon`,
  `batik-all-flex`, `commons-collections`, `log4j`, `jakarta-regexp`, `velocity-dep`;
  ≈ 5 MB), copied byte-identical from the servlet's `WEB-INF/lib` (verified
  2026-07-02). This is the subset the DHTML app-compile + LFC library-build paths
  touch — determined by JVM class-load tracing (`-Xlog:class+load`) over the whole
  354-program docs corpus plus the LFC build in all four modes. The servlet's other
  71 jars are SWF/Flex/servlet/DB weight the DHTML path never loads.

`lzc.sh` composes the classpath from these automatically, so **`$OL_ORACLE_JAR` is
optional** — nothing to set beyond `$JAVA_HOME`. To run against a DIFFERENT 4.9.0
build (e.g. the full unpacked servlet), point `$OL_ORACLE_JAR` at its webapp root, a
single `lps.jar`, or a pre-assembled colon-separated classpath:

    OL_ORACLE_JAR="$HERE/prebuilt/lps-4.9.0.jar:$HERE/prebuilt/classes:$(ls .../openlaszlo-4.9.0-src/lps-4.9.0/WEB-INF/lib/*.jar | tr '\n' ':')"
