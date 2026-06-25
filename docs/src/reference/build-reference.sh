#!/bin/bash
# Build the LZX element reference (docs/reference/index.html) from the LFC + component
# sources WITHOUT Ant. The official Ant build only orchestrates two tools we run directly:
#   - org.openlaszlo.js2doc.Main   (in lps-4.9.0.jar — the same jar as the oracle compiler)
#   - docs/src/xsl/lzx2js2doc.xsl  (LZX XML -> raw js2doc, for the .lzx components)
# Then docs/src/reference/refguide-elements.xsl renders the js2doc XML -> HTML.
#
# Deps: JDK17, xsltproc, brew `docbook` (XML catalog for DTDs). Run: bash build-reference.sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"                 # openlaszlo/docs/src/reference
DOCS="$(cd "$HERE/../.." && pwd)"                      # openlaszlo/docs
REPO="$(cd "$HERE/../../../.." && pwd)"               # repo root (…/OpenLaszlo)
JH=/opt/homebrew/opt/openjdk@17
WEBAPP="$REPO/downloads/ol-4.9.0-servlet"             # the oracle webapp (jars)
LPSSRC="$REPO/lps-4.9.0-src/lps-4.9.0"               # LFC .lzs source (LPS_HOME)
COMP="$REPO/openlaszlo/runtime/components"            # component .lzx source
CP="$(ls "$WEBAPP"/WEB-INF/lib/*.jar | tr '\n' ':')"
export XML_CATALOG_FILES=/opt/homebrew/etc/xml/catalog
JAVA() { "$JH/bin/java" -cp "$CP" -DLPS_HOME="$LPSSRC" -DJS2DOC_LIBROOT="$LPSSRC" "$@"; }

echo "[1/4] js2doc: LFC core elements (view, text, canvas, …)"
rm -rf /tmp/js2doc-lfc && mkdir -p /tmp/js2doc-lfc
JAVA org.openlaszlo.js2doc.Main --dir /tmp/js2doc-lfc "$LPSSRC/WEB-INF/lps/lfc/LaszloLibrary.lzs" 2>/dev/null
cp /tmp/js2doc-lfc/LaszloLibrary.xml "$HERE/LaszloLibrary.xml"

echo "[2/4] lzx2js2doc: components .lzx -> raw js2doc (incl. incubator)"
# library.lzx is the stock doc-tool component set but omits incubator/ (colorpicker,
# autocompletecombobox, the validators, …) which the original reference documented; add it.
cat > "$COMP/_doclibrary.lzx" <<'XEOF'
<library>
  <include href="library.lzx"/>
  <include href="incubator/library.lzx"/>
</library>
XEOF
xsltproc --nonet --stringparam base.dir "$COMP" --stringparam root.path "lps/components/" \
  "$DOCS/src/xsl/lzx2js2doc.xsl" "$COMP/_doclibrary.lzx" > /tmp/components-raw.xml
rm -f "$COMP/_doclibrary.lzx"

echo "[3/4] js2doc --reprocess: components (button, window, list, …)"
JAVA org.openlaszlo.js2doc.Main --libraryid components --reprocess \
  --out "$HERE/components.xml" /tmp/components-raw.xml 2>/dev/null

echo "[4/4] render multi-page reference -> docs/reference/ (per-class pages + shared sidebar)"
xsltproc "$HERE/refguide-multi.xsl" "$HERE/LaszloLibrary.xml" > /tmp/ref-blob.html
node "$HERE/split-reference.mjs" /tmp/ref-blob.html
