// Server fn warstwy semantycznej DYSKUSJI: zamienia frazę na wektor zapytania
// (768D) i tyle. Sam wektor wraca do klienta, który dokłada go do
// `club_semantic_search` jako `p_embedding`.
//
// BŁĄD, KTÓRY TO ZAMYKA. Cała warstwa semantyczna klubów istniała od PR 197
// i nie miała ANI JEDNEGO wołającego: tabela `club_thread_embeddings`,
// batch liczący wektory w `jobs-tick`, indeks IVFFlat i RPC
// `club_semantic_search`. Platforma liczyła embeddingi każdego wątku i nikt
// ich nigdy nie czytał - koszt bramki AI bez żadnego efektu dla czytelnika.
//
// DLACZEGO WEKTOR WRACA DO KLIENTA, a nie serwer woła RPC sam: dokładnie ten
// sam powód, co przy katalogu osób (`peopleSemantic.functions.ts`).
// `club_semantic_search` liczy widoczność per wiersz przez `club_capabilities`,
// czyli po `auth.uid()` WOŁAJĄCEGO - a serwerowy klient anon żadnego `auth.uid()`
// nie ma i dostałby zbiór pusty albo, co gorsza, zbiór klubów publicznych
// udający komplet. Serwer robi więc jedyną rzecz, której klient nie może zrobić
// bezpiecznie (trzyma klucz bramki AI), a zapytanie do bazy leci z sesji
// użytkownika.
//
// Wektor zapytania jest pochodną FRAZY, którą użytkownik przed chwilą wpisał -
// nie ma w nim niczyich danych, więc oddanie go klientowi nie ujawnia nic ponad
// to, co użytkownik sam napisał.
//
// KTO MOŻE WOŁAĆ. Tylko zalogowany i tylko w limicie: każde wywołanie bez
// trafienia w cache to płatne zapytanie do bramki AI, więc anonimowy dostęp
// oznaczał, że dowolny gość drenuje kwotę embeddingów. Wyszukiwarka klubów jest
// zresztą włączana dla zalogowanego (`club.index`), a gość na publicznym klubie
// dostaje `embedding: null` i wynik z samego FTS.
//
// Degradacja: `embedding: null` = brak bramki, brak klucza albo błąd. Wołający
// pomija semantykę i wyszukiwarka działa na samym FTS - dokładnie jak przed tą
// zmianą.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Krótsze frazy nie mają sensu semantycznego (i tak wygra pełnotekstowy). */
export const CLUB_SEMANTIC_MIN_CHARS = 4;

const InputSchema = z.object({
  q: z.string().trim().min(CLUB_SEMANTIC_MIN_CHARS).max(200),
});

export interface ClubQueryEmbedding {
  embedding: number[] | null;
}

// Cache embeddingów fraz w pamięci procesu: wyszukiwarka woła to z debouncem,
// więc dopisanie jednej litery nie może kosztować kolejnego wywołania bramki.
// Ten sam wzorzec i ten sam rozmiar, co przy wpisach i katalogu osób.
const queryCache = new Map<string, number[]>();
const QUERY_CACHE_MAX = 300;

/** Wyszukiwarka woła to z debouncem 250 ms, a wektor frazy żyje w cache godzinę -
 *  minuta pisania mieści się w progu, seria automatu już nie. */
const EMBEDDINGS_PER_MINUTE = 30;

export const embedClubQuery = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: z.input<typeof InputSchema>) => InputSchema.parse(data))
  .handler(async ({ data, context }): Promise<ClubQueryEmbedding> => {
    const norm = data.q.trim().toLowerCase();
    const cached = queryCache.get(norm);
    if (cached) return { embedding: cached };

    // Limit dopiero za cache'em: trafienie w cache nic nie kosztuje, a licznik
    // to round-trip do bazy. FAIL-CLOSED, bo za tym progiem jest PŁATNA bramka
    // AI - awaria licznika ma odmawiać, nie otwierać budżet.
    const { rateLimit } = await import("@/lib/server/rate-limit.server");
    const allowed = await rateLimit({
      scope: "club.semantic",
      subjectId: context.userId,
      max: EMBEDDINGS_PER_MINUTE,
      failClosed: true,
    });
    if (!allowed) return { embedding: null };

    const { embedTexts } = await import("@/lib/server/embeddings.server");
    let vectors: number[][] | null;
    try {
      vectors = await embedTexts([norm]);
    } catch {
      // Błąd przejściowy bramki nie może wywracać wyszukiwarki.
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
