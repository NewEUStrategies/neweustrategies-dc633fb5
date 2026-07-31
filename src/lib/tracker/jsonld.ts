// JSON-LD trackera legislacyjnego (warstwa GEO/AEO). Czysty i wolny od
// frameworka - head() trasy indeksu osadza zwrócony węzeł ItemList jako
// `mainEntity` CollectionPage, więc crawlery i asystenci AI dostają listę
// dossier (typ Legislation, jak na stronie detalu) już w SSR, nie po
// hydratacji. URL-e budowane przez localizedPath/absoluteUrl - wariant EN
// wskazuje na realnie serwowane ścieżki "/en/tracker/...".
import { absoluteUrl, type Lang } from "@/lib/seo/meta";
import { localizedPath } from "@/lib/i18n/localePath";

/** Minimalny kształt wpisu listy - podzbiór PolicyItem, żeby builder dało się
 *  testować bez importu warstwy zapytań (klient supabase rzuca przy imporcie
 *  w środowisku bez env). */
export interface TrackerListEntry {
  slug: string;
  title_pl: string;
  title_en: string;
  reference: string | null;
}

/** Tytuł w języku renderu z tym samym fallbackiem PL<->EN co karty listy. */
function entryTitle(entry: TrackerListEntry, lang: Lang): string {
  return lang === "en" ? entry.title_en || entry.title_pl : entry.title_pl || entry.title_en;
}

/**
 * ItemList opublikowanych dossier dla CollectionPage `/tracker`. Zwraca null
 * przy pustej liście - CollectionPage bez `mainEntity` pozostaje ważne, a
 * pusty ItemList psułby walidację rich results. Każdy ListItem niesie węzeł
 * Legislation (spójny z detalem dossier) z opcjonalnym identyfikatorem
 * procedury (np. 2022/0155(COD)).
 */
export function trackerItemListJsonLd(
  entries: readonly TrackerListEntry[],
  origin: string,
  lang: Lang,
): Record<string, unknown> | null {
  if (entries.length === 0) return null;
  return {
    "@type": "ItemList",
    numberOfItems: entries.length,
    itemListElement: entries.map((entry, i) => {
      const url = absoluteUrl(origin, localizedPath(`/tracker/${entry.slug}`, lang));
      return {
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Legislation",
          name: entryTitle(entry, lang),
          url,
          ...(entry.reference ? { legislationIdentifier: entry.reference } : {}),
        },
      };
    }),
  };
}
