import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import type { Block } from "@/lib/blocks/types";
import { ImagePlus } from "lucide-react";
import { Input } from "@/components/ui/input";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

export function CoverBlock({ block, onChange }: Props) {
  const bt = useBlocksI18n();
  const url = String(block.data.url ?? "");
  const title = String(block.data.title ?? "");
  const overlay = Number(block.data.overlay ?? 50);
  const minHeight = Number(block.data.minHeight ?? 360);

  if (!url) {
    return (
      <div className="rounded-lg border-2 border-dashed border-border p-6 text-center space-y-2">
        <ImagePlus className="w-8 h-8 mx-auto text-muted-foreground" />
        <Input
          placeholder={bt.editor("cover", "bgUrl")}
          onChange={(e) => onChange({ ...block, data: { ...block.data, url: e.target.value } })}
          className="max-w-md mx-auto"
        />
      </div>
    );
  }
  return (
    <div
      className="relative w-full rounded-lg overflow-hidden flex items-center justify-center text-center"
      style={{
        minHeight,
        backgroundImage: `url(${url})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-0 bg-black" style={{ opacity: overlay / 100 }} />
      <input
        type="text"
        value={title}
        placeholder={bt.editor("cover", "title")}
        onChange={(e) => onChange({ ...block, data: { ...block.data, title: e.target.value } })}
        className="relative z-10 w-full max-w-2xl bg-transparent text-3xl md:text-5xl font-semibold text-white text-center border-none outline-none focus:ring-0 placeholder:text-white/60 px-4 py-12"
      />
    </div>
  );
}
