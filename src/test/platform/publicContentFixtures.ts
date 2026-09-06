import type { PostData, ResolvedContent } from "@/lib/queries/public";
const COVER_URL = "https://media.example.com/storage/v1/object/public/covers/atom.jpg";

export function postItem(overrides: Partial<PostData> = {}): PostData {
  return {
    id: "post-1",
    slug: "atom",
    title_pl: "Atom w Europie",
    title_en: "Atom in Europe",
    content_pl: null,
    content_en: null,
    excerpt_pl: "Zapowiedź analizy po polsku.",
    excerpt_en: "Analysis teaser in English.",
    editor: "richtext",
    builder_data: null,
    cover_image_url: COVER_URL,
    published_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    seo_title_pl: null,
    seo_title_en: null,
    seo_description_pl: null,
    seo_description_en: null,
    seo_canonical_url: null,
    seo_noindex: false,
    seo_og_image_url: null,
    og_image_generated_url: null,
    takeaways_pl: [],
    takeaways_en: [],
    takeaways_variant: null,
    read_minutes: 7,
    post_format: "standard",
    layout_overrides: null,
    custom_meta: null,
    related_override: null,
    author_id: "author-1",
    toc_override: null,
    audio_url_pl: null,
    audio_url_en: null,
    organization_id: null,
    organization_name: null,
    organization_logo_url: null,
    organization_website: null,
    is_sponsored: false,
    sponsored_kind: null,
    sponsored_advertiser_name: null,
    sponsored_advertiser_url: null,
    sponsored_payer_name: null,
    sponsored_note_pl: null,
    sponsored_note_en: null,
    sponsored_affiliate: false,
    sponsored_political: false,
    sponsored_political_process: null,
    sponsored_sponsor_controller: null,
    ...overrides,
  };
}

type ResolvedPost = Extract<ResolvedContent, { kind: "post" }>;

/**
 * Okruszki podane CELOWO W ODWROTNEJ KOLEJNOŚCI GŁĘBOKOŚCI. `head()` sortuje je
 * po `depth`, a rezolwer nie obiecuje uporządkowania - test na już posortowanej
 * liście nie odróżniłby sortowania od jego braku.
 */
const CRUMBS_ODWROTNIE = [
  {
    id: "page-2",
    slug: "atom",
    title_pl: "Atom",
    title_en: "Atom",
    depth: 2,
    full_path: "analizy/atom",
  },
  {
    id: "page-1",
    slug: "analizy",
    title_pl: "Analizy",
    title_en: "Analyses",
    depth: 1,
    full_path: "analizy",
  },
];

export function resolvedPost(overrides: Partial<ResolvedPost> = {}): ResolvedPost {
  return {
    kind: "post",
    item: postItem(),
    crumbs: CRUMBS_ODWROTNIE,
    parentPageId: "page-1",
    tags: [{ slug: "energia", name: "Energia" }],
    categories: [{ slug: "analizy", name_pl: "Analizy", name_en: "Analyses", color: null }],
    author: null,
    authors: [
      {
        id: "author-1",
        slug: "anna-nowak",
        display_name: "Anna Nowak",
        first_name: "Anna",
        last_name: "Nowak",
      },
    ],
    access: null,
    ...overrides,
  };
}
