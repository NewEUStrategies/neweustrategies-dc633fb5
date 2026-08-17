// Pomocniki katalogu karier używane WYŁĄCZNIE przez panel admina.
//
// GRANICA POWIERZCHNI (bramka budżetu, wpis 2026-08-15). `catalog.ts` jest
// współdzielony przez publiczną trasę /zatrudniamy i adminową /admin/hiring,
// więc jego chunk bramka rozlicza do PUBLIC - każdy bajt wyłącznie adminowy
// w tamtym module jedzie do czytelnika, który nigdy go nie wykona. Import
// wbudowanego katalogu do bazy uruchamia tylko operator panelu, dlatego
// mieszka tutaj, w module z jednym adminowym importerem (`admin.hiring.tsx`).
// Moduł jest czysty (bez Reacta) - jak cała warstwa danych karier.
import { queryOptions } from "@tanstack/react-query";
import type { TFunction } from "i18next";

import { supabase } from "@/integrations/supabase/client";
import {
  CAREER_ROLES,
  roleBulletKeys,
  roleRequirementKeys,
  roleSummaryKey,
  roleTitleKey,
} from "./roles";
import { SECTION_COLUMNS, type CareerRoleRow, type CareerSectionRow } from "./catalog";

/**
 * Sekcje strony w wersji redakcyjnej - z TABELI, nie z publicznego widoku.
 *
 * Panel musi widzieć sekcje wyłączone razem z ich roboczymi nagłówkami, bo to
 * one są przedmiotem edycji; publiczna projekcja `career_page_sections_public`
 * (20260817230000) tnie te nagłówki do NULL, więc czytanie jej w adminie
 * kasowałoby operatorowi treść przy każdym odświeżeniu. Odczyt tabeli
 * przechodzi polityką `career_sections_staff_read` (is_staff + własny tenant).
 *
 * Klucz jest rodzeństwem klucza publicznego pod wspólnym prefiksem
 * `["career-page-sections"]`, żeby jedna inwalidacja po zapisie odświeżała oba
 * odczyty - w adminie /admin/hiring żyją obok siebie.
 */
export const careerSectionsAdminQueryOptions = () =>
  queryOptions({
    queryKey: ["career-page-sections", "admin"] as const,
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

/** Wbudowany katalog jako wiersze bazy - do jednorazowego importu w adminie. */
export function fallbackRoleRows(t: TFunction, tEn: TFunction): Array<Omit<CareerRoleRow, "id">> {
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
