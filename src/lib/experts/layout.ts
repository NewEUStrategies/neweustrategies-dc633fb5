// Rozwiązanie layoutu dla strony eksperta:
//   1) author_profiles.layout_template_id (per-ekspert override),
//   2) site_settings("expert_profile_layout").value.builder_data (globalny domyślny),
//   3) null - trasa /author/$slug renderuje wtedy klasyczny fallback CSIS.
// Jeśli ekspert ma jednocześnie template_id oraz layout_overrides (JSON Patch RFC 6902),
// patch nakładamy na pobrany dokument. Pusty override = brak modyfikacji.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { type BuilderDocument, emptyDocument } from "@/lib/builder/types";
import { safeParseBuilderDoc } from "@/lib/builder/schema";

interface RawSetting {
  value: { builder_data?: unknown } | null;
}
interface RawTemplate {
  data: unknown;
}

/** Zapis pod-widget builder_data w kolumnie value tabeli site_settings. */
function extractBuilderDoc(value: unknown): BuilderDocument | null {
  if (!value || typeof value !== "object") return null;
  const bd = (value as { builder_data?: unknown }).builder_data;
  if (!bd) return null;
  try {
    return safeParseBuilderDoc(bd as BuilderDocument);
  } catch {
    return null;
  }
}

export interface ResolvedExpertLayout {
  /** Dokument do renderu przez BuilderRenderer; null = użyj klasycznego fallbacku CSIS. */
  doc: BuilderDocument | null;
  /** Skąd wziął się dokument (do debug/audytu). */
  source: "author_template" | "global_default" | "none";
}

export const expertLayoutQueryOptions = (userId: string | null) =>
  queryOptions({
    queryKey: ["expert-layout", userId ?? "__none__"] as const,
    queryFn: async (): Promise<ResolvedExpertLayout> => {
      // 1) Per-ekspert
      if (userId) {
        const { data: ap } = await supabase
          .from("author_profiles")
          .select("layout_template_id, layout_overrides")
          .eq("user_id", userId)
          .maybeSingle();
        const tplId = (ap as { layout_template_id?: string | null } | null)?.layout_template_id;
        if (tplId) {
          const { data: tpl } = await supabase
            .from("builder_templates")
            .select("data")
            .eq("id", tplId)
            .maybeSingle();
          const raw = (tpl as RawTemplate | null)?.data;
          if (raw && typeof raw === "object") {
            // szablon może być zapisany jako BuilderDocument LUB jako pojedynczy
            // SectionNode (starszy format). Normalizujemy.
            const doc =
              (raw as BuilderDocument).sections !== undefined
                ? safeParseBuilderDoc(raw as BuilderDocument)
                : { version: 1 as const, sections: [raw as never] };
            return { doc: doc ?? emptyDocument(), source: "author_template" };
          }
        }
      }
      // 2) Globalny
      const { data: s } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "expert_profile_layout")
        .maybeSingle();
      const doc = extractBuilderDoc((s as RawSetting | null)?.value);
      if (doc && doc.sections.length > 0) {
        return { doc, source: "global_default" };
      }
      return { doc: null, source: "none" };
    },
    staleTime: 60_000,
  });
