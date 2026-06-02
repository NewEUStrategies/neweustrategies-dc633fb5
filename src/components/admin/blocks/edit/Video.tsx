import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { Video as VideoIcon } from "@/lib/lucide-shim";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function VideoBlock({ block, onChange }: Props) {
  const url = String(block.data.url ?? "");
  const poster = String(block.data.poster ?? "");

  if (!url) {
    return (
      <div className="rounded-lg border-2 border-dashed border-border p-6 text-center space-y-2">
        <VideoIcon className="w-8 h-8 mx-auto text-muted-foreground" />
        <Input
          placeholder="URL pliku wideo (.mp4, .webm)…"
          onChange={(e) => onChange({ ...block, data: { ...block.data, url: e.target.value } })}
          className="max-w-md mx-auto"
        />
        <p className="text-xs text-muted-foreground">Poster (miniatura) w panelu po prawej.</p>
      </div>
    );
  }

  return (
    <video
      src={url}
      poster={poster || undefined}
      controls
      preload="metadata"
      className="w-full rounded-lg bg-black"
    />
  );
}
