// Redakcyjny tytuł i opis serwisu (site_settings["seo"]), przekazywane do
// czystych builderów <head> przez pamięć kluczowaną hostem - dokładnie tak jak
// domyślna karta społecznościowa (src/lib/seo/socialDefaults.ts).
//
// Dlaczego tak: `buildRootHead()` / `head()` tras są czystymi funkcjami bez
// dostępu do site_settings. Root loader pobiera mapę ustawień na KAŻDEJ trasie,
// więc to on zapamiętuje tu wynik, a buildery czytają go po hoście żądania.
//
// TENANT-SAFE: klucz to host, więc render tenanta A nigdy nie poda tytułu
// tenanta B - nawet przy współbieżnym SSR w jednym isolate. Brak wpisu = stałe
// fallbacki marki z meta.ts.
import { socialHostKey } from "@/lib/seo/socialDefaults";

export type BrandLang = "pl" | "en";

export type BrandDefaults = {
  title: Record<BrandLang, string>;
  description: Record<BrandLang, string>;
};

export const EMPTY_BRAND_DEFAULTS: BrandDefaults = {
  title: { pl: "", en: "" },
  description: { pl: "", en: "" },
};

const byHost = new Map<string, BrandDefaults>();
/** Sufit wpisów - klucz to host, więc przestrzeń jest teoretycznie otwarta. */
const MAX_HOSTS = 100;

const clean = (value: string | undefined | null): string => (value ?? "").trim();

/** Zapamiętaj tytuł/opis dla hosta bieżącego żądania (woła root loader). */
export function rememberBrandDefaults(
  host: string | null | undefined,
  value: Partial<BrandDefaults>,
): void {
  const key = socialHostKey(host);
  byHost.delete(key);
  byHost.set(key, {
    title: { pl: clean(value.title?.pl), en: clean(value.title?.en) },
    description: { pl: clean(value.description?.pl), en: clean(value.description?.en) },
  });
  while (byHost.size > MAX_HOSTS) {
    const oldest = byHost.keys().next().value;
    if (oldest === undefined) break;
    byHost.delete(oldest);
  }
}

/** Nadpisania dla hosta (puste stringi, gdy nic nie zapamiętano). */
export function brandDefaultsFor(host: string | null | undefined): BrandDefaults {
  return byHost.get(socialHostKey(host)) ?? EMPTY_BRAND_DEFAULTS;
}

/** Hook testowy: wyczyść wszystkie hosty. */
export function resetBrandDefaults(): void {
  byHost.clear();
}
