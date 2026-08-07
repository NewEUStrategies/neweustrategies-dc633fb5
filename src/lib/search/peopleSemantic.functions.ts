// Server fn warstwy semantycznej KATALOGU OSÓB: zamienia frazę na wektor
// zapytania (768D) i tyle. Sam wektor jedzie z powrotem do klienta, który
// dokłada go do `search_people` jako `p_embedding`.
//
// DLACZEGO TAK, a nie jak przy wpisach (semantic.functions.ts, gdzie serwer
// woła RPC sam): katalog osób jest CZŁONKOWSKI. `semantic_search_profiles`
// i `search_people` skalują dane po tenancie WOŁAJĄCEGO, czytanym z jego
// profilu przez `auth.uid()` - a serwerowy klient anon (nawet z pinowaniem
// x-tenant-host) żadnego `auth.uid()` nie ma i dostałby pusty zbiór. Dlatego
// serwer robi jedyną rzecz, której klient nie może zrobić bezpiecznie (trzyma
// klucz bramki AI), a zapytanie do bazy leci z sesji użytkownika, pod RLS.
//
// Wektor zapytania to pochodna FRAZY, którą użytkownik właśnie wpisał - nie ma
// w nim niczyich danych, więc oddanie go klientowi nie ujawnia nic ponad to,
// co użytkownik sam napisał.
//
// Degradacja: `embedding: null` = brak bramki / brak klucza / błąd. Wołający
// pomija semantykę i katalog działa na czystym trigramie (dokładnie jak przed
// 20260807144000).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Krótsze frazy nie mają sensu semantycznego (i tak wygra trigram). */
export const PEOPLE_SEMANTIC_MIN_CHARS = 4;

const InputSchema = z.object({
  q: z.string().trim().min(PEOPLE_SEMANTIC_MIN_CHARS).max(200),
});

export interface PeopleQueryEmbedding {
  embedding: number[] | null;
}

// Cache embeddingów fraz w pamięci procesu: katalog woła to z debouncem, więc
// dopisanie jednej litery nie może kosztować kolejnego wywołania bramki.
// Ten sam wzorzec i ten sam rozmiar co w semantic.functions.ts dla wpisów.
const queryCache = new Map<string, number[]>();
const QUERY_CACHE_MAX = 300;

export const embedPeopleQuery = createServerFn({ method: "GET" })
  .validator((data: z.input<typeof InputSchema>) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<PeopleQueryEmbedding> => {
    const norm = data.q.trim().toLowerCase();
    const cached = queryCache.get(norm);
    if (cached) return { embedding: cached };

    const { embedTexts } = await import("@/lib/server/embeddings.server");
    let vectors: number[][] | null;
    try {
      vectors = await embedTexts([norm]);
    } catch {
      // Błąd przejściowy bramki nie może wywracać katalogu osób.
      return { embedding: null };
    }
    const vector = vectors?.[0];
    if (!vector) return { embedding: null };

    if (queryCache.size >= QUERY_CACHE_MAX) {
      const oldest = queryCache.keys().next().value;
      if (oldest !== undefined) queryCache.delete(oldest);
    }
    queryCache.set(norm, vector);
    return { embedding: vector };
  });
