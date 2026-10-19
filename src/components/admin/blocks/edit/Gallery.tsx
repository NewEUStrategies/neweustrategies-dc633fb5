import { toJson } from "@/lib/content-model/json";
import type { Block, Json } from "@/lib/blocks/types";
import { objList, str } from "@/components/blocks/renderer/data";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Images, Plus, Trash2 } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";

/** Obraz galerii: `url`/`alt` czytane jak w `renderGallery`, reszta pól obrazu bez zmian. */
interface GalleryImage {
  [key: string]: Json;
  url: string;
  alt: string;
}

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

// Zapis edytuje jedno pole jednego obrazu, więc pozostałe pola obrazów
// (np. identyfikator z biblioteki mediów) muszą przejść przez niego bez zmian.
function readImages(block: Block): GalleryImage[] {
  return objList(block.data, "images", (o) => ({ ...o, url: str(o, "url"), alt: str(o, "alt") }));
}

export function GalleryBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const gb = (k: string) => i18n.editor("gallery", k);
  const images = readImages(block);

  const update = (next: GalleryImage[]) => {
    onChange({ ...block, data: { ...block.data, images: toJson(next) } });
  };

  if (images.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-border p-6 text-center space-y-2">
        <Images className="w-8 h-8 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{gb("emptyHint")}</p>
        <Button size="sm" variant="outline" onClick={() => update([{ url: "", alt: "" }])}>
          <Plus className="w-3 h-3 mr-1" /> {gb("addImage")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {images.map((img, i) => (
          <div
            key={i}
            className="relative aspect-square rounded-md border border-border overflow-hidden bg-muted/40 group"
          >
            {img.url ? (
              <img
                src={img.url}
                alt={img.alt}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                {gb("noUrl")}
              </div>
            )}
            <button
              type="button"
              onClick={() => update(images.filter((_, j) => j !== i))}
              className="absolute top-1 right-1 p-1 rounded bg-popover/90 border border-border opacity-0 group-hover:opacity-100"
              title={gb("remove")}
            >
              <Trash2 className="w-3 h-3" />
            </button>
            <Input
              value={img.url}
              onChange={(e) =>
                update(images.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
              }
              placeholder={gb("urlPh")}
              className="absolute bottom-1 left-1 right-1 h-6 text-[10px] bg-popover/90"
            />
          </div>
        ))}
      </div>
      <Button size="sm" variant="outline" onClick={() => update([...images, { url: "", alt: "" }])}>
        <Plus className="w-3 h-3 mr-1" /> {gb("addImage")}
      </Button>
    </div>
  );
}
