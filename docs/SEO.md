# SEO / GEO / AEO module

How the search-, answer-engine- and AI-visibility layer is organized, what it
serves and where to extend it. Everything below shipped together with the
WordPress-migration hardening (per-entity SEO fields, redirect manager, feeds,
news sitemap, OG cards, llms.txt).

## Architecture

Pure, unit-tested builders live in `src/lib/seo/` and are consumed by three
thin layers that never re-implement logic:

- **routes** (`src/routes/*.ts[x]`) - server handlers and `head()` functions;
- **server glue** (`src/lib/server/*.server.ts`) - Supabase reads with a
  60-second per-isolate cache and graceful degradation (crawler surfaces must
  degrade, never 500);
- **admin UI** (`src/components/admin/seo/`, `/admin/redirects`,
  `/admin/settings/seo`) - the same resolution chain editors preview is the one
  crawlers receive.

| Module (`src/lib/seo/`)               | Responsibility                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `meta.ts`                             | `<head>` meta/links, hreflang, article JSON-LD (+ speakable, abstract, publisher logo), feed discovery links |
| `fields.ts`                           | Per-entity SEO override resolution (title/description/canonical/robots/og image chain)                       |
| `jsonld.ts`                           | Organization (NewsMediaOrganization), WebSite + SearchAction, localized BreadcrumbList                       |
| `redirects.ts`                        | Path normalization, exact/query/wildcard matching, chain resolution, CSV import/export                       |
| `rss.ts`, `newsSitemap.ts`, `llms.ts` | RSS 2.0, Google News sitemap and llms.txt document builders                                                  |
| `serp.ts`                             | Pixel-width SERP metrics (Google truncates by px, not chars) for the admin preview                           |
| `ogCard.ts` + `ogCardCanvas.ts`       | 1200x630 OG-card layout (pure) + browser canvas renderer/uploader                                            |
| `settings.ts`                         | Site-wide SEO settings schema (site_settings key `"seo"`) + AI-crawler policy                                |

## Public surfaces

| URL                       | Notes                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `/sitemap.xml`            | Published pages + posts, hreflang alternates, excludes `seo_noindex`                |
| `/sitemap`, `/en/sitemap` | HTML site map: page tree (`buildPageTree`), categories, latest posts                |
| `/news-sitemap.xml`       | Google News: last 48h only, per-language entries                                    |
| `/rss.xml`, `/en/rss.xml` | Language-addressed feeds (excerpt-only - paywall-safe); `/feed` 301s for WP readers |
| `/llms.txt`               | Site guide for AI assistants (GEO / zero-click citations)                           |
| `/robots.txt`             | Advertises all of the above + admin-managed AI-crawler policy                       |

## Per-entity SEO fields

`posts` and `pages` carry `seo_title_pl/en`, `seo_description_pl/en`,
`seo_canonical_url`, `seo_noindex`, `seo_og_image_url`,
`og_image_generated_url` (migration `20260702130000_seo_toolkit.sql`). Rules:

- overrides never fall back across languages (a PL snippet must not surface an
  EN-only override); derived values (title/excerpt) keep their cross-language
  fallback;
- the site-name suffix applies to DERIVED titles only - explicit SEO titles
  render verbatim (Yoast semantics);
- a canonical override suppresses the hreflang cluster (a page pointing its
  canonical elsewhere must not claim language alternates);
- `seo_noindex` also removes the URL from sitemap, news sitemap, RSS and
  llms.txt;
- og:image chain: manual override → cover → generated card → site default.

The editor panel (`SeoPanel`) is embedded in both editors' details step with a
live Google preview, pixel meters and the OG-card generator (canvas-rendered in
the admin browser, uploaded to the `media` bucket - zero server runtime
dependencies, deliberately not a server endpoint because the deploy target is a
Cloudflare worker without native image rasterization).

The fields apply to EVERY content engine (builder / blocks / richtext /
markdown) - they live on the `posts`/`pages` rows, and the universal resolver's
head() consumes them regardless of how the body renders. The static homepage
(a builder page selected in reading settings) resolves its own SEO fields in
`src/routes/index.tsx` head(); pages additionally feed their excerpts (the
pages editor's "meta description" field) into the emitted description.

**Content overview** - `/admin/seo` lists every post and page (tenant-scoped)
with per-language description sources, social-image source, overrides, noindex
and a transparent 0-100 completeness score (pure rules in
`src/lib/seo/contentStatus.ts`); the summary tiles double as filters.

## Redirect manager

`redirects` table → matched by `redirectMiddleware` in `src/start.ts` (runs
before routing on GET/HEAD, 30s rule cache per isolate, fire-and-forget hit
counter). Matching semantics (see `src/lib/seo/redirects.ts`):

1. exact `path?query` (WP shortlinks like `/?p=123`),
2. exact `path` (case/trailing-slash-insensitive),
3. longest-prefix wildcard (`/old/*` → `/new/*`),
4. chains are pre-resolved (one visible hop), loops refuse to redirect,
5. `/en/...` retries the language-stripped path and re-prefixes the target,
6. 410 serves a cacheable "gone" page; `/admin`, `/api`, `/_` are never
   redirect sources.

Redirects are created automatically by: publishing-slug/parent changes
(`content.functions.ts`, wildcard for whole page subtrees), the WordPress
importer (original `wp.URL` → new canonical path) and the 404 monitor's
one-click action. Manual CRUD + CSV import/export live in `/admin/redirects`.
Document 404s are recorded (rate-limited, asset probes filtered) into
`seo_404_hits` and surfaced there.

## Site-wide settings

`site_settings` key `"seo"` (`/admin/settings/seo`): title suffix, RSS on/off +
item count, news sitemap + publication name, llms.txt toggle, AI-crawler policy
(search vs training crawlers), Organization `sameAs`, publisher logo,
`twitter:site`. Parsed everywhere through `parseSeoSettings` (partial blobs
merge over defaults; corrupted rows fall back to defaults).
