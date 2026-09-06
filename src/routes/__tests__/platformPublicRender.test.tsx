import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postItem, resolvedPost } from "@/test/platform/publicContentFixtures";
import type { ResolvedContent, PageData } from "@/lib/queries/public";
import type { BodyParts } from "@/lib/access/gating";
import type { MeteredUnlock, MeteringSettings } from "@/lib/access/metering";
import type { PostLayoutSettings } from "@/lib/postLayouts";
import type { GiftRedeemReason } from "@/lib/gifting/model";
import type { TocDefaults } from "@/lib/toc/settings";

const h = vi.hoisted(() => ({
  lang: "pl",
  layout: undefined as PostLayoutSettings | undefined,
  toc: {} as TocDefaults,
  allowAds: false,
  session: null as object | null,
  unlocked: null as BodyParts | null,
  password: { body: null as BodyParts | null, verify: vi.fn(), loading: false },
  meterSettings: undefined as MeteringSettings | undefined,
  metered: { body: null, meter: null, settled: false } as MeteredUnlock,
  giftCode: null as string | null,
  gifted: { body: null as BodyParts | null, reason: null as GiftRedeemReason | null },
  props: new Map<string, Record<string, unknown>>(),
  view: vi.fn(),
  unlock: vi.fn(),
  meter: vi.fn(),
  meta: vi.fn(async () => []),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: h.lang } }),
  initReactI18next: { type: "3rdParty", init() {} },
}));
vi.mock("@/lib/i18n/localeRuntime", async (o) => ({
  ...(await o<typeof import("@/lib/i18n/localeRuntime")>()),
  currentLang: () => h.lang,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(async () => ({ data: null, error: null })) },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: h.session, user: null }) }));
vi.mock("@/hooks/usePostLayoutSettings", async (o) => ({
  ...(await o<typeof import("@/hooks/usePostLayoutSettings")>()),
  usePostLayoutSettings: () => ({ data: h.layout }),
}));
vi.mock("@/hooks/useUnlockedContent", () => ({
  useUnlockedContent: (...args: unknown[]) => {
    h.unlock(...args);
    return h.unlocked;
  },
}));
vi.mock("@/hooks/usePasswordUnlock", () => ({ usePasswordUnlock: () => h.password }));
vi.mock("@/hooks/useRecordPostView", () => ({
  useRecordPostView: (...args: unknown[]) => h.view(...args),
}));
vi.mock("@/hooks/useReadingTimeSettings", async () => ({
  useReadingTimeSettings: () => DEFAULT_READING_TIME_SETTINGS,
}));
vi.mock("@/lib/toc/settings", async (o) => ({
  ...(await o<typeof import("@/lib/toc/settings")>()),
  useTocDefaults: () => h.toc,
}));
vi.mock("@/lib/ads/readingMode", () => ({ useReadingAdBudget: () => () => h.allowAds }));
vi.mock("@/lib/access/metering", async (o) => ({
  ...(await o<typeof import("@/lib/access/metering")>()),
  useMeteringSettings: () => ({ data: h.meterSettings }),
  useMeteredAccess: (...args: unknown[]) => {
    h.meter(...args);
    return h.metered;
  },
}));
vi.mock("@/lib/gifting/hooks", () => ({
  useGiftCodeFromUrl: () => h.giftCode,
  useGiftRedemption: () => h.gifted,
}));
vi.mock("@/lib/seo/request", () => ({ getRequestUrl: () => "https://example.org/analizy/atom" }));
vi.mock("@/lib/customMeta", () => ({ listCustomMetaDefs: () => h.meta() }));

// These leaves have their own renderer suites. Here their actual props and
// placement are the contract: access, locale, attribution and layout must be
// composed consistently by the real catch-all route.
function leaf(name: string, props: Record<string, unknown>) {
  h.props.set(name, props);
  return <div data-testid={name}>{props.children as ReactNode}</div>;
}
vi.mock("@/components/PostLayoutRenderer", () => ({
  PostLayoutRenderer: (p: Record<string, unknown>) => {
    h.props.set("PostLayoutRenderer", p);
    return (
      <>
        <h1>{p.title as string}</h1>
        {p.meta as ReactNode}
        {p.categoryBadges as ReactNode}
        {p.headerActions as ReactNode}
        {p.content as ReactNode}
        {p.sidebar as ReactNode}
        {p.footer as ReactNode}
      </>
    );
  },
}));
vi.mock("@/components/content/ContentRenderer", () => ({
  ContentRenderer: (p: Record<string, unknown>) => {
    h.props.set("ContentRenderer", p);
    return (
      <article data-testid="content" dangerouslySetInnerHTML={{ __html: String(p.html ?? "") }} />
    );
  },
}));
vi.mock("@/components/pages/BuilderPageShell", () => ({
  BuilderPageShell: (p: Record<string, unknown>) => {
    h.props.set("BuilderPageShell", p);
    return (
      <>
        <h1>{p.title as string}</h1>
        {p.children as ReactNode}
        {p.footer as ReactNode}
      </>
    );
  },
}));
vi.mock("@/components/Breadcrumbs", () => ({
  Breadcrumbs: (p: Record<string, unknown>) => leaf("Breadcrumbs", p),
}));
vi.mock("@/components/molecules/PublicNotFound", () => ({
  PublicNotFound: (p: Record<string, unknown>) => leaf("PublicNotFound", p),
}));
vi.mock("@/components/share/FloatingShareBar", () => ({
  FloatingShareBar: (p: Record<string, unknown>) => leaf("FloatingShareBar", p),
}));
vi.mock("@/components/post/PostSidebarRenderer", () => ({
  PostSidebarRenderer: (p: Record<string, unknown>) => leaf("PostSidebarRenderer", p),
}));
vi.mock("@/components/post/AutoLoadNextPost", () => ({
  AutoLoadNextPost: (p: Record<string, unknown>) => leaf("AutoLoadNextPost", p),
}));
vi.mock("@/components/post/CustomMetaList", () => ({
  CustomMetaList: (p: Record<string, unknown>) => leaf("CustomMetaList", p),
}));
vi.mock("@/components/post/PostOverlayMeta", () => ({
  PostOverlayMeta: (p: Record<string, unknown>) => leaf("PostOverlayMeta", p),
}));
vi.mock("@/components/post/CategoryBadges", () => ({
  CategoryBadges: (p: Record<string, unknown>) => leaf("CategoryBadges", p),
}));
vi.mock("@/components/post/SponsoredDisclosure", () => ({
  SponsoredDisclosure: (p: Record<string, unknown>) => leaf("SponsoredDisclosure", p),
}));
vi.mock("@/components/post/SponsoredBadge", () => ({
  SponsoredBadge: (p: Record<string, unknown>) => leaf("SponsoredBadge", p),
}));
vi.mock("@/components/post/PostOrganizationCard", () => ({
  PostOrganizationCard: (p: Record<string, unknown>) => leaf("PostOrganizationCard", p),
}));
vi.mock("@/components/post/RelatedPosts", () => ({
  RelatedPosts: (p: Record<string, unknown>) => leaf("RelatedPosts", p),
}));
vi.mock("@/components/post/RelatedPostsAfterParagraph", () => ({
  RelatedPostsAfterParagraph: (p: Record<string, unknown>) => leaf("RelatedPostsAfterParagraph", p),
}));
vi.mock("@/components/pages/ContactForm", () => ({
  ContactForm: (p: Record<string, unknown>) => leaf("ContactForm", p),
}));
vi.mock("@/components/pages/ArchiveListing", () => ({
  ArchiveListing: (p: Record<string, unknown>) => leaf("ArchiveListing", p),
}));
vi.mock("@/components/Footnotes", () => ({
  FootnotesList: (p: Record<string, unknown>) => leaf("FootnotesList", p),
  FootnoteTooltips: (p: Record<string, unknown>) => leaf("FootnoteTooltips", p),
}));
vi.mock("@/components/molecules/MeterBanner", () => ({
  MeterBanner: (p: Record<string, unknown>) => leaf("MeterBanner", p),
}));
vi.mock("@/components/gifting/GiftArticleButton", () => ({
  GiftArticleButton: (p: Record<string, unknown>) => leaf("GiftArticleButton", p),
}));
vi.mock("@/components/gifting/GiftBanner", () => ({
  GiftBanner: (p: Record<string, unknown>) => leaf("GiftBanner", p),
}));
vi.mock("@/components/seo/GooglePreferredSourceBadge", () => ({
  GooglePreferredSourceBadge: (p: Record<string, unknown>) => leaf("GooglePreferredSourceBadge", p),
}));
vi.mock("@/components/post/CitationBox", () => ({
  CitationBox: (p: Record<string, unknown>) => leaf("CitationBox", p),
}));
vi.mock("@/components/post/PrintBriefHeader", () => ({
  PrintBriefHeader: (p: Record<string, unknown>) => leaf("PrintBriefHeader", p),
}));
vi.mock("@/components/post/QuoteShareBar", () => ({
  QuoteShareBar: (p: Record<string, unknown>) => leaf("QuoteShareBar", p),
}));
vi.mock("@/components/post/PostChangelog", () => ({
  PostChangelog: (p: Record<string, unknown>) => leaf("PostChangelog", p),
}));
vi.mock("@/components/post/PostFeedback", () => ({
  PostFeedback: (p: Record<string, unknown>) => leaf("PostFeedback", p),
}));
vi.mock("@/components/post/PostSeriesNav", () => ({
  PostSeriesNav: (p: Record<string, unknown>) => leaf("PostSeriesNav", p),
}));
vi.mock("@/components/post/GlossaryHighlighter", () => ({
  GlossaryHighlighter: (p: Record<string, unknown>) => leaf("GlossaryHighlighter", p),
}));
vi.mock("@/components/Paywall", () => ({
  Paywall: (p: Record<string, unknown>) => leaf("Paywall", p),
}));
vi.mock("@/components/PostFooterBars", () => ({
  PostFooterBars: (p: Record<string, unknown>) => leaf("PostFooterBars", p),
}));
vi.mock("@/components/comments/CommentsSection", () => ({
  CommentsSection: (p: Record<string, unknown>) => leaf("CommentsSection", p),
}));
vi.mock("@/components/PostContentStyle", () => ({
  PostContentStyle: (p: Record<string, unknown>) => leaf("PostContentStyle", p),
}));
vi.mock("@/components/post/QuickViewInfoBar", () => ({
  QuickViewInfoBar: (p: Record<string, unknown>) => leaf("QuickViewInfoBar", p),
}));
vi.mock("@/components/audio/SidebarListenCard", () => ({
  SidebarListenCard: (p: Record<string, unknown>) => leaf("SidebarListenCard", p),
}));
vi.mock("@/components/NewsletterForm", () => ({
  NewsletterForm: (p: Record<string, unknown>) => leaf("NewsletterForm", p),
}));
vi.mock("@/components/molecules/KeyTakeaways", () => ({
  KeyTakeaways: (p: Record<string, unknown>) => leaf("KeyTakeaways", p),
}));
vi.mock("@/components/post/InlineToc", () => ({
  InlineToc: (p: Record<string, unknown>) => leaf("InlineToc", p),
}));
vi.mock("@/components/AdSlot", () => ({
  AdZone: (p: Record<string, unknown>) => leaf("AdZone", p),
}));
vi.mock("@/components/ads/MidPostAds", () => ({
  MidPostAds: (p: Record<string, unknown>) => leaf("MidPostAds", p),
}));
vi.mock("@/components/ads/FooterSlideup", () => ({
  FooterSlideup: (p: Record<string, unknown>) => leaf("FooterSlideup", p),
}));

import { Route } from "@/routes/$";
import { resolvedContentQueryOptions } from "@/lib/queries/public";
import { defaultPostLayoutSettings } from "@/lib/postLayouts";
import { TOC_DEFAULTS } from "@/lib/toc/settings";
import { DEFAULT_READING_TIME_SETTINGS } from "@/lib/readingTime";
import { DEFAULT_METERING_SETTINGS } from "@/lib/access/metering";
import { RELATED_POSTS_DEFAULTS } from "@/lib/relatedPosts";

let qc: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  h.props.clear();
  h.lang = "pl";
  h.layout = defaultPostLayoutSettings();
  h.toc = TOC_DEFAULTS;
  h.allowAds = false;
  h.session = null;
  h.unlocked = null;
  h.password.body = null;
  h.meterSettings = undefined;
  h.metered = { body: null, meter: null, settled: false };
  h.giftCode = null;
  h.gifted = { body: null, reason: null };
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
  qc.setQueryData(["public", "related-posts-config"], {
    ...RELATED_POSTS_DEFAULTS,
    enabled: false,
  });
  vi.spyOn(Route, "useParams").mockReturnValue({ _splat: "analizy/atom" });
});
afterEach(() => {
  cleanup();
  qc.clear();
  vi.restoreAllMocks();
});
function mount(data: ResolvedContent | null) {
  qc.setQueryData(resolvedContentQueryOptions(["analizy", "atom"]).queryKey, data);
  const Component = Route.options.component!;
  return render(
    <QueryClientProvider client={qc}>
      <Component />
    </QueryClientProvider>,
  );
}
function page(overrides: Partial<PageData> = {}): ResolvedContent {
  return {
    kind: "page",
    item: {
      ...postItem(),
      content_pl: "<p>Treść strony</p>",
      content_en: "<p>Page body</p>",
      ...overrides,
    },
    access: null,
    parentPageId: "root",
    crumbs: resolvedPost().crumbs,
  };
}
function article() {
  return resolvedPost({
    item: postItem({ content_pl: "<p>Pełna analiza</p>", content_en: "<p>Complete analysis</p>" }),
  });
}
function prop(name: string): Record<string, unknown> {
  const p = h.props.get(name);
  expect(p, `${name} must render`).toBeDefined();
  return p!;
}

describe("public catch-all composition", () => {
  it("renders a real not-found surface for absent content", () => {
    mount(null);
    expect(screen.getByTestId("PublicNotFound")).toBeTruthy();
  });
  it.each(["pl", "en"])(
    "passes %s content and canonical attribution to every post surface",
    async (lang) => {
      h.lang = lang;
      h.allowAds = true;
      Object.assign(h.layout!, {
        show_citation: true,
        show_quote_share: true,
        auto_load_next_post: true,
        show_bottom_newsletter: true,
        show_prev_next: true,
        wide_align_max_width: 1234,
      });
      h.toc = { ...TOC_DEFAULTS, showInBody: true };
      const data = article();
      data.item.takeaways_pl = ["Punkt"];
      data.item.takeaways_en = ["Point"];
      data.author = {
        id: "author-1",
        slug: "anna",
        display_name: "Anna Public",
        first_name: "Anna",
        last_name: "Public",
        avatar_url: "/avatar-base.png",
        bio_pl: "Publiczne bio",
        bio_en: "Public bio",
        author_profile: {
          avatar_url: "/avatar-profile.png",
          job_title: "Researcher",
          company: "Institute",
          bio_pl: "Starsze bio",
          bio_en: "Older bio",
          website_url: "https://example.org",
          x_url: "https://x.com/example",
          linkedin_url: "https://linkedin.com/example",
          facebook_url: "https://facebook.com/example",
          instagram_url: "https://instagram.com/example",
          spotify_url: "https://spotify.com/example",
          custom_socials: [],
        },
      };
      const neighbor = {
        id: "next",
        slug: "next",
        title_pl: "Następny",
        title_en: "Next",
        published_at: data.item.published_at,
      };
      qc.setQueryData(["public", "adjacent-posts", data.item.id, data.item.published_at], {
        prev: neighbor,
        next: neighbor,
      });
      mount(data);
      await waitFor(() =>
        expect(prop("ContentRenderer").currentPostCtx).toMatchObject({
          breadcrumbs: expect.any(Array),
        }),
      );
      expect(screen.getByTestId("content").textContent).toBe(
        lang === "en" ? "Complete analysis" : "Pełna analiza",
      );
      expect(prop("ContentRenderer")).toMatchObject({
        lang,
        stream: true,
        eagerFirstImage: false,
        postId: data.item.id,
      });
      expect(prop("ContentRenderer").currentPostCtx).toMatchObject({
        kind: "post",
        author: { avatarUrl: "/avatar-profile.png", name: "Anna Public", bio_pl: "Publiczne bio" },
        categories: [{ slug: "analizy", name: lang === "en" ? "Analyses" : "Analizy" }],
      });
      expect(prop("PostSidebarRenderer")).toMatchObject({
        suppressToc: true,
        suppressAds: false,
        listen: { authorEmail: null },
      });
      expect(prop("PostFooterBars")).toMatchObject({
        prev: { parent_path: "post", title: lang === "en" ? "Next" : "Następny" },
      });
      expect(prop("CitationBox")).toMatchObject({
        url: "https://example.org/analizy/atom",
        authors: [{ firstName: "Anna", lastName: "Nowak", displayName: "Anna Nowak" }],
      });
      expect(h.view).toHaveBeenCalledWith(data.item.id, "author-1");
      await waitFor(() => expect(h.meta).toHaveBeenCalled());
    },
  );
  it.each(["pl", "en"])("uses fallback names, locale and neighbor titles in %s", (lang) => {
    h.lang = lang;
    h.layout!.show_prev_next = true;
    h.layout!.quick_view_info = false;
    const data = article();
    data.item.title_pl = lang === "pl" ? "" : "Fallback PL";
    data.item.title_en = lang === "en" ? "" : "Fallback EN";
    data.item.content_pl = lang === "pl" ? null : "<p>PL fallback</p>";
    data.item.content_en = lang === "en" ? null : "<p>EN fallback</p>";
    data.item.cover_image_url = null;
    data.item.read_minutes = null;
    data.author = {
      id: "author-1",
      slug: null,
      display_name: null,
      first_name: "Anna",
      last_name: "Nowak",
      avatar_url: "/base.png",
      bio_pl: null,
      bio_en: null,
      author_profile: null,
    };
    data.categories = [
      {
        slug: "a",
        name_pl: lang === "pl" ? "" : "PL",
        name_en: lang === "en" ? "" : "EN",
        color: null,
      },
    ];
    qc.setQueryData(["public", "adjacent-posts", data.item.id, data.item.published_at], {
      prev: { slug: "p", title_pl: "", title_en: "Previous EN" },
      next: { slug: "n", title_pl: "Next PL", title_en: "" },
    });
    mount(data);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      lang === "pl" ? "Fallback EN" : "Fallback PL",
    );
    expect(prop("ContentRenderer")).toMatchObject({
      eagerFirstImage: true,
      currentPostCtx: { author: { name: "Anna Nowak", avatarUrl: "/base.png" } },
    });
    expect(prop("PostFooterBars")).toMatchObject({
      prev: { title: "Previous EN" },
      next: { title: "Next PL" },
    });
  });
  it("survives legacy sparse metadata without inventing author information", () => {
    const data = article();
    data.author = {
      id: "a",
      slug: null,
      display_name: null,
      first_name: null,
      last_name: null,
      avatar_url: null,
      bio_pl: null,
      bio_en: null,
      author_profile: null,
    };
    data.tags = [];
    data.categories = [];
    data.item.excerpt_pl = null;
    data.item.excerpt_en = null;
    data.item.published_at = null;
    mount(data);
    expect(prop("ContentRenderer").currentPostCtx).toMatchObject({
      author: { name: undefined, avatarUrl: undefined },
    });
    expect(prop("PostSidebarRenderer").listen).toMatchObject({
      author: null,
      authorHref: null,
      authorAvatarUrl: null,
    });
    expect(prop("PostFooterBars").author).toMatchObject({ display_name: null });
  });
  it.each(["standard", "audio", "video", "gallery"] as const)(
    "adapts listen controls to format %s",
    (format) => {
      const data = article();
      data.item.layout_overrides = { format };
      mount(data);
      expect(prop("PostLayoutRenderer").format).toBe(format);
      expect(prop("PostSidebarRenderer").listen === null).toBe(
        format === "audio" || format === "video",
      );
    },
  );
  it("keeps editorial actions in the header and flags sponsored content without categories", () => {
    const data = article();
    data.item.layout_overrides = { layout: "layout-13" };
    data.item.is_sponsored = true;
    data.categories = [];
    mount(data);
    expect(prop("PostLayoutRenderer").headerActions).toBeTruthy();
    expect(screen.getByTestId("SponsoredBadge")).toBeTruthy();
    expect(prop("PostOverlayMeta").readMinutes).toBeNull();
  });
  it.each(["end", "after_paragraph", "sidebar"] as const)(
    "honors the related-content position %s",
    (position) => {
      qc.setQueryData(["public", "related-posts-config"], { ...RELATED_POSTS_DEFAULTS, position });
      mount(article());
      expect(!!h.props.get("RelatedPosts")).toBe(position === "end");
      expect(!!h.props.get("RelatedPostsAfterParagraph")).toBe(position === "after_paragraph");
    },
  );
  it.each(["default", "full_width", "landing", "archive_listing", "contact"])(
    "composes the %s page template",
    (template) => {
      mount(page({ template_type: template, header_override: "hidden" }));
      expect(screen.getByTestId("content").textContent).toBe("Treść strony");
      expect(prop("ContentRenderer")).toMatchObject({
        postId: undefined,
        currentPostCtx: { kind: "page", author: null },
      });
      expect(!!h.props.get("ContactForm")).toBe(template === "contact");
      expect(!!h.props.get("ArchiveListing")).toBe(template === "archive_listing");
    },
  );
  it.each([true, false])("keeps builder page headings coherent (own H1: %s)", (own) => {
    const doc = {
      version: 1,
      sections: [
        {
          id: "hero",
          kind: "section",
          children: [
            {
              id: "c",
              kind: "column",
              span: { desktop: 12 },
              children: [
                {
                  id: "h",
                  kind: "widget",
                  type: "heading",
                  content: { text: "Hero", tag: own ? "h1" : "h2" },
                },
              ],
            },
          ],
        },
      ],
    };
    mount(page({ editor: "builder", builder_data: doc, header_override: "hidden" }));
    expect(prop("BuilderPageShell")).toMatchObject({
      headerOverride: "hidden",
      hasOwnTopHeading: own,
    });
    expect(prop("ContentRenderer").stream).toBe(true);
  });
  it("renders a safe content fallback when layout settings are unavailable", () => {
    h.layout = undefined;
    mount(article());
    expect(screen.getByTestId("content").textContent).toBe("Pełna analiza");
  });
});

describe("access decisions in the rendered public route", () => {
  const protectedArticle = (mode: "paid" | "members" | "password") => {
    const data = article();
    data.item.content_pl = null;
    data.item.content_en = null;
    data.access = {
      id: "rule",
      entity_type: "post",
      entity_id: data.item.id,
      mode,
      teaser_pl: "Teaser",
      teaser_en: "Teaser",
      plan_ids: [],
      metering_policy: "inherit",
      one_time_price_cents: null,
      one_time_currency: null,
    };
    return data;
  };
  it.each(["paid", "members", "password"] as const)(
    "never renders a missing protected body for %s access",
    (mode) => {
      const data = protectedArticle(mode);
      mount(data);
      expect(screen.queryByTestId("content")).toBeNull();
      expect(prop("Paywall")).toMatchObject({ rule: { mode } });
      expect(h.unlock).toHaveBeenCalledWith("post", data.item.id, mode !== "password");
    },
  );
  it.each(["member", "anonymous", "registration-required"])(
    "only attempts metering for eligible %s readers",
    (kind) => {
      h.meterSettings = {
        ...DEFAULT_METERING_SETTINGS,
        anon_monthly_limit: kind === "anonymous" ? 2 : 0,
      };
      h.session = kind === "member" ? {} : null;
      const data = protectedArticle("paid");
      mount(data);
      expect(h.meter).toHaveBeenCalledWith("post", data.item.id, kind !== "registration-required");
    },
  );
  it("uses unlocked content and meter feedback without a paywall", () => {
    h.metered = {
      body: {
        content_pl: "<p>Meter granted</p>",
        content_en: null,
        blocks_data: null,
        builder_data: null,
      },
      settled: true,
      meter: {
        granted: true,
        consumed: true,
        used: 1,
        monthlyLimit: 3,
        remaining: 2,
        requiresRegistration: false,
        showCounter: true,
      },
    };
    mount(protectedArticle("paid"));
    expect(screen.getByTestId("content").textContent).toBe("Meter granted");
    expect(screen.getByTestId("MeterBanner")).toBeTruthy();
  });
  it.each(["ok", "expired", "exhausted", "invalid"] as const)(
    "renders the resolved gift outcome %s",
    (reason) => {
      h.giftCode = "gift-code";
      h.gifted.reason = reason;
      if (reason === "ok")
        h.gifted.body = {
          content_pl: "<p>Gift granted</p>",
          content_en: null,
          builder_data: null,
          blocks_data: null,
        };
      mount(protectedArticle("paid"));
      expect(prop("GiftBanner").variant).toBe(reason === "ok" ? "gifted" : reason);
      expect(!!screen.queryByTestId("content")).toBe(reason === "ok");
    },
  );
});
