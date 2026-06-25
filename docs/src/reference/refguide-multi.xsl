<?xml version="1.0" encoding="UTF-8"?>
<!-- Multi-page LZX reference: emits ONE blob of <div class="element"> blocks (LFC tags +
     non-tag classes + components + compiler tags), each tagged with id/name/cat. A Node
     pass (split-reference.mjs) then splits it into per-class pages with a shared sidebar.
     Cross-links are emitted as #<key> and rewritten to <key>.html by the splitter. -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="xml" indent="no" encoding="UTF-8" omit-xml-declaration="yes"/>

  <xsl:variable name="langref" select="document('langref.xml')"/>
  <xsl:variable name="components" select="document('components.xml')"/>

  <!-- Tags = anything carrying an lzxname (skip _-internal): LFC elements + components.
       Language = the hand-written compiler tags from langref. Classes = LFC properties
       that define a class but have NO lzxname (services/utilities: LzDebugService, …). -->
  <xsl:variable name="elemtags" select="(//property | $components//property)[doc/tag[@name='lzxname'] and not(starts-with(doc/tag[@name='lzxname']/text,'_'))]"/>
  <xsl:variable name="langtags" select="$langref//property[doc/tag[@name='lzxname'] and not(starts-with(doc/tag[@name='lzxname']/text,'_'))]"/>
  <!-- documented public classes WITHOUT an lzxname (services/utilities: LzDebugService,
       and the optional-library classes lz.Test/lz.XMLHttpRequest in components.xml). The
       dot test keeps top-level (incl. namespaced lz.Foo) but drops .prototype./.__ivars__
       MEMBERS (which carry >1 dot). -->
  <xsl:variable name="classes" select="(//property | $components//property)[class and not(doc/tag[@name='lzxname']) and not(starts-with(@id,'$')) and not(starts-with(@id,'_')) and not(contains(substring-after(@id,'.'),'.')) and (class/@access='public' or not(class/@access))]"/>
  <!-- documented top-level Lz* properties with a description but NO formal <class> node -->
  <xsl:variable name="bareclasses" select="//property[(doc/tag[@name='shortdesc'] or doc/text/p) and not(class) and not(object) and not(doc/tag[@name='lzxname']) and starts-with(@id,'Lz') and not(contains(substring-after(@id,'.'),'.'))]"/>
  <!-- documented lz.* namespace singletons (lz.Delegate, lz.CSSStyle, …) — fill gaps where
       the impl class wasn't keyed to the original name; the splitter's whitelist keeps only
       documented/public ones, and a real class dedupe-wins (richer content). -->
  <xsl:variable name="instances" select="//property[starts-with(@id,'lz.') and not(contains(substring-after(@id,'.'),'.')) and (doc/tag[@name='shortdesc'] or doc/text/p) and not(doc/tag[@name='lzxname'])]"/>
  <!-- for extends/seealso cross-links: all documented things keyed by @id -->
  <xsl:variable name="all" select="$elemtags | $langtags | $classes | $bareclasses | $instances"/>

  <xsl:template match="/">
    <xsl:text>&#10;</xsl:text>
    <div class="reference-root">
      <xsl:for-each select="$elemtags"><xsl:call-template name="element"><xsl:with-param name="cat" select="'tag'"/></xsl:call-template></xsl:for-each>
      <xsl:for-each select="$langtags"><xsl:call-template name="element"><xsl:with-param name="cat" select="'lang'"/></xsl:call-template></xsl:for-each>
      <xsl:for-each select="$classes"><xsl:call-template name="element"><xsl:with-param name="cat" select="'class'"/></xsl:call-template></xsl:for-each>
      <xsl:for-each select="$bareclasses"><xsl:call-template name="element"><xsl:with-param name="cat" select="'class'"/></xsl:call-template></xsl:for-each>
      <xsl:for-each select="$instances"><xsl:call-template name="element"><xsl:with-param name="cat" select="'class'"/></xsl:call-template></xsl:for-each>
    </div>
  </xsl:template>

  <!-- compute the page key for the context property: lzxname, else lowercased class id -->
  <xsl:template name="keyof">
    <xsl:param name="node" select="."/>
    <xsl:variable name="lzx" select="normalize-space($node/doc/tag[@name='lzxname']/text)"/>
    <xsl:choose>
      <xsl:when test="$lzx != ''"><xsl:value-of select="translate($lzx,'ABCDEFGHIJKLMNOPQRSTUVWXYZ ','abcdefghijklmnopqrstuvwxyz-')"/></xsl:when>
      <xsl:otherwise>
        <xsl:variable name="raw" select="substring-before(concat($node/@id,'+'),'+')"/>
        <xsl:variable name="nolz">
          <xsl:choose>
            <xsl:when test="starts-with($raw,'Lz')"><xsl:value-of select="substring($raw,3)"/></xsl:when>
            <xsl:when test="starts-with($raw,'lz.')"><xsl:value-of select="substring($raw,4)"/></xsl:when>
            <xsl:otherwise><xsl:value-of select="$raw"/></xsl:otherwise>
          </xsl:choose>
        </xsl:variable>
        <xsl:value-of select="translate($nolz,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')"/>
      </xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template name="element">
    <xsl:param name="cat"/>
    <xsl:variable name="key"><xsl:call-template name="keyof"/></xsl:variable>
    <xsl:variable name="lzx" select="normalize-space(doc/tag[@name='lzxname']/text)"/>
    <xsl:variable name="dispname">
      <xsl:choose>
        <xsl:when test="$lzx != ''"><xsl:value-of select="$lzx"/></xsl:when>
        <xsl:otherwise><xsl:value-of select="substring-before(concat(@id,'+'),'+')"/></xsl:otherwise>
      </xsl:choose>
    </xsl:variable>
    <xsl:variable name="ivars" select="class/property[@name='__ivars__']/object/property | class/property[@name='__ivars__']/property"/>
    <xsl:variable name="attrs" select="$ivars[doc/tag[@name='lzxtype'] and not(doc/tag[@name='lzxtype']/text='event') and not(starts-with(@name,'_'))]"/>
    <xsl:variable name="events" select="$ivars[doc/tag[@name='lzxtype']/text='event']"/>
    <xsl:variable name="methods" select="class/property[@name='prototype']/object/property[@access='public' and not(starts-with(@name,'$'))]"/>
    <div class="element" id="{$key}" data-cat="{$cat}" data-name="{$dispname}" data-access="{@access}">
      <h1>
        <xsl:choose>
          <xsl:when test="$cat='class'"><xsl:value-of select="$dispname"/></xsl:when>
          <xsl:otherwise><span class="ang">&lt;</span><xsl:value-of select="$dispname"/><span class="ang">&gt;</span></xsl:otherwise>
        </xsl:choose>
      </h1>
      <p class="short"><xsl:value-of select="doc/tag[@name='shortdesc']/text"/></p>
      <xsl:if test="class/@extends">
        <p class="meta">Extends <xsl:call-template name="extlink"><xsl:with-param name="cls" select="class/@extends"/></xsl:call-template></p>
      </xsl:if>
      <xsl:apply-templates select="doc/text"/>
      <xsl:if test="$attrs">
        <h3>Attributes</h3>
        <table><tr><th>Name</th><th>Type</th><th>Default</th><th>Description</th></tr>
          <xsl:for-each select="$attrs"><xsl:sort select="@name"/>
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

  <!-- link a referenced class name to its page if it is itself documented -->
  <xsl:template name="extlink">
    <xsl:param name="cls"/>
    <xsl:variable name="t" select="$all[@id=$cls]"/>
    <xsl:choose>
      <xsl:when test="$t">
        <xsl:variable name="tkey"><xsl:call-template name="keyof"><xsl:with-param name="node" select="$t"/></xsl:call-template></xsl:variable>
        <a href="#{$tkey}"><code><xsl:value-of select="$cls"/></code></a>
      </xsl:when>
      <xsl:otherwise><code><xsl:value-of select="$cls"/></code></xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template match="text" priority="6"><xsl:apply-templates/></xsl:template>
  <xsl:template match="programlisting" priority="5"><pre><code><xsl:apply-templates/></code></pre></xsl:template>
  <xsl:template match="literal|code|sgmltag|tagname|var|varname|replaceable|attribute|classname|methodname|command|constant|property|type" priority="5"><code><xsl:apply-templates/></code></xsl:template>
  <xsl:template match="em|emphasis|i" priority="5"><em><xsl:apply-templates/></em></xsl:template>
  <xsl:template match="b|strong" priority="5"><strong><xsl:apply-templates/></strong></xsl:template>
  <xsl:template match="link|xref|ulink" priority="5"><xsl:apply-templates/></xsl:template>
  <!-- <example> wraps a code listing: most hold raw escaped code (wrap in <pre>); some
       carry a <programlisting> child that already renders as <pre> (just pass through). -->
  <xsl:template match="example" priority="5">
    <xsl:choose>
      <xsl:when test="programlisting"><xsl:apply-templates/></xsl:when>
      <xsl:otherwise><pre class="example"><xsl:apply-templates/></pre></xsl:otherwise>
    </xsl:choose>
  </xsl:template>
  <xsl:template match="note" priority="5"><div class="note"><xsl:apply-templates/></div></xsl:template>
  <xsl:template match="seealso" priority="5"><p class="meta">See also: <xsl:apply-templates/></p></xsl:template>
  <xsl:template match="classes|see" priority="5"><code><xsl:value-of select="normalize-space(.)"/></code><xsl:text> </xsl:text></xsl:template>
  <xsl:template match="component-design|topic|subtopic|devnote|todo" priority="5"/>
  <xsl:template match="p|ul|ol|li|dl|dt|dd|br|pre" priority="5"><xsl:element name="{local-name()}"><xsl:apply-templates/></xsl:element></xsl:template>
  <!-- keep the href (the generic copy above drops attributes); split-reference.mjs
       rewrites the old lz.X.html / LzX.html scheme to our <key>.html pages. -->
  <xsl:template match="a" priority="5"><a href="{@href}"><xsl:apply-templates/></a></xsl:template>
  <xsl:template match="tag" priority="5"/>
  <xsl:template match="*" priority="-9"><code>&lt;<xsl:value-of select="local-name()"/>&gt;<xsl:apply-templates/>&lt;/<xsl:value-of select="local-name()"/>&gt;</code></xsl:template>
</xsl:stylesheet>
