// Admin tab: edit brand design tokens (fonts, scale, colors) + Global Colors
// (semantic brand slots with light/dark mode). Saved to `site_design_tokens`
// and applied live via <DesignTokensStyle />.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DesignSubNav } from "@/components/admin/DesignSubNav";
import { Plus, Trash2, Copy, Sun, Moon } from "lucide-react";
import { toast } from "sonner";
import "@/lib/i18n-admin-appearance-routes";
import {
  useDesignTokens,
  useSaveDesignTokens,
  slugifyToken,
  type BrandColor,
  type DesignTokens,
  EMPTY_TOKENS,
} from "@/lib/builder/designTokens";
import { useGlobalColors, useSaveGlobalColors } from "@/hooks/useGlobalColors";
import {
  GLOBAL_COLOR_GROUPS,
  EMPTY_GLOBAL_COLORS,
  type GlobalColorsValue,
} from "@/lib/builder/globalColors";
import { Field, Text, SaveBar } from "@/components/admin/settings/fields";
import { ColorField } from "@/components/admin/builder/ui/atoms/ColorField";
import { FontPicker } from "@/components/admin/settings/FontPicker";
import { CustomFontUploader } from "@/components/admin/CustomFontUploader";
import type { CustomFont } from "@/lib/theme/customFonts";

export const Route = createFileRoute("/admin/settings/design")({
  component: DesignSettings,
});

function DesignSettings() {
  const { t } = useTranslation();
  const { data, isLoading } = useDesignTokens();
  const { data: globals, isLoading: gLoading } = useGlobalColors();
  const save = useSaveDesignTokens();
  const saveGlobals = useSaveGlobalColors();

  const [draft, setDraft] = useState<DesignTokens | null>(null);
  const [gDraft, setGDraft] = useState<GlobalColorsValue | null>(null);

  useEffect(() => {
    if (data && !draft) setDraft(data);
  }, [data, draft]);
  useEffect(() => {
    if (globals && !gDraft) setGDraft(globals);
  }, [globals, gDraft]);

  if (isLoading || gLoading || !draft || !gDraft) {
    return <p className="text-sm text-muted-foreground">{t("adminAppearanceRoutes.loading")}</p>;
  }

  const setColors = (mut: (cols: BrandColor[]) => BrandColor[]) =>
    setDraft({ ...draft, colors: mut(draft.colors) });

  const addColor = () =>
    setColors((cols) => [...cols, { name: `color-${cols.length + 1}`, value: "#3b82f6" }]);

  const copyVar = (name: string) => {
    const slug = slugifyToken(name);
    navigator.clipboard.writeText(`var(--brand-${slug})`);
    toast.success(t("adminAppearanceRoutes.design.copiedToast", { var: `var(--brand-${slug})` }));
  };

  const setSlot = (key: string, mode: "light" | "dark", v: string | undefined) =>
    setGDraft({ ...gDraft, [key]: { ...(gDraft[key] ?? {}), [mode]: v } });

  const saveAll = () => {
    save.mutate(draft ?? EMPTY_TOKENS);
    saveGlobals.mutate(gDraft ?? EMPTY_GLOBAL_COLORS);
  };

  return (
    <div>
      <DesignSubNav />
      <h2 className="font-display text-xl mb-1">{t("adminAppearanceRoutes.design.brandTokens")}</h2>
      <p className="text-sm text-muted-foreground mb-4">
        {t("adminAppearanceRoutes.design.introPre")}
        <code>var(--brand-…)</code>, <code>var(--gc-…)</code>
        {t("adminAppearanceRoutes.design.introPost")}
      </p>

      {/* ───────────────────────── FONTY ───────────────────────── */}
      <section className="mb-8">
        <h3 className="font-medium text-sm mb-2">{t("adminAppearanceRoutes.design.typography")}</h3>
        <Field
          label={t("adminAppearanceRoutes.design.headingFont")}
          hint={t("adminAppearanceRoutes.design.headingFontHint")}
        >
          <FontPicker
            value={draft.fonts.heading}
            onChange={(stack) => setDraft({ ...draft, fonts: { ...draft.fonts, heading: stack } })}
            sampleText={t("adminAppearanceRoutes.design.headingSample")}
            customFonts={draft.fonts.custom ?? []}
          />
        </Field>
        <Field
          label={t("adminAppearanceRoutes.design.bodyFont")}
          hint={t("adminAppearanceRoutes.design.bodyFontHint")}
        >
          <FontPicker
            value={draft.fonts.body}
            onChange={(stack) => setDraft({ ...draft, fonts: { ...draft.fonts, body: stack } })}
            sampleText={t("adminAppearanceRoutes.design.bodySample")}
            customFonts={draft.fonts.custom ?? []}
          />
        </Field>
        <div className="mt-3">
          <CustomFontUploader
            value={draft.fonts.custom ?? []}
            onChange={(custom: CustomFont[]) =>
              setDraft({ ...draft, fonts: { ...draft.fonts, custom } })
            }
          />
        </div>
        <Field
          label={t("adminAppearanceRoutes.design.radius")}
          hint={t("adminAppearanceRoutes.design.radiusHint")}
        >
          <Text
            value={draft.scale.radius ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, scale: { ...draft.scale, radius: e.target.value || undefined } })
            }
            placeholder="8px"
          />
        </Field>
      </section>

      {/* ───────────────────────── GLOBAL COLORS ───────────────────────── */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-medium text-sm">{t("adminAppearanceRoutes.design.brandColors")}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("adminAppearanceRoutes.design.brandColorsDescPrefix")}
              <Sun className="inline w-3 h-3 mb-0.5" />
              {t("adminAppearanceRoutes.design.brandColorsDescMid")}
              <Moon className="inline w-3 h-3 mb-0.5" />
              {t("adminAppearanceRoutes.design.brandColorsDescSuffix")}
            </p>
          </div>
        </div>

        <div className="space-y-6">
          {GLOBAL_COLOR_GROUPS.map((group) => (
            <div key={group.id} className="border border-border rounded-md overflow-hidden">
              <div className="px-3 py-2 bg-muted/40 border-b border-border">
                <h4 className="text-sm font-medium">{group.label}</h4>
              </div>
              <ul className="divide-y divide-border">
                {group.slots.map((slot) => {
                  const v = gDraft[slot.key] ?? {};
                  return (
                    <li key={slot.key} className="p-3 grid md:grid-cols-[260px_1fr] gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{slot.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {slot.description}
                        </div>
                        {slot.overrides && slot.overrides.length > 0 && (
                          <div className="text-[10px] text-muted-foreground/80 mt-1 font-mono">
                            {t("adminAppearanceRoutes.design.overrides")}{" "}
                            {slot.overrides.join(", ")}
                          </div>
                        )}
                        <code className="text-[10px] text-muted-foreground font-mono">
                          var(--gc-{slot.key})
                        </code>
                      </div>
                      <div
                        className={`grid gap-2 ${slot.hasDark ? "md:grid-cols-2" : "md:grid-cols-1"}`}
                      >
                        <div>
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground mb-1">
                            <Sun className="w-3 h-3" /> Light
                          </div>
                          <ColorField
                            value={v.light ?? slot.defaultLight ?? ""}
                            onChange={(nv) => setSlot(slot.key, "light", nv)}
                            placeholder={slot.defaultLight ?? "#…"}
                          />
                        </div>
                        {slot.hasDark && (
                          <div>
                            <div className="flex items-center gap-1 text-[11px] text-muted-foreground mb-1">
                              <Moon className="w-3 h-3" /> Dark
                            </div>
                            <ColorField
                              value={v.dark ?? slot.defaultDark ?? ""}
                              onChange={(nv) => setSlot(slot.key, "dark", nv)}
                              placeholder={slot.defaultDark ?? "#…"}
                            />
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ───────────────────────── EXTRA BRAND COLORS ───────────────────────── */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-medium text-sm">{t("adminAppearanceRoutes.design.extraColors")}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("adminAppearanceRoutes.design.extraColorsDescPrefix")}
              <code>var(--brand-…)</code>
              {t("adminAppearanceRoutes.design.extraColorsDescSuffix")}
            </p>
          </div>
          <button
            type="button"
            onClick={addColor}
            className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> {t("adminAppearanceRoutes.design.addColor")}
          </button>
        </div>

        {draft.colors.length === 0 ? (
          <p className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-4 text-center">
            {t("adminAppearanceRoutes.design.noExtraColors")}
          </p>
        ) : (
          <ul className="space-y-2">
            {draft.colors.map((c, idx) => {
              const slug = slugifyToken(c.name);
              return (
                <li
                  key={idx}
                  className="grid grid-cols-[140px_1fr_auto_auto] items-center gap-2 p-2 border border-border rounded-md bg-background"
                >
                  <Text
                    value={c.name}
                    onChange={(e) =>
                      setColors((cols) =>
                        cols.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)),
                      )
                    }
                    placeholder="primary"
                  />
                  <ColorField
                    value={c.value}
                    onChange={(v) =>
                      setColors((cols) =>
                        cols.map((x, i) => (i === idx ? { ...x, value: v ?? "" } : x)),
                      )
                    }
                  />
                  <button
                    type="button"
                    onClick={() => copyVar(c.name)}
                    className="p-1.5 text-muted-foreground hover:text-brand"
                    title={t("adminAppearanceRoutes.design.copyTitle", {
                      var: `var(--brand-${slug})`,
                    })}
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setColors((cols) => cols.filter((_, i) => i !== idx))}
                    className="p-1.5 text-muted-foreground hover:text-destructive"
                    title={t("adminAppearanceRoutes.design.remove")}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <SaveBar saving={save.isPending || saveGlobals.isPending} onSave={saveAll} />
    </div>
  );
}
