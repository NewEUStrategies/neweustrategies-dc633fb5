// Lekki podgląd osoby po slugu - dla dymka nad @wzmianką i nad pozycją listy
// podpowiedzi. Czytamy z `profiles_public` (publiczna projekcja bez PII,
// izolowana tenantem przez RLS widoku), a nie z pełnego huba eksperta: dymek
// potrzebuje pięciu pól, a nie materiałów, faset i mediów.
import { useContext } from "react";
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { personFromRow, type MentionPerson } from "./directory";

/** Kształt karty osoby. Mapowanie kolumn zeszło do `directory.ts`, żeby dymek
 *  i zbiorczy katalog wzmianek nie rozjechały się w interpretacji tych samych
 *  pól (imię z trzech kolumn, awatar przez bramkę `hide_avatar`, firma). */
export type MentionProfilePreview = MentionPerson;

const COLS =
  "slug, display_name, first_name, last_name, avatar_url, job_title, current_company, specialization, bio_pl, bio_en, verified_at";

// Poza drzewem QueryClientProvider (izolowany render karty w teście albo
// podglądzie komponentu) bierzemy klienta zapasowego zamiast rzucać. `enabled`
// zostaje NIETKNIĘTE - leniwość dymka jest kontraktem, nie detalem.
let fallbackClient: QueryClient | null = null;

export function useMentionProfile(slug: string | null, lang: "pl" | "en", enabled: boolean) {
  const ctxClient = useContext(QueryClientContext);
  const client = ctxClient ?? (fallbackClient ??= new QueryClient());
  return useQuery(
    {
      queryKey: ["club", "mention-profile", slug, lang] as const,
      enabled: enabled && typeof slug === "string" && slug.length > 0,
      staleTime: 5 * 60_000,
      retry: false,
      queryFn: async (): Promise<MentionProfilePreview | null> => {
        if (slug === null) return null;
        const { data, error } = await supabase
          .from("profiles_public")
          .select(COLS)
          .eq("slug", slug)
          .maybeSingle();
        if (error) throw error;
        if (data === null) return null;
        return personFromRow(data as unknown as Record<string, unknown>, lang);
      },
    },
    client,
  );
}
