// Shared body composition: sort/pagination bar + grid + optional sidebar + extras.
import { useTranslation } from "react-i18next";
import { PostListCard } from "@/components/molecules/PostListCard";
import { FEATURED_CARD_IMAGE_SIZES } from "@/lib/cardImageSizes";
import { FooterSlideup } from "@/components/ads/FooterSlideup";
import { useInFeedAds } from "@/components/ads/useInFeedAds";
import { ArchivePosts } from "./ArchivePosts";
import { ArchiveSidebar } from "./ArchiveSidebar";
import { ArchiveToolbar } from "./ArchiveToolbar";
import { ArchivePagination } from "./ArchivePagination";
import { RelatedTaxonomyChips } from "./RelatedTaxonomyChips";
import { useRelatedTaxonomies } from "./useRelatedTaxonomies";
import { archiveBodyPlan } from "@/lib/archive/bodyPlan";
import type { ArchiveLayoutProps } from "./types";

export function ArchiveBody(props: ArchiveLayoutProps) {
  const {
    settings,
    posts,
    lang,
    taxonomy,
    kind,
    page,
    pageSize,
    total,
    sort,
    onPageChange,
    onSortChange,
    hrefFor,
    isPending,
    emptyText,
    extraBelow,
    previewMode,
    hasCustomFeaturedTop,
  } = props;
  const { t } = useTranslation();
  // Decyzje układu (karta wyróżniona, podział wpisów, liczba stron, sidebar)
  // mieszkają w `lib/archive/bodyPlan.ts` i mają tam własne asercje.
  const plan = archiveBodyPlan({
    settings,
    posts,
    total,
    pageSize,
    hasCustomFeaturedTop,
    previewMode,
  });
  const {
    featured,
    showFeaturedTop: showGenericFeatured,
    gridPosts,
    totalPages,
    withSidebar,
    sidebarLeft,
  } = plan;

  // Reklamy in-feed dla archiwów taksonomii (typ strony = kind: category/tag).
  // W podglądzie admina nie emitujemy niczego - zero beaconów i fetchy reklam.
  const inFeed = useInFeedAds(kind, taxonomy.id);
  const renderAfterCard = plan.withAds ? inFeed : undefined;

  const grid = (
    <div className="min-w-0 flex-1">
      {showGenericFeatured && featured && (
        <div className="mb-8 rounded-2xl overflow-hidden border border-border bg-card">
          {/* Karta wyróżniona to kandydat LCP archiwum: eager + high priority
              oraz `sizes` odpowiadające realnej (~800 px) szerokości renderu -
              dziedziczone 360 px dawało rozmytą, upscalowaną okładkę. */}
          <PostListCard
            post={featured}
            href={featured.href}
            lang={lang}
            priority
            imageSizes={FEATURED_CARD_IMAGE_SIZES}
            viewTransitionId={featured.id}
          />
        </div>
      )}
      <ArchiveToolbar
        lang={lang}
        total={total}
        page={page}
        pageSize={pageSize}
        sort={sort}
        onSortChange={onSortChange}
        isPending={isPending}
        disabled={!!previewMode}
      />
      <ArchivePosts
        posts={gridPosts}
        lang={lang}
        settings={settings}
        emptyText={emptyText}
        renderAfterCard={renderAfterCard}
        // Bez karty wyróżnionej (tu ani w wariancie Magazine) kandydatem LCP
        // jest pierwsza karta siatki - wtedy to ona dostaje eager + high.
        firstCardPriority={plan.firstCardPriority}
      />
      {plan.showPagination && (
        <div className="pt-8">
          <ArchivePagination
            page={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
            hrefFor={previewMode ? undefined : hrefFor}
            isPending={isPending}
            lang={lang}
            disabled={!!previewMode}
            t={t}
          />
        </div>
      )}
      {plan.showRelated && (
        <RelatedTaxonomiesBlock
          kind={kind}
          taxonomyId={taxonomy.id}
          lang={lang}
          previewMode={!!previewMode}
        />
      )}
      {extraBelow}
    </div>
  );

  const sidebar = withSidebar ? (
    <div className="w-full lg:w-[320px] shrink-0">
      <ArchiveSidebar
        widgets={settings.sidebar_widgets}
        lang={lang}
        taxonomyId={taxonomy.id}
        kind={kind}
        posts={posts}
        previewMode={!!previewMode}
      />
    </div>
  ) : null;

  // Slide-up stopki dla archiwów taksonomii - poza podglądem admina.
  const slideup = plan.withAds ? <FooterSlideup pageType={kind} pageId={taxonomy.id} /> : null;

  if (!withSidebar)
    return (
      <>
        {grid}
        {slideup}
      </>
    );
  return (
    <>
      <div className="flex flex-col lg:flex-row gap-8">
        {sidebarLeft ? sidebar : null}
        {grid}
        {sidebarLeft ? null : sidebar}
      </div>
      {slideup}
    </>
  );
}

function RelatedTaxonomiesBlock({
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
  const title =
    lang === "en"
      ? kind === "category"
        ? "Related categories"
        : "Related tags"
      : kind === "category"
        ? "Powiązane kategorie"
        : "Powiązane tagi";

  // Ranking ze współwystępowania na opublikowanych wpisach (wspólny z widżetem
  // sidebara - jeden wpis cache); w podglądzie admina atrapa bez fetchu.
  const items = useRelatedTaxonomies(kind, taxonomyId, lang, previewMode);
  if (items.length === 0) return null;

  return (
    <section className="pt-10 mt-10 border-t border-border">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
        {title}
      </h2>
      <RelatedTaxonomyChips items={items} kind={kind} lang={lang} previewMode={previewMode} />
    </section>
  );
}
