// Etykiety cyklu życia kontaktu CRM dla komponentów z propem `lang`.
//
// ŹRÓDŁEM JEST MAGAZYN i18next. Nakładka `i18n-admin-crm-lifecycle`
// rejestruje gałąź `adminCrm.lifecycle` przy imporcie (kontrakt
// `i18nOverlayIntegrity.gate`), a ekrany CRM czytają ją tutaj - jednym
// odczytem całej gałęzi zamiast `t()` per napis, bo lista i karta leada
// renderują etykiety w języku z propu, nie z instancji. Czytanie magazynu,
// a nie surowych obiektów nakładki, sprawia, że zarejestrowany korzeń ma
// czytelnika (`overlayReaders.test.ts`): bez tego bramka uznałaby słownik
// za martwy. Obiekty nakładki zostają rezerwą na wypadek atrapy `@/lib/i18n`
// w testach albo braku gałęzi w magazynie.
import i18n from "@/lib/i18n";
import { crmLifecycleEn, crmLifecyclePl } from "@/lib/i18n-admin-crm-lifecycle";

export type CrmLifecycleDict = typeof crmLifecyclePl.adminCrm.lifecycle;

export function crmLifecycleDict(lang: "pl" | "en"): CrmLifecycleDict {
  const stored: unknown = i18n.getResource?.(lang, "translation", "adminCrm.lifecycle");
  if (stored !== null && typeof stored === "object") return stored as CrmLifecycleDict;
  return (lang === "en" ? crmLifecycleEn : crmLifecyclePl).adminCrm.lifecycle;
}
