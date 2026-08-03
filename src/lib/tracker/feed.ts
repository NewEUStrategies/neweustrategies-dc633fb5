// Czysty model kanału RSS trackera legislacyjnego UE.
//
// Kontekst produktowy: tracker miał powiadomienia in-app i sekcję w digeście
// e-mail (`lib/notifications/digestEmail.ts`, rodzaj "tracker"), ale NIE MIAŁ
// kanału RSS - a to jedyna forma alertu, która nie wymaga konta i którą
// czytają agregatory oraz redakcje. Kategoria/tag/program mają swój feed od
// dawna; tracker, czyli najbardziej "kanałowa" treść w serwisie, nie miał.
//
// Kanał scala DWA strumienie w jeden porządek czasowy:
//   - nowe opublikowane dossier (pubDate = created_at),
//   - aktualizacje dossier (pubDate = created_at wpisu osi czasu),
// bo czytelnik feedu chce jednej odpowiedzi na pytanie "co się zmieniło",
// a nie dwóch subskrypcji.
//
// Zero zależności od Reacta, Supabase i requestu - cała mechanika jest
// jednostkowo testowalna, a warstwa serwerowa tylko dostarcza wiersze.
import { localizedPath } from "@/lib/i18n/localePath";
import type { RssItem } from "@/lib/seo/rss";
import { areaLabel, stageLabel } from "@/lib/tracker/stages";

/** Publiczna ścieżka huba trackera - siteUrl kanału i baza autodiscovery. */
export const TRACKER_HUB_PATH = "/tracker";

/**
 * Ścieżka kanału (atom:link rel="self", link autodiscovery, wejście dla ludzi).
 * Stała żyje w module CZYSTYM, bo czytają ją zarówno handler serwerowy, jak i
 * komponenty tras - import z `feed.server.ts` wciągnąłby kod serwerowy do
 * bundla klienta.
 */
export const TRACKER_FEED_PATH = "/tracker/rss.xml";

/** Wiersz dossier potrzebny do zbudowania pozycji kanału. */
export interface TrackerFeedItemSource {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  summary_pl: string | null;
  summary_en: string | null;
  policy_area: string;
  stage: string;
  created_at: string;
  updated_at: string;
}

/** Wiersz osi czasu (aktualizacja dossier). */
export interface TrackerFeedUpdateSource {
  id: string;
  item_id: string;
  note_pl: string;
  note_en: string;
  stage_from: string | null;
  stage_to: string | null;
  happened_on: string;
  created_at: string;
}

export interface TrackerFeedInput {
  /** Opublikowane dossier tenanta hosta (kolejność bez znaczenia). */
  items: readonly TrackerFeedItemSource[];
  /** Aktualizacje dossier; sieroty (bez dossier na liście) są ODRZUCANE. */
  updates: readonly TrackerFeedUpdateSource[];
  /** Absolutny origin żądania ("" w testach - pozycje dostają ścieżki relatywne). */
  origin: string;
  lang: "pl" | "en";
  /** Maksymalna liczba pozycji w kanale (wg ustawień SEO). */
  limit: number;
}

const CHANNEL_TEXT = {
  pl: {
    title: "Tracker legislacyjny UE",
    description:
      "Zmiany w kluczowych dossier legislacyjnych Unii Europejskiej: nowe dossier, zmiany etapu procedury i wpisy osi czasu.",
    newDossier: "nowe dossier",
    update: "aktualizacja",
    stageChange: (from: string, to: string) => `etap: ${from} -> ${to}`,
    stageSet: (to: string) => `etap: ${to}`,
  },
  en: {
    title: "EU legislative tracker",
    description:
      "Changes in key EU legislative files: new files, procedure stage transitions and timeline entries.",
    newDossier: "new file",
    update: "update",
    stageChange: (from: string, to: string) => `stage: ${from} -> ${to}`,
    stageSet: (to: string) => `stage: ${to}`,
  },
} as const;

/** Tytuł i opis kanału per język (warstwa serwerowa nie dubluje tych stringów). */
export function trackerFeedChannelText(lang: "pl" | "en"): { title: string; description: string } {
  const text = CHANNEL_TEXT[lang];
  return { title: text.title, description: text.description };
}

function localizedTitle(item: TrackerFeedItemSource, lang: "pl" | "en"): string {
  const primary = lang === "en" ? item.title_en : item.title_pl;
  const secondary = lang === "en" ? item.title_pl : item.title_en;
  return primary.trim() || secondary.trim() || item.slug;
}

function localizedSummary(item: TrackerFeedItemSource, lang: "pl" | "en"): string | null {
  const primary = lang === "en" ? item.summary_en : item.summary_pl;
  const secondary = lang === "en" ? item.summary_pl : item.summary_en;
  return primary?.trim() || secondary?.trim() || null;
}

function localizedNote(update: TrackerFeedUpdateSource, lang: "pl" | "en"): string {
  const primary = lang === "en" ? update.note_en : update.note_pl;
  const secondary = lang === "en" ? update.note_pl : update.note_en;
  return primary.trim() || secondary.trim();
}

/** Etykieta kwalifikatora w tytule pozycji-aktualizacji (zmiana etapu albo zwykły wpis). */
function updateQualifier(update: TrackerFeedUpdateSource, lang: "pl" | "en"): string {
  const text = CHANNEL_TEXT[lang];
  if (update.stage_to && update.stage_from) {
    return text.stageChange(stageLabel(update.stage_from, lang), stageLabel(update.stage_to, lang));
  }
  if (update.stage_to) return text.stageSet(stageLabel(update.stage_to, lang));
  return text.update;
}

/** Data publikacji pozycji: created_at, a gdy jest niepoprawna - happened_on. */
function updateDate(update: TrackerFeedUpdateSource): string {
  const created = Date.parse(update.created_at);
  if (Number.isFinite(created)) return update.created_at;
  return update.happened_on;
}

function sortKey(publishedAt: string | null): number {
  if (!publishedAt) return 0;
  const parsed = Date.parse(publishedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Zbuduj pozycje kanału RSS trackera.
 *
 * Gwarancje kontraktu (pilnowane testami):
 *  - aktualizacja BEZ dossier na liście jest pomijana (defense in depth: nawet
 *    gdyby czytnik zwrócił wpis dossier nieopublikowanego albo z innego
 *    tenanta, jego treść nie wycieknie do publicznego kanału),
 *  - GUID-y są stabilne i rozłączne (`tracker:item:<id>` / `tracker:update:<id>`),
 *    bo wiele aktualizacji dzieli JEDEN adres dossier - guid=permalink dawałby
 *    czytnikom duplikaty i gubił alerty,
 *  - porządek jest deterministyczny: malejąco po dacie, remisy rozstrzyga guid
 *    (bez tiebreakera dwa wpisy z tą samą sekundą zamieniałyby się miejscami
 *    między requestami i mrugały w czytnikach),
 *  - limit obcina wynik PO scaleniu i posortowaniu.
 */
export function buildTrackerFeedItems(input: TrackerFeedInput): RssItem[] {
  const { items, updates, origin, lang, limit } = input;
  if (limit <= 0) return [];

  const byId = new Map<string, TrackerFeedItemSource>();
  for (const item of items) byId.set(item.id, item);

  const itemUrl = (slug: string) => `${origin}${localizedPath(`/tracker/${slug}`, lang)}`;

  const dossierEntries: RssItem[] = items.map((item) => ({
    url: itemUrl(item.slug),
    guid: `tracker:item:${item.id}`,
    title: `${localizedTitle(item, lang)} (${CHANNEL_TEXT[lang].newDossier})`,
    description: localizedSummary(item, lang),
    publishedAt: item.created_at,
    categories: [areaLabel(item.policy_area, lang), stageLabel(item.stage, lang)],
  }));

  const updateEntries: RssItem[] = [];
  for (const update of updates) {
    const item = byId.get(update.item_id);
    if (!item) continue;
    const stage = update.stage_to ?? item.stage;
    updateEntries.push({
      // Kotwica wpisu osi czasu: czytnik prowadzi wprost do zmiany, nie na
      // górę dossier (id kotwicy zgodne z `routes/tracker.$slug.tsx`).
      url: `${itemUrl(item.slug)}#update-${update.id}`,
      guid: `tracker:update:${update.id}`,
      title: `${localizedTitle(item, lang)} - ${updateQualifier(update, lang)}`,
      description: localizedNote(update, lang),
      publishedAt: updateDate(update),
      categories: [areaLabel(item.policy_area, lang), stageLabel(stage, lang)],
    });
  }

  return [...dossierEntries, ...updateEntries]
    .sort((a, b) => {
      const delta = sortKey(b.publishedAt) - sortKey(a.publishedAt);
      if (delta !== 0) return delta;
      return (a.guid ?? a.url).localeCompare(b.guid ?? b.url);
    })
    .slice(0, limit);
}
