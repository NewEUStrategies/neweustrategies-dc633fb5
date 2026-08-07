// Kompletność profilu 0-100 - czysty moduł, wzorowany wprost na
// `src/lib/seo/contentStatus.ts`.
//
// Ten sam problem, inna encja: dla wpisów jeden przejrzysty zestaw reguł
// zamienia wiersz w stany pól i wynik 0-100, żeby tabela przeglądowa, kafle
// podsumowania i filtry MÓWIŁY TO SAMO. Profile nie miały żadnego takiego
// miernika - użytkownik widział pusty formularz i nie wiedział, czego brakuje,
// a katalog nie wiedział, kogo stawiać wyżej.
//
// DWA ŚWIATY, JEDNE WAGI. Wynik liczy też baza
// (`public.nes_profile_completeness_row`, migracja 20260807141000), bo jest
// sygnałem RANKINGU katalogu i bramką kolejki embeddingów. Wagi poniżej są
// jedynym źródłem prawdy po stronie klienta, a bramka CI
// (`src/lib/ci/__tests__/profileIntentCatalog.gate.test.ts`) porównuje je ze
// znacznikami `-- weight:<klucz>=<waga>` w SQL-u. Zmiana wagi po jednej
// stronie wywala CI - rozjazdu punktacji nie da się zauważyć w review.

import { PROFILE_SEEKING_MIN } from "./intents";

/** Progi jakościowe wpisane w definicję - jedno słowo nie jest bio. */
export const PROFILE_BIO_MIN = 120;
export const PROFILE_SKILLS_MIN = 3;

/**
 * Wagi pól. Suma = 100 (pilnuje test jednostkowy). Rozkład celowo premiuje to,
 * co realnie tworzy dopasowanie w katalogu: bio (14) i intencja (10 + 12) ważą
 * łącznie 36, czyli więcej niż cała tożsamość formalna razem (stanowisko,
 * firma, specjalizacja, lokalizacja = 26).
 */
export const PROFILE_COMPLETENESS_WEIGHTS = {
  avatar: 10,
  name: 8,
  jobTitle: 8,
  company: 6,
  location: 6,
  specialization: 6,
  bio: 14,
  openTo: 10,
  seeking: 12,
  skills: 10,
  experience: 6,
  education: 4,
} as const;

export type ProfileCompletenessField = keyof typeof PROFILE_COMPLETENESS_WEIGHTS;

/** Kolejność w liście „czego brakuje" - od największego zysku punktowego. */
export const PROFILE_COMPLETENESS_FIELDS = (
  Object.keys(PROFILE_COMPLETENESS_WEIGHTS) as ProfileCompletenessField[]
).sort((a, b) => PROFILE_COMPLETENESS_WEIGHTS[b] - PROFILE_COMPLETENESS_WEIGHTS[a]);

/** Wejście oceny - odbicie kolumn profilu + liczniki tabel dzieci. */
export interface ProfileCompletenessInput {
  avatar_url: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  current_company: string | null;
  location: string | null;
  specialization: string | null;
  bio_pl: string | null;
  bio_en: string | null;
  open_to: readonly string[] | null;
  seeking_pl: string | null;
  seeking_en: string | null;
  skills: number;
  experiences: number;
  education: number;
}

export type ProfileCompletenessGrade = "strong" | "partial" | "thin";

export interface ProfileCompletenessStatus {
  /** Stan każdego pola - `true` = zaliczone (pełna waga). */
  fields: Readonly<Record<ProfileCompletenessField, boolean>>;
  /** Braki w kolejności największego zysku punktowego. */
  missing: ProfileCompletenessField[];
  /** 0-100 - te same wagi co `nes_profile_completeness_row` w bazie. */
  score: number;
  grade: ProfileCompletenessGrade;
  /**
   * Ile punktów daje domknięcie NAJWIĘKSZEJ luki. Interfejs pokazuje
   * konkretną zachętę („+14 pkt za opis"), nie samo „uzupełnij profil".
   */
  nextGain: number;
  /** Największa luka albo `null`, gdy profil jest pełny. */
  nextField: ProfileCompletenessField | null;
}

function has(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function longest(...values: ReadonlyArray<string | null | undefined>): number {
  let max = 0;
  for (const value of values) {
    const length = typeof value === "string" ? value.trim().length : 0;
    if (length > max) max = length;
  }
  return max;
}

/** Ocena jednego profilu. Framework-free i deterministyczna. */
export function profileCompleteness(input: ProfileCompletenessInput): ProfileCompletenessStatus {
  const fields: Record<ProfileCompletenessField, boolean> = {
    avatar: has(input.avatar_url),
    name: has(input.display_name) || has(`${input.first_name ?? ""} ${input.last_name ?? ""}`),
    jobTitle: has(input.job_title),
    company: has(input.current_company),
    location: has(input.location),
    specialization: has(input.specialization),
    bio: longest(input.bio_pl, input.bio_en) >= PROFILE_BIO_MIN,
    openTo: (input.open_to?.length ?? 0) >= 1,
    seeking: longest(input.seeking_pl, input.seeking_en) >= PROFILE_SEEKING_MIN,
    skills: input.skills >= PROFILE_SKILLS_MIN,
    experience: input.experiences >= 1,
    education: input.education >= 1,
  };

  let score = 0;
  for (const field of PROFILE_COMPLETENESS_FIELDS) {
    if (fields[field]) score += PROFILE_COMPLETENESS_WEIGHTS[field];
  }
  const missing = PROFILE_COMPLETENESS_FIELDS.filter((field) => !fields[field]);
  const nextField = missing[0] ?? null;

  return {
    fields,
    missing,
    score,
    grade: score >= 80 ? "strong" : score >= 50 ? "partial" : "thin",
    nextGain: nextField ? PROFILE_COMPLETENESS_WEIGHTS[nextField] : 0,
    nextField,
  };
}

/**
 * Próg, od którego profil dostaje wektor semantyczny (`_min_completeness`
 * w `profiles_needing_embeddings`). Interfejs pokazuje go jako cel: „od 40 pkt
 * Twój profil zaczyna być znajdowany semantycznie".
 */
export const PROFILE_SEMANTIC_MIN_SCORE = 40;

/** Klucz i18n etykiety pola - jedno miejsce zamiast szablonu w widoku. */
export function profileCompletenessFieldKey(field: ProfileCompletenessField): string {
  return `profileCompleteness.fields.${field}`;
}
