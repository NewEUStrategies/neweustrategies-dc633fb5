// Arkusz XSLT 1.0, który w przeglądarce pokazuje plik mapy strony jako
// czytelną stronę. Jeden arkusz obsługuje trzy rodzaje plików:
//   * indeks (`<sitemapindex>`) - lista plików map z linkami i datą zmiany;
//   * mapę adresów (`<urlset>`) - adresy z wersjami językowymi (hreflang),
//     datą zmiany, częstotliwością i priorytetem;
//   * mapę Google News (`<urlset>` z `news:news`) - tytuł, język, data
//     publikacji.
//
// OGRANICZENIA, KTÓRE TEN PLIK ŚWIADOMIE RESPEKTUJE:
//   * wyłącznie XSLT/XPath 1.0 - tylko tę wersję mają przeglądarki (libxslt
//     w Chrome i Safari, TransforMiiX w Firefoksie); bez osi `namespace::`,
//     której Firefox nie obsługuje;
//   * host bierzemy z pierwszego `<loc>` - XSLT nie zna adresu dokumentu;
//   * zero zasobów zewnętrznych: style i skrypt są w środku, więc wygląd nie
//     zależy od CDN, fontów ani CSP (odpowiedź XML nie dostaje CSP, ale arkusz
//     i tak niczego z zewnątrz nie ładuje);
//   * skrypt filtra nie zawiera znaków `<` ani `&` - przechodzi bez zmian
//     przez serializację XML -> HTML w każdym silniku, a strona działa też
//     bez niego (filtr jest dodatkiem);
//   * wartości z mapy idą przez `xsl:value-of` i szablony wartości atrybutów,
//     czyli są escapowane przez procesor - arkusz nie wstrzykuje surowego
//     tekstu z dokumentu.
//
// Napisy po polsku - kokpit SEO i redakcja są polskie; robotom ten widok
// jest obojętny.

const STYLE = `
:root{color-scheme:light dark;--bg:#ffffff;--fg:#14161a;--muted:#5b6270;--line:#e5e7eb;--soft:#f6f7f9;--accent:#b4410f;--note:#fff3ea;--badge:#fa9346}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--fg:#e9ebef;--muted:#9aa1ad;--line:#262a31;--soft:#161920;--accent:#fa9346;--note:#2a1d14}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.wrap{max-width:1120px;margin:0 auto;padding:28px 16px 48px}
.top{display:flex;align-items:center;gap:10px;margin:0 0 24px}
.site{color:var(--fg);font-weight:600;text-decoration:none}
.badge{font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.06em;color:#1a1208;background:var(--badge);border-radius:4px;padding:4px 6px}
.crumbs{margin:0 0 6px;font-size:14px}
a{color:var(--accent);text-decoration:none}
a:hover,a:focus-visible{text-decoration:underline}
h1{font-size:28px;line-height:1.2;margin:0 0 8px;letter-spacing:-.01em}
.lede{color:var(--muted);max-width:72ch;margin:0 0 20px}
.stats{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 20px;padding:0}
.stats div{background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:10px 14px;min-width:150px}
.stats dt{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.stats dd{margin:2px 0 0;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.tools{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:0 0 12px}
.tools input{flex:1 1 260px;max-width:420px;font:inherit;color:inherit;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:9px 12px}
.tools input:focus{outline:2px solid var(--accent);outline-offset:1px}
.tools output{color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:10px 14px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
th{background:var(--soft);font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover td{background:var(--soft)}
td.n{color:var(--muted);font-variant-numeric:tabular-nums;width:1%;white-space:nowrap}
td.url{word-break:break-all;min-width:240px}
td.url small{display:block;color:var(--muted);word-break:break-all}
td.date,td.meta{white-space:nowrap;color:var(--muted);font-variant-numeric:tabular-nums}
.lang{display:inline-block;font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;border:1px solid var(--line);border-radius:4px;padding:3px 5px;margin:0 4px 4px 0}
footer{margin-top:24px;color:var(--muted);font-size:13px;max-width:72ch}
@media (max-width:640px){h1{font-size:23px}.hide-sm{display:none}th,td{padding:8px 10px}td.url{min-width:0}.stats div{min-width:0;flex:1 1 140px}}
`;

// Filtr wierszy: bez `<` i `&` (patrz nagłówek pliku).
const SCRIPT = `
(function(){var q=document.getElementById('q');var t=document.getElementById('rows');var o=document.getElementById('shown');if(!q||!t||!t.tBodies.length)return;var rows=t.tBodies[0].rows;q.addEventListener('input',function(){var v=q.value.toLowerCase().trim();var n=0;for(var i=0;i!==rows.length;i++){var hit=!v||rows[i].textContent.toLowerCase().indexOf(v)!==-1;rows[i].hidden=!hit;if(hit)n++}if(o)o.textContent=String(n)})})();
`;

const XSL = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  exclude-result-prefixes="s news xhtml">
  <xsl:output method="html" encoding="UTF-8" indent="no" doctype-system="about:legacy-compat"/>

  <xsl:variable name="firstLoc" select="normalize-space((//s:loc)[1])"/>
  <xsl:variable name="host" select="substring-before(concat(substring-after($firstLoc, '://'), '/'), '/')"/>
  <xsl:variable name="base" select="concat(substring-before($firstLoc, '://'), '://', $host)"/>
  <xsl:variable name="isIndex" select="boolean(/s:sitemapindex)"/>
  <xsl:variable name="newsCount" select="count(/s:urlset/s:url[news:news])"/>
  <xsl:variable name="total" select="count(/s:sitemapindex/s:sitemap | /s:urlset/s:url)"/>
  <xsl:variable name="generated" select="normalize-space(substring-after(/comment()[contains(., 'generated:')][1], 'generated:'))"/>

  <xsl:template match="/">
    <html lang="pl">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="robots" content="noindex, follow"/>
        <title><xsl:call-template name="heading"/><xsl:if test="$host"> - <xsl:value-of select="$host"/></xsl:if></title>
        <style>${STYLE}</style>
      </head>
      <body>
        <div class="wrap">
          <header class="top">
            <xsl:choose>
              <xsl:when test="$host"><a class="site" href="{$base}/"><xsl:value-of select="$host"/></a></xsl:when>
              <xsl:otherwise><span class="site">Mapa strony</span></xsl:otherwise>
            </xsl:choose>
            <span class="badge">XML</span>
          </header>
          <xsl:if test="not($isIndex)">
            <nav class="crumbs" aria-label="Nawigacja"><a href="/sitemap.xml">&#8592; Indeks map strony</a></nav>
          </xsl:if>
          <h1><xsl:call-template name="heading"/></h1>
          <p class="lede"><xsl:call-template name="lede"/></p>
          <dl class="stats">
            <div>
              <dt><xsl:call-template name="countLabel"/></dt>
              <dd><xsl:value-of select="$total"/></dd>
            </div>
            <xsl:if test="$generated">
              <div>
                <dt>Wygenerowano</dt>
                <dd><xsl:call-template name="date"><xsl:with-param name="v" select="$generated"/></xsl:call-template></dd>
              </div>
            </xsl:if>
            <div>
              <dt>Najnowsza zmiana treści</dt>
              <dd><xsl:call-template name="newest"/></dd>
            </div>
          </dl>
          <xsl:choose>
            <xsl:when test="$total = 0">
              <p class="lede">Ten plik nie zawiera żadnego wpisu.</p>
            </xsl:when>
            <xsl:otherwise>
              <div class="tools">
                <input id="q" type="search" placeholder="Filtruj po adresie lub tytule" aria-label="Filtruj wpisy"/>
                <output id="shown" aria-live="polite"><xsl:value-of select="$total"/></output>
              </div>
              <div class="table-wrap">
                <xsl:choose>
                  <xsl:when test="$isIndex"><xsl:call-template name="indexTable"/></xsl:when>
                  <xsl:when test="$newsCount &gt; 0"><xsl:call-template name="newsTable"/></xsl:when>
                  <xsl:otherwise><xsl:call-template name="urlTable"/></xsl:otherwise>
                </xsl:choose>
              </div>
            </xsl:otherwise>
          </xsl:choose>
          <footer>
            Widok dla ludzi. Wyszukiwarki czytają ten sam plik jako XML zgodny z protokołem
            <a href="https://www.sitemaps.org/protocol.html">sitemaps.org 0.9</a> - ten wygląd nie zmienia jego treści.
            Mapa strony dla czytelników: <a href="/sitemap">/sitemap</a>.
          </footer>
        </div>
        <script>${SCRIPT}</script>
      </body>
    </html>
  </xsl:template>

  <xsl:template name="heading">
    <xsl:choose>
      <xsl:when test="$isIndex">Indeks map strony</xsl:when>
      <xsl:when test="$newsCount &gt; 0">Google News - artykuły z ostatnich 48 godzin</xsl:when>
      <xsl:otherwise>Mapa adresów</xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template name="lede">
    <xsl:choose>
      <xsl:when test="$isIndex">Pierwszy plik, który pobierają wyszukiwarki. Każdy wiersz prowadzi do mapy jednej sekcji serwisu - kliknij, żeby zobaczyć jej adresy.</xsl:when>
      <xsl:when test="$newsCount &gt; 0">Plik dla Google News: artykuły opublikowane w ciągu ostatnich 48 godzin, każda wersja językowa osobno.</xsl:when>
      <xsl:otherwise>Adresy jednej sekcji serwisu, które wyszukiwarki mogą indeksować, z wersjami językowymi (hreflang) i datą ostatniej zmiany.</xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template name="countLabel">
    <xsl:choose>
      <xsl:when test="$isIndex">Pliki map</xsl:when>
      <xsl:when test="$newsCount &gt; 0">Artykuły</xsl:when>
      <xsl:otherwise>Adresy</xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- Najnowsza data w pliku: ISO 8601 sortuje się leksykograficznie. -->
  <xsl:template name="newest">
    <xsl:variable name="dates" select="//s:lastmod | //news:publication_date"/>
    <xsl:choose>
      <xsl:when test="$dates">
        <xsl:for-each select="$dates">
          <xsl:sort select="normalize-space(.)" order="descending"/>
          <xsl:if test="position() = 1"><xsl:call-template name="date"><xsl:with-param name="v" select="normalize-space(.)"/></xsl:call-template></xsl:if>
        </xsl:for-each>
      </xsl:when>
      <xsl:otherwise>-</xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- Data: dzień i godzina (bez sekund); pełna wartość w podpowiedzi. -->
  <xsl:template name="date">
    <xsl:param name="v"/>
    <xsl:choose>
      <xsl:when test="string-length($v) &gt; 10">
        <span title="{$v}"><xsl:value-of select="concat(substring($v, 1, 10), ' ', substring($v, 12, 5))"/><xsl:if test="contains($v, 'Z')"> UTC</xsl:if></span>
      </xsl:when>
      <xsl:when test="string-length($v) &gt; 0"><xsl:value-of select="$v"/></xsl:when>
      <xsl:otherwise>-</xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <!-- Ścieżka adresu (bez schematu i hosta) - czytelniejsza niż pełny URL. -->
  <xsl:template name="path">
    <xsl:param name="loc"/>
    <xsl:variable name="afterScheme" select="substring-after($loc, '://')"/>
    <xsl:choose>
      <xsl:when test="contains($afterScheme, '/')"><xsl:value-of select="concat('/', substring-after($afterScheme, '/'))"/></xsl:when>
      <xsl:otherwise><xsl:value-of select="$loc"/></xsl:otherwise>
    </xsl:choose>
  </xsl:template>

  <xsl:template name="indexTable">
    <table id="rows">
      <thead><tr><th>#</th><th>Plik mapy</th><th>Ostatnia zmiana</th></tr></thead>
      <tbody>
        <xsl:for-each select="/s:sitemapindex/s:sitemap">
          <xsl:variable name="loc" select="normalize-space(s:loc)"/>
          <tr>
            <td class="n"><xsl:value-of select="position()"/></td>
            <td class="url"><a href="{$loc}" title="{$loc}"><xsl:call-template name="path"><xsl:with-param name="loc" select="$loc"/></xsl:call-template></a></td>
            <td class="date"><xsl:call-template name="date"><xsl:with-param name="v" select="normalize-space(s:lastmod)"/></xsl:call-template></td>
          </tr>
        </xsl:for-each>
      </tbody>
    </table>
  </xsl:template>

  <xsl:template name="urlTable">
    <table id="rows">
      <thead><tr><th>#</th><th>Adres</th><th>Wersje językowe</th><th>Ostatnia zmiana</th><th class="hide-sm">Częstotliwość</th><th class="hide-sm">Priorytet</th></tr></thead>
      <tbody>
        <xsl:for-each select="/s:urlset/s:url">
          <xsl:variable name="loc" select="normalize-space(s:loc)"/>
          <tr>
            <td class="n"><xsl:value-of select="position()"/></td>
            <td class="url"><a href="{$loc}" title="{$loc}"><xsl:call-template name="path"><xsl:with-param name="loc" select="$loc"/></xsl:call-template></a></td>
            <td class="meta">
              <xsl:for-each select="xhtml:link[@hreflang != 'x-default' and normalize-space(@href) != $loc]">
                <a class="lang" href="{normalize-space(@href)}" hreflang="{@hreflang}" title="{normalize-space(@href)}"><xsl:value-of select="translate(@hreflang, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')"/></a>
              </xsl:for-each>
              <xsl:if test="not(xhtml:link[@hreflang != 'x-default' and normalize-space(@href) != $loc])">-</xsl:if>
            </td>
            <td class="date"><xsl:call-template name="date"><xsl:with-param name="v" select="normalize-space(s:lastmod)"/></xsl:call-template></td>
            <td class="meta hide-sm"><xsl:choose><xsl:when test="normalize-space(s:changefreq)"><xsl:value-of select="normalize-space(s:changefreq)"/></xsl:when><xsl:otherwise>-</xsl:otherwise></xsl:choose></td>
            <td class="meta hide-sm"><xsl:choose><xsl:when test="normalize-space(s:priority)"><xsl:value-of select="normalize-space(s:priority)"/></xsl:when><xsl:otherwise>-</xsl:otherwise></xsl:choose></td>
          </tr>
        </xsl:for-each>
      </tbody>
    </table>
  </xsl:template>

  <xsl:template name="newsTable">
    <table id="rows">
      <thead><tr><th>#</th><th>Artykuł</th><th>Język</th><th>Publikacja</th></tr></thead>
      <tbody>
        <xsl:for-each select="/s:urlset/s:url">
          <xsl:variable name="loc" select="normalize-space(s:loc)"/>
          <tr>
            <td class="n"><xsl:value-of select="position()"/></td>
            <td class="url">
              <a href="{$loc}" title="{$loc}">
                <xsl:choose>
                  <xsl:when test="normalize-space(news:news/news:title)"><xsl:value-of select="normalize-space(news:news/news:title)"/></xsl:when>
                  <xsl:otherwise><xsl:call-template name="path"><xsl:with-param name="loc" select="$loc"/></xsl:call-template></xsl:otherwise>
                </xsl:choose>
              </a>
              <small><xsl:call-template name="path"><xsl:with-param name="loc" select="$loc"/></xsl:call-template></small>
            </td>
            <td class="meta"><xsl:choose><xsl:when test="normalize-space(news:news/news:publication/news:language)"><span class="lang"><xsl:value-of select="translate(normalize-space(news:news/news:publication/news:language), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')"/></span></xsl:when><xsl:otherwise>-</xsl:otherwise></xsl:choose></td>
            <td class="date"><xsl:call-template name="date"><xsl:with-param name="v" select="normalize-space(news:news/news:publication_date | s:lastmod)"/></xsl:call-template></td>
          </tr>
        </xsl:for-each>
      </tbody>
    </table>
  </xsl:template>
</xsl:stylesheet>
`;

/** Typ treści arkusza - XML-owy, bez niego Chrome z `nosniff` odmawia transformacji. */
export const SITEMAP_STYLESHEET_CONTENT_TYPE = "text/xsl; charset=utf-8";

/** Arkusz zmienia się wyłącznie z wdrożeniem: godzina u klienta, doba na brzegu. */
export const SITEMAP_STYLESHEET_CACHE_CONTROL =
  "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

/** Arkusz jest statyczny - jeden dokument na wdrożenie, niezależny od tenanta. */
export function buildSitemapStylesheet(): string {
  return XSL;
}
