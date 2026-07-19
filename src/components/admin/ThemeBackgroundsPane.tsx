// Theme Options - sekcja "Tła motywu" i "Kolory pól tekstowych".
// Edytuje globalne kolory (light + dark) z wybranej grupy w Global Colors.
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Sun, Moon, Save, Undo } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import "@/lib/i18n-admin-panes-misc";

import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";
import { Label } from "@/components/ui/label";
import { hardenStyleCss } from "@/lib/sanitize";
import {
  GLOBAL_COLOR_GROUPS,
  EMPTY_GLOBAL_COLORS,
  globalColorsToCss,
  type GlobalColorsValue,
  type GlobalColorSlot,
} from "@/lib/builder/globalColors";
import { useGlobalColors, useSaveGlobalColors } from "@/hooks/useGlobalColors";

function ColorField({
  label,
  icon,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  defaultValue?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </Label>
      <AdminColorPicker
        value={value}
        onChange={(v) => onChange(v ?? "")}
        inheritedValue={defaultValue}
        allowTransparent={true}
        allowReset={true}
        ariaLabel={label}
      />
    </div>
  );
}

function resolveColor(
  draft: GlobalColorsValue,
  key: string,
  mode: "light" | "dark",
  fallback: string,
): string {
  const val = draft[key]?.[mode];
  if (val) return val;
  const slot = GLOBAL_COLOR_GROUPS.flatMap((g) => g.slots).find((s) => s.key === key);
  if (slot) {
    if (mode === "dark" && slot.defaultDark) return slot.defaultDark;
    if (slot.defaultLight) return slot.defaultLight;
  }
  return fallback;
}

function InputGroupPreview({ draft }: { draft: GlobalColorsValue }) {
  const { t } = useTranslation();
  const light: CSSProperties = {
    "--gc-input-bg": resolveColor(draft, "input-bg", "light", "#ffffff"),
    "--gc-input-text": resolveColor(draft, "input-text", "light", "#141414"),
    "--gc-input-placeholder": resolveColor(draft, "input-placeholder", "light", "#94a3b8"),
    "--gc-input-border": resolveColor(draft, "input-border", "light", "#e2e8f0"),
    "--gc-input-hover-bg": resolveColor(draft, "input-hover-bg", "light", "#f8fafc"),
    "--gc-input-hover-border": resolveColor(draft, "input-hover-border", "light", "#cbd5e1"),
    "--gc-input-focus-border": resolveColor(draft, "input-focus-border", "light", "#fa9346"),
  } as CSSProperties;

  const dark: CSSProperties = {
    "--gc-input-bg": resolveColor(draft, "input-bg", "dark", "#141414"),
    "--gc-input-text": resolveColor(draft, "input-text", "dark", "#f1f5f9"),
    "--gc-input-placeholder": resolveColor(draft, "input-placeholder", "dark", "#64748b"),
    "--gc-input-border": resolveColor(draft, "input-border", "dark", "#1f1f1f"),
    "--gc-input-hover-bg": resolveColor(draft, "input-hover-bg", "dark", "#1f1f1f"),
    "--gc-input-hover-border": resolveColor(draft, "input-hover-border", "dark", "#334155"),
    "--gc-input-focus-border": resolveColor(draft, "input-focus-border", "dark", "#fbbf24"),
  } as CSSProperties;

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
      <div className="text-sm font-semibold">{t("adminPanesMisc.themeBg.inputPreview")}</div>
      <div className="grid md:grid-cols-2 gap-3">
        <div className="space-y-2" style={light}>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            {t("adminPanesMisc.themeBg.lightMode")}
          </div>
          <input
            readOnly
            placeholder="Placeholder..."
            className="w-full px-3 py-2 rounded-md border text-sm"
          />
          <input
            readOnly
            placeholder="Hover state"
            className="w-full px-3 py-2 rounded-md border text-sm"
            style={{
              background: "var(--gc-input-hover-bg)",
              borderColor: "var(--gc-input-hover-border)",
            }}
          />
          <input
            readOnly
            placeholder="Focus state"
            className="w-full px-3 py-2 rounded-md border text-sm"
            style={{
              borderColor: "var(--gc-input-focus-border)",
              outline: "2px solid var(--gc-input-focus-border)",
              outlineOffset: 0,
            }}
          />
        </div>
        <div className="space-y-2" style={dark}>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            {t("adminPanesMisc.themeBg.darkMode")}
          </div>
          <input
            readOnly
            placeholder="Placeholder..."
            className="w-full px-3 py-2 rounded-md border text-sm"
          />
          <input
            readOnly
            placeholder="Hover state"
            className="w-full px-3 py-2 rounded-md border text-sm"
            style={{
              background: "var(--gc-input-hover-bg)",
              borderColor: "var(--gc-input-hover-border)",
            }}
          />
          <input
            readOnly
            placeholder="Focus state"
            className="w-full px-3 py-2 rounded-md border text-sm"
            style={{
              borderColor: "var(--gc-input-focus-border)",
              outline: "2px solid var(--gc-input-focus-border)",
              outlineOffset: 0,
            }}
          />
        </div>
      </div>
    </div>
  );
}

interface ThemeBackgroundsPaneProps {
  groupId?: string;
  title?: string;
  description?: string;
}

export function ThemeBackgroundsPane({
  groupId = "body",
  title,
  description,
}: ThemeBackgroundsPaneProps = {}) {
  const { t } = useTranslation();
  const titleText = title ?? t("adminPanesMisc.themeBg.title");
  const descriptionText = description ?? t("adminPanesMisc.themeBg.description");
  const { data, isLoading } = useGlobalColors();
  const save = useSaveGlobalColors();
  const [draft, setDraft] = useState<GlobalColorsValue | null>(null);

  useEffect(() => {
    if (data && draft === null) setDraft({ ...EMPTY_GLOBAL_COLORS, ...data });
  }, [data, draft]);

  if (isLoading || !draft) {
    return <p className="text-sm text-muted-foreground">{t("adminPanesMisc.loading")}</p>;
  }

  const group = GLOBAL_COLOR_GROUPS.find((g) => g.id === groupId);
  const slots: GlobalColorSlot[] = group?.slots ?? [];
  const baseline = { ...EMPTY_GLOBAL_COLORS, ...(data ?? {}) };
  const isDirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  const setSlot = (key: string, mode: "light" | "dark", v: string) => {
    setDraft({ ...draft, [key]: { ...(draft[key] ?? {}), [mode]: v } });
  };
  const resetSlot = (slot: GlobalColorSlot) => {
    setDraft({
      ...draft,
      [slot.key]: {
        ...(draft[slot.key] ?? {}),
        light: slot.defaultLight ?? "",
        dark: slot.defaultDark ?? "",
      },
    });
  };

  const liveCss = globalColorsToCss(draft);

  return (
    <div className="space-y-6">
      <style
        data-theme-backgrounds-preview
        dangerouslySetInnerHTML={{ __html: hardenStyleCss(liveCss) }}
      />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-lg">{titleText}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{descriptionText}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDraft(baseline)}
            disabled={!isDirty || save.isPending}
          >
            <Undo className="w-4 h-4 mr-2" />
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={() => draft && save.mutate(draft)}
            disabled={!isDirty || save.isPending}
          >
            <Save className="w-4 h-4 mr-2" />
            {save.isPending ? t("adminPanesMisc.saving") : t("common.save")}
          </Button>
        </div>
      </div>

      {groupId === "input" && <InputGroupPreview draft={draft} />}

      <div className="grid gap-4">
        {slots.map((slot) => {
          const val = draft[slot.key] ?? {};
          return (
            <div
              key={slot.key}
              className="rounded-lg border border-border bg-card/40 p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Label className="text-base font-bold">{slot.label}</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{slot.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => resetSlot(slot)}
                  className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
                  title={t("adminPanesMisc.themeBg.resetTitle")}
                >
                  <Undo className="w-3 h-3" />
                  {t("adminPanesMisc.themeBg.defaultBtn")}
                </button>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <ColorField
                  label={t("adminPanesMisc.themeBg.lightMode")}
                  icon={<Sun className="w-3.5 h-3.5" />}
                  value={val.light ?? ""}
                  defaultValue={slot.defaultLight}
                  onChange={(v) => setSlot(slot.key, "light", v)}
                />
                <ColorField
                  label={t("adminPanesMisc.themeBg.darkMode")}
                  icon={<Moon className="w-3.5 h-3.5" />}
                  value={val.dark ?? ""}
                  defaultValue={slot.defaultDark}
                  onChange={(v) => setSlot(slot.key, "dark", v)}
                />
              </div>

              {groupId !== "input" && (
                <div className="grid md:grid-cols-2 gap-3 pt-1">
                  <div
                    className="h-14 rounded-md border border-border flex items-center justify-center text-[11px] font-medium text-[#141414]"
                    style={{ background: val.light || slot.defaultLight || "#ffffff" }}
                  >
                    Light preview
                  </div>
                  <div
                    className="h-14 rounded-md border border-border flex items-center justify-center text-[11px] font-medium text-white"
                    style={{ background: val.dark || slot.defaultDark || "#141414" }}
                  >
                    Dark preview
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
