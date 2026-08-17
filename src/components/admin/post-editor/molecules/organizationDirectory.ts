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
