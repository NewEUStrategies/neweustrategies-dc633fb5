// Nagłówek dokumentu ZAKŁADKI wydarzenia (`/events/$slug/agenda`,
// `/events/$slug/speakers`, `/events/$slug/cfp`).
//
// Zakładka dziedziczy powłokę `events.$slug.tsx`, której `head()` jest sterowany
// danymi wydarzenia. Zakładka, która deklaruje WŁASNE `title`, `og:*`
// i `twitter:card`, NADPISUJE te wpisy powłoki (głębsze dopasowanie wygrywa).
// Stały polski napis w tym miejscu dawał więc każdemu wydarzeniu ten sam tytuł
// karty i ten sam opis w podglądzie linku - także w wersji angielskiej - a do
// tego zdejmował okładkę wydarzenia z podglądu (`twitter:card: summary`).
//
// Tu zakładka dokłada tylko to, co ją odróżnia: nazwę zakładki przed nazwą
// wydarzenia i własny opis. Kanonik, hreflang, okładka i język idą tą samą
// drogą, co w powłoce (`buildContentHead`).
//
// SŁOWNIK TO `i18n-event-head`, NIE `i18n-event-front`: ten moduł jedzie
// w chunku startowym (patrz nagłówek nakładki), więc nie może ciągnąć za sobą
// słownika całego frontu wydarzenia.
import i18n from "@/lib/i18n";
import "@/lib/i18n-event-head";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { buildContentHead, SITE_NAME, type HeadDescriptor, type Lang } from "@/lib/seo/meta";

export type EventTab = "agenda" | "speakers" | "cfp";

// Mapy literałów, nie ternary: bramka kluczy i18n widzi tylko literały, a nowa
// zakładka bez wpisu tutaj nie przejdzie `tsc` (`Record<EventTab, …>`).
const TITLE_KEYS: Record<EventTab, string> = {
  agenda: "eventHead.agendaTitle",
  speakers: "eventHead.speakersTitle",
  cfp: "eventHead.cfpTitle",
};

const DESCRIPTION_KEYS: Record<EventTab, string> = {
  agenda: "eventHead.agendaDescription",
  speakers: "eventHead.speakersDescription",
  cfp: "eventHead.cfpDescription",
};

/** Podzbiór projekcji nagłówka powłoki, którego potrzebuje zakładka. */
export interface EventTabHeadEvent {
  readonly titlePl: string;
  readonly titleEn: string;
  readonly cover: string | null;
}

export function buildEventTabHead(input: {
  tab: EventTab;
  url: string;
  lang: Lang;
  event: EventTabHeadEvent | null;
}): HeadDescriptor {
  // Stały język zamiast globalnego `i18n.language`: ta sama instancja obsługuje
  // równoległe żądania SSR, więc tylko jawne `lng` jest bezpieczne.
  const t = i18n.getFixedT(input.lang);
  const name = pickLocalized(
    input.event === null ? null : { title_pl: input.event.titlePl, title_en: input.event.titleEn },
    "title",
    input.lang,
    t("eventHead.eventFallback"),
  );
  const title = t(TITLE_KEYS[input.tab], { event: name });
  const description = t(DESCRIPTION_KEYS[input.tab], { event: name });

  return buildContentHead({
    url: input.url,
    lang: input.lang,
    type: "article",
    title,
    documentTitle: `${title} - ${SITE_NAME}`,
    description,
    ...(input.event?.cover ? { image: input.event.cover } : {}),
  });
}

/** Strony PRYWATNE wydarzenia (formularz zgłoszenia, panel prelegenta i recenzenta). */
export type EventPrivatePage = "cfpSubmit" | "speakerPanel" | "reviewPanel";

const PRIVATE_TITLE_KEYS: Record<EventPrivatePage, string> = {
  cfpSubmit: "eventHead.cfpSubmitTitle",
  speakerPanel: "eventHead.speakerPanelTitle",
  reviewPanel: "eventHead.reviewPanelTitle",
};

/**
 * Nagłówek strony prywatnej: tytuł karty w języku adresu i `noindex`. Bez
 * kanonika i podglądu linku - te adresy nie są do udostępniania.
 */
export function buildEventPrivateHead(input: { page: EventPrivatePage; lang: Lang }): HeadDescriptor {
  const t = i18n.getFixedT(input.lang);
  return {
    meta: [
      { title: `${t(PRIVATE_TITLE_KEYS[input.page])} - ${SITE_NAME}` },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [],
  };
}
