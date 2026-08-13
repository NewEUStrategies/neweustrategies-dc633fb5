import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import type { Block } from "@/lib/blocks/types";
import { Image as ImageIcon } from "@/lib/lucide-shim";
import { Input } from "@/components/ui/input";
import { MediaWidgetToolbar } from "../MediaWidgetToolbar";

interface Props {
  block: Block;
  isActive?: boolean;
  onChange: (next: Block) => void;
}

export function ImageBlock({ block, isActive, onChange }: Props) {
  const bt = useBlocksI18n();
  const url = String(block.data.url ?? "");
  const alt = String(block.data.alt ?? "");
  const caption = String(block.data.caption ?? "");
  const source = String(block.data.source ?? "");
  const sourceUrl = String(block.data.sourceUrl ?? "");

  if (!url) {
    return (
      <div className="rounded-lg border-2 border-dashed border-border p-6 text-center space-y-2">
        <ImageIcon className="w-8 h-8 mx-auto text-muted-foreground" />
        <Input
          placeholder={bt.editor("image", "url")}
          onChange={(e) => onChange({ ...block, data: { ...block.data, url: e.target.value } })}
          className="max-w-md mx-auto"
        />
        <p className="text-xs text-muted-foreground">{bt.editor("image", "settingsHint")}</p>
      </div>
    );
  }

  return (
    <figure className="relative space-y-2">
      {isActive && <MediaWidgetToolbar kind="image" block={block} onChange={onChange} />}
      <img
        src={url}
        alt={alt}
        className="rounded-lg max-w-full h-auto"
        onLoad={(e) => {
          const img = e.currentTarget;
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          if (w > 0 && h > 0 && (block.data.width !== w || block.data.height !== h)) {
            onChange({ ...block, data: { ...block.data, width: w, height: h } });
          }
        }}
      />
      <input
        type="text"
        value={caption}
        placeholder={bt.editor("image", "caption")}
        onChange={(e) => onChange({ ...block, data: { ...block.data, caption: e.target.value } })}
        className="w-full bg-transparent text-sm text-muted-foreground text-center italic border-none outline-none focus:ring-0 p-0"
      />
      <div className="flex items-center gap-2 justify-center text-[11px] text-muted-foreground">
        <span className="uppercase tracking-wider">{bt.t("blocks.toolbar.source")}:</span>
        <input
          type="text"
          value={source}
          placeholder={bt.t("blocks.toolbar.sourceLabel")}
          onChange={(e) => onChange({ ...block, data: { ...block.data, source: e.target.value } })}
          className="flex-1 bg-transparent border-none outline-none focus:ring-0 p-0"
        />
        <input
          type="url"
          value={sourceUrl}
          placeholder="https://…"
          onChange={(e) =>
            onChange({ ...block, data: { ...block.data, sourceUrl: e.target.value } })
          }
          className="flex-1 bg-transparent border-none outline-none focus:ring-0 p-0"
        />
      </div>
    </figure>
  );
}
