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
import { ClampedNumberInput } from "../../atoms/ClampedNumberInput";
import { ListShell } from "./ListShell";
import { itemsOf, type Item } from "./shared";
import { LucideIconPicker } from "../../molecules/LucideIconPicker";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

const s = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const n = (v: unknown, d = 0): number => (typeof v === "number" ? v : d);

// Zakresy pól liczbowych 1:1 z `InteractiveCircleWidget` (odczyt
// `Math.max(min, Math.min(max, getNum(c, klucz, domyślna)))`). Panel czyta
// tą samą klamrą i zapisuje domknięte - inaczej pokazywał średnicę 5000,
// a kanwa rysowała 900.
const RANGES = {
  size: { fallback: 480, min: 280, max: 900 },
  itemSize: { fallback: 72, min: 40, max: 140 },
  circleThickness: { fallback: 2, min: 1, max: 8 },
  activeScale: { fallback: 1.15, min: 1, max: 1.6 },
  intervalMs: { fallback: 4000, min: 1500, max: 15000 },
} as const;

export function InteractiveCircleEditor({ c, lang, setContent }: Props) {
  const { t } = useTranslation();
  const items = itemsOf(c, "items");
  const update = (next: Item[]) => setContent("items", toJson(next));
  const patch = (i: number, delta: Partial<Item>) =>
    update(items.map((x, j) => (j === i ? { ...x, ...delta } : x)));

  // Wspólny atom liczby: szkic lokalny, zapis w locie tylko w zakresie, klamra
  // przy wyjściu z pola. Zapis tylko przy realnej zmianie - wyjście z pola bez
  // edycji nie dokłada kroku historii.
  const numberField = (
    key: keyof typeof RANGES,
    label: string,
    opts: { step?: number; precision?: number } = {},
  ) => {
    const { fallback, min, max } = RANGES[key];
    const value = Math.max(min, Math.min(max, n(c[key], fallback)));
    return (
      <ClampedNumberInput
        value={value}
        min={min}
        max={max}
        step={opts.step}
        precision={opts.precision}
        ariaLabel={label}
        onCommit={(v) => {
          if (v !== undefined && v !== value) setContent(key, v);
        }}
      />
    );
  };

  // Listy pokazują to, co RYSUJE renderer (`InteractiveCircleWidget`): brak
  // klucza albo wartość spoza zestawu to półokrąg / najechanie / bez
  // autoodtwarzania. Obrót renderer stosuje WYŁĄCZNIE dla pełnego koła -
  // półokrąg z zapisanym obrotem stoi w miejscu, więc lista pokazuje „brak".
  // Wcześniej warunek opcji obrotu brał dla brakującego układu „pełny", choć
  // lista układu (i renderer) brały „półokrąg" - panel oferował wtedy obrót,
  // który byłby cichym no-opem.
  const layout = s(c.layout) === "full" ? "full" : "semi";
  const trigger = s(c.trigger) === "click" ? "click" : "hover";
  const autoplay = s(c.autoplay) === "on" ? "on" : "off";
  const storedAnimation = s(c.animation);
  const animation =
    storedAnimation === "pulse"
      ? "pulse"
      : storedAnimation === "rotate" && layout === "full"
        ? "rotate"
        : "none";

  return (
    <div className="space-y-4">
      {/* General settings */}
      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.interactiveCircleEditor.layout")}>
          <Select value={layout} onValueChange={(v) => setContent("layout", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="semi">{t("builder.interactiveCircleEditor.semi")}</SelectItem>
              <SelectItem value="full">{t("builder.interactiveCircleEditor.full")}</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={t("builder.interactiveCircleEditor.trigger")}>
          <Select value={trigger} onValueChange={(v) => setContent("trigger", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hover">{t("builder.interactiveCircleEditor.hover")}</SelectItem>
              <SelectItem value="click">{t("builder.interactiveCircleEditor.click")}</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.interactiveCircleEditor.diameter")}>
          {numberField("size", t("builder.interactiveCircleEditor.diameter"))}
        </PropField>
        <PropField label={t("builder.interactiveCircleEditor.itemSize")}>
          {numberField("itemSize", t("builder.interactiveCircleEditor.itemSize"))}
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.interactiveCircleEditor.arcThickness")}>
          {numberField("circleThickness", t("builder.interactiveCircleEditor.arcThickness"))}
        </PropField>
        <PropField label={t("builder.interactiveCircleEditor.arcColor")}>
          <ColorField
            value={s(c.circleColor) || undefined}
            onChange={(v) => setContent("circleColor", v ?? "")}
            placeholder="np. #7c3aed"
          />
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.interactiveCircleEditor.animation")}>
          <Select value={animation} onValueChange={(v) => setContent("animation", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("builder.interactiveCircleEditor.animNone")}</SelectItem>
              {/* Obrot ma sens tylko dla pelnego kola - polokrag wykrecilby sie
                  poza swoje polozenie, wiec renderer go tam nie stosuje. Nie
                  pokazujemy opcji, ktora bylaby cichym no-opem. */}
              {layout === "full" && (
                <SelectItem value="rotate">
                  {t("builder.interactiveCircleEditor.animRotate")}
                </SelectItem>
              )}
              <SelectItem value="pulse">
                {t("builder.interactiveCircleEditor.animPulse")}
              </SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={t("builder.interactiveCircleEditor.activeScale")}>
          {numberField("activeScale", t("builder.interactiveCircleEditor.activeScale"), {
            step: 0.05,
            precision: 2,
          })}
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.interactiveCircleEditor.autoplay")}>
          <Select value={autoplay} onValueChange={(v) => setContent("autoplay", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">
                {t("builder.interactiveCircleEditor.autoplayOff")}
              </SelectItem>
              <SelectItem value="on">{t("builder.interactiveCircleEditor.autoplayOn")}</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={t("builder.interactiveCircleEditor.intervalMs")}>
          {numberField("intervalMs", t("builder.interactiveCircleEditor.intervalMs"), {
            step: 250,
          })}
        </PropField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.interactiveCircleEditor.itemBg")}>
          <ColorField
            value={s(c.itemBg) || undefined}
            onChange={(v) => setContent("itemBg", v ?? "")}
            placeholder={t("builder.interactiveCircleEditor.itemBgPh")}
          />
        </PropField>
        <PropField label={t("builder.interactiveCircleEditor.itemColor")}>
          <ColorField
            value={s(c.itemColor) || undefined}
            onChange={(v) => setContent("itemColor", v ?? "")}
            placeholder={t("builder.interactiveCircleEditor.itemColorPh")}
          />
        </PropField>
        <PropField label={t("builder.interactiveCircleEditor.activeBg")}>
          <ColorField
            value={s(c.activeBg) || undefined}
            onChange={(v) => setContent("activeBg", v ?? "")}
            placeholder={t("builder.interactiveCircleEditor.activeBgPh")}
          />
        </PropField>
        <PropField label={t("builder.interactiveCircleEditor.activeColor")}>
          <ColorField
            value={s(c.activeColor) || undefined}
            onChange={(v) => setContent("activeColor", v ?? "")}
            placeholder={t("builder.interactiveCircleEditor.activeColorPh")}
          />
        </PropField>
      </div>

      {/* Naglowek + wstep renderowane NAD kolem. Nie mylic ze srodkiem kola:
          tam trafia tresc aktywnej pozycji (a tresc widgetu tylko przy pustej
          liscie). Etykieta dlugo obiecywala "fallback opisu pozycji", czego
          renderer nigdy nie robil - i nie powinien, bo tekst dublowalby sie. */}
      <div className="rounded border border-border p-2 space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("builder.interactiveCircleEditor.defaultText", { lang: lang.toUpperCase() })}
        </p>
        <PropField label={t("builder.interactiveCircleEditor.heading")}>
          <Input
            value={s(c[`title_${lang}`])}
            onChange={(e) => setContent(`title_${lang}`, e.target.value)}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label={t("builder.interactiveCircleEditor.desc")}>
          <Textarea
            rows={3}
            value={s(c[`desc_${lang}`])}
            onChange={(e) => setContent(`desc_${lang}`, e.target.value)}
            className="text-xs"
          />
        </PropField>
      </div>

      {/* Items list */}
      <ListShell
        title={t("builder.interactiveCircleEditor.items")}
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
              <PropField label={t("builder.interactiveCircleEditor.icon")}>
                <LucideIconPicker
                  value={s(it.icon)}
                  onChange={(v) => patch(i, { icon: v ?? "" })}
                />
              </PropField>
              <PropField
                label={t("builder.interactiveCircleEditor.label", { lang: lang.toUpperCase() })}
              >
                <Input
                  value={s(it[`label_${lang}`])}
                  onChange={(e) => patch(i, { [`label_${lang}`]: e.target.value })}
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField
                label={t("builder.interactiveCircleEditor.centerTitle", {
                  lang: lang.toUpperCase(),
                })}
              >
                <Input
                  value={s(it[`title_${lang}`])}
                  onChange={(e) => patch(i, { [`title_${lang}`]: e.target.value })}
                  className="h-8 text-xs"
                />
              </PropField>
              <PropField
                label={t("builder.interactiveCircleEditor.itemDesc", { lang: lang.toUpperCase() })}
              >
                <Textarea
                  rows={3}
                  value={s(it[`desc_${lang}`])}
                  onChange={(e) => patch(i, { [`desc_${lang}`]: e.target.value })}
                  className="text-xs"
                />
              </PropField>
              <PropField label={t("builder.interactiveCircleEditor.link")}>
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
