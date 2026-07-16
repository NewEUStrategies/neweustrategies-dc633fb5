// Sidebar for archive layouts: renders widgets in configured order.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SidebarWidgetKey } from "@/lib/archive-layout-settings";
import type { BlogListItem } from "@/lib/queries/public";
import { NewsletterForm } from "@/components/NewsletterForm";
import { AdZone } from "@/components/AdSlot";

interface Props {
  widgets: SidebarWidgetKey[];
  lang: "pl" | "en";
  taxonomyId: string;
  kind: "category" | "tag";
  posts: readonly BlogListItem[];
}

export function ArchiveSidebar({ widgets, lang, taxonomyId, kind, posts }: Props) {
  return (
    <aside className="space-y-6">
      {widgets.map((w) => (
        <WidgetHost key={w} widget={w} lang={lang} taxonomyId={taxonomyId} kind={kind} posts={posts} />
      ))}
    </aside>
  );
}

function WidgetHost({
  widget,
  lang,
  taxonomyId,
  kind,
  posts,
}: {
  widget: SidebarWidgetKey;
  lang: "pl" | "en";
  taxonomyId: string;
  kind: "category" | "tag";
  posts: readonly BlogListItem[];
}) {
  const { t } = useTranslation();
  const title = t(`archiveLayout.sidebarTitles.${widget}`);
  return (
    <section className="rounded-xl border border-border bg-card/60 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        {title}
      </h2>
      {widget === "popular" && <PopularList posts={posts} lang={lang} />}
      {widget === "related" && <RelatedTaxonomies kind={kind} taxonomyId={taxonomyId} lang={lang} />}
      {widget === "newsletter" && <NewsletterForm lang={lang} source="archive-sidebar" variant="inline" />}
      {widget === "ads" && <AdZone position="sidebar" pageType={kind} pageId={taxonomyId} />}
    </section>
  );
}

function PopularList({ posts, lang }: { posts: readonly BlogListItem[]; lang: "pl" | "en" }) {
  const top = posts.slice(0, 5);
  if (top.length === 0)
    return <p className="text-sm text-muted-foreground">{lang === "en" ? "No posts." : "Brak wpisów."}</p>;
  return (
    <ul className="space-y-3">
      {top.map((p) => (
        <li key={p.id}>
          <Link to={p.href} className="text-sm hover:text-brand line-clamp-2 font-medium">
            {lang === "en" ? p.title_en || p.title_pl : p.title_pl || p.title_en}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function RelatedTaxonomies({
  kind,
  taxonomyId,
  lang,
}: {
  kind: "category" | "tag";
  taxonomyId: string;
  lang: "pl" | "en";
}) {
  const { data } = useQuery({
    queryKey: ["archive-related", kind, taxonomyId],
    queryFn: async () => {
      if (kind === "category") {
        const { data } = await supabase
          .from("categories")
          .select("id, slug, name_pl, name_en")
          .neq("id", taxonomyId)
          .limit(10);
        return data ?? [];
      }
      const { data } = await supabase.from("tags").select("id, slug, name").neq("id", taxonomyId).limit(10);
      return (data ?? []).map((t) => ({ id: t.id, slug: t.slug, name_pl: t.name, name_en: t.name }));
    },
    staleTime: 5 * 60_000,
  });
  const items = data ?? [];
  if (items.length === 0)
    return <p className="text-sm text-muted-foreground">{lang === "en" ? "Nothing to show." : "Brak."}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => (
        <Link
          key={it.id}
          to={kind === "category" ? "/category/$slug" : "/tag/$slug"}
          params={{ slug: it.slug }}
          className="px-3 py-1 rounded-full border border-border text-xs hover:bg-muted transition"
        >
          {lang === "en" ? it.name_en || it.name_pl : it.name_pl || it.name_en}
        </Link>
      ))}
    </div>
  );
}
