import type { Block } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Images, Plus, Trash2 } from "lucide-react";

interface GalleryImage { url: string; alt?: string }

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

function readImages(block: Block): GalleryImage[] {
  const raw = block.data.images;
  if (!Array.isArray(raw)) return [];
  const out: GalleryImage[] = [];
  for (const x of raw) {
    if (x && typeof x === "object" && !Array.isArray(x)) {
      const obj = x as { [k: string]: unknown };
      out.push({ url: String(obj.url ?? ""), alt: String(obj.alt ?? "") });
    }
  }
  return out;
}

export function GalleryBlock({ block, onChange }: Props) {
  const images = readImages(block);

  const update = (next: GalleryImage[]) => {
    onChange({ ...block, data: { ...block.data, images: next as unknown as never } });
  };

  if (images.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-border p-6 text-center space-y-2">
        <Images className="w-8 h-8 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Galeria - dodaj pierwszy obraz.</p>
        <Button size="sm" variant="outline" onClick={() => update([{ url: "", alt: "" }])}>
          <Plus className="w-3 h-3 mr-1" /> Dodaj obraz
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {images.map((img, i) => (
          <div key={i} className="relative aspect-square rounded-md border border-border overflow-hidden bg-muted/40 group">
            {img.url ? (
              <img src={img.url} alt={img.alt ?? ""} className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">brak URL</div>
            )}
            <button
              type="button"
              onClick={() => update(images.filter((_, j) => j !== i))}
              className="absolute top-1 right-1 p-1 rounded bg-popover/90 border border-border opacity-0 group-hover:opacity-100"
              title="Usuń"
            >
              <Trash2 className="w-3 h-3" />
            </button>
            <Input
              value={img.url}
              onChange={(e) => update(images.map((x, j) => j === i ? { ...x, url: e.target.value } : x))}
              placeholder="URL…"
              className="absolute bottom-1 left-1 right-1 h-6 text-[10px] bg-popover/90"
            />
          </div>
        ))}
      </div>
      <Button size="sm" variant="outline" onClick={() => update([...images, { url: "", alt: "" }])}>
        <Plus className="w-3 h-3 mr-1" /> Dodaj obraz
      </Button>
    </div>
  );
}
