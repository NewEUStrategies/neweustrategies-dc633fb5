import { adminPageHead } from "@/lib/adminPageHead";
import { AdminSelect } from "@/components/admin/blocks/AdminSelect";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { usePostLayoutSettings, useSavePostLayoutSettings } from "@/hooks/usePostLayoutSettings";
import { clampNumber, draftDirty } from "@/lib/admin/panelDraft";
import type { PostLayoutSettings } from "@/lib/postLayouts";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/content-area")({
  head: () =>
    adminPageHead(
      "Content layout",
      "Configure shared article and content layouts. New European Strategies administration.",
    ),
  component: Page,
});

// ---------- helpers -----------------------------------------------------------

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Pola `next`, których wartość różni się od `base` (porównanie jak `draftDirty`). */
function changedFields<T extends object>(next: T, base: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(next) as Array<keyof T>) {
    if (JSON.stringify(next[key]) !== JSON.stringify(base[key])) out[key] = next[key];
  }
  return out;
}

function toHexOrKeep(v: string | null | undefined): string {
  if (!v) return "#000000";
  if (HEX_RE.test(v)) return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
  return "#000000";
}

// ---------- shared UI atoms ---------------------------------------------------

function FieldShell({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {hint ? <span className="text-[10px] text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}) {
  // Tekst pola w trakcie edycji. Puste pole to stan przejściowy (Backspace
  // przed wpisaniem nowej liczby), a nie zero: dawne `Number("") === 0`
  // wkładało do szkicu 0 px, który po zapisie zwijał kolumnę treści KAŻDEGO
  // wpisu (`maxWidth: 0px` w PostLayoutRenderer). Do szkicu trafia tylko
  // liczba; przy opuszczeniu pola wartość wraca w granice `min`-`max`
  // i do całych pikseli (kolumny są `integer` - ułamek baza odrzuca).
  const [text, setText] = useState<string | null>(null);
  return (
    <div className="relative flex items-center">
      <input
        type="number"
        value={text ?? (Number.isFinite(value) ? value : 0)}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (raw.trim() !== "" && Number.isFinite(Number(raw))) onChange(Number(raw));
        }}
        onBlur={() => {
          if (text === null) return;
          setText(null);
          const next = clampNumber(value, { min, max });
          if (next !== value) onChange(next);
        }}
        className="w-full rounded-md border border-input bg-background px-3 py-2 pr-12 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand/40"
      />
      {unit ? (
        <span className="pointer-events-none absolute right-3 text-xs text-muted-foreground">
          {unit}
        </span>
      ) : null}
    </div>
  );
}

function SelectField({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <AdminSelect
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </AdminSelect>
  );
}

function ColorField({
  value,
  onChange,
  placeholder,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
}) {
  const swatch = toHexOrKeep(value);
  return (
    <div className="flex items-stretch gap-2">
      <label
        className="relative flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-input"
        style={{ backgroundColor: value || "transparent" }}
      >
        <input
          type="color"
          value={swatch}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="color picker"
        />
        {!value && (
          <span className="pointer-events-none text-[10px] uppercase text-muted-foreground">
            auto
          </span>
        )}
      </label>
      {/* Bez `trim()` w trakcie pisania: przycinanie każdego znaku zjadało
          spację na końcu, więc formatu `hsl(210 50% 40%)` z placeholdera nie
          dało się wpisać. Puste -> `null` od razu, przycięcie przy wyjściu. */}
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value.trim() ? e.target.value : null)}
        onBlur={() => {
          if (value && value !== value.trim()) onChange(value.trim());
        }}
        placeholder={placeholder ?? "#… lub hsl(…)"}
        className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-brand/40"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded-md border border-input px-2 text-xs text-muted-foreground hover:bg-muted"
          aria-label="clear"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

function ToggleField({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-input bg-background p-3 hover:bg-muted/40">
      <span
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${
          checked ? "bg-[color:var(--brand,var(--primary))]" : "bg-muted"
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="block text-sm font-medium">{label}</span>
        {description ? (
          <span className="block text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border/80 bg-card/40 p-5 space-y-4">
      <header className="space-y-1">
        <h2 className="font-display text-lg leading-tight">{title}</h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

// ---------- page --------------------------------------------------------------

function Page() {
  const { t } = useTranslation();
  const { data, dataUpdatedAt } = usePostLayoutSettings();
  const save = useSavePostLayoutSettings();
  // Szkic i stan odniesienia brane w tej samej chwili (wzorzec
  // PostLayoutsSettingsPanel). Porównanie z żywym `data` zostawiało `dirty`
  // zapalone po udanym zapisie: trigger `pls_set_updated_at` zmienia
  // `updated_at`, więc odświeżony wiersz nigdy nie był równy szkicowi.
  const [draft, setDraft] = useState<{
    local: PostLayoutSettings;
    baseline: PostLayoutSettings;
  } | null>(null);
  useEffect(() => {
    // `dataUpdatedAt > 0`, nie samo `data`: loader korzenia ZASIEWA ten klucz
    // domyślnymi z `updatedAt: 0`. Szkic z zasiewu pokazywał domyślne zamiast
    // ustawień najemcy, a zapis nadpisywał nimi cały wiersz.
    if (data && dataUpdatedAt > 0 && !draft) setDraft({ local: data, baseline: data });
  }, [data, dataUpdatedAt, draft]);

  const dirty = useMemo(() => (draft ? draftDirty(draft.local, draft.baseline) : false), [draft]);

  if (!draft)
    return (
      <AdminShell hideSidebar>
        <div className="p-6">{t("admin.loading")}</div>
      </AdminShell>
    );

  const { local, baseline } = draft;
  const upd = (p: Partial<PostLayoutSettings>) => setDraft({ baseline, local: { ...local, ...p } });
  const onSave = async () => {
    // Migawka wysłana do bazy staje się nowym odniesieniem - zmiany wpisane
    // w trakcie żądania zostają niezapisane.
    const snapshot = local;
    const { tenant_id, ...rest } = snapshot;
    // Tylko pola zmienione na tym ekranie. Ten sam wiersz zapisują też układy
    // wpisu i rozmiary czcionek (`paragraph_spacing_rem`, do których ten ekran
    // odsyła); pełny szkic cofał po cichu to, co tamten panel zapisał w innej
    // karcie. Bez wiersza w bazie (domyślne, `tenant_id: ""`) leci całość,
    // żeby pierwszy INSERT utrwalił to, co administrator widział.
    const patch = tenant_id ? changedFields(rest, baseline) : rest;
    try {
      await save.mutateAsync(patch);
      setDraft((d) => d && { ...d, baseline: snapshot });
      toast.success(t("admin.saved"));
    } catch {
      // Bez tego odrzucenie było nieobsłużoną obietnicą: administrator nie
      // dostawał żadnego sygnału, że zapis się nie udał.
      toast.error(t("admin.saveError"));
    }
  };

  return (
    <AdminShell hideSidebar>
      <div className="space-y-6">
        <header className="sticky top-0 z-10 -mx-6 flex items-center justify-between gap-4 border-b border-border/60 bg-background/95 px-6 py-3 backdrop-blur">
          <div>
            <h1 className="font-display text-2xl leading-tight">{t("admin.contentArea.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("admin.contentArea.subtitle")}</p>
          </div>
          <button
            onClick={onSave}
            disabled={!dirty || save.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground disabled:opacity-50"
          >
            {save.isPending ? t("admin.loading") : t("admin.save")}
          </button>
        </header>

        <SectionCard
          title={t("admin.contentArea.width")}
          description="Maksymalna szerokość kontenera .single-post-content."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <FieldShell label={t("admin.contentArea.withSidebar")} hint="600 – 900">
              <NumberField
                value={local.has_sidebar_max_width}
                onChange={(n) => upd({ has_sidebar_max_width: n })}
                min={480}
                max={1200}
                step={10}
                unit="px"
              />
            </FieldShell>
            <FieldShell label={t("admin.contentArea.noSidebar")} hint="720 – 960">
              <NumberField
                value={local.no_sidebar_max_width}
                onChange={(n) => upd({ no_sidebar_max_width: n })}
                min={520}
                max={1280}
                step={10}
                unit="px"
              />
            </FieldShell>
            <FieldShell label={t("admin.contentArea.wideMax")} hint="1200 – 1800">
              <NumberField
                value={local.wide_align_max_width}
                onChange={(n) => upd({ wide_align_max_width: n })}
                min={800}
                max={2000}
                step={20}
                unit="px"
              />
            </FieldShell>
          </div>
        </SectionCard>

        <SectionCard title={t("admin.contentArea.paragraphs")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <p className="text-xs text-muted-foreground sm:col-span-2">
              <Link to="/admin/theme-options" className="underline underline-offset-2">
                {t("admin.contentArea.spacingMovedLink")}
              </Link>{" "}
              {t("admin.contentArea.spacingMovedHint")}
            </p>
            <FieldShell label={t("admin.contentArea.listStyle")}>
              <SelectField
                value={local.list_style || "disc"}
                onChange={(v) => upd({ list_style: v })}
                options={[
                  { value: "disc", label: "● Disc" },
                  { value: "circle", label: "○ Circle" },
                  { value: "square", label: "■ Square" },
                  { value: "none", label: "— None" },
                ]}
              />
            </FieldShell>
          </div>
        </SectionCard>

        <SectionCard title={t("admin.contentArea.hyperlinks")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldShell label={t("admin.contentArea.style")}>
              <SelectField
                value={local.hyperlink_style || "normal"}
                onChange={(v) => upd({ hyperlink_style: v })}
                options={[
                  { value: "normal", label: "Normal" },
                  { value: "bold", label: "Bold" },
                  { value: "italic", label: "Italic" },
                  { value: "bold-italic", label: "Bold + Italic" },
                ]}
              />
            </FieldShell>
            <FieldShell label={t("admin.contentArea.underline")}>
              <SelectField
                value={local.hyperlink_underline ? "1" : "0"}
                onChange={(v) => upd({ hyperlink_underline: v === "1" })}
                options={[
                  { value: "1", label: t("admin.contentArea.on") },
                  { value: "0", label: t("admin.contentArea.off") },
                ]}
              />
            </FieldShell>
            <FieldShell label={t("admin.contentArea.linkColorLight")}>
              <ColorField
                value={local.hyperlink_color}
                onChange={(v) => upd({ hyperlink_color: v })}
              />
            </FieldShell>
            <FieldShell label={t("admin.contentArea.linkColorDark")}>
              <ColorField
                value={local.hyperlink_color_dark}
                onChange={(v) => upd({ hyperlink_color_dark: v })}
              />
            </FieldShell>
            <FieldShell label={t("admin.contentArea.underlineColorLight")}>
              <ColorField
                value={local.underline_color}
                onChange={(v) => upd({ underline_color: v })}
              />
            </FieldShell>
            <FieldShell label={t("admin.contentArea.underlineColorDark")}>
              <ColorField
                value={local.underline_color_dark}
                onChange={(v) => upd({ underline_color_dark: v })}
              />
            </FieldShell>
          </div>

          {/* Live preview */}
          <div className="rounded-md border border-dashed border-border/70 bg-background p-4">
            <span className="mb-2 block text-[10px] uppercase tracking-wider text-muted-foreground">
              Preview
            </span>
            <p className="text-sm">
              Ipsum sit{" "}
              <a
                href="#"
                onClick={(e) => e.preventDefault()}
                style={{
                  color: local.hyperlink_color || undefined,
                  // Longhand, nie skrót `textDecoration`: skrót zeruje
                  // `text-decoration-color`, a React nie dopisuje go z powrotem
                  // (wartość się nie zmieniła) - po „Wyłącz" -> „Włącz" podgląd
                  // gubił skonfigurowany kolor podkreślenia.
                  textDecorationLine: local.hyperlink_underline ? "underline" : "none",
                  textDecorationColor: local.underline_color || undefined,
                  textUnderlineOffset: 3,
                  fontWeight:
                    local.hyperlink_style === "bold" || local.hyperlink_style === "bold-italic"
                      ? 600
                      : undefined,
                  fontStyle:
                    local.hyperlink_style === "italic" || local.hyperlink_style === "bold-italic"
                      ? "italic"
                      : undefined,
                }}
              >
                to jest link w treści
              </a>{" "}
              dolor amet consectetur.
            </p>
          </div>
        </SectionCard>

        <SectionCard title={t("admin.contentArea.imageCaption")}>
          <ToggleField
            checked={local.image_caption_left_border}
            onChange={(v) => upd({ image_caption_left_border: v })}
            label={t("admin.contentArea.imageCaptionToggle")}
            description="Cienki, kolorowy pasek po lewej stronie tekstu podpisu obrazu."
          />
        </SectionCard>

        <SectionCard title={t("admin.contentArea.quickView")}>
          <ToggleField
            checked={local.quick_view_info}
            onChange={(v) => upd({ quick_view_info: v })}
            label={t("admin.contentArea.quickViewToggle")}
            description='Kompaktowy pasek: kategoria • czas czytania • data (badge „Aktualizacja" gdy updated_at > published_at).'
          />
        </SectionCard>
      </div>
    </AdminShell>
  );
}
