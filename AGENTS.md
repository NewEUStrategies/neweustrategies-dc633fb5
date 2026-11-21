# Architecture rules

- Load ad pixels (marketing consent) and Clarity (analytics consent, consentv2) only from `ConsentScriptInjector`; keep `GTM_BLOCKLIST` covering their templates, `gclidw` and `html`, because GTM starts on analytics consent and would fire them early, twice or unconsented; verification meta goes in SSR head.

- Send Meta Pixel standard events only through `trackMetaEvent` in `src/lib/analytics/metaPixelEvents.ts` (marketing-consent gate, startup queue flushed by `ConsentScriptInjector`, sanitized non-personal params, unique `eventID`); fire outcome events after server/payment-confirmed success and payment outcomes only by consuming the `metaCheckoutMarker` written at checkout (event tickets: only after `metaTicketPurchase` reads the marked order as `paid`), so withdrawn consent stops sends, success-page revisits never re-count, and a future Conversions API path can deduplicate.

- Load the shared Google tag immediately when the Ads destination is configured after marketing consent; reuse any existing gtag script so deferred GA4 loading cannot delay Ads or duplicate the install.

- Keep concise measurement form labels separate from the versioned full consent shown at mailbox confirmation; presentation edits must not rewrite historical consent evidence or change activation rules.
- Keep signup/newsletter payloads free of measurement declarations when no explicit measurement choice is offered; account measurement information must not masquerade as a generic personalization toggle, because mailbox-confirmed measurement has its own evidence path.

- Keep streamed-boundary visibility recovery in the shared head script; drain React's shared queue when a queued frame is suspended so later frames cannot duplicate content.
- Hold any column that CSS `order` would place before a later-parsed sibling through `columnOrderGate` (hold `<style>` before the columns, release as the last child of the completing column's slot, `visibility:inherit`), and keep every other layout `<style>` (section, ticker) before the markup it lays out, so streamed HTML never paints content before its visual predecessors.

- Share plan currency formatting between pricing and checkout; derive displayed currency from each plan, not the interface language, to match provider charges without changing donation FX.

- Share archive skyline geometry and theme ink.
- Resolve legacy brand accents through the shared theme helper at display boundaries; preserve unrelated colors and data.

- Share `eh-slider-arrow` and `AngleChevron` across sliders.
- Share `EventModuleHero` across tabs, participant profile and studio preview; keep overview separate.
- Share contact limits across client/server validation and counters; preserve full CRM messages and reject oversized custom values, never slice, so displayed limits match storage.

- Keep `governance/release/main-ruleset.json` applicable to the Lovable direct-push channel (Lovable app bypass `always`, no approval a sole code owner cannot give, status checks pinned to GitHub Actions) and apply it only via `governance:apply-ruleset`; give every `main` commit its own uncancelled CI run and run `post-deploy` only after a green `Required release checks`, failing without credentials, so no green status claims an unchecked release.
- Use `tsgo --noEmit` for the preview timeout.
- Load server-only modules from client-reachable code only through `createServerOnlyFn` loaders in `src/lib/http/serverOnlyLoaders.ts`, never a raw `import()` behind an SSR guard, because the preview bundler resolves dead branches and rejects the whole client bundle.
- Keep modules loaded by `import()` under a top-level await (locale cores) in their own client chunk group above `app-initial`, so a facade re-exporting the awaiting chunk cannot deadlock hydration.
- Share date/time/select atoms and sizing tokens; preserve local dates and native form values to prevent date shifts and corrupt submissions.
- Use section-specific `adminPageHead` metadata on private admin screens to avoid generic titles.

- Use literal RPC/table names and matching grants (server-only: `service_role`; private columns outside public constants; tenant/company/user from session, never payload), for the live-schema CI gate `generate:ts-sql-contract`.
- Load speaker bio/social/contact on dialog open through the tenant-scoped detail RPC; apply existing contact visibility in SQL even in preview, to prevent admin-only PII leaks.
- Author schema changes only in `supabase/migrations` and generate `drizzle/` with `bun run migrations:mirror`; never hand-edit drizzle SQL, `_journal.json`, snapshots or the frozen `MIGRATION_LANES` (sole exception: a reviewed Claude PR raising `JOURNAL_FREEZE_IDX` with a `drizzleOnly` decision per runbook §5.4 pkt 2, never from the Lovable chat), never modify or delete a merged migration outside `MIGRATION_EDIT_ALLOWLIST`, adopt schema-changing Lovable-written journal entries in a reviewed PR per `docs/RUNBOOK_MIGRACJE_LOVABLE.md` §5 (never 0001-like harmful entries, second-registry writes or deployment triggers), and deploy only through ONE Lovable migration-tool call per deployment attempt (after a transient error only the owner re-sends, per runbook §4.6) whose SQL is exactly `COMMENT ON SCHEMA public IS 'standard public schema';` (never the migration SQL itself) after the read-only `migrations:deploy-sql --pending` check, never by file-less SQL or writes to `supabase_migrations.schema_migrations`/`drizzle.__drizzle_migrations`, so production runs exactly the SQL that CI tests, once.

- Keep club content-kind navigation in the shared rail, reuse thread-kind icons, and resolve its filter from validated URL search so workspace links and browser history stay synchronized.

- Resolve per-widget dark accents from CMS content `accentColorDark`, falling back to existing accent inversion, so instance-specific colors never override all section labels.

- Share widget typography, spacing, dimensions, borders, shadows and interaction geometry across light/dark; vary only colors and theme media to prevent layout shifts.
- Emit image intrinsic size only as plain `width`/`height` attributes resolved by the rendered URL (`theme_options.logo.intrinsic`, widget `srcIntrinsic`/`srcDarkIntrinsic`) through the shared `intrinsicSize` helper; never as inline `aspect-ratio`, computed CSS width or `ratio`, so unknown or stale sizes keep today's markup and geometry.
- Render minimized chats from the shared session-backed store, with a maximum of three avatar bubbles on mobile and compact pills on desktop, so restoration state stays consistent across responsive surfaces.
- Derive article table-of-contents activity from heading geometry in one animation-frame-throttled scroll listener, to avoid skipped sections on fast scroll.
- Build article-audio controls from shared stateful icon atoms, so the sidebar widget and global audio bar preserve identical geometry, animation, and theme contrast.
- Portal the single root-owned audio bar into the member dock's measured slot when present; keep the audio engine in the root provider so navigation and presentation changes never interrupt playback.
- Keep Kinetic Signal Notch action above its no-wrap bars/title row, flush at shell top (pb-2 wide, pb-1 compact), left-aligned with --nes-kinetic-action. Pin size/weight including spans via triple [data-w-id] specificity and !important; mark action/children data-typography-exempt. Use shared NorthEastArrow with the geometry/stroke rule below (0.7px compact), no vertical offset, inherited color and subtle hover movement; preserve explicit chevron/long/none options. Container tightening prevents overlap. Pin text-decoration:none and default showRule off only for this variant.
- Render the section-label action arrow from the shared `NorthEastArrow` component (slider dots keep `AngleChevron` < >) - a hairline diagonal with an open corner, sized at about three quarters of the label em minus 1 px with `vector-effect="non-scaling-stroke"` - so the default arrow option reads as a premium "↗" in every widget; text glyphs "›"/"⟶" remain only for the explicitly chosen chevron/long options, and "none" removes the mark entirely.
- Use `kinetic-signal-notch` as the default and template variant for every CMS Builder `section-label`, for existing/new pages; sliders keep angle chevrons.

- Share homepage/AuthPortal chrome for parity.
- Share BrandIcon/brandTile in member profiles for expert parity.
- Share AuthorByline sizing: measure the title only inside the nearest `[data-author-title-scope]` (card/slide/row) or `[data-w-id]` via the shared rAF scheduler (first pass in a layout effect; head/body theme sheets), skip `[data-author-title-ignore]`, use the CMS size where there is no title, show panel-typed sizes as typed, and keep server HTML equal to the hydrated page (CSS estimate, no `:has()`).
- Keep admin compact typography out of widget frames and post titles so the builder canvas and live previews show entered values.
- Gate club hub presentation and shared club-card viewer keys with useHydrated so settled auth cannot replace guest SSR markup before hydration.
- Stop search overflow propagation before the mobile drawer scroll root so search labels cannot disable native menu scrolling or panel clipping.
- Keep the happy-dom `Node.prototype.nodeName` shim in `vitest.setup.ts` so the pinned DOMPurify release is tested like real browsers; never pin the sanitizer below a security fix to suit the emulator.
- Strip host secrets from `process.env` in `vitest.setup.ts` via `src/test/hostSecretIsolation.ts` (tests set values with `vi.stubEnv`), so local runs match secret-less CI instead of hitting real backends.
- Serve `/mcp` and its OAuth resource metadata through hand-authored routes that delegate to `src/lib/mcp/routeHandlers.ts`, which loads the MCP SDK and definition only via `import()`; keep `auth` always configured (project issuer from build-time env, `.invalid` fail-closed fallback, OAuth client claim required) and run tools as the caller's bearer with explicit tenant/published filters and the gated content RPC, so copied app sessions, anonymous calls and drafts never reach the tools and cold starts stay light.
- Build partial-update (patch) schemas with `patchSchema` from `src/lib/validation/patchSchema.ts`, never `.partial()` on a schema with top-level defaults, because Zod 4 applies defaults inside `optional` and an autosave would silently reset status or titles.
- Before any service-role side effect (storage delete, email, outbound fetch), pin the caller's tenant from `profiles`, filter every read and write by it, and derive or allowlist the target on the server (storage origin from env, verified tenant-staff emails, active club members), because user-scoped reads behind public-read policies do not prove ownership.
- Import social/brand glyphs only from `src/lib/icons/brandIcons.ts` (nodes in `brandIconNodes.mjs`, platform core, also fed into the icon catalog together with `LEGACY_BRAND_ICON_NODES`), never from `lucide-react`, and render every brand mark through `BrandIcon` with the glyph as `fallback` (guarded by `brandIconPriority.test.ts`), because Lucide 1.x has no brand icons and icons uploaded to the icon library must always win over code glyphs.
- Fan out @mention/expert-ping channels only through `enqueue_signal_notification` (after the shared `enqueue_notification` gate) and deliver user-configured webhooks only through `deliverSignalWebhook` (shape check, `assertPublicHttpUrl` before every send, manual redirects, secret returned only on create/rotate), keeping `src/lib/notifications/signals.ts` constants mirrored to SQL, so mutes, dedup and SSRF guards apply to every channel.
- Report Google Ads/LinkedIn outcomes and the Ad pixels mirror only via `trackAdsGoal`/`trackAdsPurchase` (fan out to `trackLinkedInGoal`, purchase `event_id` = transaction), marketing-consent gated at Meta's confirmed points, GA4 imports secondary, so each outcome counts once per platform.
