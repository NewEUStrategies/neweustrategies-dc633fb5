// Audyt SEO MARKI - czyli tego jednego zestawu ustawień, który decyduje, co
// wyszukiwarka pokaże po wpisaniu NAZWY serwisu. Czysty, bez frameworka,
// wspólny dla kokpitu (/admin/seo) i zakładki strony głównej
// (/admin/seo/homepage), żeby licznik problemów w kokpicie i lista problemów
// na zakładce nigdy nie mówiły czegoś innego.
//
// SKĄD SIĘ WZIĄŁ TEN MODUŁ - KONKRETNA AWARIA, A NIE "DOBRE PRAKTYKI".
// Zapytanie "new european strategies" zwracało stronę główną z niebieskim
// linkiem "European Security Analysis": sama nazwa marki z tytułu ZNIKAŁA.
// To nie jest błąd renderu - `<title>` był poprawny. To zachowanie Google:
// nazwa serwisu jest rysowana W OSOBNEJ LINII nad tytułem (sygnał site name),
// więc gdy tytuł ZACZYNA się od tej samej nazwy i separatora, Google traktuje
// prefiks jako powtórzenie i go ucina. Efekt: marka jest w SERP-ie dwa razy
// w kodzie, a raz - i to drobnym drukiem - na ekranie.
//
// Dlatego regułą `titleBrandStripped` NIE jest "brak marki w tytule" (marka
// tam JEST), tylko "marka stoi w pozycji, z której Google ją zdejmie". Bez
// nazwania tego wprost redakcja poprawia tytuł w kółko i za każdym razem widzi
// ten sam wynik.
import { serpTitleMetric, serpDescriptionMetric } from "@/lib/seo/serp";

/** Waga problemu. `error` = strona główna traci widoczność albo tożsamość. */
export type BrandSeverity = "error" | "warning";

export interface BrandFinding {
  /** Stabilny klucz - zarazem sufiks klucza i18n (`adminSeoBrand.finding.<id>`). */
  id: string;
  severity: BrandSeverity;
  /** Parametry interpolacji komunikatu (liczby px, nazwa marki itp.). */
  params?: Record<string, string | number>;
}

export interface BrandAuditInput {
  /** Efektywna nazwa marki (site name), np. "New European Strategies". */
  siteName: string;
  /** Efektywny `<title>` strony głównej dla ocenianego języka. */
  title: string;
  /** Efektywny meta description strony głównej dla ocenianego języka. */
  description: string;
  /** Efektywny URL karty og:image ("" = brak). */
  ogImageUrl: string;
  /** Czy karta to wbudowany plik marki, a nie obrazek wgrany przez redakcję. */
  ogImageIsBuiltIn: boolean;
  /** `og:image:alt`. */
  ogImageAlt: string;
  /** Profile `sameAs` encji Organization. */
  sameAs: readonly string[];
  /** Logo wydawcy do danych strukturalnych. */
  publisherLogoUrl: string;
  /** Uchwyt `twitter:site` ("@marka"). */
  twitterSite: string;
  /** Czy strona główna jest wyindeksowana. */
  noindex: boolean;
}

/** Separatory, po których Google rozpoznaje prefiks marki w tytule. */
const BRAND_SEPARATORS = ["-", "–", "—", "|", ":", "·", "•"];

const norm = (value: string): string => value.trim().toLowerCase();

/**
 * Czy tytuł ZACZYNA się od nazwy marki zakończonej separatorem.
 *
 * To jest dokładnie ten kształt, który Google zdejmuje ze strony głównej
 * ("Marka - Reszta" -> "Reszta"). Sprawdzamy prefiks, a nie samo wystąpienie:
 * "Analizy bezpieczeństwa Europy - New European Strategies" jest bezpieczny,
 * bo marka stoi na końcu i pełni rolę sufiksu, a nie dubla linii site name.
 */
export function titleLeadsWithBrand(title: string, siteName: string): boolean {
  const t = norm(title);
  const brand = norm(siteName);
  if (!t || !brand || !t.startsWith(brand)) return false;
  const rest = t.slice(brand.length).trimStart();
  if (!rest) return false; // sam brand - osobna reguła (`titleIsBrandOnly`)
  return BRAND_SEPARATORS.some((sep) => rest.startsWith(sep));
}

/** Liczba wystąpień nazwy marki w tytule (wykrywa doklejony sufiks na dublu). */
export function brandOccurrences(title: string, siteName: string): number {
  const brand = norm(siteName);
  if (!brand) return 0;
  const haystack = norm(title);
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(brand, from);
    if (at === -1) break;
    count += 1;
    from = at + brand.length;
  }
  return count;
}

/**
 * Pełny audyt konfiguracji marki dla JEDNEGO języka.
 *
 * Kolejność wyniku jest kontraktem: najpierw to, co odcina stronę główną od
 * wyników (noindex, brak tytułu), potem tożsamość marki w SERP-ie, potem karta
 * społecznościowa, na końcu sygnały encji. Kokpit pokazuje trzy pierwsze
 * pozycje bez przewijania, więc kolejność jest tym, co redakcja zobaczy.
 */
export function auditBrandSeo(input: BrandAuditInput): BrandFinding[] {
  const findings: BrandFinding[] = [];
  const title = input.title.trim();
  const description = input.description.trim();
  const brand = input.siteName.trim();

  if (input.noindex) findings.push({ id: "homepageNoindex", severity: "error" });

  if (!title) {
    findings.push({ id: "titleMissing", severity: "error" });
  } else if (brand) {
    const occurrences = brandOccurrences(title, brand);
    if (occurrences === 0) {
      findings.push({ id: "titleBrandMissing", severity: "warning", params: { brand } });
    } else if (norm(title) === norm(brand)) {
      // Sam brand bez żadnej obietnicy treści - nie ma o co zaczepić zapytania
      // innego niż nazwa własna, a to jest ruch, który i tak by przyszedł.
      findings.push({ id: "titleIsBrandOnly", severity: "warning", params: { brand } });
    } else {
      if (occurrences > 1) {
        findings.push({
          id: "titleBrandDuplicated",
          severity: "warning",
          params: { brand, count: occurrences },
        });
      }
      if (titleLeadsWithBrand(title, brand)) {
        findings.push({ id: "titleBrandStripped", severity: "warning", params: { brand } });
      }
    }
  }

  if (title) {
    const metric = serpTitleMetric(title);
    if (metric.grade === "long") {
      findings.push({
        id: "titleTooLong",
        severity: "warning",
        params: { px: metric.px, limitPx: metric.limitPx },
      });
    } else if (metric.grade === "short") {
      findings.push({
        id: "titleTooShort",
        severity: "warning",
        params: { px: metric.px, limitPx: metric.limitPx },
      });
    }
  }

  if (!description) {
    findings.push({ id: "descriptionMissing", severity: "error" });
  } else {
    const metric = serpDescriptionMetric(description);
    if (metric.grade === "long") {
      findings.push({
        id: "descriptionTooLong",
        severity: "warning",
        params: { px: metric.px, limitPx: metric.limitPx },
      });
    } else if (metric.grade === "short") {
      findings.push({
        id: "descriptionTooShort",
        severity: "warning",
        params: { px: metric.px, limitPx: metric.limitPx },
      });
    }
  }

  if (!input.ogImageUrl.trim()) {
    findings.push({ id: "ogImageMissing", severity: "error" });
  } else if (input.ogImageIsBuiltIn) {
    findings.push({ id: "ogImageBuiltIn", severity: "warning" });
  }
  if (!input.ogImageAlt.trim()) findings.push({ id: "ogImageAltMissing", severity: "warning" });

  if (!input.sameAs.length) findings.push({ id: "sameAsMissing", severity: "warning" });
  if (!input.publisherLogoUrl.trim()) {
    findings.push({ id: "publisherLogoMissing", severity: "warning" });
  }
  if (!input.twitterSite.trim()) findings.push({ id: "twitterSiteMissing", severity: "warning" });

  return findings;
}

/**
 * Wynik 0-100 dla kokpitu. Błąd kosztuje 20, ostrzeżenie 7 - proporcja jest
 * celowa: komplet ostrzeżeń bez ani jednego błędu nadal daje wynik "do
 * poprawy", a nie "katastrofa", bo strona główna WIDOCZNA z nienajlepszym
 * tytułem jest w innej sytuacji niż strona wyindeksowana.
 */
export function brandAuditScore(findings: readonly BrandFinding[]): number {
  let score = 100;
  for (const f of findings) score -= f.severity === "error" ? 20 : 7;
  return Math.max(0, Math.min(100, score));
}

/** Liczniki do kafelków kokpitu. */
export function countBySeverity(findings: readonly BrandFinding[]): {
  errors: number;
  warnings: number;
} {
  return {
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
  };
}
