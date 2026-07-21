// Publiczna powierzchnia renderera bloków (atomic design). BlocksRenderer i
// testy importują stąd, zamiast sięgać do wewnętrznych plików warstw.

export type { BlockLang, BlockRenderContext, BlockRenderer } from "./context";
export { BlockView, BLOCK_RENDERERS, type BlockViewProps } from "./registry";
export { BlocksTenantProvider, useBlocksTenantScope, type BlocksTenantScope } from "./tenant";
export { type FootnoteCollector, precomputeFootnotes, renderFootnoteHtml } from "./footnotes";
export { alignClass, sanitize, slugify } from "./data";
