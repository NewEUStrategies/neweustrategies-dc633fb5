// Warstwa danych widgetow prelegentow (speakers / event-schedule / dialog
// profilu prelegenta). Modul jest OSOBNY od widokow, zeby rejestr prefetchu SSR
// (lib/builder/prefetch.ts) widzial te same queryOptions co klient - klucz
// jest niezalezny od migawki, wiec streamowany widget nie refetchuje po
// hydratacji.
//
// DWIE PROJEKCJE, NIE JEDNA - I TO NIE JEST DUBLIKAT.
//
//   * `event_speakers_public(p_payload)` - LISTA PRELEGENTOW JEDNEGO
//     OPUBLIKOWANEGO WYDARZENIA (zrodlo `event`). UNION rejestru
//     `event_speaker_entries` z legacy `event_speakers`, z LEFT JOIN na
//     `profiles` ORAZ na kartoteke `event_people`.
//   * `get_public_speakers(p_event_id, p_user_ids, p_limit)` - KATALOG
//     publicznych profili (zrodlo `directory`) i odczyt PO `user_id` (chipy
//     agendy, mapa swiata, dialog profilu). Zostaje bez zmiany: obie te
//     powierzchnie pytaja o osoby, ktore KONTO maja z definicji, bo pytaja
//     wlasnie identyfikatorem konta.
//
// DLACZEGO ZRODLO `event` MUSIALO SIE PRZESIAC. `get_public_speakers` zlacza
// rejestr z `profiles` przez INNER JOIN (`JOIN public.profiles p ON p.id =
// b.user_id`). Prelegent WPISANY RECZNIE w studiu (Tresc -> Prelegenci) nie ma
// konta - ma wiersz w `event_people` i `speaker_profiles.person_id` - wiec jego
// `user_id` jest NULL i INNER JOIN kasowal go z listy BEZWARUNKOWO I BEZ BLEDU.
// Redaktor widzial w panelu piecioro nazwisk, a strona wydarzenia pusta sekcje.
// Nowa projekcja bierze nazwisko, zdjecie, stanowisko i firme z kartoteki, gdy
// nie ma konta, a `WHERE p.id IS NOT NULL OR pe.id IS NOT NULL` wycina wylacznie
// wiersze BEZ ZADNEGO zrodla tozsamosci (sierota legacy, konto obcego najemcy).
//
// Oba wywolania sa SECURITY DEFINER, oba zakresuja plaszczyzne przez
// `public_tenant_id()` i oba oddaja wylacznie kolumny publiczne (profiles +
// author_profiles + profile_badges + speaker_profiles + event_people).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetContent } from "@/lib/builder/types";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";
import { edgeTtlCache } from "@/lib/ssrCache";

export type Lang = "pl" | "en";

/** Publiczny wiersz prelegenta - znormalizowany ksztalt dla UI. */
export interface PublicSpeakerRow {
  /**
   * Wpis w rejestrze prelegentow wydarzenia (`speaker_profiles.id`).
   *
   * OPCJONALNE, bo tej kolumny nie ma tylko jedna z dwoch projekcji: katalog
   * i odczyt po `user_id` (`get_public_speakers`) jej nie oddaja w ogole.
   * Wiersz udajacy, ze ja ma, klamalby o swoim pochodzeniu - a to jest jedyna
   * wartosc, ktora dla prelegenta BEZ KONTA istnieje NA PEWNO, wiec na niej
   * stoi klucz karty (patrz `speakerRowKey` w `lib/builder/speakerRow.ts`).
   */
  speaker_profile_id?: string | null;
  /** Konto na platformie. PUSTY NAPIS dla osoby wpisanej recznie w studiu. */
  user_id: string;
  /**
   * Osoba z kartoteki `event_people` - prelegent BEZ konta na platformie.
   * Ustawione dokladnie wtedy, gdy `user_id` jest puste (i odwrotnie); wiersz
   * bez zadnego z dwoch nie jest karta z pustym nazwiskiem, tylko nie jest
   * karta w ogole - odsiewa go i baza, i `fetchEventSpeakers`.
   */
  person_id?: string | null;
  slug: string | null;
  display_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
  company: string | null;
  headline_pl: string | null;
  headline_en: string | null;
  bio_pl: string | null;
  bio_en: string | null;
  topics_pl: string[];
  topics_en: string[];
  languages: string[];
  talks_count: number;
  rating: number;
  reviews_count: number;
  is_expert: boolean;
  has_speaker_profile: boolean;
  sort_order: number;
}

export type SpeakersSource = "manual" | "directory" | "event";

export interface SpeakersInput {
  source: SpeakersSource;
  eventId: string;
  userIds: string[];
  limit: number;
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");
const numOf = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const strArrOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Zrodlo danych widgetu speakers (legacy content bez pola = manual). */
export function speakersSource(c: WidgetContent): SpeakersSource {
  const raw = strOf(c.source);
  return raw === "directory" || raw === "event" ? raw : "manual";
}

/** Znormalizowany input zapytania - pochodna wylacznie tresci widgetu. */
export function speakersInput(c: WidgetContent): SpeakersInput {
  return {
    source: speakersSource(c),
    eventId: strOf(c.eventId),
    userIds: [],
    limit: Math.max(1, Math.min(200, Math.round(numOf(c.limit, 24)))),
  };
}

/** Mapowanie surowego wiersza RPC na znormalizowany ksztalt (unit-testowalne). */
export function mapSpeakerRow(raw: Record<string, unknown>): PublicSpeakerRow {
  return {
    speaker_profile_id: strOf(raw.speaker_profile_id) || null,
    user_id: strOf(raw.user_id),
    person_id: strOf(raw.person_id) || null,
    slug: strOf(raw.slug) || null,
    display_name: strOf(raw.display_name) || null,
    avatar_url: strOf(raw.avatar_url) || null,
    job_title: strOf(raw.job_title) || null,
    company: strOf(raw.company) || null,
    headline_pl: strOf(raw.headline_pl) || null,
    headline_en: strOf(raw.headline_en) || null,
    bio_pl: strOf(raw.bio_pl) || null,
    bio_en: strOf(raw.bio_en) || null,
    topics_pl: strArrOf(raw.topics_pl),
    topics_en: strArrOf(raw.topics_en),
    languages: strArrOf(raw.languages),
    talks_count: Math.max(0, numOf(raw.talks_count)),
    rating: Math.min(5, Math.max(0, numOf(raw.rating))),
    reviews_count: Math.max(0, numOf(raw.reviews_count)),
    is_expert: raw.is_expert === true,
    has_speaker_profile: raw.has_speaker_profile === true,
    sort_order: numOf(raw.sort_order),
  };
}

/**
 * Wywolanie RPC get_public_speakers. Rzutowanie przez `unknown`, bo funkcja
 * pochodzi z migracji 20260727200000, a wygenerowane typy Supabase nie zostaly
 * jeszcze odswiezone (ustalony idiom - patrz popular_post_ids w postListQuery).
 */
async function fetchPublicSpeakers(input: {
  eventId: string | null;
  userIds: string[] | null;
  limit: number;
}): Promise<PublicSpeakerRow[]> {
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: { p_event_id: string | null; p_user_ids: string[] | null; p_limit: number },
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )("get_public_speakers", {
    p_event_id: input.eventId,
    p_user_ids: input.userIds && input.userIds.length ? input.userIds : null,
    p_limit: input.limit,
  });
  if (error) throw new Error(error.message);
  const rows = Array.isArray(data) ? data : [];
  return rows
    .filter(
      (x): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x),
    )
    .map(mapSpeakerRow)
    .filter((row) => row.user_id !== "");
}

/**
 * Wywolanie RPC `event_speakers_public` - lista prelegentow JEDNEGO wydarzenia.
 *
 * BEZ RZUTOWANIA, I TO JEST ROZNICA WZGLEDEM WYWOLANIA WYZEJ. Tamto rzutuje
 * przez `unknown`, bo `get_public_speakers` powstalo w migracji nowszej niz
 * ostatnie odswiezenie wygenerowanych typow. Tu rzutowanie byloby KLAMSTWEM:
 * sygnatura `event_speakers_public` stoi w `src/integrations/supabase/types.ts`
 * (`Functions.event_speakers_public`, `Args: { p_payload: Json }`), wiec
 * wywolanie typuje sie samo, a escape-hatch po prostu wylaczalby kontrole,
 * ktora dziala.
 *
 * PAYLOAD NIESIE `event_id`, NIE `slug`. Funkcja przyjmuje jedno albo drugie
 * (strona publiczna ma slug w adresie, widget ma id), a ta warstwa danych ma id
 * z migawki wydarzenia - i tak samo pyta o nie widget buildera. Jeden ksztalt
 * ladunku znaczy jeden wpis cache dla obu powierzchni.
 *
 * FILTR TOZSAMOSCI JEST INNY NIZ W KATALOGU. Tam pusty `user_id` znaczyl wiersz
 * uszkodzony; tu znaczy PRELEGENTA BEZ KONTA, czyli dokladnie ten wiersz, dla
 * ktorego ta funkcja powstala. Odsiewamy wiec tylko wiersze bez JAKIEJKOLWIEK
 * tozsamosci - te, ktorych i baza nie wypuszcza (`WHERE p.id IS NOT NULL OR
 * pe.id IS NOT NULL`). Warunek stoi po obu stronach swiadomie: bez niego
 * pojedynczy taki wiersz dawalby karte bez nazwiska i klucz pustego napisu.
 */
async function fetchEventSpeakers(input: {
  eventId: string;
  limit: number;
}): Promise<PublicSpeakerRow[]> {
  const { data, error } = await supabase.rpc("event_speakers_public", {
    p_payload: { event_id: input.eventId, limit: input.limit },
  });
  if (error) throw new Error(error.message);
  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((raw) => mapSpeakerRow(raw as Record<string, unknown>))
    .filter((row) => row.user_id !== "" || (row.person_id ?? "") !== "");
}

/**
 * Prelegenci widgetu speakers (source: directory | event).
 *
 * DWA ZRODLA, DWA RPC, JEDNA FABRYKA. Klucz zapytania jest pochodna INPUTU
 * (razem ze zrodlem), wiec obie powierzchnie strony wydarzenia - siatka na
 * zakladce i zapowiedz na przegladzie - dziela jeden wpis cache i jeden
 * prefetch SSR, a katalog ma swoj wlasny. Rozbicie tego na dwie eksportowane
 * fabryki nic by nie kupilo, a kosztowaloby drugi wpis w rejestrze prefetchu
 * i drugi kontrakt do rozjechania.
 *
 * `_lang` zostaje NIEUZYWANY w obu galeziach: kazdy wiersz niesie OBIE wersje
 * jezykowe (`headline_pl`/`headline_en`, `bio_pl`/`bio_en`, `topics_*`),
 * a komponent wybiera przy renderze. Jezyk w kluczu trzymalby dwa identyczne
 * wpisy cache i lamalby parytet prefetch SSR <-> klient - pilnuje tego bramka
 * `src/lib/builder/__tests__/localizedQueryKeys.gate.test.ts`.
 */
export const speakersQueryOptions = (c: WidgetContent, _lang: Lang) => {
  const input = speakersInput(c);
  return queryOptions({
    queryKey: [WIDGET_QUERY_ROOTS.speakers, input] as const,
    queryFn: () =>
      input.source === "event"
        ? // Tryb "event" bez wybranego wydarzenia = stan nieskonfigurowany:
          // pusta lista (widget pokazuje empty state), a NIE pelny katalog.
          input.eventId === ""
          ? Promise.resolve([] as PublicSpeakerRow[])
          : // Osobny klucz cache, a nie `builder:speakers:` z doklejonym
            // inputem: te wiersze maja INNY ksztalt (doszly
            // `speaker_profile_id` i `person_id`) i inne zrodlo, wiec izolat
            // rozgrzany przed zmiana projekcji nie ma czym odpowiedziec po niej.
            edgeTtlCache(`builder:event-speakers:${input.eventId}:${input.limit}`, 60_000, () =>
              fetchEventSpeakers({ eventId: input.eventId, limit: input.limit }),
            )
        : edgeTtlCache(`builder:speakers:${JSON.stringify(input)}`, 60_000, () =>
            fetchPublicSpeakers({ eventId: null, userIds: null, limit: input.limit }),
          ),
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });
};

/**
 * Prelegenci wskazani po user_id (sesje agendy w event-schedule). Lista id
 * jest sortowana w kluczu, zeby kolejnosc w tresci nie unieważniala cache.
 */
export const speakersByIdsQueryOptions = (userIds: string[]) => {
  const ids = Array.from(new Set(userIds)).sort();
  return queryOptions({
    queryKey: [WIDGET_QUERY_ROOTS.speakersByIds, ids] as const,
    queryFn: () =>
      ids.length === 0
        ? Promise.resolve([] as PublicSpeakerRow[])
        : edgeTtlCache(`builder:speakers-by-ids:${ids.join(",")}`, 60_000, () =>
            fetchPublicSpeakers({ eventId: null, userIds: ids, limit: 200 }),
          ),
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });
};

/** Pojedynczy profil prelegenta (dialog profilu). */
export const speakerProfileQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: [WIDGET_QUERY_ROOTS.publicSpeakerProfile, userId] as const,
    queryFn: async (): Promise<PublicSpeakerRow | null> => {
      if (!userId) return null;
      const rows = await fetchPublicSpeakers({ eventId: null, userIds: [userId], limit: 1 });
      return rows[0] ?? null;
    },
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });

/** Wystapienie prelegenta (opublikowane wydarzenie, na ktorym mowi/mowil). */
export interface SpeakerEngagement {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  starts_at: string;
  kind: string;
  location: string | null;
}

/**
 * Wystapienia prelegenta: klienckie zlaczenie event_speakers -> events (oba
 * publicznie czytelne przez RLS), bez dodatkowego RPC. Zwraca opublikowane
 * wydarzenia posortowane od najnowszych.
 */
async function fetchSpeakerEngagements(
  userId: string,
  limit: number,
): Promise<SpeakerEngagement[]> {
  const { data: links, error: linksError } = await supabase
    .from("event_speakers")
    .select("event_id")
    .eq("user_id", userId);
  if (linksError) throw linksError;
  const eventIds = (links ?? []).map((r: { event_id: string }) => r.event_id);
  if (eventIds.length === 0) return [];
  const { data, error } = await supabase
    .from("events")
    .select("id, slug, title_pl, title_en, starts_at, kind, location")
    .in("id", eventIds)
    .eq("status", "published")
    .order("starts_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as SpeakerEngagement[];
}

export const speakerEngagementsQueryOptions = (userId: string, limit = 8) =>
  queryOptions({
    queryKey: [WIDGET_QUERY_ROOTS.publicSpeakerEngagements, userId, limit] as const,
    queryFn: () => (userId ? fetchSpeakerEngagements(userId, limit) : Promise.resolve([])),
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  });
