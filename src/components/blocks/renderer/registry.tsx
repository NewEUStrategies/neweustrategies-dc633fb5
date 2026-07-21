// Rejestr rendererów bloków + dyspozytor (BlockView).
//
// Monolityczny `switch` zastąpiono totalną mapą `Record<BlockType,
// BlockRenderer>`. Totalność jest gwarantowana przez TypeScript: pominięcie
// któregokolwiek typu bloku albo dodanie klucza spoza `BlockType` to błąd
// kompilacji - dzięki temu nie da się "zgubić" typu bloku przy refaktorze
// (odpowiednik dawnego `default: return null`, ale wymuszony na etapie typów).

import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import type { Block, BlockType } from "@/lib/blocks/types";
import type { BlockLang, BlockRenderContext, BlockRenderer } from "./context";
import { alignClass } from "./data";
import {
  renderButton,
  renderCallout,
  renderHeading,
  renderHtml,
  renderList,
  renderPageBreak,
  renderParagraph,
  renderPreformatted,
  renderPullquote,
  renderQuote,
  renderReadMore,
  renderSeparator,
  renderSpacer,
  renderVerse,
} from "./atoms";
import {
  renderAccordion,
  renderAffiliate,
  renderAlertBanner,
  renderAudio,
  renderBannerImage,
  renderButtons,
  renderChart,
  renderCode,
  renderCompare,
  renderComparisonTable,
  renderContactForm,
  renderCover,
  renderCtaSection,
  renderDataMap,
  renderDetails,
  renderDividerText,
  renderEmbed,
  renderFaq,
  renderFeatureGrid,
  renderFile,
  renderGallery,
  renderHero,
  renderIconBox,
  renderImage,
  renderImageCarousel,
  renderLogoGrid,
  renderLoginForm,
  renderLostPasswordForm,
  renderMap,
  renderMediaText,
  renderNewsletter,
  renderPricingTable,
  renderProgress,
  renderProsCons,
  renderRegisterForm,
  renderResetPasswordForm,
  renderReview,
  renderSearch,
  renderSocialIcons,
  renderSpoiler,
  renderStatsCounter,
  renderStepList,
  renderTable,
  renderTabs,
  renderTeamGrid,
  renderTestimonials,
  renderTimeline,
  renderToc,
  renderVideo,
  renderVideoHero,
  renderXQuote,
  renderCountdown,
} from "./molecules";
import {
  renderArchives,
  renderAuthorBio,
  renderBreadcrumbs,
  renderCalendar,
  renderCategoriesList,
  renderColumns,
  renderGroup,
  renderLatestPosts,
  renderLiveblog,
  renderLoginOut,
  renderMorePosts,
  renderNavigation,
  renderPoll,
  renderPostAuthor,
  renderPostDate,
  renderPostExcerpt,
  renderPostFeaturedImage,
  renderPostNavigationLink,
  renderPostRating,
  renderPostStats,
  renderPostTerms,
  renderPostTitle,
  renderPostViews,
  renderQueryLoop,
  renderReadingTime,
  renderRelatedPosts,
  renderRowStackGrid,
  renderShareButtons,
  renderSiteLogo,
  renderSiteTagline,
  renderSiteTitle,
  renderTagCloud,
} from "./organisms";

/**
 * Totalna mapa typ bloku -> renderer. `Record<BlockType, BlockRenderer>`
 * wymusza kompletność na etapie kompilacji.
 */
export const BLOCK_RENDERERS: Record<BlockType, BlockRenderer> = {
  // atoms
  paragraph: renderParagraph,
  heading: renderHeading,
  list: renderList,
  quote: renderQuote,
  html: renderHtml,
  separator: renderSeparator,
  callout: renderCallout,
  button: renderButton,
  spacer: renderSpacer,
  "page-break": renderPageBreak,
  "read-more": renderReadMore,
  pullquote: renderPullquote,
  preformatted: renderPreformatted,
  verse: renderVerse,
  // molecules
  image: renderImage,
  code: renderCode,
  embed: renderEmbed,
  video: renderVideo,
  gallery: renderGallery,
  table: renderTable,
  audio: renderAudio,
  cover: renderCover,
  file: renderFile,
  "media-text": renderMediaText,
  buttons: renderButtons,
  "social-icons": renderSocialIcons,
  search: renderSearch,
  proscons: renderProsCons,
  spoiler: renderSpoiler,
  details: renderDetails,
  faq: renderFaq,
  toc: renderToc,
  newsletter: renderNewsletter,
  review: renderReview,
  affiliate: renderAffiliate,
  xquote: renderXQuote,
  compare: renderCompare,
  "login-form": renderLoginForm,
  "register-form": renderRegisterForm,
  "lost-password-form": renderLostPasswordForm,
  "reset-password-form": renderResetPasswordForm,
  accordion: renderAccordion,
  tabs: renderTabs,
  countdown: renderCountdown,
  progress: renderProgress,
  "icon-box": renderIconBox,
  "stats-counter": renderStatsCounter,
  testimonials: renderTestimonials,
  "pricing-table": renderPricingTable,
  timeline: renderTimeline,
  hero: renderHero,
  "cta-section": renderCtaSection,
  "image-carousel": renderImageCarousel,
  "contact-form": renderContactForm,
  map: renderMap,
  "team-grid": renderTeamGrid,
  "logo-grid": renderLogoGrid,
  "feature-grid": renderFeatureGrid,
  "alert-banner": renderAlertBanner,
  "divider-text": renderDividerText,
  "step-list": renderStepList,
  "comparison-table": renderComparisonTable,
  "banner-image": renderBannerImage,
  "video-hero": renderVideoHero,
  chart: renderChart,
  "data-map": renderDataMap,
  // organisms - kontenery
  columns: renderColumns,
  group: renderGroup,
  row: renderRowStackGrid,
  stack: renderRowStackGrid,
  grid: renderRowStackGrid,
  // organisms - dynamiczne / kontekst wpisu (tenant-scoped przez RLS)
  liveblog: renderLiveblog,
  poll: renderPoll,
  "latest-posts": renderLatestPosts,
  "tag-cloud": renderTagCloud,
  "categories-list": renderCategoriesList,
  archives: renderArchives,
  calendar: renderCalendar,
  "post-title": renderPostTitle,
  "post-date": renderPostDate,
  "post-author": renderPostAuthor,
  "post-excerpt": renderPostExcerpt,
  "post-featured-image": renderPostFeaturedImage,
  "post-terms": renderPostTerms,
  "site-title": renderSiteTitle,
  "site-tagline": renderSiteTagline,
  "site-logo": renderSiteLogo,
  navigation: renderNavigation,
  "post-navigation-link": renderPostNavigationLink,
  "query-loop": renderQueryLoop,
  breadcrumbs: renderBreadcrumbs,
  "reading-time": renderReadingTime,
  "share-buttons": renderShareButtons,
  "post-views": renderPostViews,
  "author-bio": renderAuthorBio,
  "related-posts": renderRelatedPosts,
  "post-stats": renderPostStats,
  "post-rating": renderPostRating,
  loginout: renderLoginOut,
  "more-posts": renderMorePosts,
};

export interface BlockViewProps {
  block: Block;
  fnHtml: ReadonlyMap<string, string>;
  lang?: BlockLang;
  postId?: string;
  allBlocks?: readonly Block[];
}

/**
 * Dyspozytor pojedynczego bloku. Jedyne miejsce, które woła hooki i liczy
 * wspólne wartości (widoczność, wyrównanie, tłumaczenia), po czym deleguje do
 * renderera z rejestru. Rekurencyjna bramka widoczności honoruje `style.hidden`
 * także dla bloków zagnieżdżonych w kolumnach / grupach / siatkach.
 */
export function BlockView({
  block,
  fnHtml,
  lang = "pl",
  postId,
  allBlocks,
}: BlockViewProps): ReactNode {
  const { t } = useTranslation();
  if (block.style?.hidden) return null;
  const list = allBlocks ?? [];
  const ctx: BlockRenderContext = {
    block,
    cls: alignClass(block),
    fnHtml,
    lang,
    postId,
    allBlocks: list,
    t,
    renderChild: (child) => (
      <BlockView
        key={child.id}
        block={child}
        fnHtml={fnHtml}
        lang={lang}
        postId={postId}
        allBlocks={list}
      />
    ),
  };
  return BLOCK_RENDERERS[block.type](ctx);
}
