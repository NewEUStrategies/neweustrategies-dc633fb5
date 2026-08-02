// Organism: edytor widgetu "progress-carousel" (progresywna karuzela).
// Lista slajdów (obraz, tytuł PL/EN, opis PL/EN, link) + ustawienia globalne.
//
// Wygląd karuzeli (`ratio`, `accentColor`) czyta renderer (ProgressCarouselView),
// ale panel nie miał dla nich ŻADNEJ kontrolki. Pola mieszkają w
// `WIDGET_SCHEMAS["progress-carousel"]` i są rysowane molekułą
// `SchemaFieldControl`, żeby lista wariantów proporcji nie rozjechała się
// z mapą `RATIO_CLASS` renderera przy kolejnej zmianie.
import { toJson } from "@/lib/builder/types";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";
import { useBuilderLabel } from "@/lib/builder/labelsEn";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PropField, ItemFrame } from "../../atoms";
import { SchemaFieldControl } from "../../molecules/SchemaFieldControl";
import { ListShell } from "./ListShell";
import { itemsOf, type Item } from "./shared";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");

/** Pola wyglądu rysowane ze schematu (jedyne źródło etykiet i opcji). */
const APPEARANCE_FIELDS = WIDGET_SCHEMAS["progress-carousel"] ?? [];

/**
 * Klucze treści obsługiwane przez ten edytor. Panel dorenderowuje pola
 * schematu spoza tego zbioru - patrz `CUSTOM_EDITOR_HANDLED_KEYS`.
 */
export const PROGRESS_CAROUSEL_EDITOR_HANDLED_KEYS: ReadonlySet<string> = new Set<string>([
  "heading",
  "duration",
  "vertical",
  "showDesc",
  "items",
  ...APPEARANCE_FIELDS.map((f) => f.key),
]);

export function ProgressCarouselEditor({ c, lang, setContent }: Props) {
  const { t } = useTranslation();
  const bl = useBuilderLabel();
  const items = itemsOf(c, "items");
  const commit = (next: Item[]) => setContent("items", toJson(next));
  const patch = (i: number, p: Partial<Item>) =>
    commit(items.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };
  const remove = (i: number) => commit(items.filter((_, j) => j !== i));
  const add = () =>
    commit([
      ...items,
      {
        value: `slide-${items.length + 1}`,
        img: "",
        href: "",
        title_pl: `Slajd ${items.length + 1}`,
        title_en: `Slide ${items.length + 1}`,
        desc_pl: "",
        desc_en: "",
      },
    ]);

  const duration = typeof c.duration === "number" ? c.duration : 5000;
  const vertical = c.vertical === true;
  const showDesc = c.showDesc !== false;

  return (
    <div className="space-y-3">
      <PropField label={t("builder.progressCarouselEditor.heading", { lang: lang.toUpperCase() })}>
        <Input
          value={strOf(c[`heading_${lang}`])}
          onChange={(e) => setContent(`heading_${lang}`, e.target.value)}
          className="h-8 text-xs"
        />
      </PropField>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.progressCarouselEditor.duration")}>
          <Input
            type="number"
            min={1000}
            max={30000}
            step={500}
            value={duration}
            onChange={(e) => setContent("duration", Number(e.target.value) || 5000)}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label={t("builder.progressCarouselEditor.toggles")}>
          <div className="flex flex-col gap-1 text-[11px]">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={vertical}
                onChange={(e) => setContent("vertical", e.target.checked)}
              />
              {t("builder.progressCarouselEditor.vertical")}
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={showDesc}
                onChange={(e) => setContent("showDesc", e.target.checked)}
              />
              {t("builder.progressCarouselEditor.showDesc")}
            </label>
          </div>
        </PropField>
      </div>

      <section className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-2">
        <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {bl("Wygląd")}
        </h4>
        {APPEARANCE_FIELDS.map((field) => (
          <SchemaFieldControl
            key={field.key}
            field={field}
            lang={lang}
            content={c}
            setContent={setContent}
          />
        ))}
      </section>

      <ListShell title={t("builder.progressCarouselEditor.slides")} items={items} onAdd={add}>
        <div className="space-y-2">
          {items.map((it, i) => (
            <ItemFrame
              key={i}
              title={strOf(it[`title_${lang}`]) || `#${i + 1}`}
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
              <PropField label={t("builder.progressCarouselEditor.img")}>
                <Input
                  value={strOf(it.img)}
                  onChange={(e) => patch(i, { img: e.target.value })}
                  placeholder="https://…"
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField
                label={t("builder.progressCarouselEditor.title", { lang: lang.toUpperCase() })}
              >
                <Input
                  value={strOf(it[`title_${lang}`])}
                  onChange={(e) => patch(i, { [`title_${lang}`]: e.target.value })}
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField
                label={t("builder.progressCarouselEditor.desc", { lang: lang.toUpperCase() })}
              >
                <Textarea
                  value={strOf(it[`desc_${lang}`])}
                  onChange={(e) => patch(i, { [`desc_${lang}`]: e.target.value })}
                  rows={2}
                  className="text-xs"
                />
              </PropField>
              <PropField label={t("builder.progressCarouselEditor.href")}>
                <Input
                  value={strOf(it.href)}
                  onChange={(e) => patch(i, { href: e.target.value })}
                  placeholder="https://…"
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
