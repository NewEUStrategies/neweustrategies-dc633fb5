// Organism: edytor widgetu "circular-carousel" (karuzela okrężna).
// Lista kart (tag PL/EN, tytuł PL/EN, opis PL/EN, link) + ustawienia globalne.
// Pola wyglądu (`visibleCount`, `radiusX`, `radiusY`, `accentColor`) mieszkają
// w `WIDGET_SCHEMAS["circular-carousel"]` i są rysowane `SchemaFieldControl`,
// żeby panel nie rozjechał się z rendererem.
import { toJson } from "@/lib/builder/types";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";
import { useBuilderLabel } from "@/lib/builder/labelsEn";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PropField, ItemFrame } from "../../atoms";
import { SchemaFieldControl } from "./SchemaFieldControl";
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

const APPEARANCE_FIELDS = WIDGET_SCHEMAS["circular-carousel"] ?? [];

export const CIRCULAR_CAROUSEL_EDITOR_HANDLED_KEYS: ReadonlySet<string> = new Set<string>([
  "heading",
  "autoPlay",
  "autoPlayInterval",
  "showCounter",
  "showDots",
  "showArrows",
  "items",
  ...APPEARANCE_FIELDS.map((f) => f.key),
]);

export function CircularCarouselEditor({ c, lang, setContent }: Props) {
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
        id: `card-${items.length + 1}`,
        href: "",
        tag_pl: "",
        tag_en: "",
        title_pl: `Karta ${items.length + 1}`,
        title_en: `Card ${items.length + 1}`,
        desc_pl: "",
        desc_en: "",
      },
    ]);

  const interval = typeof c.autoPlayInterval === "number" ? c.autoPlayInterval : 4000;
  const autoPlay = c.autoPlay !== false;
  const showCounter = c.showCounter !== false;
  const showDots = c.showDots !== false;
  const showArrows = c.showArrows !== false;

  return (
    <div className="space-y-3">
      <PropField label={t("builder.circularCarouselEditor.heading", { lang: lang.toUpperCase() })}>
        <Input
          value={strOf(c[`heading_${lang}`])}
          onChange={(e) => setContent(`heading_${lang}`, e.target.value)}
          className="h-8 text-xs"
        />
      </PropField>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.circularCarouselEditor.interval")}>
          <Input
            type="number"
            min={1000}
            max={30000}
            step={500}
            value={interval}
            onChange={(e) => setContent("autoPlayInterval", Number(e.target.value) || 4000)}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label={t("builder.circularCarouselEditor.toggles")}>
          <div className="flex flex-col gap-1 text-[11px]">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={autoPlay}
                onChange={(e) => setContent("autoPlay", e.target.checked)}
              />
              {t("builder.circularCarouselEditor.autoPlay")}
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={showCounter}
                onChange={(e) => setContent("showCounter", e.target.checked)}
              />
              {t("builder.circularCarouselEditor.showCounter")}
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={showDots}
                onChange={(e) => setContent("showDots", e.target.checked)}
              />
              {t("builder.circularCarouselEditor.showDots")}
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={showArrows}
                onChange={(e) => setContent("showArrows", e.target.checked)}
              />
              {t("builder.circularCarouselEditor.showArrows")}
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

      <ListShell title={t("builder.circularCarouselEditor.cards")} items={items} onAdd={add}>
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
              <PropField
                label={t("builder.circularCarouselEditor.tag", { lang: lang.toUpperCase() })}
              >
                <Input
                  value={strOf(it[`tag_${lang}`])}
                  onChange={(e) => patch(i, { [`tag_${lang}`]: e.target.value })}
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField
                label={t("builder.circularCarouselEditor.title", { lang: lang.toUpperCase() })}
              >
                <Input
                  value={strOf(it[`title_${lang}`])}
                  onChange={(e) => patch(i, { [`title_${lang}`]: e.target.value })}
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField
                label={t("builder.circularCarouselEditor.desc", { lang: lang.toUpperCase() })}
              >
                <Textarea
                  value={strOf(it[`desc_${lang}`])}
                  onChange={(e) => patch(i, { [`desc_${lang}`]: e.target.value })}
                  rows={2}
                  className="text-xs"
                />
              </PropField>
              <PropField label={t("builder.circularCarouselEditor.href")}>
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
