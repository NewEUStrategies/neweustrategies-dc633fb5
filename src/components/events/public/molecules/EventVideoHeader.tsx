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
        <img src={coverUrl} alt="" className="h-full w-full object-cover" />
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
