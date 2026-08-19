// Inline-edytor layoutu na publicznej stronie /author/$slug - domknięcie
// kroku "nadpisanie per-ekspert" z /admin/expert-layouts. Widoczny wyłącznie
// dla właściciela profilu i adminów tenanta (gate w trasie + RLS w bazie).
//
// Model: ustawienia tenanta (`expert_layout_settings`) są bazą, edytor buduje
// WYŁĄCZNIE różnicę (ExpertLayoutOverrides) zapisywaną w
// `author_profiles.layout_preset` + `layout_overrides`. Każda zmiana jest
// natychmiast publikowana do strony przez `onDraftChange` - podgląd na żywo
// renderuje ten sam `mergeExpertLayout`, którego używa produkcyjny render,
// więc draft == stan po zapisie (zero rozjazdu preview/produkcja).
//
// Ładowany przez React.lazy - publiczni goście nie pobierają tego chunka.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, Minus, Palette, RotateCcw, X } from "lucide-react";
import { SegmentedControl, type SegmentedControlOption } from "@/components/atoms/SegmentedControl";
import { ExpertPresetThumb } from "@/components/experts/ExpertPresetThumb";
import { useSaveExpertLayoutOverrides } from "@/hooks/useExpertLayoutSettings";
import { ensureI18n as ensureAdminLayoutsI18n } from "@/lib/i18n-admin-layouts";
import { ensureI18n as ensureEditorI18n } from "@/lib/i18n-expert-layout-editor";
import {
  countExpertLayoutOverrides,
  DEFAULT_EXPERT_SECTION_ORDER,
  EXPERT_LAYOUT_PRESETS,
  findExpertPreset,
  isSectionVisible,
  mergeExpertLayout,
  normalizeExpertSectionOrder,
  sanitizeCssColor,
  type ExpertLayoutDraft,
  type ExpertLayoutOverrides,
  type ExpertLayoutPresetId,
  type ExpertLayoutSettings,
  type ExpertSectionKey,
} from "@/lib/expertLayouts";
// Sygnatura nadpisań (dirty-check) mieszka w czystym module razem z resztą
// reguł układu - to ona decyduje, czy przycisk „Zapisz" jest aktywny.
import { overridesSignature } from "@/lib/experts/layoutRules";

type TriState = "inherit" | "on" | "off";

const TRI_FROM_BOOL = (value: boolean | undefined): TriState =>
  value === undefined ? "inherit" : value ? "on" : "off";

export interface ExpertLayoutInlineEditorProps {
  /** Ekspert, którego stronę edytujemy (author_profiles.user_id). */
  expertId: string;
  /** Tenant profilu eksperta (INSERT pierwszego wiersza author_profiles). */
  tenantId: string;
  /** Czyste ustawienia tenanta (bez nadpisań) - baza dziedziczenia. */
  tenantSettings: ExpertLayoutSettings;
  /** Zapisane nadpisania z huba (null = pełne dziedziczenie). */
  savedOverrides: ExpertLayoutOverrides | null;
  /** Publikacja draftu do strony; null = koniec edycji (wróć do zapisanych). */
  onDraftChange: (draft: ExpertLayoutDraft | null) => void;
}

export default function ExpertLayoutInlineEditor({
  expertId,
  tenantId,
  tenantSettings,
  savedOverrides,
  onDraftChange,
}: ExpertLayoutInlineEditorProps) {
  // Rejestracja słowników w chunku edytora: własny + etykiety sekcji
  // współdzielone z /admin/expert-layouts (adminLayouts.expertLayouts.*).
  ensureEditorI18n();
  ensureAdminLayoutsI18n();
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === "en";

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ExpertLayoutOverrides | null>(savedOverrides);
  // Baseline do dirty-checku - aktualizowany po udanym zapisie, żeby nie
  // ścigać się z asynchronicznym refetchem huba po invalidacji.
  const [baseline, setBaseline] = useState<ExpertLayoutOverrides | null>(savedOverrides);
  const save = useSaveExpertLayoutOverrides();

  const dirty = overridesSignature(draft) !== overridesSignature(baseline);
  const overrideCount = countExpertLayoutOverrides(open ? draft : savedOverrides);

  const publish = useCallback(
    (next: ExpertLayoutOverrides | null) => {
      const normalized = next && Object.keys(next).length > 0 ? next : null;
      setDraft(normalized);
      onDraftChange({ overrides: normalized });
    },
    [onDraftChange],
  );

  const openEditor = () => {
    setDraft(savedOverrides);
    setBaseline(savedOverrides);
    setOpen(true);
    onDraftChange({ overrides: savedOverrides });
  };

  const closeEditor = useCallback(() => {
    if (dirty && !window.confirm(t("expertLayoutEditor.discardConfirm"))) return;
    setOpen(false);
    onDraftChange(null);
  }, [dirty, onDraftChange, t]);

  // Esc zamyka edytor; sprzątanie draftu przy odmontowaniu (nawigacja).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeEditor();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeEditor]);
  useEffect(() => () => onDraftChange(null), [onDraftChange]);

  // Merge draftu na ustawieniach tenanta - do prezentacji wartości
  // efektywnych/dziedziczonych w kontrolkach (ten sam merge co strona).
  const merged = useMemo(() => mergeExpertLayout(tenantSettings, draft), [tenantSettings, draft]);
  const order = useMemo(
    () =>
      normalizeExpertSectionOrder(merged.settings.section_order) ?? DEFAULT_EXPERT_SECTION_ORDER,
    [merged.settings.section_order],
  );

  const tenantPresetLabel = (() => {
    const preset = findExpertPreset(tenantSettings.default_preset);
    return isEn ? preset.label_en : preset.label_pl;
  })();

  // ---- settery różnicy (klucz nieobecny = dziedziczenie) -------------------
  const setPreset = (preset: ExpertLayoutPresetId | null) => {
    const next: ExpertLayoutOverrides = { ...(draft ?? {}) };
    if (preset) next.preset = preset;
    else delete next.preset;
    publish(next);
  };

  const setCentering = (key: "center_hero" | "center_details", value: TriState) => {
    const next: ExpertLayoutOverrides = { ...(draft ?? {}) };
    if (value === "inherit") delete next[key];
    else next[key] = value === "on";
    publish(next);
  };

  const setAccent = (key: "accent_color" | "accent_color_dark", value: string | null) => {
    const next: ExpertLayoutOverrides = { ...(draft ?? {}) };
    const safe = sanitizeCssColor(value);
    if (safe) next[key] = safe;
    else delete next[key];
    publish(next);
  };

  const setVisibility = (section: ExpertSectionKey, value: TriState) => {
    const visibility = { ...(draft?.visibility ?? {}) };
    if (value === "inherit") delete visibility[section];
    else visibility[section] = value === "on";
    const next: ExpertLayoutOverrides = { ...(draft ?? {}) };
    if (Object.keys(visibility).length > 0) next.visibility = visibility;
    else delete next.visibility;
    publish(next);
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const nextOrder = [...order];
    [nextOrder[index], nextOrder[target]] = [nextOrder[target], nextOrder[index]];
    publish({ ...(draft ?? {}), section_order: nextOrder });
  };

  const clearOrderOverride = () => {
    const next: ExpertLayoutOverrides = { ...(draft ?? {}) };
    delete next.section_order;
    publish(next);
  };

  const onSave = async () => {
    try {
      await save.mutateAsync({ userId: expertId, tenantId, overrides: draft });
      setBaseline(draft);
      toast.success(t("expertLayoutEditor.savedToast"));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      toast.error(t("expertLayoutEditor.saveErrorToast", { msg }));
      console.error("[expert-layout-inline-editor] save failed", error);
    }
  };

  const triCentering = (value: TriState, onChange: (v: TriState) => void, ariaLabel: string) => {
    const options: readonly SegmentedControlOption<TriState>[] = [
      {
        value: "inherit",
        label: t("expertLayoutEditor.inheritShort"),
        title: t("expertLayoutEditor.inherit"),
      },
      { value: "on", label: t("expertLayoutEditor.on"), title: t("expertLayoutEditor.on") },
      { value: "off", label: t("expertLayoutEditor.off"), title: t("expertLayoutEditor.off") },
    ];
    return (
      <SegmentedControl value={value} options={options} onChange={onChange} ariaLabel={ariaLabel} />
    );
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={openEditor}
        title={t("expertLayoutEditor.openTitle")}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-2.5 text-sm font-medium text-foreground shadow-lg backdrop-blur transition hover:border-brand/60 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        <Palette className="h-4 w-4" style={{ color: "var(--pv-accent)" }} aria-hidden />
        {t("expertLayoutEditor.open")}
        {overrideCount > 0 && (
          <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-brand-foreground">
            {overrideCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <aside
      role="dialog"
      aria-label={t("expertLayoutEditor.title")}
      className="fixed bottom-4 left-4 right-4 z-50 flex max-h-[min(78vh,720px)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl sm:left-auto sm:w-[360px]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="font-display text-sm text-foreground">{t("expertLayoutEditor.title")}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {t("expertLayoutEditor.subtitle")}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <span className="inline-flex items-center gap-1.5 text-brand">
              <span className="relative flex h-2 w-2" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
              </span>
              {t("expertLayoutEditor.livePreview")}
            </span>
            <span className="text-muted-foreground">
              {t("expertLayoutEditor.overridesCount", {
                count: countExpertLayoutOverrides(draft),
              })}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={closeEditor}
          aria-label={t("expertLayoutEditor.close")}
          className="shrink-0 rounded-[6px] p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-4">
        {/* Preset */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("expertLayoutEditor.presetHeading")}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPreset(null)}
              aria-pressed={!draft?.preset}
              className={`flex flex-col items-start justify-center rounded-md border-2 p-2 text-left transition ${
                !draft?.preset
                  ? "border-brand bg-brand/5 ring-2 ring-brand/25"
                  : "border-border bg-card hover:border-brand/50"
              }`}
            >
              <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-foreground">
                {!draft?.preset && <Check className="h-3.5 w-3.5 text-brand" aria-hidden />}
                {t("expertLayoutEditor.inherit")}
              </span>
              <span className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                {t("expertLayoutEditor.tenantPreset", { label: tenantPresetLabel })}
              </span>
            </button>
            {EXPERT_LAYOUT_PRESETS.map((preset) => {
              const active = draft?.preset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setPreset(preset.id)}
                  aria-pressed={active}
                  className={`rounded-md border-2 p-2 text-left transition ${
                    active
                      ? "border-brand bg-brand/5 ring-2 ring-brand/25"
                      : "border-border bg-card hover:border-brand/50"
                  }`}
                >
                  <ExpertPresetThumb id={preset.id} className="h-10" />
                  <span className="mt-1 block truncate text-[11px] font-medium text-foreground">
                    {isEn ? preset.label_en : preset.label_pl}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Sekcje: kolejność + widoczność */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("adminLayouts.expertLayouts.sectionsHeading")}
            </h3>
            {draft?.section_order && (
              <button
                type="button"
                onClick={clearOrderOverride}
                className="text-[11px] text-brand hover:underline"
                title={t("expertLayoutEditor.orderOverridden")}
              >
                {t("expertLayoutEditor.restoreTenantOrder")}
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("expertLayoutEditor.sectionsHint")}
          </p>
          <ul className="divide-y divide-border/60 rounded-md border border-border">
            {order.map((sectionKey, index) => {
              const overridden = draft?.visibility?.[sectionKey];
              const inherited = isSectionVisible(tenantSettings, sectionKey);
              const sectionLabel = t(`adminLayouts.expertLayouts.sections.${sectionKey}`);
              const visValue: TriState = TRI_FROM_BOOL(overridden);
              const options: readonly SegmentedControlOption<TriState>[] = [
                {
                  value: "inherit",
                  label: <Minus className="h-3 w-3" aria-hidden />,
                  title: `${t("expertLayoutEditor.inherit")} (${
                    inherited
                      ? t("expertLayoutEditor.inheritedShown")
                      : t("expertLayoutEditor.inheritedHidden")
                  })`,
                },
                {
                  value: "on",
                  label: <Eye className="h-3 w-3" aria-hidden />,
                  title: t("expertLayoutEditor.show"),
                },
                {
                  value: "off",
                  label: <EyeOff className="h-3 w-3" aria-hidden />,
                  title: t("expertLayoutEditor.hide"),
                },
              ];
              const effectivelyVisible = overridden ?? inherited;
              return (
                <li
                  key={sectionKey}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="w-4 shrink-0 tabular-nums text-muted-foreground">
                      {index + 1}.
                    </span>
                    <span
                      className={`truncate ${effectivelyVisible ? "" : "text-muted-foreground/60 line-through"}`}
                    >
                      {sectionLabel}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveSection(index, -1)}
                      disabled={index === 0}
                      aria-label={t("adminLayouts.expertLayouts.moveUp")}
                      className="rounded border border-border p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSection(index, 1)}
                      disabled={index === order.length - 1}
                      aria-label={t("adminLayouts.expertLayouts.moveDown")}
                      className="rounded border border-border p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                    <SegmentedControl
                      value={visValue}
                      options={options}
                      onChange={(value) => setVisibility(sectionKey, value)}
                      ariaLabel={t("expertLayoutEditor.visibilityLabel", {
                        section: sectionLabel,
                      })}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Wycentrowanie */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("adminLayouts.expertLayouts.centeringHeading")}
          </h3>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">{t("adminLayouts.expertLayouts.centerHero")}</span>
              {triCentering(
                TRI_FROM_BOOL(draft?.center_hero),
                (value) => setCentering("center_hero", value),
                t("adminLayouts.expertLayouts.centerHero"),
              )}
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">
                {t("adminLayouts.expertLayouts.centerDetails")}
              </span>
              {triCentering(
                TRI_FROM_BOOL(draft?.center_details),
                (value) => setCentering("center_details", value),
                t("adminLayouts.expertLayouts.centerDetails"),
              )}
            </div>
          </div>
        </section>

        {/* Akcent */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("expertLayoutEditor.accentHeading")}
          </h3>
          <p className="text-[11px] text-muted-foreground">{t("expertLayoutEditor.accentHint")}</p>
          <div className="grid grid-cols-1 gap-2">
            <OverrideColorField
              label={t("adminLayouts.expertLayouts.accentLight")}
              value={draft?.accent_color ?? null}
              inherited={tenantSettings.accent_color}
              onChange={(value) => setAccent("accent_color", value)}
              clearLabel={t("adminLayouts.expertLayouts.clearTitle")}
              placeholder={t("adminLayouts.expertLayouts.colorAutoPlaceholder")}
            />
            <OverrideColorField
              label={t("adminLayouts.expertLayouts.accentDark")}
              value={draft?.accent_color_dark ?? null}
              inherited={tenantSettings.accent_color_dark}
              onChange={(value) => setAccent("accent_color_dark", value)}
              clearLabel={t("adminLayouts.expertLayouts.clearTitle")}
              placeholder={t("adminLayouts.expertLayouts.colorAutoPlaceholder")}
            />
          </div>
        </section>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={() => publish(null)}
          disabled={countExpertLayoutOverrides(draft) === 0}
          title={t("expertLayoutEditor.resetAllTitle")}
          className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          {t("expertLayoutEditor.resetAll")}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={save.isPending || !dirty}
          className="rounded bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition disabled:opacity-60"
        >
          {save.isPending ? t("expertLayoutEditor.saving") : t("common.save")}
        </button>
      </footer>
    </aside>
  );
}

/**
 * Kompaktowe pole koloru świadome dziedziczenia: brak wartości pokazuje kolor
 * tenanta (szachownica, gdy tenant też dziedziczy motyw), wartość = nadpisanie
 * z przyciskiem czyszczenia. Tekst przechodzi przez sanitizeCssColor w setterze.
 */
function OverrideColorField({
  label,
  value,
  inherited,
  onChange,
  clearLabel,
  placeholder,
}: {
  label: string;
  value: string | null;
  inherited: string | null;
  onChange: (value: string | null) => void;
  clearLabel: string;
  placeholder: string;
}) {
  // Lokalny bufor tekstu: draft trzyma wartość ZSANITYZOWANĄ (przyciętą),
  // więc kontrolowanie inputa wprost draftem zjadałoby spacje w trakcie
  // wpisywania np. "oklch(0.6 0.1 240)". Bufor synchronizuje się z draftem
  // tylko, gdy zmiana przyszła z zewnątrz (picker, clear, refetch).
  const [text, setText] = useState(value ?? "");
  useEffect(() => {
    setText((current) => {
      const currentSanitized = sanitizeCssColor(current);
      const matchesDraft = currentSanitized === value || (current.trim() === "" && value === null);
      return matchesDraft ? current : (value ?? "");
    });
  }, [value]);

  const shown = value ?? inherited;
  return (
    <label className="flex items-center gap-2 rounded-md border border-border bg-card p-2 text-xs">
      <span className="w-24 shrink-0 truncate font-medium text-foreground">{label}</span>
      <span
        className={`relative h-8 w-8 shrink-0 overflow-hidden rounded border ${
          value ? "border-border" : "border-dashed border-border/80"
        }`}
        style={{
          backgroundColor: shown ?? "transparent",
          backgroundImage: shown
            ? undefined
            : "repeating-conic-gradient(hsl(var(--muted)) 0% 25%, hsl(var(--background)) 0% 50%)",
          backgroundSize: shown ? undefined : "8px 8px",
        }}
      >
        <input
          type="color"
          value={value ?? inherited ?? "#3366cc"}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
      <input
        type="text"
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          setText(event.target.value);
          onChange(event.target.value.trim() || null);
        }}
        className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1.5 font-mono text-xs"
        aria-label={label}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={clearLabel}
          title={clearLabel}
          className="shrink-0 rounded p-1 text-muted-foreground transition hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </label>
  );
}
