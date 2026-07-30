// Czysta logika prezentacji dokumentów prawnych: wybór wersji językowej i
// zamiana nazw ikon na komponenty. Bez React Query i bez Supabase, żeby dało
// się to testować w izolacji.
import type { LegalSection } from "@/components/legal/LegalPage";
import { resolveLegalIcon } from "./icons";
import type { LegalDocContent, LegalDocCopy } from "./types";

export interface ResolvedLegalCopy {
  eyebrow: string;
  title: string;
  lead: string;
  updated: string;
  footnote?: string;
  sections: readonly LegalSection[];
}

export function resolveLegalCopy(copy: LegalDocCopy): ResolvedLegalCopy {
  return {
    eyebrow: copy.eyebrow,
    title: copy.title,
    lead: copy.lead,
    updated: copy.updated,
    footnote: copy.footnote,
    sections: copy.sections.map((s) => ({
      id: s.id,
      Icon: resolveLegalIcon(s.icon),
      heading: s.heading,
      paragraphs: s.paragraphs,
      bullets: s.bullets,
    })),
  };
}

/** Wersja z bazy ma pierwszeństwo; brak lub zły kształt -> treść z kodu. */
export function pickLegalCopy(
  published: LegalDocContent | null,
  fallback: LegalDocContent,
  lang: "pl" | "en",
): ResolvedLegalCopy {
  const source = published ?? fallback;
  const copy = source[lang] ?? fallback[lang];
  return resolveLegalCopy(copy);
}
