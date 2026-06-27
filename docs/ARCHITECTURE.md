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

## 2. Content engines & the `blocks` → `builder` consolidation

> **Status:** planning / not started. Nothing below has been executed yet — the
> blocks editor is fully functional and is still the default for new posts. This
> section is the agreed direction, not a description of work already done.

### 2.0 TL;DR for content authors

Nothing here removes any way of creating content. Concretely, today:

- **Pages** (`/admin/pages`) are built **only** with the Visual Builder. The
  blocks editor was never part of page creation. This consolidation does not
  touch pages.
- **Posts / articles** (`/admin/posts`) are written in the **Block editor** by
  default — and that stays true until the steps below are actually done.
- The **same block editor** is also available **inside the Builder** through the
  `rich-text` widget, which opens the identical `PostBlockEditor` in a modal.

So "deprecating blocks" means retiring the *standalone post mode* called
"blocks", **not** the block editor or the block-rendering engine — those live on
inside the Builder. Authoring capability is preserved at every stage.

### 2.1 The important distinction (keep vs. retire)

"Blocks" is two separable things. Only the second is being retired:

| Concern | Code | Fate |
| --- | --- | --- |
| Block **engine + editor** (`PostBlockEditor`, `BlocksRenderer`, `lib/blocks`) | `components/blocks/*`, `components/admin/blocks/*`, `lib/blocks/*` | **KEEP** — reused by the Builder's `rich-text` widget |
| Block **standalone post mode** (`editor === "blocks"` as a top-level post type) | post create default + `admin.posts.$slug.tsx` wiring + the `"blocks"` branch of `contentEngine` | **RETIRE** — replaced by `builder` + `rich-text` widget |

This distinction is the single most important thing to get right. An earlier
draft of this plan said "delete `PostBlockEditor`" — that is **wrong**: the
`rich-text` widget depends on it (`RichTextEditor.tsx:20` lazy-imports it). The
editor survives; only its top-level entry point goes away.

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

### 2.3 Current touchpoints (grounded)

The single dispatch point: `src/lib/content/contentEngine.ts` resolves an
`editor` value to `"blocks" | "builder" | "html"` (`contentEngine.ts:31-34`):

- `editor === "builder"` with ≥1 section → **builder** (canonical composition)
- `editor === "blocks"` with ≥1 block → **blocks** (article bodies)
- everything else (`richtext` / `markdown` / legacy / empty) → **html**

Where `blocks` is reachable today:

- **New posts default to `editor: "blocks"`** — `content.functions.ts:166`
  (`createPost`), and WordPress import too (`wordpress-import.functions.ts:571,602`).
- **Standalone post editor** — `admin.posts.$slug.tsx:556` renders
  `PostBlockEditor` when `form.editor === "blocks"`; the editor selector offers
  it as "zalecane / recommended" (`admin.posts.$slug.tsx:251`).
- **Public render strategy** — `ContentRenderer.tsx:50-53` calls
  `resolveContentEngine` and renders `<BlocksRenderer>` for the `blocks` engine;
  the page route wires this in `routes/$.tsx`.
- **Inside the Builder (the survivor)** — the `rich-text` widget authors via
  `RichTextEditor.tsx:20` (lazy `PostBlockEditor`) and renders via
  `RichTextView.tsx` (`BlocksRenderer`). `BlocksRenderer` is also used by
  `AuthFormBlocks` and `GalleryBlock`.

Footprint: the standalone blocks code is ~61 files / ~7k lines across
`components/blocks`, `components/admin/blocks`, `lib/blocks`.

### 2.4 Migration tooling (already exists, safe to re-run)

- `bun run migrate:blocks-to-builder` (`scripts/migrate-blocks-to-builder.ts`) —
  dry-run by default; `--apply` requires a service-role key; non-destructive
  (preserves `blocks_data`, only writes `builder_data` + flips `editor`);
  idempotent; optimistic-locked against concurrent writes. It wraps a legacy
  block body in a single `rich-text` widget and re-runs the same footnote/TOC
  pipeline as the public render path.
- `bun run verify:migration` (`scripts/verify-migration.ts`) — read-only audit
  (footnote parity, leftover `[fn]` markers, stripped inline styles); exits
  non-zero on drift, so it can gate CI.

### 2.5 Staged plan

Each stage is independently shippable and reversible. Do **not** start a stage
until the previous stage's exit criteria hold.

#### Stage 1 — Make `builder` the default authoring path for posts

- **Goal:** new posts are created as `builder` (with a `rich-text` widget for the
  article body), so the `blocks` pool stops growing. No content is migrated yet.
- **Precondition (gate):** authoring an article through the `rich-text` widget is
  at least as good as the standalone block editor. The editor itself is already
  identical (same `PostBlockEditor`), so this is a UX/workflow check — e.g. a
  post template that seeds a one-section builder doc containing an empty
  `rich-text` widget — not an engine gap.
- **Touchpoints:** flip the default in `content.functions.ts:166` (and the WP
  import defaults at `wordpress-import.functions.ts:571,602`) from `"blocks"` to
  `"builder"`; reorder/relabel the selector so Builder is primary and "blocks"
  is marked legacy (`admin.posts.$slug.tsx:251-254`). Keep the `blocks` option
  available for now.
- **Exit criteria:** newly created posts have `editor === "builder"`; existing
  `blocks` posts still open and render unchanged.
- **Rollback:** revert the default value; one-line change.

#### Stage 2 — Migrate existing `blocks` content

- **Goal:** no row has `editor === "blocks"` anymore.
- **Touchpoints:** `migrate:blocks-to-builder` (dry-run → `--apply`), gated by
  `verify:migration`. Run per-tenant; spot-check rendered output against the
  pre-migration page (the migration preserves `blocks_data`, so it is reversible
  per row by flipping `editor` back).
- **Exit criteria:** `select count(*) … where editor = 'blocks'` is 0 across
  tenants; `verify:migration` exits 0.
- **Rollback:** flip affected rows' `editor` back to `"blocks"` (data was never
  destroyed).

#### Stage 3 — Retire the standalone `blocks` post mode

- **Goal:** remove the top-level "blocks" editor mode while **keeping** the block
  editor for the `rich-text` widget.
- **Touchpoints:** drop `"blocks"` from `EditorType` and the selector, and remove
  the `form.editor === "blocks"` branch in `admin.posts.$slug.tsx:556`. **Do not
  delete `PostBlockEditor`** — `RichTextEditor.tsx` still imports it. Delete only
  the parts of `components/admin/blocks/` not reachable from the `rich-text`
  widget (verify with an importer scan first).
- **Exit criteria:** no route references `editor === "blocks"`; the `rich-text`
  widget still opens the block editor and renders correctly; typecheck + tests +
  build green.
- **Rollback:** revert the route/type changes (no data implications, since
  Stage 2 already cleared `blocks` rows).

#### Stage 4 — Collapse the public render path

- **Goal:** `contentEngine` no longer needs a `blocks` branch.
- **Touchpoints:** confirm `BlocksRenderer` is reached **only** through
  `RichTextView` (importer scan); then drop the `engine === "blocks"` branch in
  `ContentRenderer.tsx:52` and the `"blocks"` arm in `contentEngine.ts`
  (update `contentEngine.test.ts`). Whatever `BlocksRenderer` the `rich-text`
  widget needs stays; remove any `components/blocks` / `lib/blocks` modules that
  are now unreferenced.
- **Exit criteria:** `contentEngine` returns only `"builder" | "html"`; no dead
  `blocks` modules remain (dead-export scan clean); full suite + build green.
- **Rollback:** revert; engine selection is pure and unit-tested.

### 2.6 Guardrails until Stage 3 lands

- Treat the standalone block editor as **frozen**: fix bugs, but add new content
  features only to the Builder / `rich-text` path so the two engines don't keep
  diverging.
- `contentEngine` stays the **only** place that decides a render strategy. Never
  branch on `editor` in components — call `resolveContentEngine`.
- Every stage must keep `tsc --noEmit`, the test suite, and the bundle gate
  green; Stage 2 must additionally pass `verify:migration`.
