import type { Block } from "@/lib/blocks/types";
import { Music } from "lucide-react";
import { Input } from "@/components/ui/input";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function AudioBlock({ block, onChange }: Props) {
  const url = String(block.data.url ?? "");
  const caption = String(block.data.caption ?? "");
  return (
    <div className="space-y-2">
      {url ? (
        <audio src={url} controls className="w-full" preload="metadata" />
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
        <input
          type="text"
          value={caption}
          placeholder="Podpis (opcjonalnie)…"
          onChange={(e) => onChange({ ...block, data: { ...block.data, caption: e.target.value } })}
          className="w-full bg-transparent text-sm text-muted-foreground text-center italic border-none outline-none focus:ring-0 p-0"
        />
      )}
    </div>
  );
}
