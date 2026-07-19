// Admin panel: /admin/expert-layouts - globalne ustawienia layoutu strony
// eksperta (8 wariantów + widoczność sekcji + kolejność + kolory hero).
// Ustawienia zapisywane w `expert_layout_settings` per tenant; ekspert może
// pojedyncze pola nadpisać na własnym profilu (inline editor - w kolejnym kroku).
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { adminToast } from "@/lib/adminToasts";
import { AdminShell } from "@/components/admin/AdminShell";
import "@/lib/i18n-admin-layouts";
import { ExpertLayoutPreview } from "@/components/admin/ExpertLayoutPreview";
import {
  useExpertLayoutSettings,
  useSaveExpertLayoutSettings,
} from "@/hooks/useExpertLayoutSettings";
import {
  DEFAULT_EXPERT_SECTION_ORDER,
  EXPERT_LAYOUT_PRESETS,
  EXPERT_SECTIONS,
  type ExpertLayoutPresetId,
  type ExpertLayoutSettings,
  type ExpertSectionKey,
} from "@/lib/expertLayouts";

export const Route = createFileRoute("/admin/expert-layouts")({ component: Page });

function Page() {
  const { t, i18n } = useTranslation();
  const { data } = useExpertLayoutSettings();
  const save = useSaveExpertLayoutSettings();
  const [local, setLocal] = useState<ExpertLayoutSettings | null>(null);
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    if (data && !local) setLocal(data);
  }, [data, local]);

  if (!local) {
    return (
      <AdminShell hideSidebar>
        <div className="p-6 text-sm text-muted-foreground">
          {t("adminLayouts.expertLayouts.loading")}
        </div>
      </AdminShell>
    );
  }

  const isEn = i18n.language === "en";

  const upd = (p: Partial<ExpertLayoutSettings>) => setLocal({ ...local, ...p });

  const onSave = async () => {
    const { tenant_id: _t, ...rest } = local;
    void _t;
    try {
      await save.mutateAsync(rest);
      setSavedAt(Date.now());

      toast.success(adminToast.layoutSaved());
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("adminLayouts.expertLayouts.saveFailed");
      toast.error(t("adminLayouts.expertLayouts.saveErrorToast", { msg }));
      console.error("[expert-layouts] save failed", e);
    }
  };

  const setVisibility = (key: ExpertSectionKey, value: boolean) => {
    const map: Record<ExpertSectionKey, keyof ExpertLayoutSettings> = {
      hero_cover: "show_hero_cover",
      expertise_bar: "show_expertise_bar",
      details: "show_details",
      social_row: "show_social_row",
      contact_card: "show_contact_card",
      media_mentions: "show_media_mentions",
      podcast_strip: "show_podcast_strip",
      materials: "show_materials",
      cv: "show_cv",
      programs: "show_programs",
    };
    upd({ [map[key]]: value } as Partial<ExpertLayoutSettings>);
  };

  const isVisible = (key: ExpertSectionKey): boolean => {
    const map: Record<ExpertSectionKey, boolean> = {
      hero_cover: local.show_hero_cover,
      expertise_bar: local.show_expertise_bar,
      details: local.show_details,
      social_row: local.show_social_row,
      contact_card: local.show_contact_card,
      media_mentions: local.show_media_mentions,
      podcast_strip: local.show_podcast_strip,
      materials: local.show_materials,
      cv: local.show_cv,
      programs: local.show_programs,
    };
    return map[key];
  };

  const order = local.section_order?.length ? local.section_order : DEFAULT_EXPERT_SECTION_ORDER;

  const moveSection = (idx: number, dir: -1 | 1) => {
    const next = [...order];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    upd({ section_order: next });
  };

  return (
    <AdminShell hideSidebar>
      <div className="mx-auto max-w-[1200px] space-y-8 p-4 md:p-6">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-xl">{t("adminLayouts.expertLayouts.pageTitle")}</h1>
            <p className="text-xs text-muted-foreground">{t("adminLayouts.expertLayouts.intro")}</p>
          </div>
          <button
            onClick={onSave}
            disabled={save.isPending}
            className="bg-brand text-brand-foreground px-4 py-2 rounded text-sm disabled:opacity-60"
          >
            {save.isPending ? t("adminLayouts.expertLayouts.saving") : t("common.save")}
          </button>
        </header>

        {/* Presety - 8 wariantów */}
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="font-display text-base">
              {t("adminLayouts.expertLayouts.defaultPreset")}
            </h2>
            <span className="text-[11px] text-muted-foreground">
              {t("adminLayouts.expertLayouts.selectedPrefix")}{" "}
              <b>
                {(() => {
                  const sel = EXPERT_LAYOUT_PRESETS.find((p) => p.id === local.default_preset);
                  return isEn ? sel?.label_en : sel?.label_pl;
                })()}
              </b>
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {EXPERT_LAYOUT_PRESETS.map((p) => {
              const active = local.default_preset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => upd({ default_preset: p.id as ExpertLayoutPresetId })}
                  aria-pressed={active}
                  className={`text-left p-3 rounded-lg border-2 transition shadow-sm ${
                    active
                      ? "border-brand ring-2 ring-brand/30 bg-brand/5"
                      : "border-border hover:border-brand/60 bg-card"
                  }`}
                >
                  <PresetThumb id={p.id} />
                  <p className="mt-2.5 text-[13px] font-semibold text-foreground">
                    {isEn ? p.label_en : p.label_pl}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-1">
                    {isEn ? p.description_en : p.description_pl}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        {/* Widoczność + kolejność sekcji */}
        <section className="space-y-2">
          <h2 className="font-display text-base">
            {t("adminLayouts.expertLayouts.sectionsHeading")}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {t("adminLayouts.expertLayouts.sectionsHint")}
          </p>
          <ul className="divide-y divide-border/60 rounded-md border border-border">
            {order.map((key, idx) => (
              <li key={key} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="tabular-nums text-muted-foreground w-5 shrink-0">
                    {idx + 1}.
                  </span>
                  <span className="truncate">
                    {t(`adminLayouts.expertLayouts.sections.${key}`)}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => moveSection(idx, -1)}
                    disabled={idx === 0}
                    className="px-1.5 py-0.5 rounded border border-border text-[11px] disabled:opacity-40"
                    aria-label={t("adminLayouts.expertLayouts.moveUp")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSection(idx, 1)}
                    disabled={idx === order.length - 1}
                    className="px-1.5 py-0.5 rounded border border-border text-[11px] disabled:opacity-40"
                    aria-label={t("adminLayouts.expertLayouts.moveDown")}
                  >
                    ↓
                  </button>
                  <Toggle
                    checked={isVisible(key)}
                    onChange={(v) => setVisibility(key, v)}
                    label=""
                  />
                </div>
              </li>
            ))}
          </ul>
          {order.length !== EXPERT_SECTIONS.length && (
            <button
              type="button"
              onClick={() => upd({ section_order: DEFAULT_EXPERT_SECTION_ORDER })}
              className="text-[11px] text-brand hover:underline"
            >
              {t("adminLayouts.expertLayouts.restoreOrder")}
            </button>
          )}
        </section>

        {/* Wycentrowanie + szerokość */}
        <section className="grid md:grid-cols-2 gap-6">
          <div className="space-y-1">
            <h2 className="font-display text-base mb-1">
              {t("adminLayouts.expertLayouts.centeringHeading")}
            </h2>
            <Toggle
              label={t("adminLayouts.expertLayouts.centerHero")}
              checked={local.center_hero}
              onChange={(v) => upd({ center_hero: v })}
            />
            <Toggle
              label={t("adminLayouts.expertLayouts.centerDetails")}
              checked={local.center_details}
              onChange={(v) => upd({ center_details: v })}
            />
          </div>

          <div className="space-y-1">
            <h2 className="font-display text-base mb-1">
              {t("adminLayouts.expertLayouts.widthTypoHeading")}
            </h2>
            <label className="block text-xs">
              <span className="text-muted-foreground">
                {t("adminLayouts.expertLayouts.maxWidth")}
              </span>
              <input
                type="number"
                min={880}
                max={1600}
                value={local.max_width}
                onChange={(e) =>
                  upd({ max_width: Math.max(880, Math.min(1600, Number(e.target.value) || 1200)) })
                }
                className="w-full px-2 py-1.5 rounded border border-input bg-background text-xs mt-1"
              />
            </label>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <label className="text-xs">
                <span className="text-muted-foreground">
                  {t("adminLayouts.expertLayouts.nameMobile")}
                </span>
                <input
                  type="number"
                  min={20}
                  max={80}
                  value={local.name_size_base}
                  onChange={(e) => upd({ name_size_base: Number(e.target.value) || 36 })}
                  className="w-full px-2 py-1 rounded border border-input bg-background text-xs mt-1"
                />
              </label>
              <label className="text-xs">
                <span className="text-muted-foreground">
                  {t("adminLayouts.expertLayouts.nameDesktop")}
                </span>
                <input
                  type="number"
                  min={24}
                  max={96}
                  value={local.name_size_lg}
                  onChange={(e) => upd({ name_size_lg: Number(e.target.value) || 48 })}
                  className="w-full px-2 py-1 rounded border border-input bg-background text-xs mt-1"
                />
              </label>
            </div>
          </div>
        </section>

        {/* Kolory */}
        <section className="space-y-2">
          <h2 className="font-display text-base">
            {t("adminLayouts.expertLayouts.colorsHeading")}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {t("adminLayouts.expertLayouts.colorsHint")}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <ColorField
              label={t("adminLayouts.expertLayouts.heroBgLight")}
              value={local.hero_bg_color}
              onChange={(v) => upd({ hero_bg_color: v })}
            />
            <ColorField
              label={t("adminLayouts.expertLayouts.heroBgDark")}
              value={local.hero_bg_color_dark}
              onChange={(v) => upd({ hero_bg_color_dark: v })}
            />
            <ColorField
              label={t("adminLayouts.expertLayouts.heroTextLight")}
              value={local.hero_text_color}
              onChange={(v) => upd({ hero_text_color: v })}
            />
            <ColorField
              label={t("adminLayouts.expertLayouts.heroTextDark")}
              value={local.hero_text_color_dark}
              onChange={(v) => upd({ hero_text_color_dark: v })}
            />
            <ColorField
              label={t("adminLayouts.expertLayouts.accentLight")}
              value={local.accent_color}
              onChange={(v) => upd({ accent_color: v })}
            />
            <ColorField
              label={t("adminLayouts.expertLayouts.accentDark")}
              value={local.accent_color_dark}
              onChange={(v) => upd({ accent_color_dark: v })}
            />
            <ColorField
              label={t("adminLayouts.expertLayouts.bioBulletLight")}
              value={local.bio_bullet_color}
              onChange={(v) => upd({ bio_bullet_color: v })}
            />
            <ColorField
              label={t("adminLayouts.expertLayouts.bioBulletDark")}
              value={local.bio_bullet_color_dark}
              onChange={(v) => upd({ bio_bullet_color_dark: v })}
            />
          </div>
        </section>

        <ExpertLayoutPreview settings={local} savedAt={savedAt} />
      </div>
    </AdminShell>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center gap-3 py-1 ${label ? "justify-between border-b border-border/60" : ""}`}
    >
      {label && <span className="text-xs">{label}</span>}
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        className={`relative w-8 h-4 rounded-full transition shrink-0 ${
          checked ? "bg-brand" : "bg-muted"
        }`}
      >
        <span
          className={`absolute top-0.5 ${
            checked ? "left-4" : "left-0.5"
          } w-3 h-3 rounded-full bg-background transition-all`}
        />
      </button>
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const { t } = useTranslation();
  const isSet = Boolean(value);
  return (
    <label className="block text-xs space-y-1.5 rounded-md border border-border bg-card p-2.5">
      <span className="block font-medium text-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <div
          className="h-9 w-9 shrink-0 rounded border border-border relative overflow-hidden"
          style={{
            backgroundColor: isSet ? (value as string) : "transparent",
            backgroundImage: isSet
              ? undefined
              : "repeating-conic-gradient(hsl(var(--muted)) 0% 25%, hsl(var(--background)) 0% 50%)",
            backgroundSize: isSet ? undefined : "10px 10px",
          }}
        >
          <input
            type="color"
            value={value ?? "#3366cc"}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label={label}
          />
        </div>
        <input
          type="text"
          placeholder={t("adminLayouts.expertLayouts.colorAutoPlaceholder")}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value.trim() || null)}
          className="flex-1 min-w-0 px-2 py-1.5 rounded border border-input bg-background text-xs font-mono"
        />
        {isSet && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-muted-foreground hover:text-foreground shrink-0 px-1"
            aria-label={t("adminLayouts.expertLayouts.clear")}
            title={t("adminLayouts.expertLayouts.clearTitle")}
          >
            ✕
          </button>
        )}
      </div>
    </label>
  );
}

// Uproszczony piktogram wariantu - schemat blokowy, żeby administrator od razu
// widział strukturę hero. Bez ikon zewnętrznych, tylko div-y z tokenami.
function PresetThumb({ id }: { id: ExpertLayoutPresetId }) {
  const base =
    "relative h-20 w-full rounded border border-border bg-muted/50 p-2 flex gap-1.5 overflow-hidden";
  switch (id) {
    case "classic":
      return (
        <div className={base}>
          <div className="h-full w-6 rounded-[2px] bg-brand/70" />
          <div className="flex-1 flex flex-col gap-1">
            <div className="h-2 w-3/4 rounded bg-foreground/40" />
            <div className="h-1.5 w-1/2 rounded bg-foreground/25" />
            <div className="h-1 w-full rounded bg-foreground/15 mt-auto" />
          </div>
        </div>
      );
    case "centered":
      return (
        <div className={`${base} flex-col items-center justify-center`}>
          <div className="h-5 w-5 rounded-full bg-brand/70" />
          <div className="h-1.5 w-1/2 rounded bg-foreground/40" />
          <div className="h-1 w-2/5 rounded bg-foreground/25" />
        </div>
      );
    case "magazine":
      return (
        <div className={`${base} flex-col`}>
          <div className="h-6 w-full rounded bg-brand/60" />
          <div className="flex gap-1 mt-auto">
            <div className="h-4 w-4 rounded bg-foreground/40" />
            <div className="flex-1 flex flex-col justify-center gap-1">
              <div className="h-1.5 w-3/4 rounded bg-foreground/40" />
              <div className="h-1 w-1/2 rounded bg-foreground/25" />
            </div>
          </div>
        </div>
      );
    case "sidebar-left":
      return (
        <div className={base}>
          <div className="h-full w-1/3 rounded bg-brand/50" />
          <div className="flex-1 flex flex-col gap-1">
            <div className="h-1.5 w-3/4 rounded bg-foreground/40" />
            <div className="h-1 w-full rounded bg-foreground/20" />
            <div className="h-1 w-4/5 rounded bg-foreground/20" />
          </div>
        </div>
      );
    case "sidebar-right":
      return (
        <div className={base}>
          <div className="flex-1 flex flex-col gap-1">
            <div className="h-1.5 w-3/4 rounded bg-foreground/40" />
            <div className="h-1 w-full rounded bg-foreground/20" />
            <div className="h-1 w-4/5 rounded bg-foreground/20" />
          </div>
          <div className="h-full w-1/3 rounded bg-brand/50" />
        </div>
      );
    case "minimal":
      return (
        <div className={`${base} flex-col justify-center`}>
          <div className="h-2 w-1/2 rounded bg-foreground/50" />
          <div className="h-px w-8 bg-brand/70 my-1" />
          <div className="h-1 w-1/3 rounded bg-foreground/25" />
        </div>
      );
    case "card-stack":
      return (
        <div className={`${base} flex-col`}>
          <div className="h-4 w-full rounded bg-background border border-border shadow-sm" />
          <div className="h-3 w-full rounded bg-background border border-border shadow-sm mt-1" />
          <div className="h-3 w-full rounded bg-background border border-border shadow-sm mt-1" />
        </div>
      );
    case "editorial":
      return (
        <div className={`${base} flex-col justify-end`}>
          <div className="absolute inset-1.5 rounded bg-gradient-to-t from-brand/70 to-transparent" />
          <div className="relative h-1.5 w-3/4 rounded bg-white/80" />
          <div className="relative h-1 w-1/2 rounded bg-white/60 mt-0.5" />
        </div>
      );
    default:
      return <div className={base} />;
  }
}
