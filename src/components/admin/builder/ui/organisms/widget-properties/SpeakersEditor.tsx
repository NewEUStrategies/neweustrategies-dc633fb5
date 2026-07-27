// Organism: "Speakers" widget editor. Nagłówek i18n + siatka prelegentów
// z polami (zdjęcie, imię, rola/kategoria PL/EN, statystyki, opis, link).
// Kategorie do filtra są automatycznie odczytywane z pola `category_${lang}`
// każdego speakera - nie trzymamy osobnej listy, żeby edycja była jednym
// źródłem prawdy.
import { toJson } from "@/lib/builder/types";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
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

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");
const numOf = (v: unknown, fb = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fb;
};

export function SpeakersEditor({ c, lang, setContent }: Props) {
  const speakers = itemsOf(c, "speakers");
  const commit = (next: Item[]) => setContent("speakers", toJson(next));
  const patch = (i: number, p: Partial<Item>) =>
    commit(speakers.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= speakers.length) return;
    const next = speakers.slice();
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };
  const remove = (i: number) => commit(speakers.filter((_, j) => j !== i));
  const add = () =>
    commit([
      ...speakers,
      {
        id: `sp-${Date.now().toString(36)}`,
        photo: "",
        name: "",
        role_pl: "",
        role_en: "",
        category_pl: "",
        category_en: "",
        gigs: 0,
        rating: 0,
        reviews: 0,
        description_pl: "",
        description_en: "",
        href: "",
      },
    ]);

  const columns = numOf(c.columns, 3);
  const accent = strOf(c.accentColor);

  const l = (pl: string, en: string) => (lang === "pl" ? pl : en);

  return (
    <div className="space-y-3">
      <PropField label={l("Nagłówek", "Heading") + ` (${lang.toUpperCase()})`}>
        <Input
          value={strOf(c[`heading_${lang}`])}
          onChange={(e) => setContent(`heading_${lang}`, e.target.value)}
          className="h-8 text-xs"
          placeholder={l("Prelegenci", "Speakers")}
        />
      </PropField>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={l("Liczba kolumn", "Columns")}>
          <Select
            value={String(columns)}
            onValueChange={(v) => setContent("columns", Number(v))}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="3">3</SelectItem>
              <SelectItem value="4">4</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={l("Kolor akcentu", "Accent color")}>
          <ColorField
            value={accent}
            onChange={(v) => setContent("accentColor", v ?? "")}
          />
        </PropField>
      </div>

      <ListShell title={l("Prelegenci", "Speakers")} items={speakers} onAdd={add}>
        <div className="space-y-2">
          {speakers.map((it, i) => (
            <ItemFrame
              key={(it.id as string) ?? i}
              title={strOf(it.name) || `#${i + 1}`}
              onRemove={() => remove(i)}
            >
              <div className="mb-1 flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1 text-[10px]"
                  onClick={() => move(i, -1)}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1 text-[10px]"
                  onClick={() => move(i, 1)}
                >
                  ↓
                </Button>
              </div>

              <PropField label={l("Zdjęcie (URL)", "Photo (URL)")}>
                <Input
                  value={strOf(it.photo)}
                  onChange={(e) => patch(i, { photo: e.target.value })}
                  placeholder="https://…"
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField label={l("Imię i nazwisko", "Full name")}>
                <Input
                  value={strOf(it.name)}
                  onChange={(e) => patch(i, { name: e.target.value })}
                  className="h-8 text-xs"
                />
              </PropField>

              <div className="grid grid-cols-2 gap-2">
                <PropField label={`${l("Rola", "Role")} PL`}>
                  <Input
                    value={strOf(it.role_pl)}
                    onChange={(e) => patch(i, { role_pl: e.target.value })}
                    className="h-8 text-xs"
                  />
                </PropField>
                <PropField label={`${l("Rola", "Role")} EN`}>
                  <Input
                    value={strOf(it.role_en)}
                    onChange={(e) => patch(i, { role_en: e.target.value })}
                    className="h-8 text-xs"
                  />
                </PropField>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <PropField label={`${l("Kategoria", "Category")} PL`}>
                  <Input
                    value={strOf(it.category_pl)}
                    onChange={(e) => patch(i, { category_pl: e.target.value })}
                    className="h-8 text-xs"
                  />
                </PropField>
                <PropField label={`${l("Kategoria", "Category")} EN`}>
                  <Input
                    value={strOf(it.category_en)}
                    onChange={(e) => patch(i, { category_en: e.target.value })}
                    className="h-8 text-xs"
                  />
                </PropField>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <PropField label={l("Wystąpienia", "Gigs")}>
                  <Input
                    type="number"
                    min={0}
                    value={numOf(it.gigs)}
                    onChange={(e) => patch(i, { gigs: Number(e.target.value) || 0 })}
                    className="h-8 text-xs"
                  />
                </PropField>
                <PropField label={l("Ocena", "Rating")}>
                  <Input
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    value={numOf(it.rating)}
                    onChange={(e) => patch(i, { rating: Number(e.target.value) || 0 })}
                    className="h-8 text-xs"
                  />
                </PropField>
                <PropField label={l("Opinie", "Reviews")}>
                  <Input
                    type="number"
                    min={0}
                    value={numOf(it.reviews)}
                    onChange={(e) => patch(i, { reviews: Number(e.target.value) || 0 })}
                    className="h-8 text-xs"
                  />
                </PropField>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <PropField label={`${l("Opis", "Description")} PL`}>
                  <Textarea
                    rows={2}
                    value={strOf(it.description_pl)}
                    onChange={(e) => patch(i, { description_pl: e.target.value })}
                    className="text-xs"
                  />
                </PropField>
                <PropField label={`${l("Opis", "Description")} EN`}>
                  <Textarea
                    rows={2}
                    value={strOf(it.description_en)}
                    onChange={(e) => patch(i, { description_en: e.target.value })}
                    className="text-xs"
                  />
                </PropField>
              </div>

              <PropField
                label={l("Link (opcjonalny)", "Link (optional)")}
                hint={l("np. /author/imie-nazwisko", "e.g. /author/first-last")}
              >
                <Input
                  value={strOf(it.href)}
                  onChange={(e) => patch(i, { href: e.target.value })}
                  placeholder="/author/…"
                  className="h-8 text-xs"
                />
              </PropField>
            </ItemFrame>
          ))}
        </div>
      </ListShell>
    </div>
  );
}
