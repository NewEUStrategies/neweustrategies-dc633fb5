// Dedykowana strona ustawień globalnych spisu treści (Table of Contents).
// Panel z formularzem po lewej, live-preview po prawej.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  TOC_DEFAULTS,
  TOC_LAYOUTS,
  TOC_COLUMNS,
  useTocDefaults,
  useSaveTocDefaults,
  type TocDefaults,
  type TocLayout,
  type TocColumns,
} from "@/lib/toc/settings";

export const Route = createFileRoute("/admin/toc")({
  component: TocAdmin,
});

const SAMPLE_HEADINGS: Record<"pl" | "en", { level: 1 | 2 | 3; text: string; anchor: string }[]> = {
  pl: [
    { level: 1, text: "Główny temat opracowania", anchor: "glowny-temat" },
    { level: 2, text: "Wprowadzenie", anchor: "wprowadzenie" },
    { level: 2, text: "Kluczowe czynniki", anchor: "kluczowe-czynniki" },
    { level: 3, text: "Kontekst geopolityczny", anchor: "kontekst" },
    { level: 3, text: "Perspektywy gospodarcze", anchor: "perspektywy" },
    { level: 2, text: "Wnioski", anchor: "wnioski" },
  ],
  en: [
    { level: 1, text: "Main topic of the article", anchor: "main-topic" },
    { level: 2, text: "Introduction", anchor: "introduction" },
    { level: 2, text: "Key factors", anchor: "key-factors" },
    { level: 3, text: "Geopolitical context", anchor: "context" },
    { level: 3, text: "Economic outlook", anchor: "outlook" },
    { level: 2, text: "Conclusions", anchor: "conclusions" },
  ],
};

function TocAdmin() {
  const { i18n, t } = useTranslation();
  const uiLang: "pl" | "en" = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const persisted = useTocDefaults();
  const [draft, setDraft] = useState<TocDefaults>(persisted);
  const [previewLang, setPreviewLang] = useState<"pl" | "en">(uiLang);
  const save = useSaveTocDefaults();

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(persisted),
    [draft, persisted],
  );

  const update = <K extends keyof TocDefaults>(k: K, v: TocDefaults[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const updateColor = (k: keyof TocDefaults["colors"], v: string) =>
    setDraft((d) => ({ ...d, colors: { ...d.colors, [k]: v } }));

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold">
            {t("admin.toc.title", { defaultValue: "Spis treści (ToC)" })}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("admin.toc.subtitle", {
              defaultValue:
                "Globalne ustawienia spisu treści dla wpisów. Każdy wpis może nadpisać te wartości w swoim metaboksie.",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDraft(TOC_DEFAULTS)}
            disabled={!dirty}
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            {t("common.reset", { defaultValue: "Przywróć domyślne" })}
          </Button>
          <Button
            size="sm"
            onClick={() => save.mutate(draft)}
            disabled={!dirty || save.isPending}
          >
            <Save className="w-3.5 h-3.5 mr-1.5" />
            {t("common.save", { defaultValue: "Zapisz" })}
          </Button>
        </div>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
        {/* FORM */}
        <div className="space-y-5 rounded-xl border border-border bg-card p-5">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {t("admin.toc.general", { defaultValue: "Ogólne" })}
            </h2>

            <label className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">
                  {t("admin.toc.enabled", { defaultValue: "Domyślnie włączony" })}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("admin.toc.enabledHint", {
                    defaultValue: "Wpisy mogą to nadpisać w swoim metaboksie.",
                  })}
                </div>
              </div>
              <Switch
                checked={draft.enabled}
                onCheckedChange={(v) => update("enabled", v)}
              />
            </label>

            <div>
              <Label className="text-xs">
                {t("admin.toc.layout", { defaultValue: "Układ" })}
              </Label>
              <Select
                value={draft.layout}
                onValueChange={(v) => update("layout", v as TocLayout)}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOC_LAYOUTS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l === "boxed"
                        ? "Karta z ramką"
                        : l === "inline"
                          ? "Inline (bez ramki)"
                          : "Sticky w sidebarze"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">
                  {t("admin.toc.position", { defaultValue: "Pozycja (po ilu akapitach)" })}
                </Label>
                <Input
                  type="number"
                  min={-1}
                  max={20}
                  value={draft.position}
                  onChange={(e) => update("position", parseInt(e.target.value || "0", 10))}
                  className="h-9"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  0 = na górze, -1 = ukryj w treści (tylko sidebar)
                </p>
              </div>
              <div>
                <Label className="text-xs">
                  {t("admin.toc.minHeadings", { defaultValue: "Min. liczba nagłówków" })}
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={draft.minHeadings}
                  onChange={(e) => update("minHeadings", parseInt(e.target.value || "3", 10))}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">
                  {t("admin.toc.minLevel", { defaultValue: "Min. poziom nagłówka" })}
                </Label>
                <Select
                  value={String(draft.minLevel)}
                  onValueChange={(v) => update("minLevel", parseInt(v, 10))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <SelectItem
                        key={n}
                        value={String(n)}
                        disabled={n > draft.maxLevel}
                      >
                        H{n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">
                  {t("admin.toc.maxLevel", { defaultValue: "Maks. poziom nagłówka" })}
                </Label>
                <Select
                  value={String(draft.maxLevel)}
                  onValueChange={(v) => update("maxLevel", parseInt(v, 10))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <SelectItem
                        key={n}
                        value={String(n)}
                        disabled={n < draft.minLevel}
                      >
                        H{n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-end justify-between gap-3 pb-1">
                <div>
                  <div className="text-sm font-medium">Numerowana</div>
                  <div className="text-[10px] text-muted-foreground">1. 2. 3. zamiast kropek</div>
                </div>
                <Switch
                  checked={draft.ordered}
                  onCheckedChange={(v) => update("ordered", v)}
                />
              </label>
            </div>

            <div>
              <Label className="text-xs">
                {t("admin.toc.columns", { defaultValue: "Kolumny spisu treści" })}
              </Label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {TOC_COLUMNS.map((c) => {
                  const label =
                    c === "col-1" ? "1 kolumna" : c === "col-2" ? "2 kolumny" : "Połowa";
                  const desc =
                    c === "col-1"
                      ? "Pełna szerokość"
                      : c === "col-2"
                        ? "Podział na 2 kolumny"
                        : "50% szerokości treści";
                  const active = draft.columns === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => update("columns", c as TocColumns)}
                      aria-pressed={active}
                      className={`flex flex-col gap-1 rounded-md border px-2 py-2.5 text-left transition-colors ${
                        active
                          ? "border-brand bg-brand/10 text-brand"
                          : "border-border bg-background hover:border-brand/50"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        <div
                          className={`grid gap-0.5 ${c === "col-2" ? "grid-cols-2" : "grid-cols-1"} ${c === "half" ? "w-3" : "w-5"}`}
                          aria-hidden="true"
                        >
                          <span className="h-2 rounded-sm bg-current opacity-70" />
                          {c === "col-2" && <span className="h-2 rounded-sm bg-current opacity-70" />}
                        </div>
                        {label}
                      </div>
                      <span className="text-[10px] text-muted-foreground">{desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">
                {t("admin.toc.sticky", { defaultValue: "Sticky przy scrollu" })}
              </div>
              <Switch checked={draft.sticky} onCheckedChange={(v) => update("sticky", v)} />
            </label>
          </section>

          <section className="space-y-3 pt-3 border-t border-border">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {t("admin.toc.labels", { defaultValue: "Etykiety" })}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Tytuł (PL)</Label>
                <Input
                  value={draft.titlePl}
                  onChange={(e) => update("titlePl", e.target.value)}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">Tytuł (EN)</Label>
                <Input
                  value={draft.titleEn}
                  onChange={(e) => update("titleEn", e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3 pt-3 border-t border-border">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {t("admin.toc.colors", { defaultValue: "Kolory" })}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["bg", "Tło (light)"],
                  ["bgDark", "Tło (dark)"],
                  ["border", "Ramka (light)"],
                  ["borderDark", "Ramka (dark)"],
                  ["text", "Tekst (light)"],
                  ["textDark", "Tekst (dark)"],
                  ["accent", "Akcent (link hover)"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-1 min-w-0">
                  <Label className="text-[10px] text-muted-foreground">{label}</Label>
                  <AdminColorPicker
                    value={draft.colors[key]}
                    onChange={(v) => updateColor(key, v ?? "")}
                    ariaLabel={label}
                  />
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* PREVIEW */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">
              {t("admin.toc.preview", { defaultValue: "Podgląd" })}
            </div>
            <Tabs value={previewLang} onValueChange={(v) => setPreviewLang(v === "en" ? "en" : "pl")}>
              <TabsList>
                <TabsTrigger value="pl">🇵🇱 PL</TabsTrigger>
                <TabsTrigger value="en">🇬🇧 EN</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="rounded-xl border border-border bg-background p-6">
            <TocPreview settings={draft} lang={previewLang} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TocPreview({ settings, lang }: { settings: TocDefaults; lang: "pl" | "en" }) {
  if (!settings.enabled) {
    return (
      <p className="text-sm text-muted-foreground italic text-center py-8">
        Spis treści wyłączony globalnie.
      </p>
    );
  }
  const title = lang === "en" ? settings.titleEn : settings.titlePl;
  const headings = SAMPLE_HEADINGS[lang].filter(
    (h) => h.level >= settings.minLevel && h.level <= settings.maxLevel,
  );
  const Tag = settings.ordered ? "ol" : "ul";

  const style = {
    "--toc-bg": settings.colors.bg,
    "--toc-bg-dark": settings.colors.bgDark,
    "--toc-border": settings.colors.border,
    "--toc-border-dark": settings.colors.borderDark,
    "--toc-text": settings.colors.text,
    "--toc-text-dark": settings.colors.textDark,
    "--toc-accent": settings.colors.accent,
    background: settings.colors.bg,
    color: settings.colors.text,
    border: settings.layout === "inline" ? "none" : `1px solid ${settings.colors.border}`,
  } as React.CSSProperties;

  const wrapperCls = [
    "not-prose p-4",
    settings.layout === "inline" ? "" : "rounded-lg",
    settings.sticky ? "lg:sticky lg:top-24" : "",
    settings.columns === "half" ? "md:max-w-[50%]" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const listCls = [
    "pl-5 text-sm",
    settings.ordered ? "list-decimal" : "list-disc",
    settings.columns === "col-2"
      ? "sm:columns-2 sm:gap-8 [&>li]:break-inside-avoid space-y-1.5"
      : "space-y-1.5",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <nav aria-label={title} className={wrapperCls} style={style}>
      <p className="text-[10px] uppercase tracking-wider mb-3 font-semibold opacity-70">
        {title}
      </p>
      <Tag className={listCls}>
        {headings.map((h) => (
          <li
            key={h.anchor}
            style={{ marginLeft: (h.level - settings.minLevel) * 12 }}
          >
            <a
              href={`#${h.anchor}`}
              className="hover:underline transition-colors"
              style={{ color: "inherit" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.color = settings.colors.accent;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.color = "inherit";
              }}
            >
              {h.text}
            </a>
          </li>
        ))}
      </Tag>
    </nav>
  );
}
