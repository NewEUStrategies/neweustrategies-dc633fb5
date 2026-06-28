// Atomic-design "molecule": karta wpisu na publicznych listach (blog, wyniki
// wyszukiwania, archiwa). Składa atom <OptimizedImage> (responsywny cover przez
// transform Supabase Storage) z tytułem/leadem/datą i opakowuje całość w jeden
// router-Link (duży obszar kliknięcia). Dwujęzyczna (PL/EN) przez `lang`.
import { Link } from "@tanstack/react-router";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import type { BlogListItem } from "@/lib/queries/public";

// Karty renderują się w siatce 1/2/3 kolumny w kontenerze max 1200px.
const CARD_IMAGE_SIZES = "(min-width: 1024px) 360px, (min-width: 768px) 45vw, 92vw";

interface PostListCardProps {
  post: BlogListItem;
  lang: "pl" | "en";
  /** Klasa tytułu - mniejszy na gęstszych listach (np. blog: "text-base"). */
  titleClassName?: string;
  /** Oznacz cover jako LCP (eager + wysoki priorytet) - tylko pierwsza karta. */
  priority?: boolean;
}

export function PostListCard({
  post,
  lang,
  titleClassName = "text-xl",
  priority = false,
}: PostListCardProps) {
  const title = lang === "en" ? post.title_en || post.title_pl : post.title_pl || post.title_en;
  const excerpt = lang === "en" ? post.excerpt_en : post.excerpt_pl;

  return (
    <Link
      to={post.href as "/"}
      className="bg-card border border-border rounded-lg overflow-hidden hover:border-brand transition"
    >
      {post.cover_image_url && (
        <OptimizedImage
          src={post.cover_image_url}
          alt={title}
          className="w-full h-44 object-cover"
          responsive
          sizes={CARD_IMAGE_SIZES}
          priority={priority}
        />
      )}
      <div className="p-5">
        <h2 className={`font-display mb-2 line-clamp-2 ${titleClassName}`}>{title}</h2>
        {excerpt && <p className="text-sm text-muted-foreground line-clamp-3">{excerpt}</p>}
        {post.published_at && (
          <time className="block mt-3 text-xs text-muted-foreground">
            {new Date(post.published_at).toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL")}
          </time>
        )}
      </div>
    </Link>
  );
}

export default PostListCard;
