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
import type { ReadingPanelSettings, SidebarWidget } from "@/lib/sidebarBuilder/types";
import type { RelatedPostsOverride } from "@/lib/relatedPosts/config";
import { DEFAULT_READING_PANEL_SETTINGS } from "@/lib/sidebarBuilder/types";
import { FloatingShareBar } from "@/components/share/FloatingShareBar";
import { AuthorBusinessCard } from "@/components/post/AuthorBusinessCard";

// Heavier widgets are lazy-imported so the sidebar bundle stays small.
const RelatedPosts = lazy(() =>
  import("@/components/post/RelatedPosts").then((m) => ({ default: m.RelatedPosts })),
);
const NewsletterForm = lazy(() =>
  import("@/components/NewsletterForm").then((m) => ({ default: m.NewsletterForm })),
);
const AdZone = lazy(() => import("@/components/AdSlot").then((m) => ({ default: m.AdZone })));

export interface PostSidebarRendererProps {
  postId: string;
  postTitle: string;
  lang: "pl" | "en";
  tags?: Array<{ slug: string; name: string }>;
  /**
   * Kontekst targetingu reklam (slugi kategorii/tagów posta) - bez niego slot
   * z targetingiem treściowym nie wyemituje się w sidebarze.
   */
  adContent?: { categorySlugs?: string[]; tagSlugs?: string[] };
  /** Optional override layout id stored on the post. */
  layoutId?: string | null;
  /** Metadane odsłuchu - jeśli obecne, w readingu pojawi się widget audio TTS. */
  listen?: {
    postId: string;
    title: string;
    author?: string | null;
    authorId?: string | null;
    authorHref?: string | null;
    authorAvatarUrl?: string | null;
    authorJobTitle?: string | null;
    authorCompany?: string | null;
    authorBio?: string | null;
    authorEmail?: string | null;
    authorXUrl?: string | null;
    authorLinkedinUrl?: string | null;
    authorFacebookUrl?: string | null;
    authorInstagramUrl?: string | null;
    authorWebsiteUrl?: string | null;
    authorSpotifyUrl?: string | null;
    authorCustomSocials?: Array<{ label: string; url: string; iconUrl?: string }> | null;
    readMinutes?: number | null;
    /** Wgrany MP3 dla bieżącego języka - gdy podany, TTS jest pomijany. */
    audioUrl?: string | null;
  } | null;
  /**
   * Tryb czytania: gdy spis treści renderuje się w TREŚCI wpisu (showInBody),
   * panel czytania nie pokazuje swojej kopii - strona ma dokładnie jeden TOC.
   */
  suppressToc?: boolean;
  /** Tryb czytania: strefa sidebar wypadła z budżetu reklam - widget ad-slot milczy. */
  suppressAds?: boolean;
  /**
   * Nadpisanie konfiguracji rekomendacji zapisane NA WPISIE (`related_override`).
   *
   * Musi być tym SAMYM obiektem, który dostaje mount pod treścią - widget
   * sidebara i widget końca wpisu liczą to samo zapytanie, więc rozjazd
   * konfiguracji rozszczepia klucz cache i każe policzyć całą listę dwa razy
   * na jednej stronie. Wcześniej sidebar po prostu ignorował nadpisania wpisu.
   */
  relatedOverride?: RelatedPostsOverride | null;
}

export function PostSidebarRenderer(props: PostSidebarRendererProps) {
  const overrideQuery = useQuery(sidebarLayoutByIdQueryOptions(props.layoutId));
  const defaultQuery = useQuery({
    ...defaultSidebarLayoutQueryOptions(),
    // Układ per wpis, którego nie widać (odczyt publiczny jest zawężony do
    // tenanta, więc obcy układ wraca jako null, nie błąd), też oddaje głos
    // domyślnemu układowi tenanta - zamiast twardego układu awaryjnego.
    enabled:
      !props.layoutId ||
      overrideQuery.isError ||
      (overrideQuery.isSuccess && overrideQuery.data === null),
  });

  const layout = overrideQuery.data ?? defaultQuery.data ?? buildFallbackLayout();

  const visible = layout.widgets.filter((w) => !w.hidden);
  // Jedna wizytówka autora na stronę: panel czytania renderuje ją sam pod
  // odsłuchem, więc widget karty mówi tylko wtedy, gdy panelu nie ma - i tylko
  // pierwszy z nich (dwie identyczne karty to dwa przyciski „Obserwuj").
  const authorCardWidgetId = visible.some((w) => w.type === "reading-panel")
    ? null
    : (visible.find((w) => w.type === "author-card")?.id ?? null);

  return (
    <div className="flex flex-col gap-4">
      {visible.map((w) => (
        <WidgetView key={w.id} widget={w} authorCardWidgetId={authorCardWidgetId} {...props} />
      ))}
    </div>
  );
}

function WidgetView(
  props: { widget: SidebarWidget; authorCardWidgetId: string | null } & PostSidebarRendererProps,
) {
  const { widget, postId, postTitle, lang, tags, listen, adContent, suppressToc, suppressAds } =
    props;
  switch (widget.type) {
    case "reading-panel": {
      const cfg: ReadingPanelSettings = {
        ...DEFAULT_READING_PANEL_SETTINGS,
        ...(widget.settings as Partial<ReadingPanelSettings>),
        social: {
          ...DEFAULT_READING_PANEL_SETTINGS.social,
          ...((widget.settings as Partial<ReadingPanelSettings>)?.social ?? {}),
        },
        // Gwarancja jednego TOC: kopia w treści wygrywa z kopią w panelu.
        ...(suppressToc ? { showToc: false } : null),
      };
      return (
        <FloatingShareBar
          title={postTitle}
          entityId={postId}
          entityType="post"
          lang={lang}
          variant="sidebar"
          settings={cfg}
          listen={listen ?? null}
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
          <h3 className="cms-widget-kicker font-extrabold tracking-[0.18em] mb-3">
            {lang === "pl" ? "TAGI" : "TAGS"}
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <li key={tag.slug}>
                <a
                  href={`/tag/${tag.slug}`}
                  className="cms-widget-label inline-flex items-center px-2 py-1 rounded-[5px] border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition"
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
      // Dane autora niesie już wpis (`listen`) - bez osobnego zapytania. Brak
      // autora = brak widgetu, nie pusta ramka.
      if (!listen?.author || widget.id !== props.authorCardWidgetId) return null;
      return (
        <AuthorBusinessCard
          lang={lang}
          name={listen.author}
          authorId={listen.authorId ?? null}
          avatarUrl={listen.authorAvatarUrl}
          href={listen.authorHref}
          jobTitle={listen.authorJobTitle}
          company={listen.authorCompany}
          email={listen.authorEmail}
          xUrl={listen.authorXUrl}
          linkedinUrl={listen.authorLinkedinUrl}
          facebookUrl={listen.authorFacebookUrl}
          instagramUrl={listen.authorInstagramUrl}
          websiteUrl={listen.authorWebsiteUrl}
          spotifyUrl={listen.authorSpotifyUrl}
          customSocials={listen.authorCustomSocials}
        />
      );
    }
    case "related-posts": {
      return (
        <Suspense fallback={null}>
          <RelatedPosts
            postId={postId}
            lang={lang}
            override={props.relatedOverride}
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
      if (suppressAds) return null;
      return (
        <Suspense fallback={null}>
          <AdZone
            position="sidebar"
            pageType="post"
            pageId={postId}
            content={adContent ?? { tagSlugs: (tags ?? []).map((tg) => tg.slug) }}
          />
        </Suspense>
      );
    }
    default:
      return null;
  }
}
