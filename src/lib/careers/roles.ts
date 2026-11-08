// Katalog ofert pracy / współpracy w New European Strategies.
//
// Czysty moduł (bez Reacta, bez zapytań) - dzięki temu ten sam zbiór ról
// obsługuje stronę publiczną, filtrowanie po dziale i preselekcję stanowiska
// w formularzu aplikacyjnym. Etykiety NIE mieszkają tutaj: strona jest
// dwujęzyczna, więc teksty pochodzą ze słownika i18n (`careers.*`).

/** Dział organizacji - stały, zamknięty zbiór (faseta filtrów). */
export type CareerDepartmentId =
  "analysis" | "policy" | "marketing" | "advisory" | "editorial" | "operations";

/** Tryb współpracy - używany jako znacznik na karcie roli. */
export type CareerEngagement = "full_time" | "part_time" | "contract" | "internship";

/** Poziom doświadczenia - ten sam zbiór, co droplista w formularzu. */
export type CareerSeniority = "junior" | "mid" | "senior" | "lead";

export interface CareerRole {
  readonly id: string;
  readonly department: CareerDepartmentId;
  readonly engagement: CareerEngagement;
  readonly seniority: CareerSeniority;
  /** Praca zdalna / hybryda / biuro - klucz i18n `careers.location.<x>`. */
  readonly location: "remote" | "hybrid" | "warsaw" | "brussels";
  /** Liczba punktów zakresu obowiązków w słowniku (`bullets.b1..bN`). */
  readonly bullets: 3 | 4;
  /** Liczba wymagań w słowniku (`requirements.q1..qN`). */
  readonly requirements: 3 | 4;
}

export const CAREER_DEPARTMENTS = [
  "analysis",
  "policy",
  "marketing",
  "advisory",
  "editorial",
  "operations",
] as const satisfies readonly CareerDepartmentId[];

export const CAREER_SENIORITIES = ["junior", "mid", "senior", "lead"] as const;

/**
 * Otwarte role. Kolejność = kolejność prezentacji: najpierw zespół badawczy,
 * potem role wspierające. Dodanie roli wymaga wyłącznie kluczy i18n
 * `careers.roles.<id>.*` - bramka `roles.test.ts` pilnuje spójności.
 *
 * Decyzja redakcji 2026-11-08: zostaje sześć ról (po dwie w analizach,
 * polityce/doradztwie i marketingu/redakcji). Analityk danych, specjalista
 * ds. polityki UE, specjalista ds. treści i koordynator wydarzeń wypadli
 * z katalogu razem z tekstami w `i18n-careers.ts`. Katalog jest zapasem na
 * pustą tabelę `career_roles`; oferty z panelu (/admin/hiring) go zastępują.
 */
export const CAREER_ROLES: readonly CareerRole[] = [
  {
    id: "senior_analyst_security",
    department: "analysis",
    engagement: "full_time",
    seniority: "senior",
    location: "hybrid",
    bullets: 4,
    requirements: 4,
  },
  {
    id: "analyst_economy",
    department: "analysis",
    engagement: "full_time",
    seniority: "mid",
    location: "hybrid",
    bullets: 3,
    requirements: 3,
  },
  {
    id: "policy_intern",
    department: "policy",
    engagement: "internship",
    seniority: "junior",
    location: "warsaw",
    bullets: 3,
    requirements: 3,
  },
  {
    id: "growth_marketing_lead",
    department: "marketing",
    engagement: "full_time",
    seniority: "lead",
    location: "hybrid",
    bullets: 4,
    requirements: 4,
  },
  {
    id: "strategic_advisor",
    department: "advisory",
    engagement: "contract",
    seniority: "lead",
    location: "remote",
    bullets: 3,
    requirements: 3,
  },
  {
    id: "managing_editor",
    department: "editorial",
    engagement: "full_time",
    seniority: "senior",
    location: "warsaw",
    bullets: 4,
    requirements: 4,
  },
] as const;

/** Filtr działu - `null` / "all" oznacza brak zawężenia. */
export function filterRolesByDepartment(
  roles: readonly CareerRole[],
  department: CareerDepartmentId | "all" | null | undefined,
): CareerRole[] {
  if (!department || department === "all") return [...roles];
  return roles.filter((role) => role.department === department);
}

/** Licznik ofert w dziale - używany przez chipsy filtrów. */
export function countRolesByDepartment(
  roles: readonly CareerRole[],
): Record<CareerDepartmentId, number> {
  const base = Object.fromEntries(CAREER_DEPARTMENTS.map((d) => [d, 0])) as Record<
    CareerDepartmentId,
    number
  >;
  for (const role of roles) base[role.department] += 1;
  return base;
}

/** Bezpieczne odszukanie roli po id (np. z parametru `?role=`). */
export function findRole(id: string | null | undefined): CareerRole | null {
  if (!id) return null;
  return CAREER_ROLES.find((role) => role.id === id) ?? null;
}

/** Klucze i18n roli - jedno miejsce zamiast szablonów w komponentach. */
export function roleTitleKey(id: string): string {
  return `careers.roles.${id}.title`;
}
export function roleSummaryKey(id: string): string {
  return `careers.roles.${id}.summary`;
}
export function roleBulletKeys(role: CareerRole): string[] {
  return Array.from(
    { length: role.bullets },
    (_, i) => `careers.roles.${role.id}.bullets.b${i + 1}`,
  );
}
export function roleRequirementKeys(role: CareerRole): string[] {
  return Array.from(
    { length: role.requirements },
    (_, i) => `careers.roles.${role.id}.requirements.q${i + 1}`,
  );
}
