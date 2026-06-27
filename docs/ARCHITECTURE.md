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
small shared primitives — **not** as an atomic-design hierarchy to be expanded.
There is intentionally no `organisms/` layer.

### Why not atomic design

The repo briefly carried `atoms/` + `molecules/` + `organisms/` barrel files
(`index.ts` re-exports) as an aspirational Atomic-Design split. In practice it
was never adopted: the `organisms` barrel was empty (`export {}`), the `atoms`
barrel was imported by nobody (every atom was imported by its direct path), and
the bulk of the UI already lives in feature folders (`header/`, `footer/`,
`post/`, `search/`, `megaMenu/`, `admin/builder/…`). The half-finished barrels
were the worst of both worlds — readers couldn't trust where a component lived —
so they were removed in favour of the convention above.

### Guidelines

- New shared primitive → `atoms/` (presentational, no data fetching).
- Small composite reused across pages → `molecules/`.
- Anything feature-specific → a feature folder (`header/`, `post/`, `search/`, …).
- Import from the component file directly; do **not** add `index.ts` barrels.
- The builder admin UI keeps its own local `ui/{atoms,molecules,organisms}`
  split under `components/admin/builder/` — that one is real and consistent;
  this section is about the top-level `components/` tree.

---

## 2. Content engines (hybrid: blocks for posts, builder for pages)

> **Status:** Settled on a **hybrid** model. Posts are authored in the
> Gutenberg-style **blocks** editor by default and dropped into the post layout
> configured in `/admin/post-layouts`; the Elementor-style **builder** is
> available as an opt-in per post. **Pages** are always built with the builder.
> A short-lived experiment to consolidate posts onto the builder (the "Stages"
> recorded in §2.5) was implemented and then **deliberately rolled back** — the
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
  a modal — so even a builder post can host block-authored article bodies.

### 2.1 Why hybrid (and not one engine)

The two editors optimize for different things, and both are wanted:

| Editor | Shape | Best for |
| --- | --- | --- |
| **Blocks** (Gutenberg-style) | linear list of typed blocks | article bodies — focused long-form writing dropped into a fixed post layout |
| **Builder** (Elementor-style) | section → column → widget tree | pages, landing / standalone bespoke layouts |

Posts are overwhelmingly article-shaped, so blocks is the right default and the
post layout (`/admin/post-layouts`) supplies the surrounding chrome; routing
every post through the builder added friction without benefit. Pages are
layout-shaped, so the builder is the right — and only — tool there. The block
**engine** is never deleted regardless: the Builder's `rich-text` widget depends
on it (`RichTextEditor.tsx` lazy-imports `PostBlockEditor`), so it stays
first-class.

### 2.2 Data model

A post/page row carries an `editor` discriminator plus parallel content columns;
only the column matching `editor` is authoritative:

| `editor` value | Authoritative column | Renders via |
| --- | --- | --- |
| `"builder"` | `builder_data` (jsonb) | `BuilderRenderer` |
| `"blocks"` | `blocks_data` (jsonb) | `BlocksRenderer` |
| `"richtext"` / `"markdown"` | `content_pl` / `content_en` | HTML/markdown path |

- Posts: `type EditorType = "blocks" | "richtext" | "markdown" | "builder"`
  (`admin.posts.$slug.tsx:42`).
- Pages: `type EditorType = "richtext" | "markdown" | "builder"` —
  **no `blocks`** (`admin.pages.$slug.tsx:42`).

Inside a `builder` document, article content is stored as a `rich-text` widget
whose `content.doc` holds a `LocalizedBlocks` value — i.e. the **same** blocks
document shape, just nested under a widget instead of in the top-level
`blocks_data` column.

### 2.3 The dispatch point (grounded)

The single place that picks a render strategy is
`src/lib/content/contentEngine.ts` — `resolveContentEngine()` maps an `editor`
value (plus the matching document) to `"blocks" | "builder" | "html"`:

- `editor === "blocks"` with ≥1 block → **blocks** (article bodies)
- `editor === "builder"` with ≥1 section → **builder** (page composition)
- everything else (`richtext` / `markdown` / legacy / empty) → **html**

Components never branch on `editor` themselves — they call `resolveContentEngine`
(directly or via the `ContentRenderer` façade). The live touchpoints:

- **New posts default to `editor: "blocks"`** — `createPost`
  (`content.functions.ts`); the WordPress importer also writes `editor: "blocks"`.
- **Post editor** — `admin.posts.$slug.tsx` renders `PostBlockEditor` when
  `form.editor === "blocks"` (the default, marked "zalecane"), and offers the
  Builder + legacy rich-text/markdown as alternatives. A per-post "Konwertuj na
  bloki" button (`migratePostToBlocks`) converts a builder/legacy post to blocks.
- **Public render** — `ContentRenderer.tsx` calls `resolveContentEngine` and
  renders `<BlocksRenderer>` for blocks, `<BuilderRenderer>` for builder, or
  sanitized HTML otherwise. For posts, `routes/$.tsx` wraps the result in
  `PostLayoutRenderer`, so the `/admin/post-layouts` layout applies to **every**
  post editor type, blocks included.
- **Inside the Builder (shared engine)** — the `rich-text` widget authors via
  `RichTextEditor.tsx` (lazy `PostBlockEditor`) and renders via `RichTextView.tsx`
  (`BlocksRenderer`); `BlocksRenderer` also backs `AuthFormBlocks` and
  `GalleryBlock`.

### 2.4 Cross-engine conversion tooling (optional)

Converters exist in **both** directions, but neither runs automatically:

- **Builder/legacy → blocks (per post):** the "Konwertuj na bloki" button in the
  post editor calls `migratePostToBlocks` (`lib/posts-migrate.functions.ts`) —
  non-destructive (writes `blocks_data` + flips `editor`, source columns kept).
- **Blocks → builder (bulk):** `bun run migrate:blocks-to-builder`
  (`scripts/migrate-blocks-to-builder.ts`) plus `bun run verify:migration`
  (`scripts/verify-migration.ts`) survive from the consolidation experiment.
  They are **not** part of normal operation — blocks is the post default — but
  remain available for the rare case where a post should become a full builder
  layout. Dry-run by default; `--apply` requires a service-role key;
  non-destructive (preserves `blocks_data`); idempotent; optimistic-locked.

### 2.5 History: the consolidation experiment (reverted)

For maintainers who find leftover references: a staged plan once aimed to retire
the standalone `blocks` post mode and converge posts onto the builder. Stages 1
(new posts default to builder), 3 (drop the `blocks` option from the post editor)
and 4 (drop the `blocks` arm from the render path) were implemented, then
**rolled back** in favour of the hybrid model above — posts are article-shaped,
and the blocks editor + post layouts serve them better than a full page builder.
Stage 2 (bulk `blocks` → `builder` migration) was never run as a fleet-wide step;
its tooling survives as the optional converter in §2.4. No content was lost in
either direction — every converter preserves the source columns.

### 2.6 Guardrails

- `contentEngine` stays the **only** place that decides a render strategy. Never
  branch on `editor` inside a component — call `resolveContentEngine`.
- Both engines are first-class. Shared cross-cutting infra (sanitization,
  footnotes, render-error isolation) lives once and is used by both; don't fork
  it per engine.
- The block engine is load-bearing for the Builder's `rich-text` widget — never
  delete `PostBlockEditor` / `BlocksRenderer` / `lib/blocks` as "blocks cleanup".
- Keep `tsc --noEmit`, the test suite, and the bundle gate green.

---

## 3. Quality gates — run locally (CI is dormant)

This org has no GitHub Actions runners/budget, so the `.github/workflows`
(CI / E2E / Lighthouse) are set to **`workflow_dispatch` only** (manual) — they
do not run on push/PR and never go red. There is therefore **no automated gate
between a merge and production** (the platform auto-merges + deploys), and
crucially **`vite build` does NOT typecheck** (esbuild strips types), so a type
error or a failing test will ship unless it's caught by hand.

**Run these locally before merging anything non-trivial:**

```bash
bunx tsc --noEmit        # types (the build will NOT catch these)
bun run test:coverage    # tests + the coverage gate
bun run build            # production build
bun run check:bundle     # gzipped bundle budget
bun run lint             # optional (Prettier backlog → currently non-blocking)
```

A change is "green" only when the first four pass. To restore real CI later
(once runners/budget exist), revert each workflow's `on:` back to
`push: { branches: [main] }` + `pull_request:` — the job definitions are intact.
