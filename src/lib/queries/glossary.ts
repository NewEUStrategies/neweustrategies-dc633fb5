// Zapytania słowniczka pojęć (A7). RLS ogranicza do tenanta hosta.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface GlossaryTerm {
  id: string;
  slug: string;
  term_pl: string;
  term_en: string;
  definition_pl: string;
  definition_en: string | null;
}

export const glossaryTermsQueryOptions = () =>
  queryOptions({
    queryKey: ["public", "glossary-terms"] as const,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<GlossaryTerm[]> => {
      const { data, error } = await supabase
        .from("glossary_terms")
        .select("id, slug, term_pl, term_en, definition_pl, definition_en")
        .order("term_pl")
        .limit(500);
      if (error) throw error;
      return (data ?? []) as GlossaryTerm[];
    },
  });
