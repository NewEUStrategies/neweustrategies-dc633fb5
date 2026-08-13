import type { Block } from "@/lib/blocks/types";
import { Music } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { MediaWidgetToolbar } from "../MediaWidgetToolbar";

interface Props {
  block: Block;
  isActive?: boolean;
  onChange: (next: Block) => void;
}

export function AudioBlock({ block, isActive, onChange }: Props) {
  const i18n = useBlocksI18n();
  const url = String(block.data.url ?? "");
  const caption = String(block.data.caption ?? "");
  const source = String(block.data.source ?? "");
  const sourceUrl = String(block.data.sourceUrl ?? "");
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
          <Input
            placeholder="URL pliku audio (mp3, ogg, wav)…"
            onChange={(e) => onChange({ ...block, data: { ...block.data, url: e.target.value } })}
            className="max-w-md mx-auto"
          />
        </div>
      )}
      {url && (
        <>
          <input
            type="text"
            value={caption}
            placeholder="Podpis (opcjonalnie)…"
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
