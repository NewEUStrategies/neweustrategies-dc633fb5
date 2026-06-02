import type { Block } from "@/lib/blocks/types";
import { Image as ImageIcon } from "@/lib/lucide-shim";
import { Input } from "@/components/ui/input";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function ImageBlock({ block, onChange }: Props) {
  const url = String(block.data.url ?? "");
  const alt = String(block.data.alt ?? "");
  const caption = String(block.data.caption ?? "");

  if (!url) {
    return (
      <div className="rounded-lg border-2 border-dashed border-border p-6 text-center space-y-2">
        <ImageIcon className="w-8 h-8 mx-auto text-muted-foreground" />
        <Input
          placeholder="Wklej URL obrazu lub ścieżkę z biblioteki mediów…"
          onChange={(e) => onChange({ ...block, data: { ...block.data, url: e.target.value } })}
          className="max-w-md mx-auto"
        />
        <p className="text-xs text-muted-foreground">Ustawienia (alt, caption, link) w panelu po prawej.</p>
      </div>
    );
  }

  return (
    <figure className="space-y-2">
      <img src={url} alt={alt} className="rounded-lg max-w-full h-auto" />
      <input
        type="text"
        value={caption}
        placeholder="Podpis (opcjonalnie)…"
        onChange={(e) => onChange({ ...block, data: { ...block.data, caption: e.target.value } })}
        className="w-full bg-transparent text-sm text-muted-foreground text-center italic border-none outline-none focus:ring-0 p-0"
      />
    </figure>
  );
}
