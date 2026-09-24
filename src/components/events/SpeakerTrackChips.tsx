// Atom: SCIEZKI, w ktorych prelegent wystepuje - jeden rysunek jednego faktu.
//
// PO CO OSOBNO. Ten sam fakt stoi na karcie w siatce prelegentow, w chipie
// zapowiedzi na przegladzie i przy nazwisku w programie. Trzy kopie tego samego
// JSX-a rozjechalyby sie przy pierwszej zmianie (raz z kolorem, raz bez) -
// dokladnie z tego powodu plakietka eksperta ma jeden renderer
// (`SpeakerExpertBadge`), i tak samo jest tutaj.
//
// SCIEZKI SA WYPROWADZONE, NIE WPISANE. Przychodza z bazy (obsada sesji ->
// sciezka sesji) albo - w programie - sa liczone z tej samej listy sesji,
// ktora rysuje strona. Atom niczego nie dopowiada: pusta lista = nic.
//
// BEZ `<li>`. Karta prelegenta jest pozycja listy siatki, a bramki parytetu
// licza `li` na karte; zagniezdzona lista sciezek podwajalaby ten licznik.
// Czytnik ekranu dostaje zamiast tego jedno zdanie: „Sciezki: A, B".
//
// 6 PX. Chip ma promien platformy (6 px), tak jak zdjecia i przyciski karty.
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { speakerTrackName, type SpeakerTrack } from "@/lib/events/speakerCard";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

export type SpeakerTrackChipsVariant = "chips" | "compact";

export function SpeakerTrackChips({
  tracks,
  lang,
  variant = "chips",
  inverse = false,
  label,
  className,
}: {
  tracks: readonly SpeakerTrack[];
  lang: "pl" | "en";
  /** `compact` = same kwadraty koloru (chip zapowiedzi), `chips` = z nazwami. */
  variant?: SpeakerTrackChipsVariant;
  /** Napis na zdjeciu (rozwinieta karta) - jasny tekst na ciemnym tle. */
  inverse?: boolean;
  /** Etykieta dla czytnika ekranu; domyslnie „Sciezki". */
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const named = tracks
    .map((track) => ({ track, name: speakerTrackName(track, lang) }))
    .filter((entry) => entry.name !== "");
  if (named.length === 0) return null;

  // Jezyk z propsa, jak nazwy sciezek - naglowek i nazwy w jednym jezyku.
  const heading = label ?? t("eventFront.speakers.card.tracksLabel", { lng: lang });
  const spoken = `${heading}: ${named.map((entry) => entry.name).join(", ")}`;

  if (variant === "compact") {
    return (
      <span className={cn("inline-flex items-center gap-1", className)} title={spoken}>
        <span className="sr-only">{spoken}</span>
        {named.map(({ track }) => (
          <span
            key={track.id}
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-[3px] border border-border bg-muted"
            style={track.accentColor === null ? undefined : { backgroundColor: track.accentColor }}
          />
        ))}
      </span>
    );
  }

  return (
    <span className={cn("flex w-full flex-wrap items-center gap-1.5", className)}>
      <span className="sr-only">{heading}: </span>
      {named.map(({ track, name }) => (
        <span
          key={track.id}
          title={name}
          className={cn(
            "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[6px] border px-1.5 py-0.5 text-[11px] font-medium leading-tight",
            inverse
              ? "border-white/30 bg-black/40 text-white"
              : "border-border bg-background text-muted-foreground",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "h-2 w-2 shrink-0 rounded-[2px]",
              track.accentColor === null && (inverse ? "bg-white/80" : "bg-muted-foreground/60"),
            )}
            style={track.accentColor === null ? undefined : { backgroundColor: track.accentColor }}
          />
          <span className="truncate">{name}</span>
        </span>
      ))}
    </span>
  );
}
