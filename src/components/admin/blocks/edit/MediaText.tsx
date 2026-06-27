import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface Props { block: Block; onChange: (next: Block) => void; }

export function MediaTextBlock({ block, onChange }: Props) {
  const url = String(block.data.url ?? "");
  const text = String(block.data.text ?? "");
  const mediaPosition = (block.data.mediaPosition as string) === "right" ? "right" : "left";
  const isRight = mediaPosition === "right";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Pozycja mediów:</span>
        <button
          type="button"
          onClick={() => onChange({ ...block, data: { ...block.data, mediaPosition: "left" } })}
          className={`px-2 py-1 rounded ${!isRight ? "bg-accent" : "hover:bg-accent/50"}`}
        >Lewa</button>
        <button
          type="button"
          onClick={() => onChange({ ...block, data: { ...block.data, mediaPosition: "right" } })}
          className={`px-2 py-1 rounded ${isRight ? "bg-accent" : "hover:bg-accent/50"}`}
        >Prawa</button>
      </div>
      <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${isRight ? "md:[&>*:first-child]:order-2" : ""}`}>
        <div className="aspect-video rounded-lg bg-muted flex items-center justify-center overflow-hidden">
          {url
            ? <img src={url} alt="" className="w-full h-full object-cover" />
            : <Input
                placeholder="URL obrazu…"
                onChange={(e) => onChange({ ...block, data: { ...block.data, url: e.target.value } })}
                className="max-w-xs"
              />}
        </div>
        <Textarea
          value={text}
          placeholder="Treść obok mediów…"
          rows={6}
          onChange={(e) => onChange({ ...block, data: { ...block.data, text: e.target.value } })}
        />
      </div>
    </div>
  );
}
