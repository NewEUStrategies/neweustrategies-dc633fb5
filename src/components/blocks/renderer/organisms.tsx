// Organizmy renderera bloków: kontenery rekurencyjne (kolumny / grupy / siatki)
// oraz bloki dynamiczne i zależne od kontekstu bieżącego wpisu. To właśnie te
// bloki CZYTAJĄ dane - listy wpisów, taksonomie, ankiety, powiązane treści -
// i dlatego są krytyczne dla izolacji tenantów.
//
// IZOLACJA TENANTA: każdy z poniższych widoków dociąga dane przez wspólny
// klient anonimowy Supabase (przez warstwę @/lib/queries/blocks), który niesie
// nagłówek `x-tenant-host`. RLS w bazie zawęża odczyt do `tenant_id =
// public_tenant_id()`, więc treść jednego obszaru roboczego (tenanta) nie może
// wyciec do innego - BEZ jawnego filtra `tenant_id` w kodzie i BEZ tenanta w
// kluczach react-query (to drugie utrzymuje zgodność prefetchu SSR z renderem
// klienta). Renderery organizmów NIE MOGĄ sięgać po klienta service-role ani
// wstrzykiwać tenanta do kluczy - patrz renderer/tenant.tsx.

import type { BlockRenderer } from "./context";
import { bool, num, readBlocksArray, str, strList } from "./data";
import type { CurrentPostAuthor } from "@/lib/builder/currentPostContext";
import { LiveBlogBlock } from "../LiveBlogBlock";
import { PollBlockView } from "../PollBlockView";
import { LatestPostsView } from "../LatestPostsView";
import { TaxonomyListView } from "../TaxonomyListView";
import { TagCloudView } from "../TagCloudView";
import { CalendarView } from "../CalendarView";
import {
  PostTitleView,
  PostDateView,
  PostAuthorView,
  PostExcerptView,
  PostFeaturedImageView,
  PostTermsView,
  SiteTitleView,
  SiteTaglineView,
  SiteLogoView,
} from "../ContextBlockViews";
import { NavigationView, PostNavigationLinkView, QueryLoopView } from "../NavLoopViews";
import {
  BreadcrumbsView,
  ReadingTimeView,
  ShareButtonsView,
  PostViewsView,
} from "../PostUtilityViews";
import { AuthorBioView, RelatedPostsView } from "../PostContextViews";
import { PostStatsView, PostRatingView, LoginOutView, MorePostsView } from "../FoxizExtraViews";

// ---------------------------------------------------------------------------
// Kontenery (rekurencja przez ctx.renderChild)
// ---------------------------------------------------------------------------

/** Dwie kolumny z blokami (responsywne 1 -> 2 kolumny). */
export const renderColumns: BlockRenderer = ({ block, cls, renderChild }) => {
  const left = readBlocksArray(block.data.left);
  const right = readBlocksArray(block.data.right);
  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 not-prose ${cls}`}>
      <div className="prose dark:prose-invert max-w-none">{left.map((b) => renderChild(b))}</div>
      <div className="prose dark:prose-invert max-w-none">{right.map((b) => renderChild(b))}</div>
    </div>
  );
};

/** Grupa - kontener łączący bloki w sekcję (layout group/row/stack/grid). */
export const renderGroup: BlockRenderer = ({ block, cls, renderChild }) => {
  const bg = str(block.data, "background");
  const padding = Math.min(120, Math.max(0, num(block.data, "padding", 16)));
  const children = readBlocksArray(block.data.children);
  const layout = str(block.data, "layout", "group");
  const layoutCls =
    layout === "row"
      ? "flex flex-row flex-wrap gap-4"
      : layout === "stack"
        ? "flex flex-col gap-4"
        : layout === "grid"
          ? "grid grid-cols-1 md:grid-cols-2 gap-4"
          : "";
  return (
    <div
      className={`not-prose rounded-lg ${layoutCls} ${cls}`}
      style={{ backgroundColor: bg || undefined, padding }}
    >
      {children.map((c) => renderChild(c))}
    </div>
  );
};

/** Wiersz / stos / siatka - jeden renderer dla trzech pokrewnych układów. */
export const renderRowStackGrid: BlockRenderer = ({ block, cls, renderChild }) => {
  const bg = str(block.data, "background");
  const padding = Math.min(120, Math.max(0, num(block.data, "padding", 0)));
  const children = readBlocksArray(block.data.children);
  const cols = Math.min(6, Math.max(1, num(block.data, "columns", 3)));
  const layoutCls =
    block.type === "row"
      ? "flex flex-row flex-wrap gap-4"
      : block.type === "stack"
        ? "flex flex-col gap-4"
        : `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-${cols} gap-4`;
  return (
    <div
      className={`not-prose rounded-lg ${layoutCls} ${cls}`}
      style={{ backgroundColor: bg || undefined, padding: padding || undefined }}
    >
      {children.map((c) => renderChild(c))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Bloki dynamiczne / zależne od bieżącego wpisu (tenant-scoped przez RLS)
// ---------------------------------------------------------------------------

/** Live blog - wpisy na żywo (realtime per postId). */
export const renderLiveblog: BlockRenderer = ({ block, cls, lang, postId }) => {
  if (!postId) return null;
  const title = str(block.data, "title");
  const reverseChronological = bool(block.data, "reverseChronological", true);
  const autoRefresh = bool(block.data, "autoRefresh", true);
  return (
    <div className={cls}>
      <LiveBlogBlock
        postId={postId}
        blockId={block.id}
        lang={lang}
        title={title || undefined}
        reverseChronological={reverseChronological}
        autoRefresh={autoRefresh}
      />
    </div>
  );
};

/** Osadzona ankieta społeczności (głosowanie na żywo). */
export const renderPoll: BlockRenderer = ({ block, cls, lang }) => {
  const pollId = str(block.data, "pollId").trim();
  if (!pollId) return null;
  return (
    <div className={`not-prose my-6 ${cls}`}>
      <PollBlockView pollId={pollId} lang={lang} />
    </div>
  );
};

/** Najnowsze wpisy (lista lub siatka). */
export const renderLatestPosts: BlockRenderer = ({ block, cls, lang }) => {
  const count = Math.max(1, Math.min(50, num(block.data, "count", 5)));
  const category = str(block.data, "category");
  const showExcerpt = bool(block.data, "showExcerpt", false);
  const showImage = bool(block.data, "showImage", true);
  const layout = str(block.data, "layout", "list") === "grid" ? "grid" : "list";
  return (
    <div className={cls}>
      <LatestPostsView
        count={count}
        category={category}
        showExcerpt={showExcerpt}
        showImage={showImage}
        layout={layout}
        lang={lang}
      />
    </div>
  );
};

/** Chmura tagów. */
export const renderTagCloud: BlockRenderer = ({ block, cls, lang }) => (
  <div className={cls}>
    <TagCloudView
      count={num(block.data, "count", 30)}
      showCount={bool(block.data, "showCount", false)}
      lang={lang}
    />
  </div>
);

/** Lista kategorii (lista lub dropdown). */
export const renderCategoriesList: BlockRenderer = ({ block, cls, lang }) => {
  const layout = str(block.data, "layout", "list") === "dropdown" ? "dropdown" : "list";
  return (
    <div className={cls}>
      <TaxonomyListView
        kind="categories"
        lang={lang}
        showCount={bool(block.data, "showCount", false)}
        layout={layout}
      />
    </div>
  );
};

/** Archiwa miesięczne (lista lub dropdown). */
export const renderArchives: BlockRenderer = ({ block, cls, lang }) => {
  const layout = str(block.data, "layout", "list") === "dropdown" ? "dropdown" : "list";
  return (
    <div className={cls}>
      <TaxonomyListView
        kind="archives"
        lang={lang}
        showCount={bool(block.data, "showCount", false)}
        layout={layout}
      />
    </div>
  );
};

/** Kalendarz publikacji. */
export const renderCalendar: BlockRenderer = ({ block, cls, lang }) => (
  <div className={cls}>
    <CalendarView month={str(block.data, "month")} lang={lang} />
  </div>
);

// ----- Bloki kontekstu wpisu / witryny -----

export const renderPostTitle: BlockRenderer = ({ block, cls, lang }) => (
  <PostTitleView level={num(block.data, "level", 1)} lang={lang} cls={cls} />
);

export const renderPostDate: BlockRenderer = ({ block, cls, lang }) => (
  <PostDateView
    format={str(block.data, "format", "long")}
    showUpdated={bool(block.data, "showUpdated", false)}
    lang={lang}
    cls={cls}
  />
);

export const renderPostAuthor: BlockRenderer = ({ block, cls, lang }) => (
  <PostAuthorView
    showAvatar={bool(block.data, "showAvatar", true)}
    showBio={bool(block.data, "showBio", false)}
    lang={lang}
    cls={cls}
  />
);

export const renderPostExcerpt: BlockRenderer = ({ block, cls, lang }) => (
  <PostExcerptView showMore={bool(block.data, "showMore", false)} lang={lang} cls={cls} />
);

export const renderPostFeaturedImage: BlockRenderer = ({ block, cls }) => (
  <PostFeaturedImageView
    aspect={str(block.data, "aspect", "16/9")}
    rounded={bool(block.data, "rounded", true)}
    cls={cls}
  />
);

export const renderPostTerms: BlockRenderer = ({ block, cls }) => {
  const tx = str(block.data, "taxonomy", "categories") === "tags" ? "tags" : "categories";
  return <PostTermsView taxonomy={tx} cls={cls} />;
};

export const renderSiteTitle: BlockRenderer = ({ block, cls }) => (
  <SiteTitleView level={num(block.data, "level", 1)} cls={cls} />
);

export const renderSiteTagline: BlockRenderer = ({ cls }) => <SiteTaglineView cls={cls} />;

export const renderSiteLogo: BlockRenderer = ({ block, cls }) => (
  <SiteLogoView width={num(block.data, "width", 120)} cls={cls} />
);

export const renderNavigation: BlockRenderer = ({ block, cls, lang }) => (
  <NavigationView
    menuKey={str(block.data, "menuKey", "primary")}
    layout={str(block.data, "layout", "horizontal")}
    lang={lang}
    cls={cls}
  />
);

export const renderPostNavigationLink: BlockRenderer = ({ block, cls, lang }) => {
  const dir = str(block.data, "direction", "next") === "prev" ? "prev" : "next";
  return (
    <PostNavigationLinkView
      direction={dir}
      showTitle={bool(block.data, "showTitle", true)}
      lang={lang}
      cls={cls}
    />
  );
};

export const renderQueryLoop: BlockRenderer = ({ block, cls, lang }) => {
  const lay = str(block.data, "layout", "grid") === "list" ? "list" : "grid";
  const ord = str(block.data, "orderBy", "date") === "title" ? "title" : "date";
  return (
    <QueryLoopView
      categorySlug={str(block.data, "categorySlug")}
      limit={num(block.data, "limit", 6)}
      layout={lay}
      showExcerpt={bool(block.data, "showExcerpt", true)}
      showDate={bool(block.data, "showDate", true)}
      showImage={bool(block.data, "showImage", true)}
      orderBy={ord}
      lang={lang}
      cls={cls}
    />
  );
};

export const renderBreadcrumbs: BlockRenderer = ({ block, cls, lang }) => (
  <BreadcrumbsView
    separator={str(block.data, "separator", "/")}
    showHome={bool(block.data, "showHome", true)}
    lang={lang}
    cls={cls}
  />
);

export const renderReadingTime: BlockRenderer = ({ block, cls, lang }) => (
  <ReadingTimeView
    wpm={num(block.data, "wpm", 220)}
    prefix={str(block.data, "prefix")}
    lang={lang}
    cls={cls}
  />
);

export const renderShareButtons: BlockRenderer = ({ block, cls, lang }) => {
  const nets = Array.isArray(block.data.networks) ? strList(block.data, "networks") : undefined;
  const v = str(block.data, "variant", "filled");
  const variant: "filled" | "outline" | "ghost" =
    v === "outline" ? "outline" : v === "ghost" ? "ghost" : "filled";
  return <ShareButtonsView networks={nets} variant={variant} lang={lang} cls={cls} />;
};

export const renderPostViews: BlockRenderer = ({ block, cls, lang }) => (
  <PostViewsView suffix={str(block.data, "suffix")} lang={lang} cls={cls} />
);

export const renderAuthorBio: BlockRenderer = ({ block, cls, lang }) => {
  const v = str(block.data, "variant", "card");
  const variant: "card" | "inline" | "minimal" | "split" =
    v === "inline" ? "inline" : v === "minimal" ? "minimal" : v === "split" ? "split" : "card";
  const inlineRaw = block.data.inlineAuthor;
  const inlineAuthor =
    inlineRaw && typeof inlineRaw === "object" && !Array.isArray(inlineRaw)
      ? (inlineRaw as unknown as CurrentPostAuthor)
      : null;
  const useInline = block.data.authorSource === "inline" && !!inlineAuthor?.name;
  return (
    <AuthorBioView
      showAvatar={bool(block.data, "showAvatar", true)}
      showSocial={bool(block.data, "showSocial", true)}
      showPostsCount={bool(block.data, "showPostsCount", true)}
      variant={variant}
      authorOverride={useInline ? inlineAuthor : undefined}
      authorId={
        !useInline && typeof block.data.authorId === "string" && block.data.authorId
          ? block.data.authorId
          : undefined
      }
      lang={lang}
      cls={cls}
    />
  );
};

export const renderRelatedPosts: BlockRenderer = ({ block, cls, lang }) => {
  const s = str(block.data, "strategy", "category");
  const strategy: "category" | "tag" | "author" | "latest" =
    s === "tag" ? "tag" : s === "author" ? "author" : s === "latest" ? "latest" : "category";
  const l = str(block.data, "layout", "grid");
  const layout: "grid" | "list" | "compact" =
    l === "list" ? "list" : l === "compact" ? "compact" : "grid";
  return (
    <RelatedPostsView
      limit={num(block.data, "limit", 3)}
      strategy={strategy}
      layout={layout}
      heading={str(block.data, "heading")}
      lang={lang}
      cls={cls}
    />
  );
};

export const renderPostStats: BlockRenderer = ({ block, cls, lang }) => {
  const items = Array.isArray(block.data.items) ? strList(block.data, "items") : undefined;
  return (
    <PostStatsView
      items={items}
      separator={str(block.data, "separator", "•")}
      lang={lang}
      cls={cls}
    />
  );
};

export const renderPostRating: BlockRenderer = ({ block, cls, lang }) => (
  <PostRatingView
    max={num(block.data, "max", 5)}
    label={str(block.data, "label")}
    lang={lang}
    cls={cls}
  />
);

export const renderLoginOut: BlockRenderer = ({ block, cls, lang }) => (
  <LoginOutView
    loginHref={str(block.data, "loginHref", "/auth")}
    showAvatar={bool(block.data, "showAvatar", true)}
    lang={lang}
    cls={cls}
  />
);

export const renderMorePosts: BlockRenderer = ({ block, cls, lang }) => {
  const s = str(block.data, "strategy", "latest");
  const strategy: "latest" | "trending" | "category" =
    s === "trending" ? "trending" : s === "category" ? "category" : "latest";
  return (
    <MorePostsView
      limit={num(block.data, "limit", 4)}
      strategy={strategy}
      heading={str(block.data, "heading")}
      lang={lang}
      cls={cls}
    />
  );
};
