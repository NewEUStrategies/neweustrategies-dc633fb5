// Admin tab: edit brand design tokens (fonts, scale, colors) + Global Colors
// (semantic brand slots with light/dark mode). Saved to `site_design_tokens`
// and applied live via <DesignTokensStyle />.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, Copy, Sun, Moon } from "lucide-react";
import { toast } from "sonner";
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
  const { data, isLoading } = useDesignTokens();
  const { data: globals, isLoading: gLoading } = useGlobalColors();
  const save = useSaveDesignTokens();
  const saveGlobals = useSaveGlobalColors();

  const [draft, setDraft] = useState<DesignTokens | null>(null);
  const [gDraft, setGDraft] = useState<GlobalColorsValue | null>(null);

  useEffect(() => { if (data && !draft) setDraft(data); }, [data, draft]);
  useEffect(() => { if (globals && !gDraft) setGDraft(globals); }, [globals, gDraft]);

  if (isLoading || gLoading || !draft || !gDraft) {
    return <p className="text-sm text-muted-foreground">Ładowanie…</p>;
  }

  const setColors = (mut: (cols: BrandColor[]) => BrandColor[]) =>
    setDraft({ ...draft, colors: mut(draft.colors) });

  const addColor = () =>
    setColors((cols) => [...cols, { name: `color-${cols.length + 1}`, value: "#3b82f6" }]);

  const copyVar = (name: string) => {
    const slug = slugifyToken(name);
    navigator.clipboard.writeText(`var(--brand-${slug})`);
    toast.success(`Skopiowano var(--brand-${slug})`);
  };

  const setSlot = (key: string, mode: "light" | "dark", v: string | undefined) =>
    setGDraft({ ...gDraft, [key]: { ...(gDraft[key] ?? {}), [mode]: v } });

  const saveAll = () => {
    save.mutate(draft ?? EMPTY_TOKENS);
    saveGlobals.mutate(gDraft ?? EMPTY_GLOBAL_COLORS);
  };

  return (
    <div>
      <h2 className="font-display text-xl mb-1">Tokeny marki</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Fonty i kolory definiują wygląd całej strony. Wartości zapisują się jako zmienne CSS
        (<code>var(--brand-…)</code>, <code>var(--gc-…)</code>) i automatycznie nadpisują tokeny
        motywu (przyciski, tło, linki, ramki) — w trybie jasnym i ciemnym.
      </p>

      {/* ───────────────────────── FONTY ───────────────────────── */}
      <section className="mb-8">
        <h3 className="font-medium text-sm mb-2">Typografia</h3>
        <Field label="Font nagłówków" hint="Używany dla H1–H6 oraz tytułów w widgetach.">
          <FontPicker
            value={draft.fonts.heading}
            onChange={(stack) => setDraft({ ...draft, fonts: { ...draft.fonts, heading: stack } })}
            sampleText="Nagłówek — Headlines &amp; Display"
            customFonts={draft.fonts.custom ?? []}
          />
        </Field>
        <Field label="Font tekstu" hint="Treść artykułów, akapity, listy, opisy.">
          <FontPicker
            value={draft.fonts.body}
            onChange={(stack) => setDraft({ ...draft, fonts: { ...draft.fonts, body: stack } })}
            sampleText="Treść — szybki brązowy lis przeskakuje przez leniwego psa."
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
        <Field label="Promień (radius)" hint="Domyślny border-radius dla kart, przycisków itp.">
          <Text
            value={draft.scale.radius ?? ""}
            onChange={(e) => setDraft({ ...draft, scale: { ...draft.scale, radius: e.target.value || undefined } })}
            placeholder="8px"
          />
        </Field>
      </section>

      {/* ───────────────────────── GLOBAL COLORS ───────────────────────── */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-medium text-sm">Kolory marki (Global Colors)</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Każdy slot ma osobną wartość dla trybu jasnego (
              <Sun className="inline w-3 h-3 mb-0.5" /> Light) i ciemnego (
              <Moon className="inline w-3 h-3 mb-0.5" /> Dark). Zmiana wpływa od razu na
              całą stronę.
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
                        <div className="text-xs text-muted-foreground mt-0.5">{slot.description}</div>
                        {slot.overrides && slot.overrides.length > 0 && (
                          <div className="text-[10px] text-muted-foreground/80 mt-1 font-mono">
                            nadpisuje: {slot.overrides.join(", ")}
                          </div>
                        )}
                        <code className="text-[10px] text-muted-foreground font-mono">
                          var(--gc-{slot.key})
                        </code>
                      </div>
                      <div className={`grid gap-2 ${slot.hasDark ? "md:grid-cols-2" : "md:grid-cols-1"}`}>
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
            <h3 className="font-medium text-sm">Dodatkowe kolory (zmienne)</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Własne sloty dostępne jako <code>var(--brand-…)</code> w CSS i widgetach.
            </p>
          </div>
          <button
            type="button"
            onClick={addColor}
            className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> Dodaj kolor
          </button>
        </div>

        {draft.colors.length === 0 ? (
          <p className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-4 text-center">
            Brak dodatkowych kolorów.
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
                      setColors((cols) => cols.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))
                    }
                    placeholder="primary"
                  />
                  <ColorField
                    value={c.value}
                    onChange={(v) =>
                      setColors((cols) => cols.map((x, i) => i === idx ? { ...x, value: v ?? "" } : x))
                    }
                  />
                  <button
                    type="button"
                    onClick={() => copyVar(c.name)}
                    className="p-1.5 text-muted-foreground hover:text-brand"
                    title={`Skopiuj var(--brand-${slug})`}
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setColors((cols) => cols.filter((_, i) => i !== idx))}
                    className="p-1.5 text-muted-foreground hover:text-destructive"
                    title="Usuń"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <SaveBar
        saving={save.isPending || saveGlobals.isPending}
        onSave={saveAll}
      />
    </div>
  );
}
