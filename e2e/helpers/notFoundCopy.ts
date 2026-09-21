// Wspólne dane dla DWÓCH POŁÓW jednego kontraktu uniwersalnego resolvera
// (`src/routes/$.tsx`), rozstrzyganych w dwóch różnych środowiskach:
//
//   * `e2e/ssr-degradation.spec.ts` (job `e2e`, poświadczenia zastępcze
//     Supabase - backend z definicji martwy): adres nierozstrzygnięty daje
//     HTTP 200 z komunikatem degradacji, `noindex, nofollow` i `no-store`,
//   * `e2e/user-paths.spec.ts` (job `e2e-seeded`, `E2E_SEEDED=1`, żywa lokalna
//     baza): odczyt jest CZYSTY, więc ten sam adres daje 404 z kopią 404.
//
// PO CO WSPÓLNY MODUŁ. Obie suity muszą mierzyć DOKŁADNIE te same adresy -
// inaczej rozejście się list (ścieżka dopisana tylko po jednej stronie) jest
// niewidoczne do pierwszego czerwonego przebiegu, a dowód na „404 wyłącznie
// z czystego odczytu" rozpada się na dwa nieporównywalne pomiary.

/**
 * Dekoduje encje HTML, które React emituje w strumieniu SSR.
 *
 * PO CO. Asercje na kopii 404 porównują ZDANIA ze `src/lib/errorCopy.ts`,
 * a React escapuje apostrof do `&#x27;`. Kopia polska apostrofu nie ma, więc
 * przechodziła; angielskie „The page you're looking for doesn't exist…" ma dwa
 * i wywalało się jako „brak treści komunikatu 404" - choć treść BYŁA na
 * stronie, tylko w formie encji. Porównanie na odkodowanym dokumencie trzyma
 * pełne zdanie w asercji, zamiast skracać je do fragmentu bez apostrofu.
 *
 * `&amp;` rozwijane NA KOŃCU - inaczej `&amp;#x27;` zamieniłoby się w apostrof.
 */
export function odkodujEncje(html: string): string {
  return html
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/**
 * Wartość `content` z `meta[name=robots]` w SUROWYM dokumencie, albo `null`,
 * gdy metatagu nie ma.
 *
 * DLACZEGO NIE `locator`. `page.locator(...).getAttribute()` CZEKA na element
 * i przy jego braku wisi do timeoutu testu - dokładnie tak padał w CI dawny
 * test „404 nie zaprasza do indeksowania" (30 s na `meta[name=robots]`,
 * którego na stronie 404 po prostu nie ma). Odczyt z bajtów odpowiedzi
 * odpowiada od razu, więc BRAK metatagu jest wynikiem, a nie zawieszeniem -
 * i przy okazji mierzy to, co dostaje crawler pierwszej fali, bez hydratacji.
 */
export function metaRobotsZHtml(html: string): string | null {
  const tag = html.match(/<meta[^>]*\bname="robots"[^>]*>/i);
  if (!tag) return null;
  const content = tag[0].match(/\bcontent="([^"]*)"/i);
  return content ? content[1] : null;
}

/** Kopia strony 404 z `src/lib/errorCopy.ts` - jedno źródło dla obu języków. */
export const NOT_FOUND_COPY = {
  pl: {
    title: "Nie znaleziono strony",
    body: "Strona, której szukasz, nie istnieje lub została przeniesiona.",
    suggestions: "Być może szukasz:",
  },
  en: {
    title: "Page not found",
    body: "The page you're looking for doesn't exist or has been moved.",
    suggestions: "You might be looking for:",
  },
} as const;

export interface NieistniejacaSciezka {
  readonly path: string;
  readonly lang: "pl" | "en";
  readonly label: string;
}

/**
 * Ścieżki, których na pewno nie ma. Rozwiązuje je uniwersalny resolver
 * (`src/routes/$.tsx`), bo nie trafiają w żadną trasę statyczną. Dopisując
 * przypadek, dopisujesz go OBU suitom naraz - taki jest sens tej stałej.
 */
export const NIEISTNIEJACE: readonly NieistniejacaSciezka[] = [
  { path: "/nie-ma-takiej-strony-9f2a", lang: "pl", label: "slug jednopoziomowy" },
  { path: "/en/no-such-page-9f2a", lang: "en", label: "slug jednopoziomowy (EN)" },
  { path: "/analizy/nie-ma-takiego-wpisu-9f2a", lang: "pl", label: "ścieżka dwupoziomowa" },
  { path: "/a/b/c/d-9f2a", lang: "pl", label: "ścieżka czteropoziomowa" },
];
