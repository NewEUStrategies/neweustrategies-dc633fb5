// Atomic-design "molecule": karta wpisu na publicznych listach (blog, wyniki
// wyszukiwania, archiwa). Składa atom <OptimizedImage> (responsywny cover przez
// transform Supabase Storage) z tytułem/leadem/datą i opakowuje całość w jeden
// link. Dwujęzyczna (PL/EN) przez `lang`.
//
// Wariant linku:
//   - "router" (domyślny): TanStack <Link> - całokartowa nawigacja SPA,
//   - "app": <AppLink> - zachowuje semantykę SPA z atomu AppLink (preload,
//     ten sam komponent, którego używają archiwa).
import { Link } from "@tanstack/react-router";
import { AppLink } from "@/components/atoms/AppLink";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";

// Karty renderują się w siatce 1/2/3 kolumny w kontenerze max 1200px.
const CARD_IMAGE_SIZES = "(min-width: 1024px) 360px, (min-width: 768px) 45vw, 92vw";

// Minimalny, dwujęzyczny kształt danych karty. `BlogListItem` jest z nim
// strukturalnie zgodny, więc można przekazać go wprost.
export interface PostCardData {
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
}

interface PostListCardProps {
  post: PostCardData;
  /** Docelowy href (np. p.href albo policzona ścieżka archiwum). */
  href: string;
  lang: "pl" | "en";
  /** Klasa tytułu - mniejszy na gęstszych listach (np. blog: "text-base"). */
  titleClassName?: string;
  /** Oznacz cover jako LCP (eager + wysoki priorytet) - tylko pierwsza karta. */
  priority?: boolean;
  /** Wariant linku opakowującego kartę. */
  link?: "router" | "app";
  /** Subtelny zoom okładki na hover (jak w archiwach). */
  imageZoom?: boolean;
}

export function PostListCard({
  post,
  href,
  lang,
  titleClassName = "text-xl",
  priority = false,
  link = "router",
  imageZoom = true,
}: PostListCardProps) {
  const title = lang === "en" ? post.title_en || post.title_pl : post.title_pl || post.title_en;
  const excerpt = lang === "en" ? post.excerpt_en : post.excerpt_pl;

  const cardClassName =
    "group block bg-card border border-border rounded-lg overflow-hidden hover:border-brand transition";
  const imageClassName = `w-full h-44 object-cover${
    imageZoom ? " transition-transform duration-500 group-hover:scale-105" : ""
  }`;

  const inner = (
    <>
      {post.cover_image_url && (
        <OptimizedImage
          src={post.cover_image_url}
          alt={title}
          className={imageClassName}
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
    </>
  );

  if (link === "app") {
    return (
      <AppLink href={href} className={cardClassName}>
        {inner}
      </AppLink>
    );
  }
  return (
    <Link to={href as "/"} className={cardClassName}>
      {inner}
    </Link>
  );
}

export default PostListCard;
