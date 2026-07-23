// Podpowiedzi osób do @wzmianki. Źródłem jest publiczny, tenant-owy RPC
// search_people_orgs (SECURITY DEFINER + current_tenant_id()/public_tenant_id())
// - ten sam, którym wyszukiwarka osób zasila stronę /people. Dzięki temu:
//   * IZOLACJA TENANTA jest wymuszona w bazie (podpowiedzi nigdy nie zawierają
//     osób z obszaru roboczego innej firmy), bez filtra tenant_id w kliencie;
//   * PRYWATNOŚĆ: RPC zwraca wyłącznie profile discoverable + redakcyjne
//     (autorzy/eksperci), więc anonimowy komentujący nie może wyliczyć całej
//     bazy członków. Ręczne wpisanie znanego sluga i tak notyfikuje dowolny
//     profil tenanta (trigger process_mentions) - autocomplete tylko UŁATWIA
//     wybór osób publicznych.
//
// Filtrujemy do osób (kind === "person"); slug jest wymagany (RPC zwraca tylko
// profile ze slugiem, ale zawężamy defensywnie). Zapytanie jest debounce'owane
// u wołającego; przy braku funkcji w bazie degradujemy do pustej listy.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MentionSuggestion {
  slug: string;
  name: string;
  avatarUrl: string | null;
  subtitle: string | null;
}

/** Ile podpowiedzi pokazujemy naraz (lista pozostaje zwięzła i nawigowalna). */
export const MENTION_SUGGESTION_LIMIT = 6;

export function useMentionSuggestions(query: string | null, lang: "pl" | "en") {
  // query === null oznacza „kursor nie stoi w obrębie wzmianki" - nie pytamy.
  const enabled = query !== null;
  const q = (query ?? "").trim();
  return useQuery({
    queryKey: ["mention-suggestions", q, lang] as const,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<MentionSuggestion[]> => {
      try {
        const { data, error } = await supabase.rpc("search_people_orgs", {
          _q: q.length > 0 ? q : undefined,
          _limit: MENTION_SUGGESTION_LIMIT,
        });
        if (error) throw error;
        return (data ?? [])
          .filter((r) => r.kind === "person" && Boolean(r.slug))
          .slice(0, MENTION_SUGGESTION_LIMIT)
          .map((r) => ({
            slug: r.slug,
            name: (lang === "en" ? r.label_en : r.label_pl) || r.label_pl || r.label_en || r.slug,
            avatarUrl: r.avatar_url || null,
            subtitle: (lang === "en" ? r.sublabel_en : r.sublabel_pl) || null,
          }));
      } catch {
        // Odporność przed wdrożeniem migracji / przy błędzie sieci: brak podpowiedzi.
        return [];
      }
    },
  });
}
