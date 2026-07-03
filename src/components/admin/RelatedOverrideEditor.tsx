// Compact per-post override editor for the related-posts block.
// Stores a partial RelatedPostsConfig in posts.related_override (jsonb).
import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  RelatedLayout,
  RelatedPosition,
  RelatedPostsOverride,
  RelatedSource,
} from "@/lib/relatedPosts";

interface Props {
  value: Record<string, unknown> | null;
  onChange: (next: Record<string, unknown> | null) => void;
}

export function RelatedOverrideEditor({ value, onChange }: Props) {
  const override = (value ?? {}) as RelatedPostsOverride;
  const [enabledOverride, setEnabledOverride] = useState<boolean>(value !== null);

  const setKey = <K extends keyof RelatedPostsOverride>(
    k: K,
    v: RelatedPostsOverride[K] | undefined,
  ) => {
    const next: RelatedPostsOverride = { ...override };
    if (v === undefined) {
      delete next[k];
    } else {
      next[k] = v;
    }
    onChange(Object.keys(next).length === 0 ? null : (next as Record<string, unknown>));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Nadpisuje globalną konfigurację dla tego wpisu.
        </span>
        <label className="flex items-center gap-2 text-xs">
          <span>Nadpisanie aktywne</span>
          <Switch
            checked={enabledOverride}
            onCheckedChange={(v) => {
              setEnabledOverride(v);
              if (!v) onChange(null);
            }}
          />
        </label>
      </div>

      {enabledOverride && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Pokaż sekcję</Label>
            <Select
              value={override.enabled === undefined ? "_" : override.enabled ? "yes" : "no"}
              onValueChange={(v) => setKey("enabled", v === "_" ? undefined : v === "yes")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_">(globalnie)</SelectItem>
                <SelectItem value="yes">Tak</SelectItem>
                <SelectItem value="no">Nie</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Pozycja</Label>
            <Select
              value={(override.position ?? "_") as string}
              onValueChange={(v) =>
                setKey("position", v === "_" ? undefined : (v as RelatedPosition))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_">(globalnie)</SelectItem>
                <SelectItem value="end">Na końcu</SelectItem>
                <SelectItem value="sidebar">Sidebar</SelectItem>
                <SelectItem value="after_paragraph">Po paragrafie</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Layout</Label>
            <Select
              value={(override.layout ?? "_") as string}
              onValueChange={(v) => setKey("layout", v === "_" ? undefined : (v as RelatedLayout))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_">(globalnie)</SelectItem>
                <SelectItem value="grid">Grid</SelectItem>
                <SelectItem value="list">Lista</SelectItem>
                <SelectItem value="slider">Slider</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Strategia</Label>
            <Select
              value={(override.source_strategy ?? "_") as string}
              onValueChange={(v) =>
                setKey("source_strategy", v === "_" ? undefined : (v as RelatedSource))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_">(globalnie)</SelectItem>
                <SelectItem value="both">Kat + Tagi</SelectItem>
                <SelectItem value="categories">Kategorie</SelectItem>
                <SelectItem value="tags">Tagi</SelectItem>
                <SelectItem value="author">Autor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Liczba wpisów</Label>
            <Input
              type="number"
              min={1}
              max={24}
              value={override.items_limit ?? ""}
              placeholder="(globalnie)"
              onChange={(e) => {
                const n = Number(e.target.value);
                setKey("items_limit", Number.isFinite(n) && n > 0 ? n : undefined);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Po paragrafie</Label>
            <Input
              type="number"
              min={1}
              value={override.after_paragraph ?? ""}
              placeholder="(globalnie)"
              onChange={(e) => {
                const n = Number(e.target.value);
                setKey("after_paragraph", Number.isFinite(n) && n > 0 ? n : undefined);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
