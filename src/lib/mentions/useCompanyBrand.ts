// Marka firmy do dymka przy nazwie firmy w bylinie i w wizytówce osoby.
//
// DLACZEGO PO NAZWIE, A NIE PO ID. Profil trzyma firmę jako SNAPSHOT tekstowy
// (`profiles.current_company`); kartoteka CRM (`crm_companies`) jest zamknięta
// dla wszystkich poza redakcją tenanta, więc złączenie po kluczu obcym oddałoby
// czytelnikowi zero wierszy. Jedyne publiczne wejście to `crm_company_brand`,
// które dopasowuje po ZNORMALIZOWANEJ NAZWIE i oddaje wyłącznie markę: nazwę,
// logo, adres i branżę. Kartoteka z leadami zostaje zamknięta.
//
// LENIWO. Zapytanie rusza dopiero po otwarciu dymka - lista odpowiedzi z
// dwudziestoma firmami nie robi dwudziestu wyjść do bazy przy renderze.
//
// BRAK TRAFIENIA TO NIE BŁĄD. Firma wpisana ręcznie (albo po zmianie nazwy w
// CRM) nie znajdzie się w kartotece; wtedy dymek pokazuje samą nazwę i tyle.
import { useContext } from "react";
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CompanyBrand {
  name: string;
  logoUrl: string | null;
  website: string | null;
  branch: string | null;
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

// Poza drzewem QueryClientProvider (izolowany render karty w teście lub
// podglądzie) degradujemy do samej nazwy firmy zamiast rzucać - bylina ma się
// wyrenderować także wtedy, gdy nikt nie postawił klienta zapytań.
let fallbackClient: QueryClient | null = null;

export function useCompanyBrand(name: string | null, enabled: boolean) {
  const ctxClient = useContext(QueryClientContext);
  const client = ctxClient ?? (fallbackClient ??= new QueryClient());
  return useQuery(
    {
      queryKey: ["mention-company-brand", name] as const,
      enabled: enabled && typeof name === "string" && name.length > 0,
      staleTime: 10 * 60_000,
      retry: false,
      queryFn: async (): Promise<CompanyBrand | null> => {
        if (name === null) return null;
        const { data, error } = await supabase.rpc("crm_company_brand", { p_name: name });
        if (error) throw error;
        const row = (data ?? [])[0];
        if (row === undefined) return null;
        return {
          name: clean(row.name) ?? name,
          logoUrl: clean(row.logo_url),
          website: clean(row.website),
          branch: clean(row.branch),
        };
      },
    },
    client,
  );
}
