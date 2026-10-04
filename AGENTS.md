# Architecture rules

- Render minimized chats from the shared session-backed store, with a maximum of three avatar bubbles on mobile and compact pills on desktop, so restoration state stays consistent across responsive surfaces.
- Derive article table-of-contents activity from heading geometry in one animation-frame-throttled scroll listener, because narrow IntersectionObserver bands skip sections during fast scrolling.
- Build article-audio controls from shared stateful icon atoms, so the sidebar widget and global audio bar preserve identical geometry, animation, and theme contrast.
