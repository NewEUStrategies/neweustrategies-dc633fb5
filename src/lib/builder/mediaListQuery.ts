// Wiązanie treści widgetu z PUBLICZNYMI zapytaniami mediów: `podcast-latest`
// i `web-stories-carousel`.
//
// CO TU JEST, A CZEGO NIE. Fabryki zapytań już istniały i są bezpieczne
// serwerowo - `latestPodcastsQueryOptions` grzeje się w loaderze
// `routes/podcasts.index.tsx`, a `latestWebStoriesQueryOptions` w loaderze
// `routes/web-stories.index.tsx`, oba przez `loadResilient`, czyli na serwerze.
// Brakowało WYŁĄCZNIE przełożenia treści widgetu na argument `limit` w jednym
// miejscu, żeby rejestr prefetchu SSR (`prefetch.widgetQueryOptionsList`) mógł
// je w ogóle wymienić. Bez tego wpisu oba widgety wychodziły z serwera jako
// stan `isLoading` („…"), a karta odcinka i kafelek historii - razem
// z okładkami, czyli wewnątrz obszaru LCP - doskakiwały po hydratacji.
// Dodatkowo sekcja z samym takim widgetem miała PUSTĄ listę zapytań, więc
// `shouldStreamSection` klasyfikowała ją jako statyczną.
//
// DLACZEGO `limit` LICZYMY TUTAJ, A NIE W GAŁĘZI PREFETCHU. `limit` wchodzi do
// KLUCZA (`["podcasts","latest",N]` / `["web-stories","latest",N]`). Inna
// liczba to inny klucz, czyli rozgrzany wpis, którego widget nigdy nie
// przeczyta: prefetch bez skutku, a przy tym drugie zapytanie po hydratacji -
// dokładnie ta klasa cichej awarii, którą ten moduł zamyka. Jedna funkcja na
// jeden widget czyni rozjazd niewyrażalnym.
import type { WidgetContent } from "@/lib/builder/types";
import { latestPodcastsQueryOptions } from "@/lib/queries/podcasts";
import { latestWebStoriesQueryOptions } from "@/lib/queries/webStories";

/**
 * Koercja liczby DOKŁADNIE taka, jak lokalny `getNum` w `PodcastLatestView`
 * i `WebStoriesCarouselView`: liczba, string złożony wyłącznie z cyfr, albo
 * wartość domyślna.
 *
 * CELOWO NIE `asNum` z `content-model/contentValue`: tamten przyjmuje też
 * `" 4 "`, `"4.5"` i `"-2"`. Ponieważ wynik ląduje w KLUCZU zapytania, każda
 * różnica koercji rozjeżdża klucz prefetchu z kluczem widgetu i cicho zabija
 * rozgrzewkę. Ta funkcja ma być kopią tego, co robi widok - nie ulepszeniem.
 */
function widgetNum(c: WidgetContent, key: string, fallback: number): number {
  const v = c[key];
  if (typeof v === "number") return v;
  return typeof v === "string" && /^\d+$/.test(v) ? Number(v) : fallback;
}

/**
 * Liczba odcinków. BEZ zaciskania - klamra `Math.max(1, Math.min(limit, 50))`
 * siedzi wewnątrz `queryFn` fabryki podcastów, czyli POZA kluczem, więc widok
 * wstawia do klucza wartość surową i my musimy zrobić to samo.
 */
export function podcastLatestLimit(c: WidgetContent): number {
  return widgetNum(c, "limit", 4);
}

export function podcastLatestQueryOptions(c: WidgetContent) {
  return latestPodcastsQueryOptions(podcastLatestLimit(c));
}

/**
 * Liczba historii. Tutaj klamra 2..20 JEST częścią klucza (widok zacieśnia
 * wartość PRZED wywołaniem fabryki), więc liczymy ją w tym samym miejscu.
 */
export function webStoriesCarouselLimit(c: WidgetContent): number {
  return Math.max(2, Math.min(20, widgetNum(c, "limit", 8)));
}

export function webStoriesCarouselQueryOptions(c: WidgetContent) {
  return latestWebStoriesQueryOptions(webStoriesCarouselLimit(c));
}
