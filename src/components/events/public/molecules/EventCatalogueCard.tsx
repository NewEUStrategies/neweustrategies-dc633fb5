// Kafel wydarzenia w katalogu `/events` (`routes/events.index.tsx`).
//
// DLACZEGO POZA PLIKIEM TRASY (2026-10-16). Eksport z pliku trasy zostaje w module OPCJI trasy
// (splitter TanStacka przenosi do chunków podziału tylko komponenty i loader), a moduł opcji
// importuje drzewo tras z wejścia - jest więc `$initial`. Rolldown liczy ten tag przed
// tree-shakingiem, więc grupa `app-initial` (scripts/lib/clientChunkGroups.ts) zabierała
// zależności eksportowanego kafla - `lib/events/timezone.ts`, 7 KB - do chunku bootu KAŻDEJ
// strony, choć używa ich wyłącznie leniwy komponent katalogu. Rollup ten nieużyty eksport
// wycinał. Tu kafel jest zwykłym modułem komponentu: importuje go tylko chunk komponentu trasy.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { BadgeCheck, Calendar, Lock, MapPin, Users, Video } from "lucide-react";
import type { PublicEvent } from "@/lib/community/publicQueries";
import { eventTimeZoneLabel, formatEventDateTime } from "@/lib/events/timezone";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";

// Format wydarzenia -> klucz slownika. Mapa, nie sklejanie napisu z wartosci
// kolumny: `t("community.events.format" + capitalize(ev.format))` dawaloby klucz
// niewidoczny dla bramki parytetu PL/EN i cichy brak napisu przy nowej wartosci
// w CHECK. Nieznana wartosc daje null, czyli BRAK plakietki - kafel bez plakietki
// czyta sie jak brak informacji, a kafel z surowym „onsite” jak awaria.
const EVENT_FORMAT_KEY: Record<string, string> = {
  onsite: "community.events.formatOnsite",
  online: "community.events.formatOnline",
  hybrid: "community.events.formatHybrid",
};

// Kafel montuje test (`eventsCatalogueFormatBadge.test.tsx`) z prawdziwym wierszem
// `PublicEvent`: dowód „plakietka formatu bierze się z `events.format`" ma zamontować kafel,
// a nie porównywać kształt kodu. Bramka, która czytała importy zamiast drzewa, była już w tym
// repozytorium zielona wtedy, gdy pilnowana rzecz była zepsuta.
export function EventCard({ event, lang }: { event: PublicEvent; lang: "pl" | "en" }) {
  const { t } = useTranslation();
  // `events.format` (onsite/online/hybrid) - to jest kolumna, ktora zapisuje
  // droplista „Format” w studiu. Poprzednio kafel czytal `events.kind`, ktorego
  // studio nie rusza i ktorego CHECK nie dopuszcza wartosci „online” - warunek
  // nie mial jak byc prawdziwy ani jednego razu.
  const formatKey = EVENT_FORMAT_KEY[event.format] ?? null;
  const title = lang === "en" ? event.title_en || event.title_pl : event.title_pl || event.title_en;
  // FALLBACK JAK W TYTULE, i z tego samego powodu. Bez niego wydarzenie opisane
  // tylko po polsku ma na kaflu sam tytul, a czytelnik z interfejsem EN nie
  // dowie sie z katalogu, czego dotyczy - mimo ze redakcja opis wpisala.
  const desc =
    lang === "en"
      ? event.description_en || event.description_pl
      : event.description_pl || event.description_en;
  // Godzina liczy sie w STREFIE WYDARZENIA, nie w strefie przegladarki, a obok
  // niej stoi nazwa tej strefy. Bez jednego i drugiego uczestnik z Brukseli
  // czytal godzine warszawska jako swoja i przychodzil o zlej godzinie - to jest
  // zadanie EB-912 z projektu frontu, punkt "strefa czasowa: jedna funkcja,
  // cztery miejsca do naprawy". Etykieta jest wyliczana ze strefy WYDARZENIA
  // (deterministycznie), a nie ze strefy widza - strefa widza jest znana dopiero
  // po montazu i rozjechalaby hydratacje.
  const when = formatEventDateTime(event.starts_at, event.timezone, lang);
  const zone = eventTimeZoneLabel(event.starts_at, event.timezone, lang);
  return (
    <li className="group relative overflow-hidden rounded-lg border border-border bg-card transition hover:border-primary/60">
      {event.cover_url && (
        <div className="aspect-video w-full overflow-hidden bg-muted">
          {/* Karta maluje się na max ~576 px (md:grid-cols-2); responsywny
              srcSet zdejmuje pobieranie pełnowymiarowego oryginału na kartę.
              Układ rezerwuje rodzic (aspect-video). */}
          <OptimizedImage
            src={event.cover_url}
            alt=""
            responsive
            sizes="(min-width: 768px) 45vw, 92vw"
            className="h-full w-full object-cover"
          />
        </div>
      )}
      <div className="p-5">
        {event.visibility === "members" && (
          <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            {event.kind === "briefing" ? (
              <>
                <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                {t("community.events.proBriefing")}
              </>
            ) : (
              <>
                <Lock className="h-3 w-3" aria-hidden="true" />
                {t("community.events.membersOnly")}
              </>
            )}
          </span>
        )}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            {zone === "" ? when : `${when} (${zone})`}
          </span>
          {event.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {event.location}
            </span>
          )}
          {formatKey === null ? null : (
            <span className="inline-flex items-center gap-1">
              <Video className="h-3.5 w-3.5" aria-hidden="true" />
              {t(formatKey)}
            </span>
          )}
          {event.capacity !== null && (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {event.capacity}
            </span>
          )}
        </div>
        <h3 className="mt-3 text-lg font-semibold leading-snug">
          <Link
            to="/events/$slug"
            params={{ slug: event.slug }}
            className="after:absolute after:inset-0"
          >
            {title}
          </Link>
        </h3>
        {desc && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{desc}</p>}
        <span className="mt-4 inline-block text-sm font-medium text-primary">
          {t("community.events.readMoreAbout", { title })} -&gt;
        </span>
      </div>
    </li>
  );
}
