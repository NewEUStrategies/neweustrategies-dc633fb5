// Molekuła: nagłówek strony wydarzenia - wideo albo okładka.
//
// OKŁADKA JEST NADAL WYMAGANA, A NIE ZAPASOWA. Miniatura w katalogu wydarzeń,
// w karcie społecznościowej (OG) i w e-mailu bierze się z OBRAZU - klatka
// z YouTube'a nie pojedzie ani w `og:image`, ani w liście. Ten sam warunek stoi
// w bazie (`events_video_header_requires_cover`) i w regule panelu
// (`validateEventGeneralDraft`), więc nagłówek wideo NIGDY nie zwalnia
// organizatora z okładki.
//
// NIEPRAWIDŁOWY IDENTYFIKATOR RYSUJE OKŁADKĘ, NIE PUSTY PROSTOKĄT. `null`
// z `videoEmbedUrl` znaczy „nie ma czego osadzić" - identyfikator jest pusty
// albo wyszedł poza alfabet [A-Za-z0-9_-] (zabezpieczenie przed wstrzyknięciem
// do atrybutu `src`). Jedno i drugie to stan danych, a nie awaria strony:
// uczestnik ma zobaczyć obraz wydarzenia, a nie szarą ramkę.
//
// BEZ AUTOPLAY. `allow` celowo nie wymienia `autoplay` - dźwięk startujący sam
// na stronie wydarzenia jest wadą, nie funkcją. `referrerPolicy` obcina
// ścieżkę adresu wychodzącą do platformy wideo.
//
// OKŁADKA TO KANDYDAT LCP PRZEGLĄDU: eager (bez `loading`), `fetchPriority="high"`
// i `data-lcp-candidate`. Komponent stoi w obu miejscach JAKO baner na szczycie
// głównej kolumny - przegląd `events.$slug.index.tsx` i podgląd studia
// `EventPreviewCanvas` - więc wysoki priorytet nigdy nie trafia w obraz poboczny.
// To z tego `<img>` React 19 wstawia JEDYNY preload okładki
// (`<link rel="preload" as="image">`) w `<head>` (klucz: surowy `src`, bez
// `srcSet`); trasa `events.$slug.tsx` NIE dokłada drugiego z `head()`, a ten
// sam `cover_url` wysyła tylko nagłówkiem HTTP `Link`. `loading="lazy"`
// zdjąłby ten preload i opóźnił baner, a `<picture>`/`srcSet` rozjechałyby
// klucz z nagłówkiem `Link` (dwa pobrania).
import { useTranslation } from "react-i18next";

import { videoEmbedUrl, asEventVideoPlatform } from "@/lib/events/eventVideoHeader";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

export function EventVideoHeader({
  title,
  coverUrl,
  videoPlatform,
  videoId,
}: {
  /** Tytuł wydarzenia w języku interfejsu - trafia do `title` iframe'a. */
  title: string;
  coverUrl: string | null;
  videoPlatform: string | null;
  videoId: string | null;
}) {
  const { t } = useTranslation();
  const embedUrl = videoEmbedUrl(asEventVideoPlatform(videoPlatform), videoId ?? "");

  if (embedUrl === null) {
    if (coverUrl === null || coverUrl.trim() === "") return null;
    return (
      <div className="mb-8 aspect-video overflow-hidden rounded-lg bg-muted">
        <img
          src={coverUrl}
          alt=""
          fetchPriority="high"
          data-lcp-candidate=""
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div className="mb-8 aspect-video overflow-hidden rounded-lg bg-muted">
      <iframe
        src={embedUrl}
        title={t("eventFront.videoHeader.frameTitle", { title })}
        loading="lazy"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        allow="fullscreen; picture-in-picture"
        className="h-full w-full border-0"
      />
    </div>
  );
}
