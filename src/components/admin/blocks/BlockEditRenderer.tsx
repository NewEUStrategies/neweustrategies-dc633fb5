// Dyspozytor komponentów EDYCJI bloków - jedno miejsce mapujące typ bloku na
// jego edytor w kanwie. Współdzielony przez kanwę główną (BlockCanvas) oraz
// edytory zagnieżdżeń (NestedBlocksEditor w group/columns), żeby dziecko
// kontenera miało dokładnie te same możliwości edycji co blok top-level.
//
// Nowy typ bloku = case tutaj + wpis w registry + renderer publiczny.

import type { Block } from "@/lib/blocks/types";
import type { SelectionDirection } from "@/lib/blocks/crossSelection";
import { GenericWidgetToolbar } from "./GenericWidgetToolbar";
import { ParagraphBlock } from "./edit/Paragraph";
import { HeadingBlock } from "./edit/Heading";
import { ImageBlock } from "./edit/Image";
import { ListBlockEdit } from "./edit/ListBlock";
import { QuoteBlock } from "./edit/Quote";
import { CodeBlock } from "./edit/Code";
import { EmbedBlock } from "./edit/Embed";
import { VideoBlock } from "./edit/Video";
import { GalleryBlock } from "./edit/Gallery";
import { SeparatorBlock } from "./edit/Separator";
import { CalloutBlock } from "./edit/Callout";
import { TableBlockEdit } from "./edit/Table";
import { ButtonBlock } from "./edit/Button";
import { ColumnsBlock } from "./edit/Columns";
import { HtmlBlock } from "./edit/Html";
import { ReviewBlock } from "./edit/Review";
import { ProsConsBlock } from "./edit/ProsCons";
import { SpoilerBlock } from "./edit/Spoiler";
import { FaqBlock } from "./edit/Faq";
import { TocBlock } from "./edit/Toc";
import { NewsletterBlock } from "./edit/Newsletter";
import { AffiliateBlock } from "./edit/Affiliate";
import { XQuoteBlock } from "./edit/XQuote";
import { CompareBlock } from "./edit/Compare";
import { LoginFormBlock } from "./edit/LoginForm";
import { RegisterFormBlock } from "./edit/RegisterForm";
import { LostPasswordFormBlock } from "./edit/LostPasswordForm";
import { ResetPasswordFormBlock } from "./edit/ResetPasswordForm";
import { AudioBlock } from "./edit/Audio";
import { CoverBlock } from "./edit/Cover";
import { FileBlock } from "./edit/File";
import { MediaTextBlock } from "./edit/MediaText";
import { GroupBlock } from "./edit/Group";
import { SpacerBlock } from "./edit/Spacer";
import { PageBreakBlock } from "./edit/PageBreak";
import { ReadMoreBlock } from "./edit/ReadMore";
import { LiveBlogBlock } from "./edit/LiveBlog";
import { PullquoteBlock } from "./edit/Pullquote";
import { PreformattedBlock } from "./edit/Preformatted";
import { VerseBlock } from "./edit/Verse";
import { DetailsBlock } from "./edit/Details";
import { ButtonsBlock } from "./edit/Buttons";
import { SocialIconsBlock } from "./edit/SocialIcons";
import { SearchBlock } from "./edit/Search";
import { LatestPostsBlock } from "./edit/LatestPosts";
import { TagCloudBlock } from "./edit/TagCloud";
import { CategoriesListBlock } from "./edit/CategoriesList";
import { ArchivesBlock } from "./edit/Archives";
import { CalendarBlock } from "./edit/Calendar";
import {
  PostTitleBlock,
  PostDateBlock,
  PostAuthorBlock,
  PostExcerptBlock,
  PostFeaturedImageBlock,
  PostTermsBlock,
  SiteTitleBlock,
  SiteTaglineBlock,
  SiteLogoBlock,
} from "./edit/ContextBlocks";
import { NavigationBlock, PostNavigationLinkBlock, QueryLoopBlock } from "./edit/NavLoopBlocks";
import {
  BreadcrumbsBlock,
  ReadingTimeBlock,
  ShareButtonsBlock,
  PostViewsBlock,
} from "./edit/PostUtilityBlocks";
import { AuthorBioBlock, RelatedPostsBlock } from "./edit/PostContextBlocks";
import {
  PostStatsBlock,
  PostRatingBlock,
  LoginOutBlock,
  MorePostsBlock,
} from "./edit/FoxizExtraBlocks";
import { AccordionBlock, TabsBlock, CountdownBlock, ProgressBlock } from "./edit/InteractiveBlocks";
import { PollBlockEdit } from "./edit/Poll";
import {
  IconBoxBlock,
  StatsCounterBlock,
  TestimonialsBlock,
  PricingTableBlock,
  TimelineBlock,
} from "./edit/PresentationBlocks";
import {
  HeroBlock,
  CtaSectionBlock,
  ImageCarouselBlock,
  ContactFormBlock,
  MapBlock,
} from "./edit/MarketingBlocks";
import {
  TeamGridBlock,
  LogoGridBlock,
  FeatureGridBlock,
  AlertBannerBlock,
  DividerTextBlock,
} from "./edit/DataSocialBlocks";
import {
  StepListBlock,
  ComparisonTableBlock,
  BannerImageBlock,
  VideoHeroBlock,
} from "./edit/ConversionBlocks";
import { ChartBlock, DataMapBlock } from "./edit/DataVizBlocks";

/** Bloki, które renderują własny wyspecjalizowany floating toolbar. */
const OWN_TOOLBAR_TYPES = new Set(["paragraph", "heading", "image", "video", "audio"]);

export function BlockWithToolbar({
  block,
  isActive,
  onChange,
  children,
}: {
  block: Block;
  isActive: boolean;
  onChange: (n: Block) => void;
  children: React.ReactNode;
}) {
  const hasOwn = OWN_TOOLBAR_TYPES.has(block.type);
  if (hasOwn) return <>{children}</>;
  return (
    <div className="relative">
      {isActive && <GenericWidgetToolbar block={block} onChange={onChange} />}
      {children}
    </div>
  );
}

export interface BlockEditRendererProps {
  block: Block;
  isActive: boolean;
  onChange: (n: Block) => void;
  onTransform: (replacement: Block[]) => void;
  onInsertAfter: (b: Block) => void;
  onDeleteEmpty: () => void;
  /** Scalenie z poprzednim blokiem (Backspace na początku treści). */
  onMergeWithPrevious: () => boolean;
  /** Fokus na poprzedni blok tekstowy (strzałka w górę/lewo na krawędzi). */
  onFocusPrevious: () => boolean;
  /** Fokus na następny blok tekstowy (strzałka w dół/prawo na krawędzi). */
  onFocusNext: () => boolean;
  onSelectAllBlocks: () => void;
  /**
   * Shift+strzałka na krawędzi treści - eskalacja zaznaczenia TEKSTOWEGO do
   * zaznaczenia BLOKOWEGO w poprzek bloków (parytet z WP Gutenberg).
   */
  onExtendBlockSelection: (dir: SelectionDirection) => boolean;
}

export function BlockEditRenderer({
  block,
  isActive,
  onChange,
  onTransform,
  onInsertAfter,
  onDeleteEmpty,
  onMergeWithPrevious,
  onFocusPrevious,
  onFocusNext,
  onSelectAllBlocks,
  onExtendBlockSelection,
}: BlockEditRendererProps) {
  switch (block.type) {
    case "paragraph":
      return (
        <ParagraphBlock
          block={block}
          isActive={isActive}
          onChange={onChange}
          onTransform={onTransform}
          onInsertAfter={onInsertAfter}
          onDeleteEmpty={onDeleteEmpty}
          onMergeWithPrevious={onMergeWithPrevious}
          onFocusPrevious={onFocusPrevious}
          onFocusNext={onFocusNext}
          onSelectAllBlocks={onSelectAllBlocks}
          onExtendBlockSelection={onExtendBlockSelection}
        />
      );
    case "heading":
      return (
        <HeadingBlock
          block={block}
          isActive={isActive}
          onChange={onChange}
          onTransform={onTransform}
          onInsertAfter={onInsertAfter}
          onDeleteEmpty={onDeleteEmpty}
          onMergeWithPrevious={onMergeWithPrevious}
          onFocusPrevious={onFocusPrevious}
          onFocusNext={onFocusNext}
          onSelectAllBlocks={onSelectAllBlocks}
          onExtendBlockSelection={onExtendBlockSelection}
        />
      );
    case "image":
      return <ImageBlock block={block} isActive={isActive} onChange={onChange} />;
    case "list":
      return <ListBlockEdit block={block} onChange={onChange} />;
    case "quote":
      return <QuoteBlock block={block} onChange={onChange} />;
    case "code":
      return <CodeBlock block={block} onChange={onChange} />;
    case "embed":
      return <EmbedBlock block={block} onChange={onChange} />;
    case "video":
      return <VideoBlock block={block} isActive={isActive} onChange={onChange} />;
    case "gallery":
      return <GalleryBlock block={block} onChange={onChange} />;
    case "separator":
      return <SeparatorBlock block={block} onChange={onChange} />;
    case "callout":
      return <CalloutBlock block={block} onChange={onChange} />;
    case "table":
      return <TableBlockEdit block={block} onChange={onChange} />;
    case "button":
      return <ButtonBlock block={block} onChange={onChange} />;
    case "columns":
      return <ColumnsBlock block={block} onChange={onChange} />;
    case "html":
      return <HtmlBlock block={block} onChange={onChange} />;
    case "review":
      return <ReviewBlock block={block} onChange={onChange} />;
    case "proscons":
      return <ProsConsBlock block={block} onChange={onChange} />;
    case "spoiler":
      return <SpoilerBlock block={block} onChange={onChange} />;
    case "faq":
      return <FaqBlock block={block} onChange={onChange} />;
    case "toc":
      return <TocBlock block={block} onChange={onChange} />;
    case "newsletter":
      return <NewsletterBlock block={block} onChange={onChange} />;
    case "affiliate":
      return <AffiliateBlock block={block} onChange={onChange} />;
    case "xquote":
      return <XQuoteBlock block={block} onChange={onChange} />;
    case "compare":
      return <CompareBlock block={block} onChange={onChange} />;
    case "login-form":
      return <LoginFormBlock block={block} onChange={onChange} />;
    case "register-form":
      return <RegisterFormBlock block={block} onChange={onChange} />;
    case "lost-password-form":
      return <LostPasswordFormBlock block={block} onChange={onChange} />;
    case "reset-password-form":
      return <ResetPasswordFormBlock block={block} onChange={onChange} />;
    case "audio":
      return <AudioBlock block={block} isActive={isActive} onChange={onChange} />;
    case "cover":
      return <CoverBlock block={block} onChange={onChange} />;
    case "file":
      return <FileBlock block={block} onChange={onChange} />;
    case "media-text":
      return <MediaTextBlock block={block} onChange={onChange} />;
    case "group":
      return <GroupBlock block={block} onChange={onChange} />;
    case "spacer":
      return <SpacerBlock block={block} onChange={onChange} />;
    case "page-break":
      return <PageBreakBlock />;
    case "read-more":
      return <ReadMoreBlock block={block} onChange={onChange} />;
    case "liveblog":
      return <LiveBlogBlock block={block} onChange={onChange} />;
    case "pullquote":
      return <PullquoteBlock block={block} onChange={onChange} />;
    case "preformatted":
      return <PreformattedBlock block={block} onChange={onChange} />;
    case "verse":
      return <VerseBlock block={block} onChange={onChange} />;
    case "details":
      return <DetailsBlock block={block} onChange={onChange} />;
    case "row":
    case "stack":
    case "grid":
      return <GroupBlock block={block} onChange={onChange} />;
    case "buttons":
      return <ButtonsBlock block={block} onChange={onChange} />;
    case "social-icons":
      return <SocialIconsBlock block={block} onChange={onChange} />;
    case "search":
      return <SearchBlock block={block} onChange={onChange} />;
    case "latest-posts":
      return <LatestPostsBlock block={block} onChange={onChange} />;
    case "tag-cloud":
      return <TagCloudBlock block={block} onChange={onChange} />;
    case "categories-list":
      return <CategoriesListBlock block={block} onChange={onChange} />;
    case "archives":
      return <ArchivesBlock block={block} onChange={onChange} />;
    case "calendar":
      return <CalendarBlock block={block} onChange={onChange} />;
    case "post-title":
      return <PostTitleBlock block={block} onChange={onChange} />;
    case "post-date":
      return <PostDateBlock block={block} onChange={onChange} />;
    case "post-author":
      return <PostAuthorBlock block={block} onChange={onChange} />;
    case "post-excerpt":
      return <PostExcerptBlock block={block} onChange={onChange} />;
    case "post-featured-image":
      return <PostFeaturedImageBlock block={block} onChange={onChange} />;
    case "post-terms":
      return <PostTermsBlock block={block} onChange={onChange} />;
    case "site-title":
      return <SiteTitleBlock block={block} onChange={onChange} />;
    case "site-tagline":
      return <SiteTaglineBlock block={block} onChange={onChange} />;
    case "site-logo":
      return <SiteLogoBlock block={block} onChange={onChange} />;
    case "navigation":
      return <NavigationBlock block={block} onChange={onChange} />;
    case "post-navigation-link":
      return <PostNavigationLinkBlock block={block} onChange={onChange} />;
    case "query-loop":
      return <QueryLoopBlock block={block} onChange={onChange} />;
    case "breadcrumbs":
      return <BreadcrumbsBlock block={block} onChange={onChange} />;
    case "reading-time":
      return <ReadingTimeBlock block={block} onChange={onChange} />;
    case "share-buttons":
      return <ShareButtonsBlock block={block} onChange={onChange} />;
    case "post-views":
      return <PostViewsBlock block={block} onChange={onChange} />;
    case "author-bio":
      return <AuthorBioBlock block={block} onChange={onChange} />;
    case "related-posts":
      return <RelatedPostsBlock block={block} onChange={onChange} />;
    case "post-stats":
      return <PostStatsBlock block={block} onChange={onChange} />;
    case "post-rating":
      return <PostRatingBlock block={block} onChange={onChange} />;
    case "loginout":
      return <LoginOutBlock block={block} onChange={onChange} />;
    case "more-posts":
      return <MorePostsBlock block={block} onChange={onChange} />;
    case "accordion":
      return <AccordionBlock block={block} onChange={onChange} />;
    case "tabs":
      return <TabsBlock block={block} onChange={onChange} />;
    case "countdown":
      return <CountdownBlock block={block} onChange={onChange} />;
    case "progress":
      return <ProgressBlock block={block} onChange={onChange} />;
    case "poll":
      return <PollBlockEdit block={block} onChange={onChange} />;
    case "icon-box":
      return <IconBoxBlock block={block} onChange={onChange} />;
    case "stats-counter":
      return <StatsCounterBlock block={block} onChange={onChange} />;
    case "testimonials":
      return <TestimonialsBlock block={block} onChange={onChange} />;
    case "pricing-table":
      return <PricingTableBlock block={block} onChange={onChange} />;
    case "timeline":
      return <TimelineBlock block={block} onChange={onChange} />;
    case "hero":
      return <HeroBlock block={block} onChange={onChange} />;
    case "cta-section":
      return <CtaSectionBlock block={block} onChange={onChange} />;
    case "image-carousel":
      return <ImageCarouselBlock block={block} onChange={onChange} />;
    case "contact-form":
      return <ContactFormBlock block={block} onChange={onChange} />;
    case "map":
      return <MapBlock block={block} onChange={onChange} />;
    case "team-grid":
      return <TeamGridBlock block={block} onChange={onChange} />;
    case "logo-grid":
      return <LogoGridBlock block={block} onChange={onChange} />;
    case "feature-grid":
      return <FeatureGridBlock block={block} onChange={onChange} />;
    case "alert-banner":
      return <AlertBannerBlock block={block} onChange={onChange} />;
    case "divider-text":
      return <DividerTextBlock block={block} onChange={onChange} />;
    case "step-list":
      return <StepListBlock block={block} onChange={onChange} />;
    case "comparison-table":
      return <ComparisonTableBlock block={block} onChange={onChange} />;
    case "banner-image":
      return <BannerImageBlock block={block} onChange={onChange} />;
    case "video-hero":
      return <VideoHeroBlock block={block} onChange={onChange} />;
    case "chart":
      return <ChartBlock block={block} onChange={onChange} />;
    case "data-map":
      return <DataMapBlock block={block} onChange={onChange} />;

    default:
      return <div className="text-xs text-muted-foreground italic py-2">[{block.type}]</div>;
  }
}
