# The prebuilt 4.9.0 oracle binary

`lps-4.9.0.jar` (+ `classes/`) is the ONLY artifact of the original OpenLaszlo
4.9.0 servlet distribution that cannot be reproduced from the 4.9 source tree
(the source drop ships the 78 dependency jars but not the LPS jar itself, and
building it needs the retired ant toolchain). Preserved here, version-controlled,
from `ol-4.9.0-servlet.war` (2010-10-22).

Compose the oracle classpath from this + the source tree's dependency jars
(byte-identical to the servlet's, verified 2026-07-02):

    OL_ORACLE_JAR="$HERE/prebuilt/lps-4.9.0.jar:$HERE/prebuilt/classes:$(ls .../openlaszlo-4.9.0-src/lps-4.9.0/WEB-INF/lib/*.jar | tr '\n' ':')"
