// Pure data-shaping helpers for the research-program query layer. Extracted
// from queries/programs.ts so the logic (jsonb normalization, curator-order
// preservation) is unit-testable without mocking Supabase — the same split the
// rest of the codebase uses for query modules (see archives.test.ts note).

export interface ResearchQuestion {
  pl: string;
  en: string;
}

/** Normalize the jsonb `research_questions` payload into a typed, non-empty array. */
export function normalizeQuestions(raw: unknown): ResearchQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q) => {
      if (q && typeof q === "object") {
        const o = q as Record<string, unknown>;
        return {
          pl: typeof o.pl === "string" ? o.pl : "",
          en: typeof o.en === "string" ? o.en : "",
        };
      }
      return { pl: "", en: "" };
    })
    .filter((q) => q.pl.trim() !== "" || q.en.trim() !== "");
}

/**
 * Re-sort `rows` to match the order of `ids` (the curator's `sort_order`),
 * since a `WHERE id IN (...)` query returns rows in arbitrary order. Rows whose
 * id is not in `ids` sort last (stable among themselves).
 */
export function orderByIds<T>(rows: T[], ids: string[], getId: (row: T) => string): T[] {
  const order = new Map(ids.map((id, i) => [id, i]));
  const fallback = ids.length;
  return rows
    .slice()
    .sort((a, b) => (order.get(getId(a)) ?? fallback) - (order.get(getId(b)) ?? fallback));
}
