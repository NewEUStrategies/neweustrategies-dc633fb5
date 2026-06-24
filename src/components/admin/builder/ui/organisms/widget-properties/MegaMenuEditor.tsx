// Organism: Mega menu editor - trigger + columns (title/links/featured).
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { PropField, ItemFrame, NumberInput } from "../../atoms";
import { ListShell } from "./ListShell";
import { ImageSlot } from "./ImageSlot";
import { itemsOf, type Item } from "./shared";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function MegaMenuEditor({ c, lang, setContent }: Props) {
  const columns = itemsOf(c, "columns");
  const updateCols = (next: Item[]): void => setContent("columns", next as unknown as Json);
  const triggerOn = (str(c.triggerOn) || "hover") as "hover" | "click";
  const width = (str(c.width) || "container") as "container" | "fluid" | "fixed";
  const widthPx = typeof c.widthPx === "number" ? c.widthPx : 1140;

  return (
    <div className="space-y-3">
      <PropField label={`Etykieta wyzwalacza (${lang.toUpperCase()})`}>
        <Input
          value={str(c[`trigger_${lang}`])}
          onChange={(e) => setContent(`trigger_${lang}`, e.target.value)}
          className="h-8 text-xs"
          placeholder={lang === "pl" ? "Produkty" : "Products"}
        />
      </PropField>
      <PropField label="URL etykiety (opcjonalny)">
        <Input
          value={str(c.href)}
          onChange={(e) => setContent("href", e.target.value)}
          className="h-8 text-xs"
          placeholder="/produkty"
        />
      </PropField>
      <div className="grid grid-cols-2 gap-2">
        <PropField label="Otwieranie">
          <Select value={triggerOn} onValueChange={(v) => setContent("triggerOn", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="hover">najazd kursora</SelectItem>
              <SelectItem value="click">kliknięcie</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label="Szerokość panelu">
          <Select value={width} onValueChange={(v) => setContent("width", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="container">do containera</SelectItem>
              <SelectItem value="fluid">pełna szerokość</SelectItem>
              <SelectItem value="fixed">stała (px)</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
      </div>
      {width === "fixed" && (
        <PropField label="Szerokość (px)">
          <NumberInput
            value={widthPx}
            min={320}
            max={1920}
            step={20}
            onChange={(n) => setContent("widthPx", n)}
          />
        </PropField>
      )}

      <ListShell
        title="Kolumny"
        items={columns}
        onAdd={() =>
          updateCols([
            ...columns,
            {
              title_pl: "Nowa kolumna",
              title_en: "New column",
              links: [{ label_pl: "Nowy link", label_en: "New link", href: "#" }],
            },
          ])
        }
      >
        <div className="space-y-2">
          {columns.map((col, i) => (
            <ColumnEditor
              key={i}
              col={col}
              lang={lang}
              onChange={(next) => updateCols(columns.map((x, j) => (j === i ? next : x)))}
              onRemove={() => updateCols(columns.filter((_, j) => j !== i))}
              index={i}
            />
          ))}
        </div>
      </ListShell>
    </div>
  );
}

function ColumnEditor({
  col, lang, onChange, onRemove, index,
}: {
  col: Item;
  lang: "pl" | "en";
  onChange: (next: Item) => void;
  onRemove: () => void;
  index: number;
}) {
  const links = Array.isArray(col.links) ? (col.links as Item[]) : [];
  const featured = (col.featured ?? null) as Item | null;
  const set = (k: string, v: unknown): void => onChange({ ...col, [k]: v as Json });
  const updateLinks = (next: Item[]): void => set("links", next);

  return (
    <ItemFrame title={`Kolumna #${index + 1}`} onRemove={onRemove}>
      <PropField label={`Nagłówek kolumny (${lang.toUpperCase()})`}>
        <Input
          value={str(col[`title_${lang}`])}
          onChange={(e) => set(`title_${lang}`, e.target.value)}
          className="h-8 text-xs"
        />
      </PropField>

      <div className="space-y-1">
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Linki</div>
        {links.map((l, i) => (
          <div key={i} className="rounded-md border border-border p-2 space-y-1">
            <div className="grid grid-cols-2 gap-1">
              <Input
                placeholder={lang === "pl" ? "Etykieta PL" : "Etykieta PL"}
                value={str(l[`label_${lang}`])}
                onChange={(e) => updateLinks(links.map((x, j) => (j === i ? { ...x, [`label_${lang}`]: e.target.value } : x)))}
                className="h-7 text-xs"
              />
              <Input
                placeholder="URL"
                value={str(l.href)}
                onChange={(e) => updateLinks(links.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)))}
                className="h-7 text-xs"
              />
            </div>
            <Input
              placeholder={lang === "pl" ? "Opis (opcjonalnie)" : "Description (optional)"}
              value={str(l[`desc_${lang}`])}
              onChange={(e) => updateLinks(links.map((x, j) => (j === i ? { ...x, [`desc_${lang}`]: e.target.value } : x)))}
              className="h-7 text-xs"
            />
            <button
              type="button"
              className="text-[11px] text-destructive hover:underline"
              onClick={() => updateLinks(links.filter((_, j) => j !== i))}
            >
              usuń link
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-xs text-brand hover:underline"
          onClick={() => updateLinks([...links, { label_pl: "Nowy link", label_en: "New link", href: "#" }])}
        >
          + dodaj link
        </button>
      </div>

      <div className="space-y-1 pt-2 border-t border-border">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Karta wyróżniona</div>
          {featured ? (
            <button type="button" className="text-[11px] text-destructive hover:underline" onClick={() => set("featured", null as unknown as Json)}>
              usuń
            </button>
          ) : (
            <button type="button" className="text-[11px] text-brand hover:underline" onClick={() => set("featured", { title_pl: "Tytuł", title_en: "Title" } as unknown as Json)}>
              + dodaj
            </button>
          )}
        </div>
        {featured && (
          <div className="rounded-md border border-border p-2 space-y-1">
            <ImageSlot
              label="Obraz"
              value={str(featured.image)}
              onChange={(v) => set("featured", { ...featured, image: v } as unknown as Json)}
            />
            <Input
              placeholder={`Tytuł ${lang.toUpperCase()}`}
              value={str(featured[`title_${lang}`])}
              onChange={(e) => set("featured", { ...featured, [`title_${lang}`]: e.target.value } as unknown as Json)}
              className="h-7 text-xs"
            />
            <Textarea
              placeholder={`Opis ${lang.toUpperCase()}`}
              rows={2}
              value={str(featured[`excerpt_${lang}`])}
              onChange={(e) => set("featured", { ...featured, [`excerpt_${lang}`]: e.target.value } as unknown as Json)}
              className="text-xs"
            />
            <div className="grid grid-cols-2 gap-1">
              <Input
                placeholder="URL"
                value={str(featured.href)}
                onChange={(e) => set("featured", { ...featured, href: e.target.value } as unknown as Json)}
                className="h-7 text-xs"
              />
              <Input
                placeholder={`CTA ${lang.toUpperCase()}`}
                value={str(featured[`cta_${lang}`])}
                onChange={(e) => set("featured", { ...featured, [`cta_${lang}`]: e.target.value } as unknown as Json)}
                className="h-7 text-xs"
              />
            </div>
          </div>
        )}
      </div>
    </ItemFrame>
  );
}
