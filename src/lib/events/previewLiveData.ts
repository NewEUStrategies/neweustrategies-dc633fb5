// PRAWDZIWE DANE WYDARZENIA DLA PODGLADU STUDIA.
//
// PO CO OSOBNE MAPOWANIE. Publiczne projekcje (`event_agenda`,
// `get_public_speakers`, `event_attendees`) maja w ciele `AND e.status =
// 'published'` albo wymagaja, zeby WOLAJACY byl zapisany na wydarzenie - na
// szkicu oddaja pustke, wiec redaktor widzial w podgladzie sam naglowek strony
// modulowej. Panel czyta te same wiersze utwardzonymi RPC administracyjnymi
// (`admin_event_sessions_list`, `admin_event_speakers_list`,
// `admin_event_registrations_list`), a ten modul sprowadza je do KSZTALTU
// POWIERZCHNI PUBLICZNEJ - dzieki temu podglad rysuje program i prelegentow
// TYMI SAMYMI komponentami, co strona, a nie druga kopia ukladu.
//
// CZEGO TU NIE MA I DLACZEGO. Stan WOLAJACEGO (zapis na sesje, dostep warstwy)
// nalezy do uczestnika, nie do organizatora ogladajacego wlasny szkic - dlatego
// `mySignupStatus` jest zawsze `null`, a `accessState` opisuje sam zapis
// ("otwarte" albo "wymaga zapisu"), nie decyzje reguly dla konkretnej osoby.
import type { AgendaAccessState, AgendaFormat, AgendaSession } from "@/lib/events/agendaSurface";
import { AGENDA_FORMATS } from "@/lib/events/agendaSurface";
import type { EventSessionRow } from "@/lib/events/sessionsApi";
import type { EventSpeakerEntry } from "@/lib/admin/community";
import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import type { AttendeeEntry } from "@/lib/events/publicEventApi";
import type { EventRegistrationRow } from "@/lib/events/registrationsApi";

const nullable = (value: string | null | undefined): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

function formatOf(value: string): AgendaFormat {
  return (AGENDA_FORMATS as readonly string[]).includes(value) ? (value as AgendaFormat) : "onsite";
}

/**
 * Wiersz sesji z panelu -> sesja programu w ksztalcie strony publicznej.
 *
 * `timezone` wchodzi z WYDARZENIA, bo lista panelu jej nie oddaje - sesja bez
 * strefy rysowalaby godziny w strefie przegladarki redaktora.
 */
export function agendaSessionsFromAdminRows(
  rows: readonly EventSessionRow[] | undefined,
  timezone: string,
): AgendaSession[] {
  if (rows === undefined) return [];
  return rows
    .filter((row) => row.status !== "cancelled" && !row.is_private)
    .map((row) => {
      const accessState: AgendaAccessState = row.requires_signup ? "signup_required" : "open";
      return {
        id: row.id,
        eventId: row.event_id,
        parentSessionId: nullable(row.parent_session_id),
        titlePl: nullable(row.title_pl),
        titleEn: nullable(row.title_en),
        descriptionPl: nullable(row.description_pl),
        descriptionEn: nullable(row.description_en),
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        timezone: nullable(timezone),
        format: formatOf(row.format),
        status: "published" as const,
        sortOrder: row.sort_order,
        chathamHouse: row.chatham_house,
        minTierRank: row.min_tier_rank,
        requiresSignup: row.requires_signup,
        capacity: row.capacity === null ? null : row.capacity,
        registeredCount: row.registered_count,
        seatsLeft: row.seats_left === null ? null : row.seats_left,
        track:
          nullable(row.track_id) === null
            ? null
            : {
                id: row.track_id,
                key: nullable(row.track_key),
                namePl: nullable(row.track_name_pl),
                nameEn: nullable(row.track_name_en),
                accentColor: nullable(row.track_accent_color),
              },
        room:
          nullable(row.room_id) === null
            ? null
            : { id: row.room_id, name: nullable(row.room_name), floor: null },
        hasStream: row.has_stream,
        hasRecording: row.has_recording,
        // Zapis nalezy do uczestnika - organizator nie ma tu wlasnego stanu.
        mySignupStatus: null,
        accessState,
        speakers: [],
      } satisfies AgendaSession;
    });
}

/**
 * Rejestr prelegentow panelu -> wiersze karty publicznej.
 *
 * ODSIEWAMY NIEPUBLICZNYCH (`is_public === false`): strona publiczna ich nie
 * pokaze, wiec podglad, ktory by je narysowal, obiecywalby cos, czego po
 * publikacji nie bedzie.
 */
export function speakerRowsFromAdminEntries(
  entries: readonly EventSpeakerEntry[] | undefined,
): PublicSpeakerRow[] {
  if (entries === undefined) return [];
  return entries
    .filter((entry) => entry.is_public)
    .map((entry) => ({
      speaker_profile_id: entry.speaker_profile_id,
      user_id: entry.user_id ?? "",
      person_id: entry.person_id,
      slug: null,
      display_name: entry.display_name,
      avatar_url: entry.avatar_url,
      job_title: entry.job_title,
      company: entry.company,
      headline_pl: null,
      headline_en: null,
      bio_pl: null,
      bio_en: null,
      topics_pl: [],
      topics_en: [],
      languages: [],
      talks_count: 0,
      rating: 0,
      reviews_count: 0,
      is_expert: false,
      has_speaker_profile: entry.speaker_profile_id !== "",
      sort_order: entry.sort_order,
    }));
}

/**
 * Zgloszenia panelu -> wpisy katalogu uczestnikow w ksztalcie strony.
 *
 * WCHODZA WYLACZNIE ZATWIERDZENI (`status === "approved"`): katalog publiczny
 * nie zna listy rezerwowej ani zgloszen odrzuconych, wiec podglad, ktory by je
 * pokazal, obiecywalby cos, czego po publikacji nie bedzie.
 */
export function attendeeEntriesFromRegistrationRows(
  rows: readonly EventRegistrationRow[] | undefined,
): AttendeeEntry[] {
  if (rows === undefined) return [];
  return rows
    .filter((row) => row.status === "approved")
    .map((row) => ({
      registrationId: row.id,
      name: [row.first_name ?? "", row.last_name ?? ""]
        .map((part) => part.trim())
        .filter((part) => part !== "")
        .join(" "),
      jobTitle: nullable(row.job_title),
      company: nullable(row.company_name) ?? nullable(row.company_text),
      avatarUrl: null,
      profileSlug: null,
      groups:
        nullable(row.group_id) === null
          ? []
          : [
              {
                id: row.group_id,
                namePl: row.group_name_pl ?? "",
                nameEn: row.group_name_en ?? "",
                color: nullable(row.group_color),
              },
            ],
    }))
    .filter((entry) => entry.name !== "");
}
