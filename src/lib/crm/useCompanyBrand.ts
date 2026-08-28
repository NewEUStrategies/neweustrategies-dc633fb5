// Logotyp i strona firmy z CRM - jedno zapytanie na nazwę organizacji.
//
// Uczestnik wpisuje w profilu wolny tekst („Ministerstwo X", „ACME sp. z o.o."),
// a CRM ma dla tej nazwy kartotekę z logotypem i domeną. RPC `crm_company_brand`
// zwraca WYŁĄCZNIE dane brandowe (nazwa, logo, www, branża) - żadnych danych
// handlowych - dzięki czemu można je czytać publicznie w katalogu uczestników.
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export interface CompanyBrand {
  id: string | null;
  name: string | null;
  logoUrl: string | null;
  website: string | null;
  industry: string | null;
}

const EMPTY: CompanyBrand = {
  id: null,
  name: null,
  logoUrl: null,
  website: null,
  industry: null,
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function parseCompanyBrand(value: Json | null): CompanyBrand {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return EMPTY;
  const row = value as Record<string, unknown>;
  return {
    id: text(row.id),
    name: text(row.name),
    logoUrl: text(row.logo_url),
    website: text(row.website),
    industry: text(row.industry),
  };
}

export async function fetchCompanyBrand(name: string): Promise<CompanyBrand> {
  const { data, error } = await supabase.rpc("crm_company_brand", { p_name: name });
  if (error) throw error;
  return parseCompanyBrand(data ?? null);
}

/** Zwraca brand firmy dla nazwy z profilu; `null`/pusty tekst = brak zapytania. */
export function useCompanyBrand(name: string | null): UseQueryResult<CompanyBrand, Error> {
  const key = (name ?? "").trim();
  return useQuery({
    queryKey: ["crm-company-brand", key.toLowerCase()],
    queryFn: () => fetchCompanyBrand(key),
    enabled: key !== "",
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });
}
