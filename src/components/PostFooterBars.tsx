// Stopka pojedynczego wpisu - pasek tagów / karta autora / paginacja prev-next.
// Każdy element renderuje się tylko gdy odpowiedni flag w settings jest true.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { PostLayoutSettings } from "@/lib/postLayouts";
import "@/lib/i18n-public";

interface AuthorInfo {
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
}

interface NeighborPost {
  slug: string;
  title: string;
  parent_path?: string;
}

interface Props {
  settings: PostLayoutSettings;
  /** Accepted for caller compatibility; UI copy now follows the i18n language. */
  lang: "pl" | "en";
  tags?: Array<{ slug: string; name: string }>;
  author?: AuthorInfo | null;
  prev?: NeighborPost | null;
  next?: NeighborPost | null;
}

export function PostFooterBars({ settings, tags, author, prev, next }: Props) {
  const { t } = useTranslation();
  const showTags = settings.show_post_tags_bar && tags && tags.length > 0;
  const showAuthor = settings.show_author_card && author;
  const showPrevNext = settings.show_prev_next && (prev || next);

  return (
    <div className="mt-10 space-y-6">
      {showTags && (
        <div className="flex items-center gap-2 flex-wrap border-t border-border pt-4">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("postFooter.tags")}
          </span>
          {tags!.map((t) => (
            <span key={t.slug} className="text-xs px-2 py-1 rounded bg-muted">
              #{t.name}
            </span>
          ))}
        </div>
      )}

      {showAuthor && (
        <div className="border-t border-border pt-6 flex items-start gap-4">
          {author!.avatar_url && (
            <img
              src={author!.avatar_url}
              alt={author!.display_name ?? "Author"}
              className="w-16 h-16 rounded-full object-cover shrink-0"
              loading="lazy"
            />
          )}
          <div>
            <p className="font-display text-lg">{author!.display_name ?? "Author"}</p>
            {author!.bio && <p className="text-sm text-muted-foreground mt-1">{author!.bio}</p>}
          </div>
        </div>
      )}

      {showPrevNext && (
        <nav
          aria-label={t("postFooter.postNavigation")}
          className={`grid md:grid-cols-2 gap-4 border-t border-border pt-6 ${
            settings.prev_next_mobile_hide ? "hidden md:grid" : ""
          }`}
        >
          {prev ? (
            <Link
              to="/$"
              params={{ _splat: `${prev.parent_path ?? ""}/${prev.slug}`.replace(/^\//, "") }}
              preload="viewport"
              className="block p-4 rounded border border-border hover:bg-muted/40 transition"
            >
              <span className="text-xs text-muted-foreground">{t("postFooter.previous")}</span>
              <p className="text-sm font-medium mt-1">{prev.title}</p>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              to="/$"
              params={{ _splat: `${next.parent_path ?? ""}/${next.slug}`.replace(/^\//, "") }}
              preload="viewport"
              className="block p-4 rounded border border-border hover:bg-muted/40 transition text-right"
            >
              <span className="text-xs text-muted-foreground">{t("postFooter.next")}</span>
              <p className="text-sm font-medium mt-1">{next.title}</p>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
