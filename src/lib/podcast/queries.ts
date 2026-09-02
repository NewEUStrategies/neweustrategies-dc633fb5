// Kliencka warstwa danych panelu podcastów (react-query + supabase).
//
// PO CO TEN PLIK ISTNIEJE. Do 02.09.2026 wszystkie zapytania panelu podcastów
// siedziały w `routes/admin.podcasts.tsx` - 2072 linie i 205 funkcji w jednym
// komponencie, czyli plik, którego nie da się sensownie zamontować w teście.
// Skutkiem było 0% pokrycia na warstwie, która pisze do pięciu tabel. Tutaj
// każde zapytanie jest funkcją, którą test woła bez Reacta, i każdy klucz cache
// pochodzi z fabryki, więc klucz inwalidacji nie może się rozjechać z kluczem
// odczytu przez literówkę (wzorzec: `lib/tracker/queries.ts`).
//
// EKSTRAKCJA, NIE PRZEPISANIE. Te same tabele, te same listy kolumn, te same
// filtry, te same kolejności `order`, te same klucze cache (DOSŁOWNIE, w tym
// asymetria: zapis odcinka unieważnia publiczny prefiks `["podcast-people"]`,
// a nie `["admin","podcast-people",id]`) i te same komunikaty błędu.
//
// TENANT. Żaden ODCZYT nie filtruje `tenant_id` - i celowo tak zostaje.
// Przeglądarkowy klient Supabase niesie nagłówek `x-tenant-host`
// (`integrations/supabase/client.ts`), więc polityki RLS rozwiązują tenanta
// per domena i panel na hoście A nie ma jak zobaczyć wierszy hosta B. Dołożenie
// filtra „na wszelki wypadek" byłoby zmianą zachowania bez testu, który by ją
// obronił. Klucze cache są z tego samego powodu bez tenanta: jedna karta
// przeglądarki = jeden host = jeden tenant. ZAPISY są odwrotnie - każdy
// INSERT/UPSERT niesie `tenant_id` jawnie i odmawia zapisu bez niego
// (`podcastAdminErrors.tenant`), bo wiersz bez tenanta nie ma polityki, która
// by go kiedykolwiek pokazała.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { adminToast } from "@/lib/adminToasts";
import { PODCAST_FIELDS, PODCAST_SHOW_FIELDS } from "@/lib/queries/podcasts";
import { summarizeEpisodes, type PodcastEpisodesSummary } from "@/lib/seo/podcastFeedReadiness";
import type { Podcast, PodcastSettings, PodcastShow } from "@/lib/podcast/types";
import {
  buildEpisodePayload,
  buildEpisodePeopleRows,
  buildSettingsPayload,
  buildShowPayload,
  rowToPersonDraft,
  type AdminPodcastRow,
  type CategoryOption,
  type EpisodeBundle,
  type EpisodePersonRow,
  type PersonDraft,
  type ProfileOption,
} from "@/lib/podcast/shape";

/**
 * Kolumny listy odcinków - JEDEN literał, nie konkatenacja. Sklejanie
 * rozszerza typ do `string`, a wtedy typowany klient nie weryfikuje listy
 * kolumn wobec wygenerowanych typów.
 */
export const ADMIN_PODCAST_ROW_FIELDS =
  "id,slug,title_pl,title_en,status,duration_seconds,episode_number,season,audio_url,cover_image_url,published_at,show_id";

/**
 * Fabryki kluczy panelu. Jedno miejsce dla odczytu i dla inwalidacji - klucz
 * wpisany z ręki w drugim miejscu rozjeżdża się cicho (panel po zapisie
 * pokazuje stare dane i nikt nie wie dlaczego).
 */
export const adminPodcastKeys = {
  /** Lista odcinków panelu. */
  episodes: () => ["admin", "podcasts"] as const,
  /** Programy (serie) panelu - ten sam klucz w liście i w selektorze edytora. */
  shows: () => ["admin", "podcast-shows"] as const,
  /** Ustawienia kanału (singleton per tenant). */
  settings: () => ["admin", "podcast-settings"] as const,
  /** Podsumowanie opublikowanych odcinków dla karty gotowości feedu. */
  feedEpisodes: () => ["admin", "podcast-feed-episodes"] as const,
  categories: () => ["admin", "podcast-categories"] as const,
  profiles: () => ["admin", "podcast-profiles"] as const,
  /** Uczestnicy JEDNEGO odcinka - klucz zawiera id, bo cache jest per odcinek. */
  people: (episodeId: string) => ["admin", "podcast-people", episodeId] as const,
};

/**
 * Prefiksy PUBLICZNE unieważniane po zapisie w panelu. To nie są klucze
 * panelu: publiczna warstwa (`lib/queries/podcasts.ts`) trzyma swoje wpisy
 * pod własnymi prefiksami i bez tego strona publiczna pokazywałaby stary
 * odcinek do wygaśnięcia `staleTime`.
 */
export const publicPodcastKeys = {
  episodes: () => ["podcasts"] as const,
  shows: () => ["podcast-shows"] as const,
  people: () => ["podcast-people"] as const,
  settings: () => ["podcast-settings"] as const,
};

/**
 * Komunikaty odmowy zapisu. Wchodzą z komponentu (tam mieszka `t()`), żeby
 * warstwa danych nie musiała znać i18n - i żeby test mógł asertować, że
 * odmowa poleciała TYM komunikatem, a nie surowym błędem Postgresa.
 */
export interface PodcastAdminMessages {
  /** Brak sluga i brak tytułu, z którego dałoby się go zrobić. */
  slug: string;
  /** Odcinek bez pliku audio - kanał RSS bez enclosure jest nieważny. */
  audio: string;
  /** Brak tenanta w sesji - wiersz bez tenanta nie ma polityki RLS. */
  tenant: string;
}

// ---------------------------------------------------------------------------
// Odczyty
// ---------------------------------------------------------------------------

/** Lista odcinków panelu: bez usuniętych, najnowsze na górze. */
export async function fetchAdminPodcastRows(): Promise<AdminPodcastRow[]> {
  const { data, error } = await supabase
    .from("podcasts")
    .select(ADMIN_PODCAST_ROW_FIELDS)
    // Bez tego filtra „Usunięte" odcinki (soft-delete) zostawały na liście,
    // więc „Usuń" wyglądał jak brak reakcji.
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as AdminPodcastRow[];
}

/** Programy panelu: bez usuniętych, kolejność redakcyjna, potem tytuł PL. */
export async function fetchAdminPodcastShows(): Promise<PodcastShow[]> {
  const { data, error } = await supabase
    .from("podcast_shows")
    .select(PODCAST_SHOW_FIELDS)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("title_pl", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PodcastShow[];
}

/**
 * Ustawienia kanału. PGRST116 (brak wiersza) NIE jest błędem - tabela jest
 * singletonem tworzonym pierwszym zapisem, więc pusto znaczy „jeszcze nie
 * ustawiono", a nie „awaria odczytu".
 */
export async function fetchAdminPodcastSettings(): Promise<PodcastSettings | null> {
  const { data, error } = await supabase.from("podcast_settings").select("*").maybeSingle();
  if (error && error.code !== "PGRST116") throw error;
  return (data ?? null) as PodcastSettings | null;
}

/**
 * Podsumowanie opublikowanych odcinków dla karty gotowości feedu: ile ich
 * jest, ilu brakuje rozmiaru pliku (enclosure `length`) i ilu czasu trwania.
 *
 * Rozmiar bierzemy z biblioteki mediów po `public_url`. Błąd TEGO zapytania
 * jest świadomie ignorowany: brak rozmiarów degraduje kartę do ostrzeżenia
 * „nieznany rozmiar", a nie wywraca całego panelu ustawień.
 */
export async function fetchAdminPodcastFeedEpisodes(): Promise<PodcastEpisodesSummary> {
  const { data, error } = await supabase
    .from("podcasts")
    .select("audio_url, duration_seconds")
    .eq("status", "published")
    .is("deleted_at", null)
    .not("audio_url", "is", null)
    .limit(500);
  if (error) throw error;
  const rows = (data ?? []).filter((r) => !!r.audio_url);
  const { data: media } = await supabase
    .from("media")
    .select("public_url, size_bytes")
    .in(
      "public_url",
      rows.map((r) => r.audio_url),
    );
  const known = new Map((media ?? []).map((m) => [m.public_url, m.size_bytes]));
  return summarizeEpisodes(
    rows.map((r) => ({
      audioBytes: known.get(r.audio_url) ?? null,
      durationSeconds: r.duration_seconds,
    })),
  );
}

/** Kategorie (specjalizacje) do przypięcia odcinka. */
export async function fetchAdminPodcastCategories(): Promise<CategoryOption[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name_pl, name_en")
    .order("name_pl");
  if (error) throw error;
  return (data ?? []) as CategoryOption[];
}

/** Profile do wyboru prowadzących/gości (link do strony eksperta). */
export async function fetchAdminPodcastProfiles(): Promise<ProfileOption[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, slug")
    .order("display_name")
    .limit(500);
  if (error) throw error;
  return (data ?? []) as ProfileOption[];
}

/** Uczestnicy odcinka w kolejności redakcyjnej. */
export async function fetchAdminEpisodePeople(episodeId: string): Promise<EpisodePersonRow[]> {
  const { data, error } = await supabase
    .from("podcast_episode_people")
    .select("id, profile_id, display_name, role, url, sort_order")
    .eq("episode_id", episodeId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as EpisodePersonRow[];
}

/** Pełny odcinek do edytora (wszystkie kolumny, także warstwy jsonb). */
export async function fetchAdminPodcast(id: string): Promise<Podcast> {
  const { data, error } = await supabase
    .from("podcasts")
    .select(PODCAST_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw error ?? new Error("Not found");
  // `as unknown as`: kolumny explicit / episode_type pochodzą z migracji
  // 20260725090500 i nie ma ich jeszcze w wygenerowanych typach.
  return data as unknown as Podcast;
}

// ---------------------------------------------------------------------------
// Zapisy
// ---------------------------------------------------------------------------

/**
 * Zapis odcinka razem z uczestnikami. Kolejność operacji jest kontraktem:
 *   1. odmowa PRZED bazą (slug, audio, tenant),
 *   2. UPDATE albo INSERT wiersza `podcasts` (tenant tylko przy INSERT),
 *   3. DELETE wszystkich uczestników odcinka,
 *   4. INSERT bieżącej listy uczestników (gdy niepusta).
 *
 * Strategia „zastąp wszystko" przy uczestnikach jest prosta i deterministyczna
 * dla edytora panelu; kolejność 3-4 nie może się odwrócić, bo DELETE zmiótłby
 * dopiero co wstawione wiersze.
 */
export async function saveAdminEpisode(input: {
  bundle: EpisodeBundle;
  tenantId: string | null;
  messages: PodcastAdminMessages;
}): Promise<void> {
  const { bundle, tenantId, messages } = input;
  const { episode: p, people } = bundle;
  const payload = buildEpisodePayload(bundle);
  if (!payload.slug) throw new Error(messages.slug);
  if (!p.audio_url) throw new Error(messages.audio);

  if (!tenantId) throw new Error(messages.tenant);
  let episodeId = p.id;
  if (episodeId) {
    // `as never`: explicit / episode_type z migracji 20260725090500 nie są
    // jeszcze w wygenerowanych typach - do usunięcia przy regeneracji.
    const { error } = await supabase
      .from("podcasts")
      .update(payload as never)
      .eq("id", episodeId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from("podcasts")
      .insert({ ...payload, tenant_id: tenantId } as never)
      .select("id")
      .single();
    if (error) throw error;
    episodeId = (data as { id: string }).id;
  }

  const { error: delError } = await supabase
    .from("podcast_episode_people")
    .delete()
    .eq("episode_id", episodeId);
  if (delError) throw delError;

  const cleanPeople = buildEpisodePeopleRows(people, tenantId, episodeId);
  if (cleanPeople.length > 0) {
    const { error: insError } = await supabase.from("podcast_episode_people").insert(cleanPeople);
    if (insError) throw insError;
  }
}

/** Usunięcie odcinka to UPDATE `deleted_at`, nie DELETE (soft-delete). */
export async function softDeleteAdminEpisode(
  id: string,
  now: string = new Date().toISOString(),
): Promise<void> {
  const { error } = await supabase.from("podcasts").update({ deleted_at: now }).eq("id", id);
  if (error) throw error;
}

/**
 * Zapis programu. Tenant jest wymagany TYLKO przy INSERT - inaczej edycja
 * istniejącego programu przez konto bez rozwiązanego tenanta zaczęłaby padać,
 * choć RLS ją przepuszcza (asymetria względem odcinka jest zamierzona).
 */
export async function saveAdminShow(input: {
  show: PodcastShow;
  tenantId: string | null;
  messages: PodcastAdminMessages;
}): Promise<void> {
  const { show: s, tenantId, messages } = input;
  const payload = buildShowPayload(s);
  if (!payload.slug) throw new Error(messages.slug);
  if (s.id) {
    const { error } = await supabase.from("podcast_shows").update(payload).eq("id", s.id);
    if (error) throw error;
  } else {
    if (!tenantId) throw new Error(messages.tenant);
    const { error } = await supabase
      .from("podcast_shows")
      .insert({ ...payload, tenant_id: tenantId });
    if (error) throw error;
  }
}

/** Usunięcie programu to również soft-delete. */
export async function softDeleteAdminShow(
  id: string,
  now: string = new Date().toISOString(),
): Promise<void> {
  const { error } = await supabase.from("podcast_shows").update({ deleted_at: now }).eq("id", id);
  if (error) throw error;
}

/**
 * Zapis ustawień kanału. Singleton per tenant (PK = `tenant_id`), więc upsert
 * z `onConflict: "tenant_id"` - pierwszy zapis tworzy wiersz, kolejne go
 * nadpisują. `as never`: kolumny itunes_* pochodzą z migracji 20260725090500
 * i nie ma ich jeszcze w wygenerowanych typach.
 */
export async function saveAdminPodcastSettings(input: {
  merged: PodcastSettings;
  tenantId: string | null;
  messages: PodcastAdminMessages;
}): Promise<void> {
  const { merged, tenantId, messages } = input;
  if (!tenantId) throw new Error(messages.tenant);
  const payload = buildSettingsPayload(merged, tenantId);
  const { error } = await supabase
    .from("podcast_settings")
    .upsert(payload as never, { onConflict: "tenant_id" });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Hooki odczytu
// ---------------------------------------------------------------------------

export function adminPodcastRowsQueryOptions() {
  return { queryKey: adminPodcastKeys.episodes(), queryFn: fetchAdminPodcastRows };
}

export function useAdminPodcastRows() {
  return useQuery(adminPodcastRowsQueryOptions());
}

export function adminPodcastShowsQueryOptions() {
  return { queryKey: adminPodcastKeys.shows(), queryFn: fetchAdminPodcastShows };
}

/** Jeden klucz dla listy programów i dla selektora w edytorze - jeden cache. */
export function useAdminPodcastShows() {
  return useQuery(adminPodcastShowsQueryOptions());
}

export function adminPodcastSettingsQueryOptions() {
  return { queryKey: adminPodcastKeys.settings(), queryFn: fetchAdminPodcastSettings };
}

export function useAdminPodcastSettings() {
  return useQuery(adminPodcastSettingsQueryOptions());
}

export function adminPodcastFeedEpisodesQueryOptions() {
  return { queryKey: adminPodcastKeys.feedEpisodes(), queryFn: fetchAdminPodcastFeedEpisodes };
}

export function useAdminPodcastFeedEpisodes() {
  return useQuery(adminPodcastFeedEpisodesQueryOptions());
}

export function useAdminPodcastCategories() {
  return useQuery({
    queryKey: adminPodcastKeys.categories(),
    queryFn: fetchAdminPodcastCategories,
  });
}

export function useAdminPodcastProfiles() {
  return useQuery({ queryKey: adminPodcastKeys.profiles(), queryFn: fetchAdminPodcastProfiles });
}

/**
 * Uczestnicy odcinka. Mapowanie wiersz -> wersja robocza dzieje się W `queryFn`
 * (a nie w `useEffect` na `data`), bo edytor inicjalizuje tym swój stan i
 * przeniesienie tego do efektu zmieniłoby MOMENT aktualizacji - jeden render
 * z pustą listą uczestników wystarczy, żeby „Zapisz" wymazał obsadę odcinka.
 */
export function useAdminEpisodePeople(
  episodeId: string,
  onLoaded: (drafts: PersonDraft[]) => void,
) {
  return useQuery({
    queryKey: adminPodcastKeys.people(episodeId),
    enabled: !!episodeId,
    queryFn: async (): Promise<EpisodePersonRow[]> => {
      const rows = await fetchAdminEpisodePeople(episodeId);
      onLoaded(rows.map(rowToPersonDraft));
      return rows;
    },
  });
}

// ---------------------------------------------------------------------------
// Hooki zapisu
// ---------------------------------------------------------------------------

/**
 * Pobranie pełnego odcinka do edytora. Jest mutacją, nie zapytaniem, bo
 * odpalają je KLIKNIĘCIEM w wiersz listy - wynik nie ma być keszowany pod
 * kluczem, ma otworzyć edytor.
 */
export function useLoadAdminPodcast(options: { onLoaded: (episode: Podcast) => void }) {
  return useMutation({
    mutationFn: fetchAdminPodcast,
    onSuccess: options.onLoaded,
  });
}

export function useSaveAdminEpisode(options: {
  tenantId: string | null;
  messages: PodcastAdminMessages;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bundle: EpisodeBundle) =>
      saveAdminEpisode({ bundle, tenantId: options.tenantId, messages: options.messages }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminPodcastKeys.episodes() });
      qc.invalidateQueries({ queryKey: publicPodcastKeys.episodes() });
      qc.invalidateQueries({ queryKey: publicPodcastKeys.people() });
      toast.success(adminToast.saved());
      options.onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Soft-delete odcinka unieważnia TYLKO listę panelu (tak było przed ekstrakcją). */
export function useSoftDeleteAdminEpisode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => softDeleteAdminEpisode(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminPodcastKeys.episodes() });
      toast.success(adminToast.deleted());
    },
  });
}

export function useSaveAdminShow(options: {
  tenantId: string | null;
  messages: PodcastAdminMessages;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (show: PodcastShow) =>
      saveAdminShow({ show, tenantId: options.tenantId, messages: options.messages }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminPodcastKeys.shows() });
      qc.invalidateQueries({ queryKey: publicPodcastKeys.shows() });
      toast.success(adminToast.saved());
      options.onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSoftDeleteAdminShow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => softDeleteAdminShow(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminPodcastKeys.shows() });
      qc.invalidateQueries({ queryKey: publicPodcastKeys.shows() });
      toast.success(adminToast.deleted());
    },
  });
}

export function useSaveAdminPodcastSettings(options: {
  tenantId: string | null;
  messages: PodcastAdminMessages;
  /** Wersja robocza formularza scalona z zapisanym wierszem (patrz `shape.ts`). */
  merged: PodcastSettings;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      saveAdminPodcastSettings({
        merged: options.merged,
        tenantId: options.tenantId,
        messages: options.messages,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminPodcastKeys.settings() });
      qc.invalidateQueries({ queryKey: publicPodcastKeys.settings() });
      toast.success(adminToast.settingsSaved());
      options.onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
