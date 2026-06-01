// Global Colors editor — pozwala ustawić kolory dla light/dark mode
// dla każdego slotu z GLOBAL_COLOR_GROUPS. Wybór z palety presetów,
// pełny color picker oraz przycisk przywracania domyślnych wartości.
import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { Save, Undo } from "@/lib/lucide-shim";
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

// Paleta presetów — szybkie wybory.
const PALETTE = [
  "#000000", "#ffffff", "#1f2937", "#374151", "#6b7280", "#9ca3af", "#e5e7eb", "#f3f4f6",
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#10b981", "#14b8a6",
  "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899",
  "#fbbf24", "#fde68a", "#bbf7d0", "#bae6fd", "#c7d2fe", "#fbcfe8", "#fecaca", "#0f172a",
];

export function GlobalColorsEditor() {
  const { data, isLoading } = useGlobalColors();
  const save = useSaveGlobalColors();
  const [draft, setDraft] = useState<GlobalColorsValue | null>(null);

  useEffect(() => {
    if (data && draft === null) setDraft({ ...EMPTY_GLOBAL_COLORS, ...data });
  }, [data, draft]);

  if (isLoading || !draft) return <p className="text-sm text-muted-foreground">Ładowanie…</p>;

  const setSlot = (key: string, mode: "light" | "dark", value: string) => {
    setDraft({ ...draft, [key]: { ...(draft[key] ?? {}), [mode]: value } });
  };
  const resetSlot = (slot: GlobalColorSlot) => {
    setDraft({
      ...draft,
      [slot.key]: { light: slot.defaultLight ?? "", dark: slot.defaultDark ?? "" },
    });
  };

  // Live preview — natychmiast nadpisuje :root / .dark tokenami z draftu,
  // dzięki czemu builder po prawej widzi zmiany w czasie rzeczywistym.
  const liveCss = globalColorsToCss(draft);

  return (
    <div className="space-y-6">
      {/* eslint-disable-next-line react/no-danger */}
      <style data-global-colors-preview dangerouslySetInnerHTML={{ __html: liveCss }} />
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg">Global Colors</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ustaw kolory dla trybu jasnego i ciemnego. Zmiany wpływają na całą stronę.
          </p>
        </div>
        <Button size="sm" onClick={() => save.mutate(draft)} disabled={save.isPending}>
          <Save className="w-4 h-4 mr-2" />
          {save.isPending ? "Zapisywanie…" : "Zapisz"}
        </Button>
      </div>

      <Tabs defaultValue={GLOBAL_COLOR_GROUPS[0]?.id} className="w-full">
        <TabsList className="w-full flex flex-wrap h-auto justify-start gap-1 bg-muted/50 p-1">
          {GLOBAL_COLOR_GROUPS.map((group) => (
            <TabsTrigger key={group.id} value={group.id} className="text-xs">
              {group.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {GLOBAL_COLOR_GROUPS.map((group) => (
          <TabsContent key={group.id} value={group.id} className="mt-4">
            <div className="rounded-lg border border-border bg-card/40">
              <div className="rounded-t-lg bg-sky-500 text-white text-xs font-semibold px-3 py-2">
                {group.label}
              </div>
              <div className="p-4 space-y-5">
                {group.slots.map((slot) => {
                  const val = draft[slot.key] ?? {};
                  return (
                    <div key={slot.key} className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Label className="text-sm font-medium">{slot.label}</Label>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{slot.description}</p>
                        </div>
                        {(slot.defaultLight || slot.defaultDark) && (
                          <button
                            type="button"
                            onClick={() => resetSlot(slot)}
                            className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
                            title="Przywróć kolor domyślny"
                          >
                            <Undo className="w-3 h-3" />
                            Domyślny
                          </button>
                        )}
                      </div>

                      <ColorRow
                        label="Light"
                        value={val.light ?? ""}
                        defaultValue={slot.defaultLight}
                        onChange={(v) => setSlot(slot.key, "light", v)}
                      />
                      {slot.hasDark && (
                        <ColorRow
                          label="Dark"
                          value={val.dark ?? ""}
                          defaultValue={slot.defaultDark}
                          onChange={(v) => setSlot(slot.key, "dark", v)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>

    </div>
  );
}

function ColorRow({
  label, value, defaultValue, onChange,
}: { label: string; value: string; defaultValue?: string; onChange: (v: string) => void }) {
  const effective = value || defaultValue || "#ffffff";
  return (
    <div className="rounded-md border border-border bg-background/60 p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground w-12">{label}</span>
        <Input
          type="color"
          value={effective}
          onChange={(e) => onChange(e.target.value)}
          className="w-12 h-8 p-1 cursor-pointer"
        />
        <Input
          type="text"
          value={value}
          placeholder={defaultValue || "#______"}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-xs font-mono w-[120px]"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Wyczyść
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={`w-5 h-5 rounded border transition ${
              value?.toLowerCase() === c.toLowerCase()
                ? "border-foreground ring-2 ring-offset-1 ring-foreground/30"
                : "border-border hover:scale-110"
            }`}
            style={{ background: c }}
            title={c}
          />
        ))}
      </div>
    </div>
  );
}
