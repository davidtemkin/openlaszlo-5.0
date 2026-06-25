<?xml version="1.0" encoding="UTF-8"?>
<!-- Renders the LZX reference (elements + structural tags) from js2doc XML, with no
     DocBook-XSL / Ant dependency. Main input = the LFC js2doc (LaszloLibrary.xml from
     org.openlaszlo.js2doc.Main); also pulls the hand-written compiler tags from
     langref.xml via document(). Each documented element/tag = a <property> whose
     doc has an @lzxname; its attributes/events are class/property[@name='__ivars__']
     (lzxtype="event" => event), methods are in prototype, and class/@extends is the
     superclass.  Build: xsltproc refguide-elements.xsl LaszloLibrary.xml > index.html -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" indent="no" encoding="UTF-8"
              doctype-public="-//W3C//DTD HTML 4.01 Transitional//EN"/>

  <xsl:key name="byid" match="property" use="@id"/>
  <xsl:variable name="langref" select="document('langref.xml')"/>
  <xsl:variable name="components" select="document('components.xml')"/>
  <!-- every documented tag/element: core LFC elements (main input) + compiler tags
       (langref) + components (components.xml); skip _-prefixed internal classes. -->
  <xsl:variable name="tags" select="(//property | $langref//property | $components//property)[doc/tag[@name='lzxname'] and not(starts-with(doc/tag[@name='lzxname']/text,'_'))]"/>

  <xsl:template match="/">
    <html>
      <head>
        <title>LZX Element Reference</title>
        <style type="text/css">
          body{font:14px/1.55 -apple-system,Helvetica,Arial,sans-serif;color:#222;max-width:900px;margin:0 auto;padding:20px 34px 80px}
          h1{font-size:25px;border-bottom:2px solid #394660;padding-bottom:8px;color:#394660}
          h2{font-size:21px;margin-top:40px;color:#394660;border-bottom:1px solid #ccd;padding-bottom:3px}
          h2 .ang{color:#8a94a6;font-weight:normal}
          h3{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#778;margin:1.4em 0 .4em}
          .short{font-style:italic;color:#445;margin:.2em 0 .6em}
          .meta{font-size:12px;color:#778;margin:0 0 1em}
          .meta code{background:none;color:#36c}
          code{background:#f2f3f6;padding:1px 4px;border-radius:3px;font-family:Menlo,monospace;font-size:.9em;color:#234}
          pre{background:#f6f7f9;border:1px solid #e2e4ea;border-left:3px solid #8aa;padding:10px 14px;overflow:auto;font:12.5px/1.45 Menlo,monospace;border-radius:3px}
          pre code{background:none;padding:0}
          table{border-collapse:collapse;width:100%;margin:.3em 0 1.2em;font-size:13px}
          th,td{border:1px solid #dde;padding:5px 9px;text-align:left;vertical-align:top}
          th{background:#eef;color:#394660}
          td.nm{font-family:Menlo,monospace;white-space:nowrap;color:#225}
          td.ty{font-family:Menlo,monospace;color:#778;font-size:12px;white-space:nowrap}
          ul.toc{columns:4;-webkit-columns:4;list-style:none;padding:14px 18px;border:1px solid #e2e4ea;background:#fafbfc;border-radius:5px}
          ul.toc li{margin:.12em 0}
          ul.toc a{font-family:Menlo,monospace;font-size:12.5px;text-decoration:none;color:#338}
          ul.events{list-style:none;padding-left:0}
          ul.events li{margin:.25em 0}
          ul.events code{color:#638}
          ul.methods{columns:2;-webkit-columns:2;list-style:none;padding-left:0;font-size:13px}
          ul.methods code{color:#262}
          .element{padding-top:10px;border-top:1px solid #eee;margin-top:10px}
          a{color:#36c;text-decoration:none}a:hover{text-decoration:underline}
          .back{font-size:12px;float:right}
        </style>
      </head>
      <body>
        <h1>LZX Element Reference</h1>
        <p>Reference for the LZX tags and elements, generated from the LFC source. See also
           the <a href="../developers/index.html">Developer's Guide</a>.
           <xsl:value-of select="count($tags)"/> entries.</p>
        <ul class="toc">
          <xsl:for-each select="$tags">
            <xsl:sort select="doc/tag[@name='lzxname']/text"/>
            <li><a href="#{translate(normalize-space(doc/tag[@name='lzxname']/text),' ','-')}">&lt;<xsl:value-of select="doc/tag[@name='lzxname']/text"/>&gt;</a></li>
          </xsl:for-each>
        </ul>
        <xsl:for-each select="$tags">
          <xsl:sort select="doc/tag[@name='lzxname']/text"/>
          <xsl:call-template name="element"/>
        </xsl:for-each>
      </body>
    </html>
  </xsl:template>

  <xsl:template name="element">
    <xsl:variable name="ivars" select="class/property[@name='__ivars__']/object/property | class/property[@name='__ivars__']/property"/>
    <!-- real LZX attributes/events are exactly the ivars carrying an @lzxtype
         (internal __LZ*/__set_* vars have none); events are lzxtype="event". -->
    <xsl:variable name="attrs" select="$ivars[doc/tag[@name='lzxtype'] and not(doc/tag[@name='lzxtype']/text='event') and not(starts-with(@name,'_'))]"/>
    <xsl:variable name="events" select="$ivars[doc/tag[@name='lzxtype']/text='event']"/>
    <xsl:variable name="methods" select="class/property[@name='prototype']/object/property[@access='public' and not(starts-with(@name,'$'))]"/>
    <div class="element" id="{translate(normalize-space(doc/tag[@name='lzxname']/text),' ','-')}">
      <h2><span class="ang">&lt;</span><xsl:value-of select="doc/tag[@name='lzxname']/text"/><span class="ang">&gt;</span></h2>
      <p class="short"><xsl:value-of select="doc/tag[@name='shortdesc']/text"/></p>
      <xsl:if test="class/@extends">
        <p class="meta">Extends <xsl:call-template name="extlink"><xsl:with-param name="cls" select="class/@extends"/></xsl:call-template>
          <xsl:if test="@unitid"> &#183; <xsl:value-of select="@unitid"/></xsl:if></p>
      </xsl:if>
      <!-- the prose description (direct doc/text, not the shortdesc tag) -->
      <xsl:apply-templates select="doc/text"/>
      <xsl:if test="$attrs">
        <h3>Attributes</h3>
        <table><tr><th>Name</th><th>Type</th><th>Default</th><th>Description</th></tr>
          <xsl:for-each select="$attrs">
            <xsl:sort select="@name"/>
            <tr><td class="nm"><xsl:value-of select="@name"/></td>
              <td class="ty"><xsl:value-of select="doc/tag[@name='lzxtype']/text"/></td>
              <td class="ty"><xsl:value-of select="doc/tag[@name='lzxdefault']/text"/></td>
              <td><xsl:apply-templates select="doc/text"/></td></tr>
          </xsl:for-each>
        </table>
      </xsl:if>
      <xsl:if test="$events">
        <h3>Events</h3>
        <ul class="events">
          <xsl:for-each select="$events"><xsl:sort select="@name"/>
            <li><code><xsl:value-of select="@name"/></code> &#8212; <xsl:apply-templates select="doc/text"/></li>
          </xsl:for-each>
        </ul>
      </xsl:if>
      <xsl:if test="$methods">
        <h3>Methods</h3>
        <ul class="methods">
          <xsl:for-each select="$methods"><xsl:sort select="@name"/>
            <li><code><xsl:value-of select="@name"/>()</code></li>
          </xsl:for-each>
        </ul>
      </xsl:if>
    </div>
  </xsl:template>

  <!-- link a superclass name to its element anchor if it is itself a documented element -->
  <xsl:template name="extlink">
    <xsl:param name="cls"/>
    <xsl:variable name="t" select="$tags[@id=$cls]"/>
    <xsl:choose>
      <xsl:when test="$t"><a href="#{translate(normalize-space($t/doc/tag[@name='lzxname']/text),' ','-')}"><code><xsl:value-of select="$cls"/></code></a></xsl:when>
      <xsl:otherwise><code><xsl:value-of select="$cls"/></code></xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- ===== inline doc content -> HTML (explicit priorities; libxslt ranks * high) ===== -->
  <xsl:template match="text" priority="6"><xsl:apply-templates/></xsl:template>
  <xsl:template match="programlisting" priority="5"><pre><code><xsl:apply-templates/></code></pre></xsl:template>
  <xsl:template match="literal|code|sgmltag|tagname|var|varname|replaceable|attribute|classname|methodname|command|constant|property|type" priority="5"><code><xsl:apply-templates/></code></xsl:template>
  <xsl:template match="em|emphasis|i" priority="5"><em><xsl:apply-templates/></em></xsl:template>
  <xsl:template match="b|strong" priority="5"><strong><xsl:apply-templates/></strong></xsl:template>
  <xsl:template match="link|xref|ulink" priority="5"><xsl:apply-templates/></xsl:template>
  <xsl:template match="example|note" priority="5"><xsl:apply-templates/></xsl:template>
  <!-- LFC doc @see/@seealso: render the referenced class names, drop internal refs -->
  <xsl:template match="seealso" priority="5"><p class="meta">See also: <xsl:apply-templates/></p></xsl:template>
  <xsl:template match="classes|see" priority="5"><code><xsl:value-of select="normalize-space(.)"/></code><xsl:text> </xsl:text></xsl:template>
  <xsl:template match="component-design|topic|subtopic|devnote|todo" priority="5"/>
  <xsl:template match="p|ul|ol|li|dl|dt|dd|a|br|pre" priority="5">
    <xsl:element name="{local-name()}"><xsl:apply-templates/></xsl:element>
  </xsl:template>
  <xsl:template match="tag" priority="5"/>
  <xsl:template match="*" priority="-9">
    <code>&lt;<xsl:value-of select="local-name()"/>&gt;<xsl:apply-templates/>&lt;/<xsl:value-of select="local-name()"/>&gt;</code>
  </xsl:template>
</xsl:stylesheet>
