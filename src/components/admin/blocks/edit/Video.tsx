import type { Block } from "@/lib/blocks/types";
import { str } from "@/components/blocks/renderer/data";
import { Video as VideoIcon } from "@/lib/lucide-shim";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { MediaWidgetToolbar } from "../MediaWidgetToolbar";
import { MediaUrlDraftInput } from "../MediaUrlDraftInput";

interface Props {
  block: Block;
  isActive?: boolean;
  onChange: (next: Block) => void;
}

// Pola czyta czytnik renderera (`str`): liczba w `url` to brak wideo (strona
// nic nie narysuje), a obiekt w podpisie to pusty napis, nie „[object Object]".
export function VideoBlock({ block, isActive, onChange }: Props) {
  const i18n = useBlocksI18n();
  const url = str(block.data, "url");
  const poster = str(block.data, "poster");
  const caption = str(block.data, "caption");
  const source = str(block.data, "source");
  const sourceUrl = str(block.data, "sourceUrl");

  if (!url) {
    return (
      <div className="rounded-lg border-2 border-dashed border-border p-6 text-center space-y-2">
        <VideoIcon className="w-8 h-8 mx-auto text-muted-foreground" />
        <MediaUrlDraftInput
          placeholder={i18n.editor("video", "urlPh")}
          onCommit={(next) => onChange({ ...block, data: { ...block.data, url: next } })}
          className="max-w-md mx-auto"
        />
        <p className="text-xs text-muted-foreground">{i18n.editor("video", "hint")}</p>
      </div>
    );
  }

  return (
    <figure className="relative space-y-2">
      {isActive && <MediaWidgetToolbar kind="video" block={block} onChange={onChange} />}
      <video
        src={url}
        poster={poster || undefined}
        controls
        preload="metadata"
        className="w-full rounded-lg bg-black"
        autoPlay={Boolean(block.data.autoplay)}
        loop={Boolean(block.data.loop)}
        muted={Boolean(block.data.muted)}
      />
      {/* Placeholder wołał `blocks.editor.image.caption` - taki korzeń nie istnieje.
          Podpisy mediów żyją pod `blocks.editors.image.*`, tak jak w edit/Image.tsx. */}
      <input
        type="text"
        value={caption}
        placeholder={i18n.editor("image", "caption")}
        onChange={(e) => onChange({ ...block, data: { ...block.data, caption: e.target.value } })}
        className="w-full bg-transparent text-sm text-muted-foreground text-center italic border-none outline-none focus:ring-0 p-0"
      />
      <div className="flex items-center gap-2 justify-center text-[11px] text-muted-foreground">
        <span className="uppercase tracking-wider">{i18n.t("blocks.toolbar.source")}:</span>
        <input
          type="text"
          value={source}
          placeholder={i18n.t("blocks.toolbar.sourceLabel")}
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
