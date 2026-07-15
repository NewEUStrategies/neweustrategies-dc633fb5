// Organism: edytor widgetu "Interaktywne koło". Umożliwia edycję pozycji
// (ikona Lucide, etykieta, tytuł, opis, link), tekstu centralnego, układu
// (semi / full), zachowania (hover / click), rozmiarów i wszystkich kolorów.
// Dopasowany do naszego layoutu: te same ListShell / ItemFrame / PropField,
// LucideIconPicker i ColorField co pozostałe edytory.
import { toJson } from "@/lib/builder/types";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PropField, ItemFrame, ColorField } from "../../atoms";
import { ListShell } from "./ListShell";
import { itemsOf, type Item } from "./shared";
import { LucideIconPicker } from "../../molecules/LucideIconPicker";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

const s = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const n = (v: unknown, d = 0): number => (typeof v === "number" ? v : d);

export function InteractiveCircleEditor({ c, lang, setContent }: Props) {
  const items = itemsOf(c, "items");
  const update = (next: Item[]) => setContent("items", toJson(next));
  const patch = (i: number, delta: Partial<Item>) =>
    update(items.map((x, j) => (j === i ? { ...x, ...delta } : x)));

  const layout = s(c.layout, "semi");
  const trigger = s(c.trigger, "hover");

  return (
    <div className="space-y-4">
      {/* Ustawienia ogólne */}
      <div className="grid grid-cols-2 gap-2">
        <PropField label="Układ">
          <Select value={layout} onValueChange={(v) => setContent("layout", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="semi">Półokrąg</SelectItem>
              <SelectItem value="full">Pełny okrąg</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label="Aktywacja">
          <Select value={trigger} onValueChange={(v) => setContent("trigger", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hover">Najechanie</SelectItem>
              <SelectItem value="click">Kliknięcie</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label="Średnica (px)">
          <Input
            type="number"
            min={280}
            max={900}
            value={n(c.size, 480)}
            onChange={(e) => setContent("size", Number(e.target.value) || 480)}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label="Rozmiar pozycji (px)">
          <Input
            type="number"
            min={40}
            max={140}
            value={n(c.itemSize, 72)}
            onChange={(e) => setContent("itemSize", Number(e.target.value) || 72)}
            className="h-8 text-xs"
          />
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label="Grubość łuku (px)">
          <Input
            type="number"
            min={1}
            max={8}
            value={n(c.circleThickness, 2)}
            onChange={(e) => setContent("circleThickness", Number(e.target.value) || 2)}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label="Kolor łuku">
          <ColorField
            value={s(c.circleColor) || undefined}
            onChange={(v) => setContent("circleColor", v ?? "")}
            placeholder="np. #7c3aed"
          />
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label="Tło pozycji">
          <ColorField
            value={s(c.itemBg) || undefined}
            onChange={(v) => setContent("itemBg", v ?? "")}
            placeholder="domyślnie: karta"
          />
        </PropField>
        <PropField label="Kolor pozycji">
          <ColorField
            value={s(c.itemColor) || undefined}
            onChange={(v) => setContent("itemColor", v ?? "")}
            placeholder="ikona + tekst"
          />
        </PropField>
        <PropField label="Tło aktywne">
          <ColorField
            value={s(c.activeBg) || undefined}
            onChange={(v) => setContent("activeBg", v ?? "")}
            placeholder="domyślnie: brand"
          />
        </PropField>
        <PropField label="Kolor aktywny">
          <ColorField
            value={s(c.activeColor) || undefined}
            onChange={(v) => setContent("activeColor", v ?? "")}
            placeholder="na tle aktywnym"
          />
        </PropField>
      </div>

      {/* Tekst centralny (fallback gdy pozycja nie ma własnego opisu) */}
      <div className="rounded border border-border p-2 space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Tekst domyślny ({lang.toUpperCase()})
        </p>
        <PropField label="Nagłówek">
          <Input
            value={s(c[`title_${lang}`])}
            onChange={(e) => setContent(`title_${lang}`, e.target.value)}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label="Opis">
          <Textarea
            rows={3}
            value={s(c[`desc_${lang}`])}
            onChange={(e) => setContent(`desc_${lang}`, e.target.value)}
            className="text-xs"
          />
        </PropField>
      </div>

      {/* Lista pozycji */}
      <ListShell
        title="Pozycje (do 8)"
        items={items}
        onAdd={() =>
          items.length < 8 &&
          update([
            ...items,
            {
              icon: "Star",
              label_pl: `Pozycja ${items.length + 1}`,
              label_en: `Item ${items.length + 1}`,
              title_pl: `Pozycja ${items.length + 1}`,
              title_en: `Item ${items.length + 1}`,
              desc_pl: "",
              desc_en: "",
              href: "",
            },
          ])
        }
      >
        <div className="space-y-2">
          {items.map((it, i) => (
            <ItemFrame
              key={i}
              title={`#${i + 1} · ${s(it[`label_${lang}`]) || s(it.label_pl) || "-"}`}
              onRemove={() => update(items.filter((_, j) => j !== i))}
            >
              <PropField label="Ikona (Lucide)">
                <LucideIconPicker
                  value={s(it.icon)}
                  onChange={(v) => patch(i, { icon: v ?? "" })}
                />
              </PropField>
              <PropField label={`Etykieta (${lang.toUpperCase()})`}>
                <Input
                  value={s(it[`label_${lang}`])}
                  onChange={(e) => patch(i, { [`label_${lang}`]: e.target.value })}
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField label={`Tytuł w środku (${lang.toUpperCase()})`}>
                <Input
                  value={s(it[`title_${lang}`])}
                  onChange={(e) => patch(i, { [`title_${lang}`]: e.target.value })}
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField label={`Opis (${lang.toUpperCase()})`}>
                <Textarea
                  rows={3}
                  value={s(it[`desc_${lang}`])}
                  onChange={(e) => patch(i, { [`desc_${lang}`]: e.target.value })}
                  className="text-xs"
                />
              </PropField>
              <PropField label="Link (opcjonalny)">
                <Input
                  value={s(it.href)}
                  onChange={(e) => patch(i, { href: e.target.value })}
                  className="h-8 text-xs"
                  placeholder="https://…"
                />
              </PropField>
            </ItemFrame>
          ))}
        </div>
      </ListShell>
    </div>
  );
}
