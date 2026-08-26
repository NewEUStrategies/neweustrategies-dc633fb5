// Nagłówek wideo wydarzenia - platforma, identyfikator materiału, adres
// osadzenia.
//
// DLACZEGO OSOBNY MODUŁ, A NIE FUNKCJA W `eventGeneralDraft`. Panel POBIERA
// identyfikator (redaktor wkleja adres z paska przeglądarki), a strona
// publiczna go OSADZA - i obie strony muszą liczyć adres `src` tą samą regułą.
// Dopóki reguła siedziała w module wersji roboczej ekranu panelu, front
// musiałby ją powtórzyć; drugie sklejenie adresu osadzenia to drugie miejsce,
// w którym można zgubić walidację identyfikatora.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero klienta bazy.

/** Platformy naglowka wideo. Pusty napis = brak naglowka wideo. */
export const EVENT_VIDEO_PLATFORMS = ["youtube", "vimeo"] as const;
export type EventVideoPlatform = (typeof EVENT_VIDEO_PLATFORMS)[number];

/**
 * Identyfikator materialu z adresu albo z samego identyfikatora.
 *
 * Redaktor wkleja CALY adres z paska przegladarki - i to jest zachowanie,
 * ktorego nie da sie oduczyc etykieta. Pole przyjmuje jedno i drugie.
 */
export function parseVideoId(input: string, platform: EventVideoPlatform): string {
  const value = input.trim();
  if (value === "") return "";
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    if (platform === "youtube") {
      const fromQuery = url.searchParams.get("v");
      if (fromQuery !== null && fromQuery !== "") return fromQuery;
      const segments = url.pathname.split("/").filter((part) => part !== "");
      return segments[segments.length - 1] ?? "";
    }
    const segments = url.pathname.split("/").filter((part) => part !== "");
    return segments[segments.length - 1] ?? "";
  } catch {
    return value;
  }
}

/** Adres osadzenia naglowka wideo albo `null`, gdy naglowka nie ma. */
export function videoEmbedUrl(platform: EventVideoPlatform, videoId: string): string | null {
  const id = videoId.trim();
  if (id === "") return null;
  // To jest zabezpieczenie przed wstrzyknieciem do atrybutu `src`: adres
  // powstaje przez sklejenie napisu, wiec identyfikator musi byc zamkniety
  // w alfabecie, ktory nie potrafi wyjsc z atrybutu ani z domeny.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return platform === "youtube"
    ? `https://www.youtube-nocookie.com/embed/${id}`
    : `https://player.vimeo.com/video/${id}`;
}

/**
 * Platforma z kolumny `events.video_header_platform`.
 *
 * NIEZNANA WARTOSC CZYTA SIE JAKO YOUTUBE, dokladnie jak w szkicu panelu:
 * kolumna jest nullowalna i trzyma pusty napis dla wydarzenia bez naglowka
 * wideo, a o tym, CZY naglowek istnieje, decyduje identyfikator - nie
 * platforma. Zwracanie `null` zmusiloby kazde wywolanie do drugiego warunku
 * o tym samym.
 */
export function asEventVideoPlatform(value: string | null | undefined): EventVideoPlatform {
  return typeof value === "string" && (EVENT_VIDEO_PLATFORMS as readonly string[]).includes(value)
    ? (value as EventVideoPlatform)
    : "youtube";
}
