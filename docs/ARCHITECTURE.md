# Architecture notes

Living notes on two conventions that were previously ambiguous in the codebase.
Keep this short and current; delete sections once they stop being decisions and
become just "how it is."

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

## 2. Content rendering: `blocks` → `builder`

There are two content-composition engines. This is deliberate today, but the
long-term direction is for the **builder** to be the single page-composition
engine, with the **blocks** engine surviving only as a rich-article renderer
embedded inside it.

### Current state

`src/lib/content/contentEngine.ts` is the single source of truth for *which*
strategy renders a piece of content. It resolves an `editor` value to one of
`"blocks" | "builder" | "html"`:

- `editor === "builder"` with sections → **builder** (canonical page composition)
- `editor === "blocks"` with blocks → **blocks** (legacy rich article bodies)
- everything else (`richtext` / `markdown` / legacy / empty) → **html**

The blocks engine also lives *inside* the builder: the `rich-text` widget
(`widget-view/RichTextView.tsx`) embeds the blocks renderer, so article-style
content can sit inside a builder layout. The legacy standalone blocks code is
~61 files / ~7k lines (`components/blocks`, `components/admin/blocks`,
`lib/blocks`) and is still actively reachable via:

- `PostBlockEditor` — rendered by `routes/admin.posts.$slug.tsx` when a post's
  `editor === "blocks"`.
- `BlocksRenderer` — the public "blocks" strategy selected by `contentEngine`.

Migration tooling already exists and is safe to re-run:

- `scripts/migrate-blocks-to-builder.ts` — dry-run by default, `--apply` needs a
  service-role key, non-destructive (preserves `blocks_data`), idempotent.
- `scripts/verify-migration.ts` — read-only post-migration audit (footnote
  parity, leftover markers, stripped inline styles); exits non-zero on drift.

### Deprecation path

Staged so each step is independently shippable and reversible:

1. **Stop creating new `blocks` content.** Remove `blocks` as a *new-post*
   editor choice in the admin; new posts use the builder (`rich-text` widget for
   article bodies). Existing `blocks` posts keep rendering unchanged.
2. **Migrate existing content.** Run `migrate:blocks-to-builder` (dry-run →
   `--apply`) and gate on `verify:migration`. This wraps legacy block bodies in
   a single `rich-text` widget, flipping their `editor` to `builder`.
3. **Retire the standalone blocks editor UI.** Once no content has
   `editor === "blocks"`, delete `PostBlockEditor` and the
   `components/admin/blocks/` editor tree (the `edit/*` components).
4. **Collapse the render path.** Fold whatever `BlocksRenderer` logic the
   `rich-text` widget still needs into the widget, then drop the `"blocks"`
   branch from `contentEngine` and the remaining `components/blocks` /
   `lib/blocks` code that is no longer referenced.

Until step 3 is reached, treat the blocks editor as **frozen**: fix bugs, but add
new content features to the builder/`rich-text` path only, so the two engines
don't keep diverging.
