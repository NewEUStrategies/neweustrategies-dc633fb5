// Która strona CMS-a jest stroną główną - odczyt dla PANELU (przeglądarka).
//
// Wyciąg 1:1 z /admin/seo/homepage, żeby edytor strony w /admin/pages pytał
// o to samo tym samym zapytaniem (wspólny klucz cache). Kolejność prób jest
// lustrem `homePageQueryOptions` (src/lib/queries/public.ts) i
// `configuredHomepagePageId` (src/lib/seo/homepagePage.ts): w trybie „strona
// statyczna" `homepage_page_id`, potem `homepage_page_slug` (strona najwyższego
// poziomu), a zawsze na końcu strona najwyższego poziomu o slugu `home`.
// Tylko strony OPUBLIKOWANE i nieusunięte - te same, które widzi trasa `/`.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/lib/admin/useSettings";
import { normalizeHomepageMode } from "@/lib/queries/public";

/** Ustawienia czytania w zakresie, w jakim decydują o stronie głównej. */
export type HomepageReading = {
  homepage_mode: string;
  homepage_page_id: string;
  homepage_page_slug: string;
};

export const READING_SETTINGS_KEY = "reading";

export const DEFAULT_HOMEPAGE_READING: HomepageReading = {
  homepage_mode: "",
  homepage_page_id: "",
  homepage_page_slug: "",
};

/** Strona CMS-a pełniąca rolę strony głównej - tylko to, co przesądza o SEO. */
export interface StaticHomepageRow {
  id: string;
  slug: string;
  seo_title_pl: string | null;
  seo_title_en: string | null;
}

export function useStaticHomepage(tenantId: string | null | undefined) {
  // Ustawienia czytania odczytujemy WYŁĄCZNIE po to, by wiedzieć, która strona
  // jest stroną główną. Zapisuje je /admin/settings/reading.
  const { query: readingQuery } = useSettings<HomepageReading>(
    READING_SETTINGS_KEY,
    DEFAULT_HOMEPAGE_READING,
  );
  const reading = readingQuery.data;
  const homepageMode = normalizeHomepageMode(reading?.homepage_mode);
  const homepagePageId = reading?.homepage_page_id ?? "";
  const homepagePageSlug = reading?.homepage_page_slug ?? "";

  const staticHomepage = useQuery({
    queryKey: [
      "admin-seo-static-homepage",
      tenantId,
      homepageMode,
      homepagePageId,
      homepagePageSlug,
    ],
    enabled: !!tenantId && !!reading && homepageMode !== "latest_posts",
    queryFn: async (): Promise<StaticHomepageRow | null> => {
      if (!tenantId) return null;
      const published = () =>
        supabase
          .from("pages")
          .select("id, slug, seo_title_pl, seo_title_en")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .eq("status", "published");
      if (homepageMode === "static_page") {
        if (homepagePageId) {
          const { data, error } = await published().eq("id", homepagePageId).maybeSingle();
          if (error) throw error;
          if (data) return data;
        }
        if (homepagePageSlug) {
          const { data, error } = await published()
            .eq("slug", homepagePageSlug)
            .is("parent_id", null)
            .maybeSingle();
          if (error) throw error;
          if (data) return data;
        }
      }
      const { data, error } = await published()
        .eq("slug", "home")
        .is("parent_id", null)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  return { reading, homepageMode, staticHomepage };
}
