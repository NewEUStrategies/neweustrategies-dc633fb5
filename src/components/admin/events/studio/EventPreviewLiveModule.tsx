// PODSTRONY MODULOWE W PODGLADZIE STUDIA - PRAWDZIWE DANE, RYSUNEK Z PRODUKCJI.
//
// PROBLEM, KTORY TO ZAMYKA. Zakladki „Program", „Prelegenci" i „Uczestnicy"
// stoja na projekcjach publicznych z bramka `AND e.status = 'published'`
// (albo na tozsamosci wolajacego), wiec w podgladzie SZKICU oddawaly pustke -
// redaktor widzial sam dokument CMS bez ani jednej sesji, ktora wlasnie wpisal.
//
// CZEGO TU NIE MA. WLASNEGO UKLADU. Karty rysuja komponenty produkcyjne:
// `AgendaSessionCard`, `EventSpeakersGridView`, `EventAttendeesGridView`,
// `EventSponsorsSectionView` - te same, ktorych uzywaja `EventAgendaSection`,
// `EventSpeakersGrid`, `EventAttendeesList` i `EventSponsorsSection`. Ten plik
// wnosi wylacznie ZRODLO DANYCH (RPC panelu zamiast projekcji publicznej)
// i martwe przyciski zapisu: organizator ma zobaczyc program, a nie zapisac
// sie na sesje z ekranu panelu.
import { useTranslation } from "react-i18next";

import { EventAgendaBoardView } from "@/components/events/public/organisms/EventAgendaBoardView";
import { EventSpeakersGridView } from "@/components/events/public/organisms/EventSpeakersGrid";
import { EventAttendeesGridView } from "@/components/events/public/organisms/EventAttendeesList";
import { EventSponsorsSectionView } from "@/components/events/public/organisms/EventSponsorsSection";
import { type AgendaSession } from "@/lib/events/agendaSurface";
import type { AttendeeEntry } from "@/lib/events/publicEventApi";
import type { PreviewTrackChip } from "@/lib/events/previewLiveData";
import type { PublicSponsorTier } from "@/lib/events/sponsorsSurface";
import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import { uiLang } from "@/lib/i18n/format";
import { mediaRenderUrl } from "@/lib/media/publicUrl";
// Slownik panelu wprost, a nie „przy okazji" kanwy: ten plik sam czyta klucze
// `adminEvents.studio.preview.*` (puste zdania, plakietka partnera).
import { ensureI18n as ensureAdminEventsI18n } from "@/lib/i18n-admin-events";

/**
 * Fakty z bazy, ktore nakladka podgladu dociaga RPC panelu - dla podstron
 * modulowych i dla partnerow strony glownej.
 */
export interface EventPreviewLiveData {
  sessions: AgendaSession[];
  /** Pasma programu - takze te ze szkicami, zeby redaktor je widzial. */
  tracks: PreviewTrackChip[];
  speakers: PublicSpeakerRow[];
  attendees: AttendeeEntry[];
  /**
   * Partnerzy poziomami, w kolejnosci strony publicznej - takze NIEOGLOSZENI,
   * znaczeni `isDraft` (plakietke rysuje kanwa i zakladka „Partnerzy").
   * Jedno zrodlo dla pasa, sekcji „Partnerzy" i zakladki modulowej.
   */
  sponsorTiers: readonly PublicSponsorTier[];
}

export const EMPTY_PREVIEW_LIVE_DATA: EventPreviewLiveData = {
  sessions: [],
  tracks: [],
  speakers: [],
  attendees: [],
  sponsorTiers: [],
};

function EmptyNote({ text }: { text: string }) {
  return (
    <p className="rounded-[6px] border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
      {text}
    </p>
  );
}

/** Pasek pasm nad programem - nazwa, kolor akcentu, licznik szkicow. */
function PreviewTracks({ tracks }: { tracks: readonly PreviewTrackChip[] }) {
  const { t, i18n } = useTranslation();
  const en = uiLang(i18n.language) === "en";
  if (tracks.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">
        {t("adminEvents.studio.preview.tracksLabel")}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {tracks.map((track) => (
          <li
            key={track.id}
            className="inline-flex items-center gap-2 rounded-[6px] border border-border bg-card px-3 py-1.5 text-sm"
            style={track.accentColor === null ? undefined : { borderColor: track.accentColor }}
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-[2px] bg-muted-foreground"
              style={
                track.accentColor === null ? undefined : { backgroundColor: track.accentColor }
              }
            />
            <span className="font-medium">
              {(en ? track.nameEn : track.namePl) ?? track.namePl ?? track.nameEn ?? ""}
            </span>
            {track.sponsorLogoUrl !== null && (
              <img
                src={mediaRenderUrl(track.sponsorLogoUrl)}
                alt=""
                loading="lazy"
                className="h-5 w-10 rounded-[4px] object-contain"
              />
            )}
            {track.sponsorName !== null && (
              <span className="max-w-32 truncate text-xs text-muted-foreground">
                {track.sponsorName}
              </span>
            )}
            <span className="text-xs text-muted-foreground">{track.sessionsCount}</span>
            {track.draftCount > 0 && (
              <span className="rounded-[6px] border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                {t("adminEvents.studio.preview.trackDraftBadge", { count: track.draftCount })}
              </span>
            )}
            {!track.isPublic && (
              <span className="rounded-[6px] border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                {t("adminEvents.studio.preview.trackPrivateBadge")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Program w PRODUKCYJNEJ tablicy - zakladki dni, filtr nurtu, bloki sesji.
 *
 * Wczesniej stala tu wlasna plaska lista dni: redaktor widzial w studiu inny
 * uklad, niz uczestnik na stronie. Teraz rysuje `EventAgendaBoardView`, ten sam
 * widok, ktorego uzywa `EventAgendaSection` - podglad wnosi tylko dane szkicu
 * i MARTWY zapis (`signedIn={false}`, brak uchwytow).
 */
function PreviewAgenda({ sessions }: { sessions: readonly AgendaSession[] }) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  if (sessions.length === 0)
    return <EmptyNote text={t("adminEvents.studio.preview.moduleEmptyAgenda")} />;

  return <EventAgendaBoardView sessions={sessions} lang={lang} signedIn={false} />;
}

/**
 * Tresc podstrony modulowej w podgladzie - albo `null`, gdy modul nie ma
 * w podgladzie wlasnej powierzchni danych (materialy, dyskusje).
 *
 * PARTNERZY MAJA SWOJA GALAZ. Publiczna zakladka `/partners` rysuje pod
 * dokumentem CMS sekcje partnerow z bazy, a dokument zasiany migracja niesie
 * tylko naglowek i zdanie wstepu - bez tej galezi zakladka w podgladzie byla
 * pusta nawet dla partnerow OGLOSZONYCH.
 */
export function EventPreviewLiveModule({
  module,
  data,
}: {
  module: string;
  data: EventPreviewLiveData;
}) {
  ensureAdminEventsI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);

  if (module === "agenda")
    return (
      <div className="space-y-6">
        <PreviewTracks tracks={data.tracks} />
        <PreviewAgenda sessions={data.sessions} />
      </div>
    );

  if (module === "speakers") {
    if (data.speakers.length === 0)
      return <EmptyNote text={t("adminEvents.studio.preview.moduleEmptySpeakers")} />;
    return <EventSpeakersGridView speakers={data.speakers} lang={lang} />;
  }

  if (module === "participants") {
    if (data.attendees.length === 0)
      return <EmptyNote text={t("adminEvents.studio.preview.moduleEmptyAttendees")} />;
    return <EventAttendeesGridView entries={data.attendees} lang={lang} />;
  }

  if (module === "partners") {
    if (data.sponsorTiers.length === 0)
      return <EmptyNote text={t("adminEvents.studio.preview.moduleEmptyPartners")} />;
    return (
      <EventSponsorsSectionView
        tiers={data.sponsorTiers}
        draftLabel={t("adminEvents.studio.preview.sponsorDraftBadge")}
      />
    );
  }

  return null;
}
