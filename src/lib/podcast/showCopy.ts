// Teksty programu podcastowego w języku strony - wydzielone z `types.ts`, bo
// czyta je `head()` trasy `/podcasts/$show`, a `head()` zostaje w shellu trasy,
// czyli w chunku wejściowym KAŻDEGO czytelnika. Import `types.ts` ciągnął tam
// schematy zod całego modułu (5,9 KB przed minifikacją, pomiar entry
// 2026-10-02) dla dwóch funkcji na stringach. `types.ts` re-eksportuje obie,
// więc komponenty importują jak dotąd; `import type` stamtąd jest darmowy.
import type { PodcastShow } from "./types";

export function showTitle(
  s: Pick<PodcastShow, "title_pl" | "title_en">,
  lang: "pl" | "en",
): string {
  return (lang === "en" ? s.title_en : s.title_pl) || s.title_pl || s.title_en || "";
}

export function showDescription(
  s: Pick<PodcastShow, "description_pl" | "description_en">,
  lang: "pl" | "en",
): string {
  return (lang === "en" ? s.description_en : s.description_pl) || s.description_pl || "";
}
