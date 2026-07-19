// Admin edytory dla bloków dynamicznych "post-*" (Phase 2).
// Wszystkie czytają CurrentPostCtx na public stronie; tu pokazujemy tylko placeholder + opcje.
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import type { Block } from "@/lib/blocks/types";
import { AdminSelect } from "../AdminSelect";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

function Shell({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

export function PostTitleBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const level = Number(block.data.level ?? 1);
  return (
    <Shell label={bt.editor("contextBlocks", "postTitle")}>
      <AdminSelect
        className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={level}
        onChange={(e) =>
          onChange({ ...block, data: { ...block.data, level: Number(e.target.value) } })
        }
      >
        {[1, 2, 3, 4].map((l) => (
          <option key={l} value={l}>
            H{l}
          </option>
        ))}
      </AdminSelect>
    </Shell>
  );
}

export function PostDateBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const format = String(block.data.format ?? "long");
  const showUpdated = Boolean(block.data.showUpdated);
  return (
    <Shell label={bt.editor("contextBlocks", "postDate")}>
      <div className="flex gap-2 items-center text-xs">
        <AdminSelect
          className="bg-background border border-border rounded px-2 py-2 h-9"
          value={format}
          onChange={(e) => onChange({ ...block, data: { ...block.data, format: e.target.value } })}
        >
          <option value="long">{bt.editor("contextBlocks", "dateLong")}</option>
          <option value="short">{bt.editor("contextBlocks", "dateShort")}</option>
          <option value="relative">{bt.editor("contextBlocks", "dateRelative")}</option>
        </AdminSelect>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={showUpdated}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, showUpdated: e.target.checked } })
            }
          />
          {bt.editor("contextBlocks", "updated")}
        </label>
      </div>
    </Shell>
  );
}

export function PostAuthorBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const showAvatar = block.data.showAvatar !== false;
  const showBio = Boolean(block.data.showBio);
  return (
    <Shell label={bt.editor("contextBlocks", "postAuthor")}>
      <div className="flex gap-4 text-xs">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={showAvatar}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, showAvatar: e.target.checked } })
            }
          />
          {bt.editor("contextBlocks", "avatar")}
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={showBio}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, showBio: e.target.checked } })
            }
          />
          {bt.editor("contextBlocks", "bio")}
        </label>
      </div>
    </Shell>
  );
}

export function PostExcerptBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const showMore = Boolean(block.data.showMore);
  return (
    <Shell label={bt.editor("contextBlocks", "postExcerpt")}>
      <label className="flex items-center gap-1 text-xs">
        <input
          type="checkbox"
          checked={showMore}
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, showMore: e.target.checked } })
          }
        />
        {bt.editor("contextBlocks", "readMore")}
      </label>
    </Shell>
  );
}

export function PostFeaturedImageBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const aspect = String(block.data.aspect ?? "16/9");
  const rounded = block.data.rounded !== false;
  return (
    <Shell label={bt.editor("contextBlocks", "postFeaturedImage")}>
      <div className="flex gap-2 items-center text-xs">
        <AdminSelect
          className="bg-background border border-border rounded px-2 py-2 h-9"
          value={aspect}
          onChange={(e) => onChange({ ...block, data: { ...block.data, aspect: e.target.value } })}
        >
          <option value="16/9">16:9</option>
          <option value="4/3">4:3</option>
          <option value="1/1">1:1</option>
          <option value="3/2">3:2</option>
        </AdminSelect>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={rounded}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, rounded: e.target.checked } })
            }
          />
          {bt.editor("contextBlocks", "rounded")}
        </label>
      </div>
    </Shell>
  );
}

export function PostTermsBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const taxonomy = String(block.data.taxonomy ?? "categories");
  return (
    <Shell label={bt.editor("contextBlocks", "postTerms")}>
      <AdminSelect
        className="text-xs bg-background border border-border rounded px-2 py-2 h-9 w-full"
        value={taxonomy}
        onChange={(e) => onChange({ ...block, data: { ...block.data, taxonomy: e.target.value } })}
      >
        <option value="categories">{bt.editor("contextBlocks", "categories")}</option>
        <option value="tags">{bt.editor("contextBlocks", "tags")}</option>
      </AdminSelect>
    </Shell>
  );
}

export function SiteTitleBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const level = Number(block.data.level ?? 1);
  return (
    <Shell label={bt.editor("contextBlocks", "siteTitle")}>
      <AdminSelect
        className="text-xs bg-background border border-border rounded px-2 py-2 h-9"
        value={level}
        onChange={(e) =>
          onChange({ ...block, data: { ...block.data, level: Number(e.target.value) } })
        }
      >
        {[1, 2, 3].map((l) => (
          <option key={l} value={l}>
            H{l}
          </option>
        ))}
      </AdminSelect>
    </Shell>
  );
}

export function SiteTaglineBlock(_: Props) {
  const bt = useBlocksI18n();
  return <Shell label={bt.editor("contextBlocks", "siteTagline")} />;
}

export function SiteLogoBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const width = Number(block.data.width ?? 120);
  return (
    <Shell label={bt.editor("contextBlocks", "siteLogo")}>
      <input
        type="number"
        min={32}
        max={480}
        value={width}
        onChange={(e) =>
          onChange({ ...block, data: { ...block.data, width: Number(e.target.value || 120) } })
        }
        className="text-xs bg-background border border-border rounded px-2 py-2 h-9 w-full"
      />
    </Shell>
  );
}
