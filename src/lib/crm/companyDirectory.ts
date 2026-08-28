// Katalog organizacji dla uczestników wydarzeń.
//
// Uczestnik NIE MA dostępu do panelu admina, a mimo to musi wskazać swoją
// instytucję. Dwa RPC (SECURITY DEFINER, tylko dla zalogowanych, w obrębie
// tenanta) dają mu dokładnie tyle, ile trzeba: wyszukanie po fragmencie nazwy
// i dodanie nowej kartoteki. Żadnych danych handlowych CRM - wyłącznie brand
// (nazwa, logo, miasto, kraj, branża, www).
import { useMutation, useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export interface CompanyOption {
  id: string;
  name: string;
  logoUrl: string | null;
  city: string | null;
  country: string | null;
  branch: string | null;
  website: string | null;
}

export interface NewCompanyInput {
  name: string;
  logo_url?: string;
  address?: string;
  city?: string;
  postal_code?: string;
  country?: string;
  phone?: string;
  email?: string;
  website?: string;
  branch?: string;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function parseCompanyOption(value: unknown): CompanyOption | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const id = text(row.id);
  const name = text(row.name);
  if (id === null || name === null) return null;
  return {
    id,
    name,
    logoUrl: text(row.logo_url),
    city: text(row.city),
    country: text(row.country),
    branch: text(row.branch),
    website: text(row.website),
  };
}

export function parseCompanyOptions(value: unknown): CompanyOption[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseCompanyOption).filter((row): row is CompanyOption => row !== null);
}

export async function searchCompanies(query: string, limit = 10): Promise<CompanyOption[]> {
  const { data, error } = await supabase.rpc("crm_company_search", {
    p_query: query,
    p_limit: limit,
  });
  if (error) throw error;
  return parseCompanyOptions(data);
}

export async function createCompany(input: NewCompanyInput): Promise<CompanyOption | null> {
  const { data, error } = await supabase.rpc("crm_company_create_self", {
    p_name: input.name,
    p_logo_url: input.logo_url ?? undefined,
    p_address: input.address ?? undefined,
    p_city: input.city ?? undefined,
    p_postal_code: input.postal_code ?? undefined,
    p_country: input.country ?? undefined,
    p_phone: input.phone ?? undefined,
    p_email: input.email ?? undefined,
    p_website: input.website ?? undefined,
    p_branch: input.branch ?? undefined,
  });
  if (error) throw error;
  return parseCompanyOptions(data)[0] ?? null;
}

/** Podpowiedzi organizacji; wpisany tekst zawęża listę (min. 2 znaki). */
export function useCompanySearch(query: string): UseQueryResult<CompanyOption[], Error> {
  const key = query.trim();
  return useQuery({
    queryKey: ["crm-company-search", key.toLowerCase()],
    queryFn: () => searchCompanies(key),
    enabled: key.length >= 2,
    staleTime: 60_000,
  });
}

export function useCreateCompany() {
  return useMutation<CompanyOption | null, Error, NewCompanyInput>({
    mutationFn: createCompany,
  });
}
