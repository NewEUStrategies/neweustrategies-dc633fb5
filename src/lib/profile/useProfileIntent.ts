// Warstwa danych INTENCJI + KOMPLETNOŚCI własnego profilu.
//
// Jedno zapytanie obsługuje oba tematy, bo mają dokładnie te same dane
// wejściowe: kolumny profilu plus liczniki tabel dzieci (umiejętności,
// doświadczenie, wykształcenie). Rozbicie na dwa hooki oznaczałoby dwa razy
// ten sam fetch i dwa niezależnie starzejące się cache'e.
//
// PUNKTACJA: liczy ją `profileCompleteness` (czysty moduł), NIE kolumna z bazy.
// Kolumna `profiles.completeness_score` jest lustrem tej samej definicji
// (bramka CI pilnuje wag) i pełni rolę sygnału RANKINGU po stronie serwera;
// interfejs musi jednak pokazać wynik NATYCHMIAST po edycji, a trigger bazy
// zdąży dopiero po zapisie. Zwracamy więc obie liczby: `status.score`
// (natychmiastowa, spójna z listą braków) i `indexedScore` (to, co widzi
// katalog), żeby rozjazd - jeśli kiedyś wystąpi - był widoczny, nie ukryty.
import { useCallback } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { profileCompleteness, type ProfileCompletenessStatus } from "@/lib/profile/completeness";
import {
  normalizeProfileIntents,
  PROFILE_INTENT_TEXT_MAX,
  type ProfileIntentCode,
} from "@/lib/profile/intents";

/** Edytowalna część warstwy intencji - dokładnie to, co zapisuje formularz. */
export interface ProfileIntentDraft {
  openTo: ProfileIntentCode[];
  seekingPl: string;
  seekingEn: string;
  offeringPl: string;
  offeringEn: string;
}

export interface ProfileIntentState extends ProfileIntentDraft {
  /** Ostatnia zmiana warstwy intencji (stempluje trigger w bazie). */
  intentUpdatedAt: string | null;
  /** Ocena kompletności policzona z tych samych danych, co widzi użytkownik. */
  status: ProfileCompletenessStatus;
  /** `profiles.completeness_score` - wersja, którą do rankingu widzi katalog. */
  indexedScore: number;
}

export const EMPTY_INTENT_DRAFT: ProfileIntentDraft = {
  openTo: [],
  seekingPl: "",
  seekingEn: "",
  offeringPl: "",
  offeringEn: "",
};

export const profileIntentKey = (uid: string | null | undefined) =>
  ["profile-intent", uid ?? "anon"] as const;

// Literał, nie `[...].join(", ")`: PostgREST-owy typ selekcji jest wyprowadzany
// z LITERAŁU stringa, a wynik złożenia tablicy to zwykły `string` - wtedy
// `data` schodzi do GenericStringError i cały kształt wiersza znika.
// Nigdy `*` - profiles ma kolumnowe granty i kolumny PII bez grantu.
const PROFILE_FIELDS =
  "avatar_url, display_name, first_name, last_name, job_title, current_company, location, specialization, bio_pl, bio_en, open_to, seeking_pl, seeking_en, offering_pl, offering_en, intent_updated_at, completeness_score" as const;

function text(value: string | null | undefined): string {
  return typeof value === "string" ? value : "";
}

/** Stan intencji + kompletności dla ZALOGOWANEGO użytkownika. */
export function useProfileIntent(): UseQueryResult<ProfileIntentState> {
  const { user } = useAuth();
  const uid = user?.id;

  return useQuery({
    queryKey: profileIntentKey(uid),
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: async (): Promise<ProfileIntentState> => {
      if (!uid) throw new Error("Not authenticated");

      // Liczniki tabel dzieci: `head: true` + `count: exact` nie ściąga
      // wierszy - potrzebujemy wyłącznie liczby (progi kompletności).
      const [profileRes, skillsRes, expRes, eduRes] = await Promise.all([
        supabase.from("profiles").select(PROFILE_FIELDS).eq("id", uid).maybeSingle(),
        supabase
          .from("profile_skills")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid),
        supabase
          .from("profile_experiences")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid),
        supabase
          .from("profile_education")
          .select("id", { count: "exact", head: true })
          .eq("user_id", uid),
      ]);
      if (profileRes.error) throw profileRes.error;
      const row = profileRes.data;
      if (!row) throw new Error("Profile row not found");

      const openTo = normalizeProfileIntents(row.open_to);
      const status = profileCompleteness({
        avatar_url: row.avatar_url,
        display_name: row.display_name,
        first_name: row.first_name,
        last_name: row.last_name,
        job_title: row.job_title,
        current_company: row.current_company,
        location: row.location,
        specialization: row.specialization,
        bio_pl: row.bio_pl,
        bio_en: row.bio_en,
        open_to: openTo,
        seeking_pl: row.seeking_pl,
        seeking_en: row.seeking_en,
        skills: skillsRes.count ?? 0,
        experiences: expRes.count ?? 0,
        education: eduRes.count ?? 0,
      });

      return {
        openTo,
        seekingPl: text(row.seeking_pl),
        seekingEn: text(row.seeking_en),
        offeringPl: text(row.offering_pl),
        offeringEn: text(row.offering_en),
        intentUpdatedAt: row.intent_updated_at,
        status,
        indexedScore: row.completeness_score ?? 0,
      };
    },
  });
}

/** Przycięcie do sufitu z CHECK-a bazy; puste pole zapisujemy jako NULL. */
function trimmed(value: string): string | null {
  const next = value.trim().slice(0, PROFILE_INTENT_TEXT_MAX);
  return next.length > 0 ? next : null;
}

/**
 * Zapis warstwy intencji. Unieważnia też edytor profilu i katalog osób:
 * `open_to` jest fasetą katalogu, a `seeking_*` wchodzi do `discovery_search`,
 * więc po zapisie stare listy wyników są nieprawdziwe.
 */
export function useSaveProfileIntent(): UseMutationResult<void, Error, ProfileIntentDraft> {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user?.id;

  return useMutation({
    mutationFn: async (draft) => {
      if (!uid) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("profiles")
        .update({
          open_to: normalizeProfileIntents(draft.openTo),
          seeking_pl: trimmed(draft.seekingPl),
          seeking_en: trimmed(draft.seekingEn),
          offering_pl: trimmed(draft.offeringPl),
          offering_en: trimmed(draft.offeringEn),
        })
        .eq("id", uid);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: profileIntentKey(uid) });
      void qc.invalidateQueries({ queryKey: ["profile-editor", uid] });
      void qc.invalidateQueries({ queryKey: ["people"] });
    },
  });
}

/**
 * Przełącznik jednej intencji z respektowaniem sufitu. Wydzielony, bo tej samej
 * reguły potrzebuje edytor profilu i (w przyszłości) onboarding - a "cicho nie
 * dodaj po przekroczeniu limitu" jest gorsze niż jawny sygnał dla wołającego.
 */
export function useIntentToggle(
  codes: readonly ProfileIntentCode[],
  max: number,
): (code: ProfileIntentCode) => { next: ProfileIntentCode[]; rejected: boolean } {
  return useCallback(
    (code) => {
      if (codes.includes(code)) {
        return { next: codes.filter((c) => c !== code), rejected: false };
      }
      if (codes.length >= max) return { next: [...codes], rejected: true };
      return { next: normalizeProfileIntents([...codes, code]), rejected: false };
    },
    [codes, max],
  );
}
