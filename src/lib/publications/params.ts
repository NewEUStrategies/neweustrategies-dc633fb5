// Walidator parametrów /publications - osobny moduł, by code-splitting trasy nie gubił eksportu.
import { z } from "zod";
import { parsePageSearch } from "@/lib/routing/pageSearch";

export const PublicationsParams = z.object({
  q: z.string().optional(),
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
  sort: z.enum(["newest", "popular", "relevance"]).optional(),
  // Numer strony wyników. Ten sam defensywny parser co /blog i strona główna
  // (`parsePageSearch`): śmieci, ułamki poniżej 1 i strona 1 znikają z adresu,
  // więc `/publications` i `/publications?page=1` to JEDEN adres, a nie dwa
  // warianty tej samej treści w cache i w indeksie. Zła strona nie oblewa
  // walidacji (jak nieznany `sort`) - adres z ręcznie wpisanym `?page=abc` ma
  // otworzyć bibliotekę, nie ekran błędu.
  page: z.unknown().transform((raw) => parsePageSearch({ page: raw }).page),
});

export type PublicationsInput = z.infer<typeof PublicationsParams>;
