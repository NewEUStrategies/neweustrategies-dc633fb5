// Model stanu URL wyszukiwarki `/search`.
//
// Schemat MUSI mieszkac poza plikiem trasy. Rozdzielacz tras TanStack
// (`?tsr-shared=1`) przenosi kod komponentu do osobnego kawalka i probuje
// re-eksportowac zmienne modulowe uzywane po obu stronach granicy - stala
// `SearchParams` trzymana w `src/routes/search.tsx` konczyla sie bledem
// „does not provide an export named 'SearchParams'", ktory wywracal caly
// bundle kliencki i zostawial stronę bez hydracji (nic nie dalo sie kliknac).
import { z } from "zod";

export const SEARCH_SORTS = ["relevance", "newest", "popular"] as const;

export const searchParamsSchema = z.object({
  q: z.string().optional().default(""),
  spec: z.string().optional(),
  type: z.string().optional(),
  region: z.string().optional(),
  topic: z.string().optional(),
  project: z.string().optional(),
  series: z.string().optional(),
  org: z.string().optional(),
  author: z.string().optional(),
  format: z.string().optional(),
  lang: z.enum(["pl", "en"]).optional(),
  access: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  year: z.string().optional(),
  sort: z.enum(SEARCH_SORTS).optional(),
  match: z.enum(["all", "any", "phrase"]).optional(),
  scope: z.enum(["all", "title"]).optional(),
  tab: z.enum(["all", "titles", "types", "topics", "people"]).optional(),
  /** adv=1 otwiera panel trybow zaawansowanych (deep-link z widgetu naglowka). */
  adv: z.coerce.string().optional(),
});

export type SearchInput = z.infer<typeof searchParamsSchema>;

export function parseSearchParams(search: Record<string, unknown>): SearchInput {
  return searchParamsSchema.parse(search);
}
