// Sidebar for archive layouts: renders widgets in configured order.
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import type { SidebarWidgetKey } from "@/lib/archive-layout-settings";
import type { BlogListItem } from "@/lib/queries/public";
import { NewsletterForm } from "@/components/NewsletterForm";
import { AdZone } from "@/components/AdSlot";
import { RelatedTaxonomyChips } from "./RelatedTaxonomyChips";
import { useRelatedTaxonomies } from "./useRelatedTaxonomies";

interface Props {
  widgets: SidebarWidgetKey[];
  lang: "pl" | "en";
  taxonomyId: string;
  kind: "category" | "tag";
  posts: readonly BlogListItem[];
  /** Podgląd w panelu admina: atrapy zamiast zapytań do bazy. */
  previewMode?: boolean;
}

export function ArchiveSidebar({ widgets, lang, taxonomyId, kind, posts, previewMode }: Props) {
  return (
    <aside className="space-y-6">
      {widgets.map((w) => (
        <WidgetHost
          key={w}
          widget={w}
          lang={lang}
          taxonomyId={taxonomyId}
          kind={kind}
          posts={posts}
          previewMode={!!previewMode}
        />
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
  previewMode,
}: {
  widget: SidebarWidgetKey;
  lang: "pl" | "en";
  taxonomyId: string;
  kind: "category" | "tag";
  posts: readonly BlogListItem[];
  previewMode: boolean;
}) {
  const { t } = useTranslation();
  const title = t(`archiveLayout.sidebarTitles.${widget}`);
  return (
    <section className="rounded-xl border border-border bg-card/60 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        {title}
      </h2>
      {widget === "popular" && <PopularList posts={posts} lang={lang} />}
      {widget === "related" && (
        <RelatedTaxonomies
          kind={kind}
          taxonomyId={taxonomyId}
          lang={lang}
          previewMode={previewMode}
        />
      )}
      {widget === "newsletter" && (
        <NewsletterForm lang={lang} source="archive-sidebar" variant="inline" />
      )}
      {widget === "ads" && <AdZone position="sidebar" pageType={kind} pageId={taxonomyId} />}
    </section>
  );
}

function PopularList({ posts, lang }: { posts: readonly BlogListItem[]; lang: "pl" | "en" }) {
  const top = posts.slice(0, 5);
  if (top.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {lang === "en" ? "No posts." : "Brak wpisów."}
      </p>
    );
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
  previewMode,
}: {
  kind: "category" | "tag";
  taxonomyId: string;
  lang: "pl" | "en";
  previewMode: boolean;
}) {
  // Ten sam ranking i ten sam wpis cache co sekcja pod listą (`ArchiveBody`).
  const items = useRelatedTaxonomies(kind, taxonomyId, lang, previewMode);
  if (items.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {lang === "en" ? "Nothing to show." : "Brak."}
      </p>
    );
  return <RelatedTaxonomyChips items={items} kind={kind} lang={lang} previewMode={previewMode} />;
}
