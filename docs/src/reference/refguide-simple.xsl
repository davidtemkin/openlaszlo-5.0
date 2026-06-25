<?xml version="1.0" encoding="UTF-8"?>
<!-- Standalone (no-DocBook-dependency) reference generator for langref.xml.
     The stock refguide-html.xsl pulls the DocBook XSL distro off SourceForge,
     which isn't available offline. This emits a single self-contained HTML page
     documenting the core LZX language tags (langref.xml only carries the 13
     structural/compiler tags; the full element reference is generated from the
     LFC by the Ant doc-build, which we don't run here).
     Build: xsltproc refguide-simple.xsl langref.xml > ../../reference/index.html -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" indent="yes" encoding="UTF-8"
              doctype-public="-//W3C//DTD HTML 4.01 Transitional//EN"/>

  <xsl:template match="/js2doc">
    <html>
      <head>
        <title>LZX Language Reference</title>
        <style type="text/css">
          body{font:14px/1.5 -apple-system,Helvetica,Arial,sans-serif;color:#222;max-width:860px;margin:0 auto;padding:24px 32px}
          h1{font-size:24px;border-bottom:2px solid #394660;padding-bottom:8px;color:#394660}
          h2{font-size:20px;margin-top:34px;color:#394660;border-bottom:1px solid #ccd}
          h2 .ang{color:#8a94a6}
          h3{font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#667}
          .short{font-style:italic;color:#445;margin:.2em 0 1em}
          code{background:#f2f3f6;padding:1px 4px;border-radius:3px;font-family:Menlo,monospace;font-size:.92em}
          pre{background:#f6f7f9;border:1px solid #e2e4ea;border-left:3px solid #8aa;padding:10px 14px;overflow:auto;font-family:Menlo,monospace;font-size:.86em;line-height:1.45}
          pre code{background:none;padding:0}
          table{border-collapse:collapse;width:100%;margin:.5em 0 1.5em;font-size:.93em}
          th,td{border:1px solid #dde;padding:6px 10px;text-align:left;vertical-align:top}
          th{background:#eef;color:#394660}
          td.nm{font-family:Menlo,monospace;white-space:nowrap;color:#338}
          td.ty{font-family:Menlo,monospace;color:#669;font-size:.9em}
          ul.toc{columns:2;list-style:none;padding:0;border:1px solid #e2e4ea;background:#fafbfc;padding:14px 18px;border-radius:5px}
          ul.toc li{margin:.15em 0}
          ul.toc a{font-family:Menlo,monospace;text-decoration:none;color:#338}
          .tag{padding-top:8px}
          a{color:#36c}
          .note{background:#fffdf0;border:1px solid #e8e0b8;padding:8px 14px;border-radius:4px;margin:1em 0}
        </style>
      </head>
      <body>
        <h1>LZX Language Reference</h1>
        <p>Reference for the core LZX structural and compiler tags. For the runtime
           class/element reference (<code>&lt;view&gt;</code>, <code>&lt;text&gt;</code>,
           components, &amp;c.), see the <a href="../developers/index.html">Developer's Guide</a>.</p>
        <ul class="toc">
          <xsl:for-each select="property[starts-with(@id,'tag.')]">
            <xsl:sort select="doc/tag[@name='lzxname']/text"/>
            <li><a href="#{@id}">&lt;<xsl:value-of select="doc/tag[@name='lzxname']/text"/>&gt;</a></li>
          </xsl:for-each>
        </ul>
        <xsl:apply-templates select="property[starts-with(@id,'tag.')]">
          <xsl:sort select="doc/tag[@name='lzxname']/text"/>
        </xsl:apply-templates>
      </body>
    </html>
  </xsl:template>

  <!-- one tag entry -->
  <xsl:template match="property[starts-with(@id,'tag.')]">
    <div class="tag" id="{@id}">
      <h2><span class="ang">&lt;</span><xsl:value-of select="doc/tag[@name='lzxname']/text"/><span class="ang">&gt;</span></h2>
      <p class="short"><xsl:value-of select="doc/tag[@name='shortdesc']/text"/></p>
      <xsl:apply-templates select="doc/text | doc/tag[@name='usage']/text"/>
      <xsl:variable name="attrs" select="class/property[@name='__ivars__']/object/property"/>
      <xsl:if test="$attrs">
        <h3>Attributes</h3>
        <table>
          <tr><th>Attribute</th><th>Type</th><th>Default</th><th>Description</th></tr>
          <xsl:for-each select="$attrs">
            <tr>
              <td class="nm"><xsl:value-of select="@name"/></td>
              <td class="ty"><xsl:value-of select="doc/tag[@name='lzxtype']/text"/></td>
              <td class="ty"><xsl:value-of select="doc/tag[@name='lzxdefault']/text"/></td>
              <td><xsl:apply-templates select="doc/text"/></td>
            </tr>
          </xsl:for-each>
        </table>
      </xsl:if>
    </div>
  </xsl:template>

  <!-- ===== docbook-ish inline/block content -> HTML =====
       (explicit priorities: libxslt scores the `*` catch-all above bare name
       patterns, so pin the specific templates high and the catch-all low.) -->
  <xsl:template match="programlisting" priority="5"><pre><code><xsl:apply-templates/></code></pre></xsl:template>
  <xsl:template match="literal|code|sgmltag|tagname|var|varname|replaceable|attribute|classname|methodname|command" priority="5">
    <code><xsl:apply-templates/></code>
  </xsl:template>
  <xsl:template match="note" priority="5"><div class="note"><xsl:apply-templates/></div></xsl:template>
  <xsl:template match="em|emphasis" priority="5"><em><xsl:apply-templates/></em></xsl:template>
  <xsl:template match="b" priority="5"><strong><xsl:apply-templates/></strong></xsl:template>
  <xsl:template match="link|xref" priority="5"><xsl:apply-templates/></xsl:template>  <!-- drop cross-refs, keep text -->
  <xsl:template match="example" priority="5"><xsl:apply-templates/></xsl:template>    <!-- unwrap; inner programlisting/markup renders -->
  <!-- pass-through HTML-safe structural elements -->
  <xsl:template match="p|ul|ol|li|dl|dt|dd|a|br|div|img|table|tr|td|th|pre|strong" priority="5">
    <xsl:element name="{local-name()}">
      <xsl:for-each select="@*"><xsl:attribute name="{local-name()}"><xsl:value-of select="."/></xsl:attribute></xsl:for-each>
      <xsl:apply-templates/>
    </xsl:element>
  </xsl:template>
  <!-- the js2doc <text> wrapper is transparent (render its children directly) -->
  <xsl:template match="text" priority="6"><xsl:apply-templates/></xsl:template>
  <!-- drop the doc wrapper text-tags we already pulled by name -->
  <xsl:template match="tag" priority="5"/>
  <!-- catch-all: render an unknown element (e.g. a live LZX example tag) as escaped code -->
  <xsl:template match="*" priority="-9">
    <code>&lt;<xsl:value-of select="local-name()"/><xsl:text>&gt;</xsl:text><xsl:apply-templates/><xsl:text>&lt;/</xsl:text><xsl:value-of select="local-name()"/>&gt;</code>
  </xsl:template>
</xsl:stylesheet>
