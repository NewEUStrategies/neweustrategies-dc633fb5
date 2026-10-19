import type { Block } from "@/lib/blocks/types";
import { str } from "@/components/blocks/renderer/data";
import { Music } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { MediaWidgetToolbar } from "../MediaWidgetToolbar";
import { MediaUrlDraftInput } from "../MediaUrlDraftInput";

interface Props {
  block: Block;
  isActive?: boolean;
  onChange: (next: Block) => void;
}

// Jak wideo: pola czyta czytnik renderera (`str`), więc liczba w `url` to brak
// pliku, a obiekt w podpisie nie wycieka jako „[object Object]".
export function AudioBlock({ block, isActive, onChange }: Props) {
  const i18n = useBlocksI18n();
  const url = str(block.data, "url");
  const caption = str(block.data, "caption");
  const source = str(block.data, "source");
  const sourceUrl = str(block.data, "sourceUrl");
  return (
    <div className="relative space-y-2">
      {url && isActive && <MediaWidgetToolbar kind="audio" block={block} onChange={onChange} />}
      {url ? (
        <audio
          src={url}
          controls
          className="w-full"
          preload="metadata"
          autoPlay={Boolean(block.data.autoplay)}
          loop={Boolean(block.data.loop)}
          muted={Boolean(block.data.muted)}
        />
      ) : (
        <div className="rounded-lg border-2 border-dashed border-border p-6 text-center space-y-2">
          <Music className="w-8 h-8 mx-auto text-muted-foreground" />
          <MediaUrlDraftInput
            placeholder={i18n.editor("audio", "urlPh")}
            onCommit={(next) => onChange({ ...block, data: { ...block.data, url: next } })}
            className="max-w-md mx-auto"
          />
        </div>
      )}
      {url && (
        <>
          <input
            type="text"
            value={caption}
            placeholder={i18n.editor("image", "caption")}
            onChange={(e) =>
              onChange({ ...block, data: { ...block.data, caption: e.target.value } })
            }
            className="w-full bg-transparent text-sm text-muted-foreground text-center italic border-none outline-none focus:ring-0 p-0"
          />
          <div className="flex items-center gap-2 justify-center text-[11px] text-muted-foreground">
            <span className="uppercase tracking-wider">{i18n.t("blocks.toolbar.source")}:</span>
            <input
              type="text"
              value={source}
              placeholder={i18n.t("blocks.toolbar.sourceLabel")}
              onChange={(e) =>
                onChange({ ...block, data: { ...block.data, source: e.target.value } })
              }
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
        </>
      )}
    </div>
  );
}
