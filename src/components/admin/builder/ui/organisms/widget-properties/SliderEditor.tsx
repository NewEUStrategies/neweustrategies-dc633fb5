// Organism: slider widget editor (variant grid + slide list + live preview).
import { Image as ImageIcon } from "lucide-react";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PropField } from "../../atoms";
import { ImageSlot } from "./ImageSlot";
import {
  SLIDER_VARIANTS,
  SliderRender,
  type SliderVariant,
  type SliderItem,
} from "@/lib/builder/sliderVariants";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

export function SliderEditor({ c, lang, setContent }: Props) {
  const variant = ((typeof c.variant === "string" && c.variant) || "classic") as SliderVariant;
  const ratio = (typeof c.ratio === "string" ? c.ratio : "16/9") as "16/9" | "4/3" | "1/1" | "21/9" | "3/2";
  const autoplay = c.autoplay !== false;
  const intervalMs = typeof c.intervalMs === "number" ? c.intervalMs : 4500;
  const rounded = (typeof c.rounded === "string" ? c.rounded : "md") as "none" | "sm" | "md" | "lg" | "xl" | "full";
  const overlayOpacity = typeof c.overlayOpacity === "number" ? c.overlayOpacity : 0.45;
  const source = (typeof c.source === "string" ? c.source : "manual") as "manual" | "posts";
  const limit = typeof c.limit === "number" ? c.limit : 5;
  const categoryId = typeof c.categoryId === "string" ? c.categoryId : "";
  const tagSlugs = typeof c.tagSlugs === "string" ? c.tagSlugs : "";
  const excludeIds = typeof c.excludeIds === "string" ? c.excludeIds : "";
  const orderBy = (typeof c.orderBy === "string" ? c.orderBy : "newest") as "newest" | "oldest" | "title";
  const showExcerpt = c.showExcerpt !== false;
  const ctaKey = `cta_${lang}` as const;
  const ctaValue = typeof c[ctaKey] === "string" ? (c[ctaKey] as string) : "";


  const rawItems = Array.isArray(c.items) ? (c.items as unknown[]) : [];
  const items: SliderItem[] = rawItems
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map((it) => ({
      image: typeof it.image === "string" ? it.image : "",
      title_pl: typeof it.title_pl === "string" ? it.title_pl : "",
      title_en: typeof it.title_en === "string" ? it.title_en : "",
      subtitle_pl: typeof it.subtitle_pl === "string" ? it.subtitle_pl : "",
      subtitle_en: typeof it.subtitle_en === "string" ? it.subtitle_en : "",
      href: typeof it.href === "string" ? it.href : "",
      cta_pl: typeof it.cta_pl === "string" ? it.cta_pl : "",
      cta_en: typeof it.cta_en === "string" ? it.cta_en : "",
    }));

  const updateItems = (next: SliderItem[]) =>
    setContent("items", next as unknown as Json);
  const updateItem = (i: number, patch: Partial<SliderItem>) => {
    const next = items.slice();
    next[i] = { ...next[i], ...patch };
    updateItems(next);
  };
  const addItem = () =>
    updateItems([...items, { image: "", title_pl: "", title_en: "", subtitle_pl: "", subtitle_en: "", href: "", cta_pl: "", cta_en: "" }]);
  const removeItem = (i: number) => updateItems(items.filter((_, j) => j !== i));
  const moveItem = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    updateItems(next);
  };

  const previewCfg = {
    variant, ratio, autoplay: false, intervalMs, rounded, overlayOpacity,
    items: items.length ? items : [{ image: "" } as SliderItem],
  };

  return (
    <div className="space-y-4">
      {/* Variant picker */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Wariant slidera
        </div>
        <div className="grid grid-cols-2 gap-2">
          {SLIDER_VARIANTS.map((v) => {
            const isActive = variant === v.value;
            const sample: SliderItem[] = items.length && items[0].image
              ? items.slice(0, 2)
              : [{ image: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=600", title_pl: "Przykład", title_en: "Sample", subtitle_pl: "Podtytuł", subtitle_en: "Subtitle", href: "#", cta_pl: "Zobacz", cta_en: "View" }];
            return (
              <button
                key={v.value}
                type="button"
                onClick={() => setContent("variant", v.value)}
                className={`relative text-left rounded-md border overflow-hidden transition ${isActive ? "ring-2 ring-brand border-brand" : "border-border hover:border-brand/50"}`}
                title={v.label}
              >
                <div className="pointer-events-none">
                  <SliderRender
                    config={{ variant: v.value, ratio: "16/9", autoplay: false, rounded: "none", overlayOpacity, items: sample }}
                    lang={lang}
                    preview
                  />
                </div>
                <div className="px-2 py-1 text-[10px] font-medium border-t border-border bg-muted/40 flex items-center justify-between">
                  <span>{v.label}</span>
                  {isActive && <span className="text-brand">✓</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Source */}
      <div className="space-y-2 rounded-md border border-border p-2 bg-muted/20">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Źródło slajdów</div>
        <PropField label="Źródło">
          <Select value={source} onValueChange={(v) => setContent("source", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Ręcznie (slajdy poniżej)</SelectItem>
              <SelectItem value="posts">Wpisy z bazy (filtry poniżej)</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        {source === "posts" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <PropField label="Liczba slajdów">
                <Input type="number" min={1} max={20} value={limit}
                  onChange={(e) => setContent("limit", Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
                  className="h-8 text-xs" />
              </PropField>
              <PropField label="Sortowanie">
                <Select value={orderBy} onValueChange={(v) => setContent("orderBy", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Najnowsze</SelectItem>
                    <SelectItem value="oldest">Najstarsze</SelectItem>
                    <SelectItem value="title">Tytuł A→Z</SelectItem>
                  </SelectContent>
                </Select>
              </PropField>
            </div>
            <PropField label="ID kategorii (opcjonalnie)">
              <Input value={categoryId}
                onChange={(e) => setContent("categoryId", e.target.value)}
                className="h-8 text-xs font-mono" placeholder="np. 8b3c…-uuid" />
            </PropField>
            <PropField label="Tagi (slug, po przecinku)">
              <Input value={tagSlugs}
                onChange={(e) => setContent("tagSlugs", e.target.value)}
                className="h-8 text-xs" placeholder="geopolityka, raporty" />
            </PropField>
            <PropField label="Wyklucz ID wpisów (po przecinku)">
              <Input value={excludeIds}
                onChange={(e) => setContent("excludeIds", e.target.value)}
                className="h-8 text-xs font-mono" placeholder="uuid1, uuid2" />
            </PropField>
            <div className="grid grid-cols-2 gap-2">
              <PropField label="Pokaż zajawkę">
                <Select value={showExcerpt ? "on" : "off"} onValueChange={(v) => setContent("showExcerpt", v === "on")}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on">tak</SelectItem>
                    <SelectItem value="off">nie</SelectItem>
                  </SelectContent>
                </Select>
              </PropField>
              <PropField label={`Tekst CTA (${lang.toUpperCase()})`}>
                <Input value={ctaValue}
                  onChange={(e) => setContent(ctaKey, e.target.value)}
                  className="h-8 text-xs" placeholder="Czytaj więcej" />
              </PropField>
            </div>
          </>
        )}
      </div>



      {/* Settings */}
      <div className="grid grid-cols-2 gap-2">
        <PropField label="Proporcje">
          <Select value={ratio} onValueChange={(v) => setContent("ratio", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="16/9">16:9</SelectItem>
              <SelectItem value="21/9">21:9 (panorama)</SelectItem>
              <SelectItem value="4/3">4:3</SelectItem>
              <SelectItem value="3/2">3:2</SelectItem>
              <SelectItem value="1/1">1:1 (kwadrat)</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label="Zaokrąglenie">
          <Select value={rounded} onValueChange={(v) => setContent("rounded", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">brak</SelectItem>
              <SelectItem value="sm">małe</SelectItem>
              <SelectItem value="md">średnie</SelectItem>
              <SelectItem value="lg">duże</SelectItem>
              <SelectItem value="xl">XL</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label="Autoodtwarzanie">
          <Select value={autoplay ? "on" : "off"} onValueChange={(v) => setContent("autoplay", v === "on")}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="on">włączone</SelectItem>
              <SelectItem value="off">wyłączone</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label="Interwał (ms)">
          <Input
            type="number"
            min={1500}
            max={20000}
            step={250}
            value={intervalMs}
            onChange={(e) => setContent("intervalMs", Number(e.target.value) || 4500)}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label="Przyciemnienie overlay'a (0–1)">
          <Input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={overlayOpacity}
            onChange={(e) => setContent("overlayOpacity", Math.min(1, Math.max(0, Number(e.target.value) || 0)))}
            className="h-8 text-xs"
          />
        </PropField>
      </div>

      {/* Live preview */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Podgląd na żywo
        </div>
        <div className="rounded-md border border-border p-2 bg-muted/20">
          <SliderRender config={previewCfg} lang={lang} preview />
        </div>
      </div>

      {/* Slides */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Slajdy ({items.length})
          </div>
          <button
            type="button"
            onClick={addItem}
            className="h-7 px-2 rounded border border-border hover:bg-muted text-xs"
          >+ Dodaj slajd</button>
        </div>

        {items.map((it, i) => {
          const titleKey = `title_${lang}` as const;
          const subKey = `subtitle_${lang}` as const;
          const ctaKey = `cta_${lang}` as const;
          return (
            <div key={i} className="rounded-md border border-border p-2 space-y-2 bg-background">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-medium">Slajd #{i + 1}</span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => moveItem(i, -1)} disabled={i === 0}
                    className="h-6 w-6 inline-flex items-center justify-center rounded border border-border hover:bg-muted disabled:opacity-40 text-xs">↑</button>
                  <button type="button" onClick={() => moveItem(i, 1)} disabled={i === items.length - 1}
                    className="h-6 w-6 inline-flex items-center justify-center rounded border border-border hover:bg-muted disabled:opacity-40 text-xs">↓</button>
                  <button type="button" onClick={() => removeItem(i)}
                    className="h-6 w-6 inline-flex items-center justify-center rounded border border-border hover:bg-destructive/10 text-destructive text-xs">×</button>
                </div>
              </div>

              <ImageSlot
                label="Obrazek"
                icon={<ImageIcon className="w-3 h-3" />}
                value={it.image || ""}
                onChange={(v) => updateItem(i, { image: v })}
              />

              <PropField label={`Tytuł (${lang.toUpperCase()})`}>
                <Input value={(it[titleKey] as string) || ""}
                  onChange={(e) => updateItem(i, { [titleKey]: e.target.value })}
                  className="h-8 text-xs" placeholder="np. Najnowsze wieści" />
              </PropField>
              <PropField label={`Podtytuł (${lang.toUpperCase()})`}>
                <Input value={(it[subKey] as string) || ""}
                  onChange={(e) => updateItem(i, { [subKey]: e.target.value })}
                  className="h-8 text-xs" placeholder="krótki opis" />
              </PropField>
              <div className="grid grid-cols-2 gap-2">
                <PropField label="Link">
                  <Input value={it.href || ""}
                    onChange={(e) => updateItem(i, { href: e.target.value })}
                    className="h-8 text-xs" placeholder="/post/..." />
                </PropField>
                <PropField label={`CTA (${lang.toUpperCase()})`}>
                  <Input value={(it[ctaKey] as string) || ""}
                    onChange={(e) => updateItem(i, { [ctaKey]: e.target.value })}
                    className="h-8 text-xs" placeholder="Czytaj więcej" />
                </PropField>
              </div>
            </div>
          );
        })}

        {items.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border rounded">
            Brak slajdów. Dodaj pierwszy slajd ↑
          </div>
        )}
      </div>
    </div>
  );
}
