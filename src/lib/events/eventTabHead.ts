// Nagłówek dokumentu ZAKŁADKI wydarzenia (`/events/$slug/agenda`,
// `/events/$slug/speakers`).
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

export type EventTab = "agenda" | "speakers";

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
  const title =
    input.tab === "agenda"
      ? t("eventHead.agendaTitle", { event: name })
      : t("eventHead.speakersTitle", { event: name });
  const description =
    input.tab === "agenda"
      ? t("eventHead.agendaDescription", { event: name })
      : t("eventHead.speakersDescription", { event: name });

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
