// Katalog ofert pracy i sekcji strony /zatrudniamy - warstwa danych.
//
// Źródłem prawdy są tabele `career_roles` i `career_page_sections` (panel
// admina). Gdy tabela ofert jest pusta (świeża instalacja), strona publiczna
// spada na wbudowany katalog i18n z `roles.ts`, żeby nigdy nie pokazać pustej
// listy. Moduł jest czysty (bez Reacta) - hooki mieszkają w `useCareerContent`.
import { queryOptions } from "@tanstack/react-query";
import type { TFunction } from "i18next";

import { supabase } from "@/integrations/supabase/client";
import {
  CAREER_ROLES,
  roleBulletKeys,
  roleRequirementKeys,
  roleSummaryKey,
  roleTitleKey,
  type CareerDepartmentId,
  type CareerEngagement,
  type CareerSeniority,
} from "./roles";

export type CareerLang = "pl" | "en";
export type CareerLocation = "remote" | "hybrid" | "warsaw" | "brussels";

/** Oferta z rozwiniętymi już tekstami w aktywnym języku. */
export interface CareerOffer {
  readonly id: string;
  readonly department: CareerDepartmentId;
  readonly engagement: CareerEngagement;
  readonly seniority: CareerSeniority;
  readonly location: CareerLocation;
  readonly title: string;
  readonly summary: string;
  readonly responsibilities: readonly string[];
  readonly requirements: readonly string[];
}

/** Wiersz oferty w wersji administracyjnej (obie wersje językowe). */
export interface CareerRoleRow {
  id: string;
  slug: string;
  department: CareerDepartmentId;
  engagement: CareerEngagement;
  seniority: CareerSeniority;
  location: CareerLocation;
  sort_order: number;
  is_published: boolean;
  title_pl: string;
  title_en: string;
  summary_pl: string;
  summary_en: string;
  responsibilities_pl: string[];
  responsibilities_en: string[];
  requirements_pl: string[];
  requirements_en: string[];
}

export type CareerSectionKey =
  | "hero"
  | "values"
  | "benefits"
  | "roles"
  | "process"
  | "form"
  | "closing";

export const CAREER_SECTION_KEYS = [
  "hero",
  "values",
  "benefits",
  "roles",
  "process",
  "form",
  "closing",
] as const satisfies readonly CareerSectionKey[];

export interface CareerSectionRow {
  key: string;
  is_visible: boolean;
  sort_order: number;
  title_pl: string | null;
  title_en: string | null;
  subtitle_pl: string | null;
  subtitle_en: string | null;
}

const ROLE_COLUMNS =
  "id,slug,department,engagement,seniority,location,sort_order,is_published,title_pl,title_en,summary_pl,summary_en,responsibilities_pl,responsibilities_en,requirements_pl,requirements_en";

const SECTION_COLUMNS = "key,is_visible,sort_order,title_pl,title_en,subtitle_pl,subtitle_en";

/** Oferty widoczne publicznie (opublikowane, wg kolejności). */
export const careerRolesQueryOptions = (includeDrafts = false) =>
  queryOptions({
    queryKey: ["career-roles", includeDrafts ? "all" : "published"] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<CareerRoleRow[]> => {
      let query = supabase
        .from("career_roles")
        .select(ROLE_COLUMNS)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (!includeDrafts) query = query.eq("is_published", true);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as CareerRoleRow[];
    },
  });

export const careerSectionsQueryOptions = () =>
  queryOptions({
    queryKey: ["career-page-sections"] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<CareerSectionRow[]> => {
      const { data, error } = await supabase
        .from("career_page_sections")
        .select(SECTION_COLUMNS)
        .order("sort_order", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as CareerSectionRow[];
    },
  });

/** Wiersz bazy -> oferta w jednym języku. */
export function rowToOffer(row: CareerRoleRow, lang: CareerLang): CareerOffer {
  const isEn = lang === "en";
  const title = (isEn ? row.title_en : row.title_pl) || row.title_pl || row.title_en;
  const summary = (isEn ? row.summary_en : row.summary_pl) || row.summary_pl || row.summary_en;
  const responsibilities = isEn
    ? row.responsibilities_en.length
      ? row.responsibilities_en
      : row.responsibilities_pl
    : row.responsibilities_pl.length
      ? row.responsibilities_pl
      : row.responsibilities_en;
  const requirements = isEn
    ? row.requirements_en.length
      ? row.requirements_en
      : row.requirements_pl
    : row.requirements_pl.length
      ? row.requirements_pl
      : row.requirements_en;
  return {
    id: row.slug,
    department: row.department,
    engagement: row.engagement,
    seniority: row.seniority,
    location: row.location,
    title,
    summary,
    responsibilities,
    requirements,
  };
}

/** Wbudowany katalog i18n - używany, gdy w bazie nie ma jeszcze ofert. */
export function fallbackOffers(t: TFunction): CareerOffer[] {
  return CAREER_ROLES.map((role) => ({
    id: role.id,
    department: role.department,
    engagement: role.engagement,
    seniority: role.seniority,
    location: role.location,
    title: t(roleTitleKey(role.id)),
    summary: t(roleSummaryKey(role.id)),
    responsibilities: roleBulletKeys(role).map((key) => t(key)),
    requirements: roleRequirementKeys(role).map((key) => t(key)),
  }));
}

/** Wbudowany katalog jako wiersze bazy - do jednorazowego importu w adminie. */
export function fallbackRoleRows(
  t: TFunction,
  tEn: TFunction,
): Array<Omit<CareerRoleRow, "id">> {
  return CAREER_ROLES.map((role, index) => ({
    slug: role.id,
    department: role.department,
    engagement: role.engagement,
    seniority: role.seniority,
    location: role.location,
    sort_order: index * 10,
    is_published: true,
    title_pl: t(roleTitleKey(role.id)),
    title_en: tEn(roleTitleKey(role.id)),
    summary_pl: t(roleSummaryKey(role.id)),
    summary_en: tEn(roleSummaryKey(role.id)),
    responsibilities_pl: roleBulletKeys(role).map((key) => t(key)),
    responsibilities_en: roleBulletKeys(role).map((key) => tEn(key)),
    requirements_pl: roleRequirementKeys(role).map((key) => t(key)),
    requirements_en: roleRequirementKeys(role).map((key) => tEn(key)),
  }));
}

export function filterOffersByDepartment(
  offers: readonly CareerOffer[],
  department: CareerDepartmentId | "all" | null | undefined,
): CareerOffer[] {
  if (!department || department === "all") return [...offers];
  return offers.filter((offer) => offer.department === department);
}

export function countOffersByDepartment(
  offers: readonly CareerOffer[],
): Record<CareerDepartmentId, number> {
  const base: Record<CareerDepartmentId, number> = {
    analysis: 0,
    policy: 0,
    marketing: 0,
    advisory: 0,
    editorial: 0,
    operations: 0,
  };
  for (const offer of offers) base[offer.department] += 1;
  return base;
}

export function findOffer(
  offers: readonly CareerOffer[],
  id: string | null | undefined,
): CareerOffer | null {
  if (!id) return null;
  return offers.find((offer) => offer.id === id) ?? null;
}

export interface CareerSectionState {
  visible: boolean;
  title: string | null;
  subtitle: string | null;
}

export function sectionState(
  rows: readonly CareerSectionRow[] | undefined,
  key: CareerSectionKey,
  lang: CareerLang,
): CareerSectionState {
  const row = rows?.find((item) => item.key === key);
  if (!row) return { visible: true, title: null, subtitle: null };
  const isEn = lang === "en";
  return {
    visible: row.is_visible,
    title: (isEn ? row.title_en : row.title_pl) || null,
    subtitle: (isEn ? row.subtitle_en : row.subtitle_pl) || null,
  };
}
