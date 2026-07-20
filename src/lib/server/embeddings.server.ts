// Klient embeddingów bramki Lovable AI (OpenAI-zgodny endpoint /v1/embeddings)
// + partia indeksera dla jobs-tick. Warstwa semantyczna wyszukiwania jest
// ADDYTYWNA: gdy bramka nie wspiera embeddingów (404/400) albo brakuje
// klucza, wszystko degraduje się do czystego FTS - stąd null zamiast
// wyjątków na ścieżce "provider niedostępny".
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const EMBEDDINGS_URL =
  process.env.AI_GATEWAY_EMBEDDINGS_URL || "https://ai.gateway.lovable.dev/v1/embeddings";
// text-embedding-3-small z dimensions=768 == wymiar Gemini text-embedding-004;
// jedna kolumna vector(768) obsługuje oba (patrz migracja pgvector).
const EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || "text-embedding-3-small";
export const EMBEDDING_DIMS = 768;

type DbClient = SupabaseClient<Database>;

/** Po pierwszym twardym "nie wspieram" nie młócimy bramki co minutę. */
let providerUnavailableUntil = 0;
const PROVIDER_RETRY_MS = 60 * 60 * 1000;

/**
 * Embeduje partię tekstów. null = dostawca niedostępny (brak klucza,
 * endpoint nie istnieje, model nieznany) - wołający pomija semantykę.
 * Rzuca tylko na błędach przejściowych (5xx/sieć), żeby tick mógł ponowić.
 */
export async function embedTexts(texts: readonly string[]): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;
  if (Date.now() < providerUnavailableUntil) return null;

  const res = await fetch(EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMS,
    }),
  });
  if (res.status === 404 || res.status === 400 || res.status === 401 || res.status === 403) {
    // Bramka bez embeddingów / zły model / brak uprawnień - to nie jest stan
    // przejściowy; wyciszamy na godzinę i działamy na czystym FTS.
    providerUnavailableUntil = Date.now() + PROVIDER_RETRY_MS;
    return null;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Embeddings gateway ${res.status}: ${detail.slice(0, 200)}`);
  }
  const payload = (await res.json()) as {
    data?: Array<{ index?: number; embedding?: number[] }>;
  };
  const rows = payload.data ?? [];
  if (rows.length !== texts.length) {
    throw new Error(`Embeddings gateway returned ${rows.length}/${texts.length} vectors`);
  }
  const out: number[][] = new Array(texts.length);
  rows.forEach((r, i) => {
    const vec = r.embedding ?? [];
    if (vec.length !== EMBEDDING_DIMS) {
      throw new Error(`Embedding dims ${vec.length} != ${EMBEDDING_DIMS}`);
    }
    out[r.index ?? i] = vec;
  });
  return out;
}

/** pgvector przyjmuje literał '[x,y,...]' - tak serializujemy do upsertu. */
function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export interface SemanticIndexResult {
  scanned: number;
  embedded: number;
  skipped?: string;
}

/**
 * Jedna partia indeksera (jobs-tick): kolejka z posts_needing_embeddings ->
 * embeddingi -> upsert post_embeddings. Batch domyślnie 24 (poniżej limitów
 * wejścia bramki, a minutowy tick i tak dogania backlog w godziny).
 */
export async function runSemanticIndexBatch(
  admin: DbClient,
  batch = 24,
): Promise<SemanticIndexResult> {
  const { data: queue, error } = await admin.rpc("posts_needing_embeddings", { _limit: batch });
  if (error) throw new Error(error.message);
  const rows = queue ?? [];
  if (rows.length === 0) return { scanned: 0, embedded: 0 };

  const vectors = await embedTexts(rows.map((r) => r.embed_text ?? ""));
  if (vectors === null) {
    return { scanned: rows.length, embedded: 0, skipped: "embeddings provider unavailable" };
  }

  const payload = rows.map((r, i) => ({
    post_id: r.post_id,
    tenant_id: r.tenant_id,
    content_hash: r.content_hash,
    embedding: toVectorLiteral(vectors[i]) as unknown as string,
    updated_at: new Date().toISOString(),
  }));
  const { error: upsertError } = await admin
    .from("post_embeddings")
    .upsert(payload, { onConflict: "post_id" });
  if (upsertError) throw new Error(upsertError.message);
  return { scanned: rows.length, embedded: payload.length };
}
