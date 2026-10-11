// Adresy JEDNOSEGMENTOWE obsługiwane przez TRASY KODOWE (`src/routes`), a nie
// przez uniwersalny resolver treści CMS (`src/routes/$.tsx`).
//
// PO CO (2026-10, menu po referencji). Pozycja menu typu „strona" wskazująca
// wiersz `pages`, którego anon nie widzi (szkic, kosz), jest zwykle martwym
// linkiem - ale NIE wtedy, gdy pod jej adresem odpowiada trasa kodowa:
// `/pricing`, `/club` czy `/membership-join` renderują się z komponentu
// niezależnie od statusu wiersza `pages` (patrz też `lib/admin/codePages.ts`).
// Ukrycie takiej pozycji zabrałoby z nagłówka działający link.
//
// DOKŁADNE ŚCIEŻKI, NIE PREFIKSY. `/blog` jest trasą kodową, ale `/blog/x`
// trafia już do resolvera CMS (jest tylko `blog.index.tsx`), więc prefiks
// zrobiłby z martwej strony pod `/blog/...` link „żywy". Strony kodowe są
// jednosegmentowe, więc tyle wystarcza. Bramka `codeRoutes.test.ts` porównuje
// zbiór z plikami tras w obie strony - nowa trasa = jedna linia tutaj.
export const CODE_ROUTE_PATHS: ReadonlySet<string> = new Set([
  "/blog",
  "/cart",
  "/club",
  "/contribute",
  "/contributors",
  "/cookies",
  "/donate",
  "/error",
  "/events",
  "/experts",
  "/feed",
  "/glossary",
  "/komunikacja-i-marketing",
  "/library",
  "/live",
  "/llms.txt",
  "/login",
  "/mcp",
  "/membership-join",
  "/membership-registration",
  "/messages",
  "/moderacja-komentarzy",
  "/network",
  "/news-sitemap.xml",
  "/people",
  "/podcasts",
  "/polityka-prywatnosci",
  "/polityka-przetwarzania-danych",
  "/polls",
  "/pricing",
  "/profile",
  "/programs",
  "/przejrzystosc-ai",
  "/publications",
  "/qa",
  "/quiz",
  "/reading-list",
  "/regulamin",
  "/regulamin-klubow-dyskusyjnych",
  "/regulamin-subskrypcji-i-zakupow",
  "/regulamin-wydarzen-i-biletow",
  "/reset-password",
  "/robots.txt",
  "/rodo",
  "/rss.xml",
  "/scanner",
  "/search",
  "/sitemap",
  "/sitemap-index.xml",
  "/sitemap.xml",
  "/sitemap.xsl",
  "/statut",
  "/support",
  "/tracker",
  "/unsubscribe",
  "/web-stories",
  "/welcome",
  "/zarzadzanie-polityka-prywatnosci",
  "/zatrudniamy",
  "/zwroty-i-reklamacje",
]);

/**
 * Czy adres (ścieżka względna, z prefiksem `/en` albo bez, z końcowym
 * ukośnikiem, query albo hashem) to dokładnie ścieżka trasy kodowej.
 * Adres zewnętrzny i pusty - nie.
 */
export function isCodeRoutePath(href: string | null | undefined): boolean {
  const raw = (href ?? "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return false;
  const path = raw
    .split(/[?#]/)[0]
    .replace(/^\/en(?=\/|$)/, "")
    .replace(/\/+$/, "");
  return CODE_ROUTE_PATHS.has(path);
}
