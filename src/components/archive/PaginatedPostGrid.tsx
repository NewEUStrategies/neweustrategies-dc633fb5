// Atomic-design "organism": paginowana siatka wpisów. Składa molekuły listy
// (ArchivePostList - siatka kart + spójny empty state) i paginacji
// (ArchivePagination - indeksowalne <a href> + prev/next) w JEDEN układ,
// współdzielony przez stronę główną w trybie "najnowsze wpisy" i archiwum
// /blog. Dotąd obie trasy utrzymywały własne kopie tej kompozycji (siatka,
// wstawki in-feed, scroll-to-top, pasek stron) - każda poprawka wymagała
// dwóch synchronicznych edycji.
//
// Nawigacja zostaje po stronie trasy (onPageChange/hrefFor) - organizm nie
// zna adresów ani search params, więc działa pod dowolnym URL-em i nie
// zaciąga generyków routera do współdzielonego chunka.
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArchivePostList } from "@/components/archive/ArchivePostList";
import { ArchivePagination } from "@/components/archive/layouts/ArchivePagination";
import type { BlogListItem } from "@/lib/queries/public";

interface PaginatedPostGridProps {
  posts: readonly BlogListItem[];
  /** Bieżąca strona (1-indeksowana) - zgodna z parsePageSearch i loaderem. */
  page: number;
  totalPages: number;
  lang: "pl" | "en";
  emptyText: string;
  /** Opcjonalna akcja pod komunikatem pustej listy (np. link powrotny). */
  emptyAction?: React.ReactNode;
  /** Stan przejścia nawigacji (useTransition w trasie) - blokuje kontrolki. */
  isPending: boolean;
  onPageChange: (page: number) => void;
  /** Realny href strony wyników (z prefiksem języka) - podstawa
   *  indeksowalnej paginacji, patrz ArchivePagination. */
  hrefFor: (page: number) => string;
  /** Wstawki in-feed "co N kart" (useInFeedAds) - render PO karcie o indeksie. */
  renderAfterCard?: (index: number) => React.ReactNode;
  titleClassName?: string;
  /** Pierwsza karta jako kandydat LCP - tylko listy above-the-fold. */
  firstCardPriority?: boolean;
}

export function PaginatedPostGrid({
  posts,
  page,
  totalPages,
  lang,
  emptyText,
  emptyAction,
  isPending,
  onPageChange,
  hrefFor,
  renderAfterCard,
  titleClassName = "text-base",
  firstCardPriority = true,
}: PaginatedPostGridProps) {
  const { t } = useTranslation();

  // Zmiana strony wraca na górę listy - pozostanie w połowie ekranu po
  // podmianie treści dezorientuje (ten sam wzorzec co TaxonomyPage).
  useEffect(() => {
    if (typeof window !== "undefined" && page > 1) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [page]);

  return (
    <>
      <ArchivePostList
        posts={posts}
        lang={lang}
        emptyText={emptyText}
        emptyAction={emptyAction}
        titleClassName={titleClassName}
        renderAfterCard={renderAfterCard}
        firstCardPriority={firstCardPriority}
      />
      {totalPages > 1 && (
        <div className="pt-8">
          <ArchivePagination
            page={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
            hrefFor={hrefFor}
            isPending={isPending}
            lang={lang}
            t={t}
          />
        </div>
      )}
    </>
  );
}
