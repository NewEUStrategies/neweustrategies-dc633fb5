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
- Keep Kinetic Signal Notch labels as a no-wrap row (signal bars + title) with the action floating above it, left-aligned and close to the row, and with no top padding on the shell (`pb-2` on wide widgets, `pb-1` in the compact pill) so the action starts flush with the widget's top edge; its gray tone comes from the `--nes-kinetic-action` token, and its font size and weight must be declared through the `[data-w-id][data-w-id][data-w-id] .nes-kinetic-shell .nes-kinetic-action` selector with `!important` (covering the inner spans too) _and_ `data-typography-exempt` on the action and its children, to defeat Theme Design description sizing (`[data-description-root]`, 0-4-0) and descendant weights (`:is(p, span, a, ...)`); the action carries a single trailing hairline north-east arrow `↗` (shared `NorthEastArrow`) after the label; text glyphs "›"/"⟶" stay for the explicitly chosen chevron/long options, and arrow "none" removes the mark), sized at about three quarters of the label em minus 1 px (`height: calc(0.75em - 1px)`, `width: calc(0.85em - 1px)`, no vertical offset class) so it tracks the label's type size, never exceeds the letters, and sits exactly on the x-height-to-baseline band, and inherits its color, while its stroke is a deliberately thin hairline that never bolds up (`strokeWidth` 0.85 px, 0.7 px in the compact pill + `vector-effect="non-scaling-stroke"`, with the polyline inset from the edges of its em box) so the mark stays a subtle tick at any type size, and hover pushes the chevron right; container-based tightening for narrow widgets keeps bars, title, and action visible without overlap; the action never carries an underline (`.nes-kinetic-action` pins `text-decoration: none`, which also stops an underline set on the whole widget from propagating into it), and the variant draws no rule under the row until the editor's "Show rule" toggle turns it on (`showRule` defaults off for this variant alone, so other variants keep their line).
- Render the section-label action arrow from the shared `NorthEastArrow` component (slider dots keep `AngleChevron` < >) - a hairline diagonal with an open corner, sized at about three quarters of the label em minus 1 px with `vector-effect="non-scaling-stroke"` - so the default arrow option reads as a premium "↗" in every widget; text glyphs "›"/"⟶" remain only for the explicitly chosen chevron/long options, and "none" removes the mark entirely.
- Use `kinetic-signal-notch` as the default and template variant for every CMS Builder `section-label`, so existing backfilled pages and newly created pages share one section-heading treatment while slider navigation keeps its dedicated angle chevrons.

- Reuse homepage chrome in AuthPortal for consistent switches.
- Use BrandIcon and brandTile on member profiles for admin icons and expert-style interactions.
