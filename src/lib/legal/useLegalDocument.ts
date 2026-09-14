// Publiczny odczyt opublikowanej wersji dokumentu prawnego. RLS wpuszcza anon
// wyłącznie na wiersze `published` z publicznego tenanta, więc zapytanie jest
// bezpieczne także dla niezalogowanych. Brak wersji w bazie = treść z kodu.
import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { pickLegalCopy, type ResolvedLegalCopy } from "./resolve";
import { safeParseLegalContent, type LegalDocContent, type LegalDocKey } from "./types";

export const legalVersionQueryKey = (key: LegalDocKey) => ["legal-version", key] as const;

export async function fetchPublishedLegalContent(
  key: LegalDocKey,
): Promise<LegalDocContent | null> {
  const { data, error } = await supabase
    .from("legal_document_versions")
    .select("content")
    .eq("doc_key", key)
    .eq("status", "published")
    .maybeSingle();
  if (error) return null;
  return safeParseLegalContent(data?.content);
}

/**
 * Opcje zapytania o opublikowaną wersję dokumentu - WSPÓLNE dla loadera trasy
 * i dla komponentu.
 *
 * PO CO FABRYKA, SKORO HOOK I TAK DZIAŁAŁ. Loader trasy prawnej grzał wyłącznie
 * `staticPageSeoQueryOptions`, więc treść dokumentu dojeżdżała dopiero po
 * hydracji: SSR renderował treść BAZOWĄ z kodu, a opublikowana wersja z panelu
 * podmieniała ją dopiero w przeglądarce. Dla czytelnika to mignięcie, dla
 * wyszukiwarki - zaindeksowanie treści, która nie jest tą obowiązującą.
 * Wspólna fabryka pozwala loaderowi rozgrzać DOKŁADNIE ten klucz, który czyta
 * komponent (bramka `publicRouteLoaders` dopasowuje trasy po nazwie fabryki).
 */
export const legalDocumentQueryOptions = (key: LegalDocKey) =>
  queryOptions({
    queryKey: legalVersionQueryKey(key),
    queryFn: () => fetchPublishedLegalContent(key),
    staleTime: 5 * 60 * 1000,
  });

export function useLegalDocumentCopy(
  key: LegalDocKey,
  fallback: LegalDocContent,
  lang: "pl" | "en",
): ResolvedLegalCopy {
  const { data } = useQuery(legalDocumentQueryOptions(key));
  return pickLegalCopy(data ?? null, fallback, lang);
}
