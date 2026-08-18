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
import { formatDateShort } from "@/lib/i18n/format";

// `sizes` okładek mieszka w lib/cardImageSizes (wspólne z preloadem LCP w
// head() tras archiwów - parytet preload<->render jest strukturalny).
import { CARD_IMAGE_SIZES } from "@/lib/cardImageSizes";
import { SponsoredBadge } from "@/components/post/SponsoredBadge";

// Minimalny, dwujęzyczny kształt danych karty. `BlogListItem` jest z nim
// strukturalnie zgodny, więc można przekazać go wprost.
interface PostCardData {
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  // Oznaczenie komercyjne jest WYMAGANE, nie opcjonalne.
  //
  // Pierwsza wersja miała tu `?:`, żeby nie ruszać istniejących wywołań - i to
  // był błąd tej samej klasy, którą ta funkcja ma zamykać: gdy pole jest
  // opcjonalne, zapytanie, które zapomni je wybrać, KOMPILUJE SIĘ, a karta
  // renderuje sponsorowany materiał bez oznaczenia. Cicho, bez żadnego sygnału.
  // Dokładnie tak zostały bez badge'a `ArchiveListing` i lista zapisanych
  // („reading-list"), choć obie wołają tę kartę.
  //
  // Oznaczenie pozycji w zestawieniu jest obowiązkiem (UPNPR art. 7 pkt 11a),
  // więc „prawie wszędzie" nie jest stanem dopuszczalnym. Typ wymagany zamienia
  // ten defekt w błąd kompilacji: KAŻDE zapytanie produkujące kartę musi te
  // kolumny wybrać, a nowe miejsce wywołania nie ma jak o nich zapomnieć.
  // `null` jest dozwolony (kolumna nullable), brak POLA - nie.
  is_sponsored: boolean | null;
  sponsored_kind: string | null;
  sponsored_affiliate: boolean | null;
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
  /** `sizes` okładki - karta wyróżniona przekazuje FEATURED_CARD_IMAGE_SIZES. */
  imageSizes?: string;
  /** Wariant linku opakowującego kartę. */
  link?: "router" | "app";
  /** Subtelny zoom okładki na hover (jak w archiwach). */
  imageZoom?: boolean;
  /**
   * Id wpisu dla morph-przejścia okładki (View Transitions API): karta i
   * strona artykułu dostają tę samą nazwę `post-cover-<id>`, więc nawigacja
   * płynnie "przenosi" okładkę z listy do nagłówka wpisu.
   */
  viewTransitionId?: string;
  /** Zamiennik excerptu (np. snippet trafienia wyszukiwarki z <mark>). */
  excerptOverride?: React.ReactNode;
}

export function PostListCard({
  post,
  href,
  lang,
  titleClassName = "text-xl",
  priority = false,
  imageSizes = CARD_IMAGE_SIZES,
  link = "router",
  imageZoom = true,
  viewTransitionId,
  excerptOverride,
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
          sizes={imageSizes}
          priority={priority}
          style={
            viewTransitionId ? { viewTransitionName: `post-cover-${viewTransitionId}` } : undefined
          }
        />
      )}
      <div className="p-5">
        {/* Oznaczenie NAD tytułem, nie pod datą: czytelnik ma je zobaczyć razem
            z nagłówkiem, na którego podstawie decyduje o kliknięciu (UPNPR
            art. 7 pkt 11a + art. 7 ust. 2 - informacja „nieczasowa" to wada). */}
        <SponsoredBadge post={post} lang={lang} className="mb-2" />
        <h2 className={`font-display mb-2 line-clamp-2 ${titleClassName}`}>{title}</h2>
        {excerptOverride ? (
          <p className="text-sm text-muted-foreground line-clamp-3">{excerptOverride}</p>
        ) : (
          excerpt && <p className="text-sm text-muted-foreground line-clamp-3">{excerpt}</p>
        )}
        {post.published_at && (
          <time className="block mt-3 text-xs text-muted-foreground">
            {formatDateShort(post.published_at, lang)}
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
