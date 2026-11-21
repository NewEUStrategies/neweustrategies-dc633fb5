// Ekosystem SEO jako FUNKCJA ustawień, a nie lista w panelu.
//
// PO CO. Do 2026-11 zakładka „Tytuł i opis serwisu" wymieniała na sztywno
// osiem plików - bez kanałów podcastu, trackera i relacji na żywo, a przy
// wyłączonym RSS czy Google News nadal linkowała adresy, które odpowiadają 404.
// Lista pochodzi teraz z rejestru `MACHINE_SURFACES` i bieżącego szkicu
// ustawień: nowa powierzchnia w rejestrze pojawia się sama, przełącznik
// redakcji ją wycofuje, a ponowne włączenie przywraca - w tym samym kroku co
// robots.txt i llms.txt, bo wszystkie trzy czytają te same pola.
import { MACHINE_SURFACES, type MachineSurface } from "@/lib/seo/machineSurfaces";
import { localizedPath } from "@/lib/i18n/localePath";
import type { SeoSettings } from "@/lib/seo/settings";

/** Pola ustawień, które włączają lub wycofują powierzchnię maszynową. */
export type EcosystemToggle = "rss_enabled" | "news_sitemap_enabled" | "llms_txt_enabled";

export const ECOSYSTEM_TOGGLES: readonly EcosystemToggle[] = [
  "rss_enabled",
  "news_sitemap_enabled",
  "llms_txt_enabled",
];

/** Sitemapy, które robots.txt ogłasza crawlerom (ta sama reguła co trasa). */
export const ROBOTS_SITEMAP_INDEX_PATH = "/sitemap.xml";
export const NEWS_SITEMAP_PATH = "/news-sitemap.xml";

export interface EcosystemEntry {
  /** Stabilny klucz wiersza: ścieżka + wariant językowy. */
  id: string;
  /** Ścieżka kanoniczna z rejestru (bez prefiksu językowego). */
  path: string;
  /** Adres do otwarcia (z prefiksem /en dla wariantu angielskiego). */
  href: string;
  /** `null` = adres wspólny dla obu języków. */
  lang: "pl" | "en" | null;
  /** Dwujęzyczna etykieta z rejestru - zapas dla powierzchni bez tłumaczenia. */
  registryLabel: string;
  /** Przełącznik, który tę powierzchnię kontroluje (brak = zawsze aktywna). */
  toggle: EcosystemToggle | null;
  /** Czy robots.txt ogłasza ten adres jako `Sitemap:`. */
  inRobots: boolean;
}

/**
 * Przełącznik powierzchni. Rejestr niesie go dla RSS i Google News; llms.txt
 * ma własne pole, którego rejestr nie zna (test kontraktu pilnuje, że pole
 * `setting` dotyczy wyłącznie ogłoszeń w samym llms.txt).
 */
export function ecosystemToggle(surface: MachineSurface): EcosystemToggle | null {
  if (surface.setting) return surface.setting;
  if (surface.path === "/llms.txt") return "llms_txt_enabled";
  return null;
}

/** Sitemapy ogłaszane w robots.txt dla bieżących ustawień. */
export function robotsSitemapPaths(settings: SeoSettings): string[] {
  return settings.news_sitemap_enabled
    ? [ROBOTS_SITEMAP_INDEX_PATH, NEWS_SITEMAP_PATH]
    : [ROBOTS_SITEMAP_INDEX_PATH];
}

/**
 * Wszystkie powierzchnie rozdzielone na aktywne i wycofane przełącznikiem.
 * Wariant językowy dostaje osobny wiersz, bo to osobny adres dla crawlera.
 */
export function seoEcosystemEntries(settings: SeoSettings): {
  active: EcosystemEntry[];
  disabled: EcosystemEntry[];
} {
  const announced = new Set(robotsSitemapPaths(settings));
  const active: EcosystemEntry[] = [];
  const disabled: EcosystemEntry[] = [];
  for (const surface of MACHINE_SURFACES) {
    const toggle = ecosystemToggle(surface);
    const langs: Array<"pl" | "en" | null> = surface.localized ? ["pl", "en"] : [null];
    for (const lang of langs) {
      const entry: EcosystemEntry = {
        id: lang ? `${surface.path}#${lang}` : surface.path,
        path: surface.path,
        href: lang ? localizedPath(surface.path, lang) : surface.path,
        lang,
        registryLabel: surface.label,
        toggle,
        inRobots: announced.has(surface.path),
      };
      if (toggle && !settings[toggle]) disabled.push(entry);
      else active.push(entry);
    }
  }
  return { active, disabled };
}
