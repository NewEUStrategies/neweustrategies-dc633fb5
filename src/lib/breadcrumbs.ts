// Breadcrumb helpers based on the page hierarchy + optional trailing post.
import { supabase } from "@/integrations/supabase/client";

export interface BreadcrumbItem {
  /** Visible label (already localized). */
  label: string;
  /** Absolute href, undefined means non-link (current item). */
  href?: string;
}

export interface BreadcrumbRow {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  depth: number;
  full_path: string;
}
type PageRow = BreadcrumbRow;


export async function fetchPageBreadcrumbs(pageId: string): Promise<PageRow[]> {
  const { data, error } = await supabase.rpc("page_breadcrumbs", { _page_id: pageId });
  if (error) throw error;
  return (data ?? []) as PageRow[];
}

export function buildBreadcrumbs(
  pages: PageRow[],
  lang: "pl" | "en",
  postTitle?: string,
): BreadcrumbItem[] {
  const sorted = [...pages].sort((a, b) => a.depth - b.depth);
  const items: BreadcrumbItem[] = sorted.map((p, idx) => {
    const label = (lang === "en" ? p.title_en || p.title_pl : p.title_pl || p.title_en) || p.slug;
    const isLast = !postTitle && idx === sorted.length - 1;
    return { label, href: isLast ? undefined : `/${p.full_path}` };
  });
  if (postTitle) items.push({ label: postTitle });
  return items;
}

export function breadcrumbJsonLd(items: BreadcrumbItem[], origin: string): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.label,
      item: it.href ? `${origin}${it.href}` : undefined,
    })),
  });
}
