// Trasy KODOWE, które zawsze odpowiadają `noindex` - bez względu na treść CMS.
//
// PO CO (2026-10 audyt GSC). Trasa statyczna wygrywa z uniwersalną (`$.tsx`),
// więc strona CMS o slugu `login` czy `club` nigdy nie renderuje się pod swoim
// adresem: odpowiada trasa logowania (`noindex, nofollow`) albo katalog klubów
// (`forceNoindex`). Mimo to `sitemaps/pages.xml` ogłaszał `/login` i `/club`
// (PL+EN), a mapa HTML linkowała je jako zwykłe strony - Search Console
// raportuje to jako „Przesłany URL oznaczony tagiem noindex".
//
// Lista jest jedna dla mapy XML (`sitemapEntries.server.ts`) i mapy HTML
// (`/sitemap`). Bramka `noindexCodeRoutes.test.ts` pilnuje obu kierunków:
// każda ścieżka stąd ma trasę z literalnym `noindex`, a każda statyczna trasa
// publiczna z literalnym `noindex` jest tutaj.

/** Ścieżki (bez prefiksu językowego) tras kodowych z bezwarunkowym `noindex`. */
export const NOINDEX_CODE_ROUTE_PATHS: ReadonlySet<string> = new Set([
  "/auth/callback",
  "/cart",
  "/checkout/cancel",
  "/checkout/success",
  "/club",
  "/contributors",
  "/error",
  "/event-consent/confirm",
  "/events/saved",
  "/login",
  "/messages",
  "/network",
  "/newsletter/confirm",
  "/newsletter/keep",
  "/newsletter/unsubscribe",
  "/people",
  "/profile",
  "/profile/expert-requests",
  "/profile/interests",
  "/profile/invoices",
  "/profile/notifications",
  "/profile/portal",
  "/reading-list",
  "/reset-password",
  "/scanner",
  "/welcome",
]);

/** Czy pod tą ścieżką (bez prefiksu `/en`) renderuje się trasa kodowa z `noindex`. */
export function isNoindexCodeRoutePath(path: string): boolean {
  const normalized = `/${path.replace(/^\/+|\/+$/g, "")}`;
  return NOINDEX_CODE_ROUTE_PATHS.has(normalized);
}
