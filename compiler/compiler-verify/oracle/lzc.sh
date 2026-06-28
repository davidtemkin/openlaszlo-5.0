#!/bin/bash
# OpenLaszlo 4.9.0 compiler "oracle" driver — self-contained, distro-portable.
# Usage: lzc.sh [lzc args...] file.lzx
#
# This runs the prebuilt Java 4.9.0 compiler (org.openlaszlo.compiler.Main)
# against a MINIMAL LPS_HOME bundled alongside this script (./lps-home), which
# contains only the OL4-unique config/schema/internal files the compiler reads
# at runtime. The runtime components/ and fonts/ are SYMLINKS into the distro's
# openlaszlo-5.0/runtime/ tree (no duplication).
#
# EXTERNAL prerequisites (NOT bundled — install/obtain yourself; see README.md):
#   $JAVA_HOME      -> a JDK 17 install (e.g. /opt/homebrew/opt/openjdk@17)
#   $OL_ORACLE_JAR  -> the prebuilt OpenLaszlo 4.9.0 compiler classpath. Either:
#                        * a single lps.jar, OR
#                        * a colon-separated classpath, OR
#                        * a directory containing the WEB-INF/lib/*.jar + classes
#                          (the unpacked 4.9.0 servlet's WEB-INF dir works).
#
# PATCH: patch/classes (prepended to the classpath) holds THREE debug-only
# source-location bug-fixes (see patch/README.md). Production output is
# byte-identical with or without them. Remove the prefix to revert to the
# bit-exact stock oracle.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LPS_HOME_DIR="$HERE/lps-home"
PATCH="$HERE/patch/classes"

# --- materialize the runtime symlinks (kept OUT of the committed tree) -----
# The minimal LPS_HOME needs the distro's runtime components/ and fonts/ at
# lps-home/lps/{components,fonts}. Rather than commit symlinks, recreate them
# here (idempotent) pointing at the shared openlaszlo-5.0/runtime/ tree. They
# are listed in compiler-verify/.gitignore so the committed tree has no links.
for _lnk in components fonts; do
  ln -sfn "../../../../../runtime/$_lnk" "$LPS_HOME_DIR/lps/$_lnk"
done

# --- validate external prerequisites -------------------------------------
if [ -z "${JAVA_HOME:-}" ]; then
  echo "lzc.sh: ERROR \$JAVA_HOME is unset. Install JDK 17 and export JAVA_HOME." >&2
  echo "        e.g. brew install openjdk@17; export JAVA_HOME=/opt/homebrew/opt/openjdk@17" >&2
  exit 2
fi
if [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "lzc.sh: ERROR no java at \$JAVA_HOME/bin/java ($JAVA_HOME/bin/java)." >&2
  exit 2
fi
if [ -z "${OL_ORACLE_JAR:-}" ]; then
  echo "lzc.sh: ERROR \$OL_ORACLE_JAR is unset. Point it at the prebuilt OL 4.9.0" >&2
  echo "        compiler classpath (a single lps.jar, a colon-separated classpath," >&2
  echo "        or an unpacked servlet WEB-INF directory). See README.md." >&2
  exit 2
fi

# --- assemble the oracle classpath ---------------------------------------
# Accept a directory (resolve WEB-INF/lib/*.jar + WEB-INF/classes), a single
# jar, or an already-formed colon-separated classpath.
if [ -d "$OL_ORACLE_JAR" ]; then
  WI="$OL_ORACLE_JAR"
  [ -d "$WI/WEB-INF/lib" ] && WI="$WI/WEB-INF"          # given the webapp root
  JARCP="$(find "$WI/lib" -name '*.jar' 2>/dev/null | tr '\n' ':')"
  ORACLE_CP="${JARCP}${WI}/classes"
else
  ORACLE_CP="$OL_ORACLE_JAR"
fi

CP="$PATCH:$ORACLE_CP"

# --- SOLO mode (LZC_SOLO=1) ----------------------------------------------
# The corpus golds + the distro apps are SOLO builds (compile property
# proxied=false -> the canvas.__LZproxied="false" one-byte delta). SOLO is
# reached by overriding the config dir with one whose lps.properties sets
# compiler.proxied=false (the -D default is otherwise overridden by the file).
# Default = proxied (the stock build); set LZC_SOLO=1 to match the golds.
SOLO_OPT=()
if [ "${LZC_SOLO:-}" = "1" ]; then
  SOLO_OPT=(-Dlps.config.dir.abs="$HERE/solo-config")
fi

# --- default the output to a scratch dir (never write next to source) -----
case " $* " in
  *" --dir "*|*" --dir="*) ;;
  *) OUT="${LZC_OUT:-${TMPDIR:-/tmp}/lzc-verify-out}"; mkdir -p "$OUT"; set -- --dir "$OUT" "$@";;
esac

exec "$JAVA_HOME/bin/java" -cp "$CP" -DLPS_HOME="$LPS_HOME_DIR" \
  ${SOLO_OPT[@]+"${SOLO_OPT[@]}"} org.openlaszlo.compiler.Main "$@"
