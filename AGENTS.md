# Architecture rules

- Render minimized chats from the shared session-backed store, with a maximum of three avatar bubbles on mobile and compact pills on desktop, so restoration state stays consistent across responsive surfaces.
- Derive article table-of-contents activity from heading geometry in one animation-frame-throttled scroll listener, because narrow IntersectionObserver bands skip sections during fast scrolling.
- Build article-audio controls from shared stateful icon atoms, so the sidebar widget and global audio bar preserve identical geometry, animation, and theme contrast.
- Keep Kinetic Signal Notch labels as a no-wrap row (signal bars + title) with the action floating above it, left-aligned and close to the row; its gray tone comes from the `--nes-kinetic-action` token, and its font size must be declared through the `[data-w-id][data-w-id][data-w-id] .nes-kinetic-shell .nes-kinetic-action` selector with `!important`, because the per-widget Theme Design rule for `[data-description-root]` (0-4-0 + `!important`) otherwise forces the description size onto the action; container-based tightening for narrow widgets keeps bars, title, and action visible without overlap.
