// Kontrakt katalogu organizacji: kształt wiersza z RPC, klucz cache i typ
// migawki oddawanej edytorowi wpisu. Jedno miejsce dla trzech konsumentów
// (droplista, lista w dialogu, formularz zakładania), żeby schemat i klucz
// unieważnienia nie rozjechały się między nimi.
//
// IZOLACJA NAJEMCY. Wszystkie trzy powierzchnie czytają wyłącznie przez
// `search_companies_public` - funkcję SECURITY DEFINER z twardym
// `WHERE tenant_id = public.current_tenant_id()`, gdzie tenant wynika z PROFILU
// zalogowanego użytkownika (`current_tenant_id()`), a nie z nagłówka wysłanego
// przez klienta. Dlatego obszar roboczy jednej firmy nie ma jak zaczytać firm
// z obszaru innej, także przy spreparowanym żądaniu: nie ma parametru, którym
// dałoby się wskazać obcego najemcę. Klucz cache zawiera `tenantId`, więc
// pamięć podręczna też nie przecieka między najemcami po przelogowaniu.
import { z } from "zod";

/**
 * Wiersz zwracany przez `search_companies_public`. `safeParse` zamiast
 * rzutowania: RPC oddaje kolumny wyliczone w SQL-u, których TypeScript nie
 * weryfikuje, więc niezgodność ma dać pustą listę i wpis w konsoli, a nie
 * wyjątek w środku dialogu ani `as` zdejmujący kontrolę typów.
 */
export const organizationRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  website: z.string().nullable(),
  logo_url: z.string().nullable(),
  country: z.string().nullable(),
  city: z.string().nullable(),
  branch: z.string().nullable(),
});

export type OrganizationRow = z.infer<typeof organizationRowSchema>;

/** Migawka oddawana edytorowi - dokładnie kolumny `posts.organization_*`. */
export interface OrganizationSelection {
  id: string;
  name: string;
  logoUrl: string | null;
  website: string | null;
}

/** Prefiks klucza cache wyszukiwania - unieważniany po dodaniu organizacji. */
export const ORGANIZATION_SEARCH_KEY = ["post-organizations-search"] as const;

/** Klucz cache dla konkretnego zapytania. `tenantId` w kluczu = brak przecieku
 *  wyników między obszarami roboczymi w pamięci podręcznej klienta. */
export function organizationSearchKey(
  tenantId: string | null | undefined,
  query: string,
): readonly (string | null)[] {
  return [...ORGANIZATION_SEARCH_KEY, tenantId ?? null, query.trim().toLowerCase()];
}

/** Ile organizacji mieści droplista, zanim redakcja musi użyć wyszukiwania. */
export const ORGANIZATION_DROPLIST_LIMIT = 50;

/** Ile wyników pokazuje lista w dialogu wyszukiwania. */
export const ORGANIZATION_SEARCH_LIMIT = 12;

/** Wartość „brak organizacji" w `<Select>` - Radix nie przyjmuje pustego stringa. */
export const ORGANIZATION_NONE_VALUE = "__none__";

/** Podzbiór formularza, z którego czytamy migawkę przypisanej organizacji. */
export interface OrganizationSnapshotFields {
  organization_id: string | null;
  organization_name: string | null;
  organization_logo_url: string | null;
  organization_website: string | null;
}

/**
 * Wiersze droplisty z DOKLEJONĄ organizacją przypisaną do wpisu.
 *
 * Przypisana firma może nie być w pierwszych `ORGANIZATION_DROPLIST_LIMIT`
 * wynikach albo zniknąć z CRM. Bez doklejenia `<Select>` pokazałby PUSTĄ
 * wartość dla wpisu, który organizację MA - co wygląda jak utrata danych
 * i zaprasza do „naprawienia" przez ponowny wybór, czyli do nadpisania
 * migawki bieżącym stanem CRM.
 *
 * Doklejony wiersz powstaje z MIGAWKI zapisanej we wpisie, nie z CRM-u -
 * to ona jest dowodem stanu z chwili publikacji.
 */
export function organizationSelectRows<T extends OrganizationRow>(
  rows: readonly T[],
  form: OrganizationSnapshotFields,
): Array<T | OrganizationRow> {
  const id = form.organization_id;
  if (!id) return [...rows];
  if (rows.some((r) => r.id === id)) return [...rows];
  return [
    {
      id,
      name: form.organization_name ?? id,
      website: form.organization_website,
      logo_url: form.organization_logo_url,
      country: null,
      city: null,
      branch: null,
    },
    ...rows,
  ];
}

/**
 * ATOMOWY patch przypisania albo odpięcia organizacji.
 *
 * Cztery osobne `set()` dałyby cztery wpisy w historii cofania (redaktor
 * cofałby czterokrotnie jedną czynność) i cztery renderowania, z których
 * każde mogłoby trafić w debounce autozapisu osobno - zapisując stan
 * POŚREDNI, np. nowe `organization_id` ze starą nazwą. Odpięcie zeruje
 * WSZYSTKIE cztery kolumny; zostawienie migawki przy pustym `id` dałoby
 * wpis z nazwą firmy, do której już się nie przyznaje.
 */
export function organizationPatch(
  selection: OrganizationSelection | null,
): OrganizationSnapshotFields {
  if (!selection) {
    return {
      organization_id: null,
      organization_name: null,
      organization_logo_url: null,
      organization_website: null,
    };
  }
  return {
    organization_id: selection.id,
    organization_name: selection.name,
    organization_logo_url: selection.logoUrl,
    organization_website: selection.website,
  };
}
