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
import type {
  AgendaAccessState,
  AgendaFormat,
  AgendaSession,
  AgendaSpeaker,
  AgendaSponsor,
} from "@/lib/events/agendaSurface";
import { AGENDA_FORMATS } from "@/lib/events/agendaSurface";
import type { EventSessionRow, EventTrackRow } from "@/lib/events/sessionsApi";
import type { EventSpeakerEntry } from "@/lib/admin/community";
import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import type { SpeakerTrack } from "@/lib/events/speakerCard";
import type { AttendeeEntry } from "@/lib/events/publicEventApi";
import type { EventRegistrationRow } from "@/lib/events/registrationsApi";

const nullable = (value: string | null | undefined): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

function formatOf(value: string): AgendaFormat {
  return (AGENDA_FORMATS as readonly string[]).includes(value) ? (value as AgendaFormat) : "onsite";
}

/**
 * Sponsor z wiersza panelu w ksztalcie strony - albo `null`, gdy strona
 * publiczna by go NIE pokazala.
 *
 * `event_agenda` dolacza sponsora warunkiem `is_published`, a listy panelu
 * oddaja kazde przypiecie. Bez tego filtra podglad obiecywalby logo partnera,
 * ktore uczestnik zobaczy dopiero po ogloszeniu przypiecia (klasa 1 z testow).
 * `published === undefined` znaczy „wywolujacy nie zna stanu ogloszen" -
 * wtedy ufamy wierszowi, jak przed wprowadzeniem filtra.
 */
function previewSponsor(
  row: {
    sponsor_id: string | null;
    sponsor_name: string | null;
    sponsor_logo_url: string | null;
    sponsor_role: string | null;
  },
  published: ReadonlySet<string> | undefined,
): AgendaSponsor | null {
  const id = nullable(row.sponsor_id);
  if (id === null || (published !== undefined && !published.has(id))) return null;
  return {
    id,
    name: nullable(row.sponsor_name),
    logoUrl: nullable(row.sponsor_logo_url),
    role: nullable(row.sponsor_role),
  };
}

/**
 * Zbior ogloszonych przypiec do filtra `previewSponsor` - albo `undefined`,
 * gdy wywolujacy NIE MA pewnosci, ze zna je wszystkie.
 *
 * LISTA JEST PELNA, FILTR JEST TUTAJ. Nakladka pyta o WSZYSTKIE przypiecia
 * (pas i sekcja „Partnerzy" pokazuja tez nieogloszone, znaczone plakietka),
 * a program i sciezki maja dalej pokazywac sponsora TYLKO z przypiecia
 * ogloszonego - wiec wiersz `is_published = false` do zbioru nie wchodzi.
 * Wiersz bez tego pola (wywolujacy, ktory pyta juz z filtrem „published")
 * liczy sie jako ogloszony, jak przed ta zmiana.
 *
 * UCIECIE MOWI `total_count`, NIE ROZMIAR STRONY. Ucieta lista nie dowodzi, ze
 * brakujace przypiecie jest nieogloszone: podglad zdejmowalby sponsora, ktorego
 * strona publiczna pokaze - wiec przy niepewnosci wolimy nie filtrowac (tak jak
 * przed wprowadzeniem filtra). Dawniej niepewnoscia byla PELNA strona
 * (`rows.length >= limit`), ale limit liczy cala liste: 180 ogloszonych i 30
 * nieogloszonych przypiec dawalo dokladnie 200 wierszy i wylaczalo filtr,
 * choc lista byla kompletna. Dzis nakladka czyta liste strona po stronie
 * (`fetchAllSponsors`), a kazdy wiersz RPC niesie `total_count` (`count(*)
 * OVER ()` calej listy) - lista jest ucieta dokladnie wtedy, gdy ta liczba
 * przekracza liczbe wierszy (twardy stop stronicowania). Bierzemy NAJWIEKSZA
 * z wierszy, a nie z pierwszego: strony czytane w roznych chwilach moga ja
 * roznic, a przypiecie dodane miedzy stronami (lista urosla) znaczy liste
 * niepelna. Wiersz bez `total_count` o uciecie nie swiadczy.
 */
export function publishedSponsorIdSet(
  rows:
    | readonly { id: string; is_published?: boolean | null; total_count?: number | null }[]
    | undefined,
): ReadonlySet<string> | undefined {
  if (rows === undefined) return undefined;
  const total = rows.reduce((max, row) => Math.max(max, Number(row.total_count ?? 0)), 0);
  if (total > rows.length) return undefined;
  return new Set(rows.filter((row) => row.is_published !== false).map((row) => row.id));
}

/** Kontekst, ktorego lista sesji panelu sama nie niesie. */
export interface AgendaPreviewContext {
  /** Sciezki wydarzenia - lista sesji nie oddaje sponsora sciezki. */
  tracks?: readonly EventTrackRow[];
  /** Identyfikatory OGLOSZONYCH przypiec sponsorow tego wydarzenia. */
  publishedSponsorIds?: ReadonlySet<string>;
  /**
   * Rejestr prelegentow panelu z OBSADA (`sessions` wpisu). Lista sesji panelu
   * oddaje tylko liczbe prelegentow, wiec obsade sesji odwracamy z rejestru -
   * to jest zapytanie, ktore podglad i tak wykonuje dla siatki prelegentow,
   * a nie drugie.
   */
  speakers?: readonly EventSpeakerEntry[];
}

/**
 * Tozsamosc prelegenta w programie. `event_agenda` oddaje w kluczu `user_id`
 * konto ALBO wiersz kartoteki (`COALESCE(profiles.id, event_people.id)`), wiec
 * podglad robi dokladnie to samo - inaczej indeks sciezek prelegentow
 * (`agendaSpeakerTracks`) mialby w podgladzie inne klucze niz na stronie.
 */
function agendaSpeakerIdentity(entry: EventSpeakerEntry): string {
  return entry.user_id ?? entry.person_id ?? entry.speaker_profile_id;
}

/**
 * Obsada sesji z rejestru panelu, w ksztalcie `AgendaSpeaker`.
 *
 * TE SAME BRAMKI, CO `event_agenda`: nakladka niepubliczna (`is_public =
 * false`) nie wchodzi do obsady, osoba bez nazwy do wyswietlenia tez nie.
 * Rola sceniczna w programie to naglowek nakladki, a w jego braku stanowisko
 * osoby BEZ konta - jak w agendzie (`COALESCE(spf.headline, pe.job_title)`,
 * gdzie `pe` to kartoteka `event_people`). Stanowisko z profilu autora konta
 * agenda pomija, wiec podglad tez - inaczej pokazywalby role, ktorej
 * opublikowany program nie ma.
 */
function speakersBySession(
  entries: readonly EventSpeakerEntry[] | undefined,
): Map<string, AgendaSpeaker[]> {
  const bySession = new Map<string, AgendaSpeaker[]>();
  for (const entry of entries ?? []) {
    if (!entry.is_public) continue;
    const displayName = nullable(entry.display_name);
    if (displayName === null) continue;
    const fallbackRole = entry.user_id === null ? nullable(entry.job_title) : null;
    for (const link of entry.sessions ?? []) {
      const list = bySession.get(link.sessionId) ?? [];
      list.push({
        userId: agendaSpeakerIdentity(entry),
        slug: null,
        displayName,
        avatarUrl: nullable(entry.avatar_url),
        headlinePl: nullable(entry.headline_pl) ?? fallbackRole,
        headlineEn: nullable(entry.headline_en) ?? fallbackRole,
        role: nullable(link.role),
        sortOrder: link.sortOrder,
      });
      bySession.set(link.sessionId, list);
    }
  }
  for (const list of bySession.values()) {
    list.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName, "pl"),
    );
  }
  return bySession;
}

/**
 * Wiersz sesji z panelu -> sesja programu w ksztalcie strony publicznej.
 *
 * `timezone` wchodzi z WYDARZENIA, bo lista panelu jej nie oddaje - sesja bez
 * strefy rysowalaby godziny w strefie przegladarki redaktora. Sponsor sciezki
 * wchodzi z listy sciezek (`context.tracks`): karta sesji siega po niego, gdy
 * sesja nie ma wlasnego, tak jak na stronie.
 */
export function agendaSessionsFromAdminRows(
  rows: readonly EventSessionRow[] | undefined,
  timezone: string,
  context: AgendaPreviewContext = {},
): AgendaSession[] {
  if (rows === undefined) return [];
  const cast = speakersBySession(context.speakers);
  const trackSponsors = new Map<string, AgendaSponsor | null>(
    (context.tracks ?? []).map((track) => [
      track.id,
      previewSponsor(track, context.publishedSponsorIds),
    ]),
  );
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
                sponsor: trackSponsors.get(row.track_id) ?? null,
              },
        room:
          nullable(row.room_id) === null
            ? null
            : { id: row.room_id, name: nullable(row.room_name), floor: null },
        affiliationPl: nullable(row.affiliation_pl),
        affiliationEn: nullable(row.affiliation_en),
        sponsor: previewSponsor(row, context.publishedSponsorIds),
        hasStream: row.has_stream,
        hasRecording: row.has_recording,
        // Zapis nalezy do uczestnika - organizator nie ma tu wlasnego stanu.
        mySignupStatus: null,
        accessState,
        speakers: cast.get(row.id) ?? [],
      } satisfies AgendaSession;
    });
}

/**
 * Sciezki prelegenta w podgladzie - z TYCH SAMYCH sesji, ktore rysuje program
 * podgladu (bez odwolanych i prywatnych, patrz `agendaSessionsFromAdminRows`).
 * Lista panelu (`tracks` wpisu) liczy takze sesje prywatne, a podglad ma
 * pokazac karte taka, jak zobaczy ja uczestnik obok tego programu.
 */
function previewSpeakerTracks(
  entry: EventSpeakerEntry,
  sessions: readonly EventSessionRow[],
): SpeakerTrack[] {
  const visible = new Map(
    sessions
      .filter((row) => row.status !== "cancelled" && !row.is_private)
      .map((row) => [row.id, row] as const),
  );
  const tracks = new Map<string, SpeakerTrack>();
  for (const link of entry.sessions ?? []) {
    const row = visible.get(link.sessionId);
    const trackId = row === undefined ? null : nullable(row.track_id);
    if (row === undefined || trackId === null) continue;
    const known = tracks.get(trackId);
    if (known !== undefined) {
      known.sessionsCount += 1;
      continue;
    }
    tracks.set(trackId, {
      id: trackId,
      key: nullable(row.track_key),
      namePl: nullable(row.track_name_pl),
      nameEn: nullable(row.track_name_en),
      accentColor: nullable(row.track_accent_color),
      sessionsCount: 1,
    });
  }
  return [...tracks.values()].sort(
    (a, b) => (a.key ?? "").localeCompare(b.key ?? "") || a.id.localeCompare(b.id),
  );
}

/**
 * Rejestr prelegentow panelu -> wiersze karty publicznej.
 *
 * ODSIEWAMY NIEPUBLICZNYCH (`is_public === false`): strona publiczna ich nie
 * pokaze, wiec podglad, ktory by je narysowal, obiecywalby cos, czego po
 * publikacji nie bedzie.
 *
 * KARTA JEST TA SAMA. Pola karty rozwijanej kliknieciem i sciezki jada do
 * wiersza, wiec podglad rozwija karte tak samo, jak strona. `sessions` to
 * lista sesji panelu - z niej liczymy sciezki widoczne obok programu podgladu;
 * bez niej karta dostaje sciezki z listy panelu.
 */
export function speakerRowsFromAdminEntries(
  entries: readonly EventSpeakerEntry[] | undefined,
  sessions?: readonly EventSessionRow[],
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
      // Naglowek sceniczny wychodzi publicznie za ta sama bramka `is_public`,
      // ktora ten filtr juz sprawdzil - wiec podglad moze go pokazac.
      headline_pl: entry.headline_pl ?? null,
      headline_en: entry.headline_en ?? null,
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
      card_photo_url: entry.card_photo_url ?? null,
      card_cta_label_pl: entry.card_cta_label_pl ?? null,
      card_cta_label_en: entry.card_cta_label_en ?? null,
      card_cta_url: entry.card_cta_url ?? null,
      card_cta_color: entry.card_cta_color ?? null,
      tracks: sessions === undefined ? (entry.tracks ?? []) : previewSpeakerTracks(entry, sessions),
    }));
}

/**
 * Zgloszenia panelu -> wpisy katalogu uczestnikow w ksztalcie strony.
 *
 * WCHODZA ZATWIERDZENI I OBECNI (`approved`, `attended`): katalog publiczny
 * nie zna listy rezerwowej ani zgloszen odrzuconych, wiec podglad, ktory by je
 * pokazal, obiecywalby cos, czego po publikacji nie bedzie.
 */
export function attendeeEntriesFromRegistrationRows(
  rows: readonly EventRegistrationRow[] | undefined,
): AttendeeEntry[] {
  if (rows === undefined) return [];
  return rows
    .filter((row) => row.status === "approved" || row.status === "attended")
    .map((row) => ({
      registrationId: row.id,
      userId: null,
      name: [row.first_name ?? "", row.last_name ?? ""]
        .map((part) => part.trim())
        .filter((part) => part !== "")
        .join(" "),
      jobTitle: nullable(row.job_title),
      company: nullable(row.company_name) ?? nullable(row.company_text),
      avatarUrl: null,
      profileSlug: null,
      companyLogoUrl: null,
      companyWebsite: null,
      industry: null,
      specialization: null,
      seekingPl: null,
      seekingEn: null,
      offeringPl: null,
      offeringEn: null,
      bioPl: null,
      bioEn: null,
      socialLinks: {},
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

/**
 * Sciezki panelu -> pasek pasm nad programem w podgladzie.
 *
 * WCHODZA TAKZE SCIEZKI ZE SZKICAMI: redaktor musi zobaczyc pasmo, ktore
 * wlasnie zalozyl, zanim opublikuje sesje - dlatego liczba szkicow jedzie
 * osobno, zamiast filtrowac wiersz.
 */
export interface PreviewTrackChip {
  id: string;
  namePl: string | null;
  nameEn: string | null;
  accentColor: string | null;
  sponsorName: string | null;
  sponsorLogoUrl: string | null;
  sessionsCount: number;
  draftCount: number;
  isPublic: boolean;
}

export function trackChipsFromAdminRows(
  rows: readonly EventTrackRow[] | undefined,
  publishedSponsorIds?: ReadonlySet<string>,
): PreviewTrackChip[] {
  if (rows === undefined) return [];
  return rows
    .filter((row) => row.is_active !== false)
    .map((row) => {
      // Ten sam filtr ogloszen, co przy sesjach - patrz `previewSponsor`.
      const sponsor = previewSponsor(row, publishedSponsorIds);
      return {
        id: row.id,
        namePl: nullable(row.name_pl),
        nameEn: nullable(row.name_en),
        accentColor: nullable(row.accent_color),
        sponsorName: sponsor?.name ?? null,
        sponsorLogoUrl: sponsor?.logoUrl ?? null,
        sessionsCount: row.sessions_count ?? 0,
        draftCount: row.draft_count ?? 0,
        isPublic: row.is_public !== false,
      };
    });
}
