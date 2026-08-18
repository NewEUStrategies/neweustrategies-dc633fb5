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
  function is host-aware; since `20260805090000` it is also TRUST-AWARE, because
  the edge validation alone never covered direct PostgREST calls (audit
  2026-08-05 §4.1: a client holding the public anon key names another tenant's
  domain and the edge never sees the request). Three tiers:
  - **VERIFIED** - the request carries `x-tenant-assert`, an HMAC-SHA256
    assertion over `v1:<kid>:<host>:<exp>` signed with a secret known only to
    the edge (`TENANT_HOST_ASSERTION_KEY`) and the database (Vault, registered
    in `tenant_host_assertion_keys`). The host holds for any tenant.
  - **ASSERTED** - the bare `x-tenant-host` header, i.e. a client CLAIM. It is
    honoured only when it names a domain/alias registered in `public.tenants`
    (anything else is noise and never leaves `request_asserted_host()`), and for
    an AUTHENTICATED caller only when it resolves to their own home tenant -
    otherwise `current_tenant_id()` wins. **The header can never move a
    logged-in caller into a foreign tenant**; that closes at the source the
    class `20260724100000` had to patch function by function.
  - **NONE** - no header (realtime, direct SQL, background jobs) -> default
    tenant, as before.

  The headers are attached by every Supabase client in
  `src/integrations/supabase/`: the browser singleton and the per-request /
  per-call server clients all route through `tenant-host-fetch.ts`
  (`fetchWithTenantHost`), which resolves the host via
  `src/lib/http/requestHost.ts` (browser: `location.host`; SSR: the active
  request, validated - see the trusted-host contract below) and the assertion via
  `src/lib/http/tenantAssertion.ts` (browser: the `nes_tenant_assert` cookie set
  by `tenantAssertionMiddleware`, which sits ABOVE `documentCacheMiddleware` so
  `Set-Cookie` never enters a cached document; SSR: signed in place).
  Anonymous traffic stays host-aware from the claim alone BY DESIGN - it only
  selects which tenant's PUBLISHED content is read and where anon public INSERTs
  (newsletter, contact) are attributed, and forging the claim is equivalent to
  visiting that site and submitting the form. Honest limit: the assertion binds
  the HOST, not the person - anyone can fetch tenant B's public page to obtain
  one. Its job is to distinguish platform traffic from a raw API call so the
  database can degrade the latter SAFELY. Unknown host -> default tenant, so
  previews render (fail-open on purpose). With no key configured there is no
  VERIFIED tier, so logged-in callers are always pinned to their home tenant -
  a single-domain install behaves byte-for-byte as before.

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

### Trusted-host contract (the edge trust boundary)

Every SERVER-side read of "the host the visitor is browsing" goes through
`pickTrustedHost()` / `resolveTrustedRequestHost()`
(`src/lib/server/tenant.server.ts`), which validates the header pair against
`tenants.domain` instead of trusting `X-Forwarded-Host` blindly (audit
2026-08-01: "`x-tenant-host` still spoofable - no trusted proxy"). Trust
order:

1. `Host` registered in the directory (exact or `www.`/apex alias) - the
   authoritative winner: the hosting layer routes the request BY this header,
   so a client cannot point it at another tenant's domain without physically
   reaching that site;
2. `X-Forwarded-Host` registered in the directory - real proxy chains where
   the origin sees an internal `Host`; a spoofed value pointing at ANOTHER
   registered domain loses to rule 1, garbage values never validate;
3. preview hosts (`isPreviewHost`) - default-tenant surfaces, as before;
4. no claimed domain at all (bootstrap / directory unavailable) - legacy
   `X-Forwarded-Host ?? Host` order, nothing to cross-leak;
5. otherwise null - "no tenant hint": no `x-tenant-host` is injected (the DB
   falls back to the default tenant anyway) and SSR cache scopes collapse to
   one bucket instead of accepting attacker-chosen key cardinality.

Consumers behind this single choke point: `currentTenantHost()` (thus
`fetchWithTenantHost`, `edgeTtlCache` scoping, tenant_id attribution of every
anon intake server function), `trustedPublicHost()` (NES Edge Cache document
keys, sitemap/rss/news-sitemap/llms.txt/robots.txt/AMP/taxonomy feeds URL
building), and the crawler resolvers. TS coverage:
`src/lib/server/__tests__/trustedHost.test.ts`.

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

### 5.6 Monetyzacja na szynie (migracja `20260723120000`)

Katalog cennika i cykl życia uprawnień emitują zdarzenia jak każdy inny moduł:

- **Katalog** (`membership_tiers`, `access_plans`, `pricing_audiences`,
  `pricing_faq_items`): `<agregat>.changed.v1` z `op` w payloadzie - edycja w
  panelu odświeża publiczny `/pricing` i panele w innych kartach staffu.
- **Cykl życia** (`user_subscriptions`, `membership_grants`,
  `member_organizations`, `organization_seats`, `donations`):
  `subscription.started/status_changed/updated.v1`,
  `membership_grant.granted/revoked.v1`, `organization.updated.v1`,
  `org_seat.changed.v1`, `donation.recorded/refunded.v1`. **Aktorem jest
  właściciel wiersza** (nowy parametr `p_actor_id` w `emit_domain_event`;
  domyślnie `auth.uid()`), bo zapisy robi service_role (webhook Stripe) -
  dzięki polityce `domain_events_actor_select` kupujący dostaje inwalidację
  cache (warstwa, paywall, profil) w czasie rzeczywistym, a workflowy i router
  integracji mogą reagować na sprzedaż/anulowania.
- **Klucze zapytań monetyzacji żyją w JEDNEJ fabryce**
  `src/lib/billing/keys.ts` (`billingKeys`) - te same stałe konsumują hooki,
  mutacje paneli i mapa inwalidacji; klucze per-user niosą uid (doktryna
  `chatKeys`).
- **Spójność mostka plan->warstwa:** `access_plans.tier_key` waliduje trigger
  (nieznany klucz = wyjątek `23503`), zmiana `membership_tiers.key` kaskaduje
  na plany, a usunięcie warstwy odpina plany (`tier_key = NULL`) - plan
  pozostaje widoczny w sekcji planów osieroconych na `/pricing`.
- **CRM widzi członkostwo:** server fn `getCrmLeadMembership` (dopasowanie
  lead->profil po e-mailu w tenancie) + czysty resolver
  `src/lib/crm/membershipSummary.ts` (lustro `current_membership_tier`,
  testowane jednostkowo) zasilają kartę `LeadMembershipCard` przy leadzie;
  zdarzenia subskrypcji/nadań/organizacji odświeżają ją na żywo.
- **Strażnicy dryfu:** `tierCatalogParity.test.ts` (TIER_RANKS i
  TIER_CAPABILITIES vs seed `pricing_catalog_v3_rows`, segmenty cross-sell),
  plus istniejący `domainEventCatalog.test.ts` wymusza katalog i regułę
  inwalidacji dla każdego nowego emitera.
- **Cykl rozliczeniowy i zmiany subskrypcji** (migracje `20260723150000/151000`):
  enum `plan_interval` zna kwartał (Stripe: `interval=month, interval_count=3`
  przez `stripeRecurringFor`; matematyka okresów w `periodEndFor` z klamrą
  końca miesiąca). Samoobsługowy upgrade/downgrade robi server fn
  `changeSubscriptionPlan` - Stripe-first (`proration_behavior=always_invoice`,
  `payment_behavior=error_if_incomplete`: nieudana dopłata NIE zmienia planu),
  cena wyrażana w walucie subskrypcji (parytet PLN/EUR), a zdarzenie
  `subscription.updated.v1` z `plan_changed` odświeża warstwę/paywall.
- **Rejestr dokumentów rozliczeniowych** `billing_documents` (RLS: właściciel +
  staff tenanta; zapis tylko webhook): faktury z checkoutu i KAŻDEGO odnowienia
  (`invoice.payment_succeeded` niesie komplet metadanych), paragony płatności
  bez faktury (`charge.receipt_url`), refund oznacza dokumenty. Podgląd/PDF to
  trwałe linki Stripe; profil (/profile/orders) renderuje rejestr, a
  `billing_document.issued/updated.v1` odświeża go na żywo.

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

## 9. Gift Articles - podarowane wpisy (wzór NYT "Share full article")

Subskrybent z aktywną PŁATNĄ subskrypcją (lub warstwą `premium_content` -
site licence, grant, miejsce w organizacji) generuje dla WPISU unikalny link
podarunkowy; każdy odbiorca linku - także anonimowy - czyta pełną treść bez
paywalla. Goście i konta bez płatnej subskrypcji widzą przycisk, ale zamiast
generatora dostają CTA logowania / planów (lejek konwersji). Wpisy w trybie
`password` są wykluczone (sekret autora, nie uprawnienie płatne).

- **Model danych** (migracja `20260722120000_gift_articles.sql`):
  `gift_article_settings` (singleton per tenant, publiczny odczyt; brak
  wiersza = włączone, bez limitu i bez wygasania; `monthly_limit` 0 = bez
  limitu, `link_ttl_days` 0 = bezterminowo) oraz `post_gift_links`
  (tenant_id, post_id, created_by, unikalny `code` base64url z
  `gen_random_bytes`, `period_month` do limitu, `redemption_count`).
  Jeden ŻYWY link per (wpis, darczyńca) - częściowy indeks unikalny;
  wygasłe linki są rotowane (stary `revoked_at`, nowy kod), historia
  i licznik odsłon zostają.
- **Ścieżka body = wyłącznie SECURITY DEFINER** (jak `get_entity_content`
  i `consume_metered_view`): `create_gift_link` (auth + `can_gift_articles()`
  - published/tenant/limit; idempotentne per wpis/darczyńca, advisory lock
    na wyścig), `redeem_gift_link(_post_id,_code)` (kod związany z TYM wpisem;
    `valid=false` bez body dla kodu obcego/wygasłego/cofniętego; odsłona
    darczyńcy nie bije licznika), `gift_article_state` (czysty odczyt dla
    popovera). RLS: darczyńca czyta własne linki, staff tenantu wszystkie;
    zapisy tylko przez funkcje.
- **Klient**: `src/lib/gifting/model.ts` (czysta domena: `buildGiftUrl`,
  `parseGiftCode`, macierz faz `resolveGiftPhase`, mapowanie błędów RPC) +
  `src/lib/gifting/hooks.ts` (react-query; realizacja kodu startuje PO
  hydracji zwykłym `useQuery`, więc crawlery nie zawyżają statystyk).
  Parametr URL: `?gift=<code>`.
- **UI**: `src/components/gifting/GiftArticleButton.tsx` (popover z Copy
  Link + kanałami zgodnymi z panelem czytania: mail/facebook/linkedin/
  whatsapp/telegram/x/reddit) osadzony w `QuickViewInfoBar` przez generyczny
  slot `trailing` (lub samodzielny wiersz, gdy pasek wyłączony);
  `GiftBanner` u odbiorcy ("artykuł podarowany" / kod nieważny) renderowany
  tylko, gdy to KOD odblokował treść (body sprzed prezentu decyduje).
  W `$.tsx` body podarunkowe wpina się w ten sam łańcuch `pickBody` co
  unlock/metering. i18n: `src/lib/i18n-gifting.ts` (PL/EN, `en: typeof pl`
  wymusza parytet kluczy). Testy: `src/lib/gifting/__tests__/model.test.ts`,
  `src/components/gifting/__tests__/*`.

## 10. Dostarczalność e-mail: suppression list z bounce/complaint

Wysyłka wiedziała dotąd tylko tyle, że dostawca **przyjął** wiadomość. Odbicia
i zgłoszenia spamu wracały do Resendu i tam zostawały, więc każda kolejna
kampania waliła w te same martwe skrzynki i w tych samych zirytowanych
odbiorców - a to jest dokładnie ten sygnał, po którym dostawcy obniżają
reputację domeny nadawczej. Wytyczne Google dla nadawców masowych wymagają
utrzymania wskaźnika zgłoszeń spamu **poniżej 0,30%** (docelowo <0,10%) i
natychmiastowego zaprzestania wysyłki na adresy, które zgłosiły spam.
Migracja `20260725120000_analytics_semantic_layer.sql (sekcja email_suppression_bounce_complaint)` domyka tę
pętlę.

- **Model danych.** `email_suppressions` - jeden wiersz na (tenant, adres),
  `email_norm` generowany z `lower(btrim(email))`, aktywna blokada =
  `released_at IS NULL AND (expires_at IS NULL OR expires_at > now())`.
  `email_delivery_events` - append-only log dostawcy, **idempotentny po
  `(provider, provider_event_id)`** (= `svix-id`), źródło prawdy metryk.
  `newsletter_campaign_recipients` zyskuje `provider_message_id` (klucz
  korelacji webhooka z odbiorcą), `delivery_state`, `delivered_at`,
  `bounced_at`, `complained_at`, `bounce_class` oraz status `suppressed`.
  RLS: odczyt wyłącznie staff własnego tenanta; anon bez GRANT-u (adres = PII);
  zapis wyłącznie przez SECURITY DEFINER RPC + service_role.
- **Klasyfikacja odbić** (`src/lib/email/deliveryEvents.ts`, czysty moduł):
  `Permanent` → hard (adres martwy, blokada trwała), `Transient` → soft
  (blokada czasowa z backoffem 1/2/4/8 dni), podtyp `Suppressed|Blocked` →
  `block`, wszystko niejednoznaczne → soft. Asymetria jest celowa: fałszywe
  trwałe wykluczenie kosztuje utraconego czytelnika, fałszywe czasowe - jedną
  próbę. Cztery miękkie odbicia eskalują do trwałego (`email_record_suppression`).
  Powaga blokady nigdy nie spada sama: późniejszy soft bounce nie zdejmuje
  blokady po skardze (`email_suppression_severity`).
- **Webhook** `POST /api/public/webhooks/resend` (`RESEND_WEBHOOK_SECRET`).
  Podpis Svix jest **obowiązkowy** - bez sekretu endpoint zwraca 503 i nie
  dotyka treści, bo inaczej byłby to publiczny sposób na wpisanie dowolnego
  adresu na listę wykluczeń. Weryfikacja: HMAC-SHA256 nad `id.timestamp.body`,
  porównanie w stałym czasie, okno tolerancji 5 min (anty-replay), obsługa
  kilku podpisów naraz (rotacja sekretu). Tenant NIE pochodzi z treści
  webhooka: ustala go korelacja po `provider_message_id` zapisanym w chwili
  wysyłki, a w ostateczności **jednoznaczne** dopasowanie adresu (przy
  wieloznaczności zdarzenie zapisuje się bez tenanta zamiast trafić do obcego
  workspace'u). Otwarcia/kliknięcia z webhooka **nie** dolewają się już do
  `newsletter_campaign_events` - patrz §11.6.
- **Egzekwowanie przy wysyłce.** `runCampaignSend` filtruje porcję odbiorców
  przez `email_filter_suppressed` (jedno zapytanie na paczkę) ZANIM powstanie
  pierwszy request do dostawcy; pominięci lądują w logu ze statusem
  `suppressed`. Ta sama bramka obowiązuje double opt-in
  (`subscribeToNewsletter` → `suppressed`, formularz pokazuje zlokalizowany
  komunikat) oraz - od migracji `20260731120000` - **każdy** mail transakcyjny i
  każdy digest (patrz §11). Blokady czasowe świadomie NIE blokują nowego zapisu
  ani wiadomości transakcyjnej - problem był chwilowy.
- **Bramka reputacji.** `src/lib/email/reputation.ts` (izomorficzny, testowany)
  liczy wskaźniki i statusy `healthy|watch|critical|insufficient_data` wobec
  progów Google; `evaluateSendGate` (serwer) zatrzymuje **nową** kampanię przy
  wskaźniku skarg ≥0,30% albo twardych odbić ≥5% - z wymogiem próbki
  (`MIN_SAMPLE_FOR_GATE`), żeby jedna skarga na 20 wysyłek niczego nie blokowała.
  Kampania zaplanowana zatrzymuje się ze statusem `failed` i powodem
  `reputation_blocked` (bez człowieka nie wysyłamy „na ryzyko"); wysyłka ręczna
  pokazuje dialog świadomego potwierdzenia. Wznowienie kampanii już w locie
  bramki nie przechodzi - przerwanie w połowie jest gorsze niż dokończenie.
- **Panel** `/admin/newsletter/deliverability` (atomic design: atomy
  `SuppressionReasonBadge`/`ReputationStatusDot`, molekuła `ReputationMeter` ze
  skalą progową, organizmy `DeliverabilityPanel`/`SuppressionTable`/
  `WebhookSetupCard`). Pokazuje wskaźniki wobec progów, status pętli zwrotnej
  (czy sekret ustawiony i czy COKOLWIEK przyszło), trend dzienny na silniku
  wykresów SSR, rozbicie per kampania i listę wykluczeń z filtrami, dodawaniem
  ręcznym, eksportem CSV i zdejmowaniem blokady (opcjonalnie z przywróceniem
  subskrypcji). i18n: `src/lib/i18n-newsletter-deliverability.ts` (PL/EN,
  `en: typeof pl` wymusza parytet kluczy).
- **Testy.** pgTAP: `supabase/tests/email_suppression_test.sql` (eskalacja,
  pierwszeństwo powagi, izolacja tenantów, idempotencja webhooka, RLS/PII).
  Vitest: `src/lib/email/__tests__/` (klasyfikacja odbić, progi reputacji,
  weryfikacja podpisu Svix wraz z replayem i manipulacją payloadu).

## 11. Poczta wychodząca: jedna lista, jeden dren, runner domyślnie włączony

§10 opisuje warstwę danych dostarczalności. Ta sekcja opisuje, jak ta warstwa
jest **egzekwowana na wszystkich** ścieżkach wysyłki - bo do migracji
`20260731120000_email_suppression_unification.sql` egzekwowana była wybiórczo i
każda z czterech usterek osobno wystarczała, by poczta cicho nie wychodziła
albo wychodziła tam, gdzie nie wolno.

### 11.1 Jedna lista wykluczeń (było: dwie)

Platforma miała DWIE niezależne listy: kanoniczną `email_suppressions`
(tenant-scoped, 7 powodów, eskalacja, zdejmowanie blokady) zasilaną webhookiem
Resend i czytaną przez kampanie, oraz zaszłą `suppressed_emails` (bez tenanta,
3 powody, bez wygaśnięcia) zasilaną wypisem i webhookiem platformy, czytaną
przez pocztę transakcyjną i digesty. Skutek: **twarde odbicie nie zatrzymywało
poczty transakcyjnej, a wypis jednym kliknięciem nie zatrzymywał kampanii.**

- Rekordy zaszłości przenosi migracja (mapowanie `bounce → hard_bounce`,
  `complaint → complaint`, `unsubscribe → unsubscribe`; tenant z
  `email_resolve_tenant_for_address`, surowe wiersze zostają w
  `suppressed_emails_legacy_backup` do audytu).
- Nazwa `suppressed_emails` zostaje jako **widok zgodności** z
  `security_invoker = true` (bez tego widok obszedłby RLS tabeli źródłowej i
  wystawił adresy wszystkich tenantów) i grantami wyłącznie dla `service_role`.
  Widok pokazuje tylko AKTYWNE blokady, a `INSTEAD OF INSERT/UPDATE/DELETE`
  routuje zapisy do `email_record_suppression` - żadna ścieżka, także dopisana
  w przyszłości przez generator, nie utworzy drugiej listy.
- `email_resolve_tenant_for_address(email)`: jednoznaczny subskrybent →
  jednoznaczne konto → tenant domyślny. Wypis, webhook i mail transakcyjny
  biegną na `service_role`, gdzie nie ma ani sesji, ani nagłówka hosta.
- `email_unsubscribe_by_token(token)` robi wypis w JEDNEJ transakcji (zużycie
  tokenu globalnego albo per subskrybent, blokada `unsubscribe`, zdjęcie
  subskrypcji triggerem) i jest idempotentny - klienty pocztowe POST-ują
  one-click wielokrotnie (RFC 8058).

### 11.2 Macierz POWÓD × KATEGORIA (było: 1 z 19 typów)

Warstwa transakcyjna czytała listę, ale respektowała ją tylko dla
`newsletter_confirmed` - pozostałe **18 z 19** typów wychodziło na adresy po
twardym odbiciu i po skardze. Odwrotna skrajność jest jednak równie zła:
potraktowanie wypisu z newslettera jak zakazu wysyłki potwierdzenia płatności
odcięłoby odbiorcę od treści, które musimy dostarczyć (wykonanie umowy;
uprzedzenie o cyklicznym obciążeniu). Zgoda marketingowa ≠ obowiązek umowny.

`src/lib/email/suppressionPolicy.ts` (czysty moduł, bez I/O):

| powód blokady                                              | `bulk` (newsletter, digest) | `transactional` (płatności, dostęp, bilet)           |
| ---------------------------------------------------------- | --------------------------- | ---------------------------------------------------- |
| `complaint`, `hard_bounce`, `blocked`, `invalid`, `manual` | blokuje                     | **blokuje**                                          |
| `unsubscribe`                                              | blokuje                     | przepuszcza (wycofano zgodę marketingową, nie umowę) |
| `soft_bounce`                                              | blokuje                     | przepuszcza (problem chwilowy, blokada wygasa sama)  |

`TX_EMAIL_CATEGORY` jest `Record<TxEmailType, EmailCategory>`, więc nowy typ
maila **nie skompiluje się** bez jawnej kategorii - regresja „suppression nie
dotyczy tego typu" jest niemożliwa. Nieznana etykieta kanału surowego wpada w
`bulk` (fail-safe w stronę mniejszej wysyłki). Każde pominięcie zapisuje wiersz
`email_send_log` ze statusem `suppressed` i kodem `suppressed:<powód>` - cisza
w skrzynce odbiorcy musi być widoczna w panelu.

### 11.3 Dren kolejki (było: brak konsumenta w repo)

Cała poczta 1:1 wchodzi do pgmq przez `enqueue_email`. Konsumenta **nie było w
repozytorium**: migracja `20260728154925` opisuje zadanie cron
„process-email-queue" jako `applied dynamically by setup_email_infra`,
wskazujące na funkcję brzegową, której w repo nie ma. Świeże wdrożenie miało
więc `email_send_log` pełen wierszy `pending`, rosnącą kolejkę i cichą wywózkę
do DLQ po przekroczeniu TTL - a nadawca nic nie wiedział, bo `enqueue` zwracał
sukces.

- `src/lib/email/queueDrain.server.ts` - JEDNA implementacja: priorytet
  `auth_emails` przed `transactional_emails`, VT 60 s, TTL z
  `email_send_state`, budżet ponowień liczony po **realnych** porażkach z
  `email_send_log` (nie po `pgmq.read_ct`, bo odczyt bez próby wysyłki nie jest
  porażką), DLQ dla odmów trwałych i wyczerpanych ponowień, wspólny cooldown na
  429 oraz **ponowna** kontrola listy wykluczeń w chwili wysyłki (wiadomość
  mogła czekać w kolejce, a adres w tym czasie odbić).
- `src/lib/email/provider.server.ts` - jedna droga wyjścia poczty: gateway
  Resend (zwraca `id` wiadomości, więc pętla webhooków się domyka) z
  zapasowym nadawcą platformy. Ten sam moduł wysyła kampanie - wcześniej
  kampanie i kolejka miały dwie kopie z innym formatem błędów.
- Wpięcie w harmonogram: `runJobsTick` (pg_cron + pg_net co minutę) drenuje
  kolejkę zaraz po kampaniach, z własnym deadline'em 10 s, żeby zaległość nie
  zagłodziła push-y i przypomnień. Endpoint `POST /platform/email/queue/process`
  zostaje dla środowisk z własnym harmonogramem i **deleguje** do tego samego
  modułu.

### 11.4 Runner domyślnie włączony (było: `enabled = false`)

`job_runner_settings` startowało z `enabled = false` i pustym `base_url`, więc
świeże wdrożenie nie wysyłało w tle NICZEGO, dopóki człowiek nie znalazł
przełącznika w panelu. Wysyłka w tle jest domyślnym oczekiwanym zachowaniem
platformy pocztowej, nie funkcją opcjonalną.

- `enabled` ma `DEFAULT true`; istniejący wiersz jest włączany tylko wtedy, gdy
  nikt go nie konfigurował (pusty `base_url`) - świadomej decyzji operatora,
  który wyłączył skonfigurowany runner, nie ruszamy.
- `job_runner_base_url()`: jawna konfiguracja → domena tenanta domyślnego. Bez
  żadnej konfiguracji tick działa, jeśli tenant ma domenę.
- Telemetria: `last_tick_at`, `last_tick_status` (`dispatched|skipped|error`),
  `last_tick_error`, `tick_count` - „cisza w kolejce" przestaje być
  nierozstrzygalna między „cron nie biegnie" i „biegnie, ale endpoint odrzuca".
  `email_queue_depth()` podaje długość czterech kolejek pgmq.
- Panel (atomic design): atomy `RunnerStateBadge`/`QueueDepthStat`, organizm
  `JobRunnerCard`, rozstrzyganie stanu w czystym `src/lib/email/runnerHealth.ts`
  (`disabled` → `misconfigured` → `error` → `idle` → `running`; tick `skipped`
  NIE liczy się jako działanie). i18n: `src/lib/i18n-newsletter-runner.ts` (PL/EN).

### 11.5 Testy

- pgTAP `supabase/tests/email_suppression_unification_test.sql`: widok zgodności
  (relkind, `security_invoker`, brak dostępu anon/authenticated), routing
  zapisów do listy kanonicznej, blokada wygasła niewidoczna, `DELETE` =
  odblokowanie, rozstrzyganie tenanta (w tym niejednoznaczność), wypis obu
  rodzajami tokenu z izolacją tenantów, `enabled DEFAULT true` i wyliczanie
  adresu bazowego.
- Vitest `src/lib/email/__tests__/`: `suppressionPolicy.test.ts` (macierz +
  pokrycie wszystkich 19 typów), `queueDrain.test.ts` (podwójna wysyłka, TTL,
  budżet ponowień vs `read_ct`, 429, DLQ, pominięcie po skardze, przepuszczenie
  transakcyjnego po wypisie), `runnerHealth.test.ts` (rozstrzyganie stanu).

### 11.6 Zaangażowanie newslettera: jedno źródło, jeden wiersz na dobę

Stan zastany (sześć kolejnych audytów): `newsletter_campaign_events` nie miała
**żadnego** indeksu unikalnego - tylko `(campaign_id, kind)` i
`(tenant_id, created_at DESC)`, oba zwykłe - a pisały do niej **dwa** producenty
mierzące to samo tym samym mechanizmem: własny piksel/przekierowanie oraz
webhook dostawcy (`email.opened` / `email.clicked`). Do tego klient pocztowy
pobiera piksel wielokrotnie (podgląd, przewijanie, proxy prywatności). Skutek:
`opens` przerastało liczbę dostarczonych maili, panel pokazywał wskaźnik otwarć
**powyżej 100%**, a trigger `trg_score_on_campaign_event` zawyżał scoring leada
w CRM, bo liczy sygnały z LICZBY zdarzeń.

Domknięcie (migracja `20260814150000`) ma dwie warstwy - żadna sama nie
wystarcza:

- **Inwariant w bazie.** Częściowy indeks unikalny
  `nl_campaign_events_subscriber_day_uq` na
  `(campaign_id, subscriber_id, kind, (created_at AT TIME ZONE 'UTC')::date)`
  `WHERE subscriber_id IS NOT NULL`. Doba, nie znacznik czasu: drugie otwarcie
  tego samego dnia nie niesie informacji, otwarcie nazajutrz owszem. Częściowy,
  bo NULL-e w indeksie unikalnym są **rozłączne**, a klucz obcy
  `ON DELETE SET NULL` wyprowadza wiersze skasowanego subskrybenta z indeksu
  zamiast zderzać je ze sobą. Backfill kasuje duplikaty zastane (zostaje
  najwcześniejsze zdarzenie w dobie) - bez tego `CREATE UNIQUE INDEX` padłby.
- **Jedno źródło zapisu.** `src/lib/newsletter/engagementSource.ts` (czysty
  moduł) deklaruje, który producent jest źródłem prawdy;
  `NEWSLETTER_ENGAGEMENT_SOURCE` = `first_party` (domyślnie) albo `provider`.
  Sam indeks nie wystarcza: dwa źródła nadal ścigałyby się o ten sam wiersz,
  a `ON CONFLICT DO NOTHING` zamieniłby wyścig w nieobserwowalny szum.
  Wartość nieznana spada na domyślną - literówka nie może wyciszyć telemetrii
  w OBU ścieżkach.

Zapis idzie **wyłącznie** przez `newsletter_record_campaign_event` (SECURITY
DEFINER, tylko `service_role`): tenant z KAMPANII (nigdy z żądania), subskrybent
walidowany w tym samym obszarze roboczym, wstawienie idempotentne. Wcześniej
były to trzy rundy do bazy z oknem TOCTOU. Odczyt panelu przez
`newsletter_campaign_engagement` (admin/editor w `current_tenant_id()`) podaje
zdarzenia **i** zasięg unikalny - i to zasięg jest licznikiem wskaźnika, bo
tylko on jest współmierny z liczbą dostarczonych.

Dwie konsekwencje tego, że kubełkiem jest DOBA, a nie chwila:

- **Czas wystąpienia, nie czas zapisu.** RPC przyjmuje `p_occurred_at`, bo
  producent nie zawsze pisze w chwili zdarzenia: webhook dostawcy potrafi
  dotrzeć z opóźnieniem albo poza kolejnością. Bucketowanie po chwili ODBIORU
  rozjeżdżałoby doby w obie strony wokół północy - dwa otwarcia z tej samej doby
  dostarczone po dwóch stronach północy policzyłyby się dwa razy, a dwa z
  różnych dób dostarczone razem zlałyby się w jedno. Piksel podaje `NULL`
  (zdarzenie jest „teraz"), webhook - zweryfikowany czas wystąpienia; wartość
  z przyszłości SQL ścina do `now()`.
- **Zmaterializowany scoring trzeba przeliczyć RĘCZNIE.**
  `trg_score_on_campaign_event` jest AFTER INSERT, więc backfill kasujący
  duplikaty go nie odpala, a `crm_leads.score`/`score_band`/`score_breakdown` są
  kolumnami, nie widokiem. Migracja zbiera dotkniętych subskrybentów z
  `RETURNING`, mapuje ich na leady tym samym wiązaniem co trigger
  (`tenant_id` + `email_norm`) i woła `compute_crm_lead_score` dla każdego.
  Bez tego lead nieaktywny - a więc taki, który sam nie wygeneruje kolejnego
  sygnału - tkwiłby w zawyżonym paśmie bez końca.

Panel dostarczalności (`getDeliverabilitySetup` → `WebhookSetupCard`) podaje
listę zdarzeń webhooka ZALEŻNĄ od źródła: w trybie `first_party` bez
`email.opened`/`email.clicked` (dostawca mierzyłby to samo drugi raz), w trybie
`provider` z nimi (bez nich zaangażowanie nie zapisałoby się wcale). Obok listy
stoi zdanie mówiące, dlaczego - inaczej operator dopisuje brakujące zdarzenia
„na wszelki wypadek" i podwójne zliczanie wraca.

Testy: pgTAP `newsletter_campaign_events_dedup_test.sql` (28 asercji: kształt
indeksu, granica doby UTC, czas wystąpienia vs czas zapisu, brak przeciążenia
RPC, granica obszaru roboczego, ACL obu RPC) oraz
`newsletter_campaign_events_backfill_test.sql` (7 asercji: odtworzenie stanu
sprzed migracji przy zdjętym indeksie, dowód realnego zawyżenia scoringu,
wykonanie backfillu i przeliczenie zmaterializowanego wyniku leada). Vitest:
`src/lib/newsletter/__tests__/engagementSource.test.ts`, `trackingEvents.test.ts`,
`engagementRate.test.ts` oraz
`src/components/admin/newsletter/__tests__/CampaignEngagementCard.test.tsx`.

## 12. Harmonogram doręczeń: trzy ścieżki, jeden dyspozytor, jeden log

Dyspozytor powiadomień (`src/lib/notifications/dispatch.server.ts`: kolejka
push, digesty, przypomnienia) był kompletny i nikt go nie wołał. Przyczyna:
`job_runner_settings` rodzi się z `enabled=false` i `base_url=''`, więc
`invoke_jobs_tick()` wychodził natychmiast - pg_cron tykał w próżnię, a
`notification_push_queue` rosła w `pending`. Bez logu przebiegów awaria była
NIEODRÓŻNIALNA od pustej kolejki. Migracja `20260731110000` (plus pojednanie
`20260731130000`) zamyka to architektonicznie:

- **Jeden dyspozytor, trzy wejścia.** `runJobsTick` (pg_cron → `/jobs-tick`, co
  minutę - ścieżka podstawowa), `/api/public/community-cron` (pg_cron co 5 min +
  scheduler repo `.github/workflows/scheduler.yml`, co 5 min = 4 ticki po 60 s)
  i przycisk „Uruchom tick teraz" w panelu. Claimy są atomowe
  (`FOR UPDATE SKIP LOCKED`), więc ścieżki mogą biec równolegle bez duplikatów
  doręczeń.
- **Siatka społeczności w bazie (`20260731210000`).** Audyt „Scheduler push +
  digest" wykazał, że `community-cron` nie miał ŻADNEGO wołacza po stronie
  bazy: scheduler repo bywa wyłączony (GitHub zatrzymuje zaplanowane workflow
  po 60 dniach bez aktywności) albo nieskonfigurowany, a `runJobsTick` drenuje
  kanały społeczności dopiero PO newsletterze i drenie poczty w tym samym
  budżecie 25 s - duża kampania głodzi push do `skipped_time_budget`.
  `invoke_community_cron(p_job)` (wzorem `invoke_jobs_tick`) puka co 5 minut w
  minutach `2,7,12,…` - PRZEPLOT z oknem digestów jobs-tick (minuty podzielne
  przez 5), więc okna się przeplatają zamiast dublować w tej samej minucie.
  Własna telemetria `community_last_tick_*` (rozjazd z telemetrią jobs-tick
  lokalizuje awarię konkretnej ścieżki), sekret runnera w nagłówku
  `x-community-cron-secret` (endpoint przyjmuje go od zawsze), `x-cron-source:
pg_cron`. Samozbrojenie wyciągnięte do WSPÓLNEGO `job_runner_autoarm()` -
  dwie inline'owe kopie to klasa awarii pojednana w `20260731130000`.
- **Kontrakt w jednym module.** `src/lib/jobs/scheduler.ts` (czysty, testowany)
  trzyma nazwy jobów, nazwy źródeł (zgodne z CHECK-iem `job_runner_runs.source`)
  i progi świeżości. NIE leży w `src/lib/server/`, bo ochrona importów blokuje
  `**/server/**` w bundlu klienta, a panel admina musi liczyć stan tym samym
  kodem co endpointy. Praca serwerowa siedzi obok: `jobScheduler.server.ts`.
- **Samozbrojenie zamiast checklisty.** Dziewiczy wiersz konfiguracji uzbraja
  się sam - z domeny domyślnego tenanta (`job_runner_base_url`) albo z origin-u
  pierwszego ticku (`arm_job_runner`; baza nie zna publicznego adresu
  aplikacji, każde żądanie go zna). Ścieżka repo BOOTSTRAPUJE ścieżkę
  podstawową. Po stemplu `auto_armed_at` samozbrojenie nigdy się nie powtarza,
  więc świadome wyłączenie runnera zostaje wyłączone.
- **Heartbeat jako źródło prawdy.** Każdy przebieg zapisuje wiersz w
  `job_runner_runs` (source, job, `ok`, czas, wynik, błąd; rotacja 14 dni) i
  stempluje `job_runner_settings`. Rozjazd `last_invoked_at` (cron puknął) vs
  `last_app_run_at` (aplikacja odpowiedziała) daje jawny alert „cron puka,
  aplikacja nie odpowiada" - inaczej `pg_net` (fire-and-forget) milczy o złym
  URL-u, złym sekrecie i leżącym deploy'u.
- **Jedna telemetria, nie dwie.** Tego samego dnia zmiana z par. 11 (unifikacja
  poczty, `20260731081100` + `20260731120000`) przepisała `invoke_jobs_tick()`
  własną telemetrią (`last_tick_status` / `last_tick_error` / `tick_count`) i -
  jako późniejsza w forward-only łańcuchu - skasowała samozbrojenie, czyli
  przywróciła pierwotną awarię. `20260731130000` składa JEDNĄ funkcję z obu
  wkładów: kanoniczny `job_runner_base_url()` (alias
  `resolve_job_runner_base_url()` tylko deleguje), samozbrojenie, oba stemple
  puknięcia i JAWNY powód każdego wyjścia (`disabled`, `no_secret`,
  `no_base_url`, `pg_net_unavailable`, `error`). Wniosek na przyszłość: funkcja
  wołana przez pg_cron jest zasobem WSPÓŁDZIELONYM - każda zmiana musi ją
  składać, nie nadpisywać.
- **Panel** `/admin/community/notifications` (atomic design: atom
  `HeartbeatDot`, molekuła `SchedulerMetricTile`, organizm
  `SchedulerHealthPanel`; jeden round-trip `job_scheduler_health()` skalowany
  `current_tenant_id()`). Świeżość (`fresh` ≤ 6 min, `lagging` ≤ 20 min, dalej
  `stale`), stan każdej ścieżki, rejestr zadań pg_cron, głębokość kolejki i wiek
  najstarszego `pending`, digesty na wejściu, powód pominięcia puknięcia,
  brakujące env (VAPID / gateway e-mail - `processPushJobs` zwraca teraz
  `skipped: "vapid_not_configured"` zamiast cichego zera) i log 20 ostatnich
  przebiegów. i18n: `src/lib/i18n-admin-scheduler.ts` (PL/EN, parytet w teście).
- **Testy.** pgTAP `supabase/tests/job_scheduler_heartbeat_test.sql` (granty
  service-role-only, bramka roli na RPC zdrowia, normalizacja wejścia, reguły
  samozbrojenia, powody pominięcia, fail-open bez pg_net) i
  `supabase/tests/community_cron_schedule_test.sql` (siatka społeczności:
  granty, samozbrojenie raz i tylko dziewiczy wiersz, telemetria osobna od
  jobs-tick, job spoza kontraktu spada do `all`, wpis pg_cron z przeplotem);
  Vitest `src/lib/jobs/__tests__` (progi świeżości, parsowanie jobów i źródeł,
  wykrywanie awarii w wyniku ticku) oraz render panelu (żaden surowy klucz
  i18n, alerty przy zastoju, powód pominięcia). Operacyjnie:
  `docs/RUNBOOK_COMMUNITY.md` par. 2.

---

## 13. Zgody: jeden rejestr RODO dla CMP i komunikacji (unifikacja)

Do 2026-08 platforma miała **dwa niekomunikujące się systemy zgód** (audyt
M15/M19, "rozjazd z CMP"):

- **CMP** (`src/lib/ads/consent.ts` + `ConsentBanner`): kategorie
  `necessary/functional/analytics/marketing`, trwałość w localStorage + cookie
  `nes_cookie_consent` + `profiles.prefs.consent`. Bramkuje realny runtime
  (analityka, marketing), ale nie zostawiał żadnego śladu audytowego.
- **Rejestr RODO** (`user_consents` / `user_consent_events` + RPC SECURITY
  DEFINER `set_user_consent`): zgody komunikacji z katalogu
  (`src/lib/notifications/consentCatalog.ts`), audytowane z IP/UA/wersją/
  źródłem - ale bez wiedzy o decyzjach cookie.

Unifikacja (zasada **jednego pisarza**):

- Katalog zgód dostał kategorię `cookies` z kluczami `cookies_functional` /
  `cookies_analytics` / `cookies_marketing` (wersja `2.0` w lockstepie z
  `CONSENT_VERSION=2` CMP - pilnuje tego
  `src/lib/consent/__tests__/registryBridge.test.ts`).
- **Most** `src/lib/consent/registryBridge.ts`: każda decyzja CMP zalogowanego
  użytkownika (baner, `/profile/privacy`, centrum powiadomień, sync przy
  logowaniu) jest diffowana względem poprzedniego stanu i dopisywana do
  rejestru batchowym server-fn `setMyConsentsBulk` (IP/UA czytane po stronie
  serwera; brak zmian = zero szumu w audycie). Fire-and-forget: błąd rejestru
  nigdy nie blokuje samej decyzji cookie. Źródło decyzji
  (`cmp_banner`/`profile_privacy`/`notifications_center`/`login_sync`) ląduje w
  `user_consent_events.source`.
- **Stan runtime zgód cookie ZAWSZE zapisuje ścieżka CMP** (`setConsent`);
  rejestr jest śladem audytowym, nigdy źródłem prawdy dla bramkowania
  skryptów. `ConsentsPanel` spina kategorię `cookies` dwukierunkowo: wartość
  przełącznika z CMP, daty/wersje z rejestru, zapis przez `useConsent().save`.
- **Jedna powierzchnia**: `/profile/privacy` renderuje `ConsentsPanel`
  (cookies + podstawa prawna + komunikacja + produkt + analityka + niezmienna
  historia decyzji) oraz przycisk otwierający preferencje banera
  (`OPEN_PREFS_EVENT`). i18n PL/EN: `notifications.consents.*` w
  `src/lib/locale/{pl,en}.ts` i `profile.privacy.*` w `src/lib/i18n-profile.ts`.

Inwariant bezpieczeństwa bez zmian: `crm_consent_log` (zgody formularzowe,
e-mail-keyed) i pozostałe tabele intake przyjmują zapis wyłącznie przez
service_role / SECURITY DEFINER - bramka `check:sql-anon-insert` (inwarianty
A + B) pozostaje zielona, bo unifikacja nie dodaje żadnej polityki INSERT.

### 13.1 Retencja dowodów przy usunięciu konta (RODO x art. 74 uor)

Usunięcie konta musi jednocześnie **nie niszczyć dowodów księgowych** (art. 74
ust. 2 ustawy o rachunkowości; art. 17 ust. 3 lit. b RODO wprost wyłącza w tym
zakresie prawo do usunięcia) i **nie zostawiać osieroconych danych osobowych**
(art. 5 ust. 1 lit. e RODO). Obie tabele transakcyjne łamały to w PRZECIWNE
strony i każda z innego powodu:

- `payment_orders.user_id` miało `ON DELETE CASCADE` - `deleteUser()` wynosił ze
  sobą całą ewidencję transakcji. Naprawa: `20260803090002`.
- `user_purchases.user_id` był `uuid NOT NULL` **bez klucza obcego** - nigdy nie
  kaskadował, więc nie trafił na listę „miejsc z CASCADE" i umknął trzem
  wydaniom audytu z rzędu; po usunięciu konta wiersz zostawał z SUROWYM
  identyfikatorem osoby. Naprawa: `20260805090100`.

Kontrakt jest teraz jeden dla obu tabel: `user_id` nullowalny +
`FK ON DELETE SET NULL`, pseudonim `subject_ref` (wspólny SHA-256, więc księgi
da się uzgodnić bez danych osobowych), `anonymized_at`, `retention_until`
(31.12 piątego roku po roku transakcji, stemplowane triggerem), `retention_hold`
(kontrola/spór/chargeback) oraz `CHECK` kształtu zanonimizowanego wiersza.
Wiersze bez wartości dowodowej (porzucone szkice checkoutu, darmowe granty
dostępu) są USUWANE - trzymanie ich pięć lat nie ma podstawy prawnej.

Jeden punkt wejścia: `anonymize_accounting_evidence_for_user()` obejmuje obie
tabele w JEDNEJ transakcji; woła go zarówno ścieżka aplikacyjna
(`deleteMyAccount` -> `retainAccountingEvidence`, PRZED `deleteUser`), jak i
fail-closed trigger `BEFORE DELETE ON auth.users` (dashboard, CLI, skrypty).
Czyszczenie po terminie: `purge_expired_accounting_evidence()` w pg_cron
(`35 3 * * *`). Bramki: `src/__tests__/accountDeletionRetention.invariant.test.ts`
(statyczna, parametryzowana po obu tabelach) +
`supabase/tests/accounting_retention_test.sql`.

### 13.2 Ochrona gałęzi `main` (rekomendacja operacyjna)

Bramki CI (w tym `check:sql-anon-insert`) blokują PR-y, ale commit pchnięty
**prosto na main** weryfikują dopiero post-hoc - czerwony main zamiast
odrzuconego pusha. Domknięcie wymaga ustawienia po stronie GitHuba (nie da się
tego zwersjonować w repo): Settings -> Branches -> Branch protection rule dla
`main` z "Require a pull request before merging" oraz "Require status checks
to pass" (checki `verify` i `pgtap` z workflow CI). Do czasu włączenia reguły
gwarancją pozostaje dyscyplina PR-owa + post-hoc run CI na push do main.
