# Architecture rules

- Share archive skyline geometry and theme ink.
- Resolve legacy brand accents through the shared theme helper at display boundaries; preserve unrelated colors and data.

- Share `eh-slider-arrow` and `AngleChevron` across sliders.
- Share `EventModuleHero` across tabs, participant profile and studio preview; keep overview separate.
- Share contact limits across client/server validation and counters; preserve full CRM messages and reject oversized custom values, never slice, so displayed limits match storage.

- Use `tsgo --noEmit` for the preview timeout.
- Share date/time/select atoms and sizing tokens; preserve local dates and native form values to prevent date shifts and corrupt submissions.
- Use section-specific `adminPageHead` metadata on private admin screens to avoid generic titles.

- Use literal RPC/table names and matching grants (server-only: `service_role`; private columns outside public constants; tenant/company/user from session, never payload), for the live-schema CI gate `generate:ts-sql-contract`.
- Load speaker bio/social/contact on dialog open through the tenant-scoped detail RPC; apply existing contact visibility in SQL even in preview, to prevent admin-only PII leaks.

- Keep club content-kind navigation in the shared rail, reuse thread-kind icons, and resolve its filter from validated URL search so workspace links and browser history stay synchronized.

- Resolve per-widget dark accents from CMS content `accentColorDark`, falling back to existing accent inversion, so instance-specific colors never override all section labels.

- Share widget typography, spacing, dimensions, borders, shadows and interaction geometry across light/dark; vary only colors and theme media to prevent layout shifts.
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
