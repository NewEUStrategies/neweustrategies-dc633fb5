import type { Block, Json } from "@/lib/blocks/types";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Link2, Plus, Trash2 } from "lucide-react";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import "@/lib/i18n-admin-blocks";
import { toJson } from "@/lib/content-model/json";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

interface RawItem {
  labelPl: string;
  labelEn: string;
  url: string;
  imageSrc: string;
}

const readItems = (data: Record<string, Json>): RawItem[] => {
  const raw = Array.isArray(data.items) ? data.items : [];
  return raw.map((entry) => {
    const rec = (entry && typeof entry === "object" ? entry : {}) as Record<string, Json>;
    const s = (v: Json | undefined) => (typeof v === "string" ? v : "");
    return {
      labelPl: s(rec.labelPl),
      labelEn: s(rec.labelEn),
      url: s(rec.url),
      imageSrc: s(rec.imageSrc),
    };
  });
};

export function LinkPreviewBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const lp = (k: string) => i18n.editor("linkPreview", k);
  const items = readItems(block.data);
  const preview = block.data.preview !== false;
  const layout = block.data.layout === "list" ? "list" : "inline";

  const patch = (key: string, value: Json) =>
    onChange({ ...block, data: { ...block.data, [key]: value } });

  const patchItem = (index: number, key: keyof RawItem, value: string) => {
    const next = items.map((item, i) => (i === index ? { ...item, [key]: value } : item));
    patch("items", toJson(next));
  };

  const addItem = () =>
    patch("items", toJson([...items, { labelPl: "", labelEn: "", url: "", imageSrc: "" }]));

  const removeItem = (index: number) => patch("items", toJson(items.filter((_, i) => i !== index)));

  return (
    <div className="not-prose space-y-3 rounded-[var(--radius)] border border-border bg-card p-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Link2 className="h-3.5 w-3.5" /> {lp("shellLabel")}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          placeholder={lp("introPl")}
          value={String(block.data.introPl ?? "")}
          onChange={(e) => patch("introPl", e.target.value)}
        />
        <Input
          placeholder={lp("introEn")}
          value={String(block.data.introEn ?? "")}
          onChange={(e) => patch("introEn", e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Switch
            id={`${block.id}-preview`}
            checked={preview}
            onCheckedChange={(v) => patch("preview", v)}
          />
          <Label htmlFor={`${block.id}-preview`} className="text-xs">
            {lp("enablePreview")}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id={`${block.id}-layout`}
            checked={layout === "list"}
            onCheckedChange={(v) => patch("layout", v ? "list" : "inline")}
          />
          <Label htmlFor={`${block.id}-layout`} className="text-xs">
            {lp("layoutList")}
          </Label>
        </div>
      </div>

      <div className="space-y-2">
        {items.map((item, index) => (
          <div
            key={index}
            className="space-y-2 rounded-[var(--radius)] border border-border/70 p-2"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                placeholder={lp("labelPl")}
                value={item.labelPl}
                onChange={(e) => patchItem(index, "labelPl", e.target.value)}
              />
              <Input
                placeholder={lp("labelEn")}
                value={item.labelEn}
                onChange={(e) => patchItem(index, "labelEn", e.target.value)}
              />
              <Input
                placeholder={lp("url")}
                value={item.url}
                onChange={(e) => patchItem(index, "url", e.target.value)}
              />
              <Input
                placeholder={lp("imageSrc")}
                value={item.imageSrc}
                onChange={(e) => patchItem(index, "imageSrc", e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeItem(index)}
              aria-label={lp("removeLink")}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> {lp("removeLink")}
            </Button>
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={addItem}>
        <Plus className="mr-1 h-3.5 w-3.5" /> {lp("addLink")}
      </Button>
      <p className="text-xs text-muted-foreground">{lp("hint")}</p>
    </div>
  );
}
