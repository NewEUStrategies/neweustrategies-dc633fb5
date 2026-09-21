// Podpowiedzi osób i firm do @wzmianki. Źródłem jest publiczny, tenant-owy RPC
// search_mention_targets (SECURITY DEFINER + current_tenant_id()/public_tenant_id()). Dzięki temu:
//   * IZOLACJA TENANTA jest wymuszona w bazie (podpowiedzi nigdy nie zawierają
//     osób ani firm z innego obszaru roboczego), bez filtra tenant_id w kliencie;
//   * PRYWATNOŚĆ: RPC zwraca wyłącznie publiczne profile osób i bezpieczny
//     wycinek firm CRM (nazwa, logo, strona, branża), bez PII i notatek.
// Zapytanie jest debounce'owane u wołającego; przy braku funkcji w bazie
// degradujemy do pustej listy.
import { useContext } from "react";
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MentionSuggestion {
  kind: "person" | "organization";
  slug: string;
  name: string;
  avatarUrl: string | null;
  logoUrl: string | null;
  website: string | null;
  subtitle: string | null;
  verified: boolean;
}

/** Ile podpowiedzi pokazujemy naraz (lista pozostaje zwięzła i nawigowalna). */
export const MENTION_SUGGESTION_LIMIT = 6;

// Poza drzewem QueryClientProvider (izolowany render pola w testach/podglądzie)
// degradujemy do braku podpowiedzi zamiast rzucać - pole tekstowe ma działać.
let fallbackClient: QueryClient | null = null;

export function useMentionSuggestions(query: string | null, lang: "pl" | "en") {
  const ctxClient = useContext(QueryClientContext);
  const client = ctxClient ?? (fallbackClient ??= new QueryClient());
  // query === null oznacza „kursor nie stoi w obrębie wzmianki" - nie pytamy.
  const enabled = query !== null && ctxClient != null;
  const q = (query ?? "").trim();
  return useQuery(
    {
      queryKey: ["mention-suggestions", q, lang] as const,
      enabled,
      staleTime: 60_000,
      queryFn: async (): Promise<MentionSuggestion[]> => {
        try {
          const { data, error } = await supabase.rpc("search_mention_targets", {
            _q: q.length > 0 ? q : undefined,
            _limit: MENTION_SUGGESTION_LIMIT,
          });
          if (error) throw error;
          return (data ?? [])
            .filter(
              (r) =>
                (r.kind === "person" || r.kind === "organization") &&
                typeof r.slug === "string" &&
                r.slug.length > 0,
            )
            .slice(0, MENTION_SUGGESTION_LIMIT)
            .map((r) => ({
              kind: r.kind === "organization" ? "organization" : "person",
              slug: r.slug,
              name: r.label || r.slug,
              avatarUrl: r.avatar_url || null,
              logoUrl: r.logo_url || null,
              website: r.website || null,
              subtitle: r.subtitle || null,
              verified: r.verified === true,
            }));
        } catch {
          // Odporność przed wdrożeniem migracji / przy błędzie sieci: brak podpowiedzi.
          return [];
        }
      },
    },
    client,
  );
}
