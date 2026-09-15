// Publiczny odczyt opublikowanej wersji dokumentu prawnego. RLS wpuszcza anon
// wyłącznie na wiersze `published` z publicznego tenanta, więc zapytanie jest
// bezpieczne także dla niezalogowanych. Brak wersji w bazie = treść z kodu.
import { useQuery } from "@tanstack/react-query";
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

export function useLegalDocumentCopy(
  key: LegalDocKey,
  fallback: LegalDocContent,
  lang: "pl" | "en",
): ResolvedLegalCopy {
  const { data } = useQuery({
    queryKey: legalVersionQueryKey(key),
    queryFn: () => fetchPublishedLegalContent(key),
    staleTime: 5 * 60 * 1000,
  });
  return pickLegalCopy(data ?? null, fallback, lang);
}
