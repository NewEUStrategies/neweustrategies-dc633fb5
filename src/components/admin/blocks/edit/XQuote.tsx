import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { Twitter } from "lucide-react";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function XQuoteBlock({ block, onChange }: Props) {
  const text = String(block.data.text ?? "");
  const via = String(block.data.via ?? "");
  const hashtags = String(block.data.hashtags ?? "");
  const patch = (k: string, v: string) =>
    onChange({ ...block, data: { ...block.data, [k]: v } });

  return (
    <div className="not-prose rounded-md border border-border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Twitter className="w-3.5 h-3.5" /> X Quote / Click-to-Tweet
        <span className="ml-auto text-[10px] normal-case tracking-normal">{text.length} / 280</span>
      </div>
      <textarea
        placeholder="Cytat do udostępnienia na X (max ~280 znaków)"
        value={text}
        maxLength={280}
        onChange={(e) => patch("text", e.target.value)}
        className="w-full rounded border border-border bg-background px-3 py-2 text-base min-h-[80px] font-medium"
      />
      <div className="grid grid-cols-2 gap-2">
        <Input
          placeholder="via @handle (bez @)"
          value={via}
          onChange={(e) => patch("via", e.target.value.replace(/^@/, ""))}
        />
        <Input
          placeholder="Hashtagi (oddzielone przecinkiem)"
          value={hashtags}
          onChange={(e) => patch("hashtags", e.target.value)}
        />
      </div>
    </div>
  );
}
