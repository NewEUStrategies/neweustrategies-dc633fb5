import type { Block } from "@/lib/blocks/types";
import { str } from "@/components/blocks/renderer/data";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

// Pole URL jest ZAWSZE pod podglądem, w tym samym miejscu drzewa: wcześniej
// istniało tylko w pustym stanie, więc pierwszy wpisany znak przełączał widok
// na `<img>` (pole znikało razem z fokusem), a ustawionego obrazu nie dało
// się już zmienić - blok nie ma paska narzędzi ani pola w panelu bocznym.
export function MediaTextBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const url = str(block.data, "url");
  const text = str(block.data, "text");
  const isRight = str(block.data, "mediaPosition", "left") === "right";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">{i18n.editor("mediaText", "mediaPosition")}:</span>
        <button
          type="button"
          onClick={() => onChange({ ...block, data: { ...block.data, mediaPosition: "left" } })}
          aria-pressed={!isRight}
          className={`px-2 py-1 rounded ${!isRight ? "bg-accent" : "hover:bg-accent/50"}`}
        >
          {i18n.editor("mediaText", "left")}
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...block, data: { ...block.data, mediaPosition: "right" } })}
          aria-pressed={isRight}
          className={`px-2 py-1 rounded ${isRight ? "bg-accent" : "hover:bg-accent/50"}`}
        >
          {i18n.editor("mediaText", "right")}
        </button>
      </div>
      <div
        className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${isRight ? "md:[&>*:first-child]:order-2" : ""}`}
      >
        <div className="space-y-2">
          <div className="aspect-video rounded-lg bg-muted flex items-center justify-center overflow-hidden">
            {url && <img src={url} alt="" className="w-full h-full object-cover" />}
          </div>
          <Input
            value={url}
            placeholder={i18n.field("imageUrl")}
            onChange={(e) => onChange({ ...block, data: { ...block.data, url: e.target.value } })}
          />
        </div>
        <Textarea
          value={text}
          placeholder={i18n.editor("mediaText", "contentPh")}
          rows={6}
          onChange={(e) => onChange({ ...block, data: { ...block.data, text: e.target.value } })}
        />
      </div>
    </div>
  );
}
