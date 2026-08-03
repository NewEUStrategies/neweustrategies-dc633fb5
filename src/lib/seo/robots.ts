// Czysty builder robots.txt - wydzielony z trasy, żeby treść dała się objąć
// testem kontraktu (tak jak <head> w headContract.test.ts).
//
// PRZYCZYNA: trasa deklarowała na sztywno JEDNĄ sitemapę (`Sitemap: /sitemap.xml`),
// więc /news-sitemap.xml - trasa istniejąca i wymagana przez Google News - nie
// był odkrywalny żadnym kanałem. Builder przyjmuje listę sitemap, a wywołujący
// decyduje, które są włączone; test pilnuje, że kanoniczny host zawsze ogłasza
// przynajmniej indeks sitemapy.

export type RobotsMode =
  /** Kanoniczny host marki: indeksowanie dozwolone, sitemapy ogłoszone. */
  | "canonical"
  /** Host podglądowy/legacy: pełny zakaz + komentarz wyjaśniający. */
  | "legacy"
  /** Nieznany host: bezpieczny domyślny zakaz. */
  | "unknown";

export interface RobotsInput {
  mode: RobotsMode;
  /** Absolutny origin kanoniczny (bez ukośnika na końcu). */
  origin: string;
  /** Ścieżki sitemap do ogłoszenia (tylko dla mode="canonical"). */
  sitemapPaths?: readonly string[];
  /** Ścieżki zamknięte dla crawlerów (tylko dla mode="canonical"). */
  disallow?: readonly string[];
}

/** Domyślnie zamknięte obszary: panel, API i ścieżki autoryzacji. */
export const ROBOTS_DEFAULT_DISALLOW: readonly string[] = ["/admin/", "/api/", "/auth/"];

export function buildRobotsTxt(input: RobotsInput): string {
  if (input.mode !== "canonical") {
    const lines =
      input.mode === "legacy"
        ? [
            "# Legacy / preview host - not the canonical domain.",
            "User-agent: *",
            "Disallow: /",
            "",
          ]
        : ["User-agent: *", "Disallow: /", ""];
    return lines.join("\n");
  }

  const disallow = input.disallow ?? ROBOTS_DEFAULT_DISALLOW;
  const origin = input.origin.replace(/\/+$/, "");
  // Kolejność deklaracji nie ma znaczenia dla crawlerów, ale deduplikacja ma:
  // ten sam adres dwa razy to bezsensowny podwójny crawl mapy.
  const sitemaps = Array.from(new Set(input.sitemapPaths ?? []));

  return [
    "User-agent: *",
    "Allow: /",
    ...disallow.map((path) => `Disallow: ${path}`),
    "",
    ...sitemaps.map((path) => `Sitemap: ${origin}${path}`),
    "",
  ].join("\n");
}
