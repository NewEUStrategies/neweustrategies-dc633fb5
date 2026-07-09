// Dedykowana strona ustawień sekcji "Z tego artykułu dowiesz się...".
// - Edytowalne globalnie: widoczność, wariant (A: karta / B: nagłówek),
//   ikona, etykiety PL/EN, kolory (jasny + ciemny motyw).
// - Panel po lewej: formularz. Panel po prawej: podgląd na żywo wybranego
//   wariantu z przykładowymi punktami w bieżącym języku UI.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { DynamicIcon, type IconName } from "@/lib/icons/DynamicIcon";
import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";
import { Save, RotateCcw, EyeOff, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  KEY_TAKEAWAYS_DEFAULTS,
  useKeyTakeawaysSettings,
  useSaveKeyTakeawaysSettings,
  type KeyTakeawaysSettings,
  type KeyTakeawaysVariant,
} from "@/lib/keyTakeaways/settings";
import { KeyTakeaways } from "@/components/molecules/KeyTakeaways";

export const Route = createFileRoute("/admin/key-takeaways")({
  component: KeyTakeawaysAdmin,
});

// Zestaw ikon Lucide sugerowany dla sekcji "dowiesz się...".
const ICON_CHOICES: IconName[] = [
  "search",
  "book-open",
  "lightbulb",
  "sparkles",
  "target",
  "list-checks",
  "check-circle-2",
  "info",
  "star",
  "flag",
  "graduation-cap",
  "trending-up",
];

const SAMPLE_ITEMS: Record<"pl" | "en", string[]> = {
  pl: [
    "Jak Orbit Capital zebrał ponad 100 mln euro na fundusz venture debt i dlaczego udział PFR Ventures może być ważnym sygnałem.",
    "Dlaczego coraz więcej dojrzałych spółek technologicznych może szukać finansowania innego niż klasyczne rundy VC.",
    "Jak działa model venture debt, który pozwala firmom zdobywać kapitał na wzrost bez oddawania dużych pakietów udziałów.",
  ],
  en: [
    "How Orbit Capital raised over 100M EUR for a venture-debt fund and why PFR Ventures' participation matters.",
    "Why more mature tech companies look for financing beyond classic VC rounds.",
    "How the venture-debt model lets firms raise growth capital without giving up large equity stakes.",
  ],
};

function KeyTakeawaysAdmin() {
  const { i18n } = useTranslation();
  const uiLang: "pl" | "en" = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const isPL = uiLang === "pl";

  const persisted = useKeyTakeawaysSettings();
  const [draft, setDraft] = useState<KeyTakeawaysSettings>(persisted);
  const [previewLang, setPreviewLang] = useState<"pl" | "en">(uiLang);
  const [previewVariant, setPreviewVariant] = useState<KeyTakeawaysVariant>(persisted.variant);

  const save = useSaveKeyTakeawaysSettings();

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(persisted), [draft, persisted]);

  const update = <K extends keyof KeyTakeawaysSettings>(k: K, v: KeyTakeawaysSettings[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  type ColorKey = {
    [K in keyof KeyTakeawaysSettings["colors"]]: KeyTakeawaysSettings["colors"][K] extends string ? K : never;
  }[keyof KeyTakeawaysSettings["colors"]];
  const updateColor = (k: ColorKey, v: string) =>
    setDraft((d) => ({ ...d, colors: { ...d.colors, [k]: v } }));

  const resetAll = () => setDraft(KEY_TAKEAWAYS_DEFAULTS);

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
      <header className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            {isPL ? "Sekcja: \u201eZ tego artykułu dowiesz się\u2026\u201d" : "Section: \u201cFrom this article you will learn\u2026\u201d"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            {isPL
              ? "Globalne ustawienia sekcji wyświetlanej nad treścią każdego wpisu. Punkty listy autor uzupełnia w edytorze wpisu (per PL/EN)."
              : "Global settings for the section shown above every post's content. Bullet points are entered per post (PL/EN) in the post editor."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={resetAll} className="gap-2">
            <RotateCcw className="h-4 w-4" />
            {isPL ? "Przywróć domyślne" : "Reset"}
          </Button>
          <Button
            onClick={() => save.mutate(draft)}
            disabled={!dirty || save.isPending}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {save.isPending ? (isPL ? "Zapisywanie…" : "Saving…") : isPL ? "Zapisz" : "Save"}
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-6">
        {/* ================= FORM ================= */}
        <div className="space-y-6 rounded-xl border bg-card p-5 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          {/* Widoczność */}
          <section className="flex items-start justify-between gap-3">
            <div>
              <Label className="text-sm font-semibold flex items-center gap-2">
                {draft.enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                {isPL ? "Widoczna globalnie" : "Globally visible"}
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                {isPL
                  ? "Wyłączenie ukrywa sekcję na wszystkich wpisach niezależnie od uzupełnionych punktów."
                  : "Disabling hides the section on every post, regardless of filled items."}
              </p>
            </div>
            <Switch
              checked={draft.enabled}
              onCheckedChange={(v: boolean) => update("enabled", v)}
            />
          </section>

          {/* Wariant */}
          <section>
            <Label className="text-sm font-semibold mb-2 block">
              {isPL ? "Wariant wizualny" : "Visual variant"}
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {(["card", "heading", "ghost"] as KeyTakeawaysVariant[]).map((v) => {
                const active = draft.variant === v;
                const meta =
                  v === "card"
                    ? {
                        badge: isPL ? "Wariant A" : "Variant A",
                        desc: isPL ? "Karta z ikoną + numeracja" : "Card with icon + numbered",
                      }
                    : v === "heading"
                      ? {
                          badge: isPL ? "Wariant B" : "Variant B",
                          desc: isPL ? "Duży nagłówek + kropki" : "Bold heading + bullets",
                        }
                      : {
                          badge: isPL ? "Wariant C" : "Variant C",
                          desc: isPL
                            ? "Nagłówek za tekstem (ghost)"
                            : "Ghost heading behind text",
                        };
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      update("variant", v);
                      setPreviewVariant(v);
                    }}
                    className={`text-left rounded-lg border p-3 transition ${
                      active ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-foreground/30"
                    }`}
                  >
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      {meta.badge}
                    </div>
                    <div className="text-sm font-medium">{meta.desc}</div>
                  </button>
                );
              })}
            </div>

          </section>

          {/* Etykiety */}
          <section className="space-y-3">
            <Label className="text-sm font-semibold">
              {isPL ? "Etykieta (nagłówek sekcji)" : "Label (section heading)"}
            </Label>
            <div>
              <Label className="text-xs text-muted-foreground">PL</Label>
              <Input
                value={draft.labelPl}
                onChange={(e) => update("labelPl", e.target.value)}
                placeholder="Z tego artykułu dowiesz się..."
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">EN</Label>
              <Input
                value={draft.labelEn}
                onChange={(e) => update("labelEn", e.target.value)}
                placeholder="From this article you will learn..."
              />
            </div>
          </section>

          {/* Podświetlenie wybranych słów + rozmiar napisu (wariant Ghost) */}
          <section className="space-y-3">
            <Label className="text-sm font-semibold">
              {isPL ? "Podświetlenie słów (wariant Ghost)" : "Word highlight (Ghost variant)"}
            </Label>
            <p className="text-xs text-muted-foreground">
              {isPL
                ? "Kliknij słowa etykiety, które mają być pokolorowane. Wszystkie zachowują ten sam rozmiar i transparentność - zmienia się tylko kolor."
                : "Click the label words that should be tinted. All words keep the same size and transparency - only the color changes."}
            </p>

            {/* Toggle-chipy per słowo - PL i EN dzielą tę samą listę indeksów. */}
            {(["pl", "en"] as const).map((locale) => {
              const source = locale === "pl" ? draft.labelPl : draft.labelEn;
              const words = (source || "").split(/\s+/).filter(Boolean);
              if (words.length === 0) return null;
              return (
                <div key={locale}>
                  <Label className="text-xs text-muted-foreground">
                    {locale === "pl"
                      ? isPL
                        ? "Słowa do podświetlenia (PL)"
                        : "Words to highlight (PL)"
                      : isPL
                        ? "Słowa do podświetlenia (EN)"
                        : "Words to highlight (EN)"}
                  </Label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {words.map((word, idx) => {
                      const indices = draft.highlight?.indices ?? [];
                      const on = indices.includes(idx);
                      return (
                        <button
                          key={`${locale}-${idx}`}
                          type="button"
                          onClick={() =>
                            update("highlight", {
                              ...draft.highlight,
                              indices: on
                                ? indices.filter((i) => i !== idx)
                                : [...indices, idx].sort((a, b) => a - b),
                            })
                          }
                          className={`h-8 px-3 rounded-md border text-xs font-medium transition ${
                            on
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:bg-muted"
                          }`}
                          aria-pressed={on}
                        >
                          {word}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">
                  {isPL ? "Kolor" : "Color"}
                </Label>
                <div className="mt-1">
                  <AdminColorPicker
                    value={draft.highlight?.color ?? draft.colors.accent}
                    onChange={(v) =>
                      update("highlight", {
                        ...draft.highlight,
                        color: v ?? draft.colors.accent,
                      })
                    }
                    ariaLabel={isPL ? "Kolor podświetlenia" : "Highlight color"}
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  {isPL ? `Rozmiar napisu (${(draft.highlight?.sizeScale ?? 1).toFixed(2)}x)` : `Text size (${(draft.highlight?.sizeScale ?? 1).toFixed(2)}x)`}
                </Label>
                <input
                  type="range"
                  min={0.5}
                  max={3}
                  step={0.05}
                  value={draft.highlight?.sizeScale ?? 1}
                  onChange={(e) =>
                    update("highlight", {
                      ...draft.highlight,
                      sizeScale: Number(e.target.value),
                    })
                  }
                  className="w-full mt-2 accent-primary"
                  aria-label={isPL ? "Rozmiar napisu ghost" : "Ghost text size"}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">
                  {isPL
                    ? `Przesunięcie w pionie (${draft.highlight?.offsetY ?? 0}px)`
                    : `Vertical offset (${draft.highlight?.offsetY ?? 0}px)`}
                </Label>
                <input
                  type="range"
                  min={-200}
                  max={200}
                  step={1}
                  value={draft.highlight?.offsetY ?? 0}
                  onChange={(e) =>
                    update("highlight", {
                      ...draft.highlight,
                      offsetY: Number(e.target.value),
                    })
                  }
                  className="w-full mt-2 accent-primary"
                  aria-label={isPL ? "Przesunięcie etykiety w pionie" : "Label vertical offset"}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>-200</span>
                  <button
                    type="button"
                    className="underline hover:text-foreground"
                    onClick={() =>
                      update("highlight", { ...draft.highlight, offsetY: 0 })
                    }
                  >
                    0
                  </button>
                  <span>+200</span>
                </div>
              </div>
            </div>
          </section>

          {/* Ikona */}
          <section>
            <Label className="text-sm font-semibold mb-2 block">
              {isPL ? "Ikona (Lucide)" : "Icon (Lucide)"}
            </Label>
            <div className="grid grid-cols-6 gap-1.5 mb-2">
              {ICON_CHOICES.map((name) => {
                const active =
                  draft.icon.toLowerCase() === name || draft.icon.toLowerCase() === name.replace(/-/g, "");
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => update("icon", name)}
                    aria-label={name}
                    className={`aspect-square rounded-md border flex items-center justify-center transition ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <DynamicIcon name={name} size={18} />
                  </button>
                );
              })}
            </div>
            <Input
              value={draft.icon}
              onChange={(e) => update("icon", e.target.value)}
              placeholder="search"
              className="text-xs font-mono"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              {isPL
                ? "Dowolna nazwa z lucide.dev (kebab-case, np. book-open)."
                : "Any Lucide icon name (kebab-case, e.g. book-open)."}
            </p>
          </section>

          {/* Kolory */}
          <section>
            <Label className="text-sm font-semibold mb-2 block">
              {isPL ? "Kolory" : "Colors"}
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <ColorRow
                label={isPL ? "Tło (jasny)" : "Background (light)"}
                value={draft.colors.bg}
                onChange={(v) => updateColor("bg", v)}
              />
              <ColorRow
                label={isPL ? "Tło (ciemny)" : "Background (dark)"}
                value={draft.colors.bgDark}
                onChange={(v) => updateColor("bgDark", v)}
              />
              <ColorRow
                label={isPL ? "Akcent" : "Accent"}
                value={draft.colors.accent}
                onChange={(v) => updateColor("accent", v)}
              />
              <ColorRow
                label={isPL ? "Tło ikony" : "Icon bg"}
                value={draft.colors.iconBg}
                onChange={(v) => updateColor("iconBg", v)}
              />
              <ColorRow
                label={isPL ? "Ikona" : "Icon"}
                value={draft.colors.icon}
                onChange={(v) => updateColor("icon", v)}
              />
              <ColorRow
                label={isPL ? "Tytuł (jasny)" : "Title (light)"}
                value={draft.colors.title}
                onChange={(v) => updateColor("title", v)}
              />
              <ColorRow
                label={isPL ? "Tytuł (ciemny)" : "Title (dark)"}
                value={draft.colors.titleDark}
                onChange={(v) => updateColor("titleDark", v)}
              />
              <ColorRow
                label={isPL ? "Tekst (jasny)" : "Text (light)"}
                value={draft.colors.text}
                onChange={(v) => updateColor("text", v)}
              />
              <ColorRow
                label={isPL ? "Tekst (ciemny)" : "Text (dark)"}
                value={draft.colors.textDark}
                onChange={(v) => updateColor("textDark", v)}
              />
              <ColorRow
                label={isPL ? "Obramowanie (jasny)" : "Border (light)"}
                value={draft.colors.border ?? "transparent"}
                onChange={(v) => updateColor("border", v)}
              />
              <ColorRow
                label={isPL ? "Obramowanie (ciemny)" : "Border (dark)"}
                value={draft.colors.borderDark ?? "transparent"}
                onChange={(v) => updateColor("borderDark", v)}
              />
            </div>
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground">
                {isPL
                  ? `Grubość obramowania (${draft.colors.borderWidth ?? 0}px)`
                  : `Border width (${draft.colors.borderWidth ?? 0}px)`}
              </Label>
              <input
                type="range"
                min={0}
                max={8}
                step={1}
                value={draft.colors.borderWidth ?? 0}
                onChange={(e) =>
                  update("colors", {
                    ...draft.colors,
                    borderWidth: Number(e.target.value),
                  })
                }
                className="w-full mt-2 accent-primary"
                aria-label={isPL ? "Grubość obramowania" : "Border width"}
              />
            </div>
          </section>
        </div>

        {/* ================= PREVIEW ================= */}
        <div className="rounded-xl border bg-background p-5">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div className="text-sm font-semibold">{isPL ? "Podgląd na żywo" : "Live preview"}</div>
            <div className="flex items-center gap-2">
              <Tabs value={previewLang} onValueChange={(v) => setPreviewLang(v as "pl" | "en")}>
                <TabsList>
                  <TabsTrigger value="pl">PL</TabsTrigger>
                  <TabsTrigger value="en">EN</TabsTrigger>
                </TabsList>
              </Tabs>
              <Tabs
                value={previewVariant}
                onValueChange={(v) => setPreviewVariant(v as KeyTakeawaysVariant)}
              >
                <TabsList>
                  <TabsTrigger value="card">A</TabsTrigger>
                  <TabsTrigger value="heading">B</TabsTrigger>
                  <TabsTrigger value="ghost">C</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          <Tabs value={previewVariant} onValueChange={() => {}} className="w-full">
            <TabsContent value="card" className="mt-0">
              <KeyTakeaways
                items={SAMPLE_ITEMS[previewLang]}
                settingsOverride={draft}
                variantOverride="card"
                langOverride={previewLang}
              />
            </TabsContent>
            <TabsContent value="heading" className="mt-0">
              <KeyTakeaways
                items={SAMPLE_ITEMS[previewLang]}
                settingsOverride={draft}
                variantOverride="heading"
                langOverride={previewLang}
              />
            </TabsContent>
            <TabsContent value="ghost" className="mt-0">
              <KeyTakeaways
                items={SAMPLE_ITEMS[previewLang]}
                settingsOverride={draft}
                variantOverride="ghost"
                langOverride={previewLang}
              />
            </TabsContent>
          </Tabs>


          <div className="mt-6 rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
            {isPL
              ? "Podgląd renderuje ten sam komponent co strona publiczna wpisu (nad treścią). Punkty listy pochodzą z pól \u201eZ tego materiału dowiesz się...\u201d w edytorze konkretnego wpisu (PL / EN)."
              : "Preview renders the exact same component used on public posts (above content). Bullet points come from the \u201cFrom this article you'll learn...\u201d fields in each post's editor (PL / EN)."}
          </div>
        </div>
      </div>
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <AdminColorPicker
        value={value}
        onChange={(v) => onChange(v ?? "")}
        ariaLabel={label}
      />
    </div>
  );
}
