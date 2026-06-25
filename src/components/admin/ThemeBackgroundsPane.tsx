// Theme Options — sekcja "Tła motywu".
// Edytuje globalne tła (light + dark) z grupy `body` w Global Colors:
// Body Background, Body Background (Single Post), Surface/Card, Secondary Surface.
import { useEffect, useState } from "react";
import { Sun, Moon, Save, Undo } from "@/lib/lucide-shim";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  GLOBAL_COLOR_GROUPS,
  EMPTY_GLOBAL_COLORS,
  globalColorsToCss,
  type GlobalColorsValue,
  type GlobalColorSlot,
} from "@/lib/builder/globalColors";
import { useGlobalColors, useSaveGlobalColors } from "@/hooks/useGlobalColors";

function isHex(v: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v.trim());
}

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
  const effective = value || defaultValue || "#ffffff";
  return (
    <div className="space-y-1.5">
      <Label className="text-xs flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={isHex(effective) ? effective : "#ffffff"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 rounded border border-border bg-transparent cursor-pointer"
          aria-label={`${label} - color picker`}
        />
        <Input
          value={value}
          placeholder={defaultValue ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs h-9"
        />
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
  title = "Tła motywu",
  description = "Ustaw główne tła strony oraz powierzchni (kart, sidebaru) dla trybu jasnego i ciemnego. Zmiany działają natychmiast w podglądzie.",
}: ThemeBackgroundsPaneProps = {}) {
  const { data, isLoading } = useGlobalColors();
  const save = useSaveGlobalColors();
  const [draft, setDraft] = useState<GlobalColorsValue | null>(null);

  useEffect(() => {
    if (data && draft === null) setDraft({ ...EMPTY_GLOBAL_COLORS, ...data });
  }, [data, draft]);

  if (isLoading || !draft) {
    return <p className="text-sm text-muted-foreground">Ładowanie…</p>;
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
      {/* eslint-disable-next-line react/no-danger */}
      <style data-theme-backgrounds-preview dangerouslySetInnerHTML={{ __html: liveCss }} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-lg">Tła motywu</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ustaw główne tła strony oraz powierzchni (kart, sidebaru) dla trybu jasnego i ciemnego.
            Zmiany działają natychmiast w podglądzie.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDraft(baseline)}
            disabled={!isDirty || save.isPending}
          >
            <Undo className="w-4 h-4 mr-2" />
            Anuluj
          </Button>
          <Button
            size="sm"
            onClick={() => draft && save.mutate(draft)}
            disabled={!isDirty || save.isPending}
          >
            <Save className="w-4 h-4 mr-2" />
            {save.isPending ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </div>
      </div>

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
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {slot.description}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => resetSlot(slot)}
                  className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
                  title="Przywróć domyślne"
                >
                  <Undo className="w-3 h-3" />
                  Domyślne
                </button>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <ColorField
                  label="Tryb jasny"
                  icon={<Sun className="w-3.5 h-3.5" />}
                  value={val.light ?? ""}
                  defaultValue={slot.defaultLight}
                  onChange={(v) => setSlot(slot.key, "light", v)}
                />
                <ColorField
                  label="Tryb ciemny"
                  icon={<Moon className="w-3.5 h-3.5" />}
                  value={val.dark ?? ""}
                  defaultValue={slot.defaultDark}
                  onChange={(v) => setSlot(slot.key, "dark", v)}
                />
              </div>

              {/* Preview swatches */}
              <div className="grid md:grid-cols-2 gap-3 pt-1">
                <div
                  className="h-14 rounded-md border border-border flex items-center justify-center text-[11px] font-medium text-[#131822]"
                  style={{ background: val.light || slot.defaultLight || "#ffffff" }}
                >
                  Light preview
                </div>
                <div
                  className="h-14 rounded-md border border-border flex items-center justify-center text-[11px] font-medium text-white"
                  style={{ background: val.dark || slot.defaultDark || "#131822" }}
                >
                  Dark preview
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
