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
// Podpowiadamy OSOBY I ORGANIZACJE - `search_people_orgs` zwraca jedne i drugie,
// a wzmianka firmy zapisuje się tą samą składnią `@slug` co wzmianka osoby.
// Rozstrzygnięcie „kto to jest" schodzi do warstwy rozwiązywania (`directory`),
// więc front nie rozjeżdża się z triggerem `process_mentions` w bazie: dla
// organizacji po prostu nie ma kogo powiadomić i nikt powiadomienia nie dostaje.
// Slug jest wymagany (RPC zwraca tylko wpisy ze slugiem, ale zawężamy
// defensywnie). Zapytanie jest debounce'owane u wołającego; przy braku funkcji
// w bazie degradujemy do pustej listy.
import { useContext } from "react";
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MentionSuggestion {
  /** Czym jest podpowiedź - rozstrzyga ikonę wiersza i treść podglądu. */
  kind: "person" | "org";
  slug: string;
  name: string;
  avatarUrl: string | null;
  subtitle: string | null;
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
          const { data, error } = await supabase.rpc("search_people_orgs", {
            _q: q.length > 0 ? q : undefined,
            _limit: MENTION_SUGGESTION_LIMIT,
          });
          if (error) throw error;
          return (data ?? [])
            .filter((r) => (r.kind === "person" || r.kind === "organization") && Boolean(r.slug))
            .slice(0, MENTION_SUGGESTION_LIMIT)
            .map((r) => ({
              kind: r.kind === "organization" ? ("org" as const) : ("person" as const),
              slug: r.slug,
              name: (lang === "en" ? r.label_en : r.label_pl) || r.label_pl || r.label_en || r.slug,
              // Osoba ma zdjęcie, organizacja - logo; gałąź UNION zwraca w
              // drugiej kolumnie NULL, więc bierzemy pierwszą niepustą.
              avatarUrl: r.avatar_url || r.logo_url || null,
              subtitle: (lang === "en" ? r.sublabel_en : r.sublabel_pl) || null,
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
