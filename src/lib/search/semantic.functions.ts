// Server fn warstwy semantycznej: embeduje frazę zapytania i zwraca
// podobieństwa kosinusowe opublikowanych wpisów (semantic_search_posts).
// Klient (searchQueryOptions) DOKŁADA ten sygnał do rankingu FTS; null/pusta
// odpowiedź = czysty FTS (bramka bez embeddingów, brak klucza, błąd).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchWithTenantHost } from "@/integrations/supabase/tenant-host-fetch";
import type { Database } from "@/integrations/supabase/types";

export interface SemanticHit {
  post_id: string;
  similarity: number;
}

const InputSchema = z.object({
  q: z.string().trim().min(4).max(200),
  limit: z.number().int().min(1).max(100).optional(),
});

// Mały cache embeddingów zapytań w pamięci procesu: użytkownicy dopisują
// frazę znak po znaku (debounce), a popularne zapytania się powtarzają.
const queryCache = new Map<string, number[]>();
const QUERY_CACHE_MAX = 300;

export const semanticSearch = createServerFn({ method: "GET" })
  .inputValidator((data: z.input<typeof InputSchema>) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<{ hits: SemanticHit[] }> => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return { hits: [] };

    const norm = data.q.trim().toLowerCase();
    let vector = queryCache.get(norm);
    if (!vector) {
      const { embedTexts } = await import("@/lib/server/embeddings.server");
      let vectors: number[][] | null;
      try {
        vectors = await embedTexts([norm]);
      } catch {
        // Błąd przejściowy bramki nie może wywracać wyszukiwarki.
        return { hits: [] };
      }
      if (!vectors || !vectors[0]) return { hits: [] };
      vector = vectors[0];
      if (queryCache.size >= QUERY_CACHE_MAX) {
        const oldest = queryCache.keys().next().value;
        if (oldest !== undefined) queryCache.delete(oldest);
      }
      queryCache.set(norm, vector);
    }

    const { createClient } = await import("@supabase/supabase-js");
    // Klient anon pod RLS; tenant-host fetch pinuje current_tenant_id()
    // do przeglądanej witryny (wzorzec globalSearch).
    const sb = createClient<Database>(url, key, {
      auth: { persistSession: false },
      global: { fetch: fetchWithTenantHost },
    });
    const { data: rows, error } = await sb.rpc("semantic_search_posts", {
      _embedding: vector,
      _limit: data.limit ?? 40,
    });
    if (error) return { hits: [] };
    return {
      hits: (rows ?? []).map((r) => ({
        post_id: r.post_id,
        similarity: Number(r.similarity ?? 0),
      })),
    };
  });
