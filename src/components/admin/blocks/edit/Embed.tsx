import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { PlaySquare } from "lucide-react";
import { parseEmbedUrl } from "@/lib/blocks/embed";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function EmbedBlock({ block, onChange }: Props) {
  const url = String(block.data.url ?? "");
  const parsed = parseEmbedUrl(url);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <PlaySquare className="w-4 h-4 text-muted-foreground" />
        <Input
          value={url}
          onChange={(e) => onChange({ ...block, data: { ...block.data, url: e.target.value } })}
          placeholder="https://www.youtube.com/watch?v=…  •  https://vimeo.com/…  •  https://x.com/…"
        />
      </div>
      {parsed ? (
        <div className="relative aspect-video rounded-md overflow-hidden border border-border bg-muted">
          <iframe
            src={parsed.embedUrl}
            title={parsed.provider}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 w-full h-full"
          />
        </div>
      ) : url ? (
        <p className="text-xs text-muted-foreground">Nie rozpoznano dostawcy - URL pojawi się jako link.</p>
      ) : (
        <p className="text-xs text-muted-foreground">Wklej URL z YouTube, Vimeo lub X.</p>
      )}
    </div>
  );
}
