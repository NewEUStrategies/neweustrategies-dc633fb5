# Architecture notes

Living notes on conventions and in-flight migrations that were previously
ambiguous in the codebase. Keep this current; delete sections once they stop
being decisions and become just "how it is."

## 1. Component organization

**Convention: topical/feature folders, imported by their direct path.**

Components live in a folder named after their feature or role, and are imported
from the file directly:

```ts
import { AppLink } from "@/components/atoms/AppLink";
import { KeyTakeaways } from "@/components/molecules/KeyTakeaways";
import { Header } from "@/components/header/Header";
```

The folders `atoms/` and `molecules/` are kept only as topical groupings of
small shared primitives - **not** as an atomic-design hierarchy to be expanded.
There is intentionally no `organisms/` layer.

### Why not atomic design

The repo briefly carried `atoms/` + `molecules/` + `organisms/` barrel files
(`index.ts` re-exports) as an aspirational Atomic-Design split. In practice it
was never adopted: the `organisms` barrel was empty (`export {}`), the `atoms`
barrel was imported by nobody (every atom was imported by its direct path), and
the bulk of the UI already lives in feature folders (`header/`, `footer/`,
`post/`, `search/`, `megaMenu/`, `admin/builder/…`). The half-finished barrels
were the worst of both worlds - readers couldn't trust where a component lived -
so they were removed in favour of the convention above.

### Guidelines

- New shared primitive → `atoms/` (presentational, no data fetching).
- Small composite reused across pages → `molecules/`.
- Anything feature-specific → a feature folder (`header/`, `post/`, `search/`, …).
- Import from the component file directly; do **not** add `index.ts` barrels.
- The builder admin UI keeps its own local `ui/{atoms,molecules,organisms}`
  split under `components/admin/builder/` - that one is real and consistent;
  this section is about the top-level `components/` tree.

---

## 2. Content engines (hybrid: blocks for posts, builder for pages)

> **Status:** Settled on a **hybrid** model. Posts are authored in the
> Gutenberg-style **blocks** editor by default and dropped into the post layout
> configured in `/admin/post-layouts`; the Elementor-style **builder** is
> available as an opt-in per post. **Pages** are always built with the builder.
> A short-lived experiment to consolidate posts onto the builder (the "Stages"
> recorded in §2.5) was implemented and then **deliberately rolled back** - the
> two editors do different jobs and both are kept.

### 2.0 TL;DR for content authors

Nothing here removes any way of creating content. Concretely:

- **Pages** (`/admin/pages`) are built **only** with the Visual Builder
  (Elementor-style section → column → widget composition). The blocks editor was
  never part of page creation.
- **Posts / articles** (`/admin/posts`) are written in the **Block editor**
  (Gutenberg-style) by default, then wrapped in the post layout set under
  `/admin/post-layouts`. The **Builder is also selectable** per post (editor
  dropdown) for authors who want full bespoke composition.
- The **same block editor** is additionally available **inside the Builder**
  through the `rich-text` widget, which opens the identical `PostBlockEditor` in
  a modal - so even a builder post can host block-authored article bodies.

### 2.1 Why hybrid (and not one engine)

The two editors optimize for different things, and both are wanted:

| Editor                        | Shape                          | Best for                                                                    |
| ----------------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| **Blocks** (Gutenberg-style)  | linear list of typed blocks    | article bodies - focused long-form writing dropped into a fixed post layout |
| **Builder** (Elementor-style) | section → column → widget tree | pages, landing / standalone bespoke layouts                                 |

Posts are overwhelmingly article-shaped, so blocks is the right default and the
post layout (`/admin/post-layouts`) supplies the surrounding chrome; routing
every post through the builder added friction without benefit. Pages are
layout-shaped, so the builder is the right - and only - tool there. The block
**engine** is never deleted regardless: the Builder's `rich-text` widget depends
on it (`RichTextEditor.tsx` lazy-imports `PostBlockEditor`), so it stays
first-class.

### 2.2 Data model

A post/page row carries an `editor` discriminator plus parallel content columns;
only the column matching `editor` is authoritative:

| `editor` value              | Authoritative column        | Renders via        |
| --------------------------- | --------------------------- | ------------------ |
| `"builder"`                 | `builder_data` (jsonb)      | `BuilderRenderer`  |
| `"blocks"`                  | `blocks_data` (jsonb)       | `BlocksRenderer`   |
| `"richtext"` / `"markdown"` | `content_pl` / `content_en` | HTML/markdown path |

- Posts: `type EditorType = "blocks" | "richtext" | "markdown" | "builder"`
  (`admin.posts.$slug.tsx:42`).
- Pages: `type EditorType = "richtext" | "markdown" | "builder"` -
  **no `blocks`** (`admin.pages.$slug.tsx:42`).

Inside a `builder` document, article content is stored as a `rich-text` widget
whose `content.doc` holds a `LocalizedBlocks` value - i.e. the **same** blocks
document shape, just nested under a widget instead of in the top-level
`blocks_data` column.

### 2.3 The dispatch point (grounded)

The single place that picks a render strategy is
`src/lib/content/contentEngine.ts` - `resolveContentEngine()` maps an `editor`
value (plus the matching document) to `"blocks" | "builder" | "html"`:

- `editor === "blocks"` with ≥1 block → **blocks** (article bodies)
- `editor === "builder"` with ≥1 section → **builder** (page composition)
- everything else (`richtext` / `markdown` / legacy / empty) → **html**

Components never branch on `editor` themselves - they call `resolveContentEngine`
(directly or via the `ContentRenderer` façade). The live touchpoints:

- **New posts default to `editor: "blocks"`** - `createPost`
  (`content.functions.ts`); the WordPress importer also writes `editor: "blocks"`.
- **Post editor** - `admin.posts.$slug.tsx` renders `PostBlockEditor` when
  `form.editor === "blocks"` (the default, marked "zalecane"), and offers the
  Builder + legacy rich-text/markdown as alternatives. A per-post "Konwertuj na
  bloki" button (`migratePostToBlocks`) converts a builder/legacy post to blocks.
- **Public render** - `ContentRenderer.tsx` calls `resolveContentEngine` and
  renders `<BlocksRenderer>` for blocks, `<BuilderRenderer>` for builder, or
  sanitized HTML otherwise. For posts, `routes/$.tsx` wraps the result in
  `PostLayoutRenderer`, so the `/admin/post-layouts` layout applies to **every**
  post editor type, blocks included.
- **Inside the Builder (shared engine)** - the `rich-text` widget authors via
  `RichTextEditor.tsx` (lazy `PostBlockEditor`) and renders via `RichTextView.tsx`
  (`BlocksRenderer`); `BlocksRenderer` also backs `AuthFormBlocks` and
  `GalleryBlock`.

### 2.4 Cross-engine conversion tooling (optional)

Converters exist in **both** directions, but neither runs automatically:

- **Builder/legacy → blocks (per post):** the "Konwertuj na bloki" button in the
  post editor calls `migratePostToBlocks` (`lib/posts-migrate.functions.ts`) -
  non-destructive (writes `blocks_data` + flips `editor`, source columns kept).
- **Blocks → builder (bulk):** `bun run migrate:blocks-to-builder`
  (`scripts/migrate-blocks-to-builder.ts`) plus `bun run verify:migration`
  (`scripts/verify-migration.ts`) survive from the consolidation experiment.
  They are **not** part of normal operation - blocks is the post default - but
  remain available for the rare case where a post should become a full builder
  layout. Dry-run by default; `--apply` requires a service-role key;
  non-destructive (preserves `blocks_data`); idempotent; optimistic-locked.

### 2.5 History: the consolidation experiment (reverted)

For maintainers who find leftover references: a staged plan once aimed to retire
the standalone `blocks` post mode and converge posts onto the builder. Stages 1
(new posts default to builder), 3 (drop the `blocks` option from the post editor)
and 4 (drop the `blocks` arm from the render path) were implemented, then
**rolled back** in favour of the hybrid model above - posts are article-shaped,
and the blocks editor + post layouts serve them better than a full page builder.
Stage 2 (bulk `blocks` → `builder` migration) was never run as a fleet-wide step;
its tooling survives as the optional converter in §2.4. No content was lost in
either direction - every converter preserves the source columns.

### 2.6 Editorial workflow (posts)

Posts carry the full editorial lifecycle; pages keep the simple
draft/published/archived one.

- **Statuses:** `draft -> pending_review -> published`, plus `scheduled`
  (auto-publish at `posts.publish_at`) and `archived`.
- **Roles:** authors and editors write and submit for review; only
  **admin / super_admin** (`can_publish_content()`) may set `published` or
  `scheduled`. Enforced in three layers: the editor UI (disabled options +
  review buttons), `updatePost`/`bulkUpdatePosts` (friendly errors, shared
  rules from `src/lib/content/workflow.ts`), and the `posts_workflow_guard`
  DB trigger (covers direct PostgREST writes).
- **Scheduling:** `publish_due_posts()` flips due rows to `published`
  (backdating `published_at` to the planned moment). Primary tick: pg_cron
  every minute; fallback: an opportunistic RPC call when the admin posts list
  loads. Public visibility keys off `status = 'published'` everywhere, so no
  public query changed.
- **Revisions:** `updatePost` snapshots the pre-update row into
  `content_revisions` (throttled to one per 5 min for autosaves; always on
  status transitions). `src/lib/revisions.functions.ts` lists lightweight
  projections and restores non-destructively - the live state is snapshotted
  first and the workflow status is never changed by a restore. History is
  pruned to 50 entries per entity.
- **Presence:** `useEditPresence` + `EditPresenceBanner` (Supabase Realtime
  presence) warn when two people edit the same post - a soft lock, not CRDT.

### 2.7 Guardrails

- `contentEngine` stays the **only** place that decides a render strategy. Never
  branch on `editor` inside a component - call `resolveContentEngine`.
- Both engines are first-class. Shared cross-cutting infra (sanitization,
  footnotes, render-error isolation) lives once and is used by both; don't fork
  it per engine.
- The block engine is load-bearing for the Builder's `rich-text` widget - never
  delete `PostBlockEditor` / `BlocksRenderer` / `lib/blocks` as "blocks cleanup".
- Keep `tsc --noEmit`, the test suite, and the bundle gate green.

---

## 3. Quality gates - CI runs on every PR and push to main

The `.github/workflows` (CI / E2E / Lighthouse) run on `pull_request` and
`push: { branches: [main] }` (plus manual `workflow_dispatch`). They use
GitHub-hosted `ubuntu-latest` runners - no self-hosted fleet is required - and a
`concurrency` group cancels superseded runs so a busy branch never spends Actions
minutes on stale commits. CI repoints the private-registry pins in `bun.lock` to
public npm at install time, so the exact pinned versions install in CI.

`CI` is the real gate between a merge and production. Because **`vite build` does
NOT typecheck** (esbuild strips types), the pipeline runs an explicit
`tsc --noEmit` step _before_ the build - that is the type gate, not the build.
Order: **typecheck -> test + coverage gate -> build -> bundle budget -> lint**
(all blocking; the Prettier backlog was cleared in a repo-wide format commit).
A separate `pgtap` job starts a local Supabase database (migrations + seed) and
runs the pgTAP suite (`supabase test db`): RLS tenant isolation, role
management, full-text search - the policies Vitest can never exercise.

The `E2E` workflow runs two jobs: the backend-agnostic Playwright smoke
(placeholder Supabase creds) and `e2e-seeded`, which boots a full local
Supabase stack (migrations + `supabase/seed.sql`) and sets `E2E_SEEDED=1` so
`e2e/user-paths.spec.ts` - article reading, language switch, search, staff
sign-in, crawler feeds, the 301 from `/post/<slug>` - actually executes instead
of skipping.

**Run the same gates locally before opening a PR for fast feedback:**

```bash
bunx tsc --noEmit        # types (the build will NOT catch these)
bun run test:coverage    # tests + the coverage gate
bun run build            # production build
bun run check:bundle     # gzipped bundle budget
bun run lint             # blocking - zero errors expected
bun run db:test          # pgTAP (needs a running local Supabase)
```

A change is "green" only when all of the above pass - the same bar CI enforces.

### Bundle budget: public vs overall

`check:bundle` (`scripts/check-bundle-size.ts`) splits the gzipped client JS into
three budgets rather than one blunt total, because "total app JS" conflates two
different costs:

- **PUBLIC** (≤ 1000 KB; ~930 KB today) - every chunk a public visitor can ever
  download (first load + in-session navigation). This is the perf-meaningful
  budget: what real readers pay for.
- **OVERALL** (≤ 1300 KB; ~1200 KB today) - every chunk, _including_ admin/editor
  -only code (visual builder, block editor, theme panes, `/admin` routes, builder
  drag-and-drop). A coarser backstop so the CMS surface can't balloon unnoticed,
  even though it is code-split behind the auth-gated `/admin` routes and is never
  reachable from a public URL.
- **CHUNK** (≤ 250 KB; ~181 KB today, the client entry) - largest single chunk,
  to catch a lost code-split or a giant dependency in one file.

Admin-only chunks are identified by emitted basename (`admin.*`, `Builder-`,
`PostBlockEditor`, `ThemeOptionsPane`, `AdminShell`, `sidebar`, `vendor-dnd`) and
billed to OVERALL only - keep that list in sync with `vite.config.ts` manualChunks.

---

## 4. Multi-tenant: the host -> tenant plane

One tenant = one public site = one claimed domain (`tenants.domain`, unique,
`www.`/apex aliased); exactly one tenant is `is_default` - the fallback for
previews and unclaimed hosts. Three planes consume that mapping, each with its
own failure contract:

- **Anon content plane (RLS)** - every anon policy says
  `tenant_id = public.public_tenant_id()`. Since `20260703120000` that
  function is host-aware: it reads the `x-tenant-host` request header
  (`public.request_public_host()`), matches `tenants.domain` and falls back to
  the default tenant. The header is attached by every Supabase client in
  `src/integrations/supabase/`: the browser singleton and the per-request /
  per-call server clients all route through `tenant-host-fetch.ts`
  (`fetchWithTenantHost`), which resolves the host via
  `src/lib/http/requestHost.ts` (browser: `location.host`; SSR: the active
  request). The header is client-controlled BY DESIGN - it only selects which
  tenant's PUBLISHED content is read and where anon public INSERTs (newsletter,
  contact) are attributed; staff/private access is pinned by
  `current_tenant_id()` (profile-based) and ignores it. Unknown host ->
  default tenant, so previews render (fail-open on purpose).
- **Crawler plane (service role)** - sitemap.xml, rss.xml, news-sitemap.xml,
  llms.txt, robots.txt and the redirect/404 middleware read with the service
  role (RLS bypassed), so they scope queries by
  `resolveCrawlerTenantForHost()` (`src/lib/server/tenant.server.ts`), which
  FAILS CLOSED: unknown hosts get 404 / `Disallow: /` unless the host is a
  local/platform preview (`isPreviewHost`, `src/lib/http/host.ts`) or no
  tenant has claimed any domain yet (single-tenant bootstrap).
- **SSR edge cache** - `edgeTtlCache` (`src/lib/ssrCache.ts`) transparently
  scopes every entry by the request host, so a cache warmed for tenant A's
  domain can never be served on tenant B's - callers cannot forget the scope
  because they never write it.

Provisioning follows the same doctrine (`handle_new_user`,
`20260703120200`): client signups are always readers in the default tenant;
creating a tenant + admin requires `signup_type='staff'` in
`raw_app_meta_data`, which only the service role can write. The `tenants` row
itself is guarded at the privilege layer (`20260703120300`): tenant admins may
UPDATE only `name`; `slug`, `domain` and `is_default` (the routing surface)
are service-role-only.

pgTAP coverage: `supabase/tests/host_tenant_resolution_test.sql`,
`signup_provisioning_test.sql`, `tenants_update_grants_test.sql`; TS coverage:
`src/lib/http/__tests__/host.test.ts`,
`src/lib/server/__tests__/tenantResolver.test.ts`,
`src/lib/__tests__/ssrCacheHostScope.test.ts`,
`src/integrations/supabase/__tests__/tenantHostFetch.test.ts`.

---

## 5. Warstwa spójności między modułami (szyna zdarzeń domenowych)

> **Status:** wdrożona (migracje `20260711200000`-`20260711204000` + `src/lib/realtime/`).
> Moduły (content, komentarze, czat, CRM, newsletter) komunikują się przez JEDNĄ
> szynę zdarzeń zamiast nasłuchiwać nawzajem swoich tabel.

### 5.1 Szyna zdarzeń (`domain_events`)

Triggery AFTER na tabelach źródłowych emitują zdarzenia `<agregat>.<czasownik>.v1`
przez `emit_domain_event()` (SECURITY DEFINER; klient nie może sfałszować
zdarzenia). Katalog typów jest kontraktem: frontendowa lista
`DOMAIN_EVENT_TYPES` (`src/lib/realtime/domainEvents.ts`) musi pokrywać się
z emiterami - pilnuje tego test kompletności mapy inwalidacji.

- RLS: staff czyta zdarzenia swojego tenanta; zwykły użytkownik tylko te,
  których jest aktorem (wystarcza do potwierdzeń optymistycznych mutacji).
- Retencja 90 dni (`prune_domain_events`, pg_cron 03:20).
- **Nie dopisuj konsumenta bez reguły w `eventInvalidationMap.ts`** - to jedyne
  miejsce mapujące `event_type -> queryKey[]`.

### 5.2 Realtime frontendowy

- `tableChannelHub.ts` - wspólny, zliczany referencyjnie kanał postgres_changes
  per (schema, table, event, filter). Hooki (`useNotificationsRealtime`,
  `useChatListRealtime`, liczniki, graf) NIE tworzą własnych kanałów.
- `useDomainEventStream` / `useModuleRealtime(moduleKey)` - strumień zdarzeń
  per agregat/moduł, debounce + wstrzymanie inwalidacji przy ukrytej karcie.
- `CohesionLiveSync` (montowane w `__root`) - globalny konsument dla
  zalogowanych; anonimowi nie trzymają websocketów (kwoty połączeń - ta sama
  doktryna co `SiteSettingsLiveSync`).

### 5.3 Korelacja i optymistyczne mutacje

Mutacja w `runWithCorrelation` wysyła nagłówek `x-correlation-id`
(`correlation-fetch.ts` w kliencie Supabase); emitery zapisują go w
`domain_events.correlation_id`. `get_correlated_events(id)` zwraca pełny ślad
"co się wydarzyło po moim kliknięciu". `useEventConfirmedMutation` łata cache
optymistycznie i wycofuje łatkę, jeśli w oknie (domyślnie 3 s) nie przyjdzie
potwierdzające zdarzenie z tym samym correlation_id.

### 5.4 Graf powiązań i wzmianki

`cross_references` to jeden graf relacji między encjami modułów; krawędzie
dopisują triggery (komentarz->post, notatka->lead) oraz procesor wzmianek
`process_mentions` (parsowanie `@slug` PO STRONIE BAZY na comments/messages/
crm_lead_notes: krawędź `mention` + `enqueue_notification` + zdarzenie
`mention.created.v1`). Panele czytają `get_linked_items` (obie strony relacji,
etykiety rozwiązane w bazie) przez `useLinkedItems` / `LinkedItemsCard`.

### 5.5 Liczniki, presence, idempotencja, integracje

- **Liczniki:** `user_pending_counters` (notifications_unread, chat_unread) i
  `tenant_pending_counters` (comments_pending, crm_leads_new) utrzymywane
  triggerami; `useUnreadCount` czyta licznik zamiast COUNT(\*). Dryf naprawia
  `recompute_my_pending_counters()`.
- **Presence:** `useEntityPresence(entityType, entityId)` uogólnia
  `useEditPresence` (posty/strony bez zmian - ta sama przestrzeń kanałów);
  `PresenceIndicator` pokazuje obecnych np. na leadzie CRM.
- **Idempotencja:** `command_idempotency` + `claim_command`/`complete_command`;
  helper `withCommandIdempotency` (`src/lib/http/idempotency.ts`), wzorcowe
  użycie: `addCrmNote`. Klucz generuje frontend per AKCJA użytkownika.
- **Workflowy:** `workflow_definitions` (trigger_event_type + condition
  `@>` + steps) wykonywane triggerem na szynie; katalog przepisów w
  `workflow_templates` (`install_workflow_template`; nowy tenant dostaje
  flagowe przepisy automatycznie - trigger na `tenants`). Flagowe: newsletter
  confirmed -> lead CRM; post published -> notyfikacje obserwujących; lead won
  -> notyfikacja staffu; comment pending -> notyfikacja moderacji.
- **Fix przy okazji:** `enqueue_notification` przypina notyfikację do tenanta
  ODBIORCY (migracja `20260711205000`) - wcześniej zgadywał tenant z kontekstu
  żądania, więc każda notyfikacja triggerowa (bez HTTP) dla tenanta innego niż
  domyślny była cicho odrzucana przez guard `notifications_enforce_tenant`.
- **Integracje wychodzące:** router (trigger na `domain_events`) fanoutuje do
  `integration_deliveries` per `integration_endpoints` (filtr event_types);
  dispatcher `dispatchIntegrationDeliveries` (HMAC-SHA256, backoff, dead po 8
  próbach) tyka opportunistycznie przy wejściu staffu do /admin/crm oraz
  cronem jobs-tick. **Adaptery formatów** (`src/lib/integrations/formats.ts`,
  czyste funkcje + testy): `integration_endpoints.integration` wybiera format
  payloadu - `webhook` wysyła surową kopertę 1:1 z podpisem HMAC (stabilny
  kontrakt), `slack` renderuje Block Kit (incoming webhook, bez podpisu),
  `hubspot` robi upsert kontaktu po e-mailu przez CRM v3 batch API (URL w
  konfiguracji to baza API, sekret z Vault jako token Bearer; zdarzenia
  niekontaktowe są świadomie pomijane jako sukces, brak tokenu = failed).
  `gcal`/`confluence` spadają do generycznej koperty. Braki konfiguracyjne
  (`tenant_id` przy INSERT z panelu) domyka migracja `20260721110000`.

pgTAP: `supabase/tests/cohesion_layer_test.sql`; TS:
`src/lib/realtime/__tests__/*`, `src/lib/http/__tests__/idempotency.test.ts`,
`src/lib/__tests__/i18nCohesion.test.ts`.

## 6. Podcast: sieć programów (nie płaska lista plików)

Podcast jest modelowany jako **katalog odrębnych programów** (wzorzec RUSI/think-tank),
a nie pojedynczy strumień odcinków. Model danych:

```
program (podcast_shows)
├── sezony ── odcinki       (podcasts.show_id + season/episode_number)
├── prowadzący / goście     (podcast_episode_people, opcjonalnie profil eksperta)
├── specjalizacja           (podcasts.category_id -> categories)
├── rozdziały               (podcasts.chapters   jsonb)
├── cytaty do udostępnienia (podcasts.quotes     jsonb)
└── źródła i materiały       (podcasts.resources  jsonb, kind: source|related)
```

- **Serie ≠ odcinki.** `podcast_shows` to program (status/RLS jak w `podcasts`).
  Odcinek wskazuje program przez `podcasts.show_id` (NULL = luzem). Powiązania
  addytywne: istniejące odcinki i globalny kanał RSS działają bez zmian.
- **Ludzie.** `podcast_episode_people` (rola `host|guest`). `profile_id` linkuje
  do profilu eksperta - to on napędza agregację odcinka na `/author/$slug`;
  gość zewnętrzny funkcjonuje po `display_name` + opcjonalnym `url`. Zapis w
  adminie strategią "zastąp wszystko" (delete + insert per odcinek).
- **Warstwy odcinka** (`chapters`/`quotes`/`resources`) to kolumny jsonb;
  kształt egzekwują defensywne parsery w `src/lib/podcast/types.ts`
  (`parseChapters`/`parseQuotes`/`parseResources`) - złe wpisy odpadają zamiast
  wywracać UI. Rozdziały sterują odtwarzaczem przez `PodcastPlayer.registerSeek`.
- **Trasy.** `/podcasts` (katalog: programy + najnowsze odcinki, `podcasts.index.tsx`),
  `/podcasts/$show` (program: sezony + prowadzący), `/podcast/$slug` (odcinek).
- **RSS osobno dla całości i per program.** Sieć: `/podcast/rss.xml`
  (`fetchPublishedPodcasts`). Program: `/podcasts/$show/rss.xml`
  (`fetchPublishedShowBySlug` + `fetchPublishedPodcastsByShow`). Oba przez
  service role, fail-closed po hoście tenanta, wspólny builder
  `src/lib/seo/podcastRss.ts`. Programy i odcinki są też w `sitemap.xml`.
- **Agregacja.** Sekcja "Podcasty" pojawia się na profilu eksperta
  (`podcastsByProfileQueryOptions`: występy + autorstwo) i na stronie
  specjalizacji/kategorii (`podcastsByCategoryQueryOptions`), przez wspólny
  `src/components/podcast/PodcastEpisodeStrip.tsx`.
- **JSON-LD.** Program emituje `PodcastSeries`, odcinek `PodcastEpisode`.

## 7. Lead scoring CRM (behawioralny, decay czasowy)

Skrzynka leadów (`/admin/crm`) niesie **lead score** liczony w bazie z sygnałów
platformy - bez nowego zbierania danych, wyłącznie z tego, co już płynie przez
szynę zdarzeń i tabele modułów.

- **Liczenie w bazie, jedno źródło prawdy.** `compute_crm_lead_score(lead_id)`
  (SECURITY DEFINER, migracja `20260718130000`) sumuje sygnały:
  - **behawioralne z decay** (półokres konfigurowalny): `email_open`,
    `email_click` (z `newsletter_campaign_events` po e-mailu subskrybenta),
    `page_view` (`post_views`, tylko zalogowani; migracja `20260721113000` -
    trigger dławiony do pierwszej odsłony użytkownika w oknie godziny, bo to
    sygnał wysokowolumenowy), `contact_form` (`contact_messages`),
    `event_rsvp`, `resource_download`, `comment`, `purchase` (`user_purchases`
    active), `donation`. Wkład zdarzenia maleje wykładniczo:
    `0.5^(wiek_dni / half_life_days)`, z sufitem per sygnał.
  - **statusowe/fit bez decay**: `newsletter_confirmed`, `marketing_consent`,
    `has_company`, `has_position`, `has_phone`, `has_linkedin`.
  Wynik → pasmo `hot|warm|cool|cold` wg progów tenanta. Wagi/sufity/progi/decay
  konfiguruje admin w `crm_scoring_settings` (RLS: read staff, write admin);
  domyślne wagi żyją w `crm_scoring_default_weights()` i są lustrzane w
  `src/lib/crm/scoring.ts` (test parzystości kluczy).
- **Wyjaśnialność.** `crm_leads.score_breakdown` (jsonb `[{key,count,points}]`)
  zasila kartę „Dlaczego ten wynik" (`ScoreBreakdownCard`). Kolumny
  `score`/`score_band`/`score_updated_at` pozwalają sortować i filtrować
  skrzynkę po temperaturze leada.
- **Spójność z resztą platformy.** Triggery sygnałowe są AFTER i połykają błędy
  (`EXCEPTION WHEN OTHERS`) - scoring nigdy nie psuje zapisu źródłowego.
  `compute` zapisuje wiersz **tylko przy realnej zmianie**, więc emitowany przy
  tym `crm_lead.updated.v1` (istniejący `tg_crm_leads_emit_events`) odświeża
  skrzynkę na żywo przez mapę inwalidacji - bez nowych kanałów realtime. Trigger
  na `crm_leads` jest kolumnowo zawężony do pól fit/tożsamości, a `compute`
  pisze wyłącznie kolumny `score_*` → brak rekursji.
- **Follow-upy/zadania (`crm_tasks`, migracja `20260721120000`).** Zadania per
  lead (termin, przypisanie, `open|done|cancelled`); trigger utrzymuje
  `crm_leads.follow_up_at = MIN(due_at)` otwartych zadań (istniejąca kolumna
  i eksport CSV dostają realne dane). Przypomnienia robi skaner watermarkowy
  `run_crm_task_reminders()` (wzorzec `run_event_reminders`): pg_cron co 10
  min + jobs-tick + `community-cron` (job `crm-task-reminders`) →
  `enqueue_notification(kind 'crm_task', href /admin/crm?lead=…&task=…)` do
  przypisanego (fallback: owner leada → autor zadania) + `crm_task.due.v1` na
  szynie (outbox/Slack widzi follow-upy bez dodatkowego kodu). Przesunięcie
  terminu otwartego zadania w przyszłość zeruje watermark. UI: zakładka
  „Zadania" w karcie leada + pasek „Follow-upy do zrobienia" nad skrzynką;
  deep-link `?lead=&task=` otwiera kartę na zakładce zadań. **Import CSV z
  dedupem:** RPC `crm_import_leads` (staff, do 500 wierszy per wywołanie -
  klient stronicuje) reuse'uje `crm_upsert_from_form` (merge po `email_norm`,
  unia tagów, source `import`); dialog importu dzieli parser CSV z
  newsletterem (`src/lib/csv/parseCsv.ts`). pgTAP:
  `supabase/tests/crm_tasks_followups_test.sql`.
- **RPC panelu:** `recompute_crm_lead_score` (pojedynczy, guard `is_staff` +
  tenant) i `recompute_crm_lead_scores` (hurtowo po zmianie wag) - to drugie
  **porcjami z kursorem po `id`** (zwraca `{processed,last_id,done}`), a klient
  pętli aż `done`: żaden pojedynczy statement nie przekracza timeoutu i obsługa
  obejmuje tenantów z >5000 leadów. Powiązanie lead→konto idzie przez
  `profiles` zawężone do tenanta (indeks `idx_profiles_tenant_email_ci`), nie
  globalne `auth.users`. Server-fn scoringu używają `requireStaff` (rola +
  step-up MFA) obok backstopu RPC/RLS. pgTAP:
  `supabase/tests/crm_lead_scoring_test.sql`; TS: `src/lib/crm/__tests__/scoring.test.ts`.

## 8. Kreator treści kampanii newslettera (EmailDoc)

Treść kampanii (`/admin/newsletter/campaigns/$id`) można komponować w kreatorze
bloków zamiast wklejać surowy HTML - ten sam wzorzec dyskryminatora `editor` co
posty/strony.

- **Model danych.** `newsletter_campaigns.editor` (`html|doc`) + `content_doc`
  (jsonb, migracja `20260718131000`). `editor='html'` renderuje legacy
  `html_pl/html_en` (pełna kompatybilność wstecz); `editor='doc'` renderuje
  `content_doc` (model `EmailDoc v1`, `src/lib/newsletter/emailDoc.ts`). Nowe
  kampanie startują jako `doc`, istniejące zostają na `html`. Zapis utrwala
  **obie** kolumny niezależnie od `editor` (jak `blocks_data` + `builder_data`
  w postach), więc przełączanie doc↔html i zapis nigdy nie kasuje pracy w
  drugim silniku. Wysyłka `doc` przerywa się (markFailed) zamiast wysyłać maile
  bez absolutnego origin (zepsute linki / brak wypisu RFC-8058) lub z pustym
  renderem w obu językach.
- **Bloki** (liniowa lista, e-mail-safe): `heading`, `paragraph`, `image`,
  `button`, `divider`, `spacer`, `quote`, `post-list` (najnowsze/ręcznie
  wybrane wpisy), `footer-note`. Teksty dwujęzyczne (`{pl,en}`) - jeden dokument
  wysyła się w języku subskrybenta. Parser defensywny (złe bloki odpadają).
- **Renderer.** `renderEmailHtml.ts` to **czysta** funkcja → tabele layoutowe +
  style inline (klienty pocztowe). Ten sam kod renderuje podgląd w edytorze
  i wysyłkę, więc „podgląd = to, co dostanie odbiorca". Blok `post-list`
  rozwiązywany jest serwerowo **w momencie wysyłki** (`emailDocResolve.ts`),
  więc „najnowsze wpisy" są świeże, nie zamrożone przy zapisie. Personalizację
  zmiennych (`{{firstName}}`…), tracking open/click i stopkę „Wypisz się"
  dokłada istniejący `renderCampaignHtml` w pipeline wysyłki - kreator ich nie
  duplikuje. Linki bloków ograniczone do http(s), teksty escapowane, HTML
  akapitu przez centralny `sanitizeHtml`.
- **Wysyłka bez zmian kontraktu.** `runCampaignSend` renderuje dokument RAZ per
  język na wywołanie (nie per odbiorca), a dalej korzysta z tej samej pętli
  porcji + dzierżawy + idempotencji per odbiorca co tryb HTML. Testy:
  `src/lib/newsletter/__tests__/emailDoc.test.ts`, `renderEmailHtml.test.ts`.
