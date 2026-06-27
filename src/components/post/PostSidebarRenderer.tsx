// Public renderer for a tenant's post sidebar layout.
// Reads either an override layout id from the post, or the tenant default,
// then dispatches each widget to its registered viewer component.
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy } from "react";
import {
  buildFallbackLayout,
  defaultSidebarLayoutQueryOptions,
  sidebarLayoutByIdQueryOptions,
} from "@/lib/queries/sidebarLayouts";
import type {
  ReadingPanelSettings,
  SidebarWidget,
} from "@/lib/sidebarBuilder/types";
import { DEFAULT_READING_PANEL_SETTINGS } from "@/lib/sidebarBuilder/types";
import { FloatingShareBar } from "@/components/share/FloatingShareBar";

// Heavier widgets are lazy-imported so the sidebar bundle stays small.
const RelatedPosts = lazy(() =>
  import("@/components/post/RelatedPosts").then((m) => ({ default: m.RelatedPosts })),
);
const NewsletterForm = lazy(() =>
  import("@/components/NewsletterForm").then((m) => ({ default: m.NewsletterForm })),
);
const AdZone = lazy(() =>
  import("@/components/AdSlot").then((m) => ({ default: m.AdZone })),
);

export interface PostSidebarRendererProps {
  postId: string;
  postTitle: string;
  lang: "pl" | "en";
  tags?: Array<{ slug: string; name: string }>;
  /** Optional override layout id stored on the post. */
  layoutId?: string | null;
}

export function PostSidebarRenderer(props: PostSidebarRendererProps) {
  const overrideQuery = useQuery(sidebarLayoutByIdQueryOptions(props.layoutId));
  const defaultQuery = useQuery({
    ...defaultSidebarLayoutQueryOptions(),
    enabled: !props.layoutId || overrideQuery.isError,
  });

  const layout =
    overrideQuery.data ?? defaultQuery.data ?? buildFallbackLayout();

  const visible = layout.widgets.filter((w) => !w.hidden);

  return (
    <div className="flex flex-col gap-4">
      {visible.map((w) => (
        <WidgetView key={w.id} widget={w} {...props} />
      ))}
    </div>
  );
}

function WidgetView(
  props: { widget: SidebarWidget } & PostSidebarRendererProps,
) {
  const { widget, postId, postTitle, lang, tags } = props;
  switch (widget.type) {
    case "reading-panel": {
      const cfg: ReadingPanelSettings = {
        ...DEFAULT_READING_PANEL_SETTINGS,
        ...(widget.settings as Partial<ReadingPanelSettings>),
        social: {
          ...DEFAULT_READING_PANEL_SETTINGS.social,
          ...((widget.settings as Partial<ReadingPanelSettings>)?.social ?? {}),
        },
      };
      return (
        <FloatingShareBar
          title={postTitle}
          lang={lang}
          variant="sidebar"
          settings={cfg}
        />
      );
    }
    case "tags": {
      if (!tags || tags.length === 0) return null;
      return (
        <aside
          className="rounded-[5px] border border-border/70 bg-background/95 p-4"
          aria-label={lang === "pl" ? "Tagi" : "Tags"}
        >
          <h3 className="text-[11px] font-extrabold tracking-[0.18em] mb-3">
            {lang === "pl" ? "TAGI" : "TAGS"}
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <li key={tag.slug}>
                <a
                  href={`/tag/${tag.slug}`}
                  className="inline-flex items-center px-2 py-1 rounded-[5px] border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition"
                >
                  #{tag.name}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      );
    }
    case "author-card": {
      return (
        <aside className="rounded-[5px] border border-border/70 bg-background/95 p-4 text-sm text-muted-foreground">
          {lang === "pl" ? "Karta autora wkrótce." : "Author card coming soon."}
        </aside>
      );
    }
    case "related-posts": {
      return (
        <Suspense fallback={null}>
          <RelatedPosts
            postId={postId}
            lang={lang}
            forceLayout="list"
            forceColumns={2}
          />
        </Suspense>
      );
    }
    case "newsletter": {
      return (
        <Suspense fallback={null}>
          <NewsletterForm lang={lang} source="sidebar" variant="card" />
        </Suspense>
      );
    }
    case "ad-slot": {
      return (
        <Suspense fallback={null}>
          <AdZone position="sidebar" pageType="post" pageId={postId} />
        </Suspense>
      );
    }
    default:
      return null;
  }
}
