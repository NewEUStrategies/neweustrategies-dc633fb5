// Pomocniki katalogu karier używane WYŁĄCZNIE przez panel admina.
//
// GRANICA POWIERZCHNI (bramka budżetu, wpis 2026-08-15). `catalog.ts` jest
// współdzielony przez publiczną trasę /zatrudniamy i adminową /admin/hiring,
// więc jego chunk bramka rozlicza do PUBLIC - każdy bajt wyłącznie adminowy
// w tamtym module jedzie do czytelnika, który nigdy go nie wykona. Import
// wbudowanego katalogu do bazy uruchamia tylko operator panelu, dlatego
// mieszka tutaj, w module z jednym adminowym importerem (`admin.hiring.tsx`).
// Moduł jest czysty (bez Reacta, bez zapytań) - jak cała warstwa danych karier.
import type { TFunction } from "i18next";

import {
  CAREER_ROLES,
  roleBulletKeys,
  roleRequirementKeys,
  roleSummaryKey,
  roleTitleKey,
} from "./roles";
import type { CareerRoleRow } from "./catalog";

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
