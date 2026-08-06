// Czysty builder robots.txt - wydzielony z trasy, żeby treść dała się objąć
// testem kontraktu (tak jak <head> w headContract.test.ts).
//
// PRZYCZYNA (2026-08-03): trasa deklarowała na sztywno JEDNĄ sitemapę
// (`Sitemap: /sitemap.xml`), więc /news-sitemap.xml - trasa istniejąca i
// wymagana przez Google News - nie był odkrywalny żadnym kanałem. Builder
// przyjmuje listę sitemap, a wywołujący decyduje, które są włączone; test
// pilnuje, że kanoniczny host zawsze ogłasza przynajmniej indeks sitemapy.
//
// PRZYCZYNA (2026-08-06): polityka crawlerów AI (`aiCrawlerDirectives`) była
// kompletna w ustawieniach i w panelu, ale NIKT jej nie emitował - przełączniki
// „wpuszczaj crawlery treningowe / wyszukiwawcze" nie zmieniały ani jednego
// bajtu w robots.txt. Builder przyjmuje więc gotowe grupy `User-agent` i
// dokleja je do polityki globalnej.

export type RobotsMode =
  /** Host kanoniczny (marka albo własna domena tenanta): indeksowanie dozwolone. */
  | "canonical"
  /** Host podglądowy/legacy: pełny zakaz + komentarz wyjaśniający. */
  | "legacy"
  /** Nieznany host: bezpieczny domyślny zakaz. */
  | "unknown";

/**
 * Fakty o hoście potrzebne do wyboru trybu - wejście CZYSTE, żeby decyzja
 * (czy dana domena jest zaproszona do indeksu) była testowalna bez bazy.
 */
export interface RobotsHostFacts {
  /** Host kanoniczny marki (`CANONICAL_SITE_HOSTS`). */
  brandCanonical: boolean;
  /** Alias hostingu / domena legacy / host edytora lub lokalny. */
  aliasOrPreview: boolean;
  /** Host zgłoszony jako własna domena tenanta (`tenants.domain`). */
  tenantClaimed: boolean;
  /**
   * Katalog domen jest pusty albo nieosiągalny (bootstrap jednego tenanta,
   * awaria warstwy danych). Nie ma wtedy czego pomylić między tenantami.
   */
  directoryDegraded: boolean;
}

export interface RobotsInput {
  mode: RobotsMode;
  /** Absolutny origin kanoniczny (bez ukośnika na końcu). */
  origin: string;
  /** Ścieżki sitemap do ogłoszenia (tylko dla mode="canonical"). */
  sitemapPaths?: readonly string[];
  /** Ścieżki zamknięte dla crawlerów (tylko dla mode="canonical"). */
  disallow?: readonly string[];
  /**
   * Dodatkowe grupy `User-agent` (polityka crawlerów AI) - gotowe linie,
   * doklejane po polityce globalnej i tylko dla mode="canonical".
   */
  agentGroups?: readonly string[];
}

/** Domyślnie zamknięte obszary: panel, API i ścieżki autoryzacji. */
export const ROBOTS_DEFAULT_DISALLOW: readonly string[] = ["/admin/", "/api/", "/auth/"];

/**
 * Wybór trybu robots.txt dla hosta.
 *
 * Kolejność jest istotna i celowa:
 *   1. host kanoniczny marki - zawsze indeksowalny (twarda lista w źródle, więc
 *      awaria bazy nie odcina marki od indeksu);
 *   2. alias hostingu / podgląd - zawsze zamknięty, nawet gdyby ktoś wpisał go
 *      jako domenę tenanta: alias dostaje 301, więc nie może być indeksowany;
 *   3. własna domena tenanta - kanoniczna DLA TEGO TENANTA (serwuje swój serwis,
 *      jego sitemapa odpowiada 200 na tym originie - robots.txt nie może jej
 *      jednocześnie zakazywać);
 *   4. katalog pusty/nieosiągalny - traktujemy jak instalację jednotenantową:
 *      podany na żywo `Disallow: /` jest respektowany natychmiast, więc awaria
 *      bazy nie może wyrzucić działającego serwisu z indeksu;
 *   5. host, którego nikt nie zgłosił, przy ZASIEDLONYM katalogu - fail-closed.
 */
export function robotsModeFor(facts: RobotsHostFacts): RobotsMode {
  if (facts.brandCanonical) return "canonical";
  if (facts.aliasOrPreview) return "legacy";
  if (facts.tenantClaimed) return "canonical";
  return facts.directoryDegraded ? "canonical" : "unknown";
}

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
  // Grupy per-agent MUSZĄ stać po grupie globalnej: crawler stosuje najbardziej
  // szczegółową grupę, która go dotyczy, a rekordy `Sitemap` są bezgrupowe -
  // dlatego zostają na końcu pliku, poza jakąkolwiek grupą.
  const agentGroups = input.agentGroups ?? [];

  return [
    "User-agent: *",
    "Allow: /",
    ...disallow.map((path) => `Disallow: ${path}`),
    "",
    ...agentGroups,
    ...sitemaps.map((path) => `Sitemap: ${origin}${path}`),
    "",
  ].join("\n");
}
