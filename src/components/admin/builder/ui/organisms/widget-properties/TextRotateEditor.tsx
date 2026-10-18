// Organism: editor widgetu "text-rotate". Rotujacy tekst z animacja
// per znak/slowo/linia. i18n (PL/EN), tokeny, dark/light.
import { toJson } from "@/lib/builder/types";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { PropField, ColorField } from "../../atoms";
import { TextRotate } from "@/components/ui/text-rotate";
import { asStr } from "@/lib/content-model/contentValue";
import { LineListTextarea } from "./LineListTextarea";
import { readLineList } from "./lineList";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-builder";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

type SplitBy = "characters" | "words" | "lines";
type StaggerFrom = "first" | "last" | "center";
type Tag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "span";
type Align = "left" | "center" | "right";

// Wersja angielska bez własnej listy rotuje polską - jak renderer
// (`texts_en ?? texts_pl`), więc panel pokazuje to, co strona faktycznie rotuje.
const readTexts = (c: WidgetNode["content"], lang: "pl" | "en"): string[] =>
  readLineList(c[`texts_${lang}`] ?? c.texts_pl);

export function TextRotateEditor({ c, lang, setContent }: Props) {
  const { t } = useTranslation();
  // UWAGA NA DWA RÓŻNE JĘZYKI W TYM PLIKU. `lang` to edytowana WERSJA JĘZYKOWA
  // TREŚCI (przełącznik nad panelem, `EditorLangSwitch`), a nie język
  // interfejsu. Wcześniej etykiety panelu szły przez `lang === "pl"`, więc
  // redaktor pracujący po angielsku dostawał polskie podpisy, gdy tylko
  // przełączył się na polską wersję treści - i odwrotnie. Teraz podpisy panelu
  // biorą się z `t()` (język interfejsu), a `lang` steruje WYŁĄCZNIE tym, które
  // pole treści (`before_pl` / `before_en`) jest edytowane.
  const langTag = lang.toUpperCase();

  // Odczyty jak w rendererze (`getStr(...) || domyślna`): nie-napis to pustka,
  // a PUSTY napis to „nie ustawiono". Dosłowny odczyt wysypywał panel - pusty
  // znacznik dawał element bez nazwy, a obiekt w `before_*` dziecko Reacta.
  const before = asStr(c[`before_${lang}`]);
  const after = asStr(c[`after_${lang}`]);
  const texts = readTexts(c, lang);

  const tag = (asStr(c.tag) || "h2") as Tag;
  const align = (asStr(c.align) || "left") as Align;
  const splitBy = (asStr(c.splitBy) || "characters") as SplitBy;
  const staggerFrom = (asStr(c.staggerFrom) || "first") as StaggerFrom;

  const color = (typeof c.color === "string" ? c.color : "") || "";
  const accent = (typeof c.accentColor === "string" ? c.accentColor : "") || "#FA9346";
  const intervalMs = typeof c.rotationInterval === "number" ? c.rotationInterval : 2200;
  const staggerMs = typeof c.staggerDurationMs === "number" ? c.staggerDurationMs : 30;
  const transitionMs = typeof c.transitionMs === "number" ? c.transitionMs : 450;
  const loop = c.loop !== false;
  const auto = c.auto !== false;

  const alignCls =
    align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
  const Tag = tag;

  // Przykładowa treść podglądu idzie za EDYTOWANĄ WERSJĄ JĘZYKOWĄ (to zawartość
  // widgetu), a nie za językiem panelu - stąd wybór klucza po `lang`.
  const previewTexts = texts.length
    ? texts
    : t(lang === "pl" ? "builder.textRotateEditor.samplePl" : "builder.textRotateEditor.sampleEn")
        .split("\n")
        .filter(Boolean);

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-block h-4 w-1 rounded bg-muted-foreground/50" />
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("builder.textRotateEditor.staticText")}
          </h4>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PropField label={t("builder.textRotateEditor.before", { lang: langTag })}>
            <Input
              value={before}
              onChange={(e) => setContent(`before_${lang}`, e.target.value)}
              placeholder={t("builder.textRotateEditor.beforePlaceholder")}
              className="h-8 text-xs"
            />
          </PropField>
          <PropField label={t("builder.textRotateEditor.after", { lang: langTag })}>
            <Input
              value={after}
              onChange={(e) => setContent(`after_${lang}`, e.target.value)}
              placeholder={t("builder.textRotateEditor.afterPlaceholder")}
              className="h-8 text-xs"
            />
          </PropField>
        </div>
        <PropField label={t("builder.textRotateEditor.staticColor")}>
          <ColorField
            value={color}
            onChange={(v) => setContent("color", v ?? "")}
            placeholder="—"
          />
        </PropField>
      </section>

      <section className="rounded-md border border-brand/40 bg-brand/5 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-block h-4 w-1 rounded bg-brand" />
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-brand">
            {t("builder.textRotateEditor.rotatingTexts")}
          </h4>
        </div>
        <PropField label={t("builder.textRotateEditor.textsLabel", { lang: langTag })}>
          <LineListTextarea
            rows={4}
            value={texts}
            onChange={(next) => setContent(`texts_${lang}`, toJson(next))}
            placeholder={t("builder.textRotateEditor.textsPlaceholder")}
            className="text-xs font-mono"
          />
        </PropField>
        <PropField label={t("builder.textRotateEditor.accentColor")}>
          <ColorField
            value={accent}
            onChange={(v) => setContent("accentColor", v ?? "")}
            placeholder="#FA9346"
          />
        </PropField>
      </section>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={t("builder.textRotateEditor.htmlTag")}>
          <Select value={tag} onValueChange={(v) => setContent("tag", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["h1", "h2", "h3", "h4", "h5", "h6", "span"] as Tag[]).map((x) => (
                <SelectItem key={x} value={x}>
                  {x.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={t("builder.textRotateEditor.align")}>
          <Select value={align} onValueChange={(v) => setContent("align", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="left">{t("builder.textRotateEditor.alignLeft")}</SelectItem>
              <SelectItem value="center">{t("builder.textRotateEditor.alignCenter")}</SelectItem>
              <SelectItem value="right">{t("builder.textRotateEditor.alignRight")}</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={t("builder.textRotateEditor.splitBy")}>
          <Select value={splitBy} onValueChange={(v) => setContent("splitBy", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="characters">
                {t("builder.textRotateEditor.splitCharacters")}
              </SelectItem>
              <SelectItem value="words">{t("builder.textRotateEditor.splitWords")}</SelectItem>
              <SelectItem value="lines">{t("builder.textRotateEditor.splitLines")}</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={t("builder.textRotateEditor.staggerFrom")}>
          <Select value={staggerFrom} onValueChange={(v) => setContent("staggerFrom", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="first">{t("builder.textRotateEditor.staggerFirst")}</SelectItem>
              <SelectItem value="last">{t("builder.textRotateEditor.staggerLast")}</SelectItem>
              <SelectItem value="center">{t("builder.textRotateEditor.staggerCenter")}</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={t("builder.textRotateEditor.intervalMs")}>
          <Input
            type="number"
            min={400}
            max={20000}
            step={100}
            value={intervalMs}
            onChange={(e) => setContent("rotationInterval", Number(e.target.value) || 2200)}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label="Stagger (ms)">
          <Input
            type="number"
            min={0}
            max={500}
            step={5}
            value={staggerMs}
            onChange={(e) => setContent("staggerDurationMs", Number(e.target.value) || 0)}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label={t("builder.textRotateEditor.transitionMs")}>
          <Input
            type="number"
            min={80}
            max={4000}
            step={20}
            value={transitionMs}
            onChange={(e) => setContent("transitionMs", Number(e.target.value) || 450)}
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label={t("builder.textRotateEditor.loop")}>
          <Select value={loop ? "on" : "off"} onValueChange={(v) => setContent("loop", v === "on")}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="on">{t("builder.textRotateEditor.yes")}</SelectItem>
              <SelectItem value="off">{t("builder.textRotateEditor.no")}</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={t("builder.textRotateEditor.autoRotate")}>
          <Select value={auto ? "on" : "off"} onValueChange={(v) => setContent("auto", v === "on")}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="on">{t("builder.textRotateEditor.yes")}</SelectItem>
              <SelectItem value="off">{t("builder.textRotateEditor.no")}</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
      </div>

      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("builder.textRotateEditor.livePreview")}
        </div>
        <div className="rounded-md border border-border p-4 bg-background">
          <Tag className={`m-0 font-semibold ${alignCls}`} style={color ? { color } : undefined}>
            {before && <span className="mr-1">{before}</span>}
            <span style={{ color: accent }} className="inline-block">
              <TextRotate
                texts={previewTexts}
                splitBy={splitBy}
                rotationInterval={intervalMs}
                staggerDurationMs={staggerMs}
                transitionMs={transitionMs}
                loop={loop}
                auto={auto}
                staggerFrom={staggerFrom}
              />
            </span>
            {after && <span className="ml-1">{after}</span>}
          </Tag>
        </div>
      </div>
    </div>
  );
}
